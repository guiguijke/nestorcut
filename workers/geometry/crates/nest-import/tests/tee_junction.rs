//! Arc qui se termine au milieu d'un bord (jonction en T) : la bosse ronde
//! posée sur le côté d'un rectangle fait partie de la pièce.
//!
//! Le bout de l'arc est calculé (cosinus, sinus, rotation, insertion) et tombe
//! à quelques ulp du côté, ou à quelques millièmes de millimètre quand le
//! dessin est écrit avec trois décimales. Le nodage exact ne coupait pas le
//! côté, la bosse restait un trait pendant et la pièce sortait sans elle : un
//! cas sur quatre au fuzz du 25/11 (famille « tee »), trois sur cinq une fois
//! tourné d'un angle quelconque.

use nest_import::budget::Limits;
use nest_import::sheet::{import_sheet_contours, SheetResult};
use nest_import::{assemble::ring_signed_area, import_dxf, ImportResult};
use std::f64::consts::PI;

fn doc(units: i32, entities: &str) -> Vec<u8> {
    format!(
        "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n{units}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n{entities}0\nENDSEC\n0\nEOF\n"
    )
    .into_bytes()
}

/// Nombre écrit en entier (`{:?}`) ou avec `prec` décimales.
fn num(v: f64, prec: Option<usize>) -> String {
    match prec {
        Some(p) => format!("{v:.p$}"),
        None => format!("{v:?}"),
    }
}

fn line(a: [f64; 2], b: [f64; 2], prec: Option<usize>) -> String {
    let n = |v| num(v, prec);
    format!("0\nLINE\n8\n0\n10\n{}\n20\n{}\n11\n{}\n21\n{}\n", n(a[0]), n(a[1]), n(b[0]), n(b[1]))
}

fn arc(c: [f64; 2], r: f64, a0: f64, a1: f64, prec: Option<usize>) -> String {
    let n = |v| num(v, prec);
    format!("0\nARC\n8\n0\n10\n{}\n20\n{}\n40\n{}\n50\n{}\n51\n{}\n", n(c[0]), n(c[1]), n(r), n(a0), n(a1))
}

fn polyline(points: &[[f64; 2]]) -> String {
    let mut s = format!("0\nLWPOLYLINE\n8\n0\n90\n{}\n70\n1\n", points.len());
    for p in points {
        s.push_str(&format!("10\n{:?}\n20\n{:?}\n", p[0], p[1]));
    }
    s
}

