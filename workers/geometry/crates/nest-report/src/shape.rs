//! Tôle importée (contour + zones interdites) : contrôles du rapport sur la
//! VRAIE forme, pas sur la boîte englobante.
//!
//! Les anneaux arrivent du navigateur (fermés, repère de la tôle, boîte du
//! contour en (0,0), mm). Rien ici n'est émis vers un serveur : la forme n'est
//! qu'une entrée du calcul, jamais une sortie (seuls des scalaires sortent).
//!
//! Arithmétique IEEE simple (sqrt, +, -, *, /) : natif et wasm s'accordent
//! (piège 14b). Tous les anneaux sont refermés avant usage (piège 5c).

use crate::geom::{self, Pt};
use serde::{Deserialize, Serialize};

/// Tolérance de sortie du contour (mm). Le lecteur DXF aplatit les courbes à
/// 0,01 mm : la tôle n'est connue qu'à cette précision. Le moteur garde les
/// pièces à environ espacement/2 du bord (donc DANS le contour, au bruit
/// flottant près) : une vraie sortie dépasse largement 0,01 mm, un bruit non.
pub const OUTLINE_TOL_MM: f64 = 0.01;

/// Précision d'appartenance à un bord (même valeur que WITHIN_EPS de lib.rs).
const ON_EPS: f64 = 1e-7;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SheetShape {
    pub outer: Vec<Pt>,
    #[serde(default)]
    pub inner: Vec<Vec<Pt>>,
}

/// Anneau refermé (premier point répété), copie.
pub fn closed(ring: &[Pt]) -> Vec<Pt> {
    let mut r = ring.to_vec();
    if let (Some(f), Some(l)) = (r.first().copied(), r.last().copied()) {
        if f != l {
            r.push(f);
        }
    }
    r
}

fn finite_ring(ring: &[Pt]) -> bool {
    ring.iter().all(|p| p[0].is_finite() && p[1].is_finite())
}

/// Aire signée (shoelace, anneau fermé) : > 0 anti-horaire.
fn signed_area(ring: &[Pt]) -> f64 {
    let mut a = 0.0;
    for w in ring.windows(2) {
        a += w[0][0] * w[1][1] - w[1][0] * w[0][1];
    }
    a / 2.0
}

fn oriented(ring: &[Pt], ccw: bool) -> Vec<Pt> {
    let mut r = closed(ring);
    if (signed_area(&r) > 0.0) != ccw {
        r.reverse();
    }
    r
}

/// Forme prête à servir : anneaux fermés, contour anti-horaire, zones
/// anti-horaires (la distance et l'aire de recouvrement n'en dépendent pas).
pub struct ReadyShape {
    pub outer: Vec<Pt>,
    pub zones: Vec<Vec<Pt>>,
    zone_boxes: Vec<[f64; 4]>,
}

impl SheetShape {
    /// `None` si la forme est inexploitable (moins de 3 sommets, coordonnée
    /// non finie, aire nulle) : l'appelant doit alors répondre « non vérifié ».
    pub fn ready(&self) -> Option<ReadyShape> {
        if self.outer.len() < 3 || !finite_ring(&self.outer) {
            return None;
        }
        let outer = oriented(&self.outer, true);
        if outer.len() < 4 || signed_area(&outer).abs() <= 1e-12 {
            return None;
        }
        let mut zones = Vec::new();
        for z in &self.inner {
            if z.len() < 3 || !finite_ring(z) {
                return None;
            }
            let zr = oriented(z, true);
            if zr.len() >= 4 && signed_area(&zr).abs() > 1e-12 {
                zones.push(zr);
            }
        }
        let zone_boxes = zones.iter().map(|z| geom::ring_bounds(z)).collect();
        Some(ReadyShape { outer, zones, zone_boxes })
    }
}

impl ReadyShape {
    pub fn outline_area(&self) -> f64 {
        signed_area(&self.outer).abs()
    }
    pub fn zones_area(&self) -> f64 {
        self.zones.iter().map(|z| signed_area(z).abs()).sum()
    }
    /// Aire utile : contour moins zones (jamais négative).
    pub fn usable_area(&self) -> f64 {
        (self.outline_area() - self.zones_area()).max(0.0)
    }
}

