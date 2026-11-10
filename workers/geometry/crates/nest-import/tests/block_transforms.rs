//! INSERT résolus : la pièce qui sort du bloc doit être celle d'ezdxf, parce que
//! c'est elle que le fichier de coupe va tracer. Toutes les valeurs attendues sont
//! lues par ezdxf 1.4.4 sur ces mêmes fichiers (`recursive_decompose` puis
//! `vertices_in_wcs` / `make_path(...).flattening(...)`), jamais recopiées du Rust.

use nest_import::dxf::decompose;
use nest_import::dxf::entities::Entity;
use nest_import::dxf::Document;

const SCALE_ROTATION: &[u8] = include_bytes!("../../../parity/corpus_extra/block_scale_rotation.dxf");
const MIRROR_ROTATION: &[u8] = include_bytes!("../../../parity/corpus_extra/block_mirror_rotation.dxf");

fn canonical_entities(src: &[u8]) -> Vec<Entity> {
    let bytes = nest_import::canonical_dxf(src, 0.01).expect("canonical");
    Document::parse(&bytes).expect("reparse").entities
}

fn lw_points(e: &Entity) -> &[[f64; 2]] {
    match e {
        Entity::LwPolyline(p) => &p.points,
        other => panic!("LWPOLYLINE attendue, reçu {other:?}"),
    }
}

fn assert_close(got: &[[f64; 2]], want: &[[f64; 2]], what: &str) {
    assert_eq!(got.len(), want.len(), "{what} : {got:?}");
    for (g, w) in got.iter().zip(want) {
        assert!(
            (g[0] - w[0]).abs() < 1e-5 && (g[1] - w[1]).abs() < 1e-5,
            "{what} : {got:?} au lieu de {want:?}"
        );
    }
}

/// Un DXF d'un seul INSERT d'un bloc à une LINE, écrit à la main.
fn line_block_insert(attrs: &str) -> String {
    format!(
        "0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nB\n10\n0.0\n20\n0.0\n\
         0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n10.0\n21\n0.0\n0\nENDBLK\n0\nENDSEC\n\
         0\nSECTION\n2\nENTITIES\n0\nINSERT\n8\n0\n2\nB\n{attrs}0\nENDSEC\n0\nEOF\n"
    )
}

fn single_line(dxf: &str) -> ([f64; 2], [f64; 2]) {
    let doc = Document::parse(dxf.as_bytes()).expect("parse");
    let (flat, _) = nest_import::dxf::canonical::canonical_entities(&doc);
    match flat.as_slice() {
        [Entity::Line(l)] => (l.start, l.end),
        other => panic!("une LINE attendue, reçu {other:?}"),
    }
}

#[test]
fn the_scale_applies_before_the_rotation() {
    // xscale=2 rotation=90 : ezdxf rend (0,0)→(0,20), une ligne de 20 mm.
    let (s, e) = single_line(&line_block_insert("10\n0.0\n20\n0.0\n41\n2.0\n42\n1.0\n50\n90.0\n"));
    assert_close(&[s, e], &[[0.0, 0.0], [0.0, 20.0]], "xscale=2 rotation=90");
    // xscale=2 yscale=3 rotation=30 : ezdxf rend (0,0)→(17.320508,10).
    let (s, e) = single_line(&line_block_insert("10\n0.0\n20\n0.0\n41\n2.0\n42\n3.0\n50\n30.0\n"));
    assert_close(&[s, e], &[[0.0, 0.0], [17.320508, 10.0]], "xscale=2 yscale=3 rotation=30");
}

#[test]
fn a_part_inserted_with_unequal_scale_and_rotation_is_not_deformed() {
    let flat = canonical_entities(SCALE_ROTATION);
    assert_eq!(flat.len(), 6);
    let want: [&[[f64; 2]]; 6] = [
        &[[105.0, -10.0], [105.0, 50.0], [95.0, 50.0], [95.0, -10.0]],
        &[[102.0, 10.0], [102.0, 30.0], [98.0, 30.0], [98.0, 10.0]],
        &[[-7.410254, 192.834936], [44.55127, 222.834936], [42.05127, 227.165064], [-9.910254, 197.165064]],
        &[[9.160254, 204.133975], [26.480762, 214.133975], [25.480762, 215.866025], [8.160254, 205.866025]],
        &[[291.161165, 412.374369], [280.554564, 401.767767], [301.767767, 380.554564], [312.374369, 391.161165]],
        &[[293.989592, 402.474874], [290.454058, 398.93934], [298.93934, 390.454058], [302.474874, 393.989592]],
    ];
    for (i, (e, w)) in flat.iter().zip(want).enumerate() {
        assert_close(lw_points(e), w, &format!("contour {i}"));
    }
}

