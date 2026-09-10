//! Oracle EXACT de distance entre pièces posées (§12.3 du plan
//! « dernière tôle »).
//!
//! POURQUOI ce module existe. La carte de collision de jagua n'est PAS un
//! oracle de « distance ≥ space » : elle travaille sur des formes
//! simplifiées puis gonflées de `space/2`, l'offset d'un sommet convexe
//! dépasse le demi-espacement uniforme, et l'inflation referme les canaux
//! capillaires des pièces à trous (piège #2) — un hôte redevient plein et
//! sa fan nichée le « chevauche ». Trois calibrations d'un probe jagua ont
//! rejeté des agencements MESURÉS légaux (2,0001 mm pour 2,0 promis,
//! 0 mm² d'intersection ; §11.2). La garde de la finition a donc besoin
//! d'une distance vraie, sur les anneaux d'origine.
//!
//! SÉMANTIQUE. `material_distance` rend la distance entre les MATIÈRES de
//! deux pièces, trous soustraits — exactement `shapely.Polygon.distance`
//! (la référence de mesure du pipeline, `bench/measure_finish_pairs.py`) :
//!
//! * frontières qui se croisent, ou l'une dans la matière de l'autre → 0 ;
//! * pièce entièrement dans un TROU de l'autre → distance à l'anneau de ce
//!   trou (piège #4 : la matière de l'hôte s'arrête au bord du trou) ;
//! * sinon → distance arête↔arête des anneaux extérieurs.
//!
//! PIÈGE #55 : une distance sommet→arête ne voit pas deux arêtes qui se
//! croisent en leur milieu (une paire à 33 mm² de chevauchement rendait
//! 0,11 mm côté JS). `seg_seg_dist` rend 0 sur croisement, et
//! `ring_min_distance` parcourt les PAIRES D'ARÊTES.
//!
//! DÉTERMINISME (piège 14b) : uniquement `+ - * /` et `sqrt`, IEEE-exacts
//! sur toutes les cibles. Les rotations multiples de 90° sont exactes
//! (0 / ±1, aucune transcendantale) ; un angle libre passe par `libm`,
//! comme le reste du moteur.

use jagua_rs::io::ext_repr::{ExtShape, ExtTransformation};

/// Anneaux d'une pièce dans le repère EXTERNE : extérieur + trous.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Rings {
    pub outer: Vec<(f32, f32)>,
    pub holes: Vec<Vec<(f32, f32)>>,
}

/// Marge de « strictement intérieur » pour les tests de containment : un
/// point à moins de ça d'une frontière est traité comme SUR la frontière
/// (miroir de `STRICT_INSIDE_MM` du JS, résolution du simplify moteur).
const STRICT_INSIDE_MM: f32 = 0.01;

/// Anneaux d'une forme externe. Une `MultiPolygon` rend plusieurs pièces
/// de matière, chacune avec ses trous.
pub fn rings_of_shape(shape: &ExtShape) -> Vec<Rings> {
    match shape {
        ExtShape::Rectangle {
            x_min,
            y_min,
            width,
            height,
        } => vec![Rings {
            outer: vec![
                (*x_min, *y_min),
                (*x_min + *width, *y_min),
                (*x_min + *width, *y_min + *height),
                (*x_min, *y_min + *height),
            ],
            holes: vec![],
        }],
        ExtShape::SimplePolygon(p) => vec![Rings {
            outer: dedup_closing(&p.0),
            holes: vec![],
        }],
        ExtShape::Polygon(p) => vec![Rings {
            outer: dedup_closing(&p.outer.0),
            holes: p.inner.iter().map(|r| dedup_closing(&r.0)).collect(),
        }],
        ExtShape::MultiPolygon(ps) => ps
            .iter()
            .map(|p| Rings {
                outer: dedup_closing(&p.outer.0),
                holes: p.inner.iter().map(|r| dedup_closing(&r.0)).collect(),
            })
            .collect(),
    }
}