/// Rectangle `w`×`h` en quatre LINE, demi-cercle de rayon `r` posé au milieu
/// du côté haut (ses deux bouts au milieu de ce côté, qui n'est pas coupé),
/// le tout tourné de `deg` autour de l'origine puis posé en (x, y). `gap`
/// soulève l'arc au-dessus du côté. Rend les entités et la boîte du contour.
#[allow(clippy::too_many_arguments)]
fn tee(x: f64, y: f64, deg: f64, w: f64, h: f64, r: f64, gap: f64, prec: Option<usize>) -> (String, [f64; 4]) {
    let (s, c) = deg.to_radians().sin_cos();
    let at = |p: [f64; 2]| [x + p[0] * c - p[1] * s, y + p[0] * s + p[1] * c];
    let (a, b, d, e) = (at([0.0, 0.0]), at([w, 0.0]), at([w, h]), at([0.0, h]));
    let ents = [
        line(a, b, prec),
        line(b, d, prec),
        line(d, e, prec),
        line(e, a, prec),
        arc(at([w / 2.0, h + gap]), r, deg, 180.0 + deg, prec),
    ]
    .concat();
    let mut pts = vec![a, b, d, e];
    for k in 0..=32 {
        let t = PI * k as f64 / 32.0;
        pts.push(at([w / 2.0 + r * t.cos(), h + gap + r * t.sin()]));
    }
    let bb = pts.iter().fold([f64::MAX, f64::MAX, f64::MIN, f64::MIN], |m, p| {
        [m[0].min(p[0]), m[1].min(p[1]), m[2].max(p[0]), m[3].max(p[1])]
    });
    (ents, bb)
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

/// Le contour seul, puis le même percé dans une tôle : la bosse est comptée.
#[allow(clippy::too_many_arguments)]
fn check(units: i32, k: f64, prec: Option<usize>, x: f64, y: f64, deg: f64, w: f64, h: f64, r: f64, what: &str) {
    let (ents, bb) = tee(x, y, deg, w, h, r, 0.0, prec);
    let want = (w * h + PI * r * r / 2.0) * k * k;
    // Corde de l'arc à 0,01 mm près : au plus quelques dixièmes de mm² perdus.
    let tol = 0.02 * PI * r * k + 0.05;
    let area = only_part_area(&import(&doc(units, &ents)), 0, what);
    assert!((area - want).abs() < tol, "{what} : {area} / {want}");
    let m = 10.0 / k;
    let plate = polyline(&[[bb[0] - m, bb[1] - m], [bb[2] + m, bb[1] - m], [bb[2] + m, bb[3] + m], [bb[0] - m, bb[3] + m]]);
    let plate_area = (bb[2] - bb[0] + 2.0 * m) * (bb[3] - bb[1] + 2.0 * m) * k * k;
    let d = doc(units, &(plate + &ents));
    let area = only_part_area(&import(&d), 1, &format!("{what}, trou"));
    assert!((area - (plate_area - want)).abs() < tol, "{what}, trou : {area} / {}", plate_area - want);
    let s = sheet(&d);
    assert_eq!(s.open_paths, 0, "{what}, tôle : traits ouverts");
}

#[test]
fn a_round_bump_on_the_middle_of_an_edge_belongs_to_the_part() {
    // Millimètres et pouces, tourné d'un quart de tour ou d'un angle quelconque.
    for k in 0..120 {
        let deg = match k % 4 {
            0 => 0.0,
            1 => 90.0 * (1 + k % 3) as f64,
            _ => 7.3 + 13.7 * k as f64,
        };
        let (x, y) = (-150.0 + 2.9 * k as f64, 80.0 - 1.7 * k as f64);
        let (w, h, r) = (30.0 + (k % 7) as f64 * 4.1, 10.0 + (k % 5) as f64 * 3.3, 3.0 + (k % 6) as f64 * 0.9);
        check(4, 1.0, None, x, y, deg, w, h, r, &format!("mm k={k} {deg}°"));
        let i = 25.4;
        check(1, i, None, x / i, y / i, deg, w / i, h / i, r / i, &format!("pouces k={k} {deg}°"));
    }
}

#[test]
fn a_bump_written_with_three_decimals_still_closes() {
    // Trois décimales : le bout calculé de l'arc tombe jusqu'à ~1 µm du côté
    // écrit (centre, rayon et angles arrondis chacun de leur côté).
    for k in 0..200 {
        let deg = 3.1 + 17.9 * k as f64;
        let (x, y) = (-120.0 + 1.3 * k as f64, 60.0 - 0.7 * k as f64);
        let (w, h, r) = (30.0 + (k % 7) as f64 * 4.1, 10.0 + (k % 5) as f64 * 3.3, 3.0 + (k % 6) as f64 * 0.9);
        check(4, 1.0, Some(3), x, y, deg, w, h, r, &format!("3 décimales k={k} {deg}°"));
    }
}

#[test]
fn an_arc_that_stops_short_of_the_edge_stays_apart() {
    // Bosse soulevée au-delà de 0,005 mm : ce n'est plus une jonction, le
    // rectangle sort seul et la tôle garde un trait ouvert. En deçà, elle tient.
    let (w, h, r) = (40.0, 20.0, 5.0);
    for deg in [0.0, 33.3, 90.0] {
        for gap in [0.006, 0.02] {
            let (ents, _) = tee(5.0, 7.0, deg, w, h, r, gap, None);
            let area = only_part_area(&import(&doc(4, &ents)), 0, &format!("{deg}° {gap}"));
            assert!((area - w * h).abs() < 0.05, "{deg}° {gap} : {area}");
            assert_eq!(sheet(&doc(4, &ents)).open_paths, 1, "{deg}° {gap}");
        }
        let (ents, _) = tee(5.0, 7.0, deg, w, h, r, 0.004, None);
        let area = only_part_area(&import(&doc(4, &ents)), 0, &format!("{deg}° 0,004"));
        assert!((area - (w * h + PI * r * r / 2.0)).abs() < 0.5, "{deg}° 0,004 : {area}");
    }
}

/// Paramètres du k-ième cas, comme les deux premiers tests.
fn case(k: usize) -> (f64, [f64; 2], f64, f64, f64) {
    let deg = 3.1 + 17.9 * k as f64;
    let (w, h, r) = (30.0 + (k % 7) as f64 * 4.1, 10.0 + (k % 5) as f64 * 3.3, 3.0 + (k % 6) as f64 * 0.9);
    (deg, [-120.0 + 1.3 * k as f64, 60.0 - 0.7 * k as f64], w, h, r)
}

fn rotated(deg: f64, at: [f64; 2]) -> impl Fn([f64; 2]) -> [f64; 2] {
    let (s, c) = deg.to_radians().sin_cos();
    move |p: [f64; 2]| [at[0] + p[0] * c - p[1] * s, at[1] + p[0] * s + p[1] * c]
}

fn closed(points: &[[f64; 2]], prec: Option<usize>) -> String {
    let mut s = format!("0\nLWPOLYLINE\n8\n0\n90\n{}\n70\n1\n", points.len());
    for p in points {
        s.push_str(&format!("10\n{}\n20\n{}\n", num(p[0], prec), num(p[1], prec)));
    }
    s
}

/// Pièce d'un seul tenant, sans trou ; Some(true) si la bosse y est, Some(false)
/// si c'est le rectangle seul, None si la pièce est fausse.
fn bump_kept(r: &ImportResult, w: f64, h: f64, rr: f64) -> Option<bool> {
    if r.parts.len() != 1 || !r.parts[0].holes.is_empty() {
        return None;
    }
    let a = ring_signed_area(&r.parts[0].coordinates).abs();
    if (a - (w * h + PI * rr * rr / 2.0)).abs() < 0.02 * PI * rr + 0.05 {
        Some(true)
    } else if (a - w * h).abs() < 0.05 {
        Some(false)
    } else {
        None
    }
}

#[test]
fn a_side_drawn_twice_under_the_bump_never_loses_the_part() {
    // Côté haut redessiné (même sens, sens inverse, ou contour entier en
    // polyligne et en LINE) : la copie que la coupe oubliait laissait le premier
    // segment de l'arc la traverser, et il ne restait que la bosse.
    for dup in 0..3 {
        for prec in [None, Some(3)] {
            let mut kept = 0;
            for k in 0..200 {
                let (deg, at, w, h, r) = case(k);
                let at = rotated(deg, at);
                let (a, b, d, e) = (at([0.0, 0.0]), at([w, 0.0]), at([w, h]), at([0.0, h]));
                let sides = [line(a, b, prec), line(b, d, prec), line(d, e, prec), line(e, a, prec)].concat();
                let ents = match dup {
                    0 => sides + &line(d, e, prec),
                    1 => sides + &line(e, d, prec),
                    _ => closed(&[a, b, d, e], prec) + &sides,
                } + &arc(at([w / 2.0, h]), r, deg, 180.0 + deg, prec);
                let what = format!("copie {dup} {prec:?} k={k}");
                match bump_kept(&import(&doc(4, &ents)), w, h, r) {
                    Some(true) => kept += 1,
                    Some(false) => {}
                    None => panic!("{what} : pièce fausse"),
                }
            }
            assert!(kept >= 195, "copie {dup} {prec:?} : bosse gardée {kept} fois sur 200");
        }
    }
}

#[test]
fn a_side_redrawn_with_three_decimals_does_no_more_harm() {
    // Contour en pleine précision et côté haut redessiné à trois décimales,
    // presque confondu (moins d'un micron). Déjà fragile avant le correctif
    // (23 pièces fausses sur 120 à la relecture du 27/11) ; il en reste 3,
    // les mêmes qu'avant.
    let mut wrong = Vec::new();
    for k in 0..120 {
        let (deg, at, w, h, r) = case(k);
        let at = rotated(deg, at);
        let (a, b, d, e) = (at([0.0, 0.0]), at([w, 0.0]), at([w, h]), at([0.0, h]));
        let ents = closed(&[a, b, d, e], None) + &line(d, e, Some(3)) + &arc(at([w / 2.0, h]), r, deg, 180.0 + deg, None);
        if bump_kept(&import(&doc(4, &ents)), w, h, r).is_none() {
            wrong.push(k);
        }
    }
    assert!(wrong.len() <= 3, "pièces fausses : {wrong:?}");
}

#[test]
fn a_slit_from_a_hole_to_the_edge_keeps_the_hole() {
    // Trait d'un trou jusqu'au bord (fente, trait de scie) : il soudait le trou
    // au bord, et le trou passait pour de la matière. Le serveur l'ignore
    // (GEOS le rend à part) ; le navigateur aussi désormais, bouts calculés ou
    // posés pile.
    for k in 0..120 {
        let (deg, at, w, h, _) = case(k);
        let at = rotated(deg, at);
        let (a, b, d, e) = (at([0.0, 0.0]), at([w, 0.0]), at([w, h]), at([0.0, h]));
        let hole = closed(&[at([10.0, 3.0]), at([20.0, 3.0]), at([20.0, 7.0]), at([10.0, 7.0])], None);
        let ents = closed(&[a, b, d, e], None) + &hole + &line(at([15.0, 7.0]), at([15.0, h]), None);
        let area = only_part_area(&import(&doc(4, &ents)), 1, &format!("k={k}"));
        assert!((area - (w * h - 40.0)).abs() < 0.05, "k={k} : {area}");
    }
    // Pile sur la grille, sans rotation.
    let ents = closed(&[[0.0, 0.0], [40.0, 0.0], [40.0, 20.0], [0.0, 20.0]], None)
        + &closed(&[[10.0, 5.0], [20.0, 5.0], [20.0, 10.0], [10.0, 10.0]], None)
        + &line([15.0, 10.0], [15.0, 20.0], None);
    let area = only_part_area(&import(&doc(4, &ents)), 1, "pile");
    assert!((area - 750.0).abs() < 0.01, "{area}");
}

#[test]
fn a_keyhole_polyline_keeps_its_hole() {
    // Une seule polyligne fermée : le tour de la pièce, une fente de largeur
    // nulle jusqu'au trou, le tour du trou, et retour par la même fente.
    // Aucun bout libre ; la fente est un pont, le trou reste un trou.
    let ring = [
        [0.0, 0.0], [40.0, 0.0], [40.0, 20.0], [15.0, 20.0], [15.0, 10.0], [10.0, 10.0],
        [10.0, 5.0], [20.0, 5.0], [20.0, 10.0], [15.0, 10.0], [15.0, 20.0], [0.0, 20.0],
    ];
    let area = only_part_area(&import(&doc(4, &closed(&ring, None))), 1, "trou de serrure");
    assert!((area - 750.0).abs() < 0.01, "{area}");
}
