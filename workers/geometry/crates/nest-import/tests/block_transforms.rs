//! INSERT résolus : la pièce qui sort du bloc doit être celle d'ezdxf, parce que
//! c'est elle que le fichier de coupe va tracer. Toutes les valeurs attendues sont
//! lues par ezdxf 1.4.4 sur ces mêmes fichiers (`recursive_decompose` puis
//! `vertices_in_wcs` / `make_path(...).flattening(...)`), jamais recopiées du Rust.

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