/// Retire le sommet de fermeture s'il duplique le premier : les boucles
/// d'arêtes ci-dessous ferment l'anneau elles-mêmes (`% n`), un doublon
/// ajouterait une arête dégénérée.
fn dedup_closing(pts: &[(f32, f32)]) -> Vec<(f32, f32)> {
    let mut v = pts.to_vec();
    while v.len() > 1 && v[v.len() - 1] == v[0] {
        v.pop();
    }
    v
}

/// (cos, sin) d'un angle en degrés — EXACT pour les multiples de 90°.
fn rot_cos_sin(deg: f32) -> (f32, f32) {
    let q = deg.rem_euclid(360.0);
    if q == 0.0 {
        (1.0, 0.0)
    } else if q == 90.0 {
        (0.0, 1.0)
    } else if q == 180.0 {
        (-1.0, 0.0)
    } else if q == 270.0 {
        (0.0, -1.0)
    } else {
        let r = (q as f64).to_radians();
        (libm::cos(r) as f32, libm::sin(r) as f32)
    }
}

/// Pièce POSÉE : rotation autour de l'origine puis translation, dans la
/// convention de `ExtTransformation` (rotation en degrés) — la même que
/// `bpp::placed_aabb` et que l'export DXF.
pub fn place_rings(r: &Rings, t: &ExtTransformation) -> Rings {
    let (c, s) = rot_cos_sin(t.rotation);
    let (tx, ty) = t.translation;
    let map = |ring: &Vec<(f32, f32)>| -> Vec<(f32, f32)> {
        ring.iter()
            .map(|(x, y)| (tx + x * c - y * s, ty + x * s + y * c))
            .collect()
    };
    Rings {
        outer: map(&r.outer),
        holes: r.holes.iter().map(map).collect(),
    }
}

fn bbox(ring: &[(f32, f32)]) -> (f32, f32, f32, f32) {
    let mut bb = (f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);
    for (x, y) in ring {
        bb.0 = bb.0.min(*x);
        bb.1 = bb.1.min(*y);
        bb.2 = bb.2.max(*x);
        bb.3 = bb.3.max(*y);
    }
    bb
}

/// Écart entre deux AABB (0 si elles se recouvrent). Minorant EXACT de la
/// distance des anneaux qu'elles contiennent : c'est le pré-filtre.
fn bbox_gap(a: (f32, f32, f32, f32), b: (f32, f32, f32, f32)) -> f32 {
    let dx = (b.0 - a.2).max(a.0 - b.2).max(0.0);
    let dy = (b.1 - a.3).max(a.1 - b.3).max(0.0);
    if dx == 0.0 && dy == 0.0 {
        0.0
    } else {
        (dx * dx + dy * dy).sqrt()
    }
}

fn orient(p: (f32, f32), q: (f32, f32), r: (f32, f32)) -> f64 {
    let (px, py) = (p.0 as f64, p.1 as f64);
    let (qx, qy) = (q.0 as f64, q.1 as f64);
    let (rx, ry) = (r.0 as f64, r.1 as f64);
    (qx - px) * (ry - py) - (qy - py) * (rx - px)
}

fn seg_point_dist(p: (f32, f32), a: (f32, f32), b: (f32, f32)) -> f32 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let l2 = dx * dx + dy * dy;
    let (qx, qy) = if l2 == 0.0 {
        (a.0, a.1)
    } else {
        let mut t = ((p.0 - a.0) * dx + (p.1 - a.1) * dy) / l2;
        t = t.clamp(0.0, 1.0);
        (a.0 + t * dx, a.1 + t * dy)
    };
    let (ex, ey) = (p.0 - qx, p.1 - qy);
    (ex * ex + ey * ey).sqrt()
}

/// Distance entre deux segments — **0 s'ils se croisent** (piège #55).
pub fn seg_seg_dist(p1: (f32, f32), p2: (f32, f32), q1: (f32, f32), q2: (f32, f32)) -> f32 {
    let (o1, o2) = (orient(p1, p2, q1), orient(p1, p2, q2));
    let (o3, o4) = (orient(q1, q2, p1), orient(q1, q2, p2));
    if ((o1 > 0.0) != (o2 > 0.0)) && ((o3 > 0.0) != (o4 > 0.0)) && o1 != 0.0 && o2 != 0.0 && o3 != 0.0 && o4 != 0.0
    {
        return 0.0;
    }
    seg_point_dist(p1, q1, q2)
        .min(seg_point_dist(p2, q1, q2))
        .min(seg_point_dist(q1, p1, p2))
        .min(seg_point_dist(q2, p1, p2))
}

