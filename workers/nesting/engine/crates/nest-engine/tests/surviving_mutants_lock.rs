//! Verrous des correctifs de panique que les suites vertes laissaient retirer
//! (revue du lot A : mutation de chaque correctif, cinq survivants).
//!
//! Chaque test lance le moteur COMPLET sur l'entrée qui atteint le code retiré,
//! et exige le résultat de HEAD, pas seulement l'absence de panique :
//!
//! - `column_fill.rs` `try_change_strip_width` (rebalance « balanced ») : une
//!   bande de 1e-5 mm n'a pas de conteneur à la largeur de tôle, le passage est
//!   sauté ; retiré, `change_strip_width` panique (`problem.rs:35`).
//! - `container.rs` `can_split` : une tôle BPP de 5e-4 mm posée à (1000, 1000)
//!   n'a plus de quadtree constructible, le moteur la REFUSE ; retiré, il panique
//!   (`rect.rs:145`).
//! - `pole.rs` `try_quadrants` : tôle BPP de 0,002 mm au même endroit, le moteur
//!   LIVRE ; retiré, il panique (`rect.rs:146`).
//! - `import.rs` `first_buildable_strip` : sans espacement, la largeur de bande
//!   de départ est cherchée par doublement à partir d'un plancher ; un seul essai
//!   (2000 / 1e-3 mm) ou pas de plancher (6000 / 1e-5 mm) REFUSE le job que HEAD
//!   livre.
//!
//! En release (`cargo test --release -p nest-engine`), `panic = "abort"` n'étant
//! pas appliqué aux tests : la panique est attrapée et rendue en échec nommé.

use nest_engine::progress::EventSink;
use nest_engine::run_json_with_sink;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;

/// Issue d'un job : livré (largeur de bande du premier choix, si SPP), refusé
/// proprement (message), ou panique.
#[derive(Debug)]
enum Issue {
    Livre { largeur: Option<f64> },
    Refuse(String),
}

fn rect(w: f64, h: f64, x: f64, y: f64) -> serde_json::Value {
    serde_json::json!([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]])
}

fn item(id: u64, side: f64, demand: u64) -> serde_json::Value {
    serde_json::json!({
        "id": id, "demand": demand, "allowed_orientations": [0.0],
        "shape": {"type": "simple_polygon", "data": rect(side, side, 0.0, 0.0)}
    })
}

fn spp(h: f64, side: f64, demand: u64) -> String {
    serde_json::json!({"name": "verrou", "strip_height": h, "items": [item(0, side, demand)]})
        .to_string()
}

/// Tôle carrée `side` dont le coin est en (`off`, `off`), une pièce de `side / 4`.
fn bpp(side: f64, off: f64) -> String {
    serde_json::json!({
        "name": "verrou-bpp", "items": [item(0, side / 4.0, 1)],
        "bins": [{"id": 0, "stock": 1, "cost": 100, "zones": [],
                  "shape": {"type": "simple_polygon", "data": rect(side, side, off, off)}}]
    })
    .to_string()
}

fn config(sep: f64, bias: &str, two_phase: bool, max_w: Option<f64>) -> String {
    let mut c = serde_json::json!({
        "time_budget_sec": 3600, "prng_seed": 7, "n_alternatives": 1,
        "poly_simpl_tolerance": 0.001, "min_item_separation": sep,
        "narrow_concavity_cutoff": [0.01, 0.01], "live_events": false,
        "n_workers": 1, "separator_workers": 1,
        "explore_max_conseq_failed_attempts": 1, "compress_failure_decay": 0.3,
        "sa_max_iterations": 40, "biases": [bias], "two_phase": two_phase,
        "finish_partial_sheet": false
    });
    if let Some(m) = max_w {
        c["max_strip_width"] = serde_json::json!(m);
    }
    c.to_string()
}

fn run(problem: &str, inst: &str, cfg: &str) -> Issue {
    let silent: EventSink = Arc::new(|_: &str| {});
    let r = catch_unwind(AssertUnwindSafe(|| run_json_with_sink(problem, inst, cfg, silent)));
    match r {
        Err(p) => {
            let msg = p
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_default();
            panic!("{problem} : le moteur a paniqué : {msg}");
        }
        Ok(Err(e)) => Issue::Refuse(format!("{e:#}")),
        Ok(Ok(out)) => {
            assert!(!out.alternatives.is_empty(), "livré sans aucune alternative");
            Issue::Livre { largeur: out.alternatives[0].get("strip_width").and_then(|w| w.as_f64()) }
        }
    }
}

#[test]
fn bande_de_1e_5_balanced_une_phase_aboutit() {
    let issue = run(
        "spp",
        &spp(1e-5, 2e-6, 4),
        &config(0.0, "balanced", false, Some(1000.0)),
    );
    assert!(matches!(issue, Issue::Livre { .. }), "attendu : livré, obtenu {issue:?}");
}

#[test]
fn tole_bpp_de_5e_4_loin_de_l_origine_est_refusee_proprement() {
    let issue = run("bpp", &bpp(5e-4, 1000.0), &config(0.0, "left", false, None));
    match issue {
        Issue::Refuse(msg) => assert!(!msg.is_empty(), "refus sans message"),
        autre => panic!("attendu : refus propre, obtenu {autre:?}"),
    }
}

#[test]
fn tole_bpp_de_0_002_loin_de_l_origine_aboutit() {
    let issue = run("bpp", &bpp(0.002, 1000.0), &config(0.0, "left", false, None));
    assert!(matches!(issue, Issue::Livre { .. }), "attendu : livré, obtenu {issue:?}");
}

/// H = 2000, deux pièces de 1e-3 mm : la largeur de départ n'existe qu'à partir
/// du deuxième essai. Un seul essai refuse (`strip_height_below_separation`).
#[test]
fn sans_espacement_h_2000_pieces_de_1e_3_est_livre() {
    let issue = run("spp", &spp(2000.0, 1e-3, 2), &config(0.0, "left", false, Some(1000.0)));
    match issue {
        Issue::Livre { largeur: Some(w) } => {
            assert!((w - 0.00100001).abs() < 1e-7, "largeur {w}");
        }
        autre => panic!("attendu : livré à 0.00100001, obtenu {autre:?}"),
    }
}

/// H = 6000, deux pièces de 1e-5 mm : sous le plancher de doublement, la
/// largeur ne grandit jamais assez vite ; sans plancher, le job est refusé.
#[test]
fn sans_espacement_h_6000_pieces_de_1e_5_est_livre() {
    let issue = run("spp", &spp(6000.0, 1e-5, 2), &config(0.0, "left", false, Some(1000.0)));
    match issue {
        Issue::Livre { largeur: Some(w) } => {
            assert!((w - 0.000122).abs() < 1e-6, "largeur {w}");
        }
        autre => panic!("attendu : livré à 0.000122, obtenu {autre:?}"),
    }
}
