//! BPP mode (multi-sheet bin packing): parallel multi-start simulated
//! annealing over item sequences, evaluated by the greedy constructive.
//! Replaces the lbf subprocess + Python racing + hole-relocation post-passes.

pub mod constructive;
pub mod sa;

use crate::config::EngineConfig;
use crate::merge::{BpMergeError, BpRun, merge_bp_runs};
use crate::progress::EventSink;
use crate::spp::derive_seed;
use crate::{EngineOutput, map_workers};
use anyhow::{Context, Result, bail};
use constructive::DirBias;
use jagua_rs::entities::Instance as _;
use jagua_rs::io::import::Importer;
use jagua_rs::io::ext_repr::{ExtLayout, ExtPlacedItem, ExtShape, ExtTransformation};
use jagua_rs::probs::bpp::io::ext_repr::{ExtBPInstance, ExtBPSolution, ExtBin};
use jagua_rs::probs::spp::io::ext_repr::{
    ExtItem as SpExtItem, ExtSPInstance, ExtSPSolution,
};
use jagua_rs::entities::Layout;
use jagua_rs::geometry::DTransformation;
use jagua_rs::io::import::ext_to_int_transformation;
use jagua_rs::probs::bpp::entities::BPInstance;
use std::sync::{Arc, Mutex};
use rand::SeedableRng;
use rand::rngs::Xoshiro256PlusPlus;
use serde::{Deserialize, Serialize};
use jagua_rs::Instant;
use std::time::Duration;

/// Samples evaluated per item during constructive placement.
/// Hundreds of samples suffice for a good first-fit; SA drives the quality.
const N_SAMPLES_PER_ITEM: usize = 300;

#[derive(Serialize, Deserialize, Clone)]
pub struct ExtBPOutput {
    #[serde(flatten)]
    pub instance: ExtBPInstance,
    pub solution: ExtBPSolution,
}

struct WorkerRun {
    seed: u64,
    bias: DirBias,
    cost: sa::Cost,
    solution: jagua_rs::probs::bpp::entities::BPSolution,
    iterations: usize,
}

/// Snapshot complet de l'incumbent pour la vue live :
/// [[item_id, bin, rotation_deg, x, y]].
///
/// Piège 14g : jagua centre chaque pièce au centroïde à l'import
/// (`pre_transform`) — une frame émise depuis `d_transf` seul est en repère
/// INTERNE et décale toute pièce non centrée à l'origine. La frame doit être
/// sérialisée dans la convention EXTERNE (source), comme `emit_layout` SPP
/// (progress.rs) et l'export final (`export_layout_snapshot`).
/// C11 : intervalle minimal entre deux frames live BPP par worker.
const LIVE_THROTTLE: Duration = Duration::from_millis(500);

fn layout_event(
    w: usize,
    cost: &sa::Cost,
    solution: &jagua_rs::probs::bpp::entities::BPSolution,
    instance: &jagua_rs::probs::bpp::entities::BPInstance,
    started: &Instant,
    bias: DirBias,
) -> String {
    let mut items = String::new();
    items.push('[');
    let mut first = true;
    for (bin, ls) in solution.layout_snapshots.values().enumerate() {
        for pi in ls.placed_items.values() {
            if !first {
                items.push(',');
            }
            first = false;
            let ext_dt = jagua_rs::io::export::int_to_ext_transformation(
                &pi.d_transf,
                &instance.item(pi.item_id).shape_orig.pre_transform,
            );
            let t = ext_dt.translation();
            items.push_str(&format!(
                "[{},{},{:.2},{:.3},{:.3}]",
                pi.item_id,
                bin,
                ext_dt.rotation().to_degrees(),
                t.0,
                t.1
            ));
        }
    }
    items.push(']');
    // C12 (audit 2026-09-03) : `bins` = NOMBRE de tôles (l'ancien champ
    // portait bin_cost, coût 10/tôle — l'UI affichait un « nombre » faux
    // dès que le coût par tôle ≠ 1) ; le coût part dans bin_cost.
    format!(
        "{{\"type\":\"layout\",\"worker\":{},\"stage\":\"bpp-search\",\"feasible\":{},\"bins\":{},\"bin_cost\":{},\"unplaced\":{},\"remnant\":{:.4},\"elapsed_ms\":{},\"items\":{},\"bias\":\"{}\"}}",
        w,
        cost.unplaced == 0,
        solution.layout_snapshots.len(),
        cost.bin_cost,
        cost.unplaced,
        cost.remnant,
        started.elapsed().as_millis(),
        items,
        bias.as_str()
    )
}

