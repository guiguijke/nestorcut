//! Décalage du contour d'une tôle (`nest_import::sheet_offset`) : formes
//! simples aux valeurs connues, bornes de distance du côté sûr, morceaux,
//! vides, refus.

use nest_import::assemble::{Pt, point_in_ring, ring_signed_area};
use nest_import::budget::Deadline;
use nest_import::sheet_offset::{
    OffsetError, OffsetOptions, RingOffset, SAFETY_MM, offset_ring, offset_ring_json,
};
use std::f64::consts::PI;

// ------------------------------------------------------------------ outils

fn off(ring: &[Pt], d: f64) -> Result<RingOffset, OffsetError> {
    offset_ring(ring, d, &OffsetOptions::default(), &Deadline::unlimited())
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

fn open(r: &[Pt]) -> &[Pt] {
    if r.len() > 1 && r[0] == r[r.len() - 1] { &r[..r.len() - 1] } else { r }
}

fn area(r: &[Pt]) -> f64 {
    ring_signed_area(open(r)).abs()
}

fn seg_dist(p: Pt, a: Pt, b: Pt) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let l2 = dx * dx + dy * dy;
    let t = if l2 == 0.0 { 0.0 } else { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2).clamp(0.0, 1.0) };
    ((a[0] + t * dx - p[0]).powi(2) + (a[1] + t * dy - p[1]).powi(2)).sqrt()
}

/// Distance d'un point au bord d'un anneau.
fn edge_dist(p: Pt, ring: &[Pt]) -> f64 {
    let r = open(ring);
    (0..r.len()).fold(f64::INFINITY, |d, i| d.min(seg_dist(p, r[i], r[(i + 1) % r.len()])))
}

/// Distance signée à la région : négative dedans.
fn signed_dist(p: Pt, ring: &[Pt]) -> f64 {
    let d = edge_dist(p, ring);
    if point_in_ring(p, open(ring)) { -d } else { d }
}