#[test]
fn a_rotated_mirror_lands_where_ezdxf_puts_it() {
    let flat = canonical_entities(MIRROR_ROTATION);
    assert_eq!(flat.len(), 3);
    let want: [&[[f64; 2]]; 3] = [
        &[[100.0, 100.0], [65.358984, 80.0], [60.358984, 88.660254], [76.339746, 120.980762], [85.0, 125.980762]],
        &[[300.0, 300.0], [320.0, 334.641016], [328.660254, 329.641016], [330.980762, 293.660254], [325.980762, 285.0]],
        &[[500.0, 500.0], [500.0, 420.0], [490.0, 420.0], [470.0, 480.0], [470.0, 500.0]],
    ];
    for (i, (e, w)) in flat.iter().zip(want).enumerate() {
        assert_close(lw_points(e), w, &format!("contour {i}"));
    }
}

#[test]
fn the_rings_of_the_nesting_follow_the_same_matrix() {
    // La première pièce de block_scale_rotation : 10 × 60 mm, à trou de 4 × 20.
    let r = nest_import::import_file(SCALE_ROTATION, 0.01).expect("import");
    assert_eq!(r.parts.len(), 3);
    let p = r.parts.iter().find(|p| (p.width - 10.0).abs() < 1e-3).expect("pièce 10 × 60");
    assert!((p.height - 60.0).abs() < 1e-3, "h={}", p.height);
    assert_eq!(p.holes.len(), 1);
}

// ---------------------------------------------------------------- miroirs

const MIRROR_ARC: &[u8] = include_bytes!("../../../parity/corpus_extra/block_mirror_arc.dxf");
const MIRROR_ELLIPSE: &[u8] = include_bytes!("../../../parity/corpus_extra/block_mirror_ellipse.dxf");
const MIRROR_TILTED: &[u8] =
    include_bytes!("../../../parity/corpus_extra/block_mirror_ellipse_tilted.dxf");
const MIRROR_NESTED: &[u8] = include_bytes!("../../../parity/corpus_extra/block_mirror_nested.dxf");
const MIRROR_BULGE: &[u8] = include_bytes!("../../../parity/corpus_extra/block_mirror_bulge.dxf");

