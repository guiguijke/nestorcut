//! Distance au bord réglée à part de l'espacement (`verify_layout_edge`).
//! Les valeurs attendues sont des distances axe-alignées calculées à la main,
//! ou la formule du cercle pour le disque.

use super::*;
use crate::shape::SheetShape;

fn sq(id: &str, x0: f64, y0: f64, x1: f64, y1: f64) -> Item {
    Item {
        id: id.into(),
        coords: vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]],
        holes: vec![],
    }
}

fn at(item: &Item) -> Transform {
    Transform { item_id: item.id.clone(), angle: 0.0, x: 0.0, y: 0.0 }
}

fn rect(w: f64, h: f64, items_on: &[&Item]) -> Container {
    Container {
        bin_width: w,
        bin_height: h,
        transforms: items_on.iter().map(|i| at(i)).collect(),
        ..Default::default()
    }
}

fn square_ring(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Pt> {
    vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
}

fn shaped(outer: Vec<Pt>, inner: Vec<Vec<Pt>>, items_on: &[&Item]) -> Container {
    Container {
        bin_width: 1000.0,
        bin_height: 1000.0,
        transforms: items_on.iter().map(|i| at(i)).collect(),
        shape: Some(SheetShape { outer, inner }),
    }
}

/// Disque de rayon 500 centré en (500 ; 500), 360 sommets, anneau fermé.
fn disc() -> Vec<Pt> {
    let mut r: Vec<Pt> = (0..360)
        .map(|k| {
            let a = k as f64 * core::f64::consts::PI / 180.0;
            [500.0 + 500.0 * libm::cos(a), 500.0 + 500.0 * libm::sin(a)]
        })
        .collect();
    r.push(r[0]);
    r
}

fn text(v: &serde_json::Value) -> String {
    serde_json::to_string(v).unwrap()
}

#[test]
fn without_an_edge_the_report_is_the_legacy_one_byte_for_byte() {
    // Rectangle, tôle importée avec zone, pièce seule, pièce dehors : la
    // nouvelle entrée sans `edge` rend la même chaîne que l'ancienne.
    let a = sq("a", 10.0, 10.0, 110.0, 110.0);
    let b = sq("b", 113.0, 10.0, 213.0, 110.0);
    let out = sq("o", -5.0, 300.0, 95.0, 400.0);
    let zone = square_ring(400.0, 400.0, 600.0, 600.0);
    let p = sq("p", 299.5, 450.0, 399.5, 550.0);
    let cases: Vec<(Vec<Container>, Vec<Item>)> = vec![
        (vec![rect(1000.0, 500.0, &[&a, &b])], vec![a.clone(), b.clone()]),
        (vec![rect(1000.0, 500.0, &[&a])], vec![a.clone()]),
        (vec![rect(1000.0, 500.0, &[&a, &out])], vec![a.clone(), out.clone()]),
        (vec![rect(1000.0, 500.0, &[])], vec![]),
        (
            vec![shaped(square_ring(0.0, 0.0, 1000.0, 1000.0), vec![zone.clone()], &[&p, &a])],
            vec![p.clone(), a.clone()],
        ),
        (vec![shaped(disc(), vec![], &[&a, &p])], vec![a.clone(), p.clone()]),
    ];
    for (containers, items) in &cases {
        for space in [0.0, 2.0, 5.0] {
            let legacy = verify_layout(containers, items, space);
            let none = verify_layout_edge(containers, items, space, None);
            assert_eq!(text(&legacy), text(&none));
            assert!(legacy.get("edgeGapMm").is_none(), "{legacy}");
            assert!(legacy.get("edgeOk").is_none(), "{legacy}");
        }
    }
}

#[test]
fn the_legacy_report_string_of_a_rectangular_job_did_not_move() {
    // Chaîne relevée sur le code d'avant ce lot (mêmes entrées, espacement 2).
    let a = sq("a", 10.0, 10.0, 110.0, 110.0);
    let b = sq("b", 113.0, 10.0, 213.0, 110.0);
    let c = rect(1000.0, 500.0, &[&a, &b]);
    let r = verify_layout(&[c], &[a, b], 2.0);
    assert_eq!(
        text(&r),
        r#"{"duplicatePoses":0,"holesFilled":0,"holesOverflow":0,"holesTotal":0,"insideSheet":true,"overlapFree":true,"smallestGapMm":3.0,"spacingOk":true,"verifyStatus":"measured"}"#
    );
}

#[test]
fn a_part_closer_to_the_edge_than_the_spacing_is_fine_when_the_edge_allows_it() {
    // Espacement 5, bord 1. Pièce à 1 mm du bord gauche, l'autre à 6 mm d'elle.
    let a = sq("a", 1.0, 20.0, 101.0, 120.0);
    let b = sq("b", 107.0, 20.0, 207.0, 120.0);
    let c = rect(1000.0, 500.0, &[&a, &b]);
    let items = [a, b];
    let legacy = verify_layout(std::slice::from_ref(&c), &items, 5.0);
    assert_eq!(legacy["smallestGapMm"], serde_json::json!(1.0), "{legacy}");
    assert_eq!(legacy["spacingOk"], serde_json::json!(false), "{legacy}");
    let r = verify_layout_edge(&[c], &items, 5.0, Some(1.0));
    assert_eq!(r["smallestGapMm"], serde_json::json!(6.0), "{r}");
    assert_eq!(r["spacingOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["edgeGapMm"], serde_json::json!(1.0), "{r}");
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["insideSheet"], serde_json::json!(true), "{r}");
}

#[test]
fn a_part_closer_to_the_edge_than_the_edge_distance_is_not_edge_ok() {
    // Bord 10 plus grand que l'espacement 2 : une pièce à 4 mm du bord est en
    // faute au bord, pas à l'espacement.
    let a = sq("a", 4.0, 20.0, 104.0, 120.0);
    let b = sq("b", 107.0, 20.0, 207.0, 120.0);
    let c = rect(1000.0, 500.0, &[&a, &b]);
    let r = verify_layout_edge(&[c], &[a, b], 2.0, Some(10.0));
    assert_eq!(r["edgeGapMm"], serde_json::json!(4.0), "{r}");
    assert_eq!(r["edgeOk"], serde_json::json!(false), "{r}");
    assert_eq!(r["smallestGapMm"], serde_json::json!(3.0), "{r}");
    assert_eq!(r["spacingOk"], serde_json::json!(true), "{r}");
}

#[test]
fn an_overhang_within_the_negative_edge_stays_inside_the_sheet() {
    // Bord -10 : la pièce dépasse de 8 mm à gauche et de 10 mm en haut.
    let a = sq("a", -8.0, 410.0, 92.0, 510.0);
    let c = rect(1000.0, 500.0, &[&a]);
    let items = [a];
    let r = verify_layout_edge(std::slice::from_ref(&c), &items, 2.0, Some(-10.0));
    assert_eq!(r["insideSheet"], serde_json::json!(true), "{r}");
    assert_eq!(r["edgeGapMm"], serde_json::json!(-10.0), "{r}");
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    // Une seule pièce, pas de zone : rien à mesurer entre pièces, rien de violé.
    assert_eq!(r["smallestGapMm"], serde_json::Value::Null, "{r}");
    assert_eq!(r["spacingOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["overlapFree"], serde_json::json!(true), "{r}");
    assert_eq!(r["verifyStatus"], serde_json::json!("measured"), "{r}");
    // Le même dépassement sans distance au bord : hors tôle, comme avant.
    let legacy = verify_layout(&[c], &items, 2.0);
    assert_eq!(legacy["insideSheet"], serde_json::json!(false), "{legacy}");
}

#[test]
fn an_overhang_deeper_than_the_negative_edge_is_outside_the_sheet() {
    // Bord -10, dépassement de 10,5 mm à droite.
    let a = sq("a", 910.5, 100.0, 1010.5, 200.0);
    let c = rect(1000.0, 500.0, &[&a]);
    let r = verify_layout_edge(&[c], &[a], 2.0, Some(-10.0));
    assert_eq!(r["insideSheet"], serde_json::json!(false), "{r}");
    assert_eq!(r["edgeGapMm"], serde_json::json!(-10.5), "{r}");
    assert_eq!(r["edgeOk"], serde_json::json!(false), "{r}");
}

#[test]
fn a_positive_edge_does_not_widen_the_inside_tolerance() {
    // Bord +10 : une pièce qui sort de 0,5 mm reste hors tôle.
    let a = sq("a", -0.5, 100.0, 99.5, 200.0);
    let c = rect(1000.0, 500.0, &[&a]);
    let r = verify_layout_edge(&[c], &[a], 2.0, Some(10.0));
    assert_eq!(r["insideSheet"], serde_json::json!(false), "{r}");
    assert_eq!(r["edgeGapMm"], serde_json::json!(-0.5), "{r}");
    assert_eq!(r["edgeOk"], serde_json::json!(false), "{r}");
}

#[test]
fn the_edge_gap_is_measured_on_every_sheet() {
    let a = sq("a", 20.0, 20.0, 120.0, 120.0);
    let b = sq("b", 3.0, 20.0, 103.0, 120.0);
    let r = verify_layout_edge(
        &[rect(1000.0, 500.0, &[&a]), rect(1000.0, 500.0, &[&b])],
        &[a, b],
        2.0,
        Some(5.0),
    );
    assert_eq!(r["edgeGapMm"], serde_json::json!(3.0), "{r}");
    assert_eq!(r["edgeOk"], serde_json::json!(false), "{r}");
}

#[test]
fn an_empty_layout_with_an_edge_has_nothing_to_blame() {
    let r = verify_layout_edge(&[rect(1000.0, 500.0, &[])], &[], 2.0, Some(-3.0));
    assert_eq!(r["edgeGapMm"], serde_json::Value::Null, "{r}");
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["spacingOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["smallestGapMm"], serde_json::Value::Null, "{r}");
}

#[test]
fn a_zone_gap_is_still_judged_at_the_spacing() {
    // Tôle importée carrée, zone (400..600)². Bord 0,2, espacement 2 : la pièce
    // à 0,5 mm de la zone est en faute d'espacement, celle à 0,3 mm du bord non.
    let zone = square_ring(400.0, 400.0, 600.0, 600.0);
    let near_zone = sq("z", 299.5, 450.0, 399.5, 550.0);
    let near_edge = sq("e", 0.3, 700.0, 100.3, 800.0);
    let c = shaped(
        square_ring(0.0, 0.0, 1000.0, 1000.0),
        vec![zone],
        &[&near_zone, &near_edge],
    );
    let r = verify_layout_edge(&[c], &[near_zone, near_edge], 2.0, Some(0.2));
    assert_eq!(r["minDistToZoneMm"], serde_json::json!(0.5), "{r}");
    assert_eq!(r["smallestGapMm"], serde_json::json!(0.5), "{r}");
    assert_eq!(r["spacingOk"], serde_json::json!(false), "{r}");
    assert_eq!(r["edgeGapMm"], serde_json::json!(0.3), "{r}");
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["insideSheet"], serde_json::json!(true), "{r}");
    assert_eq!(r["zoneClear"], serde_json::json!(true), "{r}");
}

#[test]
fn a_negative_edge_does_not_let_a_part_enter_a_zone() {
    // Bord -20 : le dépassement vaut pour le contour, jamais pour une zone.
    let zone = square_ring(400.0, 400.0, 600.0, 600.0);
    let p = sq("p", 310.0, 450.0, 410.0, 550.0);
    let c = shaped(square_ring(0.0, 0.0, 1000.0, 1000.0), vec![zone], &[&p]);
    let r = verify_layout_edge(&[c], &[p], 2.0, Some(-20.0));
    assert_eq!(r["zoneViolations"], serde_json::json!(1), "{r}");
    assert_eq!(r["zoneClear"], serde_json::json!(false), "{r}");
    assert_eq!(r["spacingOk"], serde_json::json!(false), "{r}");
    assert_eq!(r["insideSheet"], serde_json::json!(true), "{r}");
}

#[test]
fn a_disc_with_a_negative_edge_admits_a_bounded_overhang() {
    // Disque de rayon 500 (polygone à 360 côtés). Carré de 100 dont le coin
    // droit bas est à (995 ; 500), le haut à (995 ; 600) : le coin haut est à
    // sqrt(495² + 100²) = 505,0000 du centre, soit 5 mm hors du cercle. Sur le
    // polygone, la profondeur est entre 5 et 5 + flèche (0,019 mm).
    let p = sq("p", 895.0, 500.0, 995.0, 600.0);
    let exact = libm::sqrt(495.0 * 495.0 + 100.0 * 100.0) - 500.0;
    let c = shaped(disc(), vec![], &[&p]);
    let items = [p];
    let ok = verify_layout_edge(std::slice::from_ref(&c), &items, 2.0, Some(-6.0));
    let gap = ok["edgeGapMm"].as_f64().unwrap();
    assert!(-gap >= exact - 1e-3 && -gap <= exact + 0.02, "{ok}");
    assert_eq!(ok["insideSheet"], serde_json::json!(true), "{ok}");
    assert_eq!(ok["edgeOk"], serde_json::json!(true), "{ok}");
    assert_eq!(ok["partsOutsideOutline"], serde_json::json!(0), "{ok}");
    assert_eq!(ok["minDistToOutlineMm"], ok["edgeGapMm"], "{ok}");
    // Bord -4 : le même dépassement est trop profond.
    let ko = verify_layout_edge(std::slice::from_ref(&c), &items, 2.0, Some(-4.0));
    assert_eq!(ko["insideSheet"], serde_json::json!(false), "{ko}");
    assert_eq!(ko["edgeOk"], serde_json::json!(false), "{ko}");
    assert_eq!(ko["partsOutsideOutline"], serde_json::json!(1), "{ko}");
    // Sans distance au bord : hors tôle, comme avant.
    let legacy = verify_layout(&[c], &items, 2.0);
    assert_eq!(legacy["insideSheet"], serde_json::json!(false), "{legacy}");
}

#[test]
fn a_part_inside_a_disc_reports_its_real_gap_to_the_outline() {
    // Carré (450..550)² au centre : le coin est à 500 - 50·sqrt(2) du cercle,
    // un peu moins du polygone (flèche 0,019 mm au plus).
    let p = sq("p", 450.0, 450.0, 550.0, 550.0);
    let c = shaped(disc(), vec![], &[&p]);
    let r = verify_layout_edge(&[c], &[p], 2.0, Some(30.0));
    let want = 500.0 - 50.0 * core::f64::consts::SQRT_2;
    let gap = r["edgeGapMm"].as_f64().unwrap();
    assert!(gap <= want + 1e-3 && gap >= want - 0.02, "{r}");
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["smallestGapMm"], serde_json::Value::Null, "{r}");
    assert_eq!(r["spacingOk"], serde_json::json!(true), "{r}");
}

#[test]
fn the_overhang_depth_across_a_notch_is_the_true_maximum() {
    // Carré 1000 x 1000 avec une fente (x 400..600, y 400..1000) ouverte en
    // haut. La barre (330..700) x (600..620) traverse la fente : ses bords y
    // sont dehors sur 200 mm, au plus à 100 mm d'une paroi, au milieu de la
    // fente (x = 500). Les quarts de l'ancien échantillonnage tombent ailleurs
    // (la barre n'est pas centrée) : seul le maximum exact donne 100.
    let notch = vec![
        [0.0, 0.0], [1000.0, 0.0], [1000.0, 1000.0], [600.0, 1000.0],
        [600.0, 400.0], [400.0, 400.0], [400.0, 1000.0], [0.0, 1000.0], [0.0, 0.0],
    ];
    let bar = sq("bar", 330.0, 600.0, 700.0, 620.0);
    let sheet = SheetShape { outer: notch.clone(), inner: vec![] };
    let ready = sheet.ready().unwrap();
    let ring = shape::closed(&bar.coords);
    let exact = shape::outside_depth_exact(&ring, &ready);
    assert!((exact - 100.0).abs() <= 1e-5, "{exact}");
    assert!(shape::outside_depth(&ring, &ready) <= exact + 1e-9);
    let c = shaped(notch, vec![], &[&bar]);
    let items = [bar];
    let ok = verify_layout_edge(std::slice::from_ref(&c), &items, 2.0, Some(-100.0));
    assert_eq!(ok["edgeGapMm"], serde_json::json!(-100.0), "{ok}");
    assert_eq!(ok["insideSheet"], serde_json::json!(true), "{ok}");
    let ko = verify_layout_edge(&[c], &items, 2.0, Some(-99.5));
    assert_eq!(ko["insideSheet"], serde_json::json!(false), "{ko}");
    assert_eq!(ko["edgeOk"], serde_json::json!(false), "{ko}");
}

#[test]
fn the_exact_depth_matches_a_dense_sampling_on_a_slanted_bar() {
    // Barre inclinée à travers la même fente : comparaison à un échantillonnage
    // serré des bords (20 000 points par arête).
    let notch = vec![
        [0.0, 0.0], [1000.0, 0.0], [1000.0, 1000.0], [600.0, 1000.0],
        [600.0, 400.0], [400.0, 400.0], [400.0, 1000.0], [0.0, 1000.0], [0.0, 0.0],
    ];
    let ready = SheetShape { outer: notch, inner: vec![] }.ready().unwrap();
    let bar: Vec<Pt> = vec![[310.0, 500.0], [690.0, 640.0], [685.0, 660.0], [305.0, 520.0], [310.0, 500.0]];
    let exact = shape::outside_depth_exact(&bar, &ready);
    let mut dense = 0.0f64;
    for w in bar.windows(2) {
        for k in 0..=20_000 {
            let t = k as f64 / 20_000.0;
            let p = [w[0][0] + t * (w[1][0] - w[0][0]), w[0][1] + t * (w[1][1] - w[0][1])];
            if !geom::point_in_ring(p, &ready.outer) {
                let mut d = f64::INFINITY;
                for e in ready.outer.windows(2) {
                    d = d.min(geom::point_seg_dist(p, e[0], e[1]));
                }
                dense = dense.max(d);
            }
        }
    }
    assert!(exact >= dense - 1e-9, "exact {exact} < dense {dense}");
    assert!(exact <= dense + 0.02, "exact {exact} dense {dense}");
}

#[test]
fn an_unreadable_shape_gives_no_edge_verdict() {
    let p = sq("p", 10.0, 10.0, 110.0, 110.0);
    let c = shaped(vec![[0.0, 0.0], [1.0, 1.0]], vec![], &[&p]);
    let r = verify_layout_edge(&[c], &[p], 2.0, Some(1.0));
    assert_eq!(r["edgeGapMm"], serde_json::Value::Null, "{r}");
    assert_eq!(r["edgeOk"], serde_json::Value::Null, "{r}");
    assert_eq!(r["insideSheet"], serde_json::Value::Null, "{r}");
    assert_eq!(r["verifyStatus"], serde_json::json!("skipped"), "{r}");
}

#[test]
fn an_edge_equal_to_the_spacing_keeps_the_same_verdicts() {
    // Bord = espacement : les verdicts ne changent pas (le rapport, lui, range
    // l'écart au bord à part).
    let a = sq("a", 2.0, 2.0, 102.0, 102.0);
    let b = sq("b", 104.0, 2.0, 204.0, 102.0);
    let c = rect(1000.0, 500.0, &[&a, &b]);
    let items = [a, b];
    let legacy = verify_layout(std::slice::from_ref(&c), &items, 2.0);
    let r = verify_layout_edge(&[c], &items, 2.0, Some(2.0));
    for k in ["insideSheet", "overlapFree", "spacingOk", "duplicatePoses", "verifyStatus"] {
        assert_eq!(legacy[k], r[k], "{k}");
    }
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["edgeGapMm"], serde_json::json!(2.0), "{r}");
}

// ------------------------------------------------- tolérance de `insideSheet`

fn poly(id: &str, pts: &[Pt]) -> Item {
    let mut coords = pts.to_vec();
    coords.push(pts[0]);
    Item { id: id.into(), coords, holes: vec![] }
}

#[test]
fn a_rectangular_sheet_tolerates_what_edge_ok_tolerates() {
    // Le moteur lit la tôle décalée en f32 : une pose au ras de la limite peut la
    // passer de quelques dix-millièmes. `insideSheet` suit `edgeOk` (0,01 mm),
    // au bord 0 comme au bord négatif.
    for (edge, limit) in [(0.0, 0.0), (-5.0, 5.0)] {
        let within = sq("a", -(limit + 0.005), 100.0, 100.0, 200.0);
        let r = verify_layout_edge(&[rect(1000.0, 500.0, &[&within])], &[within], 2.0, Some(edge));
        assert_eq!(r["insideSheet"], serde_json::json!(true), "bord {edge} : {r}");
        assert_eq!(r["edgeOk"], serde_json::json!(true), "bord {edge} : {r}");
        let beyond = sq("a", 900.0, 100.0, 1000.0 + limit + 0.02, 200.0);
        let r = verify_layout_edge(&[rect(1000.0, 500.0, &[&beyond])], &[beyond], 2.0, Some(edge));
        assert_eq!(r["insideSheet"], serde_json::json!(false), "bord {edge} : {r}");
        assert_eq!(r["edgeOk"], serde_json::json!(false), "bord {edge} : {r}");
        // En haut aussi (les quatre côtés ont la même tolérance).
        let top = sq("a", 100.0, 400.0, 200.0, 500.0 + limit + 0.005);
        let r = verify_layout_edge(&[rect(1000.0, 500.0, &[&top])], &[top], 2.0, Some(edge));
        assert_eq!(r["insideSheet"], serde_json::json!(true), "bord {edge} : {r}");
    }
}

#[test]
fn without_an_edge_the_rectangular_tolerance_stays_at_inside_eps() {
    let just = sq("a", -5e-7, 100.0, 100.0, 200.0);
    let r = verify_layout(&[rect(1000.0, 500.0, &[&just])], &[just], 2.0);
    assert_eq!(r["insideSheet"], serde_json::json!(true), "{r}");
    let out = sq("a", -1e-5, 100.0, 100.0, 200.0);
    let r = verify_layout(&[rect(1000.0, 500.0, &[&out])], &[out], 2.0);
    assert_eq!(r["insideSheet"], serde_json::json!(false), "{r}");
}

// ------------------------------------- pièce presque sans matière sur la tôle

/// Équerre de 100 x 100, ailes de 12 mm, coin extérieur en (x ; y).
fn bracket(id: &str, x: f64, y: f64) -> Item {
    poly(
        id,
        &[[x, y], [x + 100.0, y], [x + 100.0, y + 12.0], [x + 12.0, y + 12.0], [x + 12.0, y + 100.0], [x, y + 100.0]],
    )
}

#[test]
fn a_bracket_lying_wholly_in_the_overhang_band_is_outside_the_sheet() {
    // Bord -45 : la boîte de l'équerre dépasse de 45 mm, c'est permis, mais
    // toute sa matière est en x <= -33 ou y <= -33 : rien sur la tôle.
    let l = bracket("l", -45.0, -45.0);
    let r = verify_layout_edge(&[rect(400.0, 300.0, &[&l])], std::slice::from_ref(&l), 2.0, Some(-45.0));
    assert_eq!(r["edgeGapMm"], serde_json::json!(-45.0), "{r}");
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["insideSheet"], serde_json::json!(false), "{r}");
    // La même équerre avancée de 40 mm : ses ailes sont sur la tôle.
    let on = bracket("l", -5.0, -5.0);
    let r = verify_layout_edge(&[rect(400.0, 300.0, &[&on])], &[on], 2.0, Some(-45.0));
    assert_eq!(r["insideSheet"], serde_json::json!(true), "{r}");
    // Dans le coin opposé (400 ; 300), tournée d'un demi-tour et parcourue dans
    // l'autre sens : pareil.
    let far = poly(
        "l",
        &[[445.0, 345.0], [445.0, 245.0], [433.0, 245.0], [433.0, 333.0], [345.0, 333.0], [345.0, 345.0]],
    );
    let r = verify_layout_edge(&[rect(400.0, 300.0, &[&far])], &[far], 2.0, Some(-45.0));
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["insideSheet"], serde_json::json!(false), "{r}");
}