pub fn run_bpp_mem(
    ext_instance: ExtBPInstance,
    config: &EngineConfig,
    sink: &EventSink,
) -> Result<EngineOutput> {
    let started = Instant::now();

    let sparrow_config = config.sparrow_config();
    let importer = Importer::new(
        sparrow_config.cde_config,
        sparrow_config.poly_simpl_tolerance,
        sparrow_config.min_item_separation,
        sparrow_config.narrow_concavity_cutoff_ratio,
    );
    let instance = jagua_rs::probs::bpp::io::import_instance(&importer, &ext_instance)
        .context("importing BPP instance into jagua-rs")?;

    let n_workers = config.n_workers();
    sink(&format!(
        "{{\"type\":\"start\",\"problem\":\"bpp\",\"name\":\"{}\",\"items\":{},\"workers\":{},\"budget_sec\":{}}}",
        ext_instance.name,
        instance.total_item_qty(),
        n_workers,
        config.time_budget_sec
    ));

    let instance = &instance;
    let deadline = Duration::from_secs(config.time_budget_sec);

    // Parallel multi-start: one SA walk per worker, each with a derived seed.
    // Deterministic per worker; ranking below is deterministic too.
    let live = config.live_events();
    let warm_start = config.initial_sequence.clone();
    let biases = config.dir_biases();
    let plateau_patience = config.plateau_patience();
    let sa_max_iterations = config.sa_max_iterations;
    // AB1 (L2-bis) : patience P3 pilotable par la config (A/B sans rebuild).
    let sa_stop_k = config.sa_stop_k.unwrap_or(sa::DEFAULT_STOP_K);
    let sa_stop_floor = config.sa_stop_floor.unwrap_or(sa::DEFAULT_STOP_FLOOR);
    let runs: Vec<WorkerRun> = map_workers(n_workers, |w| {
        let seed = derive_seed(config.prng_seed, w);
        let bias = biases[w % biases.len()];
        let mut rng = Xoshiro256PlusPlus::seed_from_u64(seed);
        // C11 (audit 2026-09-03) : throttle 500 ms des frames live BPP
        // (miroir du SPP) — chaque amélioration émettait ~30 Ko sans
        // limite, la descente initiale en produit des dizaines par seconde.
        // NB wasm : `now() - LIVE_THROTTLE` PANIQUE (web-time instant
        // sous-déborde quand l'horloge monotone de la page < 500 ms) —
        // None = « émettre immédiatement ».
        let last_live = std::cell::Cell::<Option<Instant>>::new(None);
        let throttled_layout = |cost: &sa::Cost, solution: &jagua_rs::probs::bpp::entities::BPSolution| {
            if !live {
                return;
            }
            let now = Instant::now();
            let due = match last_live.get() {
                Some(t) => now.duration_since(t) >= LIVE_THROTTLE,
                None => true,
            };
            if due {
                last_live.set(Some(now));
                sink(&layout_event(w, cost, solution, instance, &started, bias));
            }
        };
        let report = sa::anneal(
            instance,
            N_SAMPLES_PER_ITEM,
            deadline,
            bias,
            warm_start.clone(),
            plateau_patience,
            sa_max_iterations,
            sa_stop_k,
            sa_stop_floor,
            &mut rng,
                |iters, cost, solution| {
                    sink(&format!(
                        "{{\"type\":\"progress\",\"worker\":{},\"stage\":\"bpp-search\",\"iters\":{},\"feasible\":{},\"bins\":{},\"bin_cost\":{},\"unplaced\":{},\"elapsed_sec\":{},\"bias\":\"{}\"}}",
                        w,
                        iters,
                        cost.unplaced == 0,
                        solution.layout_snapshots.len(),
                        cost.bin_cost,
                        cost.unplaced,
                        started.elapsed().as_secs(),
                        bias.as_str()
                    ));
                    throttled_layout(cost, solution);
                },
                |iterations, cost, solution| {
                    sink(&format!(
                        "{{\"type\":\"heartbeat\",\"worker\":{},\"stage\":\"bpp-search\",\"iterations\":{},\"bins\":{},\"bin_cost\":{},\"unplaced\":{},\"elapsed_sec\":{}}}",
                        w,
                        iterations,
                        solution.layout_snapshots.len(),
                        cost.bin_cost,
                        cost.unplaced,
                        started.elapsed().as_secs()
                    ));
                    // Vue live BPP (bug 2026-08-29 : « 1 maj et c'est tout ») :
                    // les ameliorations deviennent rares apres la descente
                    // initiale — le heartbeat (1 Hz) embarque le snapshot de
                    // l'incumbent pour que la vue vive comme en SPP.
                    throttled_layout(cost, solution);
                },
            );
            // V14 (vérif 2026-09-04) : frame finale INCONDITIONNELLE avec
            // l'incumbent (miroir du report_final SPP) — le throttle 500 ms
            // pouvait autrement avaler la dernière amélioration et laisser
            // la vue sur un état antérieur.
            if live {
                sink(&layout_event(
                    w,
                    &report.best_cost,
                    &report.best_solution,
                    instance,
                    &started,
                    bias,
                ));
            }
            WorkerRun {
                seed,
                bias,
                cost: report.best_cost,
                solution: report.best_solution,
                iterations: report.iterations,
            }
        });

    // Rank: lexicographic cost, stable tie-break on seed. Alternatives are
    // grouped by directional bias class so the exported options are
    // structurally distinct: best run of each ACTIVE class, classes in fixed
    // order (left / bottom / balanced — the contract asked by users), then
    // the remaining runs by cost as fallback when a class has no feasible run
    // or more alternatives are requested than there are active classes.
    // La fusion est partagée avec l'entrée wasm `merge_alternatives` (J-093).
    let epoch = *sparrow::EPOCH;
    let mut exported: Vec<BpRun> = runs
        .iter()
        .map(|r| BpRun {
            seed: r.seed,
            bias: r.bias,
            cost: r.cost,
            iterations: r.iterations,
            solution: jagua_rs::probs::bpp::io::export(instance, &r.solution, epoch),
            finish: None,
        })
        .collect();

    // Plan « dernière tôle » §3.1 / §8.3 : la tôle partielle des runs qui
    // seront EXPORTÉS est refaite en SPP de la même direction, avant la
    // fusion. Le coût du recuit n'a pas de direction et le biais du
    // constructif est un multiplicateur faible : la direction est un
    // objectif de SOLVEUR, elle se règle ici, pas dans un post-pass −X.
    finish_exported_runs(
        &ext_instance, instance, &mut exported, &biases, config, &started, sink,
    );

    match merge_bp_runs(&ext_instance, &exported, &biases, config.n_alternatives) {
        Ok(merged) => {
            sink(&format!(
                "{{\"type\":\"done\",\"cost\":{},\"density\":{:.4},\"alternatives\":{},\"elapsed_sec\":{}}}",
                merged.best_cost,
                merged.best_density,
                merged.output.alternatives.len(),
                started.elapsed().as_secs()
            ));
            Ok(merged.output)
        }
        Err(BpMergeError::Infeasible { best_unplaced }) => {
            sink(&format!(
                "{{\"type\":\"error\",\"reason\":\"infeasible\",\"unplaced\":{},\"elapsed_sec\":{}}}",
                best_unplaced,
                started.elapsed().as_secs()
            ));
            bail!("no feasible solution: {best_unplaced} items could not be placed")
        }
    }
}


// ===========================================================================
// Finition de la tôle partielle — plan docs/PLAN-DERNIERE-TOLE-2026-09-09.md
// ===========================================================================

/// Décalage de seed de la finition. Le plan écrit `0x5EED_F1N1`, qui n'est
/// PAS un littéral hexadécimal valide (`N`) : même intention — un flux
/// distinct de celui du walk BPP — avec une constante nommée.
pub const FINISH_SEED_XOR: u64 = 0x5EED_F111;

/// Au-delà de ce taux de remplissage, la tôle n'est plus « partielle » :
/// la refaire en SPP n'aurait pas de sens (et coûterait du budget).
const FINISH_MAX_FILL: f32 = 0.5;

/// Tolérance de la garde de faisabilité (piège #6 : sparrow n'a pas de
/// borne dure, une solution « feasible » peut dépasser la tôle).
const FINISH_EPS: f32 = 1e-3;

/// Sommets des anneaux EXTERNES d'une forme (les trous n'élargissent pas
/// l'AABB). Suffisant pour une AABB : pour un polygone, l'AABB des sommets
/// transformés est exacte.
fn shape_points(shape: &ExtShape) -> Vec<(f32, f32)> {
    match shape {
        ExtShape::Rectangle {
            x_min,
            y_min,
            width,
            height,
        } => vec![
            (*x_min, *y_min),
            (*x_min + *width, *y_min),
            (*x_min + *width, *y_min + *height),
            (*x_min, *y_min + *height),
        ],
        ExtShape::SimplePolygon(p) => p.0.clone(),
        ExtShape::Polygon(p) => p.outer.0.clone(),
        ExtShape::MultiPolygon(ps) => ps.iter().flat_map(|p| p.outer.0.iter().copied()).collect(),
    }
}

/// Aire d'un anneau (lacet de Gauss), en valeur absolue.
fn ring_area_abs(pts: &[(f32, f32)]) -> f32 {
    let mut s = 0.0;
    for i in 0..pts.len().saturating_sub(1) {
        s += pts[i].0 * pts[i + 1].1 - pts[i + 1].0 * pts[i].1;
    }
    (s / 2.0).abs()
}

fn aabb_of(pts: &[(f32, f32)]) -> Option<(f32, f32, f32, f32)> {
    let mut it = pts.iter();
    let (x0, y0) = *it.next()?;
    let (mut x_min, mut y_min, mut x_max, mut y_max) = (x0, y0, x0, y0);
    for (x, y) in it {
        x_min = x_min.min(*x);
        y_min = y_min.min(*y);
        x_max = x_max.max(*x);
        y_max = y_max.max(*y);
    }
    Some((x_min, y_min, x_max, y_max))
}

/// AABB d'une pièce POSÉE : rotation autour de l'origine puis translation,
/// dans la convention de `ExtTransformation` (rotation en degrés).
fn placed_aabb(pts: &[(f32, f32)], t: &ExtTransformation) -> Option<(f32, f32, f32, f32)> {
    let th = t.rotation.to_radians();
    let (c, sn) = (th.cos(), th.sin());
    let (tx, ty) = t.translation;
    let moved: Vec<(f32, f32)> = pts
        .iter()
        .map(|(x, y)| (tx + x * c - y * sn, ty + x * sn + y * c))
        .collect();
    aabb_of(&moved)
}

