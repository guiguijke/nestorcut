//! Lecteur de tôle (`nest_import::sheet`) : tous les contours d'un dessin DXF,
//! sans le nettoyage de l'import de pièces. Les fixtures sont les DXF publics
//! de `workers/geometry/parity/corpus_sheets/` (générés par
//! `build_corpus.py tole`).

use nest_import::budget::Limits;
use nest_import::sheet::{guarded_sheet_json, import_sheet_contours, SheetResult};
use nest_import::ImportError;
use std::f64::consts::PI;

fn fixture(name: &str) -> Vec<u8> {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../parity/corpus_sheets")
        .join(name);
    std::fs::read(&p).unwrap_or_else(|e| panic!("fixture {}: {e}", p.display()))
}

fn sheet(name: &str) -> SheetResult {
    sheet_of(&fixture(name))
}

fn sheet_of(bytes: &[u8]) -> SheetResult {
    import_sheet_contours(bytes, 0.01, &Limits::unlimited()).expect("sheet import")
}

fn shoelace(r: &[[f64; 2]]) -> f64 {
    let mut a = 0.0;
    for w in r.windows(2) {
        a += w[0][0] * w[1][1] - w[1][0] * w[0][1];
    }
    a / 2.0
}

fn rel(a: f64, b: f64) -> f64 {
    (a - b).abs() / b.abs()
}

#[test]
fn a_disc_is_one_contour_inscribed_in_the_circle() {
    let r = sheet("disc_1000.dxf");
    assert_eq!(r.contours.len(), 1);
    let c = &r.contours[0];
    assert_eq!(c.depth, 1);
    assert_eq!(c.parent, None);
    let exact = PI * 500.0 * 500.0;
    assert!(c.area_mm2 <= exact, "polygone inscrit : jamais au-dessus du disque ({} > {exact})", c.area_mm2);
    assert!(rel(c.area_mm2, exact) < 1e-3, "aire {} loin de {exact}", c.area_mm2);
    assert_eq!(r.open_paths, 0);
    assert_eq!(r.skipped_entities, 0);
    assert_eq!(r.source_units, 4);
    // Repère du DXF conservé : le disque est centré en (500, 500), pas ramené à l'origine.
    let b = c.bbox;
    assert!((b[0] - 0.0).abs() < 0.05 && (b[2] - 1000.0).abs() < 0.05, "bbox x {b:?}");
    assert!((b[1] - 0.0).abs() < 0.05 && (b[3] - 1000.0).abs() < 0.05, "bbox y {b:?}");
}

#[test]
fn a_ring_is_two_nested_contours() {
    let r = sheet("ring_1000_300.dxf");
    assert_eq!(r.contours.len(), 2);
    let (outer, inner) = (&r.contours[0], &r.contours[1]);
    assert_eq!((outer.depth, outer.parent), (1, None));
    assert_eq!((inner.depth, inner.parent), (2, Some(0)));
    assert!(rel(outer.area_mm2, PI * 500.0 * 500.0) < 1e-3);
    assert!(rel(inner.area_mm2, PI * 150.0 * 150.0) < 1e-3);
    // Le contour extérieur est l'anneau de la face « couronne », pas la couronne
    // soustraite du trou : son aire est celle du disque plein.
    assert!(outer.area_mm2 > inner.area_mm2 * 10.0);
}

#[test]
fn an_l_shaped_offcut_is_one_contour_with_the_notch() {
    let r = sheet("offcut_L.dxf");
    assert_eq!(r.contours.len(), 1);
    let c = &r.contours[0];
    assert_eq!(c.ring.len(), 7, "6 sommets + fermeture");
    assert!((c.area_mm2 - 720_000.0).abs() < 1e-6, "aire {}", c.area_mm2);
    assert_eq!(c.bbox, [0.0, 0.0, 1200.0, 800.0]);
}

#[test]
fn decor_zones_gives_the_plate_the_zones_and_the_nested_circle() {
    let r = sheet("decor_zones.dxf");
    assert_eq!(r.contours.len(), 8, "plaque + 6 zones + 1 cercle imbriqué");
    let plate = &r.contours[0];
    assert_eq!((plate.depth, plate.parent), (1, None));
    assert!((plate.area_mm2 - 2_000_000.0).abs() < 1e-6);
    // 6 zones au niveau 2, toutes filles de la plaque.
    for c in &r.contours[1..7] {
        assert_eq!((c.depth, c.parent), (2, Some(0)), "{:?}", c.bbox);
    }
    // Le petit cercle (r = 50) est au niveau 3, enfant du cercle r = 150.
    let small = &r.contours[7];
    assert_eq!(small.depth, 3);
    let parent = small.parent.expect("parent du cercle imbriqué");
    let p = &r.contours[parent];
    assert_eq!(p.depth, 2);
    assert!(rel(p.area_mm2, PI * 150.0 * 150.0) < 1e-3, "le parent est le cercle r=150");
    assert!(rel(small.area_mm2, PI * 50.0 * 50.0) < 2e-3);
    assert_eq!(parent, 1, "le plus grand contour du niveau 2 passe en premier");
}

#[test]
fn inches_are_scaled_to_millimetres() {
    let r = sheet("inches_disc.dxf");
    assert_eq!(r.source_units, 1);
    assert_eq!(r.contours.len(), 1);
    let b = r.contours[0].bbox;
    assert!((b[2] - b[0] - 508.0).abs() < 0.02, "diamètre {}", b[2] - b[0]);
    assert!((b[3] - b[1] - 508.0).abs() < 0.02);
    assert!(rel(r.contours[0].area_mm2, PI * 254.0 * 254.0) < 1e-3);
}

