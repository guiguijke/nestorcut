//! Rapport sur la forme d'une tôle importée : contour courbe, encoche concave,
//! zones interdites, aires utiles. Les valeurs attendues sont calculées à la
//! main (aires de rectangles, distances axe-alignées) ou par la formule du
//! polygone régulier.

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

fn shaped(outer: Vec<Pt>, inner: Vec<Vec<Pt>>, items_on: &[&Item]) -> Container {
    Container {
        bin_width: 1000.0,
        bin_height: 1000.0,
        transforms: items_on.iter().map(|i| at(i)).collect(),
        shape: Some(SheetShape { outer, inner }),
    }
}

fn square_ring(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Pt> {
    vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
}

#[test]
fn a_part_in_the_bbox_corner_is_outside_the_disc() {
    // Le coin (0,0)-(100,100) est dans la boîte mais à ~600 mm du disque.
    let corner = sq("c", 0.0, 0.0, 100.0, 100.0);
    let c = shaped(disc(), vec![], &[&corner]);
    let r = verify_layout(&[c], &[corner], 2.0);
    assert_eq!(r["insideSheet"], serde_json::json!(false), "{r}");
    assert_eq!(r["partsOutsideOutline"], serde_json::json!(1), "{r}");
    assert!(r["minDistToOutlineMm"].as_f64().unwrap() < -100.0, "{r}");
}

#[test]
fn the_same_corner_part_passes_the_old_bbox_test_on_a_rectangle() {
    // Garde-fou : sans forme, la pièce de coin est « dans la tôle ».
    let corner = sq("c", 0.0, 0.0, 100.0, 100.0);
    let c = Container {
        bin_width: 1000.0,
        bin_height: 1000.0,
        transforms: vec![at(&corner)],
        ..Default::default()
    };
    let r = verify_layout(&[c], &[corner], 2.0);
    assert_eq!(r["insideSheet"], serde_json::json!(true), "{r}");
    assert!(r.get("partsOutsideOutline").is_none(), "{r}");
    assert!(r.get("zoneClear").is_none(), "{r}");
}

#[test]
fn a_part_across_a_concave_notch_with_both_ends_inside_is_outside() {
    // Carré 1000 x 1000 dont une fente (x 400..600, y 400..1000) est ôtée par
    // le haut. La barre (300 ; 600)-(700 ; 620) a ses quatre sommets dans la
    // tôle (bras gauche et droit) mais ses longs bords traversent la fente.
    let notch = vec![
        [0.0, 0.0], [1000.0, 0.0], [1000.0, 1000.0], [600.0, 1000.0],
        [600.0, 400.0], [400.0, 400.0], [400.0, 1000.0], [0.0, 1000.0], [0.0, 0.0],
    ];
    let bar = sq("bar", 300.0, 600.0, 700.0, 620.0);
    let c = shaped(notch.clone(), vec![], &[&bar]);
    let r = verify_layout(&[c], &[bar], 2.0);
    assert_eq!(r["insideSheet"], serde_json::json!(false), "{r}");
    assert_eq!(r["partsOutsideOutline"], serde_json::json!(1), "{r}");
    // La traversée dépasse de 100 mm (moitié de la fente) au plus.
    let d = r["minDistToOutlineMm"].as_f64().unwrap();
    assert!(d < -90.0 && d > -101.0, "{r}");
    // Une pièce qui reste dans un bras est dedans.
    let arm = sq("arm", 50.0, 600.0, 350.0, 620.0);
    let c2 = shaped(notch, vec![], &[&arm]);
    let r2 = verify_layout(&[c2], &[arm], 2.0);
    assert_eq!(r2["insideSheet"], serde_json::json!(true), "{r2}");
    assert_eq!(r2["minDistToOutlineMm"], serde_json::json!(50.0), "{r2}");
}

#[test]
fn outline_tolerance_separates_noise_from_a_real_exit() {
    // Tôle carrée ; la pièce dépasse du bord droit de 0,005 mm (bruit) puis de 0,05 mm.
    let ring = square_ring(0.0, 0.0, 1000.0, 1000.0);
    let noise = sq("n", 900.0, 100.0, 1000.005, 200.0);
    let r = verify_layout(&[shaped(ring.clone(), vec![], &[&noise])], &[noise], 0.0);
    assert_eq!(r["insideSheet"], serde_json::json!(true), "{r}");
    assert_eq!(r["minDistToOutlineMm"], serde_json::json!(0.0), "{r}");
    let out = sq("o", 900.0, 100.0, 1000.05, 200.0);
    let r = verify_layout(&[shaped(ring, vec![], &[&out])], &[out], 0.0);
    assert_eq!(r["insideSheet"], serde_json::json!(false), "{r}");
    assert_eq!(r["minDistToOutlineMm"], serde_json::json!(-0.05), "{r}");
}

#[test]
fn a_part_straddling_a_zone_is_counted_with_its_overlap_area() {
    // Zone (200 ; 200)-(300 ; 300) ; pièce A à cheval (250 ; 250)-(350 ; 350) :
    // recouvrement 50 x 50 = 2500 mm². Pièce B loin, pièce C sur la zone entière.
    let zone = square_ring(200.0, 200.0, 300.0, 300.0);
    let a = sq("a", 250.0, 250.0, 350.0, 350.0);
    let b = sq("b", 600.0, 600.0, 700.0, 700.0);
    let cc = sq("c", 150.0, 150.0, 350.0, 350.0); // contient la zone (aire 10000)
    let c = shaped(square_ring(0.0, 0.0, 1000.0, 1000.0), vec![zone.clone()], &[&a, &b]);
    let r = verify_layout(&[c], &[a.clone(), b.clone()], 2.0);
    assert_eq!(r["zoneClear"], serde_json::json!(false), "{r}");
    assert_eq!(r["zoneViolations"], serde_json::json!(1), "{r}");
    assert_eq!(r["zoneOverlapAreaMm2"], serde_json::json!(2500.0), "{r}");
    assert_eq!(r["minDistToZoneMm"], serde_json::json!(0.0), "{r}");
    assert_eq!(r["insideSheet"], serde_json::json!(true), "{r}");
    // Deux pièces fautives : le compte suit.
    let c2 = shaped(square_ring(0.0, 0.0, 1000.0, 1000.0), vec![zone], &[&a, &b, &cc]);
    let r2 = verify_layout(&[c2], &[a, b, cc], 2.0);
    assert_eq!(r2["zoneViolations"], serde_json::json!(2), "{r2}");
    assert_eq!(r2["zoneOverlapAreaMm2"], serde_json::json!(12500.0), "{r2}");
}

#[test]
fn a_zone_inside_a_part_hole_is_not_a_violation_and_an_identical_part_is() {
    // Cadre 400 x 400 percé d'un trou (100..300)² ; zone (150..250)² dans le trou.
    let frame = Item {
        id: "f".into(),
        coords: vec![[0.0, 0.0], [400.0, 0.0], [400.0, 400.0], [0.0, 400.0], [0.0, 0.0]],
        holes: vec![square_ring(100.0, 100.0, 300.0, 300.0)],
    };
    let zone = square_ring(150.0, 150.0, 250.0, 250.0);
    let mut c = shaped(square_ring(0.0, 0.0, 1000.0, 1000.0), vec![zone.clone()], &[&frame]);
    c.transforms[0].x = 100.0;
    c.transforms[0].y = 100.0;
    // Le cadre posé en (100 ; 100) : trou (200..400)², zone (150..250)² mord le cadre.
    let r = verify_layout(&[c.clone()], &[frame.clone()], 0.0);
    assert_eq!(r["zoneClear"], serde_json::json!(false), "{r}");
    // Posé en (50 ; 50) : trou (150..350)² contient la zone, la matière ne la touche pas.
    c.transforms[0].x = 50.0;
    c.transforms[0].y = 50.0;
    let r = verify_layout(&[c], &[frame], 0.0);
    assert_eq!(r["zoneClear"], serde_json::json!(true), "{r}");
    assert_eq!(r["zoneViolations"], serde_json::json!(0), "{r}");
    assert_eq!(r["minDistToZoneMm"], serde_json::json!(0.0), "{r}");
    // Pièce identique à la zone (même sens, bords communs) : tout est recouvert.
    let same = sq("s", 150.0, 150.0, 250.0, 250.0);
    let c = shaped(square_ring(0.0, 0.0, 1000.0, 1000.0), vec![zone], &[&same]);
    let r = verify_layout(&[c], &[same], 0.0);
    assert_eq!(r["zoneOverlapAreaMm2"], serde_json::json!(10000.0), "{r}");
    assert_eq!(r["zoneViolations"], serde_json::json!(1), "{r}");
}

#[test]
fn a_clean_layout_is_all_true_with_its_distances() {
    // Zone (400..600)². A (100..200)² : 100 du contour, 200 de la zone.
    // B (250..350 ; 450..550) : 250 du contour, 50 de la zone.
    let zone = square_ring(400.0, 400.0, 600.0, 600.0);
    let a = sq("a", 100.0, 100.0, 200.0, 200.0);
    let b = sq("b", 250.0, 450.0, 350.0, 550.0);
    let c = shaped(square_ring(0.0, 0.0, 1000.0, 1000.0), vec![zone], &[&a, &b]);
    let r = verify_layout(&[c], &[a, b], 2.0);
    assert_eq!(r["insideSheet"], serde_json::json!(true), "{r}");
    assert_eq!(r["zoneClear"], serde_json::json!(true), "{r}");
    assert_eq!(r["overlapFree"], serde_json::json!(true), "{r}");
    assert_eq!(r["partsOutsideOutline"], serde_json::json!(0), "{r}");
    assert_eq!(r["zoneViolations"], serde_json::json!(0), "{r}");
    assert_eq!(r["minDistToOutlineMm"], serde_json::json!(100.0), "{r}");
    assert_eq!(r["minDistToZoneMm"], serde_json::json!(50.0), "{r}");
    assert_eq!(r["zonesChecked"], serde_json::json!(1), "{r}");
    assert_eq!(r["shapeVerified"], serde_json::json!(true), "{r}");
    assert_eq!(r["spacingOk"], serde_json::json!(true), "{r}");
}

#[test]
fn density_is_parts_area_over_usable_area_and_no_offcut() {
    // Contour 1000 x 1000, zone 200 x 200 : aire utile 960 000. Deux pièces
    // de 100 x 100 : 20 000 / 960 000 = 2,0833 %.
    let zone = square_ring(400.0, 400.0, 600.0, 600.0);
    let a = sq("a", 100.0, 100.0, 200.0, 200.0);
    let b = sq("b", 700.0, 700.0, 800.0, 800.0);
    let c = shaped(square_ring(0.0, 0.0, 1000.0, 1000.0), vec![zone], &[&a, &b]);
    let sheets = per_sheet_metrics(&[c], &[a, b]);
    let s = &sheets[0];
    assert_eq!(s["sheetAreaMm2"], serde_json::json!(960000.0), "{s}");
    assert_eq!(s["partsAreaMm2"], serde_json::json!(20000.0), "{s}");
    assert_eq!(s["freeAreaMm2"], serde_json::json!(940000.0), "{s}");
    assert_eq!(s["densityPct"], serde_json::json!(2.1), "{s}");
    assert_eq!(s["widthMm"], serde_json::json!(1000.0), "{s}");
    assert_eq!(s["offcut"], serde_json::Value::Null, "{s}");
    assert_eq!(s["shaped"], serde_json::json!(true), "{s}");
    assert_eq!(s["zonesAreaMm2"], serde_json::json!(40000.0), "{s}");
    let t = report_totals(&sheets);
    assert_eq!(t["sheetAreaMm2"], serde_json::json!(960000.0), "{t}");
    assert_eq!(t["densityPct"], serde_json::json!(2.1), "{t}");
    assert_eq!(t["shapedSheetCount"], serde_json::json!(1), "{t}");
    assert_eq!(t["formats"][0]["shaped"], serde_json::json!(true), "{t}");
}

#[test]
fn a_disc_sheet_density_uses_the_disc_not_the_box() {
    // Aire du polygone à 360 côtés de rayon 500 : 180 r² sin(1°) ≈ 785 365 mm²,
    // la boîte en vaut 1 000 000. Une pièce de 100 x 100 centrée.
    let p = sq("p", 450.0, 450.0, 550.0, 550.0);
    let c = shaped(disc(), vec![], &[&p]);
    let sheets = per_sheet_metrics(&[c], &[p]);
    let area = sheets[0]["sheetAreaMm2"].as_f64().unwrap();
    let expect = 180.0 * 500.0 * 500.0 * libm::sin(core::f64::consts::PI / 180.0);
    assert!((area - expect).abs() < 0.2, "{area} {expect}");
    let d = sheets[0]["densityPct"].as_f64().unwrap();
    assert!((d - 10000.0 / expect * 100.0).abs() < 0.06, "{d}");
    assert!(d > 1.2 && d <= 1.3, "{d}");
}

#[test]
fn rectangle_and_shaped_sheets_of_the_same_box_stay_two_formats() {
    let p = sq("p", 450.0, 450.0, 550.0, 550.0);
    let rect = Container { bin_width: 1000.0, bin_height: 1000.0, transforms: vec![at(&p)], ..Default::default() };
    let shp = shaped(disc(), vec![], &[&p]);
    let sheets = per_sheet_metrics(&[rect, shp], &[p]);
    let t = report_totals(&sheets);
    assert_eq!(t["formats"].as_array().unwrap().len(), 2, "{t}");
    // La tôle rectangle garde son rapport d'avant : chute mesurée, pas d'étiquette.
    assert!(sheets[0].get("shaped").is_none(), "{}", sheets[0]);
    assert_ne!(sheets[0]["offcut"], serde_json::Value::Null, "{}", sheets[0]);
}

#[test]
fn an_unreadable_shape_is_not_verified_never_green() {
    let p = sq("p", 450.0, 450.0, 550.0, 550.0);
    // Deux sommets seulement : pas un contour.
    let c = shaped(vec![[0.0, 0.0], [1000.0, 0.0]], vec![], &[&p]);
    let r = verify_layout(&[c], &[p], 2.0);
    assert_eq!(r["shapeVerified"], serde_json::json!(false), "{r}");
    assert_eq!(r["insideSheet"], serde_json::Value::Null, "{r}");
    assert_eq!(r["verifyStatus"], serde_json::json!("skipped"), "{r}");
}

#[test]
fn a_ring_given_open_is_closed_before_use() {
    // Le contour arrive sans point de fermeture (piège 5c) : même verdict.
    let mut open = square_ring(0.0, 0.0, 1000.0, 1000.0);
    open.pop();
    let p = sq("p", 100.0, 100.0, 200.0, 200.0);
    let r = verify_layout(&[shaped(open, vec![], &[&p])], &[p], 0.0);
    assert_eq!(r["insideSheet"], serde_json::json!(true), "{r}");
    assert_eq!(r["minDistToOutlineMm"], serde_json::json!(100.0), "{r}");
}

#[test]
fn overlap_area_matches_a_raster_estimate_on_random_shapes() {
    // Recouvrement exact (Green sur les tronçons) contre un comptage de points
    // sur une grille de 0,25 mm : 40 tirages (suite congruentielle fixe) de
    // pièces en L avec trou et de zones à 5 à 9 côtés étoilés.
    let mut seed: u64 = 12345;
    let mut rnd = move || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((seed >> 33) as f64) / (1u64 << 31) as f64
    };
    for case in 0..40 {
        let (cx, cy) = (100.0 + 20.0 * rnd(), 100.0 + 20.0 * rnd());
        let outer: Vec<Pt> = vec![
            [60.0, 60.0], [150.0, 60.0], [150.0, 90.0], [90.0, 90.0], [90.0, 150.0], [60.0, 150.0], [60.0, 60.0],
        ];
        let hole = square_ring(65.0, 65.0, 80.0, 80.0);
        let n = 5 + (rnd() * 5.0) as usize;
        let mut zone: Vec<Pt> = (0..n)
            .map(|k| {
                let a = 2.0 * core::f64::consts::PI * k as f64 / n as f64;
                let r = 15.0 + 25.0 * rnd();
                [cx - 20.0 + r * libm::cos(a), cy - 20.0 + r * libm::sin(a)]
            })
            .collect();
        zone.push(zone[0]);
        let exact = shape::material_zone_overlap(&outer, &[hole.clone()], &zone);
        let step = 0.25;
        let mut hits = 0u64;
        let mut x = 0.0;
        while x < 200.0 {
            let mut y = 0.0;
            while y < 200.0 {
                let p = [x + step / 2.0, y + step / 2.0];
                let in_m = geom::point_in_ring(p, &outer) && !geom::point_in_ring(p, &hole);
                if in_m && geom::point_in_ring(p, &zone) {
                    hits += 1;
                }
                y += step;
            }
            x += step;
        }
        let raster = hits as f64 * step * step;
        assert!((exact - raster).abs() <= 0.01 * raster.max(50.0), "cas {case}: exact {exact} raster {raster}");
    }
}