/// Miroir EXTERNE de `sa::layout_remnant` : plus grande bande (ou L) libre
/// autour de l'AABB des pièces, en fraction de l'aire de la tôle. Le coût du
/// recuit se calcule sur les formes INTERNES (gonflées de
/// `min_item_separation`, simplifiées) ; après finition les poses viennent
/// de l'export, il faut la même règle sur les formes d'origine.
pub fn ext_layout_remnant(bin: &ExtBin, layout: &ExtLayout, item_pts: &[Vec<(f32, f32)>]) -> f64 {
    let Some((bx0, by0, bx1, by1)) = shape_aabb(&bin.base.shape) else {
        return 0.0;
    };
    let (w, h) = ((bx1 - bx0) as f64, (by1 - by0) as f64);
    if w <= 0.0 || h <= 0.0 {
        return 0.0;
    }
    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for pi in &layout.placed_items {
        let Some(pts) = item_pts.get(pi.item_id as usize) else {
            continue;
        };
        let Some((x0, y0, x1, y1)) = placed_aabb(pts, &pi.transformation) else {
            continue;
        };
        min_x = min_x.min(x0 - bx0);
        min_y = min_y.min(y0 - by0);
        max_x = max_x.max(x1 - bx0);
        max_y = max_y.max(y1 - by0);
    }
    if !min_x.is_finite() {
        return 1.0; // tôle vide : entièrement réutilisable
    }
    let (min_x, min_y) = (min_x as f64, min_y as f64);
    let (max_x, max_y) = (max_x as f64, max_y as f64);

    let right = (w - max_x) * h;
    let top = w * (h - max_y);
    let left = min_x * h;
    let bottom = w * min_y;
    let l_right_top = (w - max_x) * h + max_x * (h - max_y);
    let l_top_right = w * (h - max_y) + (w - max_x) * max_y;
    let l_left_bottom = min_x * h + (w - min_x) * min_y;
    let l_bottom_left = w * min_y + min_x * (h - min_y);

    let best = right
        .max(top)
        .max(left)
        .max(bottom)
        .max(l_right_top)
        .max(l_top_right)
        .max(l_left_bottom)
        .max(l_bottom_left);
    (best / (w * h)).clamp(0.0, 1.0)
}

fn shape_aabb(shape: &ExtShape) -> Option<(f32, f32, f32, f32)> {
    aabb_of(&shape_points(shape))
}

/// Frame live de la finition : MÊME schéma que `layout_event`, lue dans les
/// layouts EXTERNES du run fini (pièges 14g / 46 — la convention externe est
/// déjà celle de l'export, il n'y a pas de `int_to_ext` à composer ici).
fn ext_layout_event(run: &BpRun, started: &Instant) -> String {
    let mut items = String::new();
    items.push('[');
    let mut first = true;
    for (bin, layout) in run.solution.layouts.iter().enumerate() {
        for pi in &layout.placed_items {
            if !first {
                items.push(',');
            }
            first = false;
            items.push_str(&format!(
                "[{},{},{:.2},{:.3},{:.3}]",
                pi.item_id,
                bin,
                pi.transformation.rotation,
                pi.transformation.translation.0,
                pi.transformation.translation.1
            ));
        }
    }
    items.push(']');
    format!(
        "{{\"type\":\"layout\",\"worker\":0,\"stage\":\"bpp-finish\",\"feasible\":{},\"bins\":{},\"bin_cost\":{},\"unplaced\":{},\"remnant\":{:.4},\"elapsed_ms\":{},\"items\":{},\"bias\":\"{}\"}}",
        run.cost.unplaced == 0,
        run.solution.layouts.len(),
        run.cost.bin_cost,
        run.cost.unplaced,
        run.cost.remnant,
        started.elapsed().as_millis(),
        items,
        run.bias.as_str()
    )
}

/// Refait la tôle la MOINS remplie d'un run BPP comme le ferait un job
/// mono-tôle SPP des mêmes pièces avec la même direction, et remplace ses
/// poses si le résultat tient dans la tôle. Renvoie la trace (`finish`) à
/// exporter, ou `None` quand la finition ne s'applique pas.
///
/// Ne touche ni l'affectation des pièces aux tôles, ni les autres layouts,
/// ni le schéma d'export (champs additifs seulement).
/// Applique la finition aux runs qui seront EXPORTÉS — le champion de
/// chaque classe active, même règle que `merge_bp_runs`. UN SEUL
/// emplacement, partagé par le solve natif et par la fusion du pool
/// navigateur (`merge::merge_alternatives_json`) : sans cela les huit walks
/// du pool finissaient chacun leur tôle alors que la fusion n'en garde
/// qu'une par classe (+33 s mesurés au harnais, §8.2).
///
/// Un run qui porte déjà `finish` n'est PAS refini (champ additif : sa
/// présence signe une finition faite par le walk).
pub fn finish_exported_runs(
    ext_instance: &ExtBPInstance,
    instance: &BPInstance,
    exported: &mut [BpRun],
    biases: &[DirBias],
    config: &EngineConfig,
    started: &Instant,
    sink: &EventSink,
) {
    if !config.finish_enabled() {
        return;
    }
    let feasible_exists = exported.iter().any(|r| r.cost.unplaced == 0);
    let mut to_finish = vec![false; exported.len()];
    for b in biases.iter() {
        let champ = exported
            .iter()
            .enumerate()
            .filter(|(_, r)| {
                r.bias == *b
                    && r.finish.is_none()
                    && (!feasible_exists || r.cost.unplaced == 0)
            })
            .min_by(|(_, a), (_, c)| {
                a.cost.cmp_key().cmp(&c.cost.cmp_key()).then(a.seed.cmp(&c.seed))
            })
            .map(|(i, _)| i);
        if let Some(i) = champ {
            to_finish[i] = true;
        }
    }
    if !to_finish.iter().any(|b| *b) {
        return;
    }
    // EN PARALLÈLE, comme les walks : le calcul ne dépend que du run et de
    // sa seed, le résultat est donc indépendant de l'ordre d'exécution (le
    // verrou de déterminisme L2 le vérifie).
    let plans = map_workers(exported.len(), |i| {
        if to_finish[i] {
            plan_finish(ext_instance, instance, &exported[i], config)
        } else {
            None
        }
    });
    for (run, plan) in exported.iter_mut().zip(plans.into_iter()) {
        if plan.is_some() {
            run.finish = apply_finish(ext_instance, run, plan, config, started, sink);
        }
    }
}

/// Ce qu'une finition a calculé, sans rien avoir muté : calculable en
/// parallèle (elle ne dépend que du run et de sa seed).
pub struct FinishPlan {
    idx: usize,
    /// Poses SPP re-mappées, ou `None` quand la finition renonce.
    placed: Option<Vec<ExtPlacedItem>>,
    before: Extent,
    after: Extent,
    elapsed_ms: u64,
    reason: &'static str,
    phases: serde_json::Value,
}

/// Compatibilité tests : plan + application en un appel.
pub fn finish_partial_sheet(
    ext_instance: &ExtBPInstance,
    instance: &BPInstance,
    run: &mut BpRun,
    config: &EngineConfig,
    started: &Instant,
    sink: &EventSink,
) -> Option<serde_json::Value> {
    let plan = plan_finish(ext_instance, instance, run, config);
    apply_finish(ext_instance, run, plan, config, started, sink)
}

