//! Verrou : **aucun code de groupe ENTIER ne sort en flottant** du DXF
//! exporté (écart relevé à la vérification du lot 2b,
//! `docs/PLAN-IMPORT-2026-09-09.md` §9.5).
//!
//! La spec DXF fait des codes 60-79 et 90-99 des entiers : drapeau
//! « fermée » (70), nombre de sommets (90), couleur (62), degré et comptes
//! de spline (71/72/73), « vertices follow » (66). Nous les écrivions tous
//! en flottant (« 1.0 »). Notre propre lecteur ne le voit plus (depuis le
//! lot 2b il tolère le flottant), mais **un DXF exporté par NestorCut part
//! vers des CAM tiers** — SheetCAM notamment — qui n'ont aucune raison de
//! tolérer : un `70\n1.0` peut y valoir « contour ouvert », donc une pièce
//! non découpée.
//!
//! Le verrou lit la SORTIE, pas le code : il balaie les paires
//! (code, valeur) du DXF produit et refuse tout point décimal — et il couvre
//! les trois familles d'entités (importées, synthétisées, table des calques)
//! sur un fichier réel à trous, en mm ET en pouces.

use nest_export::Placement;

const PIECE_TROU: &[u8] = include_bytes!("../../../../fileprocessing/tests/fixtures/Piece_Trou.DXF");
const BLOCKS_NESTED: &[u8] = include_bytes!("../../../parity/corpus_extra/blocks_nested.dxf");

/// Codes de groupe ENTIERS de la spec DXF que notre exporteur émet.
fn is_integer_code(code: i32) -> bool {
    (60..=79).contains(&code) || (90..=99).contains(&code)
}

/// Rend les paires (code, valeur) fautives : valeur d'un code entier
/// contenant un point décimal (ou un exposant).
fn float_written_integers(dxf: &str) -> Vec<(i32, String)> {
    let lines: Vec<&str> = dxf.lines().collect();
    let mut bad = Vec::new();
    let mut i = 0;
    while i + 1 < lines.len() {
        if let Ok(code) = lines[i].trim().parse::<i32>() {
            let value = lines[i + 1].trim();
            if is_integer_code(code) && (value.contains('.') || value.contains('e') || value.contains('E')) {
                bad.push((code, value.to_string()));
            }
        }
        i += 2;
    }
    bad
}

fn export(src: &[u8], unit: &str, out_shape: bool) -> String {
    let res = nest_import::import_file(src, 0.01).expect("import");
    let canonical = nest_import::canonical_dxf(src, 0.01).expect("canonical_dxf");
    let doc = nest_import::dxf::Document::parse(&canonical).expect("reparse");
    let mut sources = std::collections::HashMap::new();
    sources.insert("src".to_string(), (doc.entities, doc.blocks));
    let transforms: Vec<Placement> = res
        .parts
        .iter()
        .enumerate()
        .map(|(i, p)| Placement {
            item_id: format!("part{i}"),
            file_slug: "src".into(),
            handles: p.handles.clone(),
            // angle en RADIANS (convention moteur) : un quart de tour sur les impaires.
            angle: if i % 2 == 0 { 0.0 } else { std::f64::consts::FRAC_PI_2 },
            x: 10.0 * i as f64,
            y: 5.0 * i as f64,
            color: Some("#2563EB".to_string()),
        })
        .collect();
    // out_shape + bornes de tôle : force les LWPOLYLINE SYNTHÉTISÉS
    // (BIN_BOUNDARY / OUT_SHAPE), qui ont leur propre code d'écriture.
    nest_export::build_part_dxf(
        &sources,
        &transforms,
        out_shape,
        2.0,
        Some(1000.0),
        Some(2000.0),
        unit,
    )
}

fn assert_clean(name: &str, dxf: &str) {
    let bad = float_written_integers(dxf);
    assert!(
        bad.is_empty(),
        "{name} : {} code(s) entier(s) écrits en flottant, ex. {:?}",
        bad.len(),
        &bad[..bad.len().min(5)]
    );
}