#[test]
fn a_title_block_counts_its_open_lines_and_text_but_keeps_the_small_box() {
    let r = sheet("title_block.dxf");
    // 3 LINE + 1 polyligne ouverte, tous flottants : 4 chaînes ouvertes.
    assert_eq!(r.open_paths, 4);
    // TEXT et DIMENSION : lus et écartés, jamais transformés en contour.
    assert_eq!(r.skipped_entities, 2, "warnings: {:?}", r.warnings);
    assert_eq!(r.contours.len(), 2, "cadre + cartouche, rien d'autre");
    assert_eq!(r.contours[0].bbox, [0.0, 0.0, 1500.0, 1000.0]);
    let tb = &r.contours[1];
    assert_eq!((tb.depth, tb.parent), (2, Some(0)));
    assert!((tb.area_mm2 - 600.0).abs() < 1e-9, "40 x 15 = 600, trouvé {}", tb.area_mm2);
    assert_eq!(tb.bbox, [1440.0, 960.0, 1480.0, 975.0]);
}

/// Un trait ouvert posé sur le bord d'un contour ne laisse pas d'ergot dans
/// l'anneau et ne crée pas de contour : il est compté, c'est tout.
#[test]
fn an_open_line_touching_the_outline_adds_no_spur_and_no_contour() {
    let doc = "0\nSECTION\n2\nENTITIES\n\
        0\nLWPOLYLINE\n90\n4\n70\n1\n10\n0\n20\n0\n10\n100\n20\n0\n10\n100\n20\n100\n10\n0\n20\n100\n\
        0\nLINE\n10\n0\n20\n50\n11\n30\n21\n50\n\
        0\nENDSEC\n0\nEOF\n";
    let r = sheet_of(doc.as_bytes());
    assert_eq!(r.contours.len(), 1);
    assert_eq!(r.open_paths, 1);
    assert!((r.contours[0].area_mm2 - 10_000.0).abs() < 1e-9);
    // 4 coins + le point d'accroche du trait sur le bord gauche + fermeture.
    assert!(r.contours[0].ring.len() <= 6, "{:?}", r.contours[0].ring);
    assert!(
        !r.contours[0].ring.iter().any(|p| (p[0] - 30.0).abs() < 1e-9),
        "l'extrémité libre du trait ne doit pas être un sommet"
    );
}

/// Un trou de ~0,5 mm2 est un contour de tôle (zone interdite possible) ; la
/// pièce du même dessin, elle, le rebouche (micro-vide, règle E1).
#[test]
fn a_half_square_millimetre_hole_is_kept_where_part_import_drops_it() {
    let doc = "0\nSECTION\n2\nENTITIES\n\
        0\nLWPOLYLINE\n90\n4\n70\n1\n10\n0\n20\n0\n10\n100\n20\n0\n10\n100\n20\n100\n10\n0\n20\n100\n\
        0\nLWPOLYLINE\n90\n4\n70\n1\n10\n50\n20\n50\n10\n50.7\n20\n50\n10\n50.7\n20\n50.7\n10\n50\n20\n50.7\n\
        0\nENDSEC\n0\nEOF\n";
    let r = sheet_of(doc.as_bytes());
    assert_eq!(r.contours.len(), 2);
    let hole = &r.contours[1];
    assert_eq!((hole.depth, hole.parent), (2, Some(0)));
    assert!((hole.area_mm2 - 0.49).abs() < 1e-6, "aire {}", hole.area_mm2);

    let parts = nest_import::import_dxf(doc.as_bytes(), 0.01).expect("part import");
    assert_eq!(parts.parts.len(), 1);
    assert!(parts.parts[0].holes.is_empty(), "l'import de pièces rebouche ce micro-vide");
}

/// touching.dxf — ce que le contrat donne, et pourquoi.
///
/// Un contour est l'anneau extérieur d'UNE face bornée de l'arrangement. Donc :
///  - le rectangle 1000 x 500 : un contour (son anneau, la face « plaque » étant
///    ce qui reste autour des formes) ;
///  - les deux carrés 100 x 100 qui partagent un bord : DEUX contours de
///    10 000 mm2, jamais un contour 200 x 100 (aucune union des murs partagés) ;
///  - deux cercles qui se recouvrent : TROIS faces (croissant, lentille,
///    croissant), donc trois contours — pas deux disques, qui se recouvriraient.
///    Les trois sont au niveau 2 : la lentille n'est pas DANS un croissant.
#[test]
fn shared_walls_and_overlaps_are_split_into_faces() {
    let r = sheet("touching.dxf");
    assert_eq!(r.contours.len(), 6, "{:?}", r.contours.iter().map(|c| c.area_mm2).collect::<Vec<_>>());
    assert_eq!((r.contours[0].depth, r.contours[0].parent), (1, None));
    assert!((r.contours[0].area_mm2 - 500_000.0).abs() < 1e-6);
    for c in &r.contours[1..] {
        assert_eq!((c.depth, c.parent), (2, Some(0)));
    }
    let squares: Vec<_> =
        r.contours.iter().filter(|c| (c.area_mm2 - 10_000.0).abs() < 1e-6).collect();
    assert_eq!(squares.len(), 2, "deux carrés distincts");
    assert!(r.contours.iter().all(|c| (c.area_mm2 - 20_000.0).abs() > 1.0), "aucun contour fusionné");
    // Cercles : croissant + lentille + croissant, symétriques.
    let mut round: Vec<f64> = r
        .contours
        .iter()
        .filter(|c| c.ring.len() > 20)
        .map(|c| c.area_mm2)
        .collect();
    round.sort_by(|a, b| a.total_cmp(b));
    assert_eq!(round.len(), 3);
    assert!((round[1] - round[2]).abs() < 1.0, "croissants symétriques {round:?}");
    assert!(round[0] < round[1], "la lentille est la plus petite {round:?}");
    // Aucun disque entier (aire d'un disque de r = 80 : ~20 106).
    assert!(round.iter().all(|&a| a < PI * 80.0 * 80.0 * 0.9), "{round:?}");
    // Les trois faces recomposent l'union des deux disques.
    let union: f64 = round.iter().sum();
    assert!(union > PI * 80.0 * 80.0 && union < 2.0 * PI * 80.0 * 80.0);
}