fn dist_to_ring(p: Pt, ring: &[Pt]) -> f64 {
    let mut best = f64::INFINITY;
    for w in ring.windows(2) {
        best = best.min(geom::point_seg_dist(p, w[0], w[1]));
    }
    best
}

fn box_gap(a: &[f64; 4], b: &[f64; 4]) -> f64 {
    let dx = (a[0] - b[2]).max(b[0] - a[2]).max(0.0);
    let dy = (a[1] - b[3]).max(b[1] - a[3]).max(0.0);
    (dx * dx + dy * dy).sqrt()
}

/// Excursion maximale (mm) de la pièce HORS du contour : 0 si elle est
/// entière dedans (contact admis). Compte les BORDS, pas seulement les
/// sommets : une arête dont les deux bouts sont dedans peut traverser une
/// encoche concave du contour. Chaque arête est coupée aux croisements et aux
/// sommets du contour qu'elle touche ; les tronçons sont échantillonnés (quarts
/// et pieds des sommets du contour proches) — la valeur d'une excursion est
/// donc une borne basse proche du maximum, la décision (> tolérance) ne manque
/// pas une vraie traversée.
/// BORNE BASSE ÉCHANTILLONNÉE : entre deux points d'essai, un dépassement plus
/// profond peut exister (arête qui traverse une encoche de biais). Elle suffit
/// pour dire « dehors » contre 0,01 mm ; pour comparer une profondeur à une
/// limite (distance au bord négative), prendre `outside_depth_exact`.
pub fn outside_depth(part: &[Pt], sh: &ReadyShape) -> f64 {
    outside_depth_with(part, sh, false)
}

/// Évaluations de distance accordées à UNE pièce par `outside_depth_exact`.
/// Au-delà, les tronçons restants ne sont plus affinés : la valeur redevient
/// une borne basse (jamais vu sur les formes d'essai, quelques dizaines
/// d'évaluations par tronçon).
const EXACT_DEPTH_EVALS: usize = 20_000;

/// Précision visée de la profondeur exacte (mm) : mille fois plus fine que le
/// millième affiché.
const EXACT_DEPTH_EPS: f64 = 1e-6;

/// `outside_depth` sans l'échantillonnage : la profondeur MAXIMALE du
/// dépassement, à `EXACT_DEPTH_EPS` près. Sert quand un dépassement est permis
/// (distance au bord négative) : la valeur est alors comparée à une limite, et
/// une borne basse laisserait passer un dépassement trop profond.
///
/// Sur un tronçon d'arête entièrement dehors, la distance au contour est le
/// minimum des distances à ses arêtes, chacune CONVEXE le long du tronçon. Entre
/// deux points dont l'arête la plus proche est la même, la distance ne dépasse
/// donc pas la plus grande des deux valeurs : rien à chercher. Sinon le tronçon
/// est coupé en deux, tant que la borne de Lipschitz (pente 1) laisse la place
/// à mieux que le maximum connu.
pub fn outside_depth_exact(part: &[Pt], sh: &ReadyShape) -> f64 {
    outside_depth_with(part, sh, true)
}

/// Distance au contour et indice de l'arête la plus proche.
fn nearest_edge(p: Pt, ring: &[Pt]) -> (f64, usize) {
    let mut best = (f64::INFINITY, 0usize);
    for (i, w) in ring.windows(2).enumerate() {
        let d = geom::point_seg_dist(p, w[0], w[1]);
        if d < best.0 {
            best = (d, i);
        }
    }
    best
}

/// Maximum de la distance au contour sur le tronçon dehors `a + t·ab`, t dans
/// [t0 ; t1] (voir `outside_depth_exact`). `evals` : budget restant de la pièce.
fn exact_span_depth(a: Pt, ab: Pt, t0: f64, t1: f64, ring: &[Pt], floor: f64, evals: &mut usize) -> f64 {
    let len = (ab[0] * ab[0] + ab[1] * ab[1]).sqrt();
    let at = |t: f64| -> (f64, usize) { nearest_edge([a[0] + t * ab[0], a[1] + t * ab[1]], ring) };
    let (e0, e1) = (at(t0), at(t1));
    let mut best = floor.max(e0.0).max(e1.0);
    let mut stack = vec![(t0, e0, t1, e1)];
    while let Some((ta, ea, tb, eb)) = stack.pop() {
        if ea.1 == eb.1 {
            continue;
        }
        let span = (tb - ta) * len;
        if span <= EXACT_DEPTH_EPS || 0.5 * (ea.0 + eb.0 + span) <= best + EXACT_DEPTH_EPS {
            continue;
        }
        if *evals == 0 {
            break;
        }
        *evals -= 1;
        let tm = 0.5 * (ta + tb);
        let em = at(tm);
        best = best.max(em.0);
        stack.push((ta, ea, tm, em));
        stack.push((tm, em, tb, eb));
    }
    best
}