/// (type, début, fin, boîte) d'une courbe selon ezdxf. Début et fin ne sont pas
/// orientés : un arc sous miroir se parcourt dans l'autre sens, c'est le même arc.
type Curve = (&'static str, [f64; 2], [f64; 2], [f64; 4]);

const ARC_TRUTH: &[Curve] = &[
    ("LINE", [0.000000, 0.000000], [-40.000000, 0.000000], [-40.00000, 0.00000, 0.00000, 0.00000]),
    ("ARC", [-40.000000, 0.000000], [-60.000000, 20.000000], [-60.00000, 0.00000, -40.00000, 20.00000]),
    ("LINE", [-60.000000, 20.000000], [-60.000000, 40.000000], [-60.00000, 20.00000, -60.00000, 40.00000]),
    ("LINE", [-60.000000, 40.000000], [0.000000, 40.000000], [-60.00000, 40.00000, 0.00000, 40.00000]),
    ("LINE", [0.000000, 40.000000], [0.000000, 0.000000], [0.00000, 0.00000, 0.00000, 40.00000]),
    ("CIRCLE", [-33.000000, 20.000000], [-33.000000, 20.000000], [-33.00000, 12.00000, -17.00000, 28.00000]),
    ("LINE", [200.000000, 400.000000], [120.000000, 400.000000], [120.00000, 400.00000, 200.00000, 400.00000]),
    ("ARC", [120.000000, 400.000000], [80.000000, 440.000000], [80.00000, 400.00000, 120.00000, 440.00000]),
    ("LINE", [80.000000, 440.000000], [80.000000, 480.000000], [80.00000, 440.00000, 80.00000, 480.00000]),
    ("LINE", [80.000000, 480.000000], [200.000000, 480.000000], [80.00000, 480.00000, 200.00000, 480.00000]),
    ("LINE", [200.000000, 480.000000], [200.000000, 400.000000], [200.00000, 400.00000, 200.00000, 480.00000]),
    ("CIRCLE", [134.000000, 440.000000], [134.000000, 440.000000], [134.00000, 424.00000, 166.00000, 456.00000]),
    ("LINE", [400.000000, 800.000000], [320.000000, 800.000000], [320.00000, 800.00000, 400.00000, 800.00000]),
    ("ELLIPSE", [320.000000, 800.000000], [280.000000, 820.000000], [280.00000, 800.00000, 320.00000, 820.00000]),
    ("LINE", [280.000000, 820.000000], [280.000000, 840.000000], [280.00000, 820.00000, 280.00000, 840.00000]),
    ("LINE", [280.000000, 840.000000], [400.000000, 840.000000], [280.00000, 840.00000, 400.00000, 840.00000]),
    ("LINE", [400.000000, 840.000000], [400.000000, 800.000000], [400.00000, 800.00000, 400.00000, 840.00000]),
    ("ELLIPSE", [334.000000, 820.000000], [334.000000, 820.000000], [334.00000, 812.00000, 366.00000, 828.00000]),
    ("LINE", [600.000000, 1200.000000], [634.641016, 1220.000000], [600.00000, 1200.00000, 634.64102, 1220.00000]),
    ("ARC", [634.641016, 1220.000000], [661.961524, 1212.679492], [634.64102, 1212.67949, 661.96152, 1222.68280]),
    ("LINE", [661.961524, 1212.679492], [671.961524, 1195.358984], [661.96152, 1195.35898, 671.96152, 1212.67949]),
    ("LINE", [671.961524, 1195.358984], [620.000000, 1165.358984], [620.00000, 1165.35898, 671.96152, 1195.35898]),
    ("LINE", [620.000000, 1165.358984], [600.000000, 1200.000000], [600.00000, 1165.35898, 620.00000, 1200.00000]),
    ("CIRCLE", [623.650635, 1195.179492], [623.650635, 1195.179492], [623.65064, 1187.17949, 639.65064, 1203.17949]),
    ("LINE", [800.000000, 1600.000000], [757.573593, 1557.573593], [757.57359, 1557.57359, 800.00000, 1600.00000]),
    ("ELLIPSE", [757.573593, 1557.573593], [722.218254, 1550.502525], [722.21825, 1546.21840, 757.57359, 1557.57359]),
    ("LINE", [722.218254, 1550.502525], [708.076118, 1564.644661], [708.07612, 1550.50253, 722.21825, 1564.64466]),
    ("LINE", [708.076118, 1564.644661], [771.715729, 1628.284271], [708.07612, 1564.64466, 771.71573, 1628.28427]),
    ("LINE", [771.715729, 1628.284271], [800.000000, 1600.000000], [771.71573, 1600.00000, 800.00000, 1628.28427]),
    ("ELLIPSE", [750.856079, 1579.140350], [750.856079, 1579.140350], [749.14243, 1577.42670, 769.54029, 1597.82456]),
    ("LINE", [1000.000000, 2000.000000], [1040.000000, 2000.000000], [1000.00000, 2000.00000, 1040.00000, 2000.00000]),
    ("ELLIPSE", [1040.000000, 2000.000000], [1060.000000, 2060.000000], [1040.00000, 2000.00000, 1060.00000, 2060.00000]),
    ("LINE", [1060.000000, 2060.000000], [1060.000000, 2120.000000], [1060.00000, 2060.00000, 1060.00000, 2120.00000]),
    ("LINE", [1060.000000, 2120.000000], [1000.000000, 2120.000000], [1000.00000, 2120.00000, 1060.00000, 2120.00000]),
    ("LINE", [1000.000000, 2120.000000], [1000.000000, 2000.000000], [1000.00000, 2000.00000, 1000.00000, 2120.00000]),
    ("ELLIPSE", [1025.000000, 2084.000000], [1025.000000, 2084.000000], [1017.00000, 2036.00000, 1033.00000, 2084.00000]),
];

const ELLIPSE_TRUTH: &[Curve] = &[
    ("ELLIPSE", [-30.000000, 0.000000], [30.000000, 0.000000], [-30.00000, 0.00000, 30.00000, 15.00000]),
    ("LINE", [30.000000, 0.000000], [-30.000000, 0.000000], [-30.00000, 0.00000, 30.00000, 0.00000]),
    ("ELLIPSE", [140.000000, 400.000000], [260.000000, 400.000000], [140.00000, 400.00000, 260.00000, 430.00000]),
    ("LINE", [260.000000, 400.000000], [140.000000, 400.000000], [140.00000, 400.00000, 260.00000, 400.00000]),
    ("ELLIPSE", [340.000000, 800.000000], [460.000000, 800.000000], [340.00000, 800.00000, 460.00000, 815.00000]),
    ("LINE", [460.000000, 800.000000], [340.000000, 800.000000], [340.00000, 800.00000, 460.00000, 800.00000]),
    ("ELLIPSE", [625.980762, 1215.000000], [574.019238, 1185.000000], [574.01924, 1180.15655, 627.04838, 1215.00000]),
    ("LINE", [574.019238, 1185.000000], [625.980762, 1215.000000], [574.01924, 1185.00000, 625.98076, 1215.00000]),
    ("ELLIPSE", [768.180195, 1568.180195], [831.819805, 1631.819805], [766.45023, 1568.18019, 831.81981, 1633.54977]),
    ("LINE", [831.819805, 1631.819805], [768.180195, 1568.180195], [768.18019, 1568.18019, 831.81981, 1631.81981]),
    ("ELLIPSE", [1030.000000, 2000.000000], [970.000000, 2000.000000], [970.00000, 2000.00000, 1030.00000, 2045.00000]),
    ("LINE", [970.000000, 2000.000000], [1030.000000, 2000.000000], [970.00000, 2000.00000, 1030.00000, 2000.00000]),
];

const TILTED_TRUTH: &[Curve] = &[
    ("ELLIPSE", [-15.556349, 22.627417], [15.556349, -22.627417], [-15.55635, -23.32896, 31.05336, 22.62742]),
    ("LINE", [-15.556349, 22.627417], [15.556349, -22.627417], [-15.55635, -22.62742, 15.55635, 22.62742]),
    ("ELLIPSE", [168.887302, 445.254834], [231.112698, 354.745166], [168.88730, 353.34208, 262.10673, 445.25483]),
    ("LINE", [168.887302, 445.254834], [231.112698, 354.745166], [168.88730, 354.74517, 231.11270, 445.25483]),
    ("ELLIPSE", [431.112698, 777.372583], [368.887302, 822.627417], [368.88730, 776.67104, 462.10673, 822.62742]),
    ("LINE", [368.887302, 822.627417], [431.112698, 777.372583], [368.88730, 777.37258, 431.11270, 822.62742]),
    ("ELLIPSE", [624.785902, 1188.182257], [575.214098, 1211.817743], [564.00726, 1185.42116, 624.78590, 1211.81774]),
    ("LINE", [624.785902, 1188.182257], [575.214098, 1211.817743], [575.21410, 1188.18226, 624.78590, 1211.81774]),
    ("ELLIPSE", [832.500000, 1600.500000], [767.500000, 1599.500000], [767.50000, 1599.50000, 845.96194, 1624.50490]),
    ("LINE", [767.500000, 1599.500000], [832.500000, 1600.500000], [767.50000, 1599.50000, 832.50000, 1600.50000]),
    ("ELLIPSE", [984.443651, 1932.117749], [1015.556349, 2067.882251], [968.94664, 1930.01312, 1015.55635, 2067.88225]),
    ("LINE", [1015.556349, 2067.882251], [984.443651, 1932.117749], [984.44365, 1932.11775, 1015.55635, 2067.88225]),
];

const NESTED_TRUTH: &[Curve] = &[
    ("LINE", [100.000000, 0.000000], [60.000000, 0.000000], [60.00000, 0.00000, 100.00000, 0.00000]),
    ("ARC", [60.000000, 0.000000], [40.000000, 20.000000], [40.00000, 0.00000, 60.00000, 20.00000]),
    ("LINE", [40.000000, 20.000000], [40.000000, 40.000000], [40.00000, 20.00000, 40.00000, 40.00000]),
    ("LINE", [40.000000, 40.000000], [100.000000, 40.000000], [40.00000, 40.00000, 100.00000, 40.00000]),
    ("LINE", [100.000000, 40.000000], [100.000000, 0.000000], [100.00000, 0.00000, 100.00000, 40.00000]),
    ("CIRCLE", [67.000000, 20.000000], [67.000000, 20.000000], [67.00000, 12.00000, 83.00000, 28.00000]),
    ("LINE", [300.000000, 400.000000], [340.000000, 400.000000], [300.00000, 400.00000, 340.00000, 400.00000]),
    ("ARC", [340.000000, 400.000000], [360.000000, 420.000000], [340.00000, 400.00000, 360.00000, 420.00000]),
    ("LINE", [360.000000, 420.000000], [360.000000, 440.000000], [360.00000, 420.00000, 360.00000, 440.00000]),
    ("LINE", [360.000000, 440.000000], [300.000000, 440.000000], [300.00000, 440.00000, 360.00000, 440.00000]),
    ("LINE", [300.000000, 440.000000], [300.000000, 400.000000], [300.00000, 400.00000, 300.00000, 440.00000]),
    ("CIRCLE", [333.000000, 420.000000], [333.000000, 420.000000], [317.00000, 412.00000, 333.00000, 428.00000]),
    ("LINE", [500.000000, 800.000000], [500.000000, 760.000000], [500.00000, 760.00000, 500.00000, 800.00000]),
    ("ARC", [500.000000, 760.000000], [480.000000, 740.000000], [480.00000, 740.00000, 500.00000, 760.00000]),
    ("LINE", [480.000000, 740.000000], [460.000000, 740.000000], [460.00000, 740.00000, 480.00000, 740.00000]),
    ("LINE", [460.000000, 740.000000], [460.000000, 800.000000], [460.00000, 740.00000, 460.00000, 800.00000]),
    ("LINE", [460.000000, 800.000000], [500.000000, 800.000000], [460.00000, 800.00000, 500.00000, 800.00000]),
    ("CIRCLE", [472.000000, 775.000000], [472.000000, 775.000000], [472.00000, 767.00000, 488.00000, 783.00000]),
    ("LINE", [110.000000, 1195.000000], [40.717968, 1235.000000], [40.71797, 1195.00000, 110.00000, 1235.00000]),
    ("ARC", [40.717968, 1235.000000], [-13.923048, 1220.358984], [-13.92305, 1220.35898, 40.71797, 1240.36560]),
    ("LINE", [-13.923048, 1220.358984], [-33.923048, 1185.717968], [-33.92305, 1185.71797, -13.92305, 1220.35898]),
    ("LINE", [-33.923048, 1185.717968], [70.000000, 1125.717968], [-33.92305, 1125.71797, 70.00000, 1185.71797]),
    ("LINE", [70.000000, 1125.717968], [110.000000, 1195.000000], [70.00000, 1125.71797, 110.00000, 1195.00000]),
    ("CIRCLE", [62.698730, 1185.358984], [62.698730, 1185.358984], [30.69873, 1169.35898, 62.69873, 1201.35898]),
    ("LINE", [389.393398, 1596.464466], [466.667464, 1617.169990], [389.39340, 1596.46447, 466.66746, 1617.16999]),
    ("ARC", [466.667464, 1617.169990], [494.951736, 1666.159785], [466.66746, 1617.16999, 496.32451, 1666.15978]),
    ("LINE", [494.951736, 1666.159785], [484.598974, 1704.796818], [484.59897, 1666.15978, 494.95174, 1704.79682]),
    ("LINE", [484.598974, 1704.796818], [368.687875, 1673.738532], [368.68787, 1673.73853, 484.59897, 1704.79682]),
    ("LINE", [368.687875, 1673.738532], [389.393398, 1596.464466], [368.68787, 1596.46447, 389.39340, 1673.73853]),
    ("CIRCLE", [443.336928, 1648.042451], [443.336928, 1648.042451], [411.33693, 1632.04245, 443.33693, 1664.04245]),
];

fn kind(e: &Entity) -> &'static str {
    match e {
        Entity::Line(_) => "LINE",
        Entity::Arc(_) => "ARC",
        Entity::Circle(_) => "CIRCLE",
        Entity::Ellipse(_) => "ELLIPSE",
        Entity::LwPolyline(_) => "LWPOLYLINE",
        Entity::Polyline(_) => "POLYLINE",
        other => panic!("type inattendu {other:?}"),
    }
}