/// Distance minimale ARÊTE↔ARÊTE entre deux anneaux (0 si les frontières
/// se croisent). Ne dit RIEN du containment : deux anneaux emboîtés sans
/// contact ont une distance de frontière positive — c'est
/// `material_distance` qui tranche.
pub fn ring_min_distance(a: &[(f32, f32)], b: &[(f32, f32)]) -> f32 {
    if a.len() < 2 || b.len() < 2 {
        return f32::INFINITY;
    }
    let mut best = f32::INFINITY;
    for i in 0..a.len() {
        let (p1, p2) = (a[i], a[(i + 1) % a.len()]);
        let pbb = bbox(&[p1, p2]);
        for j in 0..b.len() {
            let (q1, q2) = (b[j], b[(j + 1) % b.len()]);
            // Pré-filtre exact : l'écart des AABB d'arêtes minore leur
            // distance. Sur une tôle dense, la majorité des paires
            // d'arêtes sort ici sans racine carrée.
            if bbox_gap(pbb, bbox(&[q1, q2])) >= best {
                continue;
            }
            let d = seg_seg_dist(p1, p2, q1, q2);
            if d < best {
                best = d;
                if best == 0.0 {
                    return 0.0;
                }
            }
        }
    }
    best
}

fn point_in_ring(pt: (f32, f32), ring: &[(f32, f32)]) -> bool {
    let mut inside = false;
    let n = ring.len();
    if n < 3 {
        return false;
    }
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = ring[i];
        let (xj, yj) = ring[j];
        if (yi > pt.1) != (yj > pt.1) && pt.0 < (xj - xi) * (pt.1 - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Distance entre les MATIÈRES de deux pièces posées, trous soustraits —
/// même sémantique que `shapely.Polygon.distance` (la référence du
/// pipeline). 0 signifie « se touchent ou se chevauchent ».
///
/// LE RAISONNEMENT, parce qu'il est ce qui rend la fonction exacte : si les
/// frontières ne se croisent PAS, alors la frontière de `a` est entièrement
/// dedans ou entièrement dehors de `b`. Un SOMMET de `a` suffit donc à
/// trancher le containment — et un sommet est un point dont on sait qu'il
/// appartient à la frontière de `a`.
///
/// Ce que la première version faisait et qui était FAUX : elle échantillonnait
/// centroïde, sommets et milieux d'arêtes de `a` et concluait « a est dans la
/// matière de b » dès qu'UN de ces points y tombait. Or le centroïde d'aire
/// d'une pièce CONCAVE (un C, un L — la moitié des pièces marines de la démo)
/// tombe hors de la pièce, et peut très bien tomber dans la matière du
/// voisin : la garde rendait alors 0 mm sur un agencement mesuré à 2,0 mm par
/// shapely (verrou `bench/oracle_parity.py`, dump `finish-left` du 10/09,
/// 23 pièces, 7 formes de 6 à 133 sommets). Un point d'épreuve n'a de valeur
/// que si l'on sait de quel côté de la frontière il est.
pub fn material_distance(a: &Rings, b: &Rings) -> f32 {
    let d_outer = ring_min_distance(&a.outer, &b.outer);
    if d_outer <= 0.0 {
        return 0.0; // frontières qui se croisent ou se touchent
    }
    // Frontières disjointes : reste le containment, qu'une distance de
    // frontière ne voit pas.
    if let Some(v) = a.outer.first() {
        if point_in_ring(*v, &b.outer) {
            // `a` est dans l'anneau extérieur de `b` : dans un TROU (légal,
            // piège #4) ou dans sa MATIÈRE (chevauchement).
            for hole in &b.holes {
                if point_in_ring(*v, hole) {
                    return ring_min_distance(hole, &a.outer);
                }
            }
            return 0.0;
        }
    }
    if let Some(v) = b.outer.first() {
        if point_in_ring(*v, &a.outer) {
            for hole in &a.holes {
                if point_in_ring(*v, hole) {
                    return ring_min_distance(hole, &b.outer);
                }
            }
            return 0.0;
        }
    }
    d_outer
}

/// Distance minimale entre pièces d'un agencement, avec la paire fautive.
pub fn min_pair_distance(pieces: &[Rings]) -> (f32, Option<(usize, usize)>) {
    min_pair_distance_upto(pieces, f32::INFINITY)
}

/// Comme [`min_pair_distance`], mais PLAFONNÉE : tout ce qui est au-delà de
/// `ceiling` ne nous intéresse pas, et le plafond sert de meilleur courant
/// initial — donc de sécateur.
///
/// C'est ce qui rend la mesure utilisable sur une tôle dense : sans
/// plafond, la première pièce du balayage se compare à TOUTES les autres
/// (le meilleur courant part de l'infini), et une distance d'anneaux coûte
/// O(sommets²) — le miroir JS de cette mesure a coûté 5,7 s de gel sur
/// 400 000 paires (audit perf du 05/09). Avec `ceiling = space + 1 mm`,
/// c'est la broadphase du rapport aval : seules les paires réellement
/// proches paient le calcul exact.
///
/// La valeur rendue est la distance vraie quand elle est SOUS le plafond,
/// et le plafond sinon (« au moins autant ») : la parité avec shapely se
/// compare donc à `min(d_shapely, ceiling)`.
pub fn min_pair_distance_upto(pieces: &[Rings], ceiling: f32) -> (f32, Option<(usize, usize)>) {
    let mut order: Vec<usize> = (0..pieces.len()).collect();
    let boxes: Vec<(f32, f32, f32, f32)> = pieces.iter().map(|p| bbox(&p.outer)).collect();
    order.sort_by(|&i, &j| {
        boxes[i]
            .0
            .partial_cmp(&boxes[j].0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(i.cmp(&j))
    });
    let mut best = ceiling;
    let mut worst: Option<(usize, usize)> = None;
    for (oi, &i) in order.iter().enumerate() {
        for &j in order.iter().skip(oi + 1) {
            if boxes[j].0 - boxes[i].2 >= best {
                break; // trié en x : tous les suivants sont plus loin
            }
            if bbox_gap(boxes[i], boxes[j]) >= best {
                continue;
            }
            let d = material_distance(&pieces[i], &pieces[j]);
            if d < best {
                best = d;
                worst = Some(if i < j { (i, j) } else { (j, i) });
            }
        }
    }
    (best, worst)
}

#[cfg(test)]
mod tests {
    //! §12.3 — verrous de l'oracle. Chaque cas est un piège connu du
    //! dépôt, pas une figure abstraite.
    use super::*;

    fn square(side: f32) -> Rings {
        Rings {
            outer: vec![(0.0, 0.0), (side, 0.0), (side, side), (0.0, side)],
            holes: vec![],
        }
    }

    fn at(r: &Rings, x: f32, y: f32) -> Rings {
        place_rings(r, &ExtTransformation { rotation: 0.0, translation: (x, y) })
    }

    #[test]
    fn distance_of_two_squares_is_their_gap() {
        let s = square(40.0);
        let d = material_distance(&at(&s, 0.0, 0.0), &at(&s, 42.5, 0.0));
        assert!((d - 2.5).abs() < 1e-4, "{d} au lieu de 2,5");
    }

    /// PIÈGE #55 : une distance sommet→arête ne voit pas deux arêtes qui se
    /// croisent en leur MILIEU — une paire à 33 mm² de chevauchement
    /// rendait 0,11 mm côté JS. Deux croix décalées se croisent sans
    /// qu'aucun sommet de l'une ne tombe dans l'autre.
    #[test]
    fn crossing_edges_without_inner_vertex_measure_zero() {
        let horizontal = Rings {
            outer: vec![(0.0, 45.0), (100.0, 45.0), (100.0, 55.0), (0.0, 55.0)],
            holes: vec![],
        };
        let vertical = Rings {
            outer: vec![(45.0, 0.0), (55.0, 0.0), (55.0, 100.0), (45.0, 100.0)],
            holes: vec![],
        };
        // Aucun sommet de l'un n'est à l'intérieur de l'autre.
        assert_eq!(material_distance(&horizontal, &vertical), 0.0);
        assert_eq!(seg_seg_dist((0.0, 50.0), (100.0, 50.0), (50.0, 0.0), (50.0, 100.0)), 0.0);
    }

    /// PIÈGE #4 : une pièce nichée dans le TROU de son hôte est LÉGALE, et
    /// sa distance est celle qui la sépare de l'anneau DU TROU — pas de
    /// l'anneau extérieur de l'hôte, qui l'engloberait.
    #[test]
    fn piece_nested_in_a_hole_measures_against_the_hole() {
        let host = Rings {
            outer: vec![(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)],
            holes: vec![vec![(20.0, 20.0), (80.0, 20.0), (80.0, 80.0), (20.0, 80.0)]],
        };
        // Fan de 40 mm centrée dans un trou de 60 mm : 10 mm de chaque côté.
        let fan = at(&square(40.0), 30.0, 30.0);
        let d = material_distance(&host, &fan);
        assert!((d - 10.0).abs() < 1e-4, "{d} au lieu de 10 mm au bord du trou");
        // Trop grande pour le trou : elle mord la paroi → 0.
        let big = at(&square(70.0), 15.0, 15.0);
        assert_eq!(material_distance(&host, &big), 0.0);
    }

    /// Une pièce entièrement DANS la matière de l'autre (sans trou) a une
    /// distance de frontière positive : c'est le containment V9/W4, qui doit
    /// rendre 0.
    #[test]
    fn piece_inside_material_measures_zero() {
        let big = square(100.0);
        let small = at(&square(10.0), 40.0, 40.0);
        assert_eq!(material_distance(&big, &small), 0.0);
        assert_eq!(material_distance(&small, &big), 0.0);
    }

    /// Le contact bord à bord vaut exactement 0 — la politique de
    /// l'espacement est décidée par l'appelant (piège #57 : à space > 0 un
    /// contact est une violation, à space 0 il est permis).
    #[test]
    fn edge_contact_measures_zero() {
        let s = square(40.0);
        assert_eq!(material_distance(&at(&s, 0.0, 0.0), &at(&s, 40.0, 0.0)), 0.0);
    }

    /// Les rotations d'un quart de tour sont EXACTES : aucune
    /// transcendantale, donc aucune divergence natif/wasm (piège 14b).
    #[test]
    fn quarter_turns_are_exact() {
        for deg in [0.0f32, 90.0, 180.0, 270.0, -90.0, 360.0] {
            let (c, s) = rot_cos_sin(deg);
            assert!(c == 0.0 || c == 1.0 || c == -1.0, "cos({deg}) = {c}");
            assert!(s == 0.0 || s == 1.0 || s == -1.0, "sin({deg}) = {s}");
        }
        let r = place_rings(
            &Rings { outer: vec![(1.0, 2.0), (5.0, 2.0), (5.0, 4.0), (1.0, 4.0)], holes: vec![] },
            &ExtTransformation { rotation: 90.0, translation: (10.0, 20.0) },
        );
        // R(90) = (−y, x), la même convention que le moteur (piège #48).
        assert_eq!(r.outer[0], (10.0 - 2.0, 20.0 + 1.0));
    }

    /// La paire fautive d'un agencement, avec le balayage en x.
    #[test]
    fn min_pair_distance_names_the_pair() {
        let s = square(20.0);
        let pieces = vec![
            at(&s, 0.0, 0.0),
            at(&s, 25.0, 0.0),   // 5 mm du premier
            at(&s, 46.5, 0.0),   // 1,5 mm du deuxième — le minimum
            at(&s, 0.0, 100.0),
        ];
        let (d, pair) = min_pair_distance(&pieces);
        assert!((d - 1.5).abs() < 1e-4, "{d} au lieu de 1,5");
        assert_eq!(pair, Some((1, 2)));
    }
}
