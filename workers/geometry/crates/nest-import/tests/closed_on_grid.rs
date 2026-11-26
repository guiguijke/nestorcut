//! Un contour fermé au dessin le reste à l'arrondi sur la grille de 1e-4 mm.
//!
//! Une coordonnée à mi-chemin de deux pas (pouces au 1/32 ou au 1/64, cinq
//! décimales) s'arrondit d'un côté ou de l'autre pour un écart de 1e-16 : le
//! cercle calculé à 0 et à 360 degrés s'ouvrait, et le bout d'un arc ne tombait
//! plus sur celui du segment voisin. La pièce, le trou ou la zone interdite
//! disparaissait sans un mot.

use nest_import::assemble::ring_signed_area;
use nest_import::budget::Limits;
use nest_import::sheet::{import_sheet_contours, SheetResult};
use nest_import::{import_dxf, ImportResult};
use std::f64::consts::PI;

fn doc(units: i32, blocks: &str, entities: &str) -> Vec<u8> {
    format!(
        "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n{units}\n0\nENDSEC\n{blocks}0\nSECTION\n2\nENTITIES\n{entities}0\nENDSEC\n0\nEOF\n"
    )
    .into_bytes()
}

fn line(a: [f64; 2], b: [f64; 2]) -> String {
    format!("0\nLINE\n8\n0\n10\n{:?}\n20\n{:?}\n11\n{:?}\n21\n{:?}\n", a[0], a[1], b[0], b[1])
}

fn arc(c: [f64; 2], r: f64, a0: f64, a1: f64) -> String {
    format!("0\nARC\n8\n0\n10\n{:?}\n20\n{:?}\n40\n{r:?}\n50\n{a0:?}\n51\n{a1:?}\n", c[0], c[1])
}

fn circle(c: [f64; 2], r: f64) -> String {
    format!("0\nCIRCLE\n8\n0\n10\n{:?}\n20\n{:?}\n40\n{r:?}\n", c[0], c[1])
}

fn ellipse(c: [f64; 2], major: f64, ratio: f64) -> String {
    format!(
        "0\nELLIPSE\n8\n0\n10\n{:?}\n20\n{:?}\n11\n{major:?}\n21\n0.0\n40\n{ratio:?}\n41\n0.0\n42\n{:?}\n",
        c[0], c[1], 2.0 * PI
    )
}

fn polyline(points: &[[f64; 2]], closed: bool) -> String {
    let mut s = format!("0\nLWPOLYLINE\n8\n0\n90\n{}\n70\n{}\n", points.len(), closed as i32);
    for p in points {
        s.push_str(&format!("10\n{:?}\n20\n{:?}\n", p[0], p[1]));
    }
    s
}

