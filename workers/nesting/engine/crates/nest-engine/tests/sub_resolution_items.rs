//! Verrou des pièces SOUS LA RÉSOLUTION des f32 à l'échelle de la tôle.
//!
//! Sans espacement, rien ne gonfle la pièce. Posée à y ≈ 1000 (ulp 6e-5 mm), une
//! pièce de 1e-5 mm s'effondre sur une ligne, et trois endroits paniquaient :
//! `generate_bounding_box` (`Rect::try_new`), `remove_by_entity` (la forme
//! effondrée ne se voit plus elle-même, `sparrow/quantify/tracker.rs`) et
//! `simplify_shape` (une pièce plus mince que ce que le pôle sait voir une fois
//! centrée). Une panique tue tout le job, `panic = "abort"`.
//!
//! En release (`cargo test --release -p nest-engine`).

use nest_engine::progress::EventSink;
use nest_engine::run_json_with_sink;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;

fn rect(w: f64, h: f64) -> serde_json::Value {
    serde_json::json!([[0.0, 0.0], [w, 0.0], [w, h], [0.0, h], [0.0, 0.0]])
}

fn silent() -> EventSink {
    Arc::new(|_: &str| {})
}

fn spp(h: f64, items: &[(f64, f64, u64)]) -> String {
    let items: Vec<_> = items
        .iter()
        .enumerate()
        .map(|(i, (w, ph, q))| {
            serde_json::json!({
                "id": i, "demand": q, "allowed_orientations": [0.0, 90.0],
                "shape": {"type": "simple_polygon", "data": rect(*w, *ph)}
            })
        })
        .collect();
    serde_json::json!({"name": "resolution", "strip_height": h, "items": items}).to_string()
}

fn bpp(sw: f64, sh: f64, items: &[(f64, f64, u64)]) -> String {
    let items: Vec<_> = items
        .iter()
        .enumerate()
        .map(|(i, (w, ph, q))| {
            serde_json::json!({
                "id": i, "demand": q, "allowed_orientations": [0.0, 90.0],
                "shape": {"type": "simple_polygon", "data": rect(*w, *ph)}
            })
        })
        .collect();
    serde_json::json!({
        "name": "resolution-bpp", "items": items,
        "bins": [{"id": 0, "stock": 1, "cost": 100, "zones": [],
                  "shape": {"type": "simple_polygon", "data": rect(sw, sh)}}]
    })
    .to_string()
}

fn config(bias: &str, two_phase: bool, max_w: Option<f64>) -> String {
    let mut c = serde_json::json!({
        "time_budget_sec": 3600, "prng_seed": 7, "n_alternatives": 1,
        "poly_simpl_tolerance": 0.001, "min_item_separation": null,
        "narrow_concavity_cutoff": null, "live_events": false,
        "n_workers": 1, "separator_workers": 1,
        "explore_max_conseq_failed_attempts": 1, "compress_failure_decay": 0.3,
        "sa_max_iterations": 40, "biases": [bias], "two_phase": two_phase
    });
    if let Some(m) = max_w {
        c["max_strip_width"] = serde_json::json!(m);
    }
    c.to_string()
}

fn run(problem: &str, inst: &str, cfg: &str) -> Result<Result<usize, String>, String> {
    catch_unwind(AssertUnwindSafe(|| {
        run_json_with_sink(problem, inst, cfg, silent())
            .map(|o| o.alternatives.len())
            .map_err(|e| format!("{e:#}"))
    }))
    .map_err(|_| "panique".to_string())
}

#[test]
fn moteur_complet_sans_espacement_sur_des_pieces_sous_la_resolution() {
    let mut panics = vec![];
    for bias in ["left", "bottom", "balanced"] {
        for two_phase in [false, true] {
            for (h, items) in [
                (2000.0, vec![(1e-4, 1e-4, 2)]),
                (2000.0, vec![(1e-5, 1e-5, 2)]),
                (6000.0, vec![(1e-5, 1e-5, 1)]),
                // Une pièce normale et deux poussières : la forme effondrée croise les autres.
                (1250.0, vec![(0.045, 0.045, 3), (3.5e-5, 3.5e-5, 2)]),
                (2000.0, vec![(40.0, 100.0, 1), (1e-5, 1e-5, 1)]),
            ] {
                let cfg = config(bias, two_phase, Some(1000.0));
                if let Err(p) = run("spp", &spp(h, &items), &cfg) {
                    panics.push(format!("spp {bias} tp={two_phase} H={h} {items:?}: {p}"));
                }
            }
        }
        let cfg = config(bias, false, None);
        if let Err(p) = run("bpp", &bpp(1000.0, 2000.0, &[(1e-5, 1e-5, 2)]), &cfg) {
            panics.push(format!("bpp {bias}: {p}"));
        }
    }
    assert!(panics.is_empty(), "{}", panics.join("\n"));
}

/// Une pièce si mince qu'elle n'a plus de pôle : refus NOMMÉ, comme toute pièce
/// importable (`import_error.rs`), là où `simplify_shape` paniquait.
#[test]
fn une_piece_trop_mince_est_refusee_en_la_nommant() {
    let inst = serde_json::json!({
        "name": "mince", "strip_height": 6000.0,
        "items": [{"id": 0, "demand": 3, "allowed_orientations": [0.0],
            "shape": {"type": "simple_polygon", "data": [
                [1.4975100817814702, 0.0], [1.4975113026072138, 0.0],
                [1.4975113026072138, 43.127784650887364],
                [1.4975100817814702, 43.127784650887364],
                [1.4975100817814702, 0.0]
            ]}}]
    })
    .to_string();
    let r = run("spp", &inst, &config("left", false, Some(1000.0)));
    let msg = match r {
        Err(p) => panic!("{p}"),
        Ok(Ok(_)) => panic!("un refus nommé était attendu"),
        Ok(Err(e)) => e,
    };
    assert!(msg.starts_with("item_geometry:0:"), "message : {msg}");
}