fn outside_depth_with(part: &[Pt], sh: &ReadyShape, exact: bool) -> f64 {
    let mut evals = EXACT_DEPTH_EVALS;
    let ring = &sh.outer;
    let pb = geom::ring_bounds(part);
    let eb = [pb[0] - ON_EPS, pb[1] - ON_EPS, pb[2] + ON_EPS, pb[3] + ON_EPS];
    // Arêtes du contour dont la boîte touche celle de la pièce.
    let near: Vec<usize> = (0..ring.len() - 1)
        .filter(|&i| {
            let (a, b) = (ring[i], ring[i + 1]);
            a[0].max(b[0]) >= eb[0] && a[0].min(b[0]) <= eb[2]
                && a[1].max(b[1]) >= eb[1] && a[1].min(b[1]) <= eb[3]
        })
        .collect();
    let mut depth = 0.0f64;
    let near_dist = |p: Pt| -> f64 {
        let mut d = f64::INFINITY;
        for &i in &near {
            d = d.min(geom::point_seg_dist(p, ring[i], ring[i + 1]));
        }
        d
    };
    let inside = |p: Pt| -> bool { near_dist(p) <= ON_EPS || geom::point_in_ring(p, ring) };
    if near.is_empty() {
        // Aucune arête du contour dans la boîte de la pièce : tous ses points
        // sont du même côté, un sommet suffit.
        if inside(part[0]) {
            return 0.0;
        }
        for p in part {
            depth = depth.max(dist_to_ring(*p, ring));
        }
        return depth;
    }
    for p in part {
        if !inside(*p) {
            depth = depth.max(dist_to_ring(*p, ring));
        }
    }
    for w in part.windows(2) {
        let (a, b) = (w[0], w[1]);
        let ab = [b[0] - a[0], b[1] - a[1]];
        let l2 = ab[0] * ab[0] + ab[1] * ab[1];
        if l2 == 0.0 {
            continue;
        }
        let sb = [a[0].min(b[0]) - ON_EPS, a[1].min(b[1]) - ON_EPS, a[0].max(b[0]) + ON_EPS, a[1].max(b[1]) + ON_EPS];
        let mut ts = vec![0.0, 1.0];
        let mut feet = Vec::new();
        for &i in &near {
            let (c, d) = (ring[i], ring[i + 1]);
            if c[0].max(d[0]) < sb[0] || c[0].min(d[0]) > sb[2] || c[1].max(d[1]) < sb[1] || c[1].min(d[1]) > sb[3] {
                continue;
            }
            let cd = [d[0] - c[0], d[1] - c[1]];
            let den = ab[0] * cd[1] - ab[1] * cd[0];
            if den != 0.0 {
                let ac = [c[0] - a[0], c[1] - a[1]];
                let t = (ac[0] * cd[1] - ac[1] * cd[0]) / den;
                let u = (ac[0] * ab[1] - ac[1] * ab[0]) / den;
                if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) {
                    ts.push(t);
                }
            }
            for v in [c, d] {
                let t = (((v[0] - a[0]) * ab[0] + (v[1] - a[1]) * ab[1]) / l2).clamp(0.0, 1.0);
                feet.push(t);
                if geom::point_seg_dist(v, a, b) <= ON_EPS {
                    ts.push(t);
                }
            }
        }
        ts.sort_by(|x, y| x.partial_cmp(y).unwrap());
        for k in 0..ts.len() - 1 {
            let (t0, t1) = (ts[k], ts[k + 1]);
            if t1 - t0 <= 1e-12 {
                continue;
            }
            if exact {
                // Le tronçon ne croise pas le contour : dedans ou dehors d'un bloc,
                // son milieu le dit.
                let tm = t0 + 0.5 * (t1 - t0);
                if !inside([a[0] + tm * ab[0], a[1] + tm * ab[1]]) {
                    depth = exact_span_depth(a, ab, t0, t1, ring, depth, &mut evals);
                }
                continue;
            }
            let mut samples = vec![t0 + 0.25 * (t1 - t0), t0 + 0.5 * (t1 - t0), t0 + 0.75 * (t1 - t0)];
            samples.extend(feet.iter().copied().filter(|&t| t > t0 && t < t1));
            for t in samples {
                let p = [a[0] + t * ab[0], a[1] + t * ab[1]];
                if !inside(p) {
                    depth = depth.max(dist_to_ring(p, ring));
                }
            }
        }
    }
    depth
}

