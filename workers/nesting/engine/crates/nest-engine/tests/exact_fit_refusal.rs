//! Verrou des pièces À LA COTE EXACTE (correctif c du lot A).
//!
//! Avant : `sparrow/src/optimizer/lbf.rs` faisait `assert!` (« item N does not
//! seem to fit into the strip ») — `panic = "abort"`, donc `unreachable` en
//! navigateur et le job perdu — et, en BPP, les walks posaient ZÉRO pièce, la
//! densité sortait `null` (0/0) et la fusion échouait à relire son propre
//! export. Maintenant : refus typé `item_unplaceable:<id>:` qui NOMME la
//! pièce (modèle de `import_error.rs`), jamais une panique.
//!
//! Chaque cas est rejoué en natif ; le même jeu passe par le wasm dans
//! `bench/determinism_lock.py` / `bench/j7a_node_check.mjs`.
//!
//! En release (`cargo test --release -p nest-engine`).

use nest_engine::progress::EventSink;
use nest_engine::run_json_with_sink;
use std::sync::{Arc, Mutex};

fn rect(w: f64, h: f64) -> serde_json::Value {
    serde_json::json!([[0.0, 0.0], [w, 0.0], [w, h], [0.0, h], [0.0, 0.0]])
}

fn silent() -> (EventSink, Arc<Mutex<Vec<String>>>) {
    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let store = lines.clone();
    let sink: EventSink = Arc::new(move |l: &str| {
        if let Ok(mut v) = store.lock() {
            v.push(l.to_owned());
        }
    });
    (sink, lines)
}

fn spp_instance(w: f64, h: f64, strip_h: f64, rotations: &[f64]) -> String {
    serde_json::json!({
        "name": "cote-exacte",
        "strip_height": strip_h,
        "items": [{
            "id": 0, "demand": 1, "allowed_orientations": rotations,
            "shape": {"type": "simple_polygon", "data": rect(w, h)}
        }]
    })
    .to_string()
}

fn bpp_instance(w: f64, h: f64, sheet_w: f64, sheet_h: f64) -> String {
    serde_json::json!({
        "name": "cote-exacte-bpp",
        "items": [{
            "id": 0, "demand": 1, "allowed_orientations": [0.0, 90.0, 180.0, 270.0],
            "shape": {"type": "simple_polygon", "data": rect(w, h)}
        }],
        "bins": [{
            "id": 0, "stock": 1, "cost": 1, "zones": [],
            "shape": {"type": "simple_polygon", "data": rect(sheet_w, sheet_h)}
        }]
    })
    .to_string()
}

fn config(separation: f64, spp: bool) -> String {
    let mut c = serde_json::json!({
        "time_budget_sec": 2, "prng_seed": 7, "n_alternatives": 1,
        "poly_simpl_tolerance": 0.001, "min_item_separation": separation,
        "narrow_concavity_cutoff": null, "live_events": false,
        "n_workers": 1, "separator_workers": 1, "plateau_patience_sec": 1,
        "biases": ["left"]
    });
    if spp {
        c["max_strip_width"] = serde_json::json!(1000.0);
    }
    c.to_string()
}

fn error_text(r: anyhow::Result<nest_engine::EngineOutput>) -> String {
    match r {
        Ok(_) => panic!("un refus typé était attendu, le moteur a livré un résultat"),
        Err(e) => format!("{e:#}"),
    }
}

#[test]
fn spp_piece_a_la_cote_exacte_est_refusee_sans_panique() {
    // h = 996,0 sur une bande de 1000 à espacement 2, une seule orientation :
    // le seul cas qui tuait le moteur à lbf.rs:74.
    let (sink, lines) = silent();
    let r = run_json_with_sink(
        "spp",
        &spp_instance(100.0, 996.0, 1000.0, &[0.0]),
        &config(2.0, true),
        sink,
    );
    let msg = error_text(r);
    assert!(msg.starts_with("item_unplaceable:0:"), "message : {msg}");
    let evt = lines.lock().unwrap().join("\n");
    assert!(
        evt.contains("\"kind\":\"item_unplaceable\",\"item\":0"),
        "évènement attendu pour le worker Python : {evt}"
    );
}

