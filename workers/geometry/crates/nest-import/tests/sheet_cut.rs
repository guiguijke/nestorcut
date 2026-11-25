//! Découpe d'une tôle par des défauts (`nest_import::sheet_cut`) : cas exacts,
//! contacts, morceaux, refus, et comparaison aléatoire à la définition.

use nest_import::assemble::{Pt, ring_signed_area, ring_too_thin};
use nest_import::budget::Deadline;
use nest_import::sheet_cut::{
    MAX_SHIFT_MM, REPAIR_HALF_MM, SheetCut, SheetCutError, cut_sheet, cut_sheet_json,
};
use std::collections::HashSet;
use std::f64::consts::PI;
use std::time::Instant;

// ------------------------------------------------------------------ outils

fn cut(outer: &[Pt], holes: &[Vec<Pt>], defects: &[Vec<Pt>]) -> Result<SheetCut, SheetCutError> {
    cut_sheet(outer, holes, defects, &Deadline::unlimited())
}

fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Pt> {
    vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
}

/// Disque inscrit à `n` sommets, fermé, anti-horaire.
fn disc(cx: f64, cy: f64, r: f64, n: usize) -> Vec<Pt> {
    let mut out: Vec<Pt> = (0..n)
        .map(|i| {
            let t = 2.0 * PI * i as f64 / n as f64;
            [cx + r * t.cos(), cy + r * t.sin()]
        })
        .collect();
    out.push(out[0]);
    out
}

/// Le contour tel que le lecteur de tôle le rend : sur la grille 1e-4.
fn gridded(r: &[Pt]) -> Vec<Pt> {
    r.iter().map(|&p| nest_import::assemble::snap_pt(p)).collect()
}

fn open(r: &[Pt]) -> &[Pt] {
    if r.len() > 1 && r[0] == r[r.len() - 1] { &r[..r.len() - 1] } else { r }
}

fn area(r: &[Pt]) -> f64 {
    ring_signed_area(open(r)).abs()
}

fn bits(r: &[Pt]) -> Vec<(u64, u64)> {
    r.iter().map(|p| (p[0].to_bits(), p[1].to_bits())).collect()
}

fn assert_same_bits(a: &[Pt], b: &[Pt]) {
    assert_eq!(bits(a), bits(b));
}

fn vertex_set(r: &[Pt]) -> HashSet<(i64, i64)> {
    open(r).iter().map(|p| ((p[0] * 1e4).round() as i64, (p[1] * 1e4).round() as i64)).collect()
}

fn seg_dist(p: Pt, a: Pt, b: Pt) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    ((p[0] - a[0] - t * dx).powi(2) + (p[1] - a[1] - t * dy).powi(2)).sqrt()
}

fn ring_dist(p: Pt, r: &[Pt]) -> f64 {
    let r = open(r);
    (0..r.len()).map(|i| seg_dist(p, r[i], r[(i + 1) % r.len()])).fold(f64::INFINITY, f64::min)
}

/// Nombre d'enroulement.
fn winding(p: Pt, r: &[Pt]) -> i32 {
    let r = open(r);
    let mut w = 0;
    for i in 0..r.len() {
        let (a, b) = (r[i], r[(i + 1) % r.len()]);
        let side = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        if a[1] <= p[1] && b[1] > p[1] && side > 0.0 {
            w += 1;
        } else if a[1] > p[1] && b[1] <= p[1] && side < 0.0 {
            w -= 1;
        }
    }
    w
}

fn inside(p: Pt, r: &[Pt]) -> bool {
    winding(p, r) != 0
}

fn in_piece(p: Pt, outer: &[Pt], holes: &[Vec<Pt>]) -> bool {
    inside(p, outer) && !holes.iter().any(|h| inside(p, h))
}

// Prédicats entiers (unités de grille) pour le contrôle de propreté.
type I = [i64; 2];

fn ints(r: &[Pt]) -> Vec<I> {
    open(r).iter().map(|p| [(p[0] * 1e4).round() as i64, (p[1] * 1e4).round() as i64]).collect()
}

fn orient(a: I, b: I, c: I) -> i128 {
    (b[0] - a[0]) as i128 * (c[1] - a[1]) as i128 - (b[1] - a[1]) as i128 * (c[0] - a[0]) as i128
}

fn on_seg(a: I, b: I, c: I) -> bool {
    orient(a, b, c) == 0
        && c[0] >= a[0].min(b[0])
        && c[0] <= a[0].max(b[0])
        && c[1] >= a[1].min(b[1])
        && c[1] <= a[1].max(b[1])
}

fn touch(a: I, b: I, c: I, d: I) -> bool {
    let (o1, o2) = (orient(a, b, c).signum(), orient(a, b, d).signum());
    let (o3, o4) = (orient(c, d, a).signum(), orient(c, d, b).signum());
    (o1 * o2 < 0 && o3 * o4 < 0) || on_seg(a, b, c) || on_seg(a, b, d) || on_seg(c, d, a) || on_seg(c, d, b)
}

/// Anneaux fermés, anti-horaires, simples ; trous strictement dans le contour,
/// disjoints entre eux (aucun contact, même en un sommet).
fn assert_clean(outer: &[Pt], holes: &[Vec<Pt>], what: &str) {
    let rings: Vec<&[Pt]> = std::iter::once(outer).chain(holes.iter().map(|h| h.as_slice())).collect();
    let mut all: Vec<(usize, usize, I, I, usize)> = Vec::new();
    for (k, r) in rings.iter().enumerate() {
        assert!(r.len() >= 4, "{what}: anneau {k} trop court");
        assert_eq!(r[0], r[r.len() - 1], "{what}: anneau {k} ouvert");
        let p = ints(r);
        let n = p.len();
        // Sens : aire entière, exacte (une lame perdue fait 1e-8 mm²).
        let a2: i128 = (0..n)
            .map(|i| {
                let (a, b) = (p[i], p[(i + 1) % n]);
                a[0] as i128 * b[1] as i128 - b[0] as i128 * a[1] as i128
            })
            .sum();
        assert!(a2 > 0, "{what}: anneau {k} horaire");
        assert_eq!(p.iter().collect::<HashSet<_>>().len(), n, "{what}: anneau {k} repasse par un sommet");
        for i in 0..n {
            all.push((k, i, p[i], p[(i + 1) % n], n));
        }
    }
    all.sort_by_key(|e| e.2[0].min(e.3[0]));
    for (x, e) in all.iter().enumerate() {
        let right = e.2[0].max(e.3[0]);
        for g in &all[x + 1..] {
            if g.2[0].min(g.3[0]) > right {
                break;
            }
            if e.2[1].max(e.3[1]) < g.2[1].min(g.3[1]) || g.2[1].max(g.3[1]) < e.2[1].min(e.3[1]) {
                continue;
            }
            if e.0 == g.0 {
                let d = (e.1 + e.4 - g.1) % e.4;
                if d == 1 || d == e.4 - 1 {
                    continue;
                }
            }
            assert!(!touch(e.2, e.3, g.2, g.3), "{what}: arêtes {e:?} et {g:?} se touchent");
        }
    }
    for (k, h) in holes.iter().enumerate() {
        assert!(inside(h[0], outer), "{what}: trou {k} hors du contour");
        for (j, g) in holes.iter().enumerate() {
            assert!(j == k || !inside(h[0], g), "{what}: trou {k} dans le trou {j}");
        }
    }
}

