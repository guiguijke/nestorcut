//! Verrou B4 — un run qui a perdu une pièce dans un trou (garde d'embouchure)
//! ne doit pas être classé comme complet par la fusion.
//!
//! Géométrie : hôte 100 × 100 à trou 10 × 10 (x, y ∈ [50, 60]), pièce 8 × 8.
//! 10 < 8 + 2 × space (space 2) : aucune translation légale, la garde retire
//! la pièce nichée dans le trou.

use jagua_rs::io::ext_repr::{ExtContainer, ExtItem, ExtLayout, ExtPlacedItem, ExtSPolygon, ExtShape, ExtTransformation};
use jagua_rs::probs::bpp::io::ext_repr::{ExtBPInstance, ExtBPSolution, ExtBin, ExtItem as BpExtItem};
use nest_engine::bpp::constructive::DirBias;
use nest_engine::bpp::sa::Cost;
use nest_engine::config::EngineConfig;
use nest_engine::merge::{merge_bp_runs, BpRun};
use nest_engine::mouth_guard::guard_bp_runs;

fn rect(x0: f32, y0: f32, w: f32, h: f32) -> ExtShape {
    ExtShape::SimplePolygon(ExtSPolygon(vec![
        (x0, y0),
        (x0 + w, y0),
        (x0 + w, y0 + h),
        (x0, y0 + h),
    ]))
}

fn base_item(id: u64, shape: ExtShape) -> ExtItem {
    ExtItem { id, allowed_orientations: None, shape, min_quality: None }
}

/// Configuration minimale : espacement 2 mm, trou brut de l'hôte (item 0).
fn config() -> EngineConfig {
    serde_json::from_value(serde_json::json!({
        "time_budget_sec": 1,
        "prng_seed": 1,
        "min_item_separation": 2.0,
        "raw_holes": { "0": [[[50.0, 50.0], [60.0, 50.0], [60.0, 60.0], [50.0, 60.0]]] }
    }))
    .expect("config de test valide")
}

fn placed(item_id: u64, x: f32, y: f32) -> ExtPlacedItem {
    ExtPlacedItem {
        item_id,
        transformation: ExtTransformation { rotation: 0.0, translation: (x, y) },
    }
}

fn layout(placed_items: Vec<ExtPlacedItem>) -> ExtLayout {
    ExtLayout { container_id: 0, placed_items, density: 0.5 }
}

fn bp_instance() -> ExtBPInstance {
    ExtBPInstance {
        name: "guard-merge-bp".to_owned(),
        items: vec![
            BpExtItem { base: base_item(0, rect(0.0, 0.0, 100.0, 100.0)), demand: 1 },
            BpExtItem { base: base_item(1, rect(0.0, 0.0, 8.0, 8.0)), demand: 1 },
        ],
        bins: vec![ExtBin {
            base: ExtContainer { id: 0, shape: rect(0.0, 0.0, 200.0, 200.0), zones: vec![] },
            stock: 10,
            cost: 1,
        }],
    }
}

fn bp_run(seed: u64, unplaced: usize, bin_cost: u64, layouts: Vec<ExtLayout>) -> BpRun {
    BpRun {
        seed,
        bias: DirBias::LeftFirst,
        cost: Cost { unplaced, bin_cost, remnant: 0.0, falkenauer: 0.0 },
        iterations: 1,
        solution: ExtBPSolution { cost: bin_cost, layouts, density: 0.5, run_time_sec: 0 },
        finish: None,
    }
}

/// Run A : tout posé légalement, un bac de plus. Run B : meilleur coût et
/// unplaced 0 déclaré, mais la pièce 1 est dans le trou serré.
#[test]
fn bpp_run_that_lost_a_part_to_the_guard_does_not_win() {
    let inst = bp_instance();
    let cfg = config();
    let mut runs = vec![
        bp_run(1, 0, 2, vec![layout(vec![placed(0, 0.0, 0.0), placed(1, 80.0, 80.0)])]),
        bp_run(2, 0, 1, vec![layout(vec![placed(0, 0.0, 0.0), placed(1, 51.0, 51.0)])]),
    ];
    let stats = guard_bp_runs(&inst, &cfg, &mut runs);
    assert_eq!(stats.removed, 1, "la garde doit retirer la pièce du trou serré");
    assert_eq!(runs[0].cost.unplaced, 0, "run A intact");
    assert_eq!(runs[1].cost.unplaced, 1, "run B doit compter la pièce retirée");

    let out = merge_bp_runs(&inst, &runs, &DirBias::ALL, 3).expect("une solution existe");
    assert_eq!(
        out.output.alternatives[0]["seed"].as_u64(),
        Some(1),
        "le run complet (A) doit être le premier, pas le run B amputé"
    );
}