#[test]
fn a_triangle_touching_the_sheet_by_its_tip_is_outside_the_sheet() {
    // Triangle rectangle de côté 100, hypoténuse vers la tôle : à (-50 ; -50)
    // elle passe par le coin, la tôle n'en reçoit qu'un point.
    let t = poly("t", &[[-50.0, -50.0], [50.0, -50.0], [-50.0, 50.0]]);
    let r = verify_layout_edge(&[rect(400.0, 300.0, &[&t])], &[t], 2.0, Some(-50.0));
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["insideSheet"], serde_json::json!(false), "{r}");
    // Seuil de 1 % : le triangle de côté 100 (aire 5000) avancé de `k` a sur la
    // tôle un triangle de côté 2k, d'aire 2k². 1 % = 50 mm², soit k = 5.
    for (k, inside) in [(4.5, false), (5.5, true)] {
        let t = poly("t", &[[-50.0 + k, -50.0 + k], [50.0 + k, -50.0 + k], [-50.0 + k, 50.0 + k]]);
        let r = verify_layout_edge(&[rect(400.0, 300.0, &[&t])], &[t], 2.0, Some(-50.0));
        assert_eq!(r["insideSheet"], serde_json::json!(inside), "k = {k} : {r}");
    }
}

#[test]
fn a_frame_whose_hole_covers_the_sheet_corner_is_outside_the_sheet() {
    // Cadre (-10..10)², trou (-5..9,95)² : de la tôle il ne couvre que
    // 100 - 9,95² = 0,9975 mm², pour 400 - 14,95² = 176,5 mm² de matière.
    let frame = Item {
        id: "f".into(),
        coords: square_ring(-10.0, -10.0, 10.0, 10.0),
        holes: vec![square_ring(-5.0, -5.0, 9.95, 9.95)],
    };
    let r = verify_layout_edge(&[rect(400.0, 300.0, &[&frame])], &[frame], 2.0, Some(-10.0));
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["insideSheet"], serde_json::json!(false), "{r}");
    // Sans le trou, le quart de la pièce est sur la tôle.
    let plain = sq("f", -10.0, -10.0, 10.0, 10.0);
    let r = verify_layout_edge(&[rect(400.0, 300.0, &[&plain])], &[plain], 2.0, Some(-10.0));
    assert_eq!(r["insideSheet"], serde_json::json!(true), "{r}");
}