/// Ce que le moteur refuse (`import_simple_polygon` puis `SPolygon::new`, f32,
/// repère de la tôle) : sommet en double, arêtes non voisines qui se touchent.
fn assert_engine_ring(ring: &[Pt], dx: f64, dy: f64, what: &str) {
    let mut p: Vec<[f32; 2]> =
        open(ring).iter().map(|v| [(v[0] - dx) as f32, (v[1] - dy) as f32]).collect();
    let near = |a: f32, b: f32| {
        a == b || (a - b).abs() <= f32::EPSILON || (a.to_bits() as i64 - b.to_bits() as i64).abs() <= 4
    };
    let n = p.len();
    let drop: Vec<bool> = (0..n)
        .map(|i| near(p[i][0], p[(i + 1) % n][0]) && near(p[i][1], p[(i + 1) % n][1]))
        .collect();
    let mut i = 0;
    p.retain(|_| {
        i += 1;
        !drop[i - 1]
    });
    let n = p.len();
    assert!(n >= 3, "{what}: anneau vide en f32");
    let set: HashSet<[u32; 2]> = p.iter().map(|v| v.map(f32::to_bits)).collect();
    assert_eq!(set.len(), n, "{what}: sommet en double en f32");
    let q: Vec<[f64; 2]> = p.iter().map(|v| [v[0] as f64, v[1] as f64]).collect();
    let o = |a: Pt, b: Pt, c: Pt| (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for i in 0..n {
        for j in i + 2..n {
            if i == 0 && j == n - 1 {
                continue;
            }
            let (a, b, c, d) = (q[i], q[i + 1], q[j], q[(j + 1) % n]);
            if a[0].max(b[0]) < c[0].min(d[0])
                || c[0].max(d[0]) < a[0].min(b[0])
                || a[1].max(b[1]) < c[1].min(d[1])
                || c[1].max(d[1]) < a[1].min(b[1])
            {
                continue;
            }
            let (s1, s2, s3, s4) = (o(a, b, c), o(a, b, d), o(c, d, a), o(c, d, b));
            assert!(
                s1 * s2 > 0.0 || s3 * s4 > 0.0,
                "{what}: arêtes {i} et {j} se touchent en f32"
            );
        }
    }
}

/// Toutes les garanties d'un résultat modifié.
fn check(c: &SheetCut, what: &str) {
    assert_clean(&c.outer, &c.holes, what);
    let net = area(&c.outer) - c.holes.iter().map(|h| area(h)).sum::<f64>();
    let tol = 1e-6 + 1e-9 * area(&c.outer);
    assert!((net - c.usable_area).abs() <= tol, "{what}: aire {} contre {net}", c.usable_area);
    assert!(c.max_shift <= MAX_SHIFT_MM, "{what}: écart {}", c.max_shift);
    let dx = c.outer.iter().fold(f64::INFINITY, |m, p| m.min(p[0]));
    let dy = c.outer.iter().fold(f64::INFINITY, |m, p| m.min(p[1]));
    assert_engine_ring(&c.outer, dx, dy, what);
    assert!(!ring_too_thin(&c.outer), "{what}: contour trop fin");
    for (k, h) in c.holes.iter().enumerate() {
        assert_engine_ring(h, dx, dy, what);
        assert!(!ring_too_thin(h), "{what}: trou {k} trop fin");
    }
}

/// Garanties des `hazards` (contour d'ORIGINE) et des morceaux perdus : chaque
/// anneau est fermé, anti-horaire, simple, lisible par le moteur dans le repère du
/// contour, jamais trop fin (une zone d'entrée rendue telle quelle est celle
/// d'avant), DANS le contour ; contour moins interdits = aire utile (l'aire que
/// jagua tire du conteneur) ; l'aire perdue est la somme des morceaux.
fn check_hazards(c: &SheetCut, outer: &[Pt], holes: &[Vec<Pt>], what: &str) {
    let dx = outer.iter().fold(f64::INFINITY, |m, p| m.min(p[0]));
    let dy = outer.iter().fold(f64::INFINITY, |m, p| m.min(p[1]));
    for (k, h) in c.hazards.iter().enumerate() {
        if holes.iter().any(|z| bits(z) == bits(h)) {
            continue;
        }
        let w = format!("{what}: interdit {k}");
        assert_clean(h, &[], &w);
        assert_engine_ring(h, dx, dy, &w);
        assert!(!ring_too_thin(h), "{w} trop fin");
    }
    // Écart de nodage ; un demi-pas de grille de plus là où une couronne est coupée.
    let slack = c.max_shift + 0.51e-4;
    let mut rim = open(outer).to_vec();
    rim.push(rim[0]);
    for (k, h) in c.hazards.iter().enumerate() {
        for w in h.windows(2) {
            for i in 0..4 {
                let t = i as f64 / 4.0;
                let p = [w[0][0] + t * (w[1][0] - w[0][0]), w[0][1] + t * (w[1][1] - w[0][1])];
                let d = ring_dist(p, &rim);
                assert!(inside(p, outer) || d <= slack, "{what}: interdit {k} dehors de {d} en {p:?}");
            }
        }
    }
    let total = area(outer) - c.hazards.iter().map(|h| area(h)).sum::<f64>();
    let tol = 1e-6 + 1e-9 * area(outer) + slack * perimeter(&rim);
    assert!((total - c.usable_area).abs() <= tol, "{what}: {total} contre {} ({tol})", c.usable_area);
    for (k, q) in c.lost_pieces.iter().enumerate() {
        assert_clean(&q.outer, &[], &format!("{what}: morceau perdu {k}"));
    }
    let lost: f64 = c.lost_pieces.iter().map(|q| area(&q.outer) - q.holes.iter().map(|h| area(h)).sum::<f64>()).sum();
    assert!((lost - c.lost_area).abs() <= 1e-6 + 1e-9 * area(outer), "{what}: perdu {} contre {lost}", c.lost_area);
}

/// Permis par la description du moteur : dans le contour d'origine, hors de tout
/// interdit.
fn engine_allows(p: Pt, outer: &[Pt], c: &SheetCut) -> bool {
    inside(p, outer) && !c.hazards.iter().any(|h| inside(p, h))
}

/// Arêtes communes à deux anneaux (sens opposés) : les coupures d'une couronne.
fn shared_edges(rings: &[Vec<Pt>]) -> usize {
    let mut seen: HashSet<[(u64, u64); 2]> = HashSet::new();
    let mut n = 0;
    for h in rings {
        for w in bits(h).windows(2) {
            n += seen.contains(&[w[1], w[0]]) as usize;
            seen.insert([w[0], w[1]]);
        }
    }
    n
}

/// Les deux descriptions sur une grille de points, hors des bords d'entrée.
fn assert_same_region(c: &SheetCut, outer: &[Pt], holes: &[Vec<Pt>], defects: &[Vec<Pt>], what: &str) {
    let b = outer.iter().fold([f64::MAX, f64::MAX, f64::MIN, f64::MIN], |b, p| {
        [b[0].min(p[0]), b[1].min(p[1]), b[2].max(p[0]), b[3].max(p[1])]
    });
    for i in 0..60 {
        for j in 0..60 {
            let p = [
                b[0] - 1.0 + (b[2] - b[0] + 2.0) * (i as f64 + 0.37) / 60.0,
                b[1] - 1.0 + (b[3] - b[1] + 2.0) * (j as f64 + 0.61) / 60.0,
            ];
            let near = std::iter::once(outer).chain(holes.iter().chain(defects).map(|r| r.as_slice()));
            if near.map(|r| ring_dist(p, r)).fold(f64::INFINITY, f64::min) <= TOL {
                continue;
            }
            assert_eq!(engine_allows(p, outer, c), in_piece(p, &c.outer, &c.holes), "{what}: {p:?}");
        }
    }
}

/// Point du tracé d'un défaut resté permis (dans la tôle, hors de tout interdit, ou
/// dans le morceau retenu) ; `TOL` : l'écart de nodage. Un tracé sans épaisseur ne se
/// voit pas à un point tiré au hasard : il se suit.
fn stroke_left(c: &SheetCut, outer: &[Pt], p: Pt) -> bool {
    let off = |r: &[Pt]| ring_dist(p, r) > TOL;
    inside(p, outer)
        && off(outer)
        && (c.hazards.iter().all(|h| !inside(p, h) && off(h))
            || (in_piece(p, &c.outer, &c.holes) && off(&c.outer) && c.holes.iter().all(|h| off(h))))
}

fn assert_strokes_forbidden(c: &SheetCut, outer: &[Pt], defects: &[Vec<Pt>], steps: usize, what: &str) {
    for d in defects {
        let r = open(d);
        for i in 0..r.len() {
            let (a, b) = (r[i], r[(i + 1) % r.len()]);
            for k in 0..steps {
                let t = (k as f64 + 0.37) / steps as f64;
                let p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
                assert!(!stroke_left(c, outer, p), "{what}: {p:?} du tracé est permis");
            }
        }
    }
}

fn perimeter(r: &[Pt]) -> f64 {
    r.windows(2).map(|w| ((w[1][0] - w[0][0]).powi(2) + (w[1][1] - w[0][1]).powi(2)).sqrt()).sum()
}

/// `original = utile + perdu + ôté`, à l'écart de nodage près (une arête
/// d'entrée déplacée de `max_shift` au plus).
fn check_areas(c: &SheetCut, original: f64, input_perimeter: f64, what: &str) {
    let sum = c.usable_area + c.lost_area + c.removed_area;
    let tol = 1e-6 + 1e-9 * original + c.max_shift * input_perimeter;
    assert!((sum - original).abs() <= tol, "{what}: {sum} contre {original} (tolérance {tol})");
}

/// L'éclat du vrai cas : polygone à main levée à cheval sur le bord du disque.
fn chip() -> Vec<Pt> {
    vec![[150.0, 70.0], [141.5, 74.2], [139.8, 79.9], [146.0, 86.3], [160.0, 88.0], [161.0, 68.0]]
}

// ------------------------------------------------------------ rien à ôter

#[test]
fn without_defect_the_rings_come_back_bit_identical() {
    // Coordonnées hors grille, sens horaire, zones qui se touchent : rien ne bouge.
    let outer = vec![[0.1 + 0.2, 1.0 / 3.0], [0.3, 100.7], [99.9, 100.1], [100.0, 0.0], [0.1 + 0.2, 1.0 / 3.0]];
    let holes = vec![rect(10.0, 10.0, 20.0, 20.0), rect(20.0, 10.0, 30.0, 20.0)];
    let c = cut(&outer, &holes, &[]).unwrap();
    assert!(!c.changed);
    assert_same_bits(&c.outer, &outer);
    assert_eq!(c.holes.len(), 2);
    for (a, b) in c.holes.iter().zip(&holes) {
        assert_same_bits(a, b);
    }
    assert_eq!((c.pieces, c.lost_area, c.removed_area), (1, 0.0, 0.0));
    assert!(c.lost_pieces.is_empty());
    assert_eq!(c.hazards.len(), 2);
    for (a, b) in c.hazards.iter().zip(&holes) {
        assert_same_bits(a, b);
    }
    assert!((c.usable_area - (area(&outer) - 200.0)).abs() < 1e-9);
    // Un anneau donné ouvert est fermé, sommets au bit près.
    let c = cut(&outer[..4], &[], &[]).unwrap();
    assert_same_bits(&c.outer, &outer);
}

#[test]
fn a_defect_that_removes_nothing_changes_nothing() {
    let outer = gridded(&disc(76.5, 76.5, 76.5, 128));
    let holes = vec![rect(60.0, 60.0, 80.0, 80.0)];
    let cases: Vec<(&str, Vec<Pt>)> = vec![
        ("loin dehors", rect(500.0, 500.0, 600.0, 600.0)),
        ("boîtes qui se croisent, formes disjointes", rect(0.0, 0.0, 5.0, 5.0)),
        ("dans une zone", rect(65.0, 65.0, 70.0, 70.0)),
        ("identique à une zone", holes[0].clone()),
        ("dans une zone, une arête commune", rect(60.0, 62.0, 70.0, 78.0)),
        ("boîte touchant le bord de dehors", rect(153.0, 0.0, 200.0, 153.0)),
    ];
    for (what, d) in cases {
        let c = cut(&outer, &holes, &[d]).unwrap();
        assert!(!c.changed, "{what}");
        assert_same_bits(&c.outer, &outer);
        assert_same_bits(&c.holes[0], &holes[0]);
        assert_eq!((c.pieces, c.lost_area, c.removed_area, c.repairs), (1, 0.0, 0.0, 0), "{what}");
        assert_eq!(c.hazards.len(), 1, "{what}");
        assert_same_bits(&c.hazards[0], &holes[0]);
    }
    // Rectangle : le défaut partage une arête entière, par dehors.
    let sheet = rect(0.0, 0.0, 100.0, 50.0);
    for d in [rect(100.0, 0.0, 120.0, 50.0), rect(100.0, 10.0, 120.0, 20.0), rect(20.0, 50.0, 30.0, 60.0)] {
        let c = cut(&sheet, &[], &[d]).unwrap();
        assert!(!c.changed);
        assert_same_bits(&c.outer, &sheet);
    }
}

// ------------------------------------------------------------- un trou

#[test]
fn a_defect_strictly_inside_is_one_more_hole_with_its_vertices() {
    let outer = gridded(&disc(76.5, 76.5, 76.5, 200));
    let zone = rect(60.0, 60.0, 80.0, 80.0);
    // Sommets hors grille : le trou a les mêmes, arrondis à 1e-4.
    let d = vec![[20.123456, 70.0], [30.98765, 69.5], [31.0, 80.00004], [25.0, 75.0], [19.99996, 81.0]];
    let c = cut(&outer, &[zone.clone()], &[d.clone()]).unwrap();
    check(&c, "défaut intérieur");
    assert!(c.changed);
    assert_eq!((c.pieces, c.repairs, c.lost_area), (1, 0, 0.0));
    assert_same_bits(&c.outer, &outer);
    assert_eq!(c.holes.len(), 2);
    assert_same_bits(&c.holes[0], &zone);
    assert_eq!(vertex_set(&c.holes[1]), vertex_set(&gridded(&d)));
    assert_eq!(open(&c.holes[1]).len(), d.len());
    assert!((c.removed_area - area(&gridded(&d))).abs() < 1e-9);
    check_areas(&c, area(&outer) - 400.0, perimeter(&outer) + 80.0, "défaut intérieur");
    assert!(c.max_shift > 0.0 && c.max_shift <= 0.70711e-4, "{}", c.max_shift);
}

#[test]
fn a_defect_containing_a_zone_replaces_it() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    let zones = vec![rect(40.0, 40.0, 50.0, 50.0), rect(70.0, 70.0, 80.0, 80.0)];
    let d = rect(35.0, 30.0, 55.0, 60.0);
    let c = cut(&sheet, &zones, &[d.clone()]).unwrap();
    check(&c, "défaut qui contient une zone");
    assert_eq!(c.holes.len(), 2);
    assert_same_bits(&c.holes[0], &zones[1]);
    assert_same_bits(&c.holes[1], &d);
    assert!((c.removed_area - 500.0).abs() < 1e-9);
    check_areas(&c, 10_000.0 - 200.0, 480.0, "défaut qui contient une zone");
}

#[test]
fn a_defect_identical_to_a_zone_beside_a_real_one() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    let zone = rect(40.0, 40.0, 50.0, 50.0);
    let c = cut(&sheet, &[zone.clone()], &[zone.clone(), rect(10.0, 10.0, 20.0, 20.0)]).unwrap();
    check(&c, "identique + un vrai");
    assert_eq!(c.holes.len(), 2);
    assert_same_bits(&c.holes[0], &zone);
    assert!((c.removed_area - 100.0).abs() < 1e-9);
}

#[test]
fn defects_that_overlap_or_share_an_edge_make_one_hole() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    let back = |r: Vec<Pt>| -> Vec<Pt> { r.into_iter().rev().collect() };
    let cases: Vec<(&str, Vec<Vec<Pt>>, f64, usize)> = vec![
        ("recouvrement", vec![rect(10.0, 10.0, 30.0, 30.0), rect(20.0, 20.0, 40.0, 40.0)], 700.0, 8),
        // Arête entière commune : les deux nœuds alignés disparaissent.
        ("arête commune", vec![rect(10.0, 10.0, 30.0, 30.0), rect(30.0, 10.0, 50.0, 30.0)], 800.0, 4),
        ("arête partielle", vec![rect(10.0, 10.0, 30.0, 30.0), rect(30.0, 15.0, 50.0, 25.0)], 600.0, 8),
        ("deux fois le même", vec![rect(10.0, 10.0, 30.0, 30.0), rect(10.0, 10.0, 30.0, 30.0)], 400.0, 4),
        ("l'un dans l'autre", vec![rect(10.0, 10.0, 30.0, 30.0), rect(15.0, 15.0, 20.0, 20.0)], 400.0, 4),
        // Sens opposés : la règle non nulle est PAR défaut, rien ne s'annule.
        ("sens opposés", vec![rect(10.0, 10.0, 30.0, 30.0), back(rect(20.0, 20.0, 40.0, 40.0))], 700.0, 8),
    ];
    for (what, defects, removed, n) in cases {
        let c = cut(&sheet, &[], &defects).unwrap();
        check(&c, what);
        assert_eq!((c.holes.len(), c.pieces, c.repairs), (1, 1, 0), "{what}");
        assert!((c.removed_area - removed).abs() < 1e-9, "{what}: {}", c.removed_area);
        assert_eq!(open(&c.holes[0]).len(), n, "{what}: {:?}", c.holes[0]);
        assert_same_bits(&c.outer, &sheet);
    }
}

#[test]
fn a_defect_and_a_zone_sharing_an_edge_make_one_hole() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    let zones = vec![rect(40.0, 40.0, 60.0, 60.0), rect(5.0, 5.0, 8.0, 8.0)];
    let c = cut(&sheet, &zones, &[rect(60.0, 45.0, 70.0, 50.0)]).unwrap();
    check(&c, "zone et défaut");
    assert_eq!(c.holes.len(), 2);
    assert_same_bits(&c.holes[0], &zones[1]);
    assert!((area(&c.holes[1]) - 450.0).abs() < 1e-9);
}

// ----------------------------------------------------------- bord du contour

#[test]
fn a_defect_crossing_the_outline_is_a_notch() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    let c = cut(&sheet, &[], &[rect(90.0, 40.0, 120.0, 60.0)]).unwrap();
    check(&c, "encoche");
    assert_eq!((c.holes.len(), c.pieces, c.repairs), (0, 1, 0));
    assert!((c.usable_area - 9_800.0).abs() < 1e-9);
    assert!((c.removed_area - 200.0).abs() < 1e-9);
    assert_eq!(open(&c.outer).len(), 8);
    assert_eq!(c.max_shift, 0.0);
}

#[test]
fn a_defect_edge_collinear_with_the_outline_is_a_notch() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    // Dedans, posé sur le bord ; dans le coin ; du haut en bas du bord droit.
    for (d, n, net) in [
        (rect(80.0, 40.0, 100.0, 60.0), 8, 9_600.0),
        (rect(80.0, 80.0, 100.0, 100.0), 6, 9_600.0),
        (rect(80.0, 0.0, 100.0, 100.0), 4, 8_000.0),
    ] {
        let c = cut(&sheet, &[], &[d]).unwrap();
        check(&c, "arête sur le bord");
        assert_eq!((c.holes.len(), c.pieces, c.repairs), (0, 1, 0));
        assert_eq!(open(&c.outer).len(), n);
        assert!((c.usable_area - net).abs() < 1e-9);
    }
    // Bord en biais : (0,0)-(300,100), défaut posé dessus.
    let sheet = vec![[0.0, 0.0], [300.0, 100.0], [0.0, 200.0]];
    let d = vec![[30.0, 10.0], [90.0, 30.0], [80.0, 60.0]];
    let c = cut(&sheet, &[], &[d.clone()]).unwrap();
    check(&c, "bord en biais");
    assert_eq!((c.holes.len(), c.pieces, c.repairs), (0, 1, 0));
    assert!((c.removed_area - area(&d)).abs() < 1e-6);
    // Bord en biais au tiers de grille : les sommets du défaut sont à une
    // fraction de grille du bord, ils s'y collent (pixel chaud).
    let sheet = vec![[0.0, 0.0], [100.0, 33.3333], [0.0, 200.0]];
    let d = vec![[10.0, 3.3333], [70.0, 23.3333], [20.0, 60.0]];
    let c = cut(&sheet, &[], &[d]).unwrap();
    check(&c, "bord en biais au tiers");
    assert_eq!((c.holes.len(), c.pieces, c.repairs), (0, 1, 0));
}

