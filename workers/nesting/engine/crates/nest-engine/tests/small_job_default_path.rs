//! Verrou du CHEMIN PAR DÉFAUT d'un petit job (correctif a du lot A).
//!
//! Réglages d'usine : tôle 1000×2000, espacement 2, direction left. Deux
//! pièces de 40×40 mm (aire totale 3 200 mm² ≤ hauteur × espacement =
//! 4 000 mm²) partent en BPP (bascule J7-a du builder), les walks réussissent,
//! puis `merge_alternatives` finit la tôle partielle en recréant une BANDE
//! SPP de hauteur 2000 : sa largeur initiale (aire / hauteur = 1,6 mm) est
//! inférieure à l'espacement, le conteneur déflaté de `espacement / 2` par
//! côté était VIDE et jagua paniquait (`strip.rs`, « Offset resulted in an
//! empty polygon »). `panic = "abort"` : en navigateur, « unreachable » et
//! tout le calcul perdu.
//!
//! L'entrée du merge est celle du VRAI `buildLocalPayload` + de deux walks
//! wasm (fixture `bench/fixtures/j7a_defaut/merge_input.json`, produite par
//! `bench/make_j7a_fixture.mjs`).
//!
//! En release (`cargo test --release -p nest-engine`) : en debug,
//! `qt_hazard.rs:111` peut déclencher un `debug_assert` étranger au sujet.

use jagua_rs::io::ext_repr::{ExtItem as ExtBaseItem, ExtShape, ExtSPolygon};
use jagua_rs::io::import::Importer;
use jagua_rs::probs::spp::io::ext_repr::{ExtItem as ExtSPItem, ExtSPInstance};
use jagua_rs::probs::spp::io::import_instance;
use nest_engine::merge::merge_alternatives_json;

fn fixture() -> serde_json::Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../bench/fixtures/j7a_defaut/merge_input.json"
    );
    let raw = std::fs::read_to_string(path).expect("lecture de la fixture j7a_defaut");
    serde_json::from_str(&raw).expect("fixture JSON")
}

fn placed(out: &serde_json::Value) -> usize {
    let layouts = out["alternatives"][0]["solution"]["layouts"]
        .as_array()
        .expect("layouts");
    layouts
        .iter()
        .map(|l| l["placed_items"].as_array().map_or(0, |a| a.len()))
        .sum()
}

#[test]
fn deux_carres_40_sur_1000x2000_espacement_2_se_fusionnent() {
    let out = merge_alternatives_json(&fixture()).expect("le merge ne doit ni paniquer ni échouer");
    assert_eq!(out["problem"], "bpp");
    let alts = out["alternatives"].as_array().expect("alternatives");
    assert!(!alts.is_empty(), "au moins une alternative");
    assert_eq!(placed(&out), 2, "les deux pièces restent posées");
}

#[test]
fn le_merge_est_deterministe() {
    // Les durées de la finition (`finish.elapsedMs`, `phases.*Ms`) sont de
    // l'observation pure : on compare les poses, qui ne dépendent que du
    // travail (`stop: "work"`).
    let a = merge_alternatives_json(&fixture()).unwrap();
    let b = merge_alternatives_json(&fixture()).unwrap();
    assert_eq!(a["alternatives"][0]["solution"], b["alternatives"][0]["solution"]);
    assert_eq!(a["alternatives"][0]["finish"]["kept"], b["alternatives"][0]["finish"]["kept"]);
}

fn square_item(size: f32, demand: u64) -> ExtSPItem {
    ExtSPItem {
        base: ExtBaseItem {
            id: 0,
            allowed_orientations: Some(vec![0.0]),
            shape: ExtShape::SimplePolygon(ExtSPolygon(vec![
                (0.0, 0.0),
                (size, 0.0),
                (size, size),
                (0.0, size),
            ])),
            min_quality: None,
        },
        demand,
    }
}

fn importer(separation: f32) -> Importer {
    Importer::new(
        sparrow::config::DEFAULT_SPARROW_CONFIG.cde_config,
        Some(0.001),
        Some(separation),
        None,
    )
}

/// Reproductions de l'audit : l'import de la bande ne panique plus quand
/// aire totale / hauteur ≤ espacement. Chaque cas panique avant le correctif.
#[test]
fn import_de_bande_sous_l_espacement_ne_panique_plus() {
    // (côté, quantité, hauteur de bande, espacement)
    for (side, qty, h, sep) in [
        (40.0, 2, 2000.0, 2.0),  // réglages d'usine
        (30.0, 3, 1500.0, 2.0),  // 3×30×30 sur 3000×1500
        (44.0, 2, 1250.0, 4.0),  // 2×44×44 à espacement 4
        (56.0, 1, 3000.0, 2.0),  // 1×56×56, bande transposée
        (10.0, 1, 1000.0, 2.0),
    ] {
        let inst = ExtSPInstance {
            name: format!("bande-{side}x{qty}"),
            items: vec![square_item(side, qty)],
            strip_height: h,
        };
        let sp = import_instance(&importer(sep), &inst)
            .unwrap_or_else(|e| panic!("{side}x{qty} H={h} sep={sep}: {e:#}"));
        assert!(
            sp.base_strip.width > sep,
            "largeur initiale {} doit dépasser l'espacement {sep}",
            sp.base_strip.width
        );
    }
}

/// Un job qui passait déjà garde EXACTEMENT sa largeur initiale aire / H.
#[test]
fn la_largeur_initiale_est_inchangee_hors_cas_degenere() {
    let inst = ExtSPInstance {
        name: "temoin".into(),
        items: vec![square_item(46.0, 2)],
        strip_height: 2000.0,
    };
    let sp = import_instance(&importer(2.0), &inst).unwrap();
    let total: f32 = sp.items.iter().map(|(it, d)| it.area() * *d as f32).sum();
    assert_eq!(sp.base_strip.width.to_bits(), (total / 2000.0).to_bits());
}

/// H ≤ espacement : erreur typée, jamais une panique.
#[test]
fn hauteur_sous_l_espacement_est_une_erreur_typee() {
    let inst = ExtSPInstance {
        name: "plat".into(),
        items: vec![square_item(1.0, 1)],
        strip_height: 2.0,
    };
    let err = import_instance(&importer(2.0), &inst).expect_err("doit refuser");
    assert!(
        err.downcast_ref::<jagua_rs::probs::spp::io::StripHeightBelowSeparation>()
            .is_some(),
        "erreur typée attendue, reçu : {err:#}"
    );
    assert!(format!("{err}").starts_with("strip_height_below_separation:"));
}