#[test]
fn rectangular_report_is_byte_identical_to_the_one_before_the_shape_fields() {
    // Sortie de compute_report du bundle HEAD (avant ce lot), mêmes entrées :
    // aucun champ ajouté, aucune valeur déplacée pour des tôles rectangulaires.
    let spec = r#"{"items":[
      {"id":"a","coords":[[0,0],[40,0],[40,30],[0,30],[0,0]],"holes":[]},
      {"id":"b","coords":[[0,0],[100,0],[100,100],[0,100],[0,0]],"holes":[[[20,20],[80,20],[80,80],[20,80],[20,20]]]},
      {"id":"d","coords":[[0,0],[20,0],[20,20],[0,20],[0,0]],"holes":[]}],
     "containers":[
      {"bin_width":400,"bin_height":400,"transforms":[
        {"item_id":"a","angle":0,"x":10,"y":10},{"item_id":"a","angle":0,"x":20,"y":20},
        {"item_id":"b","angle":0,"x":350,"y":350},{"item_id":"d","angle":0,"x":60,"y":10},
        {"item_id":"d","angle":0,"x":60,"y":31}]},
      {"bin_width":300,"bin_height":300,"transforms":[
        {"item_id":"b","angle":0,"x":10,"y":10},{"item_id":"d","angle":0,"x":50,"y":50},
        {"item_id":"a","angle":0,"x":150,"y":150}]}],"space":2}"#;
    #[derive(serde::Deserialize)]
    struct Spec {
        items: Vec<Item>,
        containers: Vec<Container>,
        space: f64,
    }
    let s: Spec = serde_json::from_str(spec).unwrap();
    let sheets = per_sheet_metrics(&s.containers, &s.items);
    let totals = report_totals(&sheets);
    let verify = verify_layout(&s.containers, &s.items, s.space);
    let got = serde_json::to_string(&serde_json::json!({
        "per_sheet": sheets, "totals": totals, "verify": verify,
    }))
    .unwrap();
    let head = r#"{"per_sheet":[{"densityPct":6.0,"freeAreaMm2":150400.0,"heightMm":400.0,"index":0,"offcut":{"areaMm2":122150.0,"heightMm":349.0,"reusable":true,"widthMm":350.0},"partCount":5,"partsAreaMm2":9600.0,"sheetAreaMm2":160000.0,"widthMm":400.0},{"densityPct":8.9,"freeAreaMm2":82000.0,"heightMm":300.0,"index":1,"offcut":{"areaMm2":36000.0,"heightMm":120.0,"reusable":true,"widthMm":300.0},"partCount":3,"partsAreaMm2":8000.0,"sheetAreaMm2":90000.0,"widthMm":300.0}],"totals":{"densityPct":7.0,"formats":[{"count":1,"heightMm":400.0,"widthMm":400.0},{"count":1,"heightMm":300.0,"widthMm":300.0}],"freeAreaMm2":232400.0,"partsAreaMm2":17600.0,"sheetAreaMm2":250000.0,"sheetCount":2},"verify":{"duplicatePoses":0,"holesFilled":1,"holesOverflow":0,"holesTotal":2,"insideSheet":false,"overlapFree":false,"smallestGapMm":-50.0,"spacingOk":false,"verifyStatus":"measured"}}"#;
    assert_eq!(got, head);
}

