//! Verrou de la FENÊTRE DE LA BANDE : le conteneur d'une bande ne doit jamais
//! faire paniquer le moteur (`panic = "abort"` : `unreachable` en navigateur,
//! abort natif rc 3221226505 sur le worker serveur).
//!
//! Le conteneur est DÉFLATÉ de `espacement / 2` par côté. Juste au-dessus de
//! l'espacement il reste un rectangle de quelques ulp de large, que
//! `geo_buffer` rend vide ou que `SPolygon::new` refuse (« no pole found »,
//! « Simple polygon must have at least 3 points », « Offset resulted in an
//! empty polygon »). La largeur de cette fenêtre dépend de la hauteur : aucun
//! seuil en mm ne la décrit, seule la construction le dit.
//!
//! Chaque test attrape la panique cellule par cellule pour lister TOUTES les
//! cellules fautives au lieu de s'arrêter à la première.
//!
//! En release (`cargo test --release -p nest-engine`) : en debug,
//! `qt_hazard.rs:111` peut déclencher un `debug_assert` étranger au sujet.

use jagua_rs::io::ext_repr::{ExtItem as ExtBaseItem, ExtSPolygon, ExtShape};
use jagua_rs::io::import::Importer;
use jagua_rs::geometry::shape_modification::{ShapeModifyConfig, take_fallback_items};
use jagua_rs::probs::spp::entities::{SPProblem, Strip};
use jagua_rs::probs::spp::io::ext_repr::{ExtItem as ExtSPItem, ExtSPInstance};
use jagua_rs::probs::spp::io::{StripHeightBelowSeparation, import_instance};
use nest_engine::import_error::locate_failing_item;
use nest_engine::progress::EventSink;
use nest_engine::run_json_with_sink;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Arc, Mutex, MutexGuard};

/// `FALLBACK_ITEMS` est un état de processus : les tests de ce fichier ne
/// tournent pas en même temps, sinon l'un lirait les items de l'autre.
static SERIE: Mutex<()> = Mutex::new(());

fn serie() -> MutexGuard<'static, ()> {
    SERIE.lock().unwrap_or_else(|e| e.into_inner())
}

fn rect_item(id: u64, w: f32, h: f32, x: f32, y: f32, demand: u64) -> ExtSPItem {
    ExtSPItem {
        base: ExtBaseItem {
            id,
            allowed_orientations: Some(vec![0.0]),
            shape: ExtShape::SimplePolygon(ExtSPolygon(vec![
                (x, y),
                (x + w, y),
                (x + w, y + h),
                (x, y + h),
            ])),
            min_quality: None,
        },
        demand,
    }
}

fn importer(separation: Option<f32>) -> Importer {
    Importer::new(
        sparrow::config::DEFAULT_SPARROW_CONFIG.cde_config,
        Some(0.001),
        separation,
        None,
    )
}

/// Issue d'une cellule d'import : largeur rendue, erreur (typée ou non).
#[derive(Debug, Clone, PartialEq)]
enum Issue {
    Largeur(u32),
    HauteurSousEspacement,
    AutreErreur(String),
}

/// Importe puis construit le problème (c'est lui qui bâtit le conteneur). Une
/// panique dans l'un ou l'autre est rendue en `Err`, le test la compte.
fn cell(sep: Option<f32>, h: f32, items: Vec<ExtSPItem>) -> Result<Issue, String> {
    catch_unwind(AssertUnwindSafe(|| {
        let inst = ExtSPInstance { name: "fenetre".into(), items, strip_height: h };
        match import_instance(&importer(sep), &inst) {
            Ok(sp) => {
                let bits = sp.base_strip.width.to_bits();
                let prob = SPProblem::new(sp);
                assert_eq!(prob.strip.width.to_bits(), bits);
                Issue::Largeur(bits)
            }
            Err(e) if e.downcast_ref::<StripHeightBelowSeparation>().is_some() => {
                Issue::HauteurSousEspacement
            }
            Err(e) => Issue::AutreErreur(format!("{e:#}")),
        }
    }))
    .map_err(|p| {
        p.downcast_ref::<String>()
            .cloned()
            .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_else(|| "panique".into())
            .chars()
            .take(90)
            .collect()
    })
}