#[test]
fn a_defect_vertex_on_the_outline_is_welded_on_the_safe_side() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    let d = vec![[100.0, 50.0], [80.0, 60.0], [80.0, 40.0]];
    let c = cut(&sheet, &[], &[d.clone()]).unwrap();
    check(&c, "sommet sur le bord");
    // Un seul anneau : le trou est soudé au bord, en n'ôtant que de la tôle.
    assert_eq!((c.holes.len(), c.pieces, c.repairs), (0, 1, 1));
    let weld = (2.0 * REPAIR_HALF_MM).powi(2);
    assert!(c.removed_area > 200.0 && c.removed_area <= 200.0 + weld, "{}", c.removed_area);
    for p in [[99.9, 50.0], [80.0001, 50.0], [90.0, 54.9], [99.95, 50.05]] {
        assert!(!in_piece(p, &c.outer, &c.holes), "{p:?} permis");
    }
    // Le même, sommet à l'intérieur d'une arête en biais.
    let sheet = vec![[0.0, 0.0], [300.0, 100.0], [0.0, 200.0]];
    let d = vec![[150.0, 50.0], [100.0, 90.0], [90.0, 80.0]];
    let c = cut(&sheet, &[], &[d]).unwrap();
    check(&c, "sommet sur un bord en biais");
    assert_eq!((c.holes.len(), c.pieces, c.repairs), (0, 1, 1));
}

#[test]
fn a_tangent_circle_is_welded_whichever_side_it_touches() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    // Tangent dedans : sommet du polygone exactement en (100, 50).
    let mut d = disc(90.0, 50.0, 10.0, 64);
    d[0] = [100.0, 50.0];
    d[64] = d[0];
    let c = cut(&sheet, &[], &[d.clone()]).unwrap();
    check(&c, "cercle tangent dedans");
    // L'arête du polygone quitte le bord à 2,8° : la portion qui en reste à moins
    // de 0,01 mm (0,2 mm) est soudée avec le contact.
    assert_eq!((c.holes.len(), c.pieces), (0, 1));
    assert!(c.repairs >= 1 && c.removed_area - area(&d) < 0.25, "{}", c.removed_area - area(&d));
    // Tangent dehors : rien n'est ôté.
    let mut d = disc(110.0, 50.0, 10.0, 64);
    d[32] = [100.0, 50.0];
    let c = cut(&sheet, &[], &[d]).unwrap();
    assert!(!c.changed);
    assert_same_bits(&c.outer, &sheet);
    // Tangent à une zone : un seul trou.
    let mut d = disc(30.0, 50.0, 10.0, 64);
    d[0] = [40.0, 50.0];
    d[64] = d[0];
    let c = cut(&sheet, &[rect(40.0, 40.0, 60.0, 60.0)], &[d]).unwrap();
    check(&c, "cercle tangent à une zone");
    assert_eq!((c.holes.len(), c.pieces), (1, 1));
    // Deux défauts qui se touchent par un sommet : un seul trou.
    let c = cut(&sheet, &[], &[rect(10.0, 10.0, 20.0, 20.0), rect(20.0, 20.0, 30.0, 30.0)]).unwrap();
    check(&c, "coin à coin");
    assert_eq!((c.holes.len(), c.pieces, c.repairs), (1, 1, 1));
    // Quatre contacts : le losange inscrit coupe la tôle en quatre coins.
    let c = cut(&sheet, &[], &[vec![[50.0, 0.0], [100.0, 50.0], [50.0, 100.0], [0.0, 50.0]]]).unwrap();
    check(&c, "losange inscrit");
    assert_eq!((c.holes.len(), c.pieces, c.repairs), (0, 4, 0));
    assert!((c.usable_area - 1250.0).abs() < 1e-9 && (c.lost_area - 3750.0).abs() < 1e-9);
}

// ------------------------------------------------------------- morceaux

#[test]
fn a_cut_in_two_keeps_the_larger_piece() {
    let sheet = rect(0.0, 0.0, 100.0, 50.0);
    let c = cut(&sheet, &[rect(80.0, 20.0, 85.0, 25.0)], &[rect(60.0, -5.0, 62.0, 55.0)]).unwrap();
    check(&c, "coupe en deux");
    assert_eq!((c.pieces, c.holes.len(), c.repairs), (2, 0, 0));
    assert!((c.usable_area - 3_000.0).abs() < 1e-9);
    assert!((c.lost_area - (38.0 * 50.0 - 25.0)).abs() < 1e-9);
    assert!((c.removed_area - 100.0).abs() < 1e-9);
    assert_eq!(vertex_set(&c.outer), vertex_set(&rect(0.0, 0.0, 60.0, 50.0)));
    // L'aire NETTE décide : une grande zone dans le grand morceau inverse le choix.
    let c = cut(&sheet, &[rect(1.0, 1.0, 59.0, 49.0)], &[rect(60.0, -5.0, 62.0, 55.0)]).unwrap();
    assert!((c.usable_area - 38.0 * 50.0).abs() < 1e-9);
    assert_eq!((c.pieces, c.holes.len()), (2, 0));
}

#[test]
fn a_cut_in_three_counts_three_pieces() {
    let sheet = rect(0.0, 0.0, 100.0, 50.0);
    let defects = vec![rect(30.0, 0.0, 31.0, 50.0), rect(70.0, -1.0, 71.0, 51.0)];
    let c = cut(&sheet, &[], &defects).unwrap();
    check(&c, "coupe en trois");
    assert_eq!(c.pieces, 3);
    assert!((c.usable_area - 39.0 * 50.0).abs() < 1e-9);
    assert!((c.lost_area - (30.0 + 29.0) * 50.0).abs() < 1e-9);
    check_areas(&c, 5_000.0, 300.0, "coupe en trois");
}

#[test]
fn an_island_inside_a_ring_of_defects_is_another_piece() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    // Cadre de quatre bandes : l'îlot du milieu est perdu, le trou le couvre.
    let defects = vec![
        rect(20.0, 20.0, 80.0, 25.0),
        rect(20.0, 75.0, 80.0, 80.0),
        rect(20.0, 20.0, 25.0, 80.0),
        rect(75.0, 20.0, 80.0, 80.0),
    ];
    let c = cut(&sheet, &[], &defects).unwrap();
    check(&c, "cadre");
    assert_eq!((c.pieces, c.holes.len(), c.repairs), (2, 1, 0));
    assert!((area(&c.holes[0]) - 3_600.0).abs() < 1e-9);
    assert!((c.lost_area - 2_500.0).abs() < 1e-9);
    // L'îlot plus grand que le reste : c'est lui qui est gardé.
    let defects = vec![
        rect(2.0, 2.0, 98.0, 3.0),
        rect(2.0, 97.0, 98.0, 98.0),
        rect(2.0, 2.0, 3.0, 98.0),
        rect(97.0, 2.0, 98.0, 98.0),
    ];
    let c = cut(&sheet, &[], &defects).unwrap();
    assert!((c.usable_area - 94.0 * 94.0).abs() < 1e-9);
    assert_eq!((c.pieces, c.holes.len()), (2, 0));
}

#[test]
fn equal_pieces_are_chosen_the_same_way_every_time() {
    let sheet = rect(0.0, 0.0, 101.0, 50.0);
    let d = rect(50.0, -5.0, 51.0, 55.0);
    let a = cut(&sheet, &[], &[d.clone()]).unwrap();
    assert_eq!(vertex_set(&a.outer), vertex_set(&rect(0.0, 0.0, 50.0, 50.0)));
    for _ in 0..20 {
        let b = cut(&sheet, &[], &[d.clone()]).unwrap();
        assert_same_bits(&a.outer, &b.outer);
    }
}

// -------------------------------------- interdits sur le contour d'origine

#[test]
fn hazards_are_clipped_by_the_outline() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    let zones = vec![rect(10.0, 10.0, 20.0, 20.0), rect(70.0, 70.0, 80.0, 80.0)];
    let over = rect(90.0, 40.0, 120.0, 60.0);
    let inner = rect(40.0, 40.0, 50.0, 45.0);
    // Deux zones intactes au bit près, puis le défaut du bord coupé, puis l'autre.
    let defects = vec![inner.clone(), over.clone()];
    let c = cut(&sheet, &zones, &defects).unwrap();
    check(&c, "bord et dedans");
    check_hazards(&c, &sheet, &zones, "bord et dedans");
    assert_same_region(&c, &sheet, &zones, &defects, "bord et dedans");
    assert_eq!(c.hazards.len(), 4);
    let clipped = rect(90.0, 40.0, 100.0, 60.0);
    for (a, b) in c.hazards.iter().zip([&zones[0], &zones[1], &clipped, &inner]) {
        assert_same_bits(a, b);
    }
    // Une zone d'entrée horaire, partie d'ailleurs, à un flou de translation près :
    // rendue telle quelle dans les deux descriptions.
    let odd = vec![[20.0, 20.0], [20.0, 10.000000000000002], [10.0, 10.0], [10.0, 20.0], [20.0, 20.0]];
    let c = cut(&sheet, &[odd.clone()], &[inner.clone()]).unwrap();
    assert_same_bits(&c.holes[0], &odd);
    assert_same_bits(&c.hazards[0], &odd);
    // Un défaut qui mord une zone et sort de la tôle : un seul interdit.
    let bite = rect(75.0, 75.0, 110.0, 78.0);
    let c = cut(&sheet, &zones, &[bite.clone()]).unwrap();
    check_hazards(&c, &sheet, &zones, "mord une zone");
    assert_same_region(&c, &sheet, &zones, &[bite], "mord une zone");
    assert_eq!(c.hazards.len(), 2);
    assert_same_bits(&c.hazards[0], &zones[0]);
    assert!((area(&c.hazards[1]) - (100.0 + 20.0 * 3.0)).abs() < 1e-9);
    // Un éclat qui emporte le COIN : l'interdit reprend le coin du contour.
    let corner = vec![[85.0, 110.0], [88.0, 93.0], [95.0, 86.0], [112.0, 80.0], [115.0, 115.0]];
    let c = cut(&sheet, &[], &[corner.clone()]).unwrap();
    check(&c, "coin");
    check_hazards(&c, &sheet, &[], "coin");
    assert_same_region(&c, &sheet, &[], &[corner], "coin");
    assert_eq!((c.hazards.len(), c.pieces), (1, 1));
    assert!(c.hazards[0].contains(&[100.0, 100.0]));
    // Une bande entière le long d'un côté : l'interdit a ce côté en commun avec le
    // contour, aux mêmes sommets.
    for band in [rect(0.0, 0.0, 100.0, 4.0), rect(-5.0, -5.0, 105.0, 4.0), rect(96.0, -1.0, 110.0, 101.0)] {
        let c = cut(&sheet, &[], &[band.clone()]).unwrap();
        check(&c, "bande");
        check_hazards(&c, &sheet, &[], "bande");
        assert_same_region(&c, &sheet, &[], &[band], "bande");
        assert_eq!((c.hazards.len(), c.holes.len(), open(&c.hazards[0]).len()), (1, 0, 4));
        assert_eq!(area(&c.hazards[0]), 400.0);
        assert_eq!(vertex_set(&c.hazards[0]).intersection(&vertex_set(&sheet)).count(), 2);
    }
}

#[test]
fn a_hazard_that_does_not_enter_the_sheet_is_left_out() {
    // Dans la boîte du disque mais hors du disque ; à cheval sur un autre, dehors.
    let outer = gridded(&disc(76.5, 76.5, 76.5, 360));
    let corner = rect(0.0, 0.0, 10.0, 10.0);
    let touching = rect(-5.0, 8.0, 12.0, 12.0);
    let defects = vec![corner, touching, chip()];
    let c = cut(&outer, &[], &defects).unwrap();
    check_hazards(&c, &outer, &[], "coin hors du disque");
    assert_eq!(c.hazards.len(), 1);
    // Les sommets de l'éclat qui sont dans la tôle, les deux points où il coupe le
    // contour, et les sommets du contour entre les deux (au bit près).
    let mut shut = chip();
    shut.push(shut[0]);
    let rim: HashSet<(u64, u64)> = bits(&outer).into_iter().collect();
    let mut on_rim = 0;
    for p in open(&c.hazards[0]) {
        on_rim += rim.contains(&(p[0].to_bits(), p[1].to_bits())) as usize;
        assert!(ring_dist(*p, &shut) <= 1e-4 || rim.contains(&(p[0].to_bits(), p[1].to_bits())), "{p:?}");
    }
    assert!(on_rim > 10, "{on_rim}");
    for v in &chip()[1..4] {
        assert!(vertex_set(&c.hazards[0]).is_superset(&vertex_set(&[*v])));
    }
    // Deux défauts qui se touchent en un sommet HORS de la tôle : rien du second.
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    let defects = vec![rect(90.0, 40.0, 120.0, 60.0), rect(120.0, 60.0, 130.0, 70.0)];
    let c = cut(&sheet, &[], &defects).unwrap();
    check_hazards(&c, &sheet, &[], "défaut dehors");
    assert_eq!(c.hazards.len(), 1);
    assert_same_bits(&c.hazards[0], &rect(90.0, 40.0, 100.0, 60.0));
}

#[test]
fn lost_pieces_are_merged_into_the_hazards() {
    let sheet = rect(0.0, 0.0, 100.0, 50.0);
    let zone = rect(80.0, 20.0, 85.0, 25.0);
    let bar = rect(60.0, -5.0, 62.0, 55.0);
    let c = cut(&sheet, &[zone.clone()], &[bar.clone()]).unwrap();
    check_hazards(&c, &sheet, &[zone.clone()], "coupe en deux");
    assert_same_region(&c, &sheet, &[zone.clone()], &[bar.clone()], "coupe en deux");
    // Le morceau perdu garde sa zone ; l'interdit réunit barre, morceau et zone.
    assert_eq!((c.lost_pieces.len(), c.lost_pieces[0].holes.len(), c.hazards.len()), (1, 1, 1));
    assert_eq!(vertex_set(&c.lost_pieces[0].outer), vertex_set(&rect(62.0, 0.0, 100.0, 50.0)));
    assert_same_bits(&c.lost_pieces[0].holes[0], &zone);
    assert_same_bits(&c.hazards[0], &rect(60.0, 0.0, 100.0, 50.0));
    // Coupe en trois : deux morceaux perdus, rangés par aire.
    let defects = vec![rect(30.0, 0.0, 31.0, 50.0), rect(70.0, -1.0, 71.0, 51.0)];
    let c = cut(&sheet, &[], &defects).unwrap();
    check_hazards(&c, &sheet, &[], "coupe en trois");
    assert_same_region(&c, &sheet, &[], &defects, "coupe en trois");
    assert_eq!((c.lost_pieces.len(), c.hazards.len()), (2, 2));
    assert!((area(&c.lost_pieces[0].outer) - 1500.0).abs() < 1e-9);
    // Une lame perdue (trop fine pour le moteur) disparaît dans l'interdit.
    let blade = rect(90.0, -1.0, 99.95, 51.0);
    let c = cut(&sheet, &[], &[blade.clone()]).unwrap();
    check_hazards(&c, &sheet, &[], "lame");
    assert_same_region(&c, &sheet, &[], &[blade], "lame");
    assert_eq!((c.pieces, c.lost_pieces.len(), c.hazards.len()), (1, 1, 1));
    // L'îlot d'un cadre, plus petit que le reste : bouché dans l'interdit.
    let frame = |a: f64, b: f64, t: f64| {
        vec![
            rect(a, a, b, a + t),
            rect(a, b - t, b, b),
            rect(a, a, a + t, b),
            rect(b - t, a, b, b),
        ]
    };
    let big = rect(0.0, 0.0, 100.0, 100.0);
    let c = cut(&big, &[], &frame(20.0, 80.0, 5.0)).unwrap();
    check_hazards(&c, &big, &[], "îlot perdu");
    assert_same_region(&c, &big, &[], &frame(20.0, 80.0, 5.0), "îlot perdu");
    assert_eq!((c.lost_pieces.len(), c.hazards.len()), (1, 1));
    assert!((area(&c.hazards[0]) - 3_600.0).abs() < 1e-9);
}

