//! Extrusion opposée (0,0,-1) et oblique : ARC, CIRCLE, LWPOLYLINE, POLYLINE et INSERT
//! ont leurs coordonnées en OCS, l'ELLIPSE tourne autour de sa normale. Le chemin Rust
//! ramène tout en WCS, normale +Z, dès la lecture. Valeurs lues par ezdxf 1.4.4 sur
//! ces mêmes fichiers (`make_path(e).flattening`, `vertices_in_wcs`, `points_in_wcs`).

use nest_import::dxf::decompose;
use nest_import::dxf::entities::Entity;
use nest_import::dxf::Document;

const MINUS_Z: &[u8] = include_bytes!("../../../parity/corpus_extra/extrusion_minus_z.dxf");
const OBLIQUE: &[u8] = include_bytes!("../../../parity/corpus_extra/extrusion_oblique.dxf");

/// (début, fin, boîte) ; début et fin non orientés, sans objet sur une courbe fermée.
type Curve = ([f64; 2], [f64; 2], [f64; 4]);

const MINUS_Z_TRUTH: &[Curve] = &[
    // CIRCLE (10, 0) r=5 : le trou à l'opposé de ce qu'une lecture naïve donnerait.
    ([-15.0, 0.0], [-15.0, 0.0], [-15.0, -5.0, -5.0, 5.0]),
    // ARC + deux LINE en WCS : le quart de disque ne se referme que du bon côté.
    ([-70.0, 300.0], [-50.0, 320.0], [-70.0, 300.0, -50.0, 320.0]),
    ([-70.0, 300.0], [-50.0, 300.0], [-70.0, 300.0, -50.0, 300.0]),
    ([-50.0, 300.0], [-50.0, 320.0], [-50.0, 300.0, -50.0, 320.0]),
];

fn canonical_entities(src: &[u8]) -> Vec<Entity> {
    let bytes = nest_import::canonical_dxf(src, 0.01).expect("canonical");
    Document::parse(&bytes).expect("reparse").entities
}

fn curve_of(e: &Entity) -> Vec<[f64; 2]> {
    nest_import::dxf::flatten::flatten_primitive(&decompose::primitive_of(e), 0.002)
}

fn bbox(pts: &[[f64; 2]]) -> [f64; 4] {
    let (mut b0, mut b1, mut b2, mut b3) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for p in pts {
        (b0, b1, b2, b3) = (b0.min(p[0]), b1.min(p[1]), b2.max(p[0]), b3.max(p[1]));
    }
    [b0, b1, b2, b3]
}

fn assert_bbox(got: [f64; 4], want: [f64; 4], what: &str) {
    for (g, w) in got.iter().zip(want) {
        assert!((g - w).abs() < 0.02, "{what} : boîte {got:?} au lieu de {want:?}");
    }
}

fn near(a: [f64; 2], b: [f64; 2]) -> bool {
    (a[0] - b[0]).abs() < 1e-4 && (a[1] - b[1]).abs() < 1e-4
}

fn assert_endpoints(pts: &[[f64; 2]], first: [f64; 2], last: [f64; 2], what: &str) {
    let (a, b) = (pts[0], *pts.last().unwrap());
    assert!(
        (near(a, first) && near(b, last)) || (near(a, last) && near(b, first)),
        "{what} : extrémités {a:?} → {b:?} au lieu de {first:?} → {last:?}"
    );
}

#[test]
fn circle_and_arc_land_on_the_opposite_side() {
    let flat = canonical_entities(MINUS_Z);
    for (i, (first, last, b)) in MINUS_Z_TRUTH.iter().enumerate() {
        let pts = curve_of(&flat[i]);
        if first != last {
            assert_endpoints(&pts, *first, *last, &format!("entité {i}"));
        }
        assert_bbox(bbox(&pts), *b, &format!("entité {i}"));
    }
}

#[test]
fn lwpolyline_and_polyline_are_read_in_world_coordinates() {
    let flat = canonical_entities(MINUS_Z);
    match (&flat[4], &flat[5]) {
        (Entity::LwPolyline(lw), Entity::Polyline(pl)) => {
            assert_eq!(lw.points, vec![[-200.0, 600.0], [-260.0, 600.0], [-260.0, 640.0], [-200.0, 640.0]]);
            assert_eq!(lw.bulges, vec![-0.5, 0.0, 0.25, 0.0]);
            assert_eq!(pl.points, vec![[-300.0, 900.0], [-360.0, 900.0], [-360.0, 940.0], [-300.0, 940.0]]);
            assert_eq!(pl.bulges, vec![-0.5, 0.0, 0.25, 0.0]);
        }
        other => panic!("LWPOLYLINE + POLYLINE attendues, reçu {other:?}"),
    }
}

#[test]
fn an_ellipse_keeps_its_center_and_turns_the_other_way() {
    // Centre et grand axe sont en WCS : (0, 1200) et (30, 0). La normale -Z envoie la
    // moitié 0..π SOUS le grand axe : y-min 1185, comme ezdxf.
    let flat = canonical_entities(MINUS_Z);
    let pts = curve_of(&flat[6]);
    assert_endpoints(&pts, [30.0, 1200.0], [-30.0, 1200.0], "ELLIPSE");
    assert_bbox(bbox(&pts), [-30.0, 1185.0, 30.0, 1200.0], "ELLIPSE");
}