fn assert_no_panic(what: &str, panics: &[String], n_cells: usize) {
    assert!(
        panics.is_empty(),
        "{what} : {}/{n_cells} cellules paniquent, premières :\n{}",
        panics.len(),
        panics.iter().take(12).cloned().collect::<Vec<_>>().join("\n")
    );
}

const SEPARATIONS: [f32; 5] = [0.1, 1.0, 2.0, 5.0, 10.0];
const HAUTEURS: [f32; 4] = [1000.0, 2000.0, 3000.0, 6000.0];

/// Écarts au-dessus de l'espacement : quelques ulp, puis géométrique jusqu'à
/// 1e-3 mm. La fenêtre mesurée sur le wasm va de 1e-5 (H = 1000) à 1e-4 (H = 6000).
fn ecarts(sep: f32) -> Vec<f32> {
    let ulp = f32::from_bits(sep.to_bits() + 1) - sep;
    let mut out: Vec<f32> = (1..=24).map(|k| k as f32 * ulp).collect();
    let mut d = 1e-6_f32;
    while d <= 1e-3 {
        out.push(d);
        d *= 1.3;
    }
    out
}

/// Une pièce d'aire `H × (sep + ecart)` : c'est la bascule J7-a à l'epsilon près.
#[test]
fn balayage_de_la_largeur_juste_au_dessus_de_l_espacement() {
    let _serie = serie();
    let mut panics = vec![];
    let mut n = 0;
    let mut largeurs_au_dessus = 0;
    for h in HAUTEURS {
        for sep in SEPARATIONS {
            for d in ecarts(sep) {
                let target = sep + d;
                let w = 40.0_f32;
                let piece_h = target * h / w;
                n += 1;
                match cell(Some(sep), h, vec![rect_item(0, w, piece_h, 0.0, 0.0, 1)]) {
                    Ok(Issue::Largeur(bits)) => {
                        if f32::from_bits(bits) > sep {
                            largeurs_au_dessus += 1;
                        }
                    }
                    Ok(other) => panic!("H={h} sep={sep} d={d}: construction attendue, reçu {other:?}"),
                    Err(p) => panics.push(format!("H={h} sep={sep} d={d:e}: {p}")),
                }
            }
        }
    }
    assert_no_panic("largeur au-dessus de l'espacement", &panics, n);
    assert_eq!(largeurs_au_dessus, n, "toute largeur rendue dépasse l'espacement");
}

/// Hauteur juste au-dessus de l'espacement, du minuscule au gros : jamais de
/// panique. La hauteur trop faible se solde par une erreur TYPÉE.
#[test]
fn balayage_de_la_hauteur_juste_au_dessus_de_l_espacement() {
    let _serie = serie();
    let mut panics = vec![];
    let mut n = 0;
    let mut typees = 0;
    for sep in SEPARATIONS {
        for d in ecarts(sep) {
            let h = sep + d;
            for (w, ph, q) in [
                (0.5_f32, 0.5_f32, 1_u64),
                (40.0, 100.0, 1),
                (0.001, 0.001, 1),
                (0.001, 0.001, 1000),
                (1e-3, 400.0, 1),
            ] {
                n += 1;
                match cell(Some(sep), h, vec![rect_item(0, w, ph, 0.0, 0.0, q)]) {
                    Ok(Issue::HauteurSousEspacement) => typees += 1,
                    Ok(Issue::Largeur(_)) => {}
                    Ok(Issue::AutreErreur(e)) => {
                        // Seule une pièce peut échouer autrement, et le moteur la nomme.
                        let item = rect_item(0, w, ph, 0.0, 0.0, q);
                        assert!(
                            locate_failing_item(&importer(Some(sep)), &[&item.base]).is_some(),
                            "sep={sep} H={h} {w}x{ph}×{q}: erreur non typée : {e}"
                        );
                    }
                    Err(p) => panics.push(format!("sep={sep} d={d:e} {w}x{ph}×{q}: {p}")),
                }
            }
        }
    }
    assert_no_panic("hauteur au-dessus de l'espacement", &panics, n);
    assert!(typees > 0, "H = sep + ε doit donner l'erreur typée sur au moins une cellule");
}