#[test]
fn a_kept_piece_surrounded_by_hazards_gives_two_simple_rings() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    let frame = |a: f64, b: f64, t: f64| {
        vec![
            rect(a, a, b, a + t),
            rect(a, b - t, b, b),
            rect(a, a, a + t, b),
            rect(b - t, a, b, b),
        ]
    };
    // L'îlot du cadre est le plus grand ; un défaut de plus dedans.
    let mut inside_one = frame(2.0, 98.0, 1.0);
    inside_one.push(disc(50.0, 50.0, 8.0, 24));
    // Le cadre déborde de la tôle de tous les côtés ; cadre fait d'un seul
    // polygone (anneau à fente de largeur nulle) ; losange dans un cadre tourné.
    let keyhole = vec![
        [-10.0, -10.0], [110.0, -10.0], [110.0, 110.0], [-10.0, 110.0], [-10.0, -10.0],
        [5.0, 5.0], [5.0, 95.0], [95.0, 95.0], [95.0, 5.0], [5.0, 5.0],
    ];
    let ring = {
        let mut r = disc(50.0, 50.0, 80.0, 64);
        r.extend(disc(50.0, 50.0, 40.0, 48).into_iter().rev());
        r
    };
    let tilted: Vec<Vec<Pt>> = (0..6)
        .map(|i| {
            let t = i as f64 * PI / 3.0 + 0.3;
            disc(50.0 + 48.0 * t.cos(), 50.0 + 48.0 * t.sin(), 27.0, 40)
        })
        .collect();
    let cases: Vec<(&str, Vec<Vec<Pt>>)> = vec![
        ("îlot gardé", inside_one),
        ("cadre débordant", frame(-5.0, 105.0, 12.0)),
        ("trou de serrure", vec![keyhole]),
        ("couronne", vec![ring]),
        ("six disques", tilted),
        ("cadre de 0,2 mm au bord", frame(0.0, 100.0, 0.2)),
    ];
    for (what, defects) in cases {
        let c = cut(&sheet, &[], &defects).unwrap();
        check(&c, what);
        check_hazards(&c, &sheet, &[], what);
        assert_same_region(&c, &sheet, &[], &defects, what);
        // Les deux plus grands sont les moitiés, jointes : aucun jour le long des
        // deux coupures (mêmes sommets dans les deux anneaux).
        assert!(c.hazards.len() >= 2, "{what}");
        assert_eq!(shared_edges(&c.hazards[..2]), 2, "{what}");
        // Le long des coupures, des deux côtés : interdit.
        for w in c.hazards[0].windows(2) {
            if w[0][0] == w[1][0] && c.hazards[1].contains(&w[0]) && c.hazards[1].contains(&w[1]) {
                for k in 0..20 {
                    let y = w[0][1] + (w[1][1] - w[0][1]) * (k as f64 + 0.5) / 20.0;
                    for e in [-1e-6, 1e-6] {
                        assert!(!engine_allows([w[0][0] + e, y], &sheet, &c), "{what}");
                    }
                }
            }
        }
    }
    // Grande tôle (10 m), couronne dont le bord et la poche se touchent à un pas de
    // grille : le sommet commun est soudé, que le f32 (1e-3 mm) le voie ou non.
    let wide = rect(0.0, 0.0, 10_000.0, 6_000.0);
    let touch_up = vec![
        rect(-5.0, -5.0, 10_005.0, 20.0),
        rect(-5.0, 5_980.0, 10_005.0, 6_005.0),
        rect(-5.0, -5.0, 20.0, 6_005.0),
        vec![[9_980.0, -5.0], [10_005.0, -5.0], [10_005.0, 2_999.9999], [9_980.0, 2_999.9999]],
        vec![[10_005.0, 3_000.0], [10_005.0, 6_005.0], [9_980.0, 6_005.0], [9_980.0, 3_000.0]],
        vec![[9_990.0, 2_999.9999], [9_990.0001, 2_999.9999], [9_990.0001, 3_000.0], [9_990.0, 3_000.0]],
    ];
    let c = cut(&wide, &[], &touch_up).unwrap();
    check(&c, "couronne pincée");
    check_hazards(&c, &wide, &[], "couronne pincée");
    assert_same_region(&c, &wide, &[], &touch_up, "couronne pincée");
    // Un sommet de la poche posé au milieu d'une arête droite du bord (cas trouvé
    // par tirage) : le contact n'est un sommet du bord que dans la boucle brute.
    let tall = rect(0.0, 0.0, 856.0, 2280.0);
    let found = vec![
        vec![[599.1891601115666, 798.0131195454313], [510.94198713299124, 798.0000195205123]],
        vec![
            [856.0, 1139.999991314711],
            [591.8308160802181, 949.2528003520731],
            [556.4000000000001, 570.0013068998101],
            [0.0, -0.0001],
            [9.171745274606764, 1891.120071950742],
            [856.0011593411497, 0.00030000000000000003],
            [91.07291888008059, 1534.2621403729709],
            [742.97933848825, 290.6970117479972],
            [856.0, 2280.0],
        ],
        vec![
            [699.5625142588485, 122.03821535458275],
            [237.04224459914417, 49.403000771895336],
            [855.9999862729844, 2280.0001],
            [9.171739506862533, 1891.120071950742],
        ],
    ];
    let c = cut(&tall, &[], &found).unwrap();
    check(&c, "poche posée sur le bord");
    check_hazards(&c, &tall, &[], "poche posée sur le bord");
    assert_same_region(&c, &tall, &[], &found, "poche posée sur le bord");
    // Cadre de 0,02 mm au bord : trop fin, épaissi avant d'être coupé.
    let thin = frame(0.0, 100.0, 0.02);
    let c = cut(&sheet, &[], &thin).unwrap();
    check(&c, "cadre fin");
    check_hazards(&c, &sheet, &[], "cadre fin");
    assert_same_region(&c, &sheet, &[], &thin, "cadre fin");
    assert!(c.repairs > 0);
}

/// Le moteur gonfle chaque interdit seul : un C presque fermé autour de la tôle
/// gardée se refermerait. Ses deux pointes finissent dans des anneaux différents.
#[test]
fn an_almost_closed_ring_of_hazards_is_split() {
    let round = gridded(&disc(0.0, 0.0, 76.5, 194));
    // Bande à main levée de l'angle `a` à l'angle `b`, à cheval sur le bord.
    let band = |a: f64, b: f64| -> Vec<Pt> {
        let arc = |r: f64| (0..=24).map(move |i| a + (b - a) * i as f64 / 24.0).map(move |t| [r * t.cos(), r * t.sin()]);
        arc(82.0).chain(arc(66.0).collect::<Vec<Pt>>().into_iter().rev()).collect()
    };
    let at = |r: f64, t: f64| [r * t.cos(), r * t.sin()];
    let room = rect(0.0, 0.0, 200.0, 150.0);
    let mut cases: Vec<(String, Vec<Pt>, Vec<Vec<Pt>>, [Pt; 2], usize)> = Vec::new();
    for deg in [0.0f64, 45.0, 90.0, 180.0, 225.0, 270.0] {
        for gap in [0.05, 1.0, 2.5] {
            let (t, g) = (deg * PI / 180.0, gap / 66.0);
            let cuts = if deg == 90.0 || deg == 270.0 { 1 } else { 2 };
            let tips = [at(70.0, t + 0.02), at(70.0, t - g - 0.02)];
            cases.push((format!("C ouvert à {deg}°, {gap} mm"), round.clone(), vec![band(t, t + 2.0 * PI - g)], tips, cuts));
        }
    }
    let sides = [rect(-2.0, -2.0, 10.0, 152.0), rect(-2.0, -2.0, 202.0, 10.0), rect(190.0, -2.0, 202.0, 152.0)];
    for g in [0.5, 1.5] {
        let mut d = sides.to_vec();
        d.push(rect(-2.0, 140.0, 190.0 - g, 152.0));
        cases.push((format!("cadre manqué de {g}"), room.clone(), d, [[188.0, 145.0], [191.0, 145.0]], 1));
    }
    // Deux demi-bandes, une jonction manquée.
    let halves = vec![band(0.0, PI + 0.05), band(PI - 0.05, 2.0 * PI - 1.0 / 66.0)];
    cases.push(("deux demi-bandes".into(), round.clone(), halves, [at(70.0, 0.02), at(70.0, -0.04)], 2));
    for (what, outer, defects, tips, cuts) in &cases {
        let c = cut(outer, &[], defects).unwrap();
        check(&c, what);
        check_hazards(&c, outer, &[], what);
        assert_same_region(&c, outer, &[], defects, what);
        assert_strokes_forbidden(&c, outer, defects, 20, what);
        assert_eq!((c.repairs, c.hazards.len(), shared_edges(&c.hazards)), (0, cuts + 1, *cuts), "{what}");
        let holder = |p: Pt| c.hazards.iter().position(|h| inside(p, h)).unwrap_or_else(|| panic!("{what}: {p:?}"));
        assert_ne!(holder(tips[0]), holder(tips[1]), "{what}");
        // Aucun jour le long des coupures (verticales, communes à deux anneaux).
        for (i, h) in c.hazards.iter().enumerate() {
            for w in h.windows(2).filter(|w| w[0][0] == w[1][0]) {
                if c.hazards.iter().enumerate().any(|(j, q)| j != i && q.contains(&w[0]) && q.contains(&w[1])) {
                    for k in 0..20 {
                        let y = w[0][1] + (w[1][1] - w[0][1]) * (k as f64 + 0.5) / 20.0;
                        for e in [-1e-6, 1e-6] {
                            assert!(!engine_allows([w[0][0] + e, y], outer, &c), "{what}");
                        }
                    }
                }
            }
        }
    }
    // Rien à couper : le haut et le bas de la tôle gardée sont sur le contour.
    let d = vec![rect(-5.0, 120.0, 205.0, 160.0), disc(0.0, 60.0, 12.0, 30)];
    let c = cut(&room, &[], &d).unwrap();
    check_hazards(&c, &room, &[], "bande et éclat");
    assert_eq!((c.hazards.len(), shared_edges(&c.hazards)), (2, 0));
    // Une moitié trop fine pour le moteur : la coupe n'est pas faite.
    let sliver = vec![vec![[-5.0, 160.0], [-5.0, 120.0], [0.03, 130.0], [205.0, 100.0], [205.0, 160.0]]];
    let c = cut(&room, &[], &sliver).unwrap();
    check_hazards(&c, &room, &[], "moitié fine");
    assert_eq!((c.hazards.len(), c.repairs), (1, 0));
    // Une zone du dessin, intacte, ressort telle quelle.
    let zone = vec![[0.0, 150.0], [0.0, 120.0], [90.0, 140.0], [200.0, 110.0], [200.0, 150.0], [0.0, 150.0]];
    let c = cut(&room, &[zone.clone()], &[disc(60.0, 60.0, 9.0, 30)]).unwrap();
    check_hazards(&c, &room, &[zone.clone()], "zone");
    assert_eq!(c.hazards.len(), 2);
    assert_same_bits(&c.hazards[0], &zone);
}

#[test]
fn a_thin_hazard_astride_the_outline_is_widened_for_the_engine() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    // 0,05 mm de large : une encoche que le contour porte, mais un polygone que le
    // moteur refuserait.
    let d = vec![rect(-20.0, 50.0, 40.0, 50.05)];
    let c = cut(&sheet, &[], &d).unwrap();
    check(&c, "fente à cheval");
    check_hazards(&c, &sheet, &[], "fente à cheval");
    assert_same_region(&c, &sheet, &[], &d, "fente à cheval");
    assert_eq!(c.hazards.len(), 1);
    assert!(c.repairs > 0);
    assert!(!ring_too_thin(&c.hazards[0]));
    // Un trait sans aire à cheval sur le bord.
    let d = vec![vec![[-20.0, 30.0], [40.0, 35.0]]];
    let c = cut(&sheet, &[], &d).unwrap();
    check_hazards(&c, &sheet, &[], "trait à cheval");
    assert_same_region(&c, &sheet, &[], &d, "trait à cheval");
    assert_eq!(c.hazards.len(), 1);
}