fn near(a: [f64; 2], b: [f64; 2]) -> bool {
    (a[0] - b[0]).abs() < 1e-4 && (a[1] - b[1]).abs() < 1e-4
}

fn assert_curves(src: &[u8], truth: &[Curve]) {
    let flat = canonical_entities(src);
    assert_eq!(flat.len(), truth.len(), "nombre d'entités");
    for (i, (e, (k, first, last, bbox))) in flat.iter().zip(truth).enumerate() {
        assert_eq!(kind(e), *k, "entité {i}");
        let pts = nest_import::dxf::flatten::flatten_primitive(&decompose::primitive_of(e), 0.002);
        let (a, b) = (pts[0], *pts.last().unwrap());
        // Une courbe fermée n'a pas de début à comparer : sa boîte suffit.
        if first != last {
            assert!(
                (near(a, *first) && near(b, *last)) || (near(a, *last) && near(b, *first)),
                "entité {i} ({k}) : extrémités {a:?} → {b:?} au lieu de {first:?} → {last:?}"
            );
        }
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for p in &pts {
            (x0, y0, x1, y1) = (x0.min(p[0]), y0.min(p[1]), x1.max(p[0]), y1.max(p[1]));
        }
        let got = [x0, y0, x1, y1];
        for (g, w) in got.iter().zip(bbox) {
            assert!((g - w).abs() < 0.02, "entité {i} ({k}) : boîte {got:?} au lieu de {bbox:?}");
        }
    }
}

