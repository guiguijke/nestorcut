//! Regle W : un corps dont la largeur minimale (plus petit calibre de
//! l'enveloppe convexe) est sous 0,1 mm n'est pas une piece. Le triangle
//! (40,30)-(50,40)-(40.004,30.003) passait selon le sommet de depart de
//! l'anneau et tuait le job au moteur (« no pole found with 10 levels »).

use nest_import::assemble::{MIN_PART_WIDTH_MM, ring_too_thin};

fn poly(pts: &[(f64, f64)]) -> String {
    let mut s = format!("0\nLWPOLYLINE\n8\n0\n90\n{}\n70\n1\n", pts.len());
    for (x, y) in pts {
        s.push_str(&format!("10\n{x}\n20\n{y}\n"));
    }
    s
}

fn dxf(entities: &[String]) -> String {
    format!("0\nSECTION\n2\nENTITIES\n{}0\nENDSEC\n0\nEOF\n", entities.concat())
}

/// (parts, dropped) pour un dessin fait de polylignes fermees.
fn run(polys: &[&[(f64, f64)]]) -> (usize, usize) {
    let ents: Vec<String> = polys.iter().map(|p| poly(p)).collect();
    let r = nest_import::import_file(dxf(&ents).as_bytes(), 0.01).expect("import");
    let dropped = r
        .findings
        .iter()
        .filter(|f| f.code == "import.partsDropped")
        .map(|f| f.count)
        .sum();
    (r.parts.len(), dropped)
}

const SLIVER: [(f64, f64); 3] = [(40.0, 30.0), (50.0, 40.0), (40.004, 30.003)];

#[test]
fn sliver_is_dropped_and_counted_for_all_three_start_rotations() {
    for k in 0..3 {
        let rot: Vec<(f64, f64)> = (0..3).map(|i| SLIVER[(i + k) % 3]).collect();
        assert_eq!(run(&[&rot]), (0, 1), "rotation {k}");
    }
}

fn tri(d: f64) -> Vec<(f64, f64)> {
    // base (0,0)-(100,100), apex = milieu de la base decale de d, perpendiculairement
    // (decalage selon la normale (-1,1)/sqrt2 : largeur = d).
    let s = std::f64::consts::FRAC_1_SQRT_2;
    vec![(0.0, 0.0), (100.0, 100.0), (50.0 - d * s, 50.0 + d * s)]
}

#[test]
fn diagonal_triangle_raised_by_005_is_dropped_by_02_is_kept() {
    assert_eq!(run(&[&tri(0.05)]), (0, 1));
    assert_eq!(run(&[&tri(0.2)]), (1, 0));
}

#[test]
fn ordinary_shapes_are_kept() {
    let square = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
    assert_eq!(run(&[&square]), (1, 0));
    // cadre mince de 0,3 mm : anneau exterieur 100x100, trou 99.4 x 99.4
    let outer = [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)];
    let inner = [(0.3, 0.3), (99.7, 0.3), (99.7, 99.7), (0.3, 99.7)];
    let (parts, dropped) = run(&[&outer, &inner]);
    assert_eq!((parts, dropped), (1, 0));
    // bande diagonale 10 x 0,15
    let s = std::f64::consts::FRAC_1_SQRT_2;
    let (ux, uy) = (s, s);
    let (nx, ny) = (-s * 0.15, s * 0.15);
    let a = (0.0, 0.0);
    let b = (10.0 * ux, 10.0 * uy);
    let strip = [a, b, (b.0 + nx, b.1 + ny), (a.0 + nx, a.1 + ny)];
    assert_eq!(run(&[&strip]), (1, 0));
}

// --- brute force ---------------------------------------------------------

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 11) as f64) / ((1u64 << 53) as f64)
    }
}