#[test]
fn hazard_rings_stay_simple_below_the_engine_resolution() {
    // Couronne dont la poche et le bord se touchent à quelques pas de grille près,
    // sur une tôle de 10 m où l'ulp f32 vaut 1e-3 mm (cas trouvés par tirage) : la
    // fusion à 4 ulp du moteur cacherait le sommet repris.
    let tall = rect(0.0, 0.0, 950.0, 9950.0);
    let a = vec![
        [0.0, 9950.0001],
        [950.0, 9949.983020261421],
        [950.0017474435095, 0.00048318391972263907],
        [-5.038705300905009e-06, 1.9406823286642595e-05],
        [-0.0018291963955028342, 6623.221618906322],
        [950.0, 0.0],
        [475.0, 9950.000441571987],
        [474.9999, -1.0951747674253146e-05],
    ];
    let odd = gridded(&[
        [0.0, 0.0],
        [8075.0, 0.1234],
        [8882.5, 3097.5],
        [3230.0, 4425.0],
        [4037.5, 2655.0],
        [-807.5, 3982.5],
        [0.0, 0.0],
    ]);
    let b = vec![
        vec![
            [3159.485696671981, 0.048282414606727234],
            [-443.0619880943609, 2185.03480414545],
            [8647.357686012496, 3152.7236040368707],
            [8882.500004891052, 3097.498657116105],
            [6830.747086952805, 4343.719398176206],
        ],
        vec![
            [3229.9999802539282, 4425.01228473038],
            [5839.018804361117, -296.6397088118866],
            [8075.0, 0.1239860136848247],
            [8882.500008515242, 3097.498662995545],
            [5892.772242965567, 191.77209515551183],
        ],
    ];
    for (what, outer, defects) in [("bord droit", tall, vec![a]), ("bord en biais", odd, b)] {
        let c = cut(&outer, &[], &defects).unwrap();
        check(&c, what);
        check_hazards(&c, &outer, &[], what);
        assert_same_region(&c, &outer, &[], &defects, what);
    }
}

/// Cas trouvés par tirage, réduits : chacun faisait
/// échouer une version antérieure des reprises ou du nettoyage du bord.
#[test]
fn cases_found_by_random_search() {
    let notch = |a: Pt, b: Pt, c: Pt, d: Pt| vec![a, b, c, d, a];
    let cases: Vec<(&str, Vec<Pt>, Vec<Vec<Pt>>)> = vec![
        // Deux bords parallèles écartés d'à peine plus qu'une reprise (0,125 mm) : de
        // taille fixe, les reprises se renvoyaient d'un bord à l'autre.
        (
            "couloir d'une reprise",
            notch([105.0422, 63.0303], [104.506, 65.4952], [103.8531, 67.9318], [0.5395, 45.4573]),
            vec![
                vec![
                    [104.61072656250073, 64.61967531549139],
                    [104.00359341294268, 66.88547502787178],
                    [106.00000045657292, 53.00036128522982],
                ],
                vec![
                    [7.937024417430641, 45.986387924575006],
                    [104.5057, 45.986387924575006],
                    [104.5057, 65.4952],
                ],
            ],
        ),
        // Encoche très fermée du contour lui-même : le vide est hors de la tôle.
        (
            "encoche du contour",
            notch([54.0, 0.1234], [21.6, 351.0], [27.0, 210.6], [-5.4, 315.9]),
            vec![vec![
                [26.999996775563343, 210.6004],
                [10.300511471228313, 264.1152798103223],
                [11.130990349654699, 262.3462718865198],
            ]],
        ),
        // Languette du contour trop fine, toute interdite : rien ne peut l'épaissir.
        (
            "languette du contour",
            vec![
                [0.0, 0.0],
                [45.0, 0.1234],
                [49.5, 279.3],
                [18.0, 399.0],
                [22.5, 239.4],
                [-4.5, 359.1],
                [0.0, 0.0],
            ],
            vec![vec![
                [18.00000658596798, 399.0000175982365],
                [29.290219799171766, 100.86427698356248],
                [17.99980658596798, 399.0000175982365],
                [49.50008540051023, 279.30102468158304],
            ]],
        ),
        // Nœuds de croisement serrés sur le bord, de part et d'autre d'une pointe.
        (
            "pointe du contour",
            vec![
                [0.0, 0.0],
                [5250.0, 0.1234],
                [5775.0, 1032.5],
                [2100.0, 1475.0],
                [2625.0, 885.0],
                [-525.0, 1327.5],
                [0.0, 0.0],
            ],
            vec![vec![
                [-524.9999842213778, 1327.4999],
                [2208.0731912994106, -135.9889492296689],
                [-524.9926869518405, 1327.499319002236],
            ]],
        ),
        // Le bord est remis sur l'arête du contour, pas sur une corde qui coupe un coin.
        (
            "bord et coin",
            notch([56.0, 0.1234], [22.4, 138.0], [28.0, 82.8], [-5.6, 124.2]),
            vec![vec![
                [48.76557115636484, 32.23282013458703],
                [-5.6131813497406124, 124.20029847025445],
                [22.400299999999998, 137.99995547479153],
            ]],
        ),
        // Trait le long d'un bord presque parallèle : à son bout, un passage d'une
        // largeur égale au seuil, repris sans fin de proche en proche.
        (
            "passage au seuil pile",
            vec![[0.0, 0.0], [9300.0, 0.1234], [10230.0, 3360.0], [-930.0, 4320.0], [0.0, 0.0]],
            vec![
                vec![[-0.0008136693085492382, 0.0], [9300.0, 0.004]],
                vec![[9299.996, 4800.0], [9299.996, 0.0]],
            ],
        ),
        // Pointe du contour toute interdite, sur une tôle de 7 m : chaque reprise, sans
        // effet, refaisait assez de nœuds pour que l'aire bouge, et en demandait une autre.
        (
            "pointe interdite",
            vec![[0.0, 0.0], [1925.0, 5512.5], [875.0, 4725.0], [-175.0, 7087.5], [0.0, 0.0]],
            vec![
                vec![
                    [355.22645862018305, 4181.881369810357],
                    [-175.00000859827955, 7087.5001],
                    [874.999980216807, 4724.99945471685],
                    [-174.98560511700822, 7087.500985152837],
                ],
                vec![
                    [726.2644636547466, 495.79395964359287],
                    [-174.99304883706466, 7087.5],
                    [962.5002, 373.4454705058054],
                ],
            ],
        ),
        // Écaille d'un pas de haut coupée par le bord d'une reprise : il en reste un
        // résidu replié d'un pas, que chaque reprise déplaçait d'autant.
        (
            "résidu de nodage",
            notch([94.9002, 150.7542], [152.3589, 66.6171], [152.8396, 71.5482], [152.9599, 74.0228]),
            vec![vec![
                [131.06064198791466, 104.30627302504989],
                [135.2832524563293, 95.86105208822059],
                [139.50586292474395, 87.41583115139127],
                [135.66712613527608, 102.77077830926275],
                [139.50586292474395, 87.41583115139127],
            ]],
        ),
        // Couronne dont le bord passe par une pointe du contour : ses nœuds (un pas de
        // grille) et la pointe se confondaient en f32.
        (
            "couronne à la pointe du contour",
            vec![
                [0.0, 0.0],
                [2040.0, 0.1234],
                [2244.0, 806.4],
                [816.0, 1152.0],
                [1020.0, 691.2],
                [-204.0, 1036.8],
                [0.0, 0.0],
            ],
            vec![
                vec![[1116.9124, 549.7303952652281], [-204.0, 1036.7997]],
                vec![
                    [1241.6768885613658, 147.29399621226418],
                    [2040.0004, 0.12285371441397222],
                    [918.0000150561723, 921.5999],
                ],
                vec![
                    [714.8119620726213, -85.38307035855519],
                    [2160.1952581894907, 897.6633990521625],
                    [971.0145566309017, 91.70049154892206],
                    [772.6028581250569, 123.93403967972915],
                    [585.7591746515227, 198.06663490690846],
                    [419.2201089161074, 310.63191957784966],
                    [280.77284229565953, 456.3664662522799],
                    [176.89101490303528, 628.4558897118407],
                    [112.43202537976424, 818.8534800293497],
                    [90.4099043412433, 1018.6564577700225],
                ],
            ],
        ),
        (
            "sommet rentrant du contour",
            notch([262.0, 0.1234], [104.8, 746.0], [131.0, 447.6], [-26.2, 671.4]),
            vec![vec![[131.0000049914429, 447.60020000000003], [116.29688587810323, 56.9145]]],
        ),
    ];
    for (what, outer, defects) in cases {
        let c = cut(&outer, &[], &defects).unwrap();
        check(&c, what);
        check_hazards(&c, &outer, &[], what);
        assert_same_region(&c, &outer, &[], &defects, what);
        assert!(c.repairs < 60, "{what}: {} reprises", c.repairs);
    }
}

// ------------------------------------------------------------- le vrai cas

#[test]
fn the_real_disc_of_153_mm_with_a_chip_on_its_rim() {
    let outer = gridded(&disc(76.5, 76.5, 76.5, 360));
    let c = cut(&outer, &[], &[chip()]).unwrap();
    check(&c, "éclat");
    assert_eq!((c.pieces, c.holes.len(), c.repairs), (1, 0, 0));
    assert!(c.removed_area > 100.0 && c.removed_area < area(&chip()));
    check_areas(&c, area(&outer), perimeter(&outer), "éclat");
    for v in &chip()[1..4] {
        assert!(vertex_set(&c.outer).is_superset(&vertex_set(&[*v])));
    }
    // Les sommets du disque loin de l'éclat sont les mêmes, au bit près.
    let kept: HashSet<(u64, u64)> = bits(&c.outer).into_iter().collect();
    let same = open(&outer).iter().filter(|p| kept.contains(&(p[0].to_bits(), p[1].to_bits()))).count();
    assert!(same > 320, "{same}");
    // Trois défauts : éclat, rayure en rectangle, piqûre ronde.
    let c = cut(&outer, &[], &[chip(), rect(30.0, 30.0, 60.0, 31.5), disc(60.0, 100.0, 6.0, 48)]).unwrap();
    check(&c, "trois défauts");
    assert_eq!((c.pieces, c.holes.len(), c.repairs), (1, 2, 0));
}

// ------------------------------------------------- polygones mal dessinés

#[test]
fn a_self_crossing_polygon_covers_what_is_seen_filled() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    // Étoile à cinq branches : le pentagone du milieu (enroulement 2) est couvert.
    let star: Vec<Pt> = (0..5)
        .map(|i| {
            let t = 2.0 * PI * (2 * i) as f64 / 5.0 + PI / 2.0;
            [50.0 + 30.0 * t.cos(), 50.0 + 30.0 * t.sin()]
        })
        .collect();
    for d in [star.clone(), star.iter().rev().copied().collect()] {
        let c = cut(&sheet, &[], &[d]).unwrap();
        check(&c, "étoile");
        assert_eq!((c.holes.len(), c.pieces, c.repairs), (1, 1, 0));
        assert_eq!(open(&c.holes[0]).len(), 10);
        assert!(!in_piece([50.0, 50.0], &c.outer, &c.holes));
    }
    // Nœud papillon : les deux lobes, soudés au croisement.
    let c = cut(&sheet, &[], &[vec![[20.0, 20.0], [80.0, 80.0], [80.0, 20.0], [20.0, 80.0]]]).unwrap();
    check(&c, "papillon");
    assert_eq!((c.holes.len(), c.pieces, c.repairs), (1, 1, 1));
    assert!(!in_piece([25.0, 50.0], &c.outer, &c.holes) && !in_piece([75.0, 50.0], &c.outer, &c.holes));
    assert!(in_piece([50.0, 60.0], &c.outer, &c.holes));
    assert!((c.removed_area - 1_800.0).abs() < 0.06);
    // Boucle tracée deux fois : couverte une fois, jamais annulée.
    let twice: Vec<Pt> = disc(50.0, 50.0, 10.0, 24).into_iter().chain(disc(50.0, 50.0, 10.0, 24)).collect();
    let c = cut(&sheet, &[], &[twice]).unwrap();
    check(&c, "deux tours");
    assert_eq!((c.holes.len(), open(&c.holes[0]).len(), c.repairs), (1, 24, 0));
}

#[test]
fn duplicate_vertices_and_spikes_are_harmless() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    let d = vec![
        [20.0, 20.0],
        [20.0, 20.0],
        [40.0, 20.0],
        [40.0, 20.0],
        [40.0, 20.000_01],
        [40.0, 40.0],
        [20.0, 40.0],
        [20.0, 40.0],
        [20.0, 20.0],
        [20.0, 20.0],
    ];
    let c = cut(&sheet, &[], &[d]).unwrap();
    check(&c, "doublons");
    assert_eq!((c.holes.len(), open(&c.holes[0]).len(), c.repairs), (1, 4, 0));
    assert!((c.removed_area - 400.0).abs() < 1e-9);
    // Aller-retour : l'ergot n'a pas d'aire, mais il a été dessiné ; il est épaissi.
    let d = vec![[20.0, 20.0], [40.0, 20.0], [60.0, 10.0], [40.0, 20.0], [40.0, 40.0], [20.0, 40.0]];
    let c = cut(&sheet, &[], &[d.clone()]).unwrap();
    check(&c, "ergot");
    assert_eq!((c.holes.len(), c.repairs), (1, 1));
    assert_strokes_forbidden(&c, &sheet, &[d], 20, "ergot");
    // Le même à l'intérieur du polygone : déjà couvert, rien à faire.
    let d = vec![[20.0, 20.0], [40.0, 20.0], [30.0, 30.0], [40.0, 20.0], [40.0, 40.0], [20.0, 40.0]];
    let c = cut(&sheet, &[], &[d]).unwrap();
    check(&c, "ergot couvert");
    assert_eq!((c.holes.len(), open(&c.holes[0]).len(), c.repairs), (1, 4, 0));
    // Le polygone repasse par un de ses sommets : deux lobes soudés.
    let d = vec![[20.0, 20.0], [30.0, 30.0], [40.0, 20.0], [40.0, 40.0], [30.0, 30.0], [20.0, 40.0]];
    let c = cut(&sheet, &[], &[d]).unwrap();
    check(&c, "sommet repris");
    assert_eq!((c.holes.len(), c.repairs), (1, 1));
}

// ------------------------------------------------------------ trop fin