/// Sommets et neuf points par arête d'un anneau rendu.
fn probes(ring: &[Pt]) -> Vec<Pt> {
    let r = open(ring);
    let mut out = Vec::new();
    for i in 0..r.len() {
        let (a, b) = (r[i], r[(i + 1) % r.len()]);
        for k in 0..10 {
            let t = k as f64 / 10.0;
            out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
    }
    out
}

/// Le conteneur rendu n'est jamais plus grand que le décalage exact, et n'en
/// est pas plus loin que `loose` : tout point de son bord est à une distance
/// signée de l'entrée entre `d - loose` et `d` (tolérance 1e-9).
fn assert_conservative(input: &[Pt], out: &[Pt], d: f64, loose: f64) {
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for p in probes(out) {
        let s = signed_dist(p, input);
        lo = lo.min(s);
        hi = hi.max(s);
    }
    assert!(hi <= d + 1e-9, "bord rendu à {hi} du contour, plus que {d}");
    assert!(lo >= d - loose, "bord rendu à {lo} du contour, loin de {d} (marge {loose})");
}

/// Erreur d'arc au plus, à 64 segments par tour, plus la marge de grille.
fn arc_slack(r: f64) -> f64 {
    r.abs() * (1.0 / (PI / 64.0).cos() - 1.0) + 2.0 * SAFETY_MM + 3e-4
}

/// Anneau fermé, anti-horaire, sommets distincts, sans arêtes qui se croisent.
fn assert_clean_ring(ring: &[Pt]) {
    assert!(ring.len() >= 4, "anneau trop court");
    assert_eq!(ring[0], ring[ring.len() - 1], "anneau non fermé");
    let r = open(ring);
    assert!(ring_signed_area(r) > 0.0, "anneau horaire");
    for i in 0..r.len() {
        assert_ne!(r[i], r[(i + 1) % r.len()], "sommets confondus");
        for v in r[i] {
            assert!(((v * 1e4).round() - v * 1e4).abs() < 1e-6, "hors grille : {v}");
        }
    }
    let cross = |o: Pt, a: Pt, b: Pt| (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    let n = r.len();
    for i in 0..n {
        for j in i + 2..n {
            if i == 0 && j == n - 1 {
                continue;
            }
            let (a, b, c, d) = (r[i], r[(i + 1) % n], r[j], r[(j + 1) % n]);
            let (d1, d2, d3, d4) = (cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b));
            assert!(!(d1 * d2 < 0.0 && d3 * d4 < 0.0), "arêtes {i} et {j} se croisent");
        }
    }
}

// --------------------------------------------------------------- rectangle

#[test]
fn a_rectangle_shrinks_to_a_rectangle() {
    let input = rect(0.0, 0.0, 1000.0, 500.0);
    let o = off(&input, -10.0).unwrap();
    assert_clean_ring(&o.ring);
    assert_eq!(o.pieces, 1);
    assert_eq!(o.lost_area_mm2, 0.0);
    assert_eq!(o.applied_distance_mm, -10.0);
    assert!(o.voids.is_empty());
    // Coins vifs : (10 + marge ; 10 + marge) à (990 - marge ; 490 - marge).
    let want = (980.0 - 2.0 * SAFETY_MM) * (480.0 - 2.0 * SAFETY_MM);
    assert!((area(&o.ring) - want).abs() < 0.5, "{} vs {want}", area(&o.ring));
    assert_conservative(&input, &o.ring, -10.0, arc_slack(10.0));
    assert!(o.max_shift_mm <= 3e-4);
}

#[test]
fn a_rectangle_grows_with_rounded_corners() {
    let input = rect(0.0, 0.0, 1000.0, 500.0);
    let o = off(&input, 10.0).unwrap();
    assert_clean_ring(&o.ring);
    assert_eq!(o.pieces, 1);
    assert_eq!(o.applied_distance_mm, 10.0);
    // Aire exacte : rectangle + quatre bandes + un disque de rayon 10.
    let exact = 1000.0 * 500.0 + 2.0 * 10.0 * 1500.0 + PI * 100.0;
    let got = area(&o.ring);
    assert!(got <= exact && got >= exact - 2.5, "{got} vs {exact}");
    assert_conservative(&input, &o.ring, 10.0, arc_slack(10.0));
    // Un coin est ARRONDI : le point (-10 ; -10) du coin vif n'y est pas.
    assert!(!point_in_ring([-9.0, -9.0], open(&o.ring)));
    assert!(point_in_ring([-6.5, -6.5], open(&o.ring)));
    // La boîte : exactement la marge de grille sous les 10 mm.
    let x_min = o.ring.iter().fold(f64::INFINITY, |m, p| m.min(p[0]));
    assert!(x_min >= -10.0 && x_min <= -10.0 + 2.0 * SAFETY_MM + 3e-4, "{x_min}");
}

#[test]
fn a_clockwise_or_open_ring_gives_the_same_result() {
    let ccw = rect(0.0, 0.0, 300.0, 200.0);
    let mut cw = ccw.clone();
    cw.reverse();
    let opened = ccw[..4].to_vec();
    for d in [-7.5, 7.5] {
        let a = off(&ccw, d).unwrap();
        assert_eq!(a.ring, off(&cw, d).unwrap().ring);
        assert_eq!(a.ring, off(&opened, d).unwrap().ring);
    }
}

#[test]
fn a_zero_distance_returns_the_ring_closed_and_counter_clockwise() {
    let mut cw = rect(0.0, 0.0, 300.0, 200.0);
    cw.reverse();
    let o = off(&cw[..4], 0.0).unwrap();
    assert_clean_ring(&o.ring);
    assert_eq!(o.applied_distance_mm, 0.0);
    assert_eq!(area(&o.ring), 60_000.0);
}

// ------------------------------------------------------------------ disque

#[test]
fn a_disc_grows_and_shrinks_by_the_distance() {
    // 360 sommets, rayon 500 : beaucoup de petits secteurs.
    let input = disc(500.0, 500.0, 500.0, 360);
    for d in [-25.0, -3.0, 3.0, 25.0] {
        let o = off(&input, d).unwrap();
        assert_clean_ring(&o.ring);
        assert_eq!(o.pieces, 1, "d = {d}");
        assert_eq!(o.applied_distance_mm, d, "d = {d}");
        assert!(o.voids.is_empty());
        assert_conservative(&input, &o.ring, d, arc_slack(d));
        // Rayon du résultat : celui du polygone d'entrée plus d, à sa flèche près.
        for p in open(&o.ring) {
            let rad = ((p[0] - 500.0).powi(2) + (p[1] - 500.0).powi(2)).sqrt();
            assert!(rad <= 500.0 + d + 1e-9 && rad >= 500.0 + d - 0.03, "rayon {rad} pour d = {d}");
        }
    }
}

#[test]
fn a_finely_sampled_disc_is_handled() {
    let input = disc(200.0, 200.0, 200.0, 3600);
    for d in [-12.0, 12.0] {
        let o = off(&input, d).unwrap();
        assert_clean_ring(&o.ring);
        assert_eq!(o.applied_distance_mm, d);
        assert_conservative(&input, &o.ring, d, arc_slack(d));
    }
}

#[test]
fn a_disc_smaller_than_the_distance_leaves_nothing() {
    let input = disc(50.0, 50.0, 50.0, 90);
    assert_eq!(off(&input, -50.5).unwrap_err(), OffsetError::Empty);
    assert_eq!(off(&input, -80.0).unwrap_err(), OffsetError::Empty);
    assert!(off(&input, -45.0).is_ok());
}

// ------------------------------------------------------------- forme en L

/// L : carré 600 x 600 moins le quart haut droit (300..600)².
fn l_shape() -> Vec<Pt> {
    vec![[0.0, 0.0], [600.0, 0.0], [600.0, 300.0], [300.0, 300.0], [300.0, 600.0], [0.0, 600.0], [0.0, 0.0]]
}

#[test]
fn an_l_shape_grows_with_a_sharp_inner_corner() {
    let input = l_shape();
    let o = off(&input, 20.0).unwrap();
    assert_clean_ring(&o.ring);
    assert_eq!(o.applied_distance_mm, 20.0);
    assert_conservative(&input, &o.ring, 20.0, arc_slack(20.0));
    // Coin rentrant : les deux bords décalés se coupent à angle vif en
    // (320 ; 320) ; cinq coins saillants : un disque et un quart de rayon 20.
    assert!(point_in_ring([319.9, 319.9], open(&o.ring)));
    assert!(!point_in_ring([320.1, 320.1], open(&o.ring)));
    let exact = 270_000.0 + 20.0 * 2400.0 - 400.0 + 1.25 * PI * 400.0;
    let got = area(&o.ring);
    assert!(got <= exact && got >= exact - 6.0, "{got} vs {exact}");
}

#[test]
fn an_l_shape_shrinks_with_a_rounded_inner_corner() {
    let input = l_shape();
    let o = off(&input, -20.0).unwrap();
    assert_clean_ring(&o.ring);
    assert_eq!(o.pieces, 1);
    assert_conservative(&input, &o.ring, -20.0, arc_slack(20.0));
    // Le coin rentrant (300 ; 300) est contourné par un arc de rayon 20 : le
    // point à 45 degrés à 19 mm du coin est ôté, celui à 21 mm est gardé.
    let k = std::f64::consts::FRAC_1_SQRT_2;
    assert!(!point_in_ring([300.0 - 19.0 * k, 300.0 - 19.0 * k], open(&o.ring)));
    assert!(point_in_ring([300.0 - 21.0 * k, 300.0 - 21.0 * k], open(&o.ring)));
    // Aire exacte : aire - r·périmètre, + r² par coin saillant (cinq, les bandes
    // s'y recouvrent), - le quart de disque du coin rentrant.
    let exact = 270_000.0 - 20.0 * 2400.0 + 5.0 * 400.0 - PI * 100.0;
    let got = area(&o.ring);
    assert!(got <= exact && got >= exact - 6.0, "{got} vs {exact}");
}

// ---------------------------------------------------------------- encoches

/// Carré 400 x 400 avec une encoche droite de largeur `w` (centrée en x = 200),
/// ouverte en haut, profonde de 250.
fn notched(w: f64) -> Vec<Pt> {
    let (a, b) = (200.0 - w / 2.0, 200.0 + w / 2.0);
    vec![
        [0.0, 0.0], [400.0, 0.0], [400.0, 400.0], [b, 400.0], [b, 150.0],
        [a, 150.0], [a, 400.0], [0.0, 400.0], [0.0, 0.0],
    ]
}

#[test]
fn a_notch_narrower_than_twice_the_distance_closes() {
    // Encoche de 12 mm, décalage de 10 : les deux parois décalées se
    // recouvrent, l'encoche disparaît, sauf son embouchure arrondie.
    let input = notched(12.0);
    let o = off(&input, 10.0).unwrap();
    assert_clean_ring(&o.ring);
    assert_eq!(o.applied_distance_mm, 10.0);
    assert!(o.voids.is_empty());
    assert_conservative(&input, &o.ring, 10.0, arc_slack(10.0));
    assert!(point_in_ring([200.0, 300.0], open(&o.ring)), "le milieu de l'encoche est couvert");
    assert!(point_in_ring([200.0, 160.0], open(&o.ring)), "le fond de l'encoche est couvert");
}

#[test]
fn a_notch_wider_than_twice_the_distance_stays_open() {
    let input = notched(30.0);
    let o = off(&input, 10.0).unwrap();
    assert_clean_ring(&o.ring);
    assert_conservative(&input, &o.ring, 10.0, arc_slack(10.0));
    assert!(!point_in_ring([200.0, 300.0], open(&o.ring)), "le milieu de l'encoche reste dehors");
    assert!(point_in_ring([188.0, 300.0], open(&o.ring)));
}

#[test]
fn a_notch_left_as_a_hairline_falls_back_to_a_smaller_distance() {
    // Encoche de 20,004 mm, décalage de 10 : il resterait une fente de quelques
    // microns, que la découpe souderait (du conteneur EN PLUS). Le résultat est
    // refait à 9,5 mm : fente franche de 1 mm, rien au-delà des 10 mm demandés.
    let input = notched(20.004);
    let o = off(&input, 10.0).unwrap();
    assert_clean_ring(&o.ring);
    assert_eq!(o.applied_distance_mm, 9.5);
    assert!(o.voids.is_empty());
    assert_conservative(&input, &o.ring, 10.0, 0.5 + arc_slack(10.0));
    assert!(!point_in_ring([200.0, 300.0], open(&o.ring)), "la fente reste ouverte");
    assert!(point_in_ring([190.0, 300.0], open(&o.ring)));
}

#[test]
fn a_large_distance_that_cannot_be_made_safe_is_refused_not_ignored() {
    // 4 000 sommets, 30 lobes, décalage de 100 mm : trop de croisements pour
    // l'arrangement. Le contour d'entrée serait sûr, mais à 100 mm du réglage :
    // un refus nommé, pas un réglage ignoré en silence.
    let n = 4000;
    let input: Vec<Pt> = (0..n)
        .map(|i| {
            let t = 2.0 * PI * i as f64 / n as f64;
            let r = 200.0 + 40.0 * (30.0 * t).cos();
            [300.0 + r * t.cos(), 300.0 + r * t.sin()]
        })
        .collect();
    assert_eq!(off(&input, 100.0).unwrap_err(), OffsetError::TooComplex);
    assert_eq!(off(&input, -100.0).unwrap_err(), OffsetError::TooComplex);
}

/// Encoche en trou de serrure : fente de 12 mm qui débouche sur une chambre
/// carrée de 100 mm (150..250 x 150..250).
fn keyhole() -> Vec<Pt> {
    vec![
        [0.0, 0.0], [400.0, 0.0], [400.0, 400.0], [206.0, 400.0], [206.0, 250.0],
        [250.0, 250.0], [250.0, 150.0], [150.0, 150.0], [150.0, 250.0],
        [194.0, 250.0], [194.0, 400.0], [0.0, 400.0], [0.0, 0.0],
    ]
}

#[test]
fn a_notch_that_closes_on_a_chamber_is_refused_unless_voids_are_asked() {
    // La fente se referme, la chambre reste : un vide de (160..240)² aux coins
    // arrondis, enfermé dans le conteneur.
    let input = keyhole();
    assert_eq!(off(&input, 10.0).unwrap_err(), OffsetError::EnclosedVoid);
    let opts = OffsetOptions { keep_voids: true, ..OffsetOptions::default() };
    let o = offset_ring(&input, 10.0, &opts, &Deadline::unlimited()).unwrap();
    assert_clean_ring(&o.ring);
    assert_eq!(o.voids.len(), 1);
    assert_clean_ring(&o.voids[0]);
    assert!(point_in_ring([200.0, 300.0], open(&o.ring)), "la fente est couverte");
    assert!(point_in_ring([200.0, 200.0], open(&o.voids[0])), "la chambre est un vide");
    // Le vide est la chambre réduite de 10 mm : tous ses points sont à 10 mm au
    // moins de la tôle (jamais moins : le conteneur ne déborde pas).
    for p in probes(&o.voids[0]) {
        let s = signed_dist(p, &input);
        assert!(s <= 10.0 + 1e-9 && s >= 10.0 - arc_slack(10.0), "{s}");
    }
    // Aire exacte : 80 x 80, plus l'avancée dans l'embouchure de la fente
    // (2·(10·6 - ∫ sqrt(100 - u²) du de 0 à 6)). Le vide rendu est un peu plus
    // GRAND (arcs inscrits) : le conteneur, un peu plus petit.
    let exact = 6400.0 + 2.0 * (60.0 - (3.0 * 8.0 + 50.0 * 0.6f64.asin()));
    let got = area(&o.voids[0]);
    assert!(got >= exact && got <= exact + 3.0, "{got} vs {exact}");
}

// -------------------------------------------------------------------- goulet

/// Haltère : deux carrés (0..300 et 500..700 en x) reliés par un goulet de
/// 30 mm de haut.
fn dumbbell() -> Vec<Pt> {
    vec![
        [0.0, 0.0], [300.0, 0.0], [300.0, 135.0], [500.0, 135.0], [500.0, 50.0], [700.0, 50.0],
        [700.0, 250.0], [500.0, 250.0], [500.0, 165.0], [300.0, 165.0], [300.0, 300.0], [0.0, 300.0],
        [0.0, 0.0],
    ]
}

#[test]
fn a_neck_narrower_than_twice_the_distance_splits_and_the_largest_piece_is_kept() {
    let input = dumbbell();
    let o = off(&input, -20.0).unwrap();
    assert_clean_ring(&o.ring);
    assert_eq!(o.pieces, 2);
    assert!(o.voids.is_empty());
    assert_conservative(&input, &o.ring, -20.0, arc_slack(20.0));
    // Gardé : le grand carré réduit (260 x 260) ; perdu : le petit (160 x 160).
    // Chacun avance un peu dans l'embouchure du goulet, entre les deux arcs de
    // rayon 20 de ses coins : 2·(20·15 - ∫ sqrt(400 - u²) du de 0 à 15).
    let mouth = 2.0 * (300.0 - (7.5 * 175.0f64.sqrt() + 200.0 * 0.75f64.asin()));
    let kept = area(&o.ring);
    assert!(kept <= 67_600.0 + mouth && kept >= 67_600.0 + mouth - 3.0, "{kept}");
    let lost = o.lost_area_mm2;
    assert!(lost <= 25_600.0 + mouth && lost >= 25_600.0 + mouth - 3.0, "{lost}");
    assert!(point_in_ring([150.0, 150.0], open(&o.ring)));
    assert!(!point_in_ring([600.0, 150.0], open(&o.ring)));
}

#[test]
fn a_neck_wider_than_twice_the_distance_stays_in_one_piece() {
    let input = dumbbell();
    let o = off(&input, -10.0).unwrap();
    assert_clean_ring(&o.ring);
    assert_eq!(o.pieces, 1);
    assert_eq!(o.lost_area_mm2, 0.0);
    assert_conservative(&input, &o.ring, -10.0, arc_slack(10.0));
    assert!(point_in_ring([400.0, 150.0], open(&o.ring)));
}

// ----------------------------------------------------------- petites distances

#[test]
fn a_tiny_distance_never_gives_more_than_asked() {
    // Sous le seuil des polygones fins de la découpe, des reprises entrent en
    // jeu : le résultat reste du côté sûr, quitte à appliquer moins.
    let input = l_shape();
    for d in [0.0003, 0.02, 0.05, 0.3, 0.8] {
        let o = off(&input, d).unwrap();
        assert_clean_ring(&o.ring);
        assert!(o.applied_distance_mm >= 0.0 && o.applied_distance_mm <= d, "d = {d}");
        for p in probes(&o.ring) {
            assert!(signed_dist(p, &input) <= d + 1e-9, "d = {d}");
        }
    }
    for d in [-0.02, -0.05, -0.3, -0.8] {
        let o = off(&input, d).unwrap();
        assert_clean_ring(&o.ring);
        for p in probes(&o.ring) {
            assert!(signed_dist(p, &input) <= d + 1e-9, "d = {d}");
        }
    }
}

// --------------------------------------------------------- formes quelconques

/// Étoile lisse à `lobes` lobes : rayon 200 ± 60, 240 sommets (creux et bosses).
fn flower(lobes: f64) -> Vec<Pt> {
    let n = 240;
    let mut out: Vec<Pt> = (0..n)
        .map(|i| {
            let t = 2.0 * PI * i as f64 / n as f64;
            let r = 200.0 + 60.0 * (lobes * t).cos();
            [300.0 + r * t.cos(), 300.0 + r * t.sin()]
        })
        .collect();
    out.push(out[0]);
    out
}

#[test]
fn concave_curved_outlines_stay_on_the_safe_side() {
    for lobes in [3.0, 5.0, 8.0] {
        let input = flower(lobes);
        for d in [-30.0, -8.0, 8.0, 30.0] {
            let opts = OffsetOptions { keep_voids: true, ..OffsetOptions::default() };
            let o = offset_ring(&input, d, &opts, &Deadline::unlimited()).unwrap();
            assert_clean_ring(&o.ring);
            assert!(o.applied_distance_mm.abs() <= d.abs());
            for p in probes(&o.ring) {
                assert!(signed_dist(p, &input) <= d + 1e-9, "lobes {lobes}, d = {d}");
            }
            if o.applied_distance_mm == d && o.pieces == 1 && o.voids.is_empty() {
                assert_conservative(&input, &o.ring, d, arc_slack(d));
            }
        }
    }
}

#[test]
fn more_segments_per_turn_come_closer_to_the_circle() {
    let input = rect(0.0, 0.0, 200.0, 200.0);
    let exact = 40_000.0 + 4.0 * 200.0 * 50.0 + PI * 2500.0;
    let mut last = 0.0;
    for seg in [8, 64, 360] {
        let opts = OffsetOptions { segments_per_turn: seg, ..OffsetOptions::default() };
        let o = offset_ring(&input, 50.0, &opts, &Deadline::unlimited()).unwrap();
        let a = area(&o.ring);
        assert!(a <= exact && a > last, "{seg} segments : {a}");
        last = a;
    }
    assert!(exact - last < 1.0, "{last} vs {exact}");
}

#[test]
fn the_result_is_deterministic() {
    let input = flower(5.0);
    for d in [-8.0, 8.0] {
        let a = off(&input, d).unwrap();
        let b = off(&input, d).unwrap();
        let bits = |r: &[Pt]| r.iter().map(|p| (p[0].to_bits(), p[1].to_bits())).collect::<Vec<_>>();
        assert_eq!(bits(&a.ring), bits(&b.ring));
    }
}

// --------------------------------------------------------------------- refus

#[test]
fn degenerate_input_is_refused() {
    let bad = OffsetError::BadInput;
    assert_eq!(off(&[], 5.0).unwrap_err(), bad);
    assert_eq!(off(&[[0.0, 0.0], [10.0, 0.0]], 5.0).unwrap_err(), bad);
    // Trois points alignés : aire nulle.
    assert_eq!(off(&[[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]], 5.0).unwrap_err(), bad);
    // Sommets confondus sur la grille.
    assert_eq!(off(&[[0.0, 0.0], [0.00001, 0.0], [0.0, 0.00001]], 5.0).unwrap_err(), bad);
    assert_eq!(off(&[[0.0, 0.0], [f64::NAN, 0.0], [5.0, 5.0]], 5.0).unwrap_err(), bad);
    assert_eq!(off(&[[0.0, 0.0], [1e9, 0.0], [5.0, 5.0]], 5.0).unwrap_err(), bad);
    let sq = rect(0.0, 0.0, 100.0, 100.0);
    assert_eq!(off(&sq, f64::NAN).unwrap_err(), bad);
    assert_eq!(off(&sq, f64::INFINITY).unwrap_err(), bad);
    assert_eq!(off(&sq, 1e6).unwrap_err(), bad);
    // Nœud papillon : deux arêtes se croisent.
    let bow = vec![[0.0, 0.0], [100.0, 100.0], [100.0, 0.0], [0.0, 100.0]];
    assert_eq!(off(&bow, 5.0).unwrap_err(), bad);
    assert_eq!(off(&bow, -5.0).unwrap_err(), bad);
}

#[test]
fn an_expired_budget_is_the_sheet_cut_time_code() {
    let dl = Deadline::new(1);
    let mut spins = 0u64;
    while !dl.expired() && spins < 50_000_000 {
        spins += 1;
    }
    let input = disc(500.0, 500.0, 500.0, 720);
    let err = offset_ring(&input, 10.0, &OffsetOptions::default(), &dl).unwrap_err();
    assert_eq!(err, OffsetError::TimeBudget);
    assert_eq!(err.code(), "sheet_cut_time_budget");
}

#[test]
fn error_codes_are_stable() {
    assert_eq!(OffsetError::BadInput.code(), "offset_bad_input");
    assert_eq!(OffsetError::Empty.code(), "offset_empty");
    assert_eq!(OffsetError::EnclosedVoid.code(), "offset_enclosed_void");
    assert_eq!(OffsetError::TooComplex.code(), "offset_too_complex");
    assert_eq!(OffsetError::Failed("x").code(), "offset_failed");
}

// ---------------------------------------------------------------------- JSON

#[test]
fn the_json_entry_reads_numbers_and_strings_and_names_its_fields() {
    let out = offset_ring_json(
        r#"{"ring":[[0,0],["300","0"],[300,200],[0,"200"]],"distance_mm":"-10"}"#,
    )
    .unwrap();
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["pieces"], serde_json::json!(1));
    assert_eq!(v["lost_area_mm2"], serde_json::json!(0.0));
    assert_eq!(v["applied_distance_mm"], serde_json::json!(-10.0));
    assert!(v["max_shift_mm"].as_f64().unwrap() <= 3e-4);
    assert_eq!(v["voids"], serde_json::json!([]));
    let ring = v["ring"].as_array().unwrap();
    assert_eq!(ring.len(), 5);
    assert_eq!(ring[0], ring[4]);
    assert_eq!(offset_ring_json("{").unwrap_err(), OffsetError::BadInput);
    assert_eq!(offset_ring_json(r#"{"ring":[[0,0],[1,0],[0,1]]}"#).unwrap_err(), OffsetError::BadInput);
    assert_eq!(
        offset_ring_json(r#"{"ring":[[0,0],[100,0],[0,100]],"distance_mm":-60}"#).unwrap_err(),
        OffsetError::Empty
    );
    let coarse = offset_ring_json(
        r#"{"ring":[[0,0],[100,0],[100,100],[0,100]],"distance_mm":20,"segments_per_turn":8}"#,
    )
    .unwrap();
    let fine = offset_ring_json(r#"{"ring":[[0,0],[100,0],[100,100],[0,100]],"distance_mm":20}"#).unwrap();
    let count = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap()["ring"].as_array().unwrap().len();
    assert!(count(&coarse) < count(&fine));
}

// --------------------------------------------------- fente de largeur nulle

/// Plus petite distance des points contrôlés de `out` au point `tip`.
fn dist_to_point(out: &[Pt], tip: Pt) -> f64 {
    probes(out).iter().fold(f64::INFINITY, |d, p| d.min(((p[0] - tip[0]).powi(2) + (p[1] - tip[1]).powi(2)).sqrt()))
}

/// Plaque 100 x 100 dont le bord bas porte une fente de largeur nulle jusqu'à
/// (50 ; 30) : l'aller et le retour sont sur la même droite, le retour s'arrête
/// à `back` avant de rejoindre le bord (ce que rend l'import d'un retour décalé
/// de moins d'un demi-pas de grille).
fn slit_plate(back: Pt) -> Vec<Pt> {
    vec![[0.0, 0.0], [50.0, 0.0], [50.0, 30.0], back, [50.0002, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0], [0.0, 0.0]]
}

#[test]
fn the_tip_of_a_zero_width_slit_is_held_at_the_distance() {
    // Demi-tour exact au bout de la fente : sans demi-disque, les deux
    // rectangles s'arrêtaient à la perpendiculaire du bout et la région rendue
    // le touchait.
    let input = slit_plate([50.0, 5.0]);
    let o = off(&input, -10.0).unwrap();
    assert_eq!(o.applied_distance_mm, -10.0);
    assert_clean_ring(&o.ring);
    let d = dist_to_point(&o.ring, [50.0, 30.0]);
    assert!(d >= 10.0 - 1e-6 && d <= 10.0 + arc_slack(10.0), "bout de fente à {d}");
    for p in probes(&o.ring) {
        assert!(point_in_ring(p, open(&input)) || edge_dist(p, &input) <= 1e-9);
        assert!(edge_dist(p, &input) >= 10.0 - 1e-6, "bord rendu à {} de la tôle", edge_dist(p, &input));
    }
    // La région passe au-dessus du bout : elle reste d'un seul morceau.
    assert_eq!(o.pieces, 1);
    assert!(point_in_ring([50.0, 45.0], open(&o.ring)));
    assert!(!point_in_ring([50.0, 35.0], open(&o.ring)));
}

#[test]
fn a_zero_width_slit_does_not_grow_the_outward_container() {
    // Vers l'extérieur, la fente est dans la tôle : le conteneur est celui de
    // la plaque, jamais plus grand que le décalage exact.
    let input = slit_plate([50.0, 5.0]);
    let o = off(&input, 10.0).unwrap();
    assert!(o.applied_distance_mm <= 10.0 && o.applied_distance_mm >= 9.0);
    assert_clean_ring(&o.ring);
    let plate = rect(0.0, 0.0, 100.0, 100.0);
    for p in probes(&o.ring) {
        assert!(signed_dist(p, &plate) <= 10.0 + 1e-9, "{}", signed_dist(p, &plate));
    }
}

#[test]
fn the_slit_tip_is_held_on_a_ring_of_several_thousand_vertices() {
    // Disque de 4000 sommets (rayon 500) avec la même fente au point bas : le
    // contrôle point par point y était abandonné (trop de couples) et l'anneau
    // rendu passait par le bout de la fente.
    let mut input = disc(500.0, 500.0, 500.0, 4000);
    input.pop();
    let k = 3000; // angle 3π/2 : le point bas.
    assert!((input[k][0] - 500.0).abs() < 1e-6 && input[k][1].abs() < 1e-6);
    input.splice(k..=k, [[500.0, 0.0], [500.0, 30.0], [500.0, 5.0]]);
    input.push(input[0]);
    let o = off(&input, -10.0).unwrap();
    assert_eq!(o.applied_distance_mm, -10.0);
    let d = dist_to_point(&o.ring, [500.0, 30.0]);
    assert!(d >= 10.0 - 1e-6 && d <= 10.0 + arc_slack(10.0), "bout de fente à {d}");
    assert!(point_in_ring([500.0, 45.0], open(&o.ring)));
    assert!(!point_in_ring([500.0, 35.0], open(&o.ring)));
}

// ------------------------------------------------------ vides pour le moteur

/// Tôle en C : plaque 400 x 400 dont une baie de 100 x 200 (150..250 x
/// 100..300) s'ouvre sur le bord droit par un couloir de `mouth` mm de haut.
fn c_sheet(mouth: f64) -> Vec<Pt> {
    let (lo, hi) = (200.0 - mouth / 2.0, 200.0 + mouth / 2.0);
    vec![
        [0.0, 0.0], [400.0, 0.0], [400.0, lo], [250.0, lo], [250.0, 100.0], [150.0, 100.0],
        [150.0, 300.0], [250.0, 300.0], [250.0, hi], [400.0, hi], [400.0, 400.0], [0.0, 400.0], [0.0, 0.0],
    ]
}

#[test]
fn the_voids_handed_to_the_engine_are_closed_counter_clockwise_rings_inside_the_container() {
    // Couloir de 12 mm, décalage de 10 : le couloir se referme, la baie reste.
    let input = c_sheet(12.0);
    assert_eq!(off(&input, 10.0).unwrap_err(), OffsetError::EnclosedVoid);
    let opts = OffsetOptions { keep_voids: true, ..OffsetOptions::default() };
    let o = offset_ring(&input, 10.0, &opts, &Deadline::unlimited()).unwrap();
    assert_eq!(o.applied_distance_mm, 10.0);
    assert_clean_ring(&o.ring);
    assert_eq!(o.voids.len(), 1);
    let void = &o.voids[0];
    // Même convention que le conteneur : fermé, anti-horaire, sur la grille.
    assert_clean_ring(void);
    for p in probes(void) {
        // Dans le conteneur, hors de la tôle, à 10 mm de la matière (jamais
        // moins : un vide trop petit laisserait poser une pièce trop loin).
        assert!(point_in_ring(p, open(&o.ring)), "vide hors du conteneur");
        let s = signed_dist(p, &input);
        assert!(s <= 10.0 + 1e-9 && s >= 10.0 - arc_slack(10.0), "{s}");
    }
    // Le cœur de la baie est dans le vide, le couloir refermé n'y est pas.
    assert!(point_in_ring([200.0, 200.0], open(void)));
    assert!(!point_in_ring([330.0, 200.0], open(void)));
    // Un décalage plus petit que le demi-couloir ne ferme rien : pas de vide.
    let open_bay = offset_ring(&input, 5.0, &opts, &Deadline::unlimited()).unwrap();
    assert!(open_bay.voids.is_empty());
    // Une baie plus étroite que deux fois la distance est comblée sans vide.
    let filled = offset_ring(&input, 60.0, &opts, &Deadline::unlimited()).unwrap();
    assert!(filled.voids.is_empty());
    assert!(point_in_ring([200.0, 200.0], open(&filled.ring)));
}

#[test]
fn several_voids_come_largest_first_and_through_the_json_entry() {
    // Deux trous de serrure sur le bord haut : chambres de 100 et de 60 mm.
    let input: Vec<Pt> = vec![
        [0.0, 0.0], [600.0, 0.0], [600.0, 400.0],
        [476.0, 400.0], [476.0, 230.0], [500.0, 230.0], [500.0, 170.0], [440.0, 170.0], [440.0, 230.0],
        [464.0, 230.0], [464.0, 400.0],
        [206.0, 400.0], [206.0, 250.0], [250.0, 250.0], [250.0, 150.0], [150.0, 150.0], [150.0, 250.0],
        [194.0, 250.0], [194.0, 400.0],
        [0.0, 400.0], [0.0, 0.0],
    ];
    let opts = OffsetOptions { keep_voids: true, ..OffsetOptions::default() };
    let o = offset_ring(&input, 10.0, &opts, &Deadline::unlimited()).unwrap();
    assert_eq!(o.voids.len(), 2);
    assert!(area(&o.voids[0]) > area(&o.voids[1]));
    assert!(point_in_ring([200.0, 200.0], open(&o.voids[0])));
    assert!(point_in_ring([470.0, 200.0], open(&o.voids[1])));
    for v in &o.voids {
        assert_clean_ring(v);
    }
    let ring: Vec<String> = input.iter().map(|p| format!("[\"{}\",\"{}\"]", p[0], p[1])).collect();
    let json = format!("{{\"ring\":[{}],\"distance_mm\":\"10\",\"keep_voids\":true}}", ring.join(","));
    let v: serde_json::Value = serde_json::from_str(&offset_ring_json(&json).unwrap()).unwrap();
    assert_eq!(v["voids"].as_array().unwrap().len(), 2);
    assert_eq!(v["voids"], serde_json::to_value(&o.voids).unwrap());
    let refused = json.replace(",\"keep_voids\":true", "");
    assert_eq!(offset_ring_json(&refused).unwrap_err(), OffsetError::EnclosedVoid);
}