#[test]
fn contours_are_closed_counter_clockwise_and_ordered() {
    for name in [
        "disc_1000.dxf",
        "ring_1000_300.dxf",
        "offcut_L.dxf",
        "decor_zones.dxf",
        "inches_disc.dxf",
        "title_block.dxf",
        "touching.dxf",
        "bridge.dxf",
        "diamond_touch.dxf",
        "two_shapes_bridge.dxf",
    ] {
        let r = sheet(name);
        assert!(!r.contours.is_empty(), "{name}");
        for (i, c) in r.contours.iter().enumerate() {
            assert!(c.ring.len() >= 4, "{name}#{i}");
            assert_eq!(c.ring.first(), c.ring.last(), "{name}#{i} non fermé");
            let a = shoelace(&c.ring);
            assert!(a > 0.0, "{name}#{i} pas anti-horaire ({a})");
            assert!((a - c.area_mm2).abs() < 1e-6, "{name}#{i} areaMm2 {} vs {a}", c.area_mm2);
            let xs = c.ring.iter().map(|p| p[0]);
            let ys = c.ring.iter().map(|p| p[1]);
            assert_eq!(c.bbox[0], xs.clone().fold(f64::INFINITY, f64::min));
            assert_eq!(c.bbox[2], xs.fold(f64::NEG_INFINITY, f64::max));
            assert_eq!(c.bbox[1], ys.clone().fold(f64::INFINITY, f64::min));
            assert_eq!(c.bbox[3], ys.fold(f64::NEG_INFINITY, f64::max));
            // Grille de précision 1e-4, comme les anneaux de pièces.
            for p in &c.ring {
                for v in p {
                    assert!((v * 1e4 - (v * 1e4).round()).abs() < 1e-6, "{name}#{i} hors grille: {v}");
                }
            }
        }
        // Ordre : profondeur croissante, puis aire décroissante, puis minx, miny.
        for w in r.contours.windows(2) {
            let (a, b) = (&w[0], &w[1]);
            let key_ok = a.depth < b.depth
                || (a.depth == b.depth
                    && (a.area_mm2 > b.area_mm2
                        || (a.area_mm2 == b.area_mm2
                            && (a.bbox[0] < b.bbox[0]
                                || (a.bbox[0] == b.bbox[0] && a.bbox[1] <= b.bbox[1])))));
            assert!(key_ok, "{name}: ordre {:?} puis {:?}", (a.depth, a.area_mm2), (b.depth, b.area_mm2));
        }
        // Profondeur et parent cohérents : le parent est plus profond d'un cran en moins.
        for (i, c) in r.contours.iter().enumerate() {
            match c.parent {
                None => assert_eq!(c.depth, 1, "{name}#{i}"),
                Some(p) => {
                    assert!(p < i, "{name}#{i}: le parent précède");
                    assert_eq!(r.contours[p].depth + 1, c.depth, "{name}#{i}");
                    assert!(r.contours[p].area_mm2 > c.area_mm2);
                }
            }
        }
    }
}

#[test]
fn two_calls_give_identical_json() {
    let limits = Limits::browser();
    for name in ["decor_zones.dxf", "touching.dxf", "title_block.dxf"] {
        let bytes = fixture(name);
        let a = guarded_sheet_json(&bytes, 0.01, &limits).expect("json");
        let b = guarded_sheet_json(&bytes, 0.01, &limits).expect("json");
        assert_eq!(a, b, "{name}");
        let v: serde_json::Value = serde_json::from_str(&a).unwrap();
        assert_eq!(v["status"], "ok");
        let res = &v["result"];
        for key in ["contours", "sourceUnits", "entityCount", "warnings", "openPaths", "skippedEntities"] {
            assert!(res.get(key).is_some(), "{name}: clé {key} absente");
        }
        let c0 = &res["contours"][0];
        for key in ["ring", "depth", "parent", "areaMm2", "bbox"] {
            assert!(c0.get(key).is_some(), "{name}: clé de contour {key} absente");
        }
        assert!(c0["parent"].is_null());
    }
}