#[test]
fn spp_a_995_99_passe_toujours() {
    // Témoin : 0,01 mm de jeu, le job aboutit comme avant.
    let (sink, _) = silent();
    let out = run_json_with_sink(
        "spp",
        &spp_instance(100.0, 995.99, 1000.0, &[0.0]),
        &config(2.0, true),
        sink,
    )
    .expect("995,99 doit se placer");
    assert_eq!(out.alternatives.len(), 1);
}

#[test]
fn bpp_996x1996_sur_1000x2000_espacement_2_est_refuse_en_nommant_la_piece() {
    let (sink, _) = silent();
    let msg = error_text(run_json_with_sink(
        "bpp",
        &bpp_instance(996.0, 1996.0, 1000.0, 2000.0),
        &config(2.0, false),
        sink,
    ));
    assert!(msg.starts_with("item_unplaceable:0:"), "message : {msg}");
}

#[test]
fn bpp_3000x1500_sur_3000x1500_espacement_0_est_refuse_en_nommant_la_piece() {
    let (sink, _) = silent();
    let msg = error_text(run_json_with_sink(
        "bpp",
        &bpp_instance(3000.0, 1500.0, 3000.0, 1500.0),
        &config(0.0, false),
        sink,
    ));
    assert!(msg.starts_with("item_unplaceable:0:"), "message : {msg}");
}

#[test]
fn bpp_temoin_une_piece_qui_tient_se_place() {
    let (sink, _) = silent();
    let out = run_json_with_sink(
        "bpp",
        &bpp_instance(100.0, 100.0, 1000.0, 2000.0),
        &config(2.0, false),
        sink,
    )
    .expect("une pièce de 100×100 tient");
    let placed: usize = out.alternatives[0]["solution"]["layouts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["placed_items"].as_array().unwrap().len())
        .sum();
    assert_eq!(placed, 1);
}

/// La volute du constat de la relecture critique (g 1,9, h 3,0, 2,5 tours,
/// ≈ 60 mm, deux exemplaires, une orientation, bande de 66,5 mm, espacement
/// 2) : sur le WASM, avec les graines 100 et 101 du pool, le constructif de la
/// PHASE 2 (cadre transposé) ne trouvait pas de place et paniquait à
/// lbf.rs:74. Une phase 2 impossible retombe maintenant sur la phase 1.
/// Fixture produite par le vrai `buildLocalPayload`.
/// NB : natif, les flottants diffèrent du wasm et ce cas passait déjà avant
/// le patch ; la preuve DISCRIMINANTE de la volute est côté wasm
/// (`bench/lot_a_wasm_check.mjs`). Ici : le moteur natif ne régresse pas.
#[test]
fn volute_du_constat_ne_panique_plus() {
    let instance = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/volute_lbf_instance.json"
    ))
    .expect("fixture volute");
    for seed in [100u64, 101] {
        let cfg = serde_json::json!({
            "time_budget_sec": 3600, "prng_seed": seed, "n_alternatives": 1,
            "poly_simpl_tolerance": 0.001, "min_item_separation": 2.0,
            "narrow_concavity_cutoff": [0.01, 0.01], "live_events": false,
            "n_workers": 1, "separator_workers": 1, "max_strip_width": 1000.0,
            "biases": ["left"], "finish_partial_sheet": false,
            "explore_max_conseq_failed_attempts": 3, "compress_failure_decay": 0.7
        })
        .to_string();
        let (sink, _) = silent();
        let out = run_json_with_sink("spp", &instance, &cfg, sink)
            .unwrap_or_else(|e| panic!("graine {seed} : {e:#}"));
        assert!(!out.alternatives.is_empty(), "graine {seed}");
    }
}