#[test]
fn a_thin_defect_is_widened_never_dropped() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    let cases: Vec<(&str, Vec<Pt>, Vec<Pt>)> = vec![
        ("rayure de 0,02 mm", rect(20.0, 50.0, 60.0, 50.02), vec![[40.0, 50.01], [20.001, 50.01]]),
        ("rayure en biais", vec![[20.0, 20.0], [60.0, 55.0], [60.01, 55.02]], vec![[40.0, 37.5]]),
        ("trait sans aire", vec![[20.0, 20.0], [60.0, 60.0]], vec![[40.0, 40.0]]),
        (
            "trait aller-retour brisé",
            vec![[20.0, 20.0], [60.0, 60.0], [70.0, 20.0], [60.0, 60.0]],
            vec![[40.0, 40.0], [65.0, 40.0]],
        ),
        ("point", vec![[50.0, 50.0]], vec![[50.0, 50.0]]),
        ("point répété", vec![[50.0, 50.0], [50.0, 50.0], [50.000_01, 50.0]], vec![[50.0, 50.0]]),
        ("plus petit que la grille", rect(50.0, 50.0, 50.000_01, 50.000_01), vec![[50.0, 50.0]]),
    ];
    for (what, d, covered) in cases {
        let c = cut(&sheet, &[], &[d.clone()]).unwrap();
        check(&c, what);
        assert_eq!((c.holes.len(), c.pieces), (1, 1), "{what}");
        assert!(c.repairs > 0, "{what}");
        for p in covered.iter().chain(d.iter()) {
            assert!(!in_piece(*p, &c.outer, &c.holes), "{what}: {p:?} permis");
        }
        // Pas plus de 0,12 mm (et le coin d'un carré) ôtés autour du tracé.
        for p in &c.holes[0] {
            assert!(ring_dist(*p, &d) <= REPAIR_HALF_MM * 2.0f64.sqrt() + 1e-3, "{what}: {p:?}");
        }
    }
    // Un défaut sans aire hors de la tôle n'y change rien.
    let c = cut(&sheet, &[], &[vec![[90.0, 150.0], [150.0, 90.0]]]).unwrap();
    assert!(!c.changed);
}

/// Clic à l'écran : pixel entier, échelle et décalage quelconques (hors grille).
fn click(x: f64, y: f64) -> Pt {
    [(x - 379.87) / 2.973_1, (260.43 - y) / 2.973_1]
}

#[test]
fn a_flat_stroke_is_never_lost() {
    let sheet = gridded(&disc(0.0, 0.0, 76.5, 194));
    let path = |px: &[(f64, f64)]| -> Vec<Pt> { px.iter().map(|&(x, y)| click(x, y)).collect() };
    let chip = disc(click(230.0, 388.0)[0], click(230.0, 388.0)[1], 6.0, 40);
    let bow = |w: f64| -> Vec<Pt> {
        let (a, b) = (click(300.0, 200.0), click(420.0, 331.0));
        let n = [w * 0.737, -w * 0.676];
        vec![a, b, [a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]]]
    };
    let cases: Vec<(&str, Vec<Vec<Pt>>)> = vec![
        // Trois clics exactement alignés : arrondis, un triangle d'un pas de haut.
        ("fissure dans la tôle", vec![path(&[(350.0, 205.0), (396.0, 199.0), (442.0, 193.0)])]),
        ("fissure à travers le bord", vec![path(&[(265.0, 353.0), (230.0, 388.0), (196.0, 422.0)])]),
        ("fissure au milieu d'une autre", vec![path(&[(265.0, 353.0), (230.0, 388.0), (196.0, 422.0)]), chip.clone()]),
        ("fissure d'un bord à l'autre", vec![path(&[(120.0, 300.0), (400.0, 260.0), (680.0, 220.0)])]),
        (
            "fissures croisées",
            vec![
                path(&[(300.0, 205.0), (346.0, 199.0), (484.0, 181.0)]),
                path(&[(300.0, 160.0), (347.0, 180.0), (441.0, 220.0)]),
                path(&[(420.0, 130.0), (414.0, 176.0), (402.0, 268.0)]),
            ],
        ),
        ("aller-retour en zigzag", vec![path(&[(300.0, 200.0), (425.0, 265.0), (350.0, 226.0), (475.0, 291.0), (375.0, 239.0)])]),
        ("nœud papillon d'un micron", vec![bow(1e-3)]),
        ("nœud papillon d'un pas", vec![bow(1e-4)]),
        ("nœud papillon de 0,05 mm", vec![bow(0.05)]),
        ("nœud papillon de 0,3 mm", vec![bow(0.3)]),
        (
            // La queue est refermée par l'arête automatique, hors grille.
            "lasso à queue plate",
            vec![path(&[(200.0, 180.0), (263.0, 209.0), (326.0, 238.0), (400.0, 220.0), (420.0, 300.0), (340.0, 310.0), (326.0, 238.0)])],
        ),
        (
            "fissure brisée à ergot plat",
            vec![path(&[(250.0, 200.0), (330.0, 260.0), (380.0, 250.0), (437.0, 301.0), (494.0, 352.0), (380.0, 250.0)])],
        ),
        (
            "ergot plat coudé",
            vec![path(&[(250.0, 200.0), (330.0, 290.0), (380.0, 250.0), (437.0, 301.0), (470.0, 180.0), (437.0, 301.0), (380.0, 250.0)])],
        ),
        (
            "lasso à queue plate qui sort de la tôle, sur un disque",
            vec![path(&[(130.0, 160.0), (263.0, 209.0), (326.0, 233.0), (400.0, 220.0), (420.0, 300.0), (326.0, 233.0)]), disc(click(263.0, 209.0)[0], click(263.0, 209.0)[1], 5.0, 24)],
        ),
        ("aller-retour coudé", vec![path(&[(250.0, 200.0), (330.0, 290.0), (421.0, 217.0), (330.0, 290.0)])]),
    ];
    for (what, defects) in &cases {
        let c = cut(&sheet, &[], defects).unwrap();
        check(&c, what);
        check_hazards(&c, &sheet, &[], what);
        assert_same_region(&c, &sheet, &[], defects, what);
        assert_strokes_forbidden(&c, &sheet, defects, 60, what);
        assert!(c.repairs > 0 || what.contains("0,3"), "{what}");
        assert!(c.repairs < 40, "{what}: {} reprises", c.repairs);
        // Jamais plus loin qu'une reprise.
        let near = |p: &Pt| {
            std::iter::once(&sheet).chain(defects).map(|r| ring_dist(*p, r)).fold(f64::INFINITY, f64::min)
        };
        for p in c.hazards.iter().flatten() {
            assert!(near(p) <= TOL_REPAIR, "{what}: {p:?} à {}", near(p));
        }
    }
    // Ergot posé le long d'un autre défaut : épaissi là aussi (un seul côté est couvert).
    let on_edge = vec![
        rect(-30.0, -10.0, 30.0, 0.0),
        vec![[-40.0, 0.0], [-40.0, 20.0], [-60.0, 20.0], [-40.0, 0.0], [0.0, 0.0]],
    ];
    let c = cut(&sheet, &[], &on_edge).unwrap();
    check(&c, "ergot posé");
    check_hazards(&c, &sheet, &[], "ergot posé");
    assert!(!engine_allows([-15.0, 0.1], &sheet, &c) && engine_allows([15.0, 0.1], &sheet, &c));
    // Au hasard : droite d'un pas entier de pixels, un disque parfois posé dessus.
    let mut g = Rng(0x0DD_BA11);
    for case in 0..1_500 {
        let a = (g.range(150.0, 610.0).round(), g.range(30.0, 490.0).round());
        let d = (g.range(-25.0, 25.0).round(), g.range(-25.0, 25.0).round());
        let k = 1 + g.below(6);
        let l = k + 1 + g.below(6);
        let at = |k: usize| (a.0 + d.0 * k as f64, a.1 + d.1 * k as f64);
        let mut defects = vec![path(&[a, at(k), at(l)])];
        if case % 3 == 0 {
            let m = defects[0][1];
            defects.push(disc(m[0] + g.range(0.0, 4.0), m[1] + g.range(0.0, 4.0), g.range(2.0, 7.0), 48));
        }
        if case % 5 == 0 {
            // Une pointe de plus, aller et retour, au bout de la droite.
            let t = defects[0][2];
            defects[0].push([t[0] + g.range(-30.0, 30.0), t[1] + g.range(-30.0, 30.0)]);
            defects[0].push(t);
        }
        let what = format!("clics alignés, cas {case}");
        let c = cut(&sheet, &[], &defects).unwrap();
        check(&c, &what);
        check_hazards(&c, &sheet, &[], &what);
        assert_strokes_forbidden(&c, &sheet, &defects, 30, &what);
        // Seule et loin du bord, une fissure droite reste un rectangle sur son tracé.
        let far = defects.iter().flatten().all(|p| p[0].hypot(p[1]) < 70.0);
        if far && case % 3 != 0 && case % 5 != 0 {
            assert_eq!((c.repairs, c.hazards.len(), open(&c.hazards[0]).len()), (1, 1, 4), "{what}");
        }
    }
}

#[test]
fn thin_pieces_are_lost_area_not_pieces() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    // Il reste une lame de 0,05 mm au bord droit : pas un morceau.
    let c = cut(&sheet, &[], &[rect(90.0, -1.0, 99.95, 101.0)]).unwrap();
    check(&c, "lame");
    assert_eq!((c.pieces, c.holes.len()), (1, 0));
    assert!((c.usable_area - 9_000.0).abs() < 1e-9);
    assert!((c.lost_area - 5.0).abs() < 1e-9);
    // Rien que des lames (couronne de 0,02 mm, bande en C) : plus de tôle utile.
    for d in [
        rect(0.02, 0.02, 99.98, 99.98),
        rect(-5.0, 0.04, 99.96, 99.96),
        rect(0.005, 0.005, 99.995, 99.995),
    ] {
        assert_eq!(cut(&sheet, &[], &[d]).unwrap_err(), SheetCutError::NoUsableArea);
    }
}

#[test]
fn narrow_necks_and_slots_are_closed_on_the_safe_side() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    // Goulet de 0,002 mm entre deux encoches : fermé, deux morceaux.
    let c = cut(&sheet, &[], &[rect(60.0, -1.0, 62.0, 49.999), rect(60.0, 50.001, 62.0, 101.0)]).unwrap();
    check(&c, "goulet");
    assert_eq!(c.pieces, 2);
    assert!((c.usable_area - 6_000.0).abs() < 0.1 && c.usable_area <= 6_000.0);
    // Coin très fermé (0,3 mm sur 4 m) : une seule reprise, pas une reprise qui
    // grignote le coin de proche en proche.
    let long = rect(-10.0, 0.0, 6575.0, 4230.0);
    let wedge = vec![
        vec![[0.066, 0.072], [-0.0079, 4225.0], [0.3, 0.3]],
        rect(-5.0, 4100.0, 5.0, 4101.0),
    ];
    let c = cut(&long, &[], &wedge).unwrap();
    check(&c, "coin très fermé");
    check_hazards(&c, &long, &[], "coin très fermé");
    assert_same_region(&c, &long, &[], &wedge, "coin très fermé");
    assert!(c.repairs > 0 && c.repairs < 20, "{}", c.repairs);
    // Le même en bien plus fermé (1e-5 rad), au bout d'un défaut épais.
    let tail = vec![
        vec![
            [0.0, 0.0],
            [50.0, 0.0],
            [50.0, 10.0],
            [3050.0, 10.015],
            [50.0, 10.03],
            [50.0, 50.0],
            [0.0, 50.0],
        ],
        rect(2055.0, 5.0, 2056.0, 15.0),
    ];
    let room = rect(-10.0, -10.0, 3200.0, 100.0);
    let c = cut(&room, &[], &tail).unwrap();
    check(&c, "queue très fine");
    check_hazards(&c, &room, &[], "queue très fine");
    assert_same_region(&c, &room, &[], &tail, "queue très fine");
    assert!(c.repairs > 0 && c.repairs < 20, "{}", c.repairs);
    // Couloir de 0,005 mm entre deux bords aux sommets serrés (0,01 mm) : quelques
    // dizaines de reprises, pas une par sommet.
    let wave = |y: f64, i: usize| [40.0 + i as f64 * 0.01, y + 0.5 * (i as f64 * 0.01).sin()];
    let below: Vec<Pt> =
        (0..=1500).map(|i| wave(50.0, i)).chain([[55.0, -1.0], [40.0, -1.0]]).collect();
    let above: Vec<Pt> =
        (0..=1500).map(|i| wave(50.005, i)).chain([[55.0, 101.0], [40.0, 101.0]]).collect();
    let dense = vec![below, above];
    let c = cut(&sheet, &[], &dense).unwrap();
    check(&c, "couloir serré");
    check_hazards(&c, &sheet, &[], "couloir serré");
    assert_same_region(&c, &sheet, &[], &dense, "couloir serré");
    assert!(c.pieces == 2 && c.repairs < 800, "{}", c.repairs);
    // Écaille très plate au bord : la pointe de l'INTERDIT passe à 0,006 mm d'un
    // sommet du contour (la tôle coupée n'a plus ce sommet), elle est épaissie.
    let flat = vec![[0.0, 0.0], [1000.0, 0.0], [3000.0, 0.0], [3000.0, 1500.0], [0.0, 1500.0]];
    let scale = vec![vec![[500.0, 1.006], [1010.0, -0.014], [1010.0, -5.0], [500.0, -5.0]]];
    let c = cut(&flat, &[], &scale).unwrap();
    check(&c, "écaille");
    check_hazards(&c, &flat, &[], "écaille");
    assert_same_region(&c, &flat, &[], &scale, "écaille");
    assert!(c.repairs > 0 && c.repairs < 10, "{}", c.repairs);
    // Fente de 0,002 mm depuis le bord : élargie sur toute sa longueur.
    let c = cut(&sheet, &[], &[rect(-1.0, 50.0, 40.0, 50.002)]).unwrap();
    check(&c, "fente");
    assert_eq!((c.pieces, c.holes.len()), (1, 0));
    assert!(c.repairs > 0);
    assert!(c.removed_area > 0.08 && c.removed_area < 40.2 * 0.26, "{}", c.removed_area);
    for x in [0.5, 10.0, 39.9] {
        assert!(!in_piece([x, 50.001], &c.outer, &c.holes));
    }
}