#[test]
fn an_arc_in_a_mirror_block_stays_on_its_side() {
    // xscale=-1, -2 uniforme, -2 inégal, miroir tourné : le D se referme.
    assert_curves(MIRROR_ARC, ARC_TRUTH);
    let r = nest_import::import_file(MIRROR_ARC, 0.01).expect("import");
    assert_eq!(r.parts.len(), 6, "chaque D donne une pièce");
    assert!(r.parts.iter().all(|p| p.holes.len() == 1), "chaque D garde son trou");
}

#[test]
fn a_partial_ellipse_in_a_mirror_block_stays_on_its_side() {
    assert_curves(MIRROR_ELLIPSE, ELLIPSE_TRUTH);
    let r = nest_import::import_file(MIRROR_ELLIPSE, 0.01).expect("import");
    assert_eq!(r.parts.len(), 6, "chaque demi-ellipse donne une pièce");
}

#[test]
fn a_tilted_ellipse_under_unequal_scale_gets_its_true_axes() {
    // Grand axe (30, 20) : l'échelle inégale rend ses axes non orthogonaux.
    assert_curves(MIRROR_TILTED, TILTED_TRUTH);
}

#[test]
fn nested_mirrors_compose() {
    // Deux miroirs s'annulent, un miroir et un non se retrouvent en miroir.
    assert_curves(MIRROR_NESTED, NESTED_TRUTH);
}