/// Applique un plan : remplace les poses, recalcule le remnant, émet la
/// frame live, et rend la trace `finish`.
fn apply_finish(
    ext_instance: &ExtBPInstance,
    run: &mut BpRun,
    plan: Option<FinishPlan>,
    config: &EngineConfig,
    started: &Instant,
    sink: &EventSink,
) -> Option<serde_json::Value> {
    let plan = plan?;
    let kept = if plan.placed.is_some() { "spp" } else { "bpp" };
    if let Some(placed) = plan.placed {
        run.solution.layouts[plan.idx].placed_items = placed;
        let item_pts: Vec<Vec<(f32, f32)>> = ext_instance
            .items
            .iter()
            .map(|it| shape_points(&it.base.shape))
            .collect();
        run.cost.remnant = run
            .solution
            .layouts
            .iter()
            .filter_map(|l| {
                ext_instance
                    .bins
                    .iter()
                    .find(|b| b.base.id == l.container_id)
                    .map(|b| ext_layout_remnant(b, l, &item_pts))
            })
            .fold(0.0_f64, f64::max);
        // Frame live finale (V14) : même schéma que `layout_event`.
        if config.live_events() {
            sink(&ext_layout_event(run, started));
        }
    }
    Some(finish_report(
        plan.idx,
        run.bias.as_str(),
        &plan.before,
        &plan.after,
        plan.elapsed_ms,
        kept,
        plan.reason,
        plan.phases,
    ))
}

fn plan_finish(
    ext_instance: &ExtBPInstance,
    instance: &BPInstance,
    run: &BpRun,
    config: &EngineConfig,
) -> Option<FinishPlan> {
    // 1. Tôle partielle : taux de remplissage minimal, ex æquo → index le
    //    plus haut. Rien à finir si le run laisse des pièces non placées.
    if run.cost.unplaced > 0 {
        return None;
    }
    let (idx, fill) = run
        .solution
        .layouts
        .iter()
        .enumerate()
        .filter(|(_, l)| l.placed_items.len() >= 2)
        .map(|(i, l)| (i, l.density))
        .min_by(|(ia, a), (ib, b)| a.total_cmp(b).then(ib.cmp(ia)))?;
    if fill > FINISH_MAX_FILL {
        return None;
    }

    let t_start = Instant::now();
    let layout = &run.solution.layouts[idx];
    let bin = ext_instance
        .bins
        .iter()
        .find(|b| b.base.id == layout.container_id)?;
    let (bx0, by0, bx1, by1) = shape_aabb(&bin.base.shape)?;
    let (bw, bh) = (bx1 - bx0, by1 - by0);
    if bw <= 0.0 || bh <= 0.0 {
        return None;
    }

    // Sommets des anneaux externes, indexés par id d'item BPP (les ids sont
    // consécutifs 0..n-1 à l'import jagua, piège #3b).
    let item_pts: Vec<Vec<(f32, f32)>> = ext_instance
        .items
        .iter()
        .map(|it| shape_points(&it.base.shape))
        .collect();

    let before = layout_extent(layout, &item_pts, bx0, by0)?;

    // Aire de matière et plus grande dimension de pièce de CETTE tôle —
    // servent à dimensionner le corridor « balanced » (coin) plus bas.
    let mut parts_area = 0.0_f32;
    let mut max_item_span = 0.0_f32;
    for pi in &layout.placed_items {
        if let Some(pts) = item_pts.get(pi.item_id as usize) {
            parts_area += ring_area_abs(pts);
            if let Some((x0, y0, x1, y1)) = aabb_of(pts) {
                max_item_span = max_item_span.max((x1 - x0).max(y1 - y0));
            }
        }
    }

    // 2. Instance SPP : ids réindexés 0..k-1 (piège #3b : l'importeur exige
    //    des ids consécutifs), table de retour vers les ids BPP.
    let mut ids: Vec<u64> = layout.placed_items.iter().map(|pi| pi.item_id).collect();
    ids.sort_unstable();
    ids.dedup();
    let mut sp_items = Vec::with_capacity(ids.len());
    for (new_id, old_id) in ids.iter().enumerate() {
        let src = ext_instance.items.get(*old_id as usize)?;
        let demand = layout
            .placed_items
            .iter()
            .filter(|pi| pi.item_id == *old_id)
            .count() as u64;
        sp_items.push(SpExtItem {
            base: jagua_rs::io::ext_repr::ExtItem {
                id: new_id as u64,
                allowed_orientations: src.base.allowed_orientations.clone(),
                shape: src.base.shape.clone(),
                min_quality: src.base.min_quality,
            },
            demand,
        });
    }
    let n_placed = layout.placed_items.len();
    // « balanced » = pièces COLLÉES AU COIN. Le mode directions de sparrow
    // équilibre les BRAS DE CHUTE sur toute la tôle (`balanced_width`,
    // J-088) : sur une tôle quasi vide cette égalité impose une région large
    // et plate (mesuré sur b_demo : x_max 1755 sur 3000, le PIRE des trois
    // au critère du plan). Et un solveur SPP minimise toujours la largeur —
    // on ne peut pas lui DEMANDER un bloc large.
    // On obtient le bloc de coin en contraignant l'AUTRE axe : bande de
    // hauteur cible `ty` telle que x/W = y/H pour l'aire réellement occupée,
    // puis minimisation de la largeur dedans (le flux « left », qui converge).
    let sep = config.min_item_separation.unwrap_or(0.0).max(0.0);
    let (strip_h, finish_bias) = if run.bias == DirBias::Balanced {
        let used = (before.x_max * before.y_max).max(parts_area * 1.15);
        let ty = (used * bh / bw)
            .sqrt()
            .max(max_item_span + 2.0 * sep)
            .min(bh);
        (ty, "left")
    } else {
        (bh, run.bias.as_str())
    };
    let sp_instance = ExtSPInstance {
        name: format!("{}-finish{}", ext_instance.name, idx),
        items: sp_items,
        strip_height: strip_h,
    };

    // 3. Config de finition : mono-walk, direction du run, borne = largeur
    //    de la tôle, budget borné, aucun événement.
    let mut cfg = config.clone();
    cfg.biases = Some(vec![finish_bias.to_owned()]);
    cfg.n_workers = Some(1);
    cfg.separator_workers = Some(1);
    cfg.max_strip_width = Some(bw);
    cfg.two_phase = Some(true);
    cfg.live_events = Some(false);
    cfg.initial_sequence = None;
    cfg.n_alternatives = 1;
    cfg.prng_seed = run.seed ^ FINISH_SEED_XOR;
    cfg.time_budget_sec = (((config.time_budget_sec as f64) * 0.25).round() as u64).clamp(3, 15);
    cfg.plateau_patience_sec = Some(match config.plateau_patience_sec {
        Some(p) if p > 0.0 => p.min(3.0),
        _ => 3.0,
    });
    // Mode déterministe : la finition doit être bornée en TRAVAIL, pas en
    // temps, sinon le verrou natif ≡ wasm tombe (une machine plus lente
    // couperait la trajectoire ailleurs).
    if cfg.sa_max_iterations.is_some() {
        if cfg.explore_max_conseq_failed_attempts.is_none() {
            cfg.explore_max_conseq_failed_attempts = Some(30);
        }
        if cfg.compress_failure_decay.is_none() {
            cfg.compress_failure_decay = Some(0.7);
        }
    }

    // 4. Résolution — sink MUET : aucun événement SPP ne doit sortir d'un job
    //    BPP (le worker Python et engine.worker.js lisent le flux).
    // §8.3.5 : le sink muet devient un COLLECTEUR — les marqueurs de phase
    // et les événements de progression de la finition ne sortent pas du job
    // BPP (le worker Python et engine.worker.js lisent le flux), mais ils
    // servent à ventiler p1 / p2 dans la trace.
    let collected: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let sink_store = collected.clone();
    let silent: EventSink = Arc::new(move |line: &str| {
        if let Ok(mut v) = sink_store.lock() {
            v.push(line.to_owned());
        }
    });
    let budget_ms = cfg.time_budget_sec * 1000;
    let phases_of = |events: &Arc<Mutex<Vec<String>>>, total_ms: u64| -> serde_json::Value {
        let lines = events.lock().map(|v| v.clone()).unwrap_or_default();
        phases_from(&lines, total_ms, budget_ms)
    };
    let keep = |reason: &'static str| -> Option<FinishPlan> {
        let ms = t_start.elapsed().as_millis() as u64;
        Some(FinishPlan {
            idx,
            placed: None,
            before,
            after: before,
            elapsed_ms: ms,
            reason,
            phases: phases_of(&collected, ms),
        })
    };
    let Ok(out) = crate::spp::run_spp_mem(sp_instance, &cfg, &silent) else {
        return keep("spp run failed");
    };
    let Some(alt) = out.alternatives.first() else {
        return keep("no spp alternative");
    };
    let Ok(sp_sol) = serde_json::from_value::<ExtSPSolution>(
        alt.get("solution").cloned().unwrap_or(serde_json::Value::Null),
    ) else {
        return keep("unreadable spp solution");
    };

    // 5. Faisabilité (piège #6 : pas de borne dure en SPP) + complétude.
    if sp_sol.layout.placed_items.len() != n_placed {
        return keep("spp placed a different number of items");
    }
    let mut placed = Vec::with_capacity(n_placed);
    let (mut x_min, mut y_min) = (f32::INFINITY, f32::INFINITY);
    let (mut x_max, mut y_max) = (f32::NEG_INFINITY, f32::NEG_INFINITY);
    for pi in &sp_sol.layout.placed_items {
        let old_id = *ids.get(pi.item_id as usize)?;
        let pts = item_pts.get(old_id as usize)?;
        let (a0, b0, a1, b1) = placed_aabb(pts, &pi.transformation)?;
        x_min = x_min.min(a0);
        y_min = y_min.min(b0);
        x_max = x_max.max(a1);
        y_max = y_max.max(b1);
        placed.push(ExtPlacedItem {
            item_id: old_id,
            transformation: ExtTransformation {
                rotation: pi.transformation.rotation,
                // Repère de la tôle : le bin n'est pas forcément ancré en
                // (0,0), le strip SPP l'est toujours.
                translation: (
                    pi.transformation.translation.0 + bx0,
                    pi.transformation.translation.1 + by0,
                ),
            },
        });
    }
    if x_min < -FINISH_EPS || y_min < -FINISH_EPS || x_max > bw + FINISH_EPS || y_max > bh + FINISH_EPS
    {
        return keep("spp layout exceeds the sheet");
    }

    // §8.3.4 — GARDE DE FAISABILITÉ. Le contrôle de bornes ci-dessus ne voit
    // que la tôle : il a laissé passer, à budget réduit, une tôle mesurée à
    // 1,849 mm d'espacement pour 2,0 promis (§8.2.3). On REJOUE les poses
    // dans un layout jagua du bin : les collisions y sont mesurées sur les
    // formes GONFLÉES de `min_item_separation`, donc un gap sous
    // l'espacement EST une collision. Échec → le layout BPP est conservé.
    // Seul le rejet « pair » compte. Un rejet « sheet » est un FAUX POSITIF
    // mesuré : sur `b_demo` la classe `left` sort à 336,7 mm de front avec
    // une pièce au CONTACT du contour — la carte de collision déflate le
    // conteneur de space/2 (piège #49) et la phase 2 transposée rend des
    // coordonnées à ~1e-4 du bord, ce qui suffit à faire contact. Le
    // containment réel est déjà contrôlé plus haut sur les anneaux BRUTS
    // (±1e-3 de la tôle), et `insideSheet` le remesure en aval. On note le
    // contact dans la trace, on ne jette pas une finition correcte pour ça.
    let mut sheet_contact = false;
    match infeasibility_of(instance, layout.container_id, &placed, bx0, by0) {
        None => {}
        Some("sheet") => sheet_contact = true,
        Some(_) => return keep("infeasible: pair"),
    }

    // 6. Le plan : poses re-mappées, à appliquer par `apply_finish`.
    let ms = t_start.elapsed().as_millis() as u64;
    Some(FinishPlan {
        idx,
        placed: Some(placed),
        before,
        after: Extent {
            x_min: x_min.max(0.0),
            y_min: y_min.max(0.0),
            x_max,
            y_max,
        },
        elapsed_ms: ms,
        reason: if sheet_contact { "sheet-contact" } else { "" },
        phases: phases_of(&collected, ms),
    })
}