#[test]
fn features_below_the_engine_resolution_are_repaired() {
    // Loin de l'origine de la tôle l'ulp f32 vaut 2,4e-4 mm : des croisements à
    // une ou deux unités de grille l'un de l'autre feraient refuser l'anneau.
    // Le bord de A passe 1e-4 sous un sommet de B, le croisement tombe 1e-4 à
    // côté : en f32 les deux ordonnées sont égales, l'anneau se replierait.
    let sheet = rect(0.0, 0.0, 280.0, 2536.0);
    let a = rect(200.6496, 1810.5847, 294.0003, 2321.9999);
    let b = vec![[228.0, 2317.0], [253.0, 2310.0], [250.0, 2400.0], [214.0, 2327.0], [221.0, 2322.0]];
    for (what, d) in [("A et B", vec![a.clone(), b.clone()]), ("B et A", vec![b, a])] {
        let c = cut(&sheet, &[], &d).unwrap();
        check(&c, what);
        assert_eq!((c.pieces, c.holes.len()), (1, 0));
        assert!(c.repairs > 0, "{what}");
    }
    let sheet = rect(0.0, 0.0, 3000.0, 1500.0);
    for k in 0..40 {
        let e = k as f64 * 1e-4;
        let d1 = vec![[2990.0, 700.0], [3010.0, 700.0 + e], [3010.0, 720.0], [2990.0, 720.0]];
        let d2 = vec![[2995.0, 690.0], [2999.9999 + e, 700.0001], [2995.0, 715.0], [2994.0, 700.0 - e]];
        let c = cut(&sheet, &[], &[d1, d2]).unwrap();
        check(&c, &format!("micro {k}"));
    }
}

// --------------------------------------------------------------- refus

#[test]
fn a_defect_covering_everything_is_a_named_error() {
    let disc153 = gridded(&disc(76.5, 76.5, 76.5, 180));
    for d in [rect(-10.0, -10.0, 200.0, 200.0), disc153.clone(), disc(76.5, 76.5, 80.0, 64)] {
        let e = cut(&disc153, &[], &[d]).unwrap_err();
        assert_eq!(e, SheetCutError::NoUsableArea);
        assert_eq!(e.to_string(), "sheet_no_usable_area");
    }
    // À plusieurs, avec une zone.
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    let e = cut(
        &sheet,
        &[rect(40.0, 0.0, 60.0, 100.0)],
        &[rect(-1.0, -1.0, 40.0, 101.0), rect(60.0, -1.0, 101.0, 101.0)],
    );
    assert_eq!(e.unwrap_err(), SheetCutError::NoUsableArea);
}

#[test]
fn unusable_input_is_refused_by_name() {
    let sheet = rect(0.0, 0.0, 100.0, 100.0);
    let d = rect(10.0, 10.0, 20.0, 20.0);
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1e300, -1e8] {
        let mut o = sheet.clone();
        o[1][0] = bad;
        assert_eq!(cut(&o, &[], &[]).unwrap_err(), SheetCutError::BadGeometry);
        assert_eq!(cut(&o, &[], &[d.clone()]).unwrap_err(), SheetCutError::BadGeometry);
        let mut h = d.clone();
        h[2][1] = bad;
        assert_eq!(cut(&sheet, &[h.clone()], &[]).unwrap_err(), SheetCutError::BadGeometry);
        assert_eq!(cut(&sheet, &[], &[d.clone(), h]).unwrap_err(), SheetCutError::BadDefect);
    }
    for o in [
        vec![],
        vec![[1.0, 1.0]],
        vec![[0.0, 0.0], [1.0, 1.0], [0.0, 0.0]],
        vec![[0.0, 0.0], [1.0, 1.0], [2.0, 2.0]],
    ] {
        assert_eq!(cut(&o, &[], &[d.clone()]).unwrap_err(), SheetCutError::BadGeometry);
        assert_eq!(cut(&o, &[], &[]).unwrap_err(), SheetCutError::BadGeometry);
    }
    assert_eq!(cut(&sheet, &[], &[vec![]]).unwrap_err(), SheetCutError::BadDefect);
    // Aux bornes : très grand, très loin de l'origine, sommet à 10 km.
    let o = 9_000_000.0;
    let wide = rect(o, -o, o + 49_000.0, -o + 49_000.0);
    let c = cut(&wide, &[], &[rect(o + 10.0, -o + 48_990.0, o + 48_990.0, -o + 48_995.0)]).unwrap();
    check(&c, "49 m");
    assert!((c.removed_area - 48_980.0 * 5.0).abs() < 1e-6);
    let c = cut(&wide, &[], &[vec![[-o, -o - 1.0], [1e7, -o + 49_000.0], [1e7, -o + 49_001.0]]]).unwrap();
    check(&c, "49 m en biais, sommet à 10 km");
    assert_eq!(c.pieces, 2);
    assert_eq!(SheetCutError::BadGeometry.code(), "sheet_bad_geometry");
    assert_eq!(SheetCutError::BadDefect.code(), "sheet_bad_defect");
}

#[test]
fn the_deadline_stops_the_work() {
    let sheet = rect(0.0, 0.0, 1000.0, 1000.0);
    let defects: Vec<Vec<Pt>> = (0..200).map(|i| disc(500.0 + i as f64, 500.0, 300.0, 100)).collect();
    let dl = Deadline::new(1);
    let t = Instant::now();
    while t.elapsed().as_millis() < 3 {}
    assert_eq!(cut_sheet(&sheet, &[], &defects, &dl).unwrap_err(), SheetCutError::TimeBudget);
    // Trop de croisements : refus nommé, pas une mémoire pleine.
    let zigzag: Vec<Pt> = (0..3000)
        .map(|i| if i % 2 == 0 { [i as f64 * 0.3, 10.0] } else { [900.0 - i as f64 * 0.3, 990.0] })
        .collect();
    assert_eq!(cut(&sheet, &[], &[zigzag]).unwrap_err(), SheetCutError::TooComplex);
}

// ---------------------------------------------------------------- JSON

#[test]
fn the_json_entry_reads_strings_exactly_and_names_its_errors() {
    let v: f64 = 0.1 + 0.2;
    let outer = [[v, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0], [v, 0.0]];
    let text = |r: &[Pt]| {
        let pts: Vec<String> = r.iter().map(|p| format!("[\"{:?}\",\"{:?}\"]", p[0], p[1])).collect();
        format!("[{}]", pts.join(","))
    };
    let out = cut_sheet_json(&format!("{{\"outer\":{}}}", text(&outer))).unwrap();
    let j: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(j["changed"], false);
    assert_eq!(j["pieces"], 1);
    assert!(out.contains("0.30000000000000004"), "{out}");
    let out = cut_sheet_json(
        "{\"outer\":[[0,0],[100,0],[100,100],[0,100]],\
         \"defects\":[[[10,10],[\"20.5\",10],[20,20]]],\"time_budget_ms\":1000}",
    )
    .unwrap();
    let j: serde_json::Value = serde_json::from_str(&out).unwrap();
    for k in [
        "outer",
        "holes",
        "usableArea",
        "pieces",
        "lostArea",
        "removedArea",
        "changed",
        "repairs",
        "maxShift",
        "lostPieces",
        "hazards",
    ] {
        assert!(!j[k].is_null(), "{k} absent");
    }
    assert_eq!(j["holes"][0].as_array().unwrap().len(), 4);
        let err = |s: &str| cut_sheet_json(s).unwrap_err().to_string();
    assert_eq!(err("{"), "sheet_cut_bad_input");
    assert_eq!(err("{\"outer\":[[null,0],[1,0],[0,1]]}"), "sheet_bad_geometry");
    assert_eq!(err("{\"outer\":[[\"NaN\",0],[1,0],[0,1]]}"), "sheet_bad_geometry");
    assert_eq!(
        err("{\"outer\":[[0,0],[9,0],[0,9]],\"defects\":[[[\"Infinity\",0],[1,0],[0,1]]]}"),
        "sheet_bad_defect"
    );
    assert_eq!(
        err("{\"outer\":[[0,0],[9,0],[0,9]],\"defects\":[[[-1,-1],[99,-1],[-1,99]]]}"),
        "sheet_no_usable_area"
    );
}

// --------------------------------------------------------------- temps

#[test]
fn five_thousand_vertices_and_two_hundred_defects_stay_under_a_second() {
    let outer = gridded(&disc(500.0, 500.0, 500.0, 200));
    // Deux plans : défauts dispersés, et tous superposés (tous se croisent).
    for (what, step, r) in [("dispersés", 60.0, 20.0), ("superposés", 1.5, 250.0)] {
        let defects: Vec<Vec<Pt>> = (0..200)
            .map(|i| {
                let (a, b) = ((i % 15) as f64, (i / 15) as f64);
                disc(80.0 + a * step + 0.37 * b, 90.0 + b * step + 0.21 * a, r, 24)
            })
            .collect();
        let n: usize = outer.len() - 1 + defects.iter().map(|d| d.len() - 1).sum::<usize>();
        assert_eq!(n, 5_000);
        // Le meilleur de trois essais : les autres tests tournent en même temps.
        let mut ms = f64::INFINITY;
        let mut c = None;
        for _ in 0..3 {
            let t = Instant::now();
            c = Some(cut(&outer, &[], &defects).unwrap());
            ms = ms.min(t.elapsed().as_secs_f64() * 1e3);
        }
        let c = c.unwrap();
        println!(
            "{what} : {ms:.1} ms, {} trous, {} morceaux, {} reprises, écart {:.3e} mm",
            c.holes.len(),
            c.pieces,
            c.repairs,
            c.max_shift
        );
        check(&c, what);
        check_hazards(&c, &outer, &[], what);
        // Mesuré : 20 et 320 ms sur une machine libre. La borne laisse de la place à
        // une machine chargée ; l'index en grille (4,7 s) la dépassait.
        if !cfg!(debug_assertions) {
            assert!(ms < 3000.0, "{what}: {ms} ms");
        }
    }
    let disc153 = gridded(&disc(76.5, 76.5, 76.5, 360));
    let defects = vec![chip(), rect(30.0, 30.0, 60.0, 31.5), disc(60.0, 100.0, 6.0, 48)];
    let t = Instant::now();
    for _ in 0..100 {
        cut(&disc153, &[], &defects).unwrap();
    }
    println!("disque 153 mm, 3 défauts : {:.3} ms", t.elapsed().as_secs_f64() * 1e3 / 100.0);
}

// ------------------------------------------------------------- aléatoire

/// xorshift64* : graine fixe, aucune dépendance.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn range(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.unit()
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

/// Défaut au hasard autour d'une tôle de `w` x `h` : disque, rectangle (parfois
/// tourné), polygone libre (souvent recroisé). `lattice` > 0 : coordonnées
/// arrondies à ce pas, pour multiplier contacts et alignements exacts.
fn random_defect(g: &mut Rng, w: f64, h: f64, lattice: f64) -> Vec<Pt> {
    let q = |v: f64| if lattice > 0.0 { (v / lattice).round() * lattice } else { v };
    let (x, y) = (g.range(-0.15 * w, 1.15 * w), g.range(-0.15 * h, 1.15 * h));
    let s = w.min(h) * g.range(0.02, 0.45);
    match g.below(4) {
        0 => {
            let n = 8 + g.below(40);
            disc(x, y, s, n).into_iter().map(|p| [q(p[0]), q(p[1])]).collect()
        }
        1 => rect(q(x), q(y), q(x + s), q(y + s * g.range(0.1, 2.0))),
        2 => {
            let t = g.range(0.0, PI);
            let (c, d) = (t.cos(), t.sin());
            let (a, b) = (s, s * g.range(0.05, 1.0));
            [[-a, -b], [a, -b], [a, b], [-a, b]]
                .map(|p| [q(x + c * p[0] - d * p[1]), q(y + d * p[0] + c * p[1])])
                .to_vec()
        }
        _ => {
            let n = 3 + g.below(8);
            (0..n).map(|_| [q(x + g.range(-s, s)), q(y + g.range(-s, s))]).collect()
        }
    }
}

/// Points plus proches que ça d'un bord d'entrée : ignorés. C'est l'écart
/// maximal démontré (1,4143e-4 mm) arrondi au-dessus.
const TOL: f64 = 2e-4;
/// Une reprise ôte de la tôle jusqu'à son coin (0,15 mm) ; un interdit coupé par le
/// contour peut en demander deux de suite (une écaille épaissie reste fine si le
/// contour en coupe la moitié).
const TOL_REPAIR: f64 = 0.30;

