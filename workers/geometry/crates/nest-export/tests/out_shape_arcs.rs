//! Cadre OUT_SHAPE d'une pièce à arcs. Le rayon d'un bulge est signé (piège 1 d'AGENTS.md) :
//! pris tel quel, le centre passait de l'autre côté de la corde et le cadre partait à des
//! dizaines de mm de la pièce (bulge 0,5 sur 100 mm : [-12,5 ; -95,68 ; 100 ; 0] au lieu de
//! [0 ; -25 ; 100 ; 0]). Valeurs de référence : `ezdxf.bbox.extents` 1.4.4 sur les mêmes polylignes.

use nest_export::{build_part_dxf, Placement};
use nest_import::dxf::entities::{Common, Entity, LwPolyline, Polyline};
use std::collections::HashMap;

fn common(handle: &str) -> Common {
    Common { handle: handle.into(), layer: "0".into(), color: 256 }
}

/// Coordonnées du cadre OUT_SHAPE : (minx, miny, maxx, maxy).
fn out_shape(dxf: &str, scale: f64) -> Vec<f64> {
    let lines: Vec<&str> = dxf.lines().map(str::trim).collect();
    let at = lines
        .windows(2)
        .position(|w| w[0] == "8" && w[1] == "OUT_SHAPE")
        .expect("calque OUT_SHAPE");
    let (mut xs, mut ys) = (vec![], vec![]);
    let mut i = at;
    while i + 1 < lines.len() && lines[i] != "0" {
        match lines[i] {
            "10" => xs.push(lines[i + 1].parse::<f64>().unwrap() / scale),
            "20" => ys.push(lines[i + 1].parse::<f64>().unwrap() / scale),
            _ => {}
        }
        i += 2;
    }
    let min = |v: &Vec<f64>| v.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = |v: &Vec<f64>| v.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    vec![min(&xs), min(&ys), max(&xs), max(&ys)]
}

fn export(entity: Entity, out_shape_on: bool, space: f64, x: f64, y: f64) -> String {
    let mut sources = HashMap::new();
    sources.insert("src".to_string(), (vec![entity], vec![]));
    let placement = Placement {
        item_id: "p".into(),
        file_slug: "src".into(),
        handles: vec!["A".into()],
        angle: 0.0,
        x,
        y,
        color: None,
    };
    build_part_dxf(&sources, &[placement], out_shape_on, space, None, None, "mm")
}

fn assert_frame(got: Vec<f64>, want: [f64; 4]) {
    for i in 0..4 {
        assert!((got[i] - want[i]).abs() < 1e-6, "{got:?} contre {want:?}");
    }
}

#[test]
fn the_frame_of_an_arc_part_hugs_the_arc() {
    let arc = Entity::LwPolyline(LwPolyline {
        points: vec![[0.0, 0.0], [100.0, 0.0]],
        bulges: vec![0.5, 0.0],
        closed: false,
        common: common("A"),
    });
    // espace 0 : l'analytique, [0 ; -25 ; 100 ; 0]
    assert_frame(out_shape(&export(arc.clone(), true, 0.0, 0.0, 0.0), 1.0), [0.0, -25.0, 100.0, 0.0]);
    // espace 2 et pièce posée en (10 ; 20) : la marge se retranche des deux côtés
    assert_frame(out_shape(&export(arc, true, 2.0, 10.0, 20.0), 1.0), [8.0, -7.0, 112.0, 22.0]);
}

#[test]
fn the_frame_follows_a_negative_bulge_and_a_classic_polyline() {
    let pts = vec![[0.0, 0.0], [100.0, 0.0], [100.0, 50.0], [0.0, 50.0]];
    let negative = Entity::LwPolyline(LwPolyline {
        points: vec![[0.0, 0.0], [100.0, 0.0]],
        bulges: vec![-0.5, 0.0],
        closed: false,
        common: common("A"),
    });
    assert_frame(out_shape(&export(negative, true, 0.0, 0.0, 0.0), 1.0), [0.0, 0.0, 100.0, 25.0]);
    let classic = Entity::Polyline(Polyline {
        points: pts,
        bulges: vec![0.5, 0.0, -0.5, 0.0],
        closed: true,
        common: common("A"),
        vertex_handles: vec![],
        seqend_handle: String::new(),
    });
    assert_frame(out_shape(&export(classic, true, 0.0, 0.0, 0.0), 1.0), [0.0, -25.0, 100.0, 50.0]);
}

#[test]
fn the_frame_is_off_by_default() {
    let line = Entity::LwPolyline(LwPolyline {
        points: vec![[0.0, 0.0], [100.0, 0.0]],
        bulges: vec![0.5, 0.0],
        closed: false,
        common: common("A"),
    });
    let dxf = export(line, false, 0.0, 0.0, 0.0);
    assert!(!dxf.contains("OUT_SHAPE"));
}