fn plate(x0: f64, y0: f64, x1: f64, y1: f64) -> String {
    polyline(&[[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true)
}

/// Rectangle arrondi, coin bas gauche en (x, y), en LINE et ARC.
fn rounded(x: f64, y: f64, w: f64, h: f64, r: f64) -> String {
    [
        line([x + r, y], [x + w - r, y]),
        arc([x + w - r, y + r], r, 270.0, 360.0),
        line([x + w, y + r], [x + w, y + h - r]),
        arc([x + w - r, y + h - r], r, 0.0, 90.0),
        line([x + w - r, y + h], [x + r, y + h]),
        arc([x + r, y + h - r], r, 90.0, 180.0),
        line([x, y + h - r], [x, y + r]),
        arc([x + r, y + r], r, 180.0, 270.0),
    ]
    .concat()
}

fn import(bytes: &[u8]) -> ImportResult {
    import_dxf(bytes, 0.01).expect("import")
}

fn sheet(bytes: &[u8]) -> SheetResult {
    import_sheet_contours(bytes, 0.01, &Limits::unlimited()).expect("tôle")
}

/// Aire de l'unique pièce, trous déduits.
fn only_part_area(r: &ImportResult, holes: usize, what: &str) -> f64 {
    assert_eq!(r.parts.len(), 1, "{what} : pièces");
    assert_eq!(r.parts[0].holes.len(), holes, "{what} : trous");
    let p = &r.parts[0];
    ring_signed_area(&p.coordinates).abs() - p.holes.iter().map(|h| ring_signed_area(h).abs()).sum::<f64>()
}

const IN: f64 = 25.4;

#[test]
fn a_circle_on_a_fraction_of_an_inch_is_a_part() {
    for den in [32.0, 64.0] {
        for k in 1..200 {
            let (cx, cy, r) = (k as f64 / den, (2 * k + 1) as f64 / den, 0.25 + (k % 7) as f64 / den);
            let what = format!("1/{den} k={k}");
            let area = only_part_area(&import(&doc(1, "", &circle([cx, cy], r))), 0, &what);
            let want = PI * (r * IN) * (r * IN);
            assert!((area - want).abs() < 0.01 * 2.0 * PI * r * IN + 0.01, "{what} : {area} / {want}");
        }
    }
}

#[test]
fn a_circle_with_five_decimals_is_a_part() {
    for k in 0..300 {
        let (cx, cy) = (3.00005 + k as f64 * 0.7, 7.12345 + k as f64 * 0.1);
        let (cx, cy) = ((cx * 1e5).round() / 1e5, (cy * 1e5).round() / 1e5);
        only_part_area(&import(&doc(4, "", &circle([cx, cy], 10.0))), 0, &format!("k={k}"));
    }
}

#[test]
fn a_round_or_elliptic_hole_stays_a_hole_and_a_sheet_zone_stays_a_zone() {
    for k in 0..200 {
        let (cx, cy) = (k as f64 / 32.0, (2 * k + 1) as f64 / 32.0);
        for hole in [circle([cx, cy], 0.5), ellipse([cx, cy], 0.75, 0.5), arc([cx, cy], 0.5, 0.0, 360.0)] {
            let d = doc(1, "", &(plate(-4.0, -4.0, 12.0, 18.0) + &hole));
            only_part_area(&import(&d), 1, &format!("k={k}"));
            let s = sheet(&d);
            assert_eq!(s.contours.len(), 2, "k={k} : tôle et zone");
            assert_eq!(s.open_paths, 0, "k={k}");
        }
    }
}

#[test]
fn a_rounded_rectangle_keeps_its_contour_as_a_part_a_hole_and_a_zone() {
    for den in [32.0, 64.0] {
        for k in 0..120 {
            let f = |n: usize| n as f64 / den;
            let (x, y) = (2.0 + f(2 * k + 1), 1.0 + f(k));
            let (w, h, r) = (2.0 + f(k % 13), 1.0 + f(k % 11), 0.25 + f(k % 5));
            let what = format!("1/{den} k={k}");
            let shape = rounded(x, y, w, h, r);
            let want = (w * h - (4.0 - PI) * r * r) * IN * IN;
            let area = only_part_area(&import(&doc(1, "", &shape)), 0, &what);
            assert!((area - want).abs() < 1.0, "{what} : {area} / {want}");
            let d = doc(1, "", &(plate(0.0, 0.0, 12.0, 12.0) + &shape));
            only_part_area(&import(&d), 1, &what);
            assert_eq!(sheet(&d).contours.len(), 2, "{what}");
        }
    }
}

#[test]
fn three_strokes_on_one_joint_give_both_sides() {
    // Cloison droite et un arc de chaque côté : trois bouts par jonction.
    for k in 0..200 {
        let (x, y) = (k as f64 / 32.0, (2 * k + 1) as f64 / 32.0);
        let r = 0.5 + (k % 9) as f64 / 32.0;
        let d = doc(
            1,
            "",
            &[line([x, y - r], [x, y + r]), arc([x, y], r, 270.0, 90.0), arc([x, y], r, 90.0, 270.0)].concat(),
        );
        assert_eq!(sheet(&d).contours.len(), 2, "k={k}");
        let want = PI * (r * IN) * (r * IN);
        let area = only_part_area(&import(&d), 0, &format!("k={k}"));
        assert!((area - want).abs() < 0.02 * want, "k={k} : {area} / {want}");
    }
}

#[test]
fn a_full_turn_arc_survives_a_rotated_block() {
    for (a0, a1) in [(0.0, 360.0), (123.456, 483.456), (90.0, 450.0)] {
        for rot in [0.0, 37.3, 90.0, 211.7, 270.0] {
            let blocks = format!(
                "0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nB\n10\n0.0\n20\n0.0\n{}0\nENDBLK\n0\nENDSEC\n",
                arc([5.0, 2.0], 10.0, a0, a1)
            );
            let ins = format!("0\nINSERT\n8\n0\n2\nB\n10\n3.0\n20\n4.0\n50\n{rot:?}\n");
            let what = format!("{a0}..{a1} tourné de {rot}");
            let area = only_part_area(&import(&doc(4, &blocks, &ins)), 0, &what);
            assert!((area - PI * 100.0).abs() < 1.0, "{what} : {area}");
        }
    }
}

#[test]
fn a_polyline_closed_to_a_few_microns_is_closed_like_on_the_server() {
    // `Polygon` (shapely) referme tout tracé dont les bouts sont à moins de 0,01 mm.
    for gap in [5e-5, 1e-4, 2e-4, 1e-3, 5e-3, 9e-3] {
        let d = doc(4, "", &polyline(&[[0.0, 0.0], [30.0, 0.0], [30.0, 20.0], [0.0, 20.0], [0.0, gap]], false));
        let area = only_part_area(&import(&d), 0, &format!("écart {gap}"));
        assert!((area - 600.0).abs() < 0.2, "{area}");
        assert_eq!(sheet(&d).contours.len(), 1, "écart {gap}");
    }
    let open = doc(4, "", &polyline(&[[0.0, 0.0], [30.0, 0.0], [30.0, 20.0], [0.0, 20.0], [0.0, 0.02]], false));
    assert!(import(&open).parts.is_empty());
}

#[test]
fn free_ends_farther_than_the_join_stay_apart() {
    // Quatre traits dont un coin baille de `gap` : fermé à deux pas, ouvert au-delà.
    let corner = |gap: f64| {
        doc(
            4,
            "",
            &[
                line([0.0, 0.0], [30.0, 0.0]),
                line([30.0, 0.0], [30.0, 20.0]),
                line([30.0, 20.0], [0.0, 20.0]),
                line([0.0, 20.0], [0.0, gap]),
            ]
            .concat(),
        )
    };
    for gap in [1e-4, 2e-4] {
        assert_eq!(import(&corner(gap)).parts.len(), 1, "écart {gap}");
    }
    for gap in [4e-4, 1e-3, 5e-3] {
        assert!(import(&corner(gap)).parts.is_empty(), "écart {gap}");
        assert!(sheet(&corner(gap)).contours.is_empty(), "écart {gap}");
    }
}

#[test]
fn a_tiny_open_stroke_is_not_closed_by_a_chord() {
    // Bouts à moins de 0,01 mm, mais tout le tracé fait moins de 0,1 mm.
    let hook = polyline(&[[5.0, 5.0], [5.006, 5.006], [5.008, 5.0]], false);
    let s = sheet(&doc(4, "", &(plate(0.0, 0.0, 10.0, 10.0) + &hook)));
    assert_eq!(s.contours.len(), 1);
    assert_eq!(s.open_paths, 1);
    // Maillon de 0,0002 mm d'un contour : sans lui, le contour s'ouvrirait.
    let link = polyline(&[[0.0, 5.0], [0.0001, 5.0001], [0.0, 5.0002]], false);
    let around = polyline(&[[0.0, 5.0002], [0.0, 10.0], [10.0, 10.0], [10.0, 0.0], [0.0, 0.0], [0.0, 5.0]], false);
    let r = import(&doc(4, "", &(link + &around)));
    assert_eq!(r.parts.len(), 1);
}

#[test]
fn a_needle_polyline_in_a_sheet_stays_an_open_stroke() {
    // Aller-retour ouvert dont les bouts sont à moins de 0,01 mm : refermé, il
    // ferait une zone de quelques millièmes de mm de large (0,09 mm2 à 20 mm de
    // long). Ce n'est pas une zone : la tôle garde un contour et un trait ouvert.
    for (len, gap) in [(20.0, 0.009), (5.0, 0.003), (0.5, 0.001)] {
        let (x, y, t): (f64, f64, f64) = (40.0, 30.0, 0.7);
        let tip = [x + len * t.cos(), y + len * t.sin()];
        let back = [x - gap * t.sin(), y + gap * t.cos()];
        let needle = polyline(&[[x, y], tip, back], false);
        let s = sheet(&doc(4, "", &(plate(0.0, 0.0, 100.0, 60.0) + &needle)));
        assert_eq!(s.contours.len(), 1, "{len} {gap}");
        assert_eq!(s.open_paths, 1, "{len} {gap}");
    }
}

#[test]
fn a_closing_stroke_that_crosses_its_polyline_adds_no_second_outline() {
    // Rectangle ouvert, bout à 0,00025 mm du départ : le trait de fermeture
    // recoupe le premier côté et laissait une boucle de 1,5e-8 mm2 de rang 1.
    let r = polyline(
        &[
            [370.73218995840705, 417.1482579599765],
            [420.73218995840705, 417.1482579599765],
            [420.73218995840705, 447.1482579599765],
            [370.73218995840705, 447.1482579599765],
            [370.732256747554, 417.14801704669367],
        ],
        false,
    );
    let s = sheet(&doc(4, "", &r));
    assert_eq!(s.contours.len(), 1, "{:?}", s.contours.iter().map(|c| c.area_mm2).collect::<Vec<_>>());
    assert!((s.contours[0].area_mm2 - 1500.0).abs() < 0.01);
}

#[test]
fn a_tiny_compact_zone_of_a_sheet_survives() {
    // 0,045 x 0,045 mm (2e-3 mm2, largeur moyenne 0,0225 mm) : les plus petits
    // contours compacts relevés dans de vrais dessins de tôle sont de cet ordre.
    let dot = plate(50.0, 30.0, 50.045, 30.045);
    let s = sheet(&doc(4, "", &(plate(0.0, 0.0, 100.0, 60.0) + &dot)));
    assert_eq!(s.contours.len(), 2);
    assert_eq!(s.contours[1].depth, 2);
}
