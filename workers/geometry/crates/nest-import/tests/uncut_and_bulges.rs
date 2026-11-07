//! Ce qui ne sera pas découpé, et les arcs de polylignes que l'imbrication lit en cordes.
//!
//! Valeurs lues par ezdxf 1.4.4 et par le chemin Python (`build_geometry`) sur ces mêmes
//! fichiers : quatre entités rattachées à aucune pièce (LINE, LWPOLYLINE, POINT, SPLINE) ;
//! flèche = rayon - sqrt(rayon^2 - (corde/2)^2) avec `bulge_to_arc` : 0,300 mm pour un bulge
//! de 0,006 sur 100 mm, 0,500 mm pour -0,02 sur 50 mm.

use nest_import::findings::LEVEL_ATTENTION;

const UNCUT: &[u8] = include_bytes!("../../../parity/corpus_extra/uncut_entities.dxf");
const BULGE_LW: &[u8] = include_bytes!("../../../parity/corpus_extra/bulge_notable_lwpolyline.dxf");
const BULGE_POLY: &[u8] = include_bytes!("../../../parity/corpus_extra/bulge_notable_polyline.dxf");
const BULGE_SMALL: &[u8] = include_bytes!("../../../parity/corpus_extra/bulge_negligible.dxf");
const SVG_OPEN: &[u8] = include_bytes!("../../../parity/corpus_svg/svg_open_path_uncut.svg");

fn finding<'a>(r: &'a nest_import::ImportResult, code: &str) -> Option<&'a nest_import::findings::Finding> {
    r.findings.iter().find(|f| f.code == code)
}

#[test]
fn entities_attached_to_no_part_are_counted_by_type() {
    let r = nest_import::import_file(UNCUT, 0.01).expect("import");
    assert_eq!(r.parts.len(), 1, "la plaque seule");
    let f = finding(&r, "import.entitiesUncut").expect("constat entitiesUncut");
    assert_eq!(f.level, LEVEL_ATTENTION);
    assert_eq!(f.count, 4);
    assert_eq!(f.types, vec!["LINE", "LWPOLYLINE", "POINT", "SPLINE"]);
}

#[test]
fn text_removed_at_reading_is_counted_by_type() {
    // TEXT x2 et MTEXT x1 : ezdxf les supprime à la lecture (`read_dxf_file`).
    let r = nest_import::import_file(UNCUT, 0.01).expect("import");
    let f = finding(&r, "import.annotationsSkipped").expect("annotations");
    assert_eq!(f.count, 3);
    assert_eq!(f.types, vec!["TEXT", "MTEXT"]);
}

#[test]
fn a_clean_plate_has_nothing_uncut() {
    let dxf = "0\nSECTION\n2\nENTITIES\n\
        0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n\
        10\n0.0\n20\n0.0\n10\n100.0\n20\n0.0\n10\n100.0\n20\n50.0\n10\n0.0\n20\n50.0\n\
        0\nENDSEC\n0\nEOF\n";
    let r = nest_import::import_file(dxf.as_bytes(), 0.01).expect("import");
    assert!(finding(&r, "import.entitiesUncut").is_none());
}

#[test]
fn an_svg_path_attached_to_no_part_is_counted() {
    let r = nest_import::import_file(SVG_OPEN, 0.01).expect("import");
    assert_eq!(r.parts.len(), 1);
    let f = finding(&r, "import.entitiesUncut").expect("constat entitiesUncut");
    assert_eq!((f.count, f.types.clone()), (1, vec!["LWPOLYLINE".to_string()]));
}

#[test]
fn lwpolyline_bulges_report_the_largest_sagitta() {
    let r = nest_import::import_file(BULGE_LW, 0.01).expect("import");
    let f = finding(&r, "import.bulgesChorded").expect("constat bulgesChorded");
    assert_eq!(f.level, LEVEL_ATTENTION);
    // 0,30 mm compte ; 0,08 mm (0,0016 sur 100 mm) est sous le seuil de 0,1 mm.
    assert_eq!(f.count, 1);
    assert_eq!(f.value.as_deref(), Some("0.30"));
    // L'imbrication reste sur les cordes : la plaque est 100 x 50.
    assert_eq!((r.parts[0].width, r.parts[0].height), (100.0, 50.0));
}

#[test]
fn classic_polyline_bulges_and_the_closing_segment_are_measured() {
    let r = nest_import::import_file(BULGE_POLY, 0.01).expect("import");
    let f = finding(&r, "import.bulgesChorded").expect("constat bulgesChorded");
    // 0,01 sur 100 mm, et -0,02 sur le segment de fermeture de 50 mm : 0,50 mm chacun.
    assert_eq!(f.count, 2);
    assert_eq!(f.value.as_deref(), Some("0.50"));
}

#[test]
fn a_sagitta_below_the_threshold_says_nothing() {
    let r = nest_import::import_file(BULGE_SMALL, 0.01).expect("import");
    assert!(finding(&r, "import.bulgesChorded").is_none());
}

#[test]
fn the_sagitta_is_measured_in_mm_after_unit_conversion() {
    // Même arc de 0,30 mm écrit en centimètres : 100 mm = 10 cm, le bulge ne change pas.
    let dxf = "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n5\n0\nENDSEC\n\
        0\nSECTION\n2\nENTITIES\n\
        0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n\
        10\n0.0\n20\n0.0\n42\n0.006\n10\n10.0\n20\n0.0\n10\n10.0\n20\n5.0\n10\n0.0\n20\n5.0\n\
        0\nENDSEC\n0\nEOF\n";
    let r = nest_import::import_file(dxf.as_bytes(), 0.01).expect("import");
    let f = finding(&r, "import.bulgesChorded").expect("constat bulgesChorded");
    assert_eq!(f.value.as_deref(), Some("0.30"));
}