/// Largeur minimale O(m*m) : pour chaque paire de points (direction), la
/// largeur dans cette direction ; le minimum sur toutes les paires egale le
/// minimum sur les aretes de l'enveloppe.
fn brute_min_width(pts: &[[f64; 2]]) -> f64 {
    let mut best = f64::INFINITY;
    for a in pts {
        for b in pts {
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let len = (dx * dx + dy * dy).sqrt();
            if len == 0.0 {
                continue;
            }
            let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
            for p in pts {
                let c = (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len;
                lo = lo.min(c);
                hi = hi.max(c);
            }
            best = best.min(hi - lo);
        }
    }
    best
}

#[test]
fn ring_too_thin_matches_brute_force_on_2000_random_rings() {
    let mut g = Lcg(0x5EED_1234_ABCD_0001);
    let (mut thin, mut thick, mut skipped) = (0, 0, 0);
    for case in 0..2000 {
        let n = 3 + (g.next() * 9.0) as usize;
        let ang = g.next() * std::f64::consts::TAU;
        let (ca, sa) = (ang.cos(), ang.sin());
        let (len, wid) = if case % 2 == 0 {
            (1.0 + g.next() * 99.0, 0.02 + g.next() * 0.28) // sliver-ish
        } else {
            (1.0 + g.next() * 99.0, 1.0 + g.next() * 99.0)
        };
        let ox = g.next() * 200.0 - 100.0;
        let oy = g.next() * 200.0 - 100.0;
        let ring: Vec<[f64; 2]> = (0..n)
            .map(|_| {
                let (u, v) = (g.next() * len, g.next() * wid);
                [ox + u * ca - v * sa, oy + u * sa + v * ca]
            })
            .collect();
        let mw = brute_min_width(&ring);
        if (mw - MIN_PART_WIDTH_MM).abs() < 1e-9 || !mw.is_finite() {
            skipped += 1;
            continue;
        }
        let got = ring_too_thin(&ring);
        assert_eq!(got, mw < MIN_PART_WIDTH_MM, "case {case}: min width {mw}");
        if got { thin += 1 } else { thick += 1 }
        // ouvert ou ferme : meme reponse
        let mut closed = ring.clone();
        closed.push(ring[0]);
        assert_eq!(ring_too_thin(&closed), got, "closed, case {case}");
    }
    assert!(thin > 300 && thick > 300, "thin {thin} thick {thick} skipped {skipped}");
}

// --- revue B1 : sommets colineaires a l'arrondi pres ----------------------
// Le filtre des calibres jugeait mince une plaque epaisse dont l'enveloppe
// garde des sommets colineaires a l'arrondi pres.

const SQ45: [(f64, f64); 6] = [
    (206.6, 143.9),
    (232.6, 117.9),
    (294.6, 55.9),
    (306.6, 43.9),
    (406.6, 143.9),
    (306.6, 243.9),
];

// Les six fichiers repro/snap0..5.dxf de la revue (plaques a 45 degres, au 1e-4 pres).
const SNAP_PLATES: [&[(f64, f64)]; 6] = [
    &[(37.099, 126.175), (77.7456, 85.5284), (155.957, 7.317), (163.274, 0.0), (220.8186, 57.5447), (232.1625, 68.8885), (313.672, 150.3981), (430.7267, 267.4527), (379.881, 318.2983), (358.1312, 340.0482), (348.2186, 349.9607), (295.6973, 402.482), (288.897, 409.2823), (192.2465, 312.6318), (165.1121, 285.4974), (162.1833, 282.5686), (95.6007, 215.986), (21.4444, 141.8296), (28.9032, 134.3708)],
    &[(636.7545, 252.7036), (811.0647, 427.0138), (525.3571, 712.7214), (405.2391, 592.6033), (351.0469, 538.4111), (435.2852, 454.1728), (545.9314, 343.5266), (578.1704, 311.2876), (592.3229, 297.1351)],
    &[(26.8858, 332.0944), (35.3553, 340.5639), (-29.684, 405.6033), (-55.0475, 430.9668), (-61.8896, 437.8089), (-133.8239, 509.7432), (-169.1792, 474.3878), (-78.4373, 383.6459), (-67.1401, 372.3487), (-21.9548, 327.1634), (-1.1812, 306.3898), (0.0, 305.2086)],
    &[(94.4682, 69.9772), (102.1386, 62.3068), (143.2132, 21.2322), (164.4454, 0.0), (192.7332, 28.2879), (196.0551, 31.6097), (199.8007, 35.3553), (160.6341, 74.522), (101.2828, 133.8733), (54.0919, 181.0642), (47.7358, 174.7081), (43.9051, 170.8775), (37.286, 164.2583), (23.5106, 150.483), (18.7365, 145.7089), (28.113, 136.3324)],
    &[(-333.1697, 1621.9671), (-347.3919, 1607.7449), (-124.1752, 1384.5282), (-54.8287, 1315.1817), (-19.1686, 1279.5216), (0.0, 1260.353), (46.3955, 1306.7485), (52.8951, 1313.2481), (70.7107, 1331.0637), (-276.6812, 1678.4556)],
    &[(35.3553, 672.9225), (25.0553, 683.2225), (-156.479, 864.7568), (-243.7008, 951.9786), (-246.3091, 949.3703), (-273.4445, 922.2349), (-279.0561, 916.6232), (-266.8441, 904.4112), (-99.2627, 736.8298), (-87.0137, 724.5808), (-25.2822, 662.8493), (0.0, 637.5671), (25.9957, 663.5628), (33.8439, 671.411)],
];

fn to_pts(p: &[(f64, f64)]) -> Vec<[f64; 2]> {
    p.iter().map(|&(x, y)| [x, y]).collect()
}

#[test]
fn square_turned_by_45_degrees_is_not_thin() {
    let ring = to_pts(&SQ45);
    assert!(!ring_too_thin(&ring));
    let mut closed = ring.clone();
    closed.push(ring[0]);
    assert!(!ring_too_thin(&closed));
    let rev: Vec<[f64; 2]> = ring.iter().rev().copied().collect();
    assert!(!ring_too_thin(&rev));
}

#[test]
fn square_turned_by_45_degrees_is_one_part_at_import_level() {
    let r = nest_import::import_file(dxf(&[poly(&SQ45)]).as_bytes(), 0.01).expect("import");
    assert_eq!(r.parts.len(), 1);
    let dropped: usize = r
        .findings
        .iter()
        .filter(|f| f.code == "import.partsDropped")
        .map(|f| f.count)
        .sum();
    assert_eq!(dropped, 0);
    let p = &r.parts[0];
    assert!((p.width - 200.0).abs() < 1e-6 && (p.height - 200.0).abs() < 1e-6, "{} x {}", p.width, p.height);
}

#[test]
fn reviewer_plates_are_not_thin_and_are_one_part_each() {
    for (i, plate) in SNAP_PLATES.iter().enumerate() {
        assert!(!ring_too_thin(&to_pts(plate)), "function level, snap{i}");
        assert_eq!(run(&[plate]), (1, 0), "import level, snap{i}");
    }
}

#[test]
fn rotated_plates_drawing_gives_four_parts_and_drops_nothing() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../parity/corpus_extra/rotated_plates.dxf");
    let bytes = std::fs::read(&path).expect("rotated_plates.dxf");
    let r = nest_import::import_file(&bytes, 0.01).expect("import");
    assert_eq!(r.parts.len(), 4);
    assert!(r.findings.iter().all(|f| f.code != "import.partsDropped"));
}