#[test]
fn a_tiny_entity_budget_is_refused_like_a_part_import() {
    let bytes = fixture("decor_zones.dxf"); // 8 entités
    let limits = Limits { max_entities: 3, time_budget_ms: 0 };
    match import_sheet_contours(&bytes, 0.01, &limits) {
        Err(ImportError::TooHeavy(t)) => {
            assert_eq!(t.entities, 8);
            assert_eq!(t.max_entities, 3);
        }
        other => panic!("attendu un refus, obtenu {other:?}"),
    }
    let json = guarded_sheet_json(&bytes, 0.01, &limits).expect("un refus est une réponse");
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["status"], "refused");
    assert_eq!(v["refusal"]["reason"], "entities");
    assert_eq!(v["refusal"]["entities"], 8);
    assert_eq!(v["refusal"]["maxEntities"], 3);
    assert!(v["message"].as_str().unwrap().contains("too heavy"));
    // Même refus que l'import de pièces sous la même borne.
    let part = nest_import::guarded_import_json(&bytes, 0.01, &limits).unwrap();
    let pv: serde_json::Value = serde_json::from_str(&part).unwrap();
    assert_eq!(pv["status"], v["status"]);
    for k in ["reason", "entities", "entitiesAtLeast", "maxEntities"] {
        assert_eq!(pv["refusal"][k], v["refusal"][k], "refusal.{k}");
    }
    assert_eq!(pv["message"], v["message"]);
}

#[test]
fn garbage_and_svg_are_errors_not_refusals() {
    assert!(matches!(
        import_sheet_contours(b"\x00\x01\x02", 0.01, &Limits::unlimited()),
        Err(ImportError::Corrupt(_))
    ));
    let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 48"><rect width="96" height="48"/></svg>"#;
    assert!(matches!(
        import_sheet_contours(svg, 0.01, &Limits::unlimited()),
        Err(ImportError::Corrupt(_))
    ));
}

// ---------------------------------------------------------------- ponts,
// sommets partagés, anneaux simples (face qui repasse par un sommet).

fn poly(pts: &[[f64; 2]]) -> String {
    let mut s = format!("0\nLWPOLYLINE\n90\n{}\n70\n1\n", pts.len());
    for p in pts {
        s.push_str(&format!("10\n{}\n20\n{}\n", p[0], p[1]));
    }
    s
}

fn line(a: [f64; 2], b: [f64; 2]) -> String {
    format!("0\nLINE\n10\n{}\n20\n{}\n11\n{}\n21\n{}\n", a[0], a[1], b[0], b[1])
}

fn dxf_of(body: &str) -> Vec<u8> {
    format!("0\nSECTION\n2\nENTITIES\n{body}0\nENDSEC\n0\nEOF\n").into_bytes()
}

const PLATE: [[f64; 2]; 4] = [[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]];
const INNER: [[f64; 2]; 4] = [[40.0, 40.0], [60.0, 40.0], [60.0, 60.0], [40.0, 60.0]];

fn assert_simple_and_canonical(r: &SheetResult, what: &str) {
    for (k, c) in r.contours.iter().enumerate() {
        assert_eq!(c.ring.first(), c.ring.last(), "{what}: contour {k} non fermé");
        let open = &c.ring[..c.ring.len() - 1];
        let mut seen = std::collections::HashSet::new();
        for p in open {
            assert!(
                seen.insert((p[0].to_bits(), p[1].to_bits())),
                "{what}: contour {k} repasse par {p:?} : {:?}",
                c.ring
            );
        }
        assert!(shoelace(&c.ring) > 0.0, "{what}: contour {k} pas anti-horaire");
        let lowest = open
            .iter()
            .copied()
            .min_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])))
            .unwrap();
        assert_eq!(c.ring[0], lowest, "{what}: contour {k} ne part pas du sommet le plus bas-gauche");
    }
}

/// Un trait qui relie le contour à une forme intérieure (pont : les deux bouts
/// sont de degré 2 ou plus) ne fait pas partie de la face.
#[test]
fn a_bridge_between_outline_and_inner_shape_is_not_part_of_the_plate() {
    let body = format!("{}{}{}", poly(&PLATE), poly(&INNER), line([50.0, 60.0], [50.0, 100.0]));
    let r = sheet_of(&dxf_of(&body));
    assert_eq!(r.contours.len(), 2, "{:?}", r.contours);
    let (plate, inner) = (&r.contours[0], &r.contours[1]);
    assert!((plate.area_mm2 - 10_000.0).abs() < 1e-9, "aire plaque {}", plate.area_mm2);
    assert_eq!((plate.depth, plate.parent), (1, None));
    assert_eq!((inner.depth, inner.parent), (2, Some(0)));
    assert!((inner.area_mm2 - 400.0).abs() < 1e-9);
    assert_eq!(r.open_paths, 1);
    assert_simple_and_canonical(&r, "bridge");
}

/// Une forme intérieure qui touche le bord en UN sommet fait repasser le cycle
/// de la plaque deux fois par ce sommet : il doit être coupé en boucles simples.
#[test]
fn an_inner_diamond_touching_the_outline_at_one_vertex() {
    let diamond = [[50.0, 0.0], [70.0, 20.0], [50.0, 40.0], [30.0, 20.0]];
    let body = format!("{}{}", poly(&PLATE), poly(&diamond));
    let r = sheet_of(&dxf_of(&body));
    assert_eq!(r.contours.len(), 2, "{:?}", r.contours);
    let (plate, d) = (&r.contours[0], &r.contours[1]);
    assert!((plate.area_mm2 - 10_000.0).abs() < 1e-9, "aire plaque {}", plate.area_mm2);
    assert_eq!((plate.depth, plate.parent), (1, None));
    assert_eq!((d.depth, d.parent), (2, Some(0)));
    assert!((d.area_mm2 - 800.0).abs() < 1e-9);
    assert_eq!(r.open_paths, 0);
    assert_simple_and_canonical(&r, "diamond");
}