#[test]
fn a_part_closer_to_a_zone_than_the_spacing_is_not_spacing_ok() {
    // R1 : zone (400..600)². Pièce à 0,5 mm de la zone, espacement 2 : l'écart
    // minimal est celui de la zone (0,5), le badge d'espacement est rouge.
    let zone = square_ring(400.0, 400.0, 600.0, 600.0);
    let p = sq("p", 299.5, 450.0, 399.5, 550.0);
    let c = shaped(square_ring(0.0, 0.0, 1000.0, 1000.0), vec![zone.clone()], &[&p]);
    let r = verify_layout(&[c], &[p], 2.0);
    assert_eq!(r["zoneClear"], serde_json::json!(true), "{r}");
    assert_eq!(r["minDistToZoneMm"], serde_json::json!(0.5), "{r}");
    assert_eq!(r["smallestGapMm"], serde_json::json!(0.5), "{r}");
    assert_eq!(r["spacingOk"], serde_json::json!(false), "{r}");
    // À 2,2 mm : l'espacement est tenu.
    let q = sq("q", 297.8, 450.0, 397.8, 550.0);
    let c = shaped(square_ring(0.0, 0.0, 1000.0, 1000.0), vec![zone], &[&q]);
    let r = verify_layout(&[c], &[q], 2.0);
    assert_eq!(r["smallestGapMm"], serde_json::json!(2.2), "{r}");
    assert_eq!(r["spacingOk"], serde_json::json!(true), "{r}");
}