/// Sans espacement ou presque : le rectangle n'est pas déflaté, mais une aire
/// minuscule donne une largeur minuscule et la même impossibilité de pôle.
#[test]
fn balayage_sans_espacement_et_espacement_infime() {
    let _serie = serie();
    let mut panics = vec![];
    let mut n = 0;
    for h in HAUTEURS {
        for sep in [None, Some(1e-6_f32), Some(1e-5), Some(1e-4), Some(1e-3), Some(1e-2)] {
            for cote in [1e-5_f32, 1e-4, 1e-3, 1e-2, 0.05, 0.2, 0.5, 1.0] {
                n += 1;
                if let Err(p) = cell(sep, h, vec![rect_item(0, cote, cote, 0.0, 0.0, 2)]) {
                    panics.push(format!("H={h} sep={sep:?} côté={cote:e}: {p}"));
                }
            }
        }
    }
    assert_no_panic("sans espacement", &panics, n);
}

/// Les entrées reproduites par la relecture, au niveau import.
#[test]
fn cas_du_constat_a_l_import() {
    let _serie = serie();
    let mut panics = vec![];
    let cases: Vec<(&str, f32, f32, ExtSPItem)> = vec![
        ("40x100 en (77,77 ; 88,88)", 2000.0, 2.0, rect_item(0, 40.0, 100.0, 77.77, 88.88, 1)),
        ("10x400 en (55,55 ; 66,66)", 2000.0, 2.0, rect_item(0, 10.0, 400.0, 55.55, 66.66, 1)),
        ("1x(50x80,00001)", 2000.0, 2.0, rect_item(0, 50.0, 80.00001, 0.0, 0.0, 1)),
        ("2x(20x100,00001)", 2000.0, 2.0, rect_item(0, 20.0, 100.00001, 0.0, 0.0, 2)),
        ("10x(20,000001)²", 2000.0, 2.0, rect_item(0, 20.000001, 20.000001, 0.0, 0.0, 10)),
        ("40,00001x100", 2000.0, 2.0, rect_item(0, 40.00001, 100.0, 0.0, 0.0, 1)),
        ("2x0,15² H=2000", 2000.0, 2.0, rect_item(0, 0.15, 0.15, 0.0, 0.0, 2)),
        ("2x0,3² H=3000", 3000.0, 2.0, rect_item(0, 0.3, 0.3, 0.0, 0.0, 2)),
        ("2x0,01² H=2000", 2000.0, 2.0, rect_item(0, 0.01, 0.01, 0.0, 0.0, 2)),
        ("0,5² H=2,00001", 2.00001, 2.0, rect_item(0, 0.5, 0.5, 0.0, 0.0, 1)),
    ];
    let n = cases.len();
    for (name, h, sep, item) in cases {
        match cell(Some(sep), h, vec![item]) {
            Ok(Issue::AutreErreur(e)) => panic!("{name}: erreur non typée : {e}"),
            Ok(_) => {}
            Err(p) => panics.push(format!("{name}: {p}")),
        }
    }
    assert_no_panic("constat", &panics, n);
}

/// Le chemin non dégénéré : dès que le conteneur de `total / H` existe et que
/// cette largeur dépasse l'espacement, la largeur rendue est `total / H` au bit
/// près. Le reste de la grille est, lui, passé par l'autre branche.
#[test]
fn la_largeur_reste_total_sur_h_quand_son_conteneur_existe() {
    let _serie = serie();
    let (mut intactes, mut elargies) = (0, 0);
    for h in HAUTEURS {
        for sep in SEPARATIONS {
            let mut largeurs = ecarts(sep).into_iter().map(|d| sep + d).collect::<Vec<_>>();
            largeurs.extend([sep * 1.5, sep * 3.0, sep * 10.0, sep * 100.0]);
            for target in largeurs {
                let inst = ExtSPInstance {
                    name: "bit".into(),
                    items: vec![rect_item(0, (target * h).sqrt(), (target * h).sqrt(), 0.0, 0.0, 1)],
                    strip_height: h,
                };
                let sp = import_instance(&importer(Some(sep)), &inst).expect("import");
                let total: f32 = sp.items.iter().map(|(it, q)| it.area() * *q as f32).sum();
                let brute = total / h;
                let strip = Strip { width: brute, ..sp.base_strip };
                if brute > sep && strip.try_container().is_ok() {
                    assert_eq!(sp.base_strip.width.to_bits(), brute.to_bits(), "H={h} sep={sep} l={target}");
                    intactes += 1;
                } else {
                    assert!(sp.base_strip.width > brute, "H={h} sep={sep} l={target}");
                    elargies += 1;
                }
            }
        }
    }
    assert!(intactes > 0 && elargies > 0, "intactes {intactes}, élargies {elargies}");
}