#[test]
fn a_holed_part_exports_integer_codes_as_integers() {
    let dxf = export(PIECE_TROU, "mm", true);
    // Le fichier doit réellement contenir ces codes, sinon le verrou est vide.
    assert!(dxf.contains("\n70\n"), "aucun code 70 dans la sortie");
    assert!(dxf.contains("\n90\n"), "aucun code 90 dans la sortie");
    assert!(dxf.contains("\n62\n"), "aucun code 62 (couleur) dans la sortie");
    assert_clean("Piece_Trou mm", &dxf);
}

#[test]
fn inches_and_blocks_export_integer_codes_as_integers() {
    assert_clean("Piece_Trou pouces", &export(PIECE_TROU, "inch", true));
    assert_clean("blocks_nested mm", &export(BLOCKS_NESTED, "mm", false));
}

/// SPLINE (71/72/73), POLYLINE + VERTEX (66/70) et couleur d'entité (62)
/// passent par des chemins d'écriture distincts. Ici les entités sont
/// CONSTRUITES à la main : le verrou porte sur l'écriture, pas sur ce que
/// l'importeur veut bien rendre (la seule spline du corpus est ouverte, donc
/// sans pièce — elle ne ferait rien écrire).
#[test]
fn spline_polyline_and_colors_export_as_integers() {
    use nest_import::dxf::entities::{Common, Entity, Polyline, Spline};

    let common = |h: &str| Common { handle: h.to_string(), layer: "CUT".into(), color: 3 };
    let spline = Entity::Spline(Spline {
        degree: 3,
        knots: vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0],
        control: vec![[0.0, 0.0], [10.0, 20.0], [30.0, 20.0], [40.0, 0.0]],
        weights: vec![],
        common: common("A1"),
    });
    let polyline = Entity::Polyline(Polyline {
        points: vec![[0.0, 0.0], [50.0, 0.0], [50.0, 50.0], [0.0, 50.0]],
        closed: true,
        common: common("A2"),
        vertex_handles: vec![],
        seqend_handle: String::new(),
    });
    let mut sources = std::collections::HashMap::new();
    sources.insert("src".to_string(), (vec![spline, polyline], Vec::new()));
    let transforms = vec![Placement {
        item_id: "p0".into(),
        file_slug: "src".into(),
        handles: vec!["A1".into(), "A2".into()],
        angle: 0.0,
        x: 0.0,
        y: 0.0,
        color: None,
    }];
    let dxf = nest_export::build_part_dxf(&sources, &transforms, false, 0.0, None, None, "mm");
    for marker in ["
SPLINE
", "
POLYLINE
", "
VERTEX
", "
71
", "
66
", "
62
"] {
        assert!(dxf.contains(marker), "sortie sans {marker:?} — le verrou ne mesurerait rien");
    }
    assert_clean("spline+polyline construites", &dxf);
    // Les valeurs elles-mêmes, pas seulement l'absence de point décimal.
    assert!(dxf.contains("
71
3
"), "degré de spline non entier");
    assert!(dxf.contains("
72
8
"), "compte de nœuds non entier");
    assert!(dxf.contains("
73
4
"), "compte de points de contrôle non entier");
    assert!(dxf.contains("
62
3
"), "couleur d'entité non entière");
}

/// L'en-tête ($INSUNITS/$MEASUREMENT) était déjà corrigé au lot 2b : on le
/// garde sous verrou, et on vérifie la VALEUR (pouces = 1, pas 1.0).
#[test]
fn the_header_declares_units_as_an_integer() {
    let dxf = export(PIECE_TROU, "inch", false);
    assert!(dxf.contains("$INSUNITS\n70\n1\n"), "en-tête pouces non entier");
    assert!(dxf.contains("$MEASUREMENT\n70\n0\n"), "en-tête mesure non entier");
    let mm = export(PIECE_TROU, "mm", false);
    assert!(mm.contains("$INSUNITS\n70\n4\n"), "en-tête mm non entier");
    assert!(mm.contains("$MEASUREMENT\n70\n1\n"), "en-tête mesure non entier");
}
