//! Erreur d'import moteur DÉSIGNÉE PAR ITEM (lot E0 de
//! `docs/PLAN-ECLATEMENT-2026-09-12.md`).
//!
//! Pourquoi : `import_instance` importe les items en lot et ne dit pas LEQUEL
//! a échoué (« importing SPP instance into jagua-rs: Simple polygon contains
//! intersecting edges 191 and 195 »). Sans le numéro d'item, le worker comme
//! le navigateur ne peuvent nommer ni le fichier ni la pièce : l'utilisateur
//! recevait « le calcul s'est arrêté de façon inattendue » pour une pièce
//! précise, sur un lot de dix-sept.
//!
//! Le coût est nul sur le chemin normal : on ne recherche l'item fautif
//! QU'APRÈS un échec.

use crate::progress::EventSink;
use anyhow::anyhow;
use jagua_rs::io::ext_repr::ExtItem;
use jagua_rs::io::import::Importer;

/// Longueur retenue de la raison brute de jagua : son message embarque
/// l'anneau complet (des milliers de points).
const REASON_MAX_CHARS: usize = 160;

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' | '\r' | '\t' => out.push(' '),
            c if (c as u32) < 0x20 => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

/// Rejoue l'import item par item et rend `(id de l'item, raison)` du premier
/// qui échoue. L'identifiant rendu est l'`id` DÉCLARÉ de l'item (la clé de
/// l'`itemMap` du worker et du navigateur), pas son rang dans le tableau.
pub fn locate_failing_item(importer: &Importer, items: &[&ExtItem]) -> Option<(u64, String)> {
    items.iter().find_map(|it| match importer.import_item(it) {
        Ok(_) => None,
        Err(e) => Some((it.id, format!("{e:#}"))),
    })
}

/// Transforme un échec d'`import_instance` en erreur qui NOMME l'item.
///
/// Deux sorties, parce qu'il y a deux consommateurs :
/// - un évènement `{"type":"error","kind":"item_geometry","item":…,"reason":…}`
///   sur le flux (le worker Python lit déjà les lignes `type:error`) ;
/// - un message d'erreur préfixé `item_geometry:<id>:` — en navigateur, le
///   seul canal est le message de l'exception wasm.
///
/// Si aucun item ne refuse l'import à la seconde passe (l'échec venait
/// d'ailleurs : ids non consécutifs, instance vide, conteneur), l'erreur
/// d'origine est rendue telle quelle.
pub fn item_import_error(
    sink: &EventSink,
    importer: &Importer,
    items: &[&ExtItem],
    original: anyhow::Error,
) -> anyhow::Error {
    match locate_failing_item(importer, items) {
        Some((id, reason)) => {
            let short: String = reason.chars().take(REASON_MAX_CHARS).collect();
            sink(&format!(
                "{{\"type\":\"error\",\"kind\":\"item_geometry\",\"item\":{},\"reason\":\"{}\"}}",
                id,
                json_escape(&short)
            ));
            anyhow!("item_geometry:{id}: {short}")
        }
        None => original,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jagua_rs::io::ext_repr::{ExtShape, ExtSPolygon};
    use std::sync::{Arc, Mutex};

    fn importer() -> Importer {
        Importer::new(
            sparrow::config::DEFAULT_SPARROW_CONFIG.cde_config,
            Some(0.001),
            Some(1.0),
            None,
        )
    }

    fn square(id: u64, size: f32) -> ExtItem {
        ExtItem {
            id,
            allowed_orientations: Some(vec![0.0]),
            shape: ExtShape::SimplePolygon(ExtSPolygon(vec![
                (0.0, 0.0),
                (size, 0.0),
                (size, size),
                (0.0, size),
            ])),
            min_quality: None,
        }
    }

    /// Un triangle DÉGÉNÉRÉ (trois points colinéaires) : `SPolygon::new` le
    /// refuse, donc l'item ne s'importe pas.
    fn degenerate(id: u64) -> ExtItem {
        ExtItem {
            id,
            allowed_orientations: Some(vec![0.0]),
            shape: ExtShape::SimplePolygon(ExtSPolygon(vec![
                (0.0, 0.0),
                (10.0, 0.0),
                (20.0, 0.0),
            ])),
            min_quality: None,
        }
    }

    #[test]
    fn nomme_l_item_fautif_et_emet_l_evenement() {
        let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let sunk = lines.clone();
        let sink: EventSink = Arc::new(move |l: &str| sunk.lock().unwrap().push(l.to_string()));
        let imp = importer();
        let items = [square(0, 40.0), degenerate(7), square(2, 30.0)];
        let refs: Vec<&ExtItem> = items.iter().collect();
        let err = item_import_error(&sink, &imp, &refs, anyhow!("importing instance"));
        let msg = format!("{err}");
        assert!(
            msg.starts_with("item_geometry:7:"),
            "message inattendu : {msg}"
        );
        let evt = lines.lock().unwrap().join("");
        assert!(evt.contains("\"kind\":\"item_geometry\""), "évènement : {evt}");
        assert!(evt.contains("\"item\":7"), "évènement : {evt}");
        // La raison est présente, bornée, et n'a pas cassé le JSON.
        let parsed: serde_json::Value = serde_json::from_str(&evt).expect("évènement JSON valide");
        assert!(parsed["reason"].as_str().unwrap().len() <= REASON_MAX_CHARS * 4);
    }

    #[test]
    fn rend_l_erreur_d_origine_quand_tous_les_items_passent() {
        let sink: EventSink = Arc::new(|_l: &str| {});
        let imp = importer();
        let items = [square(0, 40.0), square(1, 30.0)];
        let refs: Vec<&ExtItem> = items.iter().collect();
        let err = item_import_error(&sink, &imp, &refs, anyhow!("ids non consécutifs"));
        assert_eq!(format!("{err}"), "ids non consécutifs");
    }
}