#[test]
fn random_cuts_match_the_definition_point_by_point() {
    let mut g = Rng(0x9E37_79B9_7F4A_7C15);
    let (mut samples, mut skipped, mut repaired, mut multi, mut none, mut same) = (0usize, 0, 0, 0, 0, 0);
    let (mut allowed, mut split, mut rim, mut reach) = (0usize, 0usize, 0usize, 0.0f64);
    let mut worst = 0.0f64;
    for case in 0..2_000 {
        let lattice = [0.0, 0.0, 1.0, 5.0][case % 4];
        let (w, h) = (g.range(60.0, 400.0).round(), g.range(60.0, 400.0).round());
        let is_disc = (case / 4) % 2 == 0;
        let (outer, w, h) = if is_disc {
            let n = 24 + g.below(200);
            (gridded(&disc(w / 2.0, w / 2.0, w / 2.0, n)), w, w)
        } else {
            (rect(0.0, 0.0, w, h), w, h)
        };
        let holes: Vec<Vec<Pt>> = match case % 3 {
            0 => vec![],
            1 => vec![gridded(&disc(w * 0.5, h * 0.5, w.min(h) * 0.1, 32))],
            _ => vec![
                gridded(&rect(w * 0.5, h * 0.25, w * 0.6, h * 0.35)),
                gridded(&rect(w * 0.3, h * 0.5, w * 0.35, h * 0.6)),
            ],
        };
        let mut defects: Vec<Vec<Pt>> =
            (0..1 + g.below(6)).map(|_| random_defect(&mut g, w, h, lattice)).collect();
        // Un cas sur dix : une ronde de disques qui se recouvrent, l'îlot du milieu
        // est gardé ou perdu selon le reste.
        if case % 10 == 5 {
            defects.truncate(2);
            let (m, r) = (w.min(h), w.min(h) * g.range(0.2, 0.45));
            let turn = g.range(0.0, PI);
            defects.extend((0..9).map(|i| {
                let t = turn + 2.0 * PI * i as f64 / 9.0;
                disc(w / 2.0 + r * t.cos(), h / 2.0 + r * t.sin(), r * 0.4 + 0.02 * m, 20)
            }));
        }
        let what = format!("cas {case}");
        let original = area(&outer) - holes.iter().map(|h| area(h)).sum::<f64>();
        let edge_rings: Vec<&Vec<Pt>> = std::iter::once(&outer).chain(&holes).chain(&defects).collect();
        let near_edge =
            |p: Pt| edge_rings.iter().map(|r| ring_dist(p, r)).fold(f64::INFINITY, f64::min);
        let wanted_at =
            |p: Pt| in_piece(p, &outer, &holes) && !defects.iter().any(|d| inside(p, d));
        let c = match cut(&outer, &holes, &defects) {
            Ok(c) => c,
            Err(SheetCutError::NoUsableArea) => {
                // Vérifié point par point aussi : il ne reste rien d'épais.
                none += 1;
                for _ in 0..200 {
                    let p = [g.range(0.0, w), g.range(0.0, h)];
                    assert!(!wanted_at(p) || near_edge(p) < 0.2, "{what}: {p:?} est utile");
                }
                continue;
            }
            Err(e) => panic!("{what}: {e}"),
        };
        worst = worst.max(c.max_shift);
        check_hazards(&c, &outer, &holes, &what);
        if c.changed {
            check(&c, &what);
            let lines = perimeter(&outer) + holes.iter().map(|h| perimeter(h)).sum::<f64>();
            check_areas(&c, original, lines, &what);
        } else {
            same += 1;
        }
        repaired += (c.repairs > 0) as usize;
        multi += (c.pieces > 1) as usize;
        assert_strokes_forbidden(&c, &outer, &defects, 2, &what);
        // Couronnes coupées en deux (deux interdits qui partagent une arête), et
        // interdits qui longent le contour.
        split += (shared_edges(&c.hazards) > 0) as usize;
        rim += c.hazards.iter().flatten().any(|p| ring_dist(*p, &outer) < 1e-3) as usize;
        // Points au hasard, et points serrés contre les bords.
        let mut points: Vec<Pt> =
            (0..60).map(|_| [g.range(-0.02 * w, 1.02 * w), g.range(-0.02 * h, 1.02 * h)]).collect();
        for r in &edge_rings {
            let r = open(r);
            for _ in 0..8 {
                let k = g.below(r.len());
                let (a, b) = (r[k], r[(k + 1) % r.len()]);
                let t = g.unit();
                let e = [1e-3, 1e-2, 0.5][g.below(3)];
                points.push([
                    a[0] + t * (b[0] - a[0]) + g.range(-e, e),
                    a[1] + t * (b[1] - a[1]) + g.range(-e, e),
                ]);
            }
        }
        // Points serrés contre les bords RENDUS des deux descriptions.
        for r in c.hazards.iter().chain(&c.holes).chain(std::iter::once(&c.outer)) {
            for _ in 0..3 {
                let k = g.below(r.len() - 1);
                let t = g.unit();
                let e = [1e-3, 0.02, 0.3][g.below(3)];
                points.push([
                    r[k][0] + t * (r[k + 1][0] - r[k][0]) + g.range(-e, e),
                    r[k][1] + t * (r[k + 1][1] - r[k][1]) + g.range(-e, e),
                ]);
            }
        }
        for p in points {
            let near = near_edge(p);
            if near <= TOL {
                skipped += 1;
                continue;
            }
            samples += 1;
            let wanted = wanted_at(p);
            let chosen = in_piece(p, &c.outer, &c.holes);
            let got = chosen || c.lost_pieces.iter().any(|q| in_piece(p, &q.outer, &q.holes));
            // Les deux descriptions disent la même chose, morceaux perdus et
            // reprises compris.
            let engine = engine_allows(p, &outer, &c);
            assert_eq!(engine, chosen, "{what}: {p:?} moteur {engine}, tôle coupée {chosen} (bord à {near})");
            allowed += chosen as usize;
            // Jamais permis à tort, reprises ou pas.
            assert!(!chosen || wanted, "{what}: {p:?} permis à tort (bord à {near})");
            if got != wanted {
                reach = reach.max(near);
                assert!(
                    wanted && c.repairs > 0 && near <= TOL_REPAIR,
                    "{what}: {p:?} rendu {got}, attendu {wanted} (bord à {near}, {} reprises)",
                    c.repairs
                );
            }
        }
    }
    println!(
        "2000 cas : {samples} points comparés, {skipped} ignorés (à moins de {TOL} mm d'un bord), \
         {repaired} cas avec reprise, {multi} en plusieurs morceaux, {none} sans tôle utile, \
         {same} inchangés, écart max {worst:.4e} mm ; deux descriptions comparées sur ces mêmes \
         points ({allowed} permis) : {rim} cas où un interdit longe le contour, {split} cas où la \
         région gardée est entourée ; une reprise va au plus à {reach:.4} mm du tracé"
    );
    assert!(rim > 1_000 && split > 10, "{rim} {split}");
    assert!(samples > 150_000 && repaired > 50 && multi > 100);
    assert!(worst <= 1.4143e-4, "{worst}");
}

/// Disque de 153 mm ou tôle rectangulaire avec des défauts plausibles.
fn plausible(g: &mut Rng, kind: usize) -> (Vec<Pt>, Vec<Vec<Pt>>) {
    let blob = |g: &mut Rng, x: f64, y: f64, r: f64| -> Vec<Pt> {
        let n = 5 + g.below(6);
        (0..n)
            .map(|i| {
                let a = 2.0 * PI * i as f64 / n as f64;
                let q = r * g.range(0.6, 1.3);
                [x + q * a.cos(), y + q * a.sin()]
            })
            .collect()
    };
    let mut ds: Vec<Vec<Pt>> = Vec::new();
    if kind < 2 {
        // Éclats, rayures et piqûres ; `kind` 1 : fissure qui traverse ou ronde qui
        // entoure, en plus.
        for _ in 0..1 + g.below(3) {
            let t = g.range(0.0, 2.0 * PI);
            let rho = if g.below(2) == 0 { g.range(70.0, 80.0) } else { 76.5 * g.unit().sqrt() };
            let (x, y) = (76.5 + rho * t.cos(), 76.5 + rho * t.sin());
            let (a, b, r) = (g.range(3.0, 20.0), g.range(1.0, 10.0), g.range(3.0, 14.0));
            ds.push(match g.below(3) {
                0 => disc(x, y, r, 48),
                1 => rect(x - a, y - b, x + a, y + b),
                _ => blob(g, x, y, r),
            });
        }
        if kind == 1 {
            let t = g.range(0.0, PI);
            let (c, s) = (t.cos(), t.sin());
            if g.below(4) > 0 {
                let (o, b) = (g.range(-60.0, 60.0), g.range(0.2, 3.0));
                ds.push(
                    [[-120.0, o - b], [120.0, o - b], [120.0, o + b], [-120.0, o + b]]
                        .map(|p: Pt| [76.5 + c * p[0] - s * p[1], 76.5 + s * p[0] + c * p[1]])
                        .to_vec(),
                );
            } else {
                let r = g.range(30.0, 70.0);
                for i in 0..10 {
                    let a = t + 2.0 * PI * i as f64 / 10.0;
                    ds.push(disc(76.5 + r * a.cos(), 76.5 + r * a.sin(), r * 0.36, 32));
                }
            }
        }
        return (gridded(&disc(76.5, 76.5, 76.5, 360)), ds);
    }
    // Rectangle : `kind` 2, un ou deux coins emportés ; 3, une ou deux bandes le long
    // d'un côté (juste, débordante, ou en biais), avec parfois un éclat par-dessus.
    let (w, h) = (g.range(100.0, 2000.0).round(), g.range(100.0, 1500.0).round());
    let w = if g.below(4) == 0 { w } else { w + g.below(10_000) as f64 / 1e4 };
    for _ in 0..1 + g.below(2) {
        if kind == 2 {
            let (x, y) = ([0.0, w][g.below(2)], [0.0, h][g.below(2)]);
            let r = w.min(h) * g.range(0.02, 0.3);
            ds.push(match g.below(3) {
                0 => disc(x + g.range(-0.5, 0.5) * r, y + g.range(-0.5, 0.5) * r, r, 40),
                1 => rect(x - r, y - r * 0.7, x + r, y + r * 0.7),
                _ => blob(g, x, y, r),
            });
            continue;
        }
        let t = h * g.range(0.005, 0.2);
        let lean = if g.below(3) == 0 { t * g.range(-0.5, 0.5) } else { 0.0 };
        let e = [0.0, 5.0, 0.0001][g.below(3)];
        let band = [[-e, -e], [w + e, -e], [w + e, t + lean], [-e, t - lean]];
        ds.push(match g.below(3) {
            0 => band.to_vec(),
            1 => band.map(|p| [w - p[0], h - p[1]]).to_vec(),
            _ => band.map(|p| [w - p[1] * w / h, p[0] * h / w]).to_vec(),
        });
        if g.below(3) == 0 {
            let (x, r) = (g.range(0.0, w), h * g.range(0.05, 0.3));
            ds.push(blob(g, x, 0.0, r));
        }
    }
    (gridded(&rect(0.0, 0.0, w, h)), ds)
}

/// Les jeux plausibles : aire du contour moins interdits = aire utile, interdits
/// dans le contour (`check_hazards`), et les deux descriptions d'accord.
#[test]
fn plausible_sheets_keep_their_area_and_their_region() {
    let mut g = Rng(2025);
    let sets = [(0, "éclats", 400), (1, "fissures et rondes", 200), (2, "coins", 200), (3, "bandes", 200)];
    for (kind, name, n) in sets {
        let (mut lost, mut shared, mut worst, mut points) = (0, 0, 0.0f64, 0);
        for case in 0..n {
            let (outer, defects) = plausible(&mut g, kind);
            let what = format!("{name} {case}");
            let c = match cut(&outer, &[], &defects) {
                Ok(c) => c,
                Err(SheetCutError::NoUsableArea) => continue,
                Err(e) => panic!("{what}: {e:?}"),
            };
            if c.changed {
                check(&c, &what);
            }
            check_hazards(&c, &outer, &[], &what);
            lost += (c.pieces > 1) as usize;
            // Une arête d'interdit confondue avec un côté du contour sur 50 mm.
            shared += c.hazards.iter().any(|h| {
                h.windows(2).any(|w| {
                    let len = ((w[1][0] - w[0][0]).powi(2) + (w[1][1] - w[0][1]).powi(2)).sqrt();
                    let mid = [(w[0][0] + w[1][0]) / 2.0, (w[0][1] + w[1][1]) / 2.0];
                    len > 50.0 && [w[0], mid, w[1]].iter().all(|p| ring_dist(*p, &outer) < 2e-4)
                })
            }) as usize;
            let total = area(&outer) - c.hazards.iter().map(|h| area(h)).sum::<f64>();
            worst = worst.max((total - c.usable_area).abs());
            let edges: Vec<&Vec<Pt>> = std::iter::once(&outer).chain(&defects).collect();
            for r in c.hazards.iter().chain(std::iter::once(&c.outer)) {
                for _ in 0..20 {
                    let k = g.below(r.len() - 1);
                    let t = g.unit();
                    let e = [1e-3, 0.05, 3.0][g.below(3)];
                    let p = [
                        r[k][0] + t * (r[k + 1][0] - r[k][0]) + g.range(-e, e),
                        r[k][1] + t * (r[k + 1][1] - r[k][1]) + g.range(-e, e),
                    ];
                    if edges.iter().map(|r| ring_dist(p, r)).fold(f64::INFINITY, f64::min) <= TOL {
                        continue;
                    }
                    points += 1;
                    assert_eq!(engine_allows(p, &outer, &c), in_piece(p, &c.outer, &c.holes), "{what}: {p:?}");
                }
            }
        }
        println!(
            "{name} : {n} cas, {lost} en plusieurs morceaux, {shared} avec un long bord commun, \
             {points} points, écart d'aire max {worst:.6} mm²"
        );
        assert!(kind != 1 || lost > 100, "{lost}");
        assert!(kind != 3 || shared > 100, "{shared}");
    }
}

/// Écart maximal mesuré quand tout est hors grille (entrée arrondie + nodage) :
/// la borne démontrée est 1,4143e-4 mm.
#[test]
fn the_outward_error_stays_within_the_proved_bound() {
    let mut g = Rng(42);
    let mut worst = 0.0f64;
    let mut outward = 0.0f64;
    for case in 0..400 {
        let off = if case % 2 == 0 { 0.0 } else { 1234.567_89 };
        let outer: Vec<Pt> = disc(off + 76.5, 76.5, 76.5, 90 + g.below(90));
        let defects: Vec<Vec<Pt>> = (0..3)
            .map(|_| {
                let n = 12 + g.below(60);
                disc(off + g.range(0.0, 153.0), g.range(0.0, 153.0), g.range(3.0, 40.0), n)
            })
            .collect();
        let Ok(c) = cut(&outer, &[], &defects) else { continue };
        worst = worst.max(c.max_shift);
        // Mesure directe : de combien un bord rendu s'enfonce-t-il dans un
        // défaut, ou sort-il du contour ?
        for r in std::iter::once(&c.outer).chain(&c.holes) {
            for w in r.windows(2) {
                for k in 0..4 {
                    let t = k as f64 / 4.0;
                    let p = [w[0][0] + t * (w[1][0] - w[0][0]), w[0][1] + t * (w[1][1] - w[0][1])];
                    if !inside(p, &outer) {
                        outward = outward.max(ring_dist(p, &outer));
                    }
                    for d in &defects {
                        if inside(p, d) {
                            outward = outward.max(ring_dist(p, d));
                        }
                    }
                }
            }
        }
    }
    println!("écart max d'une arête {worst:.4e} mm, débord mesuré {outward:.4e} mm");
    assert!(worst <= 1.4143e-4);
    assert!(outward <= 1.4143e-4);
}

#[test]
fn the_cut_is_deterministic() {
    let outer = gridded(&disc(200.0, 200.0, 200.0, 300));
    let mut g = Rng(7);
    for _ in 0..30 {
        let defects: Vec<Vec<Pt>> = (0..6).map(|_| random_defect(&mut g, 400.0, 400.0, 0.0)).collect();
        let Ok(a) = cut(&outer, &[], &defects) else { continue };
        for _ in 0..3 {
            let b = cut(&outer, &[], &defects).unwrap();
            assert_same_bits(&a.outer, &b.outer);
            assert_eq!(a.holes.len(), b.holes.len());
            for (x, y) in a.holes.iter().zip(&b.holes) {
                assert_same_bits(x, y);
            }
        }
    }
}
