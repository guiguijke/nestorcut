//! Verrous du lot 2a (`docs/PLAN-IMPORT-2026-09-09.md` §9.2) — la garde
//! « trop lourd » : plafond d'entités relevé à 10 000, budget de temps de
//! 20 s, **posés avant la décomposition**, message portant le nombre.
//!
//! Aucun verrou ici ne dépend de la vitesse de la machine pour son verdict :
//! l'ordre des gardes est prouvé par la CAUSE du refus (un budget de 1 ms
//! rendrait `Time` si le plafond d'entités était évalué après le travail) et
//! l'abandon par échéance est prouvé sur un fichier que les bornes larges
//! lisent sans erreur.

use nest_import::budget::{Limits, TooHeavyReason, MAX_ENTITIES_BROWSER, TIME_BUDGET_MS_BROWSER};
use nest_import::{import_file_limited, ImportError};

/// n LWPOLYLINEs fermées, disjointes (une pièce chacune) : le compte
/// d'entités du modelspace est exactement n.
fn dxf_with_rects(n: usize) -> String {
    let mut s = String::from("0\nSECTION\n2\nENTITIES\n");
    for i in 0..n {
        let x = (i % 100) as f64 * 20.0;
        let y = (i / 100) as f64 * 20.0;
        s.push_str(&format!(
            "0\nLWPOLYLINE\n90\n4\n70\n1\n\
             10\n{x}\n20\n{y}\n10\n{}\n20\n{y}\n\
             10\n{}\n20\n{}\n10\n{x}\n20\n{}\n",
            x + 10.0,
            x + 10.0,
            y + 10.0,
            y + 10.0
        ));
    }
    s.push_str("0\nENDSEC\n0\nEOF\n");
    s
}

/// n LIGNES ouvertes qui se croisent toutes : le noding est en O(n²) — de
/// quoi dépasser un budget d'une milliseconde sans dépendre de la machine
/// (n = 3 000 ⇒ 4,5 millions de paires).
fn dxf_with_crossing_lines(n: usize) -> String {
    let mut s = String::from("0\nSECTION\n2\nENTITIES\n");
    for i in 0..n {
        let t = i as f64;
        s.push_str(&format!(
            "0\nLINE\n10\n{}\n20\n0.0\n11\n{}\n21\n1000.0\n",
            t * 0.1,
            1000.0 - t * 0.1
        ));
    }
    s.push_str("0\nENDSEC\n0\nEOF\n");
    s
}

/// Graphe de blocs CYCLIQUE (A insère B, B insère A) : sans borne de
/// profondeur, l'expansion récurse sans fin — pile saturée, worker mort.
fn dxf_with_cyclic_blocks() -> String {
    String::from(
        "0\nSECTION\n2\nBLOCKS\n\
         0\nBLOCK\n2\nA\n10\n0.0\n20\n0.0\n\
         0\nLINE\n10\n0.0\n20\n0.0\n11\n10.0\n21\n0.0\n\
         0\nINSERT\n2\nB\n10\n0.0\n20\n0.0\n\
         0\nENDBLK\n\
         0\nBLOCK\n2\nB\n10\n0.0\n20\n0.0\n\
         0\nINSERT\n2\nA\n10\n0.0\n20\n0.0\n\
         0\nENDBLK\n\
         0\nENDSEC\n\
         0\nSECTION\n2\nENTITIES\n\
         0\nINSERT\n2\nA\n10\n0.0\n20\n0.0\n\
         0\nENDSEC\n0\nEOF\n",
    )
}

/// Un bloc de `per_block` entités inséré `inserts` fois : l'expansion produit
/// `per_block × inserts` entités là où le fichier n'en déclare que `inserts`.
fn dxf_with_block_bomb(per_block: usize, inserts: usize) -> String {
    let mut s = String::from("0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nA\n10\n0.0\n20\n0.0\n");
    for i in 0..per_block {
        s.push_str(&format!(
            "0\nLINE\n10\n0.0\n20\n{}\n11\n10.0\n21\n{}\n",
            i as f64, i as f64
        ));
    }
    s.push_str("0\nENDBLK\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n");
    for j in 0..inserts {
        s.push_str(&format!("0\nINSERT\n2\nA\n10\n{}\n20\n0.0\n", j as f64 * 100.0));
    }
    s.push_str("0\nENDSEC\n0\nEOF\n");
    s
}

fn too_heavy(e: ImportError) -> nest_import::TooHeavy {
    match e {
        ImportError::TooHeavy(t) => t,
        other => panic!("refus attendu « trop lourd », obtenu : {other}"),
    }
}

#[test]
fn the_entity_cap_is_posed_before_the_work() {
    // 3 000 lignes croisées : le travail (noding O(n²)) coûte des dizaines de
    // millisecondes. Budget de 1 ms ET plafond de 1 000 entités : si le
    // plafond était évalué APRÈS l'import (défaut C9), l'échéance tomberait
    // la première et la cause serait `Time`. La cause prouve l'ordre.
    let dxf = dxf_with_crossing_lines(3_000);
    let limits = Limits { max_entities: 1_000, time_budget_ms: 1 };
    let t = too_heavy(import_file_limited(dxf.as_bytes(), 0.01, &limits).unwrap_err());
    assert_eq!(t.reason, TooHeavyReason::Entities, "la garde doit précéder le travail");
    assert_eq!(t.entities, 3_000, "le refus doit porter le compte EXACT");
    assert!(!t.entities_at_least);
    assert_eq!(t.max_entities, 1_000);
}