/// §8.3.4 — REJOUE des poses externes dans un layout jagua du bin et rend
/// leur faisabilité. Les collisions y sont mesurées sur les formes GONFLÉES
/// de `min_item_separation` : un écart sous l'espacement promis EST une
/// collision, ce que le simple contrôle de bornes ne voyait pas (une tôle à
/// 1,849 mm pour 2,0 promis est passée, §8.2.3).
///
/// `bx0`/`by0` = origine de l'AABB du bin (les poses SPP sont ancrées en 0).
pub fn poses_are_feasible(
    instance: &BPInstance,
    container_id: u64,
    placed: &[ExtPlacedItem],
    bx0: f32,
    by0: f32,
) -> bool {
    infeasibility_of(instance, container_id, placed, bx0, by0).is_none()
}

/// Comme [`poses_are_feasible`], mais dit CE QUI cloche : `"sheet"` (une
/// pièce seule collisionne déjà le contour de la tôle) ou `"pair"` (deux
/// pièces sont plus proches que l'espacement promis). La distinction n'est
/// pas cosmétique : un rejet « sheet » signalerait une garde trop stricte
/// (le contour est déflaté de space/2 à l'import, piège #49), un rejet
/// « pair » est le défaut que la garde existe pour attraper.
pub fn infeasibility_of(
    instance: &BPInstance,
    container_id: u64,
    placed: &[ExtPlacedItem],
    bx0: f32,
    by0: f32,
) -> Option<&'static str> {
    let bin = instance.bins().find(|b| b.id == container_id as usize)?;
    let to_int = |pi: &ExtPlacedItem| {
        let item = instance.item(pi.item_id as usize);
        let ext_dt = DTransformation::new(
            pi.transformation.rotation.to_radians(),
            (
                pi.transformation.translation.0 - bx0,
                pi.transformation.translation.1 - by0,
            ),
        );
        (item, ext_to_int_transformation(&ext_dt, &item.shape_orig.pre_transform))
    };
    let mut probe = Layout::new(bin.container.clone());
    for pi in placed {
        let (item, d_transf) = to_int(pi);
        probe.place_item(item, d_transf);
    }
    if probe.is_feasible() {
        return None;
    }
    // Une pièce SEULE dans la tôle qui collisionne déjà : c'est le contour.
    for pi in placed {
        let (item, d_transf) = to_int(pi);
        let mut solo = Layout::new(bin.container.clone());
        solo.place_item(item, d_transf);
        if !solo.is_feasible() {
            return Some("sheet");
        }
    }
    Some("pair")
}