#[test]
fn two_inner_shapes_joined_by_a_bridge() {
    let a = [[10.0, 40.0], [30.0, 40.0], [30.0, 60.0], [10.0, 60.0]];
    let b = [[60.0, 40.0], [80.0, 40.0], [80.0, 60.0], [60.0, 60.0]];
    let body = format!("{}{}{}{}", poly(&PLATE), poly(&a), poly(&b), line([30.0, 50.0], [60.0, 50.0]));
    let r = sheet_of(&dxf_of(&body));
    assert_eq!(r.contours.len(), 3, "{:?}", r.contours);
    assert!((r.contours[0].area_mm2 - 10_000.0).abs() < 1e-9);
    for k in [1, 2] {
        assert_eq!((r.contours[k].depth, r.contours[k].parent), (2, Some(0)));
        assert!((r.contours[k].area_mm2 - 400.0).abs() < 1e-9);
    }
    assert_eq!(r.open_paths, 1);
    assert_simple_and_canonical(&r, "two shapes");
}

#[test]
fn an_empty_drawing_is_ok_with_no_contour() {
    let r = sheet_of(&dxf_of(""));
    assert!(r.contours.is_empty());
    assert_eq!(r.open_paths, 0);
    let json = guarded_sheet_json(&dxf_of(""), 0.01, &Limits::unlimited()).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["status"], "ok");
    assert_eq!(v["result"]["contours"].as_array().unwrap().len(), 0);
}

#[test]
fn a_clockwise_outline_comes_out_counter_clockwise() {
    let cw = [[0.0, 0.0], [0.0, 100.0], [100.0, 100.0], [100.0, 0.0]];
    let r = sheet_of(&dxf_of(&poly(&cw)));
    assert_eq!(r.contours.len(), 1);
    assert!(shoelace(&r.contours[0].ring) > 0.0);
    assert!((r.contours[0].area_mm2 - 10_000.0).abs() < 1e-9);
    assert_simple_and_canonical(&r, "clockwise");
}

#[test]
fn every_ring_of_every_fixture_is_simple_and_starts_at_its_lowest_left_vertex() {
    for name in [
        "decor_zones.dxf",
        "disc_1000.dxf",
        "inches_disc.dxf",
        "offcut_L.dxf",
        "ring_1000_300.dxf",
        "title_block.dxf",
        "touching.dxf",
        "bridge.dxf",
        "diamond_touch.dxf",
        "two_shapes_bridge.dxf",
    ] {
        assert_simple_and_canonical(&sheet(name), name);
    }
}

/// Un délai déjà échu est un refus, jamais un résultat faux.
#[test]
fn an_expired_deadline_is_a_refusal_not_a_wrong_result() {
    use nest_import::budget::Deadline;
    use nest_import::sheet::contours_of_edges;
    let sq = |x: f64, y: f64, s: f64| {
        let p = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
        (0..4).map(|i| (p[i], p[(i + 1) % 4])).collect::<Vec<_>>()
    };
    let mut edges = Vec::new();
    for i in 0..200 {
        edges.extend(sq(i as f64 * 3.0, 0.0, 2.0));
    }
    let dl = Deadline::new(1);
    std::thread::sleep(std::time::Duration::from_millis(20));
    assert!(contours_of_edges(&edges, &dl).is_err(), "attendu Expired");
    // Même dessin sans borne : résultat complet.
    let (c, _) = contours_of_edges(&edges, &Deadline::unlimited()).unwrap();
    assert_eq!(c.len(), 200);
}

// ---------------------------------------------------------------------------
// Tôles à courbes : arcs, ellipses, splines et polylignes à bulges. Les
// références viennent de `corpus_sheets/reference_areas.json` (analytiques, ou
// aire de la même spline aplatie par ezdxf à 1e-4), écrites par
// `build_corpus.py tole_courbes`.
// ---------------------------------------------------------------------------

struct RefContour {
    depth: usize,
    label: String,
    area: f64,
    /// Boîte de la courbe de référence (ezdxf), quand le JSON la porte.
    bbox: Option<[f64; 4]>,
}

fn reference(name: &str) -> Vec<RefContour> {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../parity/corpus_sheets/reference_areas.json");
    let text = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
    let v: serde_json::Value = serde_json::from_str(&text).expect("reference_areas.json");
    v[name]
        .as_array()
        .unwrap_or_else(|| panic!("pas de référence pour {name}"))
        .iter()
        .map(|r| RefContour {
            depth: r["depth"].as_u64().unwrap() as usize,
            label: r["label"].as_str().unwrap().to_string(),
            area: r["area_mm2"].as_f64().unwrap(),
            bbox: r["bbox"]
                .as_array()
                .map(|b| [0, 1, 2, 3].map(|i| b[i].as_f64().unwrap())),
        })
        .collect()
}

/// Deux segments non adjacents ne se croisent jamais (anneau simple au sens
/// strict, pas seulement sans sommet répété).
fn assert_no_crossings(r: &SheetResult, what: &str) {
    fn orient(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    }
    for (k, c) in r.contours.iter().enumerate() {
        let n = c.ring.len() - 1;
        for i in 0..n {
            for j in i + 2..n {
                if i == 0 && j == n - 1 {
                    continue;
                }
                let (a, b, p, q) = (c.ring[i], c.ring[i + 1], c.ring[j], c.ring[j + 1]);
                let d1 = orient(a, b, p);
                let d2 = orient(a, b, q);
                let d3 = orient(p, q, a);
                let d4 = orient(p, q, b);
                assert!(
                    !(d1 * d2 < 0.0 && d3 * d4 < 0.0),
                    "{what}: contour {k} se croise entre les segments {i} et {j}"
                );
            }
        }
    }
}