#[test]
fn the_material_rule_only_applies_when_an_overhang_is_allowed() {
    // Bord positif ou nul : une pièce hors tôle l'est déjà par sa boîte, et la
    // règle de matière ne se déclenche jamais pour une pièce dedans.
    let a = sq("a", 0.0, 0.0, 100.0, 100.0);
    for edge in [0.0, 5.0] {
        let r = verify_layout_edge(&[rect(400.0, 300.0, &[&a])], std::slice::from_ref(&a), 2.0, Some(edge));
        assert_eq!(r["insideSheet"], serde_json::json!(true), "bord {edge} : {r}");
    }
}

#[test]
fn on_an_imported_sheet_a_part_with_no_material_on_it_is_counted_outside() {
    let outline = || square_ring(0.0, 0.0, 1000.0, 1000.0);
    // Barre de 10 mm le long du bord gauche, entièrement dehors (x -12..-2) :
    // dépassement de 12 mm, permis au bord -12.
    let bar = sq("b", -12.0, 100.0, -2.0, 400.0);
    let r = verify_layout_edge(&[shaped(outline(), vec![], &[&bar])], &[bar], 2.0, Some(-12.0));
    assert_eq!(r["edgeGapMm"], serde_json::json!(-12.0), "{r}");
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["partsOutsideOutline"], serde_json::json!(1), "{r}");
    assert_eq!(r["insideSheet"], serde_json::json!(false), "{r}");
    // La même barre AU RAS du bord (x -10..0) : bords confondus de sens opposés,
    // aire commune nulle.
    let flush = sq("b", -10.0, 100.0, 0.0, 400.0);
    let r = verify_layout_edge(&[shaped(outline(), vec![], &[&flush])], &[flush], 2.0, Some(-12.0));
    assert_eq!(r["partsOutsideOutline"], serde_json::json!(1), "{r}");
    assert_eq!(r["insideSheet"], serde_json::json!(false), "{r}");
    // Équerre dans le coin : son coin est à 45·sqrt(2) = 63,64 mm du contour.
    let l = bracket("l", -45.0, -45.0);
    let r = verify_layout_edge(&[shaped(outline(), vec![], &[&l])], &[l], 2.0, Some(-70.0));
    assert_eq!(r["edgeGapMm"], serde_json::json!(-63.64), "{r}");
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["partsOutsideOutline"], serde_json::json!(1), "{r}");
    assert_eq!(r["insideSheet"], serde_json::json!(false), "{r}");
    // Une pièce qui dépasse en gardant sa matière sur la tôle reste dedans, et
    // une pièce déjà trop profonde n'est comptée qu'une fois.
    let half = sq("h", -12.0, 100.0, 88.0, 400.0);
    let deep = sq("d", -30.0, 500.0, -20.0, 600.0);
    let c = shaped(outline(), vec![], &[&half, &deep]);
    let r = verify_layout_edge(&[c], &[half, deep], 2.0, Some(-12.0));
    assert_eq!(r["partsOutsideOutline"], serde_json::json!(1), "{r}");
    // Sur le disque : carré de 20 mm posé hors du cercle, à 1 mm du bord droit.
    let off = sq("o", 1001.0, 490.0, 1021.0, 510.0);
    let r = verify_layout_edge(&[shaped(disc(), vec![], &[&off])], &[off], 2.0, Some(-25.0));
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["partsOutsideOutline"], serde_json::json!(1), "{r}");
}