/// La largeur exacte, ulp par ulp, sans passer par l'aire d'une pièce : le
/// sondage rend un `Result` sur toute la grille, en dessous de l'espacement
/// compris, et ce qu'il accepte se reconstruit par `From<Strip>`.
#[test]
fn le_sondage_ne_panique_jamais_sur_la_grille_exacte() {
    let _serie = serie();
    let mut panics = vec![];
    let (mut construits, mut refuses, mut n) = (0, 0, 0);
    let cfg = |sep: f32| ShapeModifyConfig {
        offset: Some(sep / 2.0),
        simplify_tolerance: None,
        narrow_concavity_cutoff: None,
    };
    let cde = sparrow::config::DEFAULT_SPARROW_CONFIG.cde_config;
    for h in HAUTEURS {
        for sep in SEPARATIONS {
            let mut largeurs = vec![sep, f32::from_bits(sep.to_bits() - 1)];
            largeurs.extend(ecarts(sep).into_iter().map(|d| sep + d));
            for w in largeurs {
                n += 1;
                let strip = Strip::new(h, cde, cfg(sep), w).expect("largeur positive");
                match catch_unwind(AssertUnwindSafe(|| {
                    strip.try_container().map(|_| {
                        let _rebuilt: jagua_rs::entities::Container = strip.into();
                    })
                })) {
                    Ok(Ok(())) => construits += 1,
                    Ok(Err(_)) => refuses += 1,
                    Err(_) => panics.push(format!("H={h} sep={sep} l={w:e}")),
                }
            }
        }
    }
    assert_no_panic("sondage", &panics, n);
    assert!(construits > 0 && refuses > 0, "construits {construits}, refusés {refuses}");
}

/// Un sondage raté ne laisse rien : pas de faux élément dans `thin_items`, qui
/// nomme à l'utilisateur les pièces plus fines que l'espacement.
#[test]
fn un_sondage_rate_ne_laisse_rien_dans_thin_items() {
    let _serie = serie();
    let _ = take_fallback_items();
    // Largeur dans la fenêtre : le sondage de `total / H` échoue.
    let inst = ExtSPInstance {
        name: "trace".into(),
        items: vec![rect_item(0, 40.0, 100.0, 77.77, 88.88, 1)],
        strip_height: 2000.0,
    };
    let sp = import_instance(&importer(Some(2.0)), &inst).expect("import");
    let total: f32 = sp.items.iter().map(|(it, q)| it.area() * *q as f32).sum();
    assert_ne!(sp.base_strip.width.to_bits(), (total / 2000.0).to_bits(), "le sondage devait échouer");
    assert!(take_fallback_items().is_empty());
    // Et le moteur complet n'en publie aucun.
    let out = run_json_with_sink(
        "spp",
        &spp_json(2000.0, &[(40.0, 100.0, 77.77, 88.88, 1)]),
        &engine_config(Some(2.0), "left", false, Some(1000.0)),
        silent(),
    )
    .expect("le job aboutit");
    assert!(out.thin_items.is_empty(), "thin_items : {:?}", out.thin_items);
    // Hauteur sans conteneur : tous les sondages échouent, le canal reste vide.
    let inst = ExtSPInstance {
        name: "trace-h".into(),
        items: vec![rect_item(0, 0.5, 0.5, 0.0, 0.0, 1)],
        strip_height: 2.00001,
    };
    assert!(import_instance(&importer(Some(2.0)), &inst).is_err());
    assert!(take_fallback_items().is_empty());
}

/// Bande à peine plus haute que l'espacement, pièces minuscules : le conteneur
/// existe d'abord, puis le constructif l'élargit jusqu'à ce qu'il n'existe plus.
/// La pièce n'y tient pas : refus nommé, pas une panique (`lbf.rs`).
#[test]
fn une_bande_tres_fine_qui_s_elargit_refuse_la_piece_sans_paniquer() {
    let _serie = serie();
    let inst = ExtSPInstance {
        name: "fine".into(),
        items: vec![rect_item(0, 0.001, 0.001, 0.0, 0.0, 200)],
        strip_height: 2.00001,
    };
    let sp = import_instance(&importer(Some(2.0)), &inst).expect("le conteneur initial existe");
    let wider = sp.base_strip.width * 1.2_f32.powi(30);
    let limite = Strip { width: wider, ..sp.base_strip };
    assert!(limite.try_container().is_err(), "le conteneur doit finir par ne plus exister");
    let msg = match run_json_with_sink(
        "spp",
        &spp_json(2.00001, &[(0.001, 0.001, 0.0, 0.0, 200)]),
        &engine_config(Some(2.0), "left", false, Some(1000.0)),
        silent(),
    ) {
        Ok(_) => panic!("cette bande ne peut rien recevoir"),
        Err(e) => format!("{e:#}"),
    };
    assert!(msg.starts_with("item_unplaceable:0:"), "message : {msg}");
}