fn areas(r: &SheetResult) -> Vec<(usize, f64)> {
    r.contours.iter().map(|c| (c.depth, c.area_mm2)).collect()
}

/// Le contour a la structure et les aires de la référence (à 0,1 %) ; `convex`
/// = tous les contours sont convexes : un polygone inscrit n'est JAMAIS au-dessus.
fn check_against_reference(name: &str, convex: bool) -> SheetResult {
    let r = sheet(&format!("{name}.dxf"));
    let want = reference(name);
    assert_eq!(r.contours.len(), want.len(), "{name}: nombre de contours, trouvé {:?}", areas(&r));
    for (k, (c, w)) in r.contours.iter().zip(&want).enumerate() {
        assert_eq!(c.depth, w.depth, "{name}: profondeur du contour {k} ({})", w.label);
        assert!(
            rel(c.area_mm2, w.area) < 1e-3,
            "{name}: contour {k} ({}) aire {} contre {} (écart {:.4} %)",
            w.label,
            c.area_mm2,
            w.area,
            100.0 * rel(c.area_mm2, w.area)
        );
        if convex {
            assert!(
                c.area_mm2 <= w.area,
                "{name}: contour {k} ({}) au-dessus de la forme convexe : {} > {}",
                w.label,
                c.area_mm2,
                w.area
            );
        }
    }
    assert_eq!(r.open_paths, 0, "{name}: aucun trait ouvert attendu");
    assert_eq!(r.skipped_entities, 0);
    assert_simple_and_canonical(&r, name);
    assert_no_crossings(&r, name);
    r
}

#[test]
fn a_stadium_of_lines_and_arcs_is_one_convex_contour() {
    let r = check_against_reference("stadium_arcs", true);
    assert_eq!((r.contours[0].depth, r.contours[0].parent), (1, None));
    let b = r.contours[0].bbox;
    for (got, want) in b.iter().zip([0.0, 0.0, 1200.0, 600.0]) {
        assert!((got - want).abs() < 0.05, "bbox {b:?}");
    }
}

#[test]
fn nested_ellipses_are_two_convex_contours() {
    let r = check_against_reference("ellipse_plate", true);
    assert_eq!((r.contours[0].depth, r.contours[0].parent), (1, None));
    assert_eq!((r.contours[1].depth, r.contours[1].parent), (2, Some(0)));
}

#[test]
fn a_free_form_spline_keeps_its_two_inner_shapes() {
    let r = check_against_reference("blob_spline", false);
    assert_eq!((r.contours[0].depth, r.contours[0].parent), (1, None));
    for k in [1, 2] {
        assert_eq!((r.contours[k].depth, r.contours[k].parent), (2, Some(0)));
    }
    let b = r.contours[0].bbox;
    assert!(b[2] - b[0] > 1150.0 && b[3] - b[1] > 750.0, "haricot d'environ 1200 x 800 : {b:?}");
}

#[test]
fn a_disc_drawn_as_a_two_vertex_polyline_with_bulge_one_is_a_disc() {
    let r = check_against_reference("bulge_disc", true);
    let c = &r.contours[0];
    let exact = PI * 400.0 * 400.0;
    assert!(rel(c.area_mm2, exact) < 1e-3, "aire {} contre {exact}", c.area_mm2);
    assert_eq!(c.bbox.map(|v| v.round()), [100.0, 100.0, 900.0, 900.0]);
    // Les sommets sont SUR le cercle vrai (polygone inscrit), pas sur une corde.
    for p in &c.ring {
        let d = ((p[0] - 500.0).powi(2) + (p[1] - 500.0).powi(2)).sqrt();
        assert!((d - 400.0).abs() < 1e-3, "sommet {p:?} à {d} du centre");
    }
}

/// Le même contour sans ses bulges : la lecture par cordes de l'import de pièces.
fn bulge_plate_without_bulges() -> String {
    let pts = [
        [80.0, 0.0],
        [920.0, 0.0],
        [1000.0, 80.0],
        [1000.0, 520.0],
        [920.0, 600.0],
        [600.0, 600.0],
        [400.0, 600.0],
        [80.0, 600.0],
        [0.0, 520.0],
        [0.0, 80.0],
    ];
    poly(&pts)
}

