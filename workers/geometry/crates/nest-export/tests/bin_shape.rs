//! Tôle importée : le DXF livré (option « tracer le contour de la tôle »
//! active) porte le vrai contour sur BIN_BOUNDARY et les zones interdites sur
//! FORBIDDEN_ZONE. Option coupée, ou forme absente : octets d'avant.

use nest_export::{build_part_dxf, build_part_dxf_shaped, BinShape, Coord, Placement};
use nest_import::dxf::entities::{Common, Entity, Line};
use std::collections::HashMap;

/// Sortie de HEAD (bundle d'avant le lot, option active, tôle 100 x 50, une
/// ligne posée en (5,5), espacement 2) : le job sans tôle importée ne bouge pas.
const GOLDEN_PLAIN: &str = "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n9\n$INSUNITS\n70\n4\n9\n$MEASUREMENT\n70\n1\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\n0\n70\n0\n62\n7\n0\nLAYER\n2\nBIN_BOUNDARY\n70\n0\n62\n5\n0\nLAYER\n2\nOUT_SHAPE\n70\n0\n62\n1\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n5\n1\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n5.0\n20\n5.0\n11\n15.0\n21\n5.0\n0\nLWPOLYLINE\n5\n2\n100\nAcDbEntity\n8\nBIN_BOUNDARY\n100\nAcDbPolyline\n90\n4\n70\n1\n10\n0.0\n20\n0.0\n10\n100.0\n20\n0.0\n10\n100.0\n20\n50.0\n10\n0.0\n20\n50.0\n0\nLWPOLYLINE\n5\n3\n100\nAcDbEntity\n8\nOUT_SHAPE\n100\nAcDbPolyline\n90\n4\n70\n1\n10\n3.0\n20\n3.0\n10\n17.0\n20\n3.0\n10\n17.0\n20\n7.0\n10\n3.0\n20\n7.0\n0\nENDSEC\n0\nEOF\n";

fn sources() -> HashMap<String, (Vec<Entity>, Vec<nest_import::dxf::entities::Block>)> {
    let line = Entity::Line(Line {
        start: [0.0, 0.0],
        end: [10.0, 0.0],
        common: Common { handle: "A1".into(), layer: "0".into(), color: 256 },
    });
    let mut m = HashMap::new();
    m.insert("src".to_string(), (vec![line], vec![]));
    m
}

fn placement() -> Vec<Placement> {
    vec![Placement {
        item_id: "p".into(),
        file_slug: "src".into(),
        handles: vec!["A1".into()],
        angle: 0.0,
        x: 5.0,
        y: 5.0,
        color: None,
    }]
}

/// Disque-ish : contour en L fermé (premier point répété) + une zone carrée.
fn ring(v: &[[f64; 2]]) -> Vec<[Coord; 2]> {
    v.iter().map(|p| [Coord(p[0]), Coord(p[1])]).collect()
}

fn shape() -> BinShape {
    BinShape {
        outer: ring(&[[0.0, 0.0], [100.0, 0.0], [100.0, 30.0], [40.0, 30.0], [40.0, 50.0], [0.0, 50.0], [0.0, 0.0]]),
        inner: vec![ring(&[[10.0, 10.0], [20.0, 10.0], [20.0, 20.0], [10.0, 20.0], [10.0, 10.0]])],
    }
}

fn pairs(dxf: &str) -> Vec<(String, String)> {
    let l: Vec<&str> = dxf.lines().collect();
    l.chunks(2).map(|c| (c[0].to_string(), c.get(1).unwrap_or(&"").to_string())).collect()
}

/// Entités LWPOLYLINE d'un calque : liste de sommets (x, y).
fn polylines_on(dxf: &str, layer: &str) -> Vec<Vec<(f64, f64)>> {
    let p = pairs(dxf);
    let mut out = vec![];
    let mut i = 0;
    while i < p.len() {
        if p[i] == ("0".into(), "LWPOLYLINE".into()) {
            let mut j = i + 1;
            let mut on = false;
            let (mut xs, mut ys) = (vec![], vec![]);
            while j < p.len() && p[j].0 != "0" {
                match p[j].0.as_str() {
                    "8" => on = p[j].1 == layer,
                    "10" => xs.push(p[j].1.parse::<f64>().unwrap()),
                    "20" => ys.push(p[j].1.parse::<f64>().unwrap()),
                    _ => {}
                }
                j += 1;
            }
            if on {
                out.push(xs.into_iter().zip(ys).collect());
            }
            i = j;
        } else {
            i += 1;
        }
    }
    out
}

#[test]
fn plain_job_bytes_are_the_head_golden() {
    let out = build_part_dxf(&sources(), &placement(), true, 2.0, Some(100.0), Some(50.0), "mm");
    assert_eq!(out, GOLDEN_PLAIN);
    // Sans forme, la variante « shaped » est la même fonction.
    let out2 = build_part_dxf_shaped(&sources(), &placement(), true, 2.0, Some(100.0), Some(50.0), "mm", None);
    assert_eq!(out2, GOLDEN_PLAIN);
}