/// Distance (mm) de la pièce (dedans) au contour : min des distances
/// sommet↔arête croisées. `best` borne la recherche (les arêtes dont la boîte
/// est déjà plus loin que le meilleur connu ne peuvent pas le battre).
pub fn gap_to_outline(part: &[Pt], sh: &ReadyShape, best: f64) -> f64 {
    let ring = &sh.outer;
    let pb = geom::ring_bounds(part);
    let mut res = f64::INFINITY;
    let edges: Vec<usize> = (0..ring.len() - 1)
        .filter(|&i| {
            let (a, b) = (ring[i], ring[i + 1]);
            let eb = [a[0].min(b[0]), a[1].min(b[1]), a[0].max(b[0]), a[1].max(b[1])];
            box_gap(&pb, &eb) < best.min(res)
        })
        .collect();
    for p in part {
        for &i in &edges {
            res = res.min(geom::point_seg_dist(*p, ring[i], ring[i + 1]));
        }
    }
    for &i in &edges {
        for w in part.windows(2) {
            res = res.min(geom::point_seg_dist(ring[i], w[0], w[1]));
        }
    }
    res
}

/// Arête d'un anneau avec sa boîte (pour l'élagage exact des couples d'arêtes).
#[derive(Clone, Copy)]
struct Edge {
    a: Pt,
    b: Pt,
    bx: [f64; 4],
}

/// Appartenance à un bord pour l'aire commune de deux matières (pièce/pièce,
/// pièce/zone). Bien plus fine que ON_EPS : à 1e-7, un tronçon posé à ~1e-7
/// d'un bord était dit « sur le bord » à un endroit et pas à l'autre, compté
/// deux fois ou pas du tout (aire mesurée jusqu'à -18 042 mm²). Des poses
/// réelles qui coïncident le font à quelques ulp (~1e-12 mm à 4 000 mm).
const AREA_ON_EPS: f64 = 1e-10;

/// Marge des boîtes d'élagage : au-dessus de la tolérance d'appartenance
/// (AREA_ON_EPS), pour qu'aucune arête assez proche ne soit écartée.
const PRUNE_EPS: f64 = 2.0 * AREA_ON_EPS;

/// Accord exigé entre les deux ordres de calcul de l'aire commune (mm²) :
/// même seuil que le recouvrement compté par le rapport.
const AREA_AGREE_MM2: f64 = 0.01;

fn edges_of(ring: &[Pt]) -> Vec<Edge> {
    ring.windows(2)
        .map(|w| Edge {
            a: w[0],
            b: w[1],
            bx: [w[0][0].min(w[1][0]), w[0][1].min(w[1][1]), w[0][0].max(w[1][0]), w[0][1].max(w[1][1])],
        })
        .collect()
}

fn boxes_touch(a: &[f64; 4], b: &[f64; 4], eps: f64) -> bool {
    a[0] <= b[2] + eps && b[0] <= a[2] + eps && a[1] <= b[3] + eps && b[1] <= a[3] + eps
}