#[test]
fn a_rounded_plate_with_an_inward_notch_loses_the_notch_area() {
    let r = check_against_reference("bulge_plate", false);
    let (plate, slot) = (&r.contours[0], &r.contours[1]);
    assert_eq!((plate.depth, plate.parent), (1, None));
    assert_eq!((slot.depth, slot.parent), (2, Some(0)));
    assert_eq!(plate.bbox, [0.0, 0.0, 1000.0, 600.0]);

    // Différence avec la lecture par cordes : le demi-disque de l'encoche en
    // MOINS, les quatre segments circulaires des coins en PLUS.
    let chorded = sheet_of(&dxf_of(&bulge_plate_without_bulges()));
    assert_eq!(chorded.contours.len(), 1);
    let corner_segment = 80.0_f64 * 80.0 * (PI / 4.0 - 0.5);
    let expected_gap = PI * 100.0 * 100.0 / 2.0 - 4.0 * corner_segment;
    let gap = chorded.contours[0].area_mm2 - plate.area_mm2;
    assert!(
        (gap - expected_gap).abs() < 0.002 * expected_gap,
        "écart avec la corde {gap}, attendu {expected_gap}"
    );
    assert!(chorded.contours[0].area_mm2 > plate.area_mm2, "la corde agrandit la tôle");

    // Tout sommet de l'encoche est sur le cercle vrai (centre (500,600), r = 100).
    let mut on_notch = 0;
    for p in &plate.ring {
        if p[1] < 599.999 && p[1] > 499.0 && p[0] > 399.0 && p[0] < 601.0 {
            let d = ((p[0] - 500.0).powi(2) + (p[1] - 600.0).powi(2)).sqrt();
            assert!((d - 100.0).abs() < 1e-3, "sommet d'encoche {p:?} à {d} du centre");
            on_notch += 1;
        }
    }
    assert!(on_notch >= 8, "encoche trop pauvre : {on_notch} sommets");
    // Les coins sont des quarts de cercle de rayon 80 : sommets sur les cercles.
    for (cx, cy) in [(80.0, 80.0), (920.0, 80.0), (920.0, 520.0), (80.0, 520.0)] {
        let near: Vec<&[f64; 2]> = plate
            .ring
            .iter()
            .filter(|p| {
                ((p[0] - cx).powi(2) + (p[1] - cy).powi(2)).sqrt() < 81.0
                    && (p[0] - cx).abs() > 1e-3
                    && (p[1] - cy).abs() > 1e-3
            })
            .collect();
        assert!(near.len() >= 2, "coin ({cx},{cy}) sans arc");
        for p in near {
            let d = ((p[0] - cx).powi(2) + (p[1] - cy).powi(2)).sqrt();
            assert!((d - 80.0).abs() < 1e-3, "sommet de coin {p:?} à {d}");
        }
    }
}

#[test]
fn a_mixed_outline_of_lines_arcs_and_a_spline_with_a_bulge_pattern() {
    let r = check_against_reference("fancy_mix", false);
    assert_eq!((r.contours[0].depth, r.contours[0].parent), (1, None));
    for c in &r.contours[1..] {
        assert_eq!((c.depth, c.parent), (2, Some(0)));
    }
    assert_eq!(r.contours.len(), 6, "contour + cinq formes du motif");
}

// --- bulges sous INSERT, échelle, miroir et OCS ---

fn bulge_poly(pts: &[([f64; 2], f64)], extra: &str) -> String {
    let mut s = format!("0\nLWPOLYLINE\n90\n{}\n70\n1\n{extra}", pts.len());
    for (p, b) in pts {
        s.push_str(&format!("10\n{}\n20\n{}\n42\n{}\n", p[0], p[1], b));
    }
    s
}

fn block_with(body: &str, insert: &str) -> Vec<u8> {
    format!(
        "0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nB\n10\n0\n20\n0\n{body}0\nENDBLK\n0\nENDSEC\n\
         0\nSECTION\n2\nENTITIES\n0\nINSERT\n2\nB\n10\n0\n20\n0\n{insert}0\nENDSEC\n0\nEOF\n"
    )
    .into_bytes()
}

/// Rectangle 200 x 100 avec une encoche rentrante de rayon 50 en haut.
fn notched_rect() -> Vec<([f64; 2], f64)> {
    vec![
        ([0.0, 0.0], 0.0),
        ([200.0, 0.0], 0.0),
        ([200.0, 100.0], 0.0),
        ([150.0, 100.0], -1.0),
        ([50.0, 100.0], 0.0),
        ([0.0, 100.0], 0.0),
    ]
}

#[test]
fn bulges_survive_scale_mirror_and_blocks() {
    let notch = 20_000.0 - PI * 50.0 * 50.0 / 2.0;
    // Dans un bloc inséré à l'échelle 2 (similitude) : aire x 4.
    let r = sheet_of(&block_with(&bulge_poly(&notched_rect(), ""), "41\n2\n42\n2\n"));
    assert_eq!(r.contours.len(), 1);
    assert!(rel(r.contours[0].area_mm2, 4.0 * notch) < 1e-3, "x2 : {}", r.contours[0].area_mm2);
    // Miroir en x : l'encoche reste rentrante (le signe du bulge suit le plan).
    let r = sheet_of(&block_with(&bulge_poly(&notched_rect(), ""), "41\n-1\n"));
    assert_eq!(r.contours.len(), 1);
    assert!(rel(r.contours[0].area_mm2, notch) < 1e-3, "miroir : {}", r.contours[0].area_mm2);
    assert_eq!(r.contours[0].bbox.map(|v| v.round()), [-200.0, 0.0, 0.0, 100.0]);
    // Échelle non uniforme (3, 1) : la polyligne à arcs est décomposée en LINE et
    // ELLIPSE ; l'encoche (demi-ellipse 150 x 50) reste rentrante. Aire = 3 x aire.
    let r = sheet_of(&block_with(&bulge_poly(&notched_rect(), ""), "41\n3\n"));
    assert_eq!(r.contours.len(), 1);
    assert!(rel(r.contours[0].area_mm2, 3.0 * notch) < 2e-3, "3x1 : {}", r.contours[0].area_mm2);
    // Disque (deux sommets, bulge 1) sous échelle non uniforme : ellipse 200 x 100.
    let disc = bulge_poly(&[([0.0, 0.0], 1.0), ([100.0, 0.0], 1.0)], "");
    let r = sheet_of(&block_with(&disc, "41\n2\n"));
    assert_eq!(r.contours.len(), 1);
    assert!(rel(r.contours[0].area_mm2, 2.0 * PI * 50.0 * 50.0) < 2e-3, "{}", r.contours[0].area_mm2);
}

