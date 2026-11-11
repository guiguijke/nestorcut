//! Verrou B4 — un run qui a perdu une pièce dans un trou (garde d'embouchure)
//! ne doit pas être classé comme complet par la fusion.
//!
//! Géométrie : hôte 100 × 100 à trou 10 × 10 (x, y ∈ [50, 60]), pièce 8 × 8.
//! 10 < 8 + 2 × space (space 2) : aucune translation légale, la garde retire
//! la pièce nichée dans le trou.

use jagua_rs::io::ext_repr::{ExtContainer, ExtItem, ExtLayout, ExtPlacedItem, ExtSPolygon, ExtShape, ExtTransformation};
use jagua_rs::probs::bpp::io::ext_repr::{ExtBPInstance, ExtBPSolution, ExtBin, ExtItem as BpExtItem};
use jagua_rs::probs::spp::io::ext_repr::{ExtItem as SpExtItem, ExtSPInstance, ExtSPSolution};
use nest_engine::bpp::constructive::DirBias;
use nest_engine::bpp::sa::Cost;
use nest_engine::config::EngineConfig;
use nest_engine::merge::{merge_bp_runs, merge_sp_runs, BpRun, SpMergeMode, SpRun};
use nest_engine::mouth_guard::{guard_bp_runs, guard_sp_runs};

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

fn sp_instance() -> ExtSPInstance {
    ExtSPInstance {
        name: "guard-merge-spp".to_owned(),
        items: vec![
            SpExtItem { base: base_item(0, rect(0.0, 0.0, 100.0, 100.0)), demand: 1 },
            SpExtItem { base: base_item(1, rect(0.0, 0.0, 8.0, 8.0)), demand: 1 },
        ],
        strip_height: 200.0,
    }
}