fn rect_json(w: f64, h: f64, x: f64, y: f64) -> serde_json::Value {
    serde_json::json!([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]])
}

fn silent() -> EventSink {
    Arc::new(|_: &str| {})
}

fn spp_json(h: f64, items: &[(f64, f64, f64, f64, u64)]) -> String {
    let items: Vec<_> = items
        .iter()
        .enumerate()
        .map(|(i, (w, ph, x, y, q))| {
            serde_json::json!({
                "id": i, "demand": q, "allowed_orientations": [0.0, 90.0, 180.0, 270.0],
                "shape": {"type": "simple_polygon", "data": rect_json(*w, *ph, *x, *y)}
            })
        })
        .collect();
    serde_json::json!({"name": "fenetre", "strip_height": h, "items": items}).to_string()
}

fn bpp_json(sw: f64, sh: f64, items: &[(f64, f64, u64)]) -> String {
    let items: Vec<_> = items
        .iter()
        .enumerate()
        .map(|(i, (w, ph, q))| {
            serde_json::json!({
                "id": i, "demand": q, "allowed_orientations": [0.0, 90.0, 180.0, 270.0],
                "shape": {"type": "simple_polygon", "data": rect_json(*w, *ph, 0.0, 0.0)}
            })
        })
        .collect();
    serde_json::json!({
        "name": "fenetre-bpp", "items": items,
        "bins": [{"id": 0, "stock": 1, "cost": 100, "zones": [],
                  "shape": {"type": "simple_polygon", "data": rect_json(sw, sh, 0.0, 0.0)}}]
    })
    .to_string()
}

/// Config bornée en TRAVAIL, budget court : ce test regarde les paniques, pas
/// la qualité du layout.
fn engine_config(sep: Option<f64>, bias: &str, two_phase: bool, max_w: Option<f64>) -> String {
    let mut c = serde_json::json!({
        "time_budget_sec": 3600, "prng_seed": 7, "n_alternatives": 1,
        "poly_simpl_tolerance": 0.001, "min_item_separation": sep,
        "narrow_concavity_cutoff": [0.01, 0.01], "live_events": false,
        "n_workers": 1, "separator_workers": 1,
        "explore_max_conseq_failed_attempts": 1, "compress_failure_decay": 0.3,
        "sa_max_iterations": 60, "biases": [bias], "two_phase": two_phase
    });
    if let Some(m) = max_w {
        c["max_strip_width"] = serde_json::json!(m);
    }
    c.to_string()
}

fn run_cell(problem: &str, inst: &str, cfg: &str) -> Result<Result<usize, String>, String> {
    catch_unwind(AssertUnwindSafe(|| {
        match run_json_with_sink(problem, inst, cfg, silent()) {
            Ok(out) => Ok(out.alternatives.len()),
            Err(e) => Err(format!("{e:#}").chars().take(100).collect::<String>()),
        }
    }))
    .map_err(|p| {
        p.downcast_ref::<String>()
            .cloned()
            .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_else(|| "panique".into())
            .chars()
            .take(90)
            .collect()
    })
}