// ---------------------------------------------- cavité à l'embouchure étroite

/// Tôle 1000 x 1000 dont le bord bas porte un trou de serrure : fente de 1 mm
/// (x 499,5..500,5 ; y 0..5) qui débouche sur une chambre de 8 x 8
/// (x 496..504 ; y 5..13).
fn keyhole_sheet() -> Vec<Pt> {
    vec![
        [0.0, 0.0], [499.5, 0.0], [499.5, 5.0], [496.0, 5.0], [496.0, 13.0], [504.0, 13.0],
        [504.0, 5.0], [500.5, 5.0], [500.5, 0.0], [1000.0, 0.0], [1000.0, 1000.0], [0.0, 1000.0],
        [0.0, 0.0],
    ]
}

#[test]
fn a_part_swallowing_a_narrow_mouthed_cavity_is_only_caught_through_a_zone() {
    // Espacement 2, bord -3. La pièce (450..550 x 2..102) couvre toute la
    // chambre, dont le centre (500 ; 9) est à 4 mm de la matière : plus que les
    // 3 mm permis. Mais aucun BORD de la pièce n'est dans la chambre : le bord
    // bas ne traverse que la fente, à 0,5 mm de ses parois.
    //
    // Le contrôle du contour ne suit que les bords de la pièce : il reste VERT.
    // Ce test fixe cette limite (voir `check_sheet_edge`). Le constructeur du
    // payload DOIT donc passer la chambre au moteur comme zone interdite : les
    // vides de `offset_ring(contour, |bord|, keep_voids)`.
    let p = sq("p", 450.0, 2.0, 550.0, 102.0);
    let bare = shaped(keyhole_sheet(), vec![], &[&p]);
    let r = verify_layout_edge(&[bare], std::slice::from_ref(&p), 2.0, Some(-3.0));
    assert_eq!(r["edgeGapMm"], serde_json::json!(-0.5), "{r}");
    assert_eq!(r["edgeOk"], serde_json::json!(true), "{r}");
    assert_eq!(r["insideSheet"], serde_json::json!(true), "{r}");
    assert_eq!(r["partsOutsideOutline"], serde_json::json!(0), "{r}");
    // Avec la zone (ici le cœur de la chambre, à 3 mm au moins de la matière) :
    // la même pose est une violation, mesurée par l'aire commune.
    let void = square_ring(499.0, 8.0, 501.0, 10.0);
    let zoned = shaped(keyhole_sheet(), vec![void], &[&p]);
    let r = verify_layout_edge(&[zoned], &[p], 2.0, Some(-3.0));
    assert_eq!(r["zoneViolations"], serde_json::json!(1), "{r}");
    assert_eq!(r["zoneClear"], serde_json::json!(false), "{r}");
    assert_eq!(r["zoneOverlapAreaMm2"], serde_json::json!(4.0), "{r}");
    assert_eq!(r["spacingOk"], serde_json::json!(false), "{r}");
}