fn uniform(g: &mut Lcg, lo: f64, hi: f64) -> f64 {
    lo + g.next() * (hi - lo)
}

/// 0 a 3 sommets de plus, colineaires, sur chaque bord.
fn with_extra_vertices(g: &mut Lcg, base: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let mut ring = Vec::new();
    for i in 0..base.len() {
        let (a, b) = (base[i], base[(i + 1) % base.len()]);
        ring.push(a);
        let n = (g.next() * 4.0) as usize;
        let mut ts: Vec<f64> = (0..n).map(|_| uniform(g, 0.02, 0.98)).collect();
        ts.sort_by(|x, y| x.partial_cmp(y).unwrap());
        for t in ts {
            ring.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
    }
    ring
}

/// Plaque convexe de largeur minimale >= 1 mm par construction (rectangle d'au
/// moins 1 mm de cote, ou polygone circonscrit a un cercle de rayon >= 0,5).
fn plate(g: &mut Lcg) -> Vec<[f64; 2]> {
    let base: Vec<[f64; 2]> = if g.next() < 0.5 {
        let (w, h) = (uniform(g, 1.0, 300.0), uniform(g, 1.0, 300.0));
        vec![[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]]
    } else {
        let r = uniform(g, 0.5, 100.0);
        let gaps = loop {
            let k = 3 + (g.next() * 6.0) as usize;
            let raw: Vec<f64> = (0..k).map(|_| uniform(g, 0.2, 2.0)).collect();
            let tot: f64 = raw.iter().sum();
            let gaps: Vec<f64> = raw.iter().map(|x| x * std::f64::consts::TAU / tot).collect();
            if gaps.iter().cloned().fold(0.0, f64::max) < 0.95 * std::f64::consts::PI {
                break gaps;
            }
        };
        let mut a = uniform(g, 0.0, std::f64::consts::TAU);
        let mut v = Vec::new();
        for gap in gaps {
            let mid = a + gap / 2.0;
            let rad = r / (gap / 2.0).cos();
            v.push([rad * mid.cos(), rad * mid.sin()]);
            a += gap;
        }
        v
    };
    with_extra_vertices(g, &base)
}

/// Corps de largeur minimale 0,001 a 0,09 mm, sommets colineaires en plus.
fn sliver(g: &mut Lcg) -> Vec<[f64; 2]> {
    let l = uniform(g, 2.0, 300.0);
    let w = uniform(g, 0.001, 0.09);
    let base: Vec<[f64; 2]> = if g.next() < 0.5 {
        vec![[0.0, 0.0], [l, 0.0], [l, w], [0.0, w]]
    } else {
        vec![[0.0, 0.0], [l, 0.0], [l * uniform(g, 0.1, 0.9), w]]
    };
    with_extra_vertices(g, &base)
}

fn place(g: &mut Lcg, ring: &[[f64; 2]], mode: usize, snap: bool) -> Vec<[f64; 2]> {
    let ang = match mode {
        0 => std::f64::consts::FRAC_PI_4,
        1 => uniform(g, 0.0, std::f64::consts::TAU),
        _ => 0.0,
    };
    let (c, s) = (ang.cos(), ang.sin());
    let (ox, oy) = (uniform(g, -500.0, 500.0), uniform(g, -500.0, 500.0));
    ring.iter()
        .map(|p| {
            let (x, y) = (ox + p[0] * c - p[1] * s, oy + p[0] * s + p[1] * c);
            if snap {
                [(x * 1e4).round() / 1e4, (y * 1e4).round() / 1e4]
            } else {
                [x, y]
            }
        })
        .collect()
}

#[test]
fn twenty_thousand_plates_with_collinear_vertices_are_never_thin() {
    let mut g = Lcg(0xB1_0000_0000_0001);
    let mut wrong = Vec::new();
    for i in 0..20000usize {
        let ring = plate(&mut g);
        let ring = place(&mut g, &ring, i % 3, (i / 3) % 2 == 1);
        if ring_too_thin(&ring) {
            wrong.push((i, i % 3));
        }
    }
    assert!(wrong.is_empty(), "{} thick plates judged thin, first {:?}", wrong.len(), &wrong[..wrong.len().min(5)]);
}

#[test]
fn six_thousand_true_slivers_with_collinear_vertices_are_thin() {
    let mut g = Lcg(0xB1_0000_0000_0002);
    let mut missed = Vec::new();
    for i in 0..6000usize {
        let ring = sliver(&mut g);
        let ring = place(&mut g, &ring, i % 3, (i / 3) % 2 == 1);
        if !ring_too_thin(&ring) {
            missed.push(i);
        }
    }
    assert!(missed.is_empty(), "{} slivers not judged thin, first {:?}", missed.len(), &missed[..missed.len().min(5)]);
}