/// Ventilation des phases de la finition, lue dans les événements collectés
/// (§8.3.5) : le marqueur `phase` sépare la minimisation de largeur (p1) de
/// la compaction transposée (p2) ; une « amélioration » est un événement de
/// progression dont la largeur de bande descend strictement.
fn phases_from(events: &[String], total_ms: u64, budget_ms: u64) -> serde_json::Value {
    let mut p2_start: Option<u64> = None;
    let (mut p1_impr, mut p2_impr) = (0u32, 0u32);
    let mut best: Option<f64> = None;
    for line in events {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        match v.get("type").and_then(serde_json::Value::as_str) {
            Some("phase") => {
                if v.get("n").and_then(serde_json::Value::as_u64) == Some(2) {
                    p2_start = v.get("elapsed_ms").and_then(serde_json::Value::as_u64);
                    best = None; // repère transposé : nouvelle échelle
                }
            }
            Some("progress") => {
                if let Some(w) = v.get("strip_width").and_then(serde_json::Value::as_f64) {
                    let improved = best.map(|b| w < b - 1e-6).unwrap_or(true);
                    if improved {
                        best = Some(w);
                        if p2_start.is_some() {
                            p2_impr += 1;
                        } else {
                            p1_impr += 1;
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let p1_ms = p2_start.unwrap_or(total_ms).min(total_ms);
    serde_json::json!({
        "p1Ms": p1_ms,
        "p2Ms": total_ms.saturating_sub(p1_ms),
        "p1Improvements": p1_impr,
        "p2Improvements": p2_impr,
        // « budget » = la finition a consommé son plafond ; « plateau » =
        // elle s'est arrêtée avant (patience ou convergence).
        "stop": if budget_ms > 0 && total_ms + 1000 >= budget_ms { "budget" } else { "plateau" },
    })
}

#[derive(Clone, Copy)]
struct Extent {
    x_min: f32,
    y_min: f32,
    x_max: f32,
    y_max: f32,
}

fn layout_extent(
    layout: &ExtLayout,
    item_pts: &[Vec<(f32, f32)>],
    bx0: f32,
    by0: f32,
) -> Option<Extent> {
    let (mut x_min, mut y_min) = (f32::INFINITY, f32::INFINITY);
    let (mut x_max, mut y_max) = (f32::NEG_INFINITY, f32::NEG_INFINITY);
    for pi in &layout.placed_items {
        let pts = item_pts.get(pi.item_id as usize)?;
        let (a0, b0, a1, b1) = placed_aabb(pts, &pi.transformation)?;
        x_min = x_min.min(a0 - bx0);
        y_min = y_min.min(b0 - by0);
        x_max = x_max.max(a1 - bx0);
        y_max = y_max.max(b1 - by0);
    }
    x_min.is_finite().then_some(Extent {
        x_min,
        y_min,
        x_max,
        y_max,
    })
}

fn finish_report(
    sheet: usize,
    bias: &str,
    before: &Extent,
    after: &Extent,
    elapsed_ms: u64,
    kept: &str,
    reason: &str,
    phases: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "sheet": sheet,
        "bias": bias,
        "before": {
            "xMin": before.x_min, "yMin": before.y_min,
            "xMax": before.x_max, "yMax": before.y_max,
        },
        "after": {
            "xMin": after.x_min, "yMin": after.y_min,
            "xMax": after.x_max, "yMax": after.y_max,
        },
        "elapsedMs": elapsed_ms,
        "kept": kept,
        "reason": reason,
        "phases": phases,
    })
}


#[cfg(test)]
mod finish_tests {
    //! Verrous de la finition de la tôle partielle (plan
    //! docs/PLAN-DERNIERE-TOLE-2026-09-09.md §4, L6).
    //!
    //! Les trois premiers appellent `finish_partial_sheet` DIRECTEMENT sur un
    //! run construit à la main : la tôle partielle y est volontairement
    //! étalée en diagonale, ce que la sortie d'un vrai recuit ne garantit
    //! pas — un test qui dépend de ce que produit le recuit ne mesure rien.

    use super::*;
    use jagua_rs::io::ext_repr::{ExtSPolygon, ExtShape};
    use jagua_rs::probs::bpp::io::ext_repr::{ExtBin, ExtItem as BpExtItem};

    const SIDE: f32 = 40.0;
    const SHEET: f32 = 200.0;

    fn square_instance(demand: u64) -> ExtBPInstance {
        ExtBPInstance {
            name: "finish-lock".to_owned(),
            items: vec![BpExtItem {
                base: jagua_rs::io::ext_repr::ExtItem {
                    id: 0,
                    allowed_orientations: Some(vec![0.0, 90.0, 180.0, 270.0]),
                    shape: ExtShape::SimplePolygon(ExtSPolygon(vec![
                        (0.0, 0.0),
                        (SIDE, 0.0),
                        (SIDE, SIDE),
                        (0.0, SIDE),
                        (0.0, 0.0),
                    ])),
                    min_quality: None,
                },
                demand,
            }],
            bins: vec![ExtBin {
                base: jagua_rs::io::ext_repr::ExtContainer {
                    id: 0,
                    shape: ExtShape::SimplePolygon(ExtSPolygon(vec![
                        (0.0, 0.0),
                        (SHEET, 0.0),
                        (SHEET, SHEET),
                        (0.0, SHEET),
                        (0.0, 0.0),
                    ])),
                    zones: vec![],
                },
                cost: 1,
                stock: 2,
            }],
        }
    }

    /// Tôle partielle ÉTALÉE : quatre carrés sur la diagonale, étendue
    /// ≈ 160 mm sur les deux axes dans une tôle de 200.
    fn spread_layout() -> ExtLayout {
        let placed = (0..4)
            .map(|k| ExtPlacedItem {
                item_id: 0,
                transformation: ExtTransformation {
                    rotation: 0.0,
                    translation: (k as f32 * 40.0, k as f32 * 40.0),
                },
            })
            .collect::<Vec<_>>();
        ExtLayout {
            container_id: 0,
            placed_items: placed,
            density: 4.0 * SIDE * SIDE / (SHEET * SHEET), // 0,16
        }
    }

    fn run_with(layout: ExtLayout, bias: DirBias) -> BpRun {
        BpRun {
            seed: 7,
            bias,
            cost: sa::Cost {
                unplaced: 0,
                bin_cost: 1,
                remnant: 0.0,
                falkenauer: 0.0,
            },
            iterations: 0,
            solution: ExtBPSolution {
                cost: 1,
                layouts: vec![layout],
                density: 0.16,
                run_time_sec: 0,
            },
        finish: None,
        }
    }

    fn finish_cfg() -> EngineConfig {
        serde_json::from_value(serde_json::json!({
            "time_budget_sec": 12,
            "prng_seed": 1234,
            "poly_simpl_tolerance": null,
        }))
        .unwrap()
    }

    fn silent() -> EventSink {
        Arc::new(|_: &str| {})
    }

    /// Instance jagua de la fixture — la garde de faisabilité (§8.3.4) en a
    /// besoin pour rejouer les poses dans un layout du bin.
    fn imported(ext: &ExtBPInstance, cfg: &EngineConfig) -> BPInstance {
        let sc = cfg.sparrow_config();
        let importer = jagua_rs::io::import::Importer::new(
            sc.cde_config,
            sc.poly_simpl_tolerance,
            sc.min_item_separation,
            sc.narrow_concavity_cutoff_ratio,
        );
        jagua_rs::probs::bpp::io::import_instance(&importer, ext).expect("instance importable")
    }

    #[test]
    fn finish_left_reduces_x_max() {
        let inst = square_instance(4);
        let mut run = run_with(spread_layout(), DirBias::LeftFirst);
        let started = Instant::now();
        let instance = imported(&inst, &finish_cfg());
        let rep = finish_partial_sheet(&inst, &instance, &mut run, &finish_cfg(), &started, &silent())
            .expect("la finition doit s'appliquer (une tôle, 4 pièces, 16 % de remplissage)");
        assert_eq!(rep["kept"], "spp", "finition rejetée : {rep}");
        let before = rep["before"]["xMax"].as_f64().unwrap();
        let after = rep["after"]["xMax"].as_f64().unwrap();
        assert!(
            after < before - 1.0,
            "left : xMax {after} pas réduit depuis {before}"
        );
        // Une bande −X : au plus deux colonnes de 40 mm.
        assert!(after <= 2.0 * SIDE as f64 + 1.0, "left : xMax {after} n'est pas une bande");
        assert_eq!(run.solution.layouts[0].placed_items.len(), 4, "pièces perdues");
    }

    #[test]
    fn finish_bottom_reduces_y_max() {
        let inst = square_instance(4);
        let mut run = run_with(spread_layout(), DirBias::BottomFirst);
        let started = Instant::now();
        let instance = imported(&inst, &finish_cfg());
        let rep = finish_partial_sheet(&inst, &instance, &mut run, &finish_cfg(), &started, &silent())
            .expect("la finition doit s'appliquer");
        assert_eq!(rep["kept"], "spp", "finition rejetée : {rep}");
        let before = rep["before"]["yMax"].as_f64().unwrap();
        let after = rep["after"]["yMax"].as_f64().unwrap();
        assert!(
            after < before - 1.0,
            "bottom : yMax {after} pas réduit depuis {before}"
        );
        assert!(after <= 2.0 * SIDE as f64 + 1.0, "bottom : yMax {after} n'est pas une bande");
        assert_eq!(run.solution.layouts[0].placed_items.len(), 4, "pièces perdues");
    }

    /// Piège #6 : sparrow n'a pas de borne dure. Deux pièces qui ne peuvent
    /// pas tenir côte à côte dans la tôle donnent une bande plus large que la
    /// tôle — le layout BPP doit être CONSERVÉ, pas remplacé par du hors-tôle.
    #[test]
    fn finish_keeps_bpp_when_strip_exceeds_sheet() {
        let big = 190.0_f32;
        let inst = ExtBPInstance {
            name: "finish-overflow".to_owned(),
            items: vec![BpExtItem {
                base: jagua_rs::io::ext_repr::ExtItem {
                    id: 0,
                    allowed_orientations: Some(vec![0.0]),
                    shape: ExtShape::SimplePolygon(ExtSPolygon(vec![
                        (0.0, 0.0),
                        (big, 0.0),
                        (big, big),
                        (0.0, big),
                        (0.0, 0.0),
                    ])),
                    min_quality: None,
                },
                demand: 2,
            }],
            bins: vec![ExtBin {
                base: jagua_rs::io::ext_repr::ExtContainer {
                    id: 0,
                    shape: ExtShape::SimplePolygon(ExtSPolygon(vec![
                        (0.0, 0.0),
                        (SHEET, 0.0),
                        (SHEET, SHEET),
                        (0.0, SHEET),
                        (0.0, 0.0),
                    ])),
                    zones: vec![],
                },
                cost: 1,
                stock: 2,
            }],
        };
        let layout = ExtLayout {
            container_id: 0,
            placed_items: vec![
                ExtPlacedItem {
                    item_id: 0,
                    transformation: ExtTransformation { rotation: 0.0, translation: (0.0, 0.0) },
                },
                ExtPlacedItem {
                    item_id: 0,
                    transformation: ExtTransformation { rotation: 0.0, translation: (5.0, 5.0) },
                },
            ],
            density: 0.2,
        };
        let before_poses: Vec<(f32, f32)> = layout
            .placed_items
            .iter()
            .map(|p| p.transformation.translation)
            .collect();
        let mut run = run_with(layout, DirBias::LeftFirst);
        let started = Instant::now();
        let instance = imported(&inst, &finish_cfg());
        let rep = finish_partial_sheet(&inst, &instance, &mut run, &finish_cfg(), &started, &silent())
            .expect("la finition doit rendre une trace même quand elle renonce");
        assert_eq!(rep["kept"], "bpp", "hors tôle accepté : {rep}");
        assert!(
            !rep["reason"].as_str().unwrap_or("").is_empty(),
            "une renonciation doit dire pourquoi : {rep}"
        );
        let after_poses: Vec<(f32, f32)> = run.solution.layouts[0]
            .placed_items
            .iter()
            .map(|p| p.transformation.translation)
            .collect();
        assert_eq!(before_poses, after_poses, "le layout BPP a été modifié malgré le refus");
    }


    /// §8.3.4 : deux carrés à 1,8 mm l'un de l'autre pour 2,0 promis — la
    /// garde doit les REJETER (le contrôle de bornes, lui, les acceptait :
    /// ils sont dans la tôle). Écart de 0,2 mm, celui du constat 8.2.3.
    #[test]
    fn finish_rejects_infeasible_strip() {
        let inst = square_instance(2);
        let cfg: EngineConfig = serde_json::from_value(serde_json::json!({
            "time_budget_sec": 5,
            "prng_seed": 1,
            "min_item_separation": 2.0,
            "poly_simpl_tolerance": null,
        }))
        .unwrap();
        let instance = imported(&inst, &cfg);
        // Décollées du bord : à l'import jagua DÉFLATE aussi le conteneur de
        // space/2 (piège #49) — une pièce à exactement `space` du bord est
        // au contact, et un contact est une collision. On isole donc la
        // distance ENTRE PIÈCES, à 10 mm des bords.
        let pose = |x: f32| ExtPlacedItem {
            item_id: 0,
            transformation: ExtTransformation { rotation: 0.0, translation: (10.0 + x, 10.0) },
        };
        // Légal : 2,5 mm d'espace pour 2,0 promis. NB : à EXACTEMENT 2,0 les
        // formes gonflées de space/2 se TOUCHENT, et un contact est une
        // collision pour la CDE de jagua (piège #57) — un solveur ne rend
        // donc jamais ce cas comme faisable.
        assert!(
            poses_are_feasible(&instance, 0, &[pose(0.0), pose(SIDE + 2.5)], 0.0, 0.0),
            "2,5 mm d'espacement doit passer"
        );
        // 0,2 mm de trop près : 1,8 mm au lieu de 2,0.
        assert!(
            !poses_are_feasible(&instance, 0, &[pose(0.0), pose(SIDE + 1.8)], 0.0, 0.0),
            "1,8 mm pour 2,0 promis doit être rejeté"
        );
    }

    /// `ext_layout_remnant` (formes d'origine, repère externe) doit rendre la
    /// même valeur que `sa::layout_remnant` (formes internes) — sans
    /// inflation ni simplification, les deux polygones sont le même.
    #[test]
    fn ext_layout_remnant_matches_layout_remnant() {
        // Une seule tôle remplie à 64 % : la finition ne s'applique pas
        // (seuil 0,5), `cost.remnant` reste la valeur INTERNE du recuit.
        let mut instance = square_instance(4);
        instance.bins[0].stock = 1;
        instance.items[0].demand = 16; // 16 x 40² = 25 600 / 40 000 = 64 %
        instance.bins[0].base.shape = ExtShape::SimplePolygon(ExtSPolygon(vec![
            (0.0, 0.0),
            (200.0, 0.0),
            (200.0, 200.0),
            (0.0, 200.0),
            (0.0, 0.0),
        ]));
        let config: EngineConfig = serde_json::from_value(serde_json::json!({
            "time_budget_sec": 2,
            "prng_seed": 5,
            "n_workers": 1,
            "biases": ["left"],
            "poly_simpl_tolerance": null,
        }))
        .unwrap();
        let out = run_bpp_mem(instance.clone(), &config, &silent()).expect("doit résoudre");
        let alt = &out.alternatives[0];
        assert!(
            alt["finish"].is_null(),
            "la finition ne doit PAS s'appliquer à 64 % de remplissage : {}",
            alt["finish"]
        );
        let internal = alt["cost_detail"]["remnant"].as_f64().unwrap();
        let sol: ExtBPSolution = serde_json::from_value(alt["solution"].clone()).unwrap();
        let item_pts: Vec<Vec<(f32, f32)>> = instance
            .items
            .iter()
            .map(|it| shape_points(&it.base.shape))
            .collect();
        let external = sol
            .layouts
            .iter()
            .filter_map(|l| {
                instance
                    .bins
                    .iter()
                    .find(|b| b.base.id == l.container_id)
                    .map(|b| ext_layout_remnant(b, l, &item_pts))
            })
            .fold(0.0_f64, f64::max);
        assert!(
            (internal - external).abs() < 2e-3,
            "remnant interne {internal} vs externe {external}"
        );
    }
}

#[cfg(test)]
mod live_frame_tests {
    //! Verrou (piège 14g/46) : une frame live BPP doit porter la transform
    //! EXTERNE (int_to_ext composé) — pas le `d_transf` interne jagua, qui
    //! ancre les pièces au centroïde et les décale à l'écran. Miroir BPP de
    //! progress.rs::live_frame_matches_final_export_asymmetric.

    use super::*;

    /// Triangle volontairement NON centré : centroïde ≈ (110, 10) — un
    /// `d_transf` nu serait décalé d'autant, l'export composé non.
    fn off_center_bp_instance() -> ExtBPInstance {
        ExtBPInstance {
            name: "bpp-live-lock".to_owned(),
            items: vec![jagua_rs::probs::bpp::io::ext_repr::ExtItem {
                base: jagua_rs::io::ext_repr::ExtItem {
                    id: 0,
                    allowed_orientations: None,
                    shape: jagua_rs::io::ext_repr::ExtShape::SimplePolygon(
                        jagua_rs::io::ext_repr::ExtSPolygon(vec![
                            (100.0, 0.0),
                            (130.0, 0.0),
                            (100.0, 30.0),
                            (100.0, 0.0),
                        ]),
                    ),
                    min_quality: None,
                },
                demand: 3,
            }],
            bins: vec![jagua_rs::probs::bpp::io::ext_repr::ExtBin {
                base: jagua_rs::io::ext_repr::ExtContainer {
                    id: 0,
                    shape: jagua_rs::io::ext_repr::ExtShape::SimplePolygon(
                        jagua_rs::io::ext_repr::ExtSPolygon(vec![
                            (0.0, 0.0),
                            (300.0, 0.0),
                            (300.0, 300.0),
                            (0.0, 300.0),
                            (0.0, 0.0),
                        ]),
                    ),
                    zones: vec![],
                },
                cost: 1,
                stock: 1,
            }],
        }
    }

    /// T1 (plan §2.4) : identité des bins cohérente live ↔ coût ↔ export —
    /// les indexes de tôle dans les frames live sont exactement ceux des
    /// layouts exportés, et `bins` (C12) = NOMBRE de tôles.
    #[test]
    fn bpp_bin_index_stable_live_cost_export() {
        let layouts: std::sync::Arc<std::sync::Mutex<Vec<String>>> = Default::default();
        let sink_capture = layouts.clone();
        let sink: EventSink = std::sync::Arc::new(move |s: &str| {
            if s.contains("\"type\":\"layout\"") {
                sink_capture.lock().unwrap().push(s.to_string());
            }
        });
        let config: EngineConfig = serde_json::from_value(serde_json::json!({
            "time_budget_sec": 1,
            "prng_seed": 42,
            "n_workers": 1,
            "live_events": true,
            "biases": ["left"],
        }))
        .unwrap();

        let out = run_bpp_mem(off_center_bp_instance(), &config, &sink)
            .expect("small instance must solve");

        let guard = layouts.lock().unwrap();
        let last: serde_json::Value =
            serde_json::from_str(guard.last().unwrap()).unwrap();
        let live_bins: std::collections::BTreeSet<u64> = last["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|it| it[1].as_u64().unwrap())
            .collect();
        let live_bins_field = last["bins"].as_u64().unwrap();
        drop(guard);

        let sol = &out.alternatives[0]["solution"];
        let n_exported = sol["layouts"].as_array().unwrap().len() as u64;
        assert_eq!(
            live_bins.len() as u64, n_exported,
            "indexes de tôle live == layouts exportés"
        );
        assert_eq!(
            *live_bins.iter().max().unwrap() + 1,
            n_exported,
            "indexes consécutifs 0..n-1 (identité d'ouverture)"
        );
        assert_eq!(
            live_bins_field, n_exported,
            "C12 : champ bins = NOMBRE de tôles (pas le coût)"
        );
    }

    /// La DERNIÈRE frame layout (incumbent final) doit coïncider avec les
    /// placements exportés de la meilleure alternative — rotation degrés à
    /// 0,01° et translation à 0,001 mm (arrondis d'impression de la frame).
    /// V1 (vérif 2026-09-04) : l'insertion de T1 avait absorbé son #[test]
    /// (attribut dupliqué, fonction morte, « 70 passed » comptait T1 deux
    /// fois).
    #[test]
    fn bpp_live_frame_matches_final_export_off_center() {
        let layouts: std::sync::Arc<std::sync::Mutex<Vec<String>>> = Default::default();
        let sink_capture = layouts.clone();
        let sink: EventSink = std::sync::Arc::new(move |s: &str| {
            if s.contains("\"type\":\"layout\"") {
                sink_capture.lock().unwrap().push(s.to_string());
            }
        });
        let config: EngineConfig = serde_json::from_value(serde_json::json!({
            "time_budget_sec": 1,
            "prng_seed": 42,
            "n_workers": 1,
            "live_events": true,
            "biases": ["left"],
        }))
        .unwrap();

        let out = run_bpp_mem(off_center_bp_instance(), &config, &sink)
            .expect("small instance must solve");

        let guard = layouts.lock().unwrap();
        assert!(!guard.is_empty(), "no layout frame captured (live_events?)");
        let last: serde_json::Value =
            serde_json::from_str(guard.last().unwrap()).unwrap();
        // Plan « derniere tole » §3.1.7 : sur cette instance (une tole, 3
        // pieces, 1,5 % de remplissage) la FINITION s'applique — la derniere
        // frame est la sienne. L'assertion evite que ce verrou devienne
        // vide si la finition cessait de s'appliquer ici.
        assert_eq!(
            last["stage"], "bpp-finish",
            "la finition doit produire la derniere frame live"
        );
        assert_eq!(
            out.alternatives[0]["finish"]["kept"], "spp",
            "finition non appliquee : {}", out.alternatives[0]["finish"]
        );
        let mut frame: Vec<(f32, f32, f32)> = last["items"]
            .as_array()
            .expect("frame items array")
            .iter()
            .map(|it| {
                (
                    it[2].as_f64().unwrap() as f32,
                    it[3].as_f64().unwrap() as f32,
                    it[4].as_f64().unwrap() as f32,
                )
            })
            .collect();
        frame.sort_by(|a, b| a.partial_cmp(b).unwrap());
        drop(guard);

        // Export : la transformation sérialisée porte la rotation en
        // DEGRÉS (le worker Python fait math.radians(...) à la lecture) —
        // pas de conversion ici.
        let sol = &out.alternatives[0]["solution"];
        let mut exported: Vec<(f32, f32, f32)> = sol["layouts"]
            .as_array()
            .expect("export layouts")
            .iter()
            .flat_map(|l| l["placed_items"].as_array().unwrap().iter())
            .map(|pi| {
                let t = &pi["transformation"];
                (
                    t["rotation"].as_f64().unwrap() as f32,
                    t["translation"][0].as_f64().unwrap() as f32,
                    t["translation"][1].as_f64().unwrap() as f32,
                )
            })
            .collect();
        exported.sort_by(|a, b| a.partial_cmp(b).unwrap());

        assert_eq!(frame.len(), exported.len(), "frame vs export item count");
        for (f, e) in frame.iter().zip(exported.iter()) {
            assert!(
                (f.0 - e.0).abs() <= 0.006 && (f.1 - e.1).abs() <= 6e-4 && (f.2 - e.2).abs() <= 6e-4,
                "frame {f:?} != export {e:?} — d_transf nu (repère interne) au lieu de int_to_ext ?"
            );
        }
    }
}