#[test]
fn an_insert_with_a_negative_extrusion_is_placed_like_ezdxf() {
    let flat = canonical_entities(MINUS_Z);
    assert_eq!(flat.len(), 18);
    // Deuxième INSERT, rotation 30 et échelle 2 : ARC et premier LINE selon ezdxf.
    assert_endpoints(&curve_of(&flat[13]), [-400.0, 1800.0], [-469.282032, 1840.0], "LINE");
    let arc = curve_of(&flat[14]);
    assert_endpoints(&arc, [-469.282032, 1840.0], [-480.262794, 1880.980762], "ARC");
    assert_bbox(bbox(&arc), [-484.28194, 1840.0, -469.28203, 1880.98076], "ARC");
}

#[test]
fn every_part_closes_with_the_rings_of_ezdxf() {
    let r = nest_import::import_file(MINUS_Z, 0.01).expect("import");
    assert_eq!(r.parts.len(), 7, "aucun contour perdu");
    let boxes: Vec<[f64; 4]> = r.parts.iter().map(|p| bbox(&p.coordinates)).collect();
    // Anneaux du chemin Python (read_dxf_file + build_geometry), mêmes fichiers.
    for (b, want) in boxes.iter().zip([
        [-15.0, -4.99, -5.0, 4.99],
        [-70.0, 300.0, -50.0, 320.0],
        [-260.0, 600.0, -200.0, 640.0],
        [-360.0, 900.0, -300.0, 940.0],
        [-30.0, 1185.0, 30.0, 1200.0],
        [-455.0, 1500.0, -400.0, 1530.0],
        [-484.278, 1800.0, -370.0, 1906.961],
    ]) {
        assert_bbox(*b, want, "pièce");
    }
}

#[test]
fn a_cut_file_written_with_extrusion_is_read_with_its_handles() {
    // Une copie canonique du serveur garde l'OCS d'ezdxf : le navigateur peut l'exporter
    // par handle, et la pièce doit rester où elle est.
    let dxf = "0\nSECTION\n2\nENTITIES\n\
        0\nARC\n5\nAA\n8\nCUT\n10\n50.0\n20\n0.0\n40\n20.0\n50\n0.0\n51\n90.0\n\
        210\n0.0\n220\n0.0\n230\n-1.0\n0\nENDSEC\n0\nEOF\n";
    let doc = Document::parse(dxf.as_bytes()).expect("parse");
    match doc.entities.as_slice() {
        [Entity::Arc(a)] => {
            assert_eq!(a.common.handle, "AA");
            assert_eq!(a.center, [-50.0, 0.0]);
            assert_eq!((a.start_angle, a.end_angle), (90.0, 180.0));
        }
        other => panic!("un ARC attendu, reçu {other:?}"),
    }
}

#[test]
fn a_lone_group_230_is_no_extrusion_like_ezdxf() {
    // ezdxf ne lit la normale que si le groupe 210 l'ouvre : (0, 0, 1) ici.
    let dxf = "0\nSECTION\n2\nENTITIES\n\
        0\nCIRCLE\n8\n0\n10\n10.0\n20\n0.0\n40\n5.0\n230\n-1.0\n0\nENDSEC\n0\nEOF\n";
    let doc = Document::parse(dxf.as_bytes()).expect("parse");
    match doc.entities.as_slice() {
        [Entity::Circle(c)] => assert_eq!(c.center, [10.0, 0.0]),
        other => panic!("un CIRCLE attendu, reçu {other:?}"),
    }
}

#[test]
fn an_oblique_extrusion_is_projected_like_ezdxf() {
    let flat = canonical_entities(OBLIQUE);
    assert_eq!(flat.len(), 3);
    assert_bbox(bbox(&curve_of(&flat[0])), [-182.2, 0.0, -158.2, 40.0], "LWPOLYLINE");
    assert_bbox(bbox(&curve_of(&flat[1])), [-30.0, 488.0, 30.0, 512.0], "ELLIPSE");
    assert_bbox(bbox(&curve_of(&flat[2])), [-20.0, -650.0, 0.0, -634.0], "INSERT");
}

#[test]
fn a_circle_under_an_oblique_extrusion_becomes_its_projection() {
    // CIRCLE (10, 20, 5) r=8, normale (0, 0.6, 0.8). ezdxf rend une boîte
    // [-18, -19.4, -2, -6.6]. Pas d'échantillon de parité : ezdxf garde un cercle
    // aplati en n-gone, ici une ELLIPSE, la même courbe avec d'autres sommets.
    let dxf = "0\nSECTION\n2\nENTITIES\n\
        0\nCIRCLE\n8\n0\n10\n10.0\n20\n20.0\n30\n5.0\n40\n8.0\n\
        210\n0.0\n220\n0.6\n230\n0.8\n0\nENDSEC\n0\nEOF\n";
    let doc = Document::parse(dxf.as_bytes()).expect("parse");
    assert_bbox(bbox(&curve_of(&doc.entities[0])), [-18.0, -19.4, -2.0, -6.6], "CIRCLE");
}