#[test]
fn a_bulge_polyline_in_an_ocs_with_a_negative_normal_keeps_its_notch() {
    // Normale -Z : x -> -x. L'aire est celle de l'encoche rentrante, pas du bossage.
    let body = bulge_poly(&notched_rect(), "210\n0\n220\n0\n230\n-1\n");
    let r = sheet_of(&dxf_of(&body));
    assert_eq!(r.contours.len(), 1);
    let notch = 20_000.0 - PI * 50.0 * 50.0 / 2.0;
    assert!(rel(r.contours[0].area_mm2, notch) < 1e-3, "{}", r.contours[0].area_mm2);
    assert_eq!(r.contours[0].bbox.map(|v| v.round()), [-200.0, 0.0, 0.0, 100.0]);
}

#[test]
fn an_open_bulge_polyline_closed_by_a_line_is_a_half_disc() {
    // Demi-cercle par un bulge négatif, refermé par une LINE.
    let body = format!(
        "0\nLWPOLYLINE\n90\n2\n70\n0\n10\n0\n20\n0\n42\n-1\n10\n100\n20\n0\n{}",
        line([100.0, 0.0], [0.0, 0.0])
    );
    let r = sheet_of(&dxf_of(&body));
    assert_eq!(r.contours.len(), 1);
    assert!(rel(r.contours[0].area_mm2, PI * 50.0 * 50.0 / 2.0) < 1e-3, "{}", r.contours[0].area_mm2);
    // Bulge négatif de (0,0) vers (100,0) : l'arc passe au-dessus (y > 0).
    assert!(r.contours[0].bbox[3] > 49.0 && r.contours[0].bbox[1] > -1e-9, "{:?}", r.contours[0].bbox);
}

#[test]
fn a_straight_polyline_and_a_zero_bulge_polyline_read_alike() {
    let straight = sheet_of(&dxf_of(&poly(&PLATE)));
    let zero = sheet_of(&dxf_of(&bulge_poly(
        &PLATE.iter().map(|p| (*p, 0.0)).collect::<Vec<_>>(),
        "",
    )));
    assert_eq!(straight.contours[0].ring, zero.contours[0].ring);
}

// ---------------------------------------------------------------------------
// SPLINE aux formes rares : points d'ajustement seuls (retirée en silence par
// le lecteur partagé), fermée périodique (nœuds non bloqués), rationnelle.
// Références : `build_corpus.py tole_courbes` (courbe d'ezdxf sur son domaine
// valide, ou forme analytique).
// ---------------------------------------------------------------------------

fn has_skipped_spline_warning(r: &SheetResult) -> bool {
    r.warnings.iter().any(|w| w.contains("skipped entity SPLINE"))
}

#[test]
fn a_fit_point_only_closed_spline_is_reported_not_dropped_in_silence() {
    // Le lecteur partagé retire cette SPLINE (aucun nœud ni point de contrôle) :
    // la tôle n'a plus que le disque, et doit le DIRE.
    let r = sheet("spline_fit_closed.dxf");
    assert_eq!(r.contours.len(), 1, "seul le disque : {:?}", areas(&r));
    assert!(rel(r.contours[0].area_mm2, PI * 80.0 * 80.0) < 1e-3);
    assert_eq!(r.skipped_entities, 1, "la SPLINE à points d'ajustement est comptée");
    assert!(has_skipped_spline_warning(&r), "avertissement attendu : {:?}", r.warnings);
}

#[test]
fn a_fit_point_only_spline_with_tangents_closing_a_rectangle_is_reported() {
    let r = sheet("spline_fit_open_tangents.dxf");
    assert_eq!(r.contours.len(), 1, "le rectangle reste ouvert : {:?}", areas(&r));
    assert_eq!(r.skipped_entities, 1);
    assert!(has_skipped_spline_warning(&r), "avertissement attendu : {:?}", r.warnings);
}

/// Boîte du contour 0 égale à celle de la courbe d'ezdxf, à la tolérance
/// d'aplatissement près (polygone inscrit : jamais plus large).
fn assert_bbox_of_reference(r: &SheetResult, name: &str) {
    let want = reference(name)[0].bbox.expect("bbox de référence");
    let b = r.contours[0].bbox;
    for k in 0..4 {
        assert!((b[k] - want[k]).abs() < 0.02, "{name}: bbox {b:?} contre {want:?}");
    }
}

#[test]
fn a_periodic_closed_spline_is_cut_to_its_valid_knot_domain() {
    // Nœuds uniformes non bloqués : sans ramener la courbe à [nœuds[3], nœuds[11]]
    // la tôle part vers l'origine (aire 646 902 au lieu de 687 333, boîte à 0,0).
    let r = check_against_reference("spline_periodic_closed", false);
    assert_bbox_of_reference(&r, "spline_periodic_closed");
    assert_eq!(r.contours[1].parent, Some(0));
}

#[test]
fn a_periodic_rational_spline_is_cut_to_its_valid_knot_domain() {
    let r = check_against_reference("spline_periodic_rational", false);
    assert_bbox_of_reference(&r, "spline_periodic_rational");
}

#[test]
fn a_closed_rational_clamped_spline_follows_the_weights() {
    let r = check_against_reference("spline_closed_rational", false);
    assert_bbox_of_reference(&r, "spline_closed_rational");
}

#[test]
fn a_rational_nurbs_circle_has_its_vertices_on_the_true_circle() {
    let r = check_against_reference("spline_rational_circle", true);
    for p in &r.contours[0].ring {
        let d = ((p[0] - 400.0).powi(2) + (p[1] - 400.0).powi(2)).sqrt();
        assert!((d - 300.0).abs() < 1e-3, "sommet {p:?} à {d} du centre");
    }
}
