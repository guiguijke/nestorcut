//! Bornes d'import : plafond d'entités et budget de temps — lot 2a de
//! `docs/PLAN-IMPORT-2026-09-09.md` §9.2.
//!
//! Les deux gardes sont posées **avant la décomposition** : le plafond
//! d'entités est évalué sur le compte que rend l'expansion des INSERT (le
//! MÊME nombre que `ImportResult::entity_count`, jamais un second comptage —
//! réserve du constat C9 de la synthèse), et le budget de temps est une
//! ÉCHÉANCE contrôlée DANS les boucles chaudes : le travail s'arrête au
//! budget au lieu d'être payé en entier puis jeté (défaut C9 : 4,9 s et
//! 7,2 s d'import déjà payés pour un refus).
//!
//! Horloge : `web_time::Instant` = `std::time::Instant` en natif et
//! `performance.now()` sur wasm32 (AGENTS #14c — `std::time::Instant` panique
//! sur wasm32-unknown-unknown).

use serde::Serialize;
use web_time::Instant;

/// Plafond d'entités du chemin navigateur (999 avant le lot 2a — il refusait
/// 11 fichiers réels que le serveur lit, §8 du plan). Miroir Python :
/// `MAX_ENTITY_LIMIT` (workers/fileprocessing/core/main.py).
pub const MAX_ENTITIES_BROWSER: usize = 10_000;

/// Budget de temps par fichier du chemin navigateur, en millisecondes.
/// Miroir Python : `IMPORT_TIME_BUDGET_S` (défaut 20 s).
pub const TIME_BUDGET_MS_BROWSER: u64 = 20_000;

/// Profondeur d'imbrication d'INSERT acceptée — miroir exact de
/// `MAX_INSERT_DEPTH` (worker_common/geometry/dxf_bounds.py, pentest H-4).
/// Sans elle, un graphe de blocs CYCLIQUE fait récurser l'expansion sans fin
/// (aucune entité émise, donc le plafond de comptage ne l'arrête pas) : pile
/// saturée = worker mort, pas un refus.
pub const MAX_INSERT_DEPTH: usize = 32;

/// Facteur du plafond DUR de l'expansion : on laisse l'expansion finir
/// jusqu'à 10 × le plafond pour pouvoir annoncer le nombre EXACT d'entités
/// dans le message (« 12 345 entités »), et on coupe au-delà — un DXF de
/// 5 Mio d'INSERT ne doit pas remplir la mémoire de l'onglet avant d'être
/// refusé.
pub const EXPANSION_CEILING_FACTOR: usize = 10;

/// Bornes d'un import. `unlimited()` = comportement d'avant le lot 2a
/// (chemin de parité, CLI, tests : aucune borne).
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_entities: usize,
    /// 0 = pas de budget.
    pub time_budget_ms: u64,
}

impl Limits {
    /// Les bornes du chemin navigateur (10 000 entités, 20 s).
    pub const fn browser() -> Self {
        Self {
            max_entities: MAX_ENTITIES_BROWSER,
            time_budget_ms: TIME_BUDGET_MS_BROWSER,
        }
    }

    pub const fn unlimited() -> Self {
        Self { max_entities: usize::MAX, time_budget_ms: 0 }
    }

    /// Plafond dur de l'expansion des INSERT (voir `EXPANSION_CEILING_FACTOR`).
    pub fn expansion_ceiling(&self) -> usize {
        self.max_entities.saturating_mul(EXPANSION_CEILING_FACTOR)
    }
}

impl Default for Limits {
    fn default() -> Self {
        Self::browser()
    }
}

/// Cause d'un refus « trop lourd ».
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TooHeavyReason {
    /// Plafond d'entités dépassé (compte connu avant tout travail).
    Entities,
    /// Budget de temps épuisé pendant l'assemblage.
    Time,
    /// Graphe de blocs trop profond ou cyclique (pentest H-4).
    BlockDepth,
}

/// Échéance de travail. `unlimited()` n'expire jamais.
pub struct Deadline {
    start: Instant,
    budget_ms: u64,
}

/// Marqueur d'expiration remonté par les fonctions `*_until`.
#[derive(Debug, Clone, Copy)]
pub struct Expired {
    pub elapsed_ms: u64,
}

impl Deadline {
    /// Une lecture d'horloge toutes `STRIDE` itérations d'une boucle chaude :
    /// `node_segments` est en O(n²) (30 000 arêtes mesurées sur le corpus
    /// réel), une lecture par itération de la boucle EXTERNE reste gratuite
    /// devant le O(n) de son corps.
    pub const STRIDE: usize = 16;

    pub fn new(budget_ms: u64) -> Self {
        Self { start: Instant::now(), budget_ms }
    }

    pub fn unlimited() -> Self {
        Self::new(0)
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.start.elapsed().as_millis() as u64
    }

    pub fn expired(&self) -> bool {
        self.budget_ms != 0 && self.elapsed_ms() >= self.budget_ms
    }

    pub fn check(&self) -> Result<(), Expired> {
        if self.expired() {
            Err(Expired { elapsed_ms: self.elapsed_ms() })
        } else {
            Ok(())
        }
    }

    /// Contrôle ÉCHANTILLONNÉ (une fois toutes `STRIDE` itérations).
    pub fn check_at(&self, i: usize) -> Result<(), Expired> {
        if self.budget_ms == 0 || i % Self::STRIDE != 0 {
            return Ok(());
        }
        self.check()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unlimited_never_expires() {
        let d = Deadline::unlimited();
        assert!(!d.expired());
        assert!(d.check().is_ok());
        assert!(d.check_at(0).is_ok());
    }

    #[test]
    fn a_zero_budget_expires_at_once() {
        let d = Deadline::new(1);
        // 1 ms : l'échéance tombe dès que l'horloge avance d'une ms ; on la
        // force par une attente active bornée (pas de sleep : wasm32).
        let mut spins = 0u64;
        while !d.expired() && spins < 50_000_000 {
            spins += 1;
        }
        assert!(d.expired(), "l'échéance de 1 ms n'a jamais expiré");
        assert!(d.check().is_err());
        // Échantillonnage : hors multiple de STRIDE, aucun contrôle.
        assert!(d.check_at(1).is_ok());
        assert!(d.check_at(Deadline::STRIDE).is_err());
    }

    #[test]
    fn browser_limits_are_the_documented_ones() {
        let l = Limits::browser();
        assert_eq!(l.max_entities, 10_000);
        assert_eq!(l.time_budget_ms, 20_000);
        assert_eq!(l.expansion_ceiling(), 100_000);
        let u = Limits::unlimited();
        assert_eq!(u.time_budget_ms, 0);
    }
}