#[test]
fn every_written_ellipse_has_a_valid_ratio() {
    // yscale=3 sur une ellipse de ratio 0,5 : ezdxf échange les axes. Un ratio
    // > 1 écrit tel quel dans le DXF est invalide (audit ezdxf, logiciels de CAO).
    for src in [MIRROR_ARC, MIRROR_ELLIPSE, MIRROR_TILTED, MIRROR_BULGE] {
        for e in canonical_entities(src) {
            if let Entity::Ellipse(el) = e {
                assert!(el.ratio > 0.0 && el.ratio <= 1.0, "ratio {}", el.ratio);
            }
        }
    }
}

#[test]
fn bulges_change_sign_in_a_mirror_block() {
    let flat = canonical_entities(MIRROR_BULGE);
    // xscale=-1 : valeurs ezdxf ramenées en WCS (ezdxf garde le bulge et passe
    // l'extrusion à -Z, ce qui revient au signe opposé).
    match (&flat[0], &flat[1]) {
        (Entity::LwPolyline(lw), Entity::Polyline(pl)) => {
            assert_close(
                &lw.points,
                &[[0.0, 0.0], [-60.0, 0.0], [-60.0, 40.0], [0.0, 40.0]],
                "LWPOLYLINE miroir",
            );
            assert_eq!(lw.bulges, vec![-0.5, 0.0, 0.3, 0.0]);
            assert_close(
                &pl.points,
                &[[-20.0, 10.0], [-40.0, 10.0], [-40.0, 30.0], [-20.0, 30.0]],
                "POLYLINE miroir",
            );
            assert_eq!(pl.bulges, vec![-0.2, 0.0, -0.2, 0.0]);
        }
        other => panic!("LWPOLYLINE + POLYLINE attendues, reçu {other:?}"),
    }
}