/// Points de découpe (paramètres 0..1) de l'arête a-b par les arêtes `edges`
/// (déjà élaguées sur la boîte de a-b) : croisements, et sommets posés sur
/// l'arête. Même résultat que le balayage de l'anneau entier : une arête ou un
/// sommet qui compte touche la boîte de a-b.
fn split_params(a: Pt, b: Pt, edges: &[Edge]) -> Vec<f64> {
    let mut ts = vec![0.0, 1.0];
    let ab = [b[0] - a[0], b[1] - a[1]];
    let l2 = ab[0] * ab[0] + ab[1] * ab[1];
    if l2 == 0.0 {
        return ts;
    }
    for e in edges {
        for p in [e.a, e.b] {
            if geom::point_seg_dist(p, a, b) <= AREA_ON_EPS {
                ts.push((((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2).clamp(0.0, 1.0));
            }
        }
    }
    for e in edges {
        let cd = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
        let den = ab[0] * cd[1] - ab[1] * cd[0];
        if den == 0.0 {
            continue;
        }
        let ac = [e.a[0] - a[0], e.a[1] - a[1]];
        let t = (ac[0] * cd[1] - ac[1] * cd[0]) / den;
        let u = (ac[0] * ab[1] - ac[1] * ab[0]) / den;
        if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) {
            ts.push(t);
        }
    }
    ts.sort_by(|x, y| x.partial_cmp(y).unwrap());
    ts
}

fn on_edges(p: Pt, edges: &[Edge]) -> bool {
    edges.iter().any(|e| geom::point_seg_dist(p, e.a, e.b) <= AREA_ON_EPS)
}

/// Direction (produit scalaire) de la première arête de `edges` qui porte `p`
/// (ordre de l'anneau), par rapport à `dir` ; `None` si `p` n'est sur aucune.
fn dot_with_edge_at(p: Pt, dir: Pt, edges: &[Edge]) -> Option<f64> {
    for e in edges {
        if geom::point_seg_dist(p, e.a, e.b) <= AREA_ON_EPS {
            return Some(dir[0] * (e.b[0] - e.a[0]) + dir[1] * (e.b[1] - e.a[1]));
        }
    }
    None
}

/// Part signée de l'intégrale de contour (½∮ x dy − y dx) des tronçons de
/// `ring` qui sont STRICTEMENT dans la région testée par `strictly_in`, plus
/// — si `keep_same_dir` — ceux qui longent un bord de `others` dans le même
/// sens (un bord commun de même sens borde la même matière : compté une fois ;
/// de sens opposé : nul). `ring` est découpé par TOUS les anneaux de `others`
/// (sinon un tronçon qui franchit un trou serait classé d'un seul bloc).
///
/// Élagage exact : chaque arête de `ring` n'est découpée que par les arêtes de
/// `others` dont la boîte la touche (seules celles-là peuvent la couper ou la
/// longer). Si aucune arête de `others` ne touche la boîte de `ring`, aucun
/// tronçon n'est coupé et tous ont le même verdict : `strictly_in` n'est
/// évalué qu'une fois (même somme, mêmes formules, mêmes arrondis).
fn contour_part(
    ring: &[Pt],
    others: &[&[Pt]],
    strictly_in: &dyn Fn(Pt) -> bool,
    keep_same_dir: bool,
) -> f64 {
    let rb = geom::ring_bounds(ring);
    // Arêtes de chaque anneau de `others` qui touchent la boîte de `ring`.
    let near_ring: Vec<Vec<Edge>> = others
        .iter()
        .map(|o| edges_of(o).into_iter().filter(|e| boxes_touch(&e.bx, &rb, PRUNE_EPS)).collect())
        .collect();
    let quiet = near_ring.iter().all(|v| v.is_empty());
    // Boîte de toutes les arêtes proches : une arête de `ring` qui ne la touche
    // pas n'a aucune voisine (évite un filtrage et une allocation par arête).
    let mut nb = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for e in near_ring.iter().flatten() {
        nb = [nb[0].min(e.bx[0]), nb[1].min(e.bx[1]), nb[2].max(e.bx[2]), nb[3].max(e.bx[3])];
    }
    let mut sum = 0.0;
    let mut quiet_verdict: Option<bool> = None;
    for w in ring.windows(2) {
        let (a, b) = (w[0], w[1]);
        let eb = [a[0].min(b[0]), a[1].min(b[1]), a[0].max(b[0]), a[1].max(b[1])];
        let near: Vec<Vec<Edge>> = if quiet || !boxes_touch(&eb, &nb, PRUNE_EPS) {
            Vec::new()
        } else {
            near_ring
                .iter()
                .map(|v| v.iter().copied().filter(|e| boxes_touch(&e.bx, &eb, PRUNE_EPS)).collect())
                .collect()
        };
        let mut ts = vec![0.0, 1.0];
        let mut all_near: Vec<Edge> = Vec::new();
        for v in &near {
            all_near.extend_from_slice(v);
        }
        if !all_near.is_empty() {
            ts = split_params(a, b, &all_near);
        }
        for k in 0..ts.len() - 1 {
            let (t0, t1) = (ts[k], ts[k + 1]);
            if t1 - t0 <= 1e-12 {
                continue;
            }
            let tm = 0.5 * (t0 + t1);
            let m = [a[0] + tm * (b[0] - a[0]), a[1] + tm * (b[1] - a[1])];
            let dir = [b[0] - a[0], b[1] - a[1]];
            let keep = if near.iter().any(|o| on_edges(m, o)) {
                keep_same_dir
                    && near.iter().any(|o| dot_with_edge_at(m, dir, o).is_some_and(|d| d > 0.0))
            } else if quiet {
                *quiet_verdict.get_or_insert_with(|| strictly_in(m))
            } else {
                strictly_in(m)
            };
            if keep {
                let p0 = [a[0] + t0 * (b[0] - a[0]), a[1] + t0 * (b[1] - a[1])];
                let p1 = [a[0] + t1 * (b[0] - a[0]), a[1] + t1 * (b[1] - a[1])];
                sum += 0.5 * (p0[0] * p1[1] - p1[0] * p0[1]);
            }
        }
    }
    sum
}

/// Matière : contour (anti-horaire) et trous (horaires), anneaux fermés.
type Material = Vec<Vec<Pt>>;

fn material_of(outer: &[Pt], holes: &[Vec<Pt>]) -> Material {
    let mut v = vec![oriented(outer, true)];
    v.extend(holes.iter().map(|h| oriented(h, false)));
    v
}

fn material_area(m: &Material) -> f64 {
    signed_area(&m[0]).abs() - m[1..].iter().map(|h| signed_area(h).abs()).sum::<f64>()
}

/// Intégrale de Green BRUTE de la matière commune : bord de `a` dans `b` (un
/// bord commun de même sens compté de ce côté), plus bord de `b` dans `a`.
/// Exacte pour des polygones simples, mais pas symétrique au bruit près.
fn raw_overlap(a: &Material, b: &Material) -> f64 {
    let inside = |m: &Material, bx: &[f64; 4], p: Pt| -> bool {
        p[0] >= bx[0] && p[0] <= bx[2] && p[1] >= bx[1] && p[1] <= bx[3]
            && geom::point_in_ring(p, &m[0])
            && !m[1..].iter().any(|h| geom::point_in_ring(p, h))
    };
    let (ba, bb) = (geom::ring_bounds(&a[0]), geom::ring_bounds(&b[0]));
    let va: Vec<&[Pt]> = a.iter().map(|r| r.as_slice()).collect();
    let vb: Vec<&[Pt]> = b.iter().map(|r| r.as_slice()).collect();
    let mut area = 0.0;
    for r in a {
        area += contour_part(r, &vb, &|p| inside(b, &bb, p), true);
    }
    for r in b {
        area += contour_part(r, &va, &|p| inside(a, &ba, p), false);
    }
    area
}

/// Aire commune (mm²) à deux matières, ou `None` si le calcul n'est pas fiable.
/// Quand deux bords sont presque confondus, un tronçon peut encore être
/// classé des deux côtés ou d'aucun : l'intégrale sort alors de [0, aire de
/// la plus petite matière] ou dépend de l'ordre. On la calcule dans les deux
/// ordres ; un désaccord ou une valeur hors bornes (à 0,01 mm² près) rend
/// `None`, que l'appelant compte comme un recouvrement. Un cas construit exprès
/// a trompé les deux ordres à la fois : voir aussi le contrôle de fermeture.
fn guarded_overlap(a: &Material, b: &Material) -> Option<f64> {
    let (m1, m2) = (raw_overlap(a, b), raw_overlap(b, a));
    let amin = material_area(a).min(material_area(b));
    let ok = (m1 - m2).abs() <= AREA_AGREE_MM2
        && m1.min(m2) >= -AREA_AGREE_MM2
        && m1.max(m2) <= amin + AREA_AGREE_MM2;
    ok.then(|| m1.max(m2).max(0.0))
}

fn shifted(m: &Material, o: Pt) -> Material {
    m.iter().map(|r| r.iter().map(|p| [p[0] - o[0], p[1] - o[1]]).collect()).collect()
}

/// `guarded_overlap`, plus un contrôle de fermeture. Une frontière fermée a la
/// même intégrale de Green quelle que soit l'origine ; un tronçon perdu ou compté
/// deux fois (bords quasi confondus traités « sur le bord » des deux côtés, mal
/// vus dans les deux ordres à la fois) la déplace de ½·(ΔO × tronçon). Trois
/// autres origines (coins de la boîte de la paire) doivent donner la même aire,
/// sinon `None` : non fiable, compté comme un recouvrement.
fn guarded_overlap_closed(a: &Material, b: &Material) -> Option<f64> {
    let g0 = guarded_overlap(a, b)?;
    let (ba, bb) = (geom::ring_bounds(&a[0]), geom::ring_bounds(&b[0]));
    let lo = [ba[0].min(bb[0]), ba[1].min(bb[1])];
    let hi = [ba[2].max(bb[2]), ba[3].max(bb[3])];
    for o in [lo, hi, [lo[0], hi[1]]] {
        let g = guarded_overlap(&shifted(a, o), &shifted(b, o))?;
        if (g - g0).abs() > AREA_AGREE_MM2 {
            return None;
        }
    }
    Some(g0)
}

/// Aire de recouvrement (mm²) entre la matière d'une pièce (anneau externe
/// moins ses trous) et une zone, `None` si le calcul n'est pas fiable (voir
/// `guarded_overlap_closed` : à compter comme une violation).
pub fn material_zone_overlap(outer: &[Pt], holes: &[Vec<Pt>], zone: &[Pt]) -> Option<f64> {
    guarded_overlap_closed(&material_of(outer, holes), &material_of(zone, &[]))
}

/// Aire commune (mm²) à la matière de deux pièces (contour moins trous), avec
/// les trous des deux côtés. Aucun point témoin ne décide, donc ni le centre
/// d'une pièce en C ni un sommet posé sur un bord ne la trompent. `None` si le
/// calcul n'est pas fiable (voir `guarded_overlap_closed` : à compter comme un
/// recouvrement).
pub fn material_overlap(a: &(Vec<Pt>, Vec<Vec<Pt>>), b: &(Vec<Pt>, Vec<Vec<Pt>>)) -> Option<f64> {
    guarded_overlap_closed(&material_of(&a.0, &a.1), &material_of(&b.0, &b.1))
}

/// Distance (mm) entre la matière d'une pièce et une zone SANS recouvrement :
/// 0 si un bord croise celui de la zone, sinon min des distances de bords.
pub fn material_zone_distance(outer: &[Pt], holes: &[Vec<Pt>], zone: &[Pt]) -> f64 {
    let z = closed(zone);
    let pb = geom::ring_bounds(outer);
    let zedges = edges_of(&z);
    // Arêtes de zone qui touchent la boîte de la pièce, seules à pouvoir
    // croiser un bord de la pièce.
    let touching: Vec<&Edge> = zedges.iter().filter(|e| boxes_touch(&e.bx, &pb, 0.0)).collect();
    for ring in std::iter::once(outer).chain(holes.iter().map(|h| h.as_slice())) {
        for a in ring.windows(2) {
            for e in &touching {
                if geom::seg_seg_intersects(a[0], a[1], e.a, e.b) {
                    return 0.0;
                }
            }
        }
    }
    // Écart de bords (sommets d'un côté contre arêtes de l'autre), élagué :
    // les arêtes de zone sont vues par boîte croissante, et on s'arrête dès
    // que leur boîte est plus loin que le meilleur écart connu (une distance
    // n'est jamais inférieure à l'écart de boîtes ; marge flottante 1e-9).
    // Le minimum porte sur les mêmes valeurs qu'un balayage complet.
    let mut order: Vec<(f64, usize)> = zedges
        .iter()
        .enumerate()
        .map(|(i, e)| (box_gap(&pb, &e.bx), i))
        .collect();
    order.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap());
    let mut best = f64::INFINITY;
    for ring in std::iter::once(outer).chain(holes.iter().map(|h| h.as_slice())) {
        let redges = edges_of(ring);
        for &(g, i) in &order {
            if g > best * (1.0 + 1e-9) + 1e-9 {
                break;
            }
            let e = &zedges[i];
            for p in ring {
                best = best.min(geom::point_seg_dist(*p, e.a, e.b));
            }
            for v in [e.a, e.b] {
                for r in &redges {
                    best = best.min(geom::point_seg_dist(v, r.a, r.b));
                }
            }
        }
    }
    best
}