#[test]
fn the_time_budget_stops_the_work() {
    let dxf = dxf_with_crossing_lines(3_000);
    // Bornes larges : le fichier est légal, il est lu.
    let ok = import_file_limited(dxf.as_bytes(), 0.01, &Limits::unlimited())
        .expect("le fichier est légal sans borne de temps");
    assert_eq!(ok.entity_count, 3_000);
    // Même fichier, budget d'une milliseconde : refus par ÉCHÉANCE, avec le
    // compte d'entités et le temps écoulé.
    let limits = Limits { max_entities: MAX_ENTITIES_BROWSER, time_budget_ms: 1 };
    let t = too_heavy(import_file_limited(dxf.as_bytes(), 0.01, &limits).unwrap_err());
    assert_eq!(t.reason, TooHeavyReason::Time);
    assert_eq!(t.entities, 3_000);
    assert_eq!(t.time_budget_ms, 1);
    assert!(t.elapsed_ms >= 1, "le temps écoulé doit être mesuré, vu {}", t.elapsed_ms);
}

#[test]
fn a_thousand_entity_file_is_read_by_the_browser_limits() {
    // 1 200 entités : refusé par l'ancien plafond (999), lu par le nouveau.
    // C'est la famille des 11 fichiers réels refusés à tort (§8 du plan).
    let dxf = dxf_with_rects(1_200);
    let r = import_file_limited(dxf.as_bytes(), 0.01, &Limits::browser())
        .expect("1 200 entités doivent passer le plafond de 10 000");
    assert_eq!(r.entity_count, 1_200);
    assert_eq!(r.parts.len(), 1_200);
    assert!(1_200 > 999 && 1_200 < MAX_ENTITIES_BROWSER);
}

#[test]
fn over_the_cap_the_message_carries_the_count() {
    let dxf = dxf_with_rects(1_200);
    let limits = Limits { max_entities: 1_000, time_budget_ms: TIME_BUDGET_MS_BROWSER };
    let err = import_file_limited(dxf.as_bytes(), 0.01, &limits).unwrap_err();
    let msg = format!("{err}");
    assert!(msg.contains("1200"), "le message doit porter le nombre : {msg}");
    assert!(msg.contains("1000"), "le message doit porter le plafond : {msg}");
}

#[test]
fn unlimited_limits_reproduce_the_historical_import() {
    let dxf = dxf_with_rects(12);
    let a = nest_import::import_file(dxf.as_bytes(), 0.01).expect("import");
    let b = import_file_limited(dxf.as_bytes(), 0.01, &Limits::unlimited()).expect("import borné");
    assert_eq!(a.entity_count, b.entity_count);
    assert_eq!(a.parts.len(), b.parts.len());
    assert_eq!(
        serde_json::to_string(&a.parts).unwrap(),
        serde_json::to_string(&b.parts).unwrap(),
        "les bornes ne doivent RIEN changer à la géométrie livrée"
    );
}

#[test]
fn a_cyclic_block_graph_is_refused_not_a_stack_overflow() {
    let dxf = dxf_with_cyclic_blocks();
    let t = too_heavy(import_file_limited(dxf.as_bytes(), 0.01, &Limits::browser()).unwrap_err());
    assert_eq!(t.reason, TooHeavyReason::BlockDepth);
    // Le chemin sans borne d'entités ni de temps passe par la MÊME garde de
    // profondeur : elle n'est pas optionnelle (miroir de assert_insert_depth).
    let t2 = too_heavy(
        import_file_limited(dxf.as_bytes(), 0.01, &Limits::unlimited()).unwrap_err(),
    );
    assert_eq!(t2.reason, TooHeavyReason::BlockDepth);
}

#[test]
fn the_expansion_ceiling_says_more_than() {
    // 50 entités × 300 INSERT = 15 000 entités pour un plafond de 1 000
    // (plafond dur d'expansion 10 000) : l'expansion s'arrête et le refus
    // l'annonce comme un PLANCHER (« plus de »), pas comme un compte exact.
    let dxf = dxf_with_block_bomb(50, 300);
    let limits = Limits { max_entities: 1_000, time_budget_ms: TIME_BUDGET_MS_BROWSER };
    let t = too_heavy(import_file_limited(dxf.as_bytes(), 0.01, &limits).unwrap_err());
    assert_eq!(t.reason, TooHeavyReason::Entities);
    assert!(t.entities_at_least, "compte coupé au plafond dur = plancher");
    assert_eq!(t.entities, 10_000, "plafond dur = 10 × le plafond d'entités");
    assert!(format!("{}", ImportError::TooHeavy(t)).contains("more than"));
}