#[test]
fn used_sheet_share_keeps_the_bounding_box_of_the_sheet() {
    // R2 : disque dans une boîte 1000 x 1000, pièces sur 100..900 : la part est
    // 640 000 / 1 000 000 (boîte), pas 640 000 / aire utile du disque (~0,815).
    let a = sq("a", 100.0, 100.0, 200.0, 200.0);
    let b = sq("b", 800.0, 800.0, 900.0, 900.0);
    let c = shaped(disc(), vec![], &[&a, &b]);
    let share = compute_used_sheet_share(&[c], &[a, b]).unwrap();
    assert!((share - 0.64).abs() < 1e-12, "{share}");
}

#[test]
fn two_outlines_with_the_same_box_stay_two_formats() {
    // R5 : un disque et un carré à zone ont la même boîte 1000 x 1000.
    let p = sq("p", 450.0, 450.0, 550.0, 550.0);
    let d = shaped(disc(), vec![], &[&p]);
    let s = shaped(square_ring(0.0, 0.0, 1000.0, 1000.0), vec![square_ring(10.0, 10.0, 50.0, 50.0)], &[&p]);
    let sheets = per_sheet_metrics(&[d.clone(), s, d], &[p]);
    let t = report_totals(&sheets);
    assert_eq!(t["formats"].as_array().unwrap().len(), 2, "{t}");
    let counts: Vec<i64> = t["formats"].as_array().unwrap().iter().map(|f| f["count"].as_i64().unwrap()).collect();
    assert!(counts.contains(&2) && counts.contains(&1), "{t}");
}