#[test]
fn a_polyline_with_arcs_explodes_under_unequal_scale() {
    // xscale=-2 yscale=1 puis xscale=2 yscale=1 rotation=30 : ezdxf rend quatre
    // entités par polyligne, ELLIPSE pour les arcs et LINE pour le reste.
    let kinds: Vec<&str> = canonical_entities(MIRROR_BULGE).iter().map(kind).collect();
    assert_eq!(kinds.len(), 22);
    let exploded = ["ELLIPSE", "LINE", "ELLIPSE", "LINE", "ELLIPSE", "LINE", "ELLIPSE", "LINE"];
    assert_eq!(&kinds[4..12], &exploded, "xscale=-2 yscale=1");
    assert_eq!(&kinds[12..20], &exploded, "xscale=2 yscale=1 rotation=30");
    let bbox_of = |e: &Entity| {
        let pts = nest_import::dxf::flatten::flatten_primitive(&decompose::primitive_of(e), 0.002);
        let xs: Vec<f64> = pts.iter().map(|p| p[0]).collect();
        let ys: Vec<f64> = pts.iter().map(|p| p[1]).collect();
        [
            xs.iter().cloned().fold(f64::MAX, f64::min),
            ys.iter().cloned().fold(f64::MAX, f64::min),
            xs.iter().cloned().fold(f64::MIN, f64::max),
            ys.iter().cloned().fold(f64::MIN, f64::max),
        ]
    };
    let flat = canonical_entities(MIRROR_BULGE);
    // Première ELLIPSE de chaque cas : boîtes lues par ezdxf.
    for (i, want) in [(4, [480.0, 785.0, 600.0, 800.0]), (12, [900.0, 1199.880801, 1003.923048, 1260.0])] {
        let got = bbox_of(&flat[i]);
        for (g, w) in got.iter().zip(want) {
            assert!((g - w).abs() < 0.02, "entité {i} : {got:?} au lieu de {want:?}");
        }
    }
}

#[test]
fn a_rotated_child_under_an_unequal_parent_composes_the_matrices() {
    // Écart ASSUMÉ avec ezdxf, seul cas connu. Parent yscale=3, enfant rotation=30 :
    // la composition exacte envoie (10,0) en (8.660254, 15). ezdxf, lui, réécrit
    // l'INSERT enfant sans cisaillement (Insert.transform) et rend (5, 8.660254),
    // ce que ni le parent ni l'enfant ne décrivent. Le navigateur reste exact.
    let dxf = "0\nSECTION\n2\nBLOCKS\n\
        0\nBLOCK\n2\nCHILD\n10\n0.0\n20\n0.0\n\
        0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n10.0\n21\n0.0\n0\nENDBLK\n\
        0\nBLOCK\n2\nPARENT\n10\n0.0\n20\n0.0\n\
        0\nINSERT\n8\n0\n2\nCHILD\n10\n0.0\n20\n0.0\n50\n30.0\n0\nENDBLK\n0\nENDSEC\n\
        0\nSECTION\n2\nENTITIES\n0\nINSERT\n8\n0\n2\nPARENT\n10\n0.0\n20\n0.0\n42\n3.0\n\
        0\nENDSEC\n0\nEOF\n";
    let (s, e) = single_line(dxf);
    assert_close(&[s, e], &[[0.0, 0.0], [8.660254, 15.0]], "composition exacte");
}