/// Le MOTEUR COMPLET (recherche, phase 2, finition, gravité, post-pass) sur
/// les cas minuscules du constat, directions et phases croisées. Un refus
/// typé est un résultat ; une panique, non.
#[test]
fn moteur_complet_sur_les_cas_minuscules() {
    let _serie = serie();
    let mut panics = vec![];
    let mut n = 0;
    let mut refus = vec![];
    for bias in ["left", "bottom", "balanced"] {
        for two_phase in [false, true] {
            // SPP directe, bande de la fenêtre.
            for (h, sep, items) in [
                (2000.0, 2.0, vec![(40.0, 100.0, 77.77, 88.88, 1)]),
                (2000.0, 2.0, vec![(10.0, 400.0, 55.55, 66.66, 1)]),
                (2000.0, 2.0, vec![(50.0, 80.00001, 0.0, 0.0, 1)]),
                (2000.0, 2.0, vec![(20.0, 100.00001, 0.0, 0.0, 2)]),
                (2000.0, 2.0, vec![(20.000001, 20.000001, 0.0, 0.0, 10)]),
                (2000.0, 2.0, vec![(40.00001, 100.0, 0.0, 0.0, 1)]),
                (2000.0, 2.0, vec![(0.15, 0.15, 0.0, 0.0, 2)]),
                (3000.0, 2.0, vec![(0.3, 0.3, 0.0, 0.0, 2)]),
                (2000.0, 2.0, vec![(0.01, 0.01, 0.0, 0.0, 2)]),
                (2.00001, 2.0, vec![(0.5, 0.5, 0.0, 0.0, 1)]),
                (2.001, 2.0, vec![(0.5, 0.5, 0.0, 0.0, 1)]),
                (4.0, 2.0, vec![(0.001, 0.001, 0.0, 0.0, 1)]),
                (4.0001, 2.0, vec![(0.0001, 0.0001, 0.0, 0.0, 1)]),
            ] {
                n += 1;
                let inst = spp_json(h, &items);
                let cfg = engine_config(Some(sep), bias, two_phase, Some(1000.0));
                match run_cell("spp", &inst, &cfg) {
                    Err(p) => panics.push(format!("spp {bias} tp={two_phase} H={h} {items:?}: {p}")),
                    Ok(Err(e)) => refus.push(format!("spp {bias} tp={two_phase} H={h} {items:?}: {e}")),
                    Ok(Ok(_)) => {}
                }
            }
            // SPP sans espacement, bande sans déflation.
            for (h, c) in [(2000.0, 0.2), (2000.0, 0.01), (2000.0, 1e-3), (6000.0, 1e-3)] {
                n += 1;
                let inst = spp_json(h, &[(c, c, 0.0, 0.0, 2)]);
                let cfg = engine_config(None, bias, two_phase, Some(1000.0));
                match run_cell("spp", &inst, &cfg) {
                    Err(p) => panics.push(format!("spp sep=0 {bias} tp={two_phase} H={h} c={c}: {p}")),
                    Ok(Err(e)) => refus.push(format!("spp sep=0 {bias} tp={two_phase} H={h} c={c}: {e}")),
                    Ok(Ok(_)) => {}
                }
            }
            // BPP : la finition de tôle partielle recrée une bande, et force
            // elle-même `two_phase` : une seule valeur du drapeau suffit.
            if two_phase {
                continue;
            }
            for (sw, sh, sep, items) in [
                (1000.0, 2000.0, Some(2.0), vec![(0.15, 0.15, 2)]),
                (1000.0, 2000.0, Some(2.0), vec![(0.1, 0.1, 2)]),
                (1000.0, 2000.0, Some(2.0), vec![(0.05, 0.05, 2)]),
                (1000.0, 2000.0, Some(2.0), vec![(0.01, 0.01, 2)]),
                (1500.0, 3000.0, Some(2.0), vec![(0.3, 0.3, 2)]),
                (1500.0, 3000.0, Some(2.0), vec![(0.2, 0.2, 2)]),
                (1000.0, 2000.0, None, vec![(0.01, 0.01, 2)]),
                (1000.0, 2000.0, None, vec![(1e-3, 1e-3, 2)]),
            ] {
                n += 1;
                let inst = bpp_json(sw, sh, &items);
                let cfg = engine_config(sep, bias, two_phase, None);
                match run_cell("bpp", &inst, &cfg) {
                    Err(p) => panics.push(format!("bpp {bias} tp={two_phase} {sw}x{sh} sep={sep:?} {items:?}: {p}")),
                    Ok(Err(e)) => refus.push(format!("bpp {bias} tp={two_phase} {sw}x{sh} sep={sep:?} {items:?}: {e}")),
                    Ok(Ok(_)) => {}
                }
            }
        }
    }
    eprintln!("{} cellules, {} refus typés", n, refus.len());
    for r in refus.iter().take(40) {
        eprintln!("  refus : {r}");
    }
    assert_no_panic("moteur complet", &panics, n);
}