/// Résultat des contrôles de forme d'UNE tôle.
#[derive(Debug, Default, Clone)]
pub struct ShapeChecks {
    /// Pièces dont l'excursion hors du contour dépasse la tolérance.
    pub parts_outside: i64,
    /// Plus petit écart signé au contour (négatif = dépassement), mm.
    pub min_outline_gap: Option<f64>,
    /// Pièces qui recouvrent une zone interdite (aire > OVERLAP_EPS_MM2).
    pub zone_violations: i64,
    pub zone_overlap_area: f64,
    pub min_zone_gap: Option<f64>,
}

/// Contrôles de la tôle `sh` pour les pièces posées `placed` (externe, trous).
pub fn check_sheet(
    placed: &[(Vec<Pt>, Vec<Vec<Pt>>)],
    sh: &ReadyShape,
    overlap_eps_mm2: f64,
) -> ShapeChecks {
    check_sheet_with(placed, sh, overlap_eps_mm2, None)
}

/// `check_sheet` quand la distance au bord est réglée à part : un dépassement
/// du contour est admis jusqu'à `overhang` mm (0 si la distance est positive),
/// et l'écart au contour est SIGNÉ sans palier : `-profondeur` dès que la pièce
/// sort, la profondeur étant le maximum exact (`outside_depth_exact`), pas la
/// borne basse échantillonnée du rapport d'avant. Les zones interdites sont
/// jugées comme avant.
pub fn check_sheet_edge(
    placed: &[(Vec<Pt>, Vec<Vec<Pt>>)],
    sh: &ReadyShape,
    overlap_eps_mm2: f64,
    overhang: f64,
) -> ShapeChecks {
    check_sheet_with(placed, sh, overlap_eps_mm2, Some(overhang.max(0.0)))
}