// Décision du propriétaire (20/11) : pour une tôle importée, le vrai contour
// et les zones sont TOUJOURS dans le fichier, option cochée ou non, et le
// cadre autour des pièces (OUT_SHAPE) n'y est jamais.
#[test]
fn a_shaped_sheet_is_the_same_file_with_the_option_on_or_off() {
    let off = build_part_dxf_shaped(
        &sources(), &placement(), false, 2.0, Some(100.0), Some(50.0), "mm", Some(&shape()),
    );
    let on = build_part_dxf_shaped(
        &sources(), &placement(), true, 2.0, Some(100.0), Some(50.0), "mm", Some(&shape()),
    );
    assert_eq!(off, on);
    // Le vrai contour, pas le rectangle 100 x 50 de la boîte.
    let outline = polylines_on(&off, "BIN_BOUNDARY");
    assert_eq!(outline.len(), 1);
    assert_eq!(outline[0].len(), 6);
    assert_eq!(polylines_on(&off, "FORBIDDEN_ZONE").len(), 1);
}

#[test]
fn a_shaped_sheet_never_gets_the_frame_around_the_parts() {
    let on = build_part_dxf_shaped(
        &sources(), &placement(), true, 2.0, Some(100.0), Some(50.0), "mm", Some(&shape()),
    );
    assert!(!on.contains("OUT_SHAPE"));
    // Témoin : la même pose sur une tôle rectangulaire garde son cadre.
    let plain = build_part_dxf(&sources(), &placement(), true, 2.0, Some(100.0), Some(50.0), "mm");
    assert_eq!(polylines_on(&plain, "OUT_SHAPE").len(), 1);
}

#[test]
fn option_on_draws_the_true_outline_and_the_zone() {
    let s = shape();
    let out = build_part_dxf_shaped(
        &sources(), &placement(), true, 2.0, Some(100.0), Some(50.0), "mm", Some(&s),
    );
    let outline = polylines_on(&out, "BIN_BOUNDARY");
    assert_eq!(outline.len(), 1);
    // 6 sommets : le point de fermeture répété n'est pas écrit (drapeau 70 = 1).
    assert_eq!(outline[0].len(), 6);
    assert_eq!(outline[0][2], (100.0, 30.0));
    let zones = polylines_on(&out, "FORBIDDEN_ZONE");
    assert_eq!(zones, vec![vec![(10.0, 10.0), (20.0, 10.0), (20.0, 20.0), (10.0, 20.0)]]);
    // Calque des zones déclaré, couleur explicite 6.
    assert!(out.contains("0\nLAYER\n2\nFORBIDDEN_ZONE\n70\n0\n62\n6\n"));
    // Les pièces : la section d'entités commence par la même LINE, au même octet.
    let part = &GOLDEN_PLAIN[GOLDEN_PLAIN.find("0\nLINE").unwrap()..GOLDEN_PLAIN.find("0\nLWPOLYLINE").unwrap()];
    assert!(out.contains(part));
    // Poignées uniques.
    let handles: Vec<String> = pairs(&out).into_iter().filter(|(c, _)| c == "5").map(|(_, v)| v).collect();
    let mut u = handles.clone();
    u.sort();
    u.dedup();
    assert_eq!(handles.len(), u.len());
}

#[test]
fn inch_output_scales_outline_and_zone_like_parts() {
    let s = shape();
    let out = build_part_dxf_shaped(
        &sources(), &placement(), true, 2.0, Some(100.0), Some(50.0), "inch", Some(&s),
    );
    let outline = polylines_on(&out, "BIN_BOUNDARY");
    let k = 1.0 / 25.4; // même facteur que les pièces : x * k, jamais x / 25,4
    assert_eq!(outline[0][1], (100.0 * k, 0.0));
    let zones = polylines_on(&out, "FORBIDDEN_ZONE");
    assert_eq!(zones[0][2], (20.0 * k, 20.0 * k));
    assert!(out.contains("9\n$INSUNITS\n70\n1\n"));
}

#[test]
fn unreadable_outline_falls_back_to_the_rectangle() {
    let bad = BinShape { outer: ring(&[[0.0, 0.0], [1.0, 1.0], [0.0, 0.0]]), inner: vec![] };
    let a = build_part_dxf(&sources(), &placement(), true, 2.0, Some(100.0), Some(50.0), "mm");
    let b = build_part_dxf_shaped(
        &sources(), &placement(), true, 2.0, Some(100.0), Some(50.0), "mm", Some(&bad),
    );
    assert_eq!(a, b);
}

#[test]
fn coordinates_sent_as_text_are_read_exactly() {
    // 909.5760221444957 : le lecteur de nombres de serde_json rend ...956 (1 ULP).
    let js = r#"{"outer":[["0","0"],["909.5760221444957","213.21178182447676"],["0","900"],["0","0"]],"inner":[]}"#;
    let s: BinShape = serde_json::from_str(js).unwrap();
    assert_eq!(s.outer[1][0].0, "909.5760221444957".parse::<f64>().unwrap());
    let out = build_part_dxf_shaped(
        &sources(), &placement(), true, 2.0, Some(1000.0), Some(1000.0), "mm", Some(&s),
    );
    assert_eq!(first_outline(&out)[1], (909.5760221444957, 213.21178182447676));
}

fn first_outline(dxf: &str) -> Vec<(f64, f64)> {
    polylines_on(dxf, "BIN_BOUNDARY").remove(0)
}
