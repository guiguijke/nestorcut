//! ARC d'un tour entier dans le fichier de coupe. Tournés par la pose, ses angles
//! valaient par exemple 185.61499999999998 et 545.615 : ramenés modulo 360, ils ne
//! sont plus égaux à l'arrondi près, et ezdxf lisait un point au lieu du trou
//! (36 poses sur 200). Un tour entier s'écrit donc 0 / 360 ; un arc partiel
//! tourne toujours avec la pièce.

use nest_export::{build_part_dxf, Placement};
use nest_import::dxf::entities::{Arc, Common, Entity};
use std::collections::HashMap;

/// Groupes 50 et 51 (angles de départ et de fin) du premier ARC du fichier.
fn arc_angles(dxf: &str) -> (f64, f64) {
    let lines: Vec<&str> = dxf.lines().map(str::trim).collect();
    let at = lines.iter().position(|l| *l == "ARC").expect("ARC");
    let group = |code: &str| -> f64 {
        let mut i = at + 1;
        while lines[i] != code {
            i += 2;
        }
        lines[i + 1].parse().unwrap()
    };
    (group("50"), group("51"))
}

fn export_arc(start: f64, end: f64, deg: f64) -> String {
    let arc = Entity::Arc(Arc {
        center: [50.0, 30.0],
        radius: 10.0,
        start_angle: start,
        end_angle: end,
        common: Common { handle: "A".into(), layer: "0".into(), color: 256 },
    });
    let mut sources = HashMap::new();
    sources.insert("src".to_string(), (vec![arc], vec![]));
    let placement = Placement {
        item_id: "p".into(),
        file_slug: "src".into(),
        handles: vec!["A".into()],
        angle: deg.to_radians(),
        x: 200.0,
        y: 200.0,
        color: None,
    };
    build_part_dxf(&sources, &[placement], false, 0.0, None, None, "mm")
}

#[test]
fn a_full_turn_arc_keeps_a_full_turn_at_any_placement_angle() {
    for k in 0..200 {
        let deg = if k < 4 { k as f64 * 90.0 } else { (k as f64 * 37.123) % 360.0 };
        assert_eq!(arc_angles(&export_arc(0.0, 360.0, deg)), (0.0, 360.0), "pose {deg}");
        // Départ quelconque : 33,3 / 393,3 ne vaut pas le même angle modulo 360 une
        // fois écrit, d'où l'écriture 0 / 360 pour tout tour entier.
        assert_eq!(arc_angles(&export_arc(33.3, 393.3, deg)), (0.0, 360.0), "pose {deg}");
    }
}

#[test]
fn a_partial_arc_still_turns_with_the_part() {
    let (s, e) = arc_angles(&export_arc(10.0, 100.0, 30.0));
    assert!((s - 40.0).abs() < 1e-9 && (e - 130.0).abs() < 1e-9, "{s} {e}");
}