fn sp_run(seed: u64, strip_width: f32, used_height: f32, placed_items: Vec<ExtPlacedItem>) -> SpRun {
    SpRun {
        seed,
        bias: Some(DirBias::LeftFirst),
        evals: 1,
        used_height,
        solution: ExtSPSolution {
            strip_width,
            layout: layout(placed_items),
            density: 0.5,
            run_time_sec: 0,
        },
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

/// Run étroit (largeur 50) qui a perdu la pièce 1 dans le trou ; run complet
/// (largeur 60). Le complet doit être le rang 0, en mode directions comme à plat.
#[test]
fn spp_narrow_run_that_lost_a_part_does_not_rank_first() {
    let inst = sp_instance();
    let cfg = config();
    let mut runs = vec![
        sp_run(1, 50.0, 20.0, vec![placed(0, 0.0, 0.0), placed(1, 51.0, 51.0)]),
        sp_run(2, 60.0, 20.0, vec![placed(0, 0.0, 0.0), placed(1, 80.0, 80.0)]),
    ];
    let stats = guard_sp_runs(&inst, &cfg, &mut runs);
    assert_eq!(stats.removed, 1, "la garde doit retirer la pièce du trou serré");
    assert_eq!(runs[0].solution.layout.placed_items.len(), 1);

    let biases = [DirBias::LeftFirst];
    let dir = merge_sp_runs(&inst, &runs, SpMergeMode::Directions(&biases), None, 3)
        .expect("une solution existe");
    assert_eq!(dir.output.alternatives[0]["seed"].as_u64(), Some(2), "mode directions");

    let flat = merge_sp_runs(&inst, &runs, SpMergeMode::Flat, None, 3)
        .expect("une solution existe");
    assert_eq!(flat.output.alternatives[0]["seed"].as_u64(), Some(2), "mode à plat");
}

/// Témoin : deux runs complets gardent l'ordre qualité d'aujourd'hui.
#[test]
fn spp_two_complete_runs_keep_quality_order_in_both_modes() {
    let inst = sp_instance();
    let runs = vec![
        sp_run(2, 60.0, 20.0, vec![placed(0, 0.0, 0.0), placed(1, 80.0, 80.0)]),
        sp_run(1, 50.0, 20.0, vec![placed(0, 0.0, 0.0), placed(1, 81.0, 80.0)]),
    ];
    let biases = [DirBias::LeftFirst];
    let dir = merge_sp_runs(&inst, &runs, SpMergeMode::Directions(&biases), None, 3)
        .expect("une solution existe");
    let seeds: Vec<u64> = dir.output.alternatives.iter().map(|a| a["seed"].as_u64().unwrap()).collect();
    assert_eq!(seeds, vec![1, 2], "mode directions");

    let flat = merge_sp_runs(&inst, &runs, SpMergeMode::Flat, None, 3)
        .expect("une solution existe");
    let seeds: Vec<u64> = flat.output.alternatives.iter().map(|a| a["seed"].as_u64().unwrap()).collect();
    assert_eq!(seeds, vec![1, 2], "mode à plat");
}

fn sp_run_biased(
    seed: u64,
    bias: DirBias,
    strip_width: f32,
    used_height: f32,
    placed_items: Vec<ExtPlacedItem>,
) -> SpRun {
    SpRun { bias: Some(bias), ..sp_run(seed, strip_width, used_height, placed_items) }
}

fn seeds_of(out: &nest_engine::merge::SpMergeOutcome) -> Vec<u64> {
    out.output.alternatives.iter().map(|a| a["seed"].as_u64().unwrap()).collect()
}

/// F7 : mode directions, deux classes. Le run de la classe Left a perdu la
/// pièce 1 (une seule pièce posée, largeur 40 : meilleure qualité) ; le run de
/// la classe Bottom est complet (largeur 60). Les champions de classe ne se
/// choisissent que parmi les runs au nombre de pièces maximal : le rang 0 est
/// le run Bottom, complet. Le run Left amputé ne vient qu'après, dans `rest`.
#[test]
fn spp_directions_amputated_class_champion_does_not_rank_before_a_complete_class() {
    let inst = sp_instance();
    let runs = vec![
        sp_run_biased(1, DirBias::LeftFirst, 40.0, 20.0, vec![placed(0, 0.0, 0.0)]),
        sp_run_biased(2, DirBias::BottomFirst, 60.0, 20.0, vec![placed(0, 0.0, 0.0), placed(1, 80.0, 80.0)]),
    ];
    let biases = [DirBias::LeftFirst, DirBias::BottomFirst];
    let out = merge_sp_runs(&inst, &runs, SpMergeMode::Directions(&biases), None, 3)
        .expect("une solution existe");
    assert_eq!(seeds_of(&out), vec![2, 1], "rang 0 = run Bottom complet, run Left amputé ensuite");
    assert_eq!(
        out.output.alternatives[0]["solution"]["layout"]["placed_items"].as_array().unwrap().len(),
        2
    );
}

/// F7, variante : la classe amputée est la seconde dans l'ordre canonique, et
/// une classe a deux runs dont seul l'amputé est meilleur en qualité.
#[test]
fn spp_directions_champion_comes_from_runs_with_the_maximum_placed_count() {
    let inst = sp_instance();
    let runs = vec![
        // Left : un run amputé très étroit, un run complet plus large.
        sp_run_biased(1, DirBias::LeftFirst, 30.0, 20.0, vec![placed(0, 0.0, 0.0)]),
        sp_run_biased(2, DirBias::LeftFirst, 70.0, 20.0, vec![placed(0, 0.0, 0.0), placed(1, 80.0, 80.0)]),
        // Bottom : seul un run amputé.
        sp_run_biased(3, DirBias::BottomFirst, 35.0, 20.0, vec![placed(0, 0.0, 0.0)]),
    ];
    let biases = [DirBias::LeftFirst, DirBias::BottomFirst];
    let out = merge_sp_runs(&inst, &runs, SpMergeMode::Directions(&biases), None, 5)
        .expect("une solution existe");
    // Champions : Left -> run 2 (seul complet) ; Bottom n'a aucun run complet,
    // donc pas de champion. Puis `rest` par (pièces posées, qualité) : 2, 1, 3.
    assert_eq!(seeds_of(&out), vec![2, 1, 3]);
}

/// Témoin : deux classes complètes gardent l'ordre canonique d'aujourd'hui
/// (champion Left puis champion Bottom, même si Bottom est meilleur), puis le
/// reste par qualité.
#[test]
fn spp_directions_two_complete_classes_keep_the_canonical_order() {
    let inst = sp_instance();
    let runs = vec![
        sp_run_biased(1, DirBias::LeftFirst, 60.0, 20.0, vec![placed(0, 0.0, 0.0), placed(1, 80.0, 80.0)]),
        sp_run_biased(2, DirBias::BottomFirst, 50.0, 20.0, vec![placed(0, 0.0, 0.0), placed(1, 81.0, 80.0)]),
        sp_run_biased(3, DirBias::LeftFirst, 70.0, 20.0, vec![placed(0, 0.0, 0.0), placed(1, 82.0, 80.0)]),
    ];
    let biases = [DirBias::LeftFirst, DirBias::BottomFirst];
    let out = merge_sp_runs(&inst, &runs, SpMergeMode::Directions(&biases), None, 5)
        .expect("une solution existe");
    assert_eq!(seeds_of(&out), vec![1, 2, 3]);
}

/// F8 : tous les runs BPP ont perdu une pièce. On livre quand même une
/// alternative (la moins mauvaise), son coût détaillé compte la pièce retirée,
/// et la fusion ne répond pas « infaisable ».
#[test]
fn bpp_when_every_run_lost_a_part_an_alternative_is_still_delivered() {
    let inst = bp_instance();
    let cfg = config();
    let mut runs = vec![
        bp_run(1, 0, 2, vec![layout(vec![placed(0, 0.0, 0.0), placed(1, 51.0, 51.0)])]),
        bp_run(2, 0, 1, vec![layout(vec![placed(0, 0.0, 0.0), placed(1, 52.0, 52.0)])]),
    ];
    let stats = guard_bp_runs(&inst, &cfg, &mut runs);
    assert_eq!(stats.removed, 2, "la garde retire la pièce de chaque run");
    assert_eq!((runs[0].cost.unplaced, runs[1].cost.unplaced), (1, 1));

    let out = merge_bp_runs(&inst, &runs, &DirBias::ALL, 3)
        .expect("aucune erreur infaisable : une alternative partielle est livrée");
    assert!(!out.output.alternatives.is_empty());
    let first = &out.output.alternatives[0];
    assert_eq!(first["cost_detail"]["unplaced"].as_u64(), Some(1));
    // Meilleur coût de bac d'abord parmi les amputés.
    assert_eq!(first["seed"].as_u64(), Some(2));
}

/// F8 : appliquer la garde deux fois n'ajoute pas deux fois la pièce retirée.
#[test]
fn bpp_guard_applied_twice_counts_the_removed_part_once() {
    let inst = bp_instance();
    let cfg = config();
    let mut runs = vec![bp_run(1, 0, 1, vec![layout(vec![placed(0, 0.0, 0.0), placed(1, 51.0, 51.0)])])];
    let first = guard_bp_runs(&inst, &cfg, &mut runs);
    assert_eq!(first.removed, 1);
    assert_eq!(runs[0].cost.unplaced, 1);
    let second = guard_bp_runs(&inst, &cfg, &mut runs);
    assert_eq!(second.removed, 0, "la pièce est déjà retirée : rien à retirer");
    assert_eq!(runs[0].cost.unplaced, 1, "le compte ne doit pas passer à 2");
    assert_eq!(runs[0].solution.layouts[0].placed_items.len(), 1);
}