fn check_sheet_with(
    placed: &[(Vec<Pt>, Vec<Vec<Pt>>)],
    sh: &ReadyShape,
    overlap_eps_mm2: f64,
    overhang: Option<f64>,
) -> ShapeChecks {
    let mut out = ShapeChecks::default();
    let mut best_outline = f64::INFINITY;
    let mut best_zone = f64::INFINITY;
    for (o, h) in placed {
        let ring = closed(o);
        let depth = match overhang {
            None => outside_depth(&ring, sh),
            Some(_) => outside_depth_exact(&ring, sh),
        };
        let gap = if let Some(over) = overhang {
            if depth > OUTLINE_TOL_MM + over {
                out.parts_outside += 1;
            }
            if depth > 0.0 { -depth } else { gap_to_outline(&ring, sh, best_outline) }
        } else if depth > OUTLINE_TOL_MM {
            out.parts_outside += 1;
            -depth
        } else if depth > 0.0 {
            // Dans la tolérance : pas un dépassement, mais le contact est nul.
            0.0
        } else {
            gap_to_outline(&ring, sh, best_outline)
        };
        if gap < best_outline {
            best_outline = gap;
        }
        if sh.zones.is_empty() {
            continue;
        }
        let pbox = geom::ring_bounds(&ring);
        let mut overlap_total = 0.0;
        let mut hit = false;
        for (z, zb) in sh.zones.iter().zip(sh.zone_boxes.iter()) {
            let g = box_gap(&pbox, zb);
            if g >= best_zone && g > 0.0 {
                continue;
            }
            // Aire non fiable (bords presque confondus) : violation, sans aire
            // ajoutée au total puisqu'on ne la connaît pas.
            let area = if g == 0.0 { material_zone_overlap(&ring, h, z) } else { Some(0.0) };
            if area.is_none_or(|a| a > overlap_eps_mm2) {
                hit = true;
                overlap_total += area.unwrap_or(0.0);
                best_zone = 0.0;
            } else if g < best_zone {
                let d = material_zone_distance(&ring, h, z);
                if d < best_zone {
                    best_zone = d;
                }
            }
        }
        if hit {
            out.zone_violations += 1;
            out.zone_overlap_area += overlap_total;
        }
    }
    if best_outline.is_finite() {
        out.min_outline_gap = Some(best_outline);
    }
    if best_zone.is_finite() {
        out.min_zone_gap = Some(best_zone);
    }
    out
}
