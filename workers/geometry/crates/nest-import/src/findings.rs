//! Constats d'import — ce que l'importeur a **perdu, supposé ou aplati**,
//! sous une forme que l'interface peut afficher (lot 2c,
//! `docs/PLAN-IMPORT-2026-09-09.md` §9.2, catalogue de textes dans
//! `docs/qa/import-2026-09-09/rapport-reparation.md`).
//!
//! Deux règles portées par ce module, et pas ailleurs :
//!
//! 1. **le partage « matière » / « bruit » vit dans UNE table**, lue par les
//!    deux importeurs (miroir Python : `worker_common/geometry/
//!    import_findings.py`). Deux listes qui divergent, et le même fichier
//!    serait « attention » sur un chemin et « info » sur l'autre — exactement
//!    l'écart que le lot D a mesuré sur vingt fichiers ;
//! 2. **une entité inconnue compte comme de la MATIÈRE** : on ne sait pas ce
//!    qu'on a jeté, donc on le dit (niveau attention). Le silence est réservé
//!    à ce qu'on sait être du bruit.
//!
//! Le module ne produit **aucune phrase** : il produit des codes, des niveaux
//! et des comptes. Les textes FR/EN vivent dans `app/utils/i18n.js`.

use serde::Serialize;

/// Entités qui décrivent de la MATIÈRE : les écarter fait perdre de la
/// découpe. Niveau attention.
pub const MATERIAL_ENTITIES: &[&str] = &[
    "HATCH", "SOLID", "TRACE", "3DFACE", "SHAPE", "REGION", "3DSOLID", "BODY",
    "SURFACE", "MLINE", "ACAD_PROXY_ENTITY", "OLE2FRAME", "ACAD_TABLE",
    "REPEAT", "ENDREP", "MESH", "POLYFACE",
];

/// Entités qui ne décrivent PAS de matière découpable : annotations, cotes,
/// aides de dessin. Les écarter est le comportement voulu. Niveau info.
pub const NOISE_ENTITIES: &[&str] = &[
    "TEXT", "MTEXT", "ATTDEF", "ATTRIB", "SEQEND", "DIMENSION", "LEADER",
    "VIEWPORT", "IMAGE", "TOLERANCE", "XLINE", "RAY", "WIPEOUT", "MULTILEADER",
    "ACAD_TABLESTYLE", "LAYOUT", "VERTEX",
];

pub const LEVEL_INFO: &str = "info";
pub const LEVEL_ATTENTION: &str = "attention";

/// `true` si écarter cette entité fait perdre de la matière. Un type
/// INCONNU compte comme de la matière (règle 2 du module).
pub fn is_material(kind: &str) -> bool {
    let k = kind.trim().to_ascii_uppercase();
    if NOISE_ENTITIES.iter().any(|n| *n == k) {
        return false;
    }
    true
}

/// Un constat d'import : un code (la clé i18n), un niveau, un compte, et
/// les types concernés quand ça a du sens. Champ ADDITIF de `ImportResult` :
/// les consommateurs actuels l'ignorent.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub code: String,
    pub level: String,
    pub count: usize,
    /// Types d'entités concernés (constats d'entités écartées), triés.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub types: Vec<String>,
    /// Valeur nue utile au message (code $INSUNITS, facteur, nom d'unité).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

impl Finding {
    pub fn new(code: &str, level: &str, count: usize) -> Self {
        Self { code: code.to_string(), level: level.to_string(), count, types: Vec::new(), value: None }
    }
    pub fn with_types(mut self, types: Vec<String>) -> Self {
        self.types = types;
        self
    }
    pub fn with_value(mut self, value: impl std::fmt::Display) -> Self {
        self.value = Some(value.to_string());
        self
    }
}

/// Tout ce que la lecture du document a supposé, écarté ou aplati.
/// Rempli par `dxf::canonical` (unités, entités écartées, blocs, splines)
/// puis par `assemble` (tracés ouverts, pièces écartées).
#[derive(Debug, Clone, Default)]
pub struct ImportStats {
    /// Type d'entité écartée → nombre d'occurrences.
    pub skipped: std::collections::BTreeMap<String, usize>,
    /// Code $INSUNITS lu (0 = absent / sans unité).
    pub insunits: i32,
    /// Facteur appliqué vers le mm.
    pub unit_factor: f64,
    /// Code hors table : mm supposés.
    pub unit_unknown: bool,
    /// INSERT résolus (blocs aplatis).
    pub blocks_flattened: usize,
    /// SPLINE échantillonnées.
    pub splines: usize,
    /// Tracés ouverts qui ne referment aucune pièce (mesuré à l'assemblage).
    pub dangling_paths: usize,
    /// Corps écartés à l'émission (plus petits que 0,1 mm sur un côté).
    pub dropped_parts: usize,
}

impl ImportStats {
    /// Les constats, dans l'ordre de gravité (attention avant info) puis par
    /// compte décroissant — l'ordre d'affichage du §4 du catalogue.
    pub fn findings(&self) -> Vec<Finding> {
        let mut out: Vec<Finding> = Vec::new();

        // --- matière perdue (attention)
        let mut material: Vec<(String, usize)> = Vec::new();
        let mut noise: Vec<(String, usize)> = Vec::new();
        for (kind, n) in &self.skipped {
            if is_material(kind) {
                material.push((kind.clone(), *n));
            } else {
                noise.push((kind.clone(), *n));
            }
        }
        if !material.is_empty() {
            let total: usize = material.iter().map(|(_, n)| *n).sum();
            let mut types = material.clone();
            // types triés par compte décroissant puis alphabétique : la carte
            // n'en affiche que trois, autant que ce soient les plus gros.
            types.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            out.push(
                Finding::new("import.entitiesSkipped", LEVEL_ATTENTION, total)
                    .with_types(types.into_iter().map(|(k, _)| k).collect()),
            );
        }
        if self.dangling_paths > 0 {
            out.push(Finding::new(
                "import.contoursDropped",
                LEVEL_ATTENTION,
                self.dangling_paths,
            ));
        }
        if self.dropped_parts > 0 {
            out.push(Finding::new(
                "import.partsDropped",
                LEVEL_ATTENTION,
                self.dropped_parts,
            ));
        }
        if self.unit_unknown {
            out.push(
                Finding::new("import.unitUnknown", LEVEL_ATTENTION, 1)
                    .with_value(self.insunits),
            );
        } else if self.unit_factor >= crate::units::IMPLAUSIBLE_FACTOR_MM {
            // Kilomètres, hectomètres, années-lumière : la conversion est
            // exacte, mais une pièce de 80 mètres ne sort pas d'un atelier —
            // c'est le cas qui multipliait la géométrie par un million en
            // silence avant le lot 2b. Attention, pas info.
            out.push(
                Finding::new("import.unitImplausible", LEVEL_ATTENTION, 1)
                    .with_value(crate::units::unit_name(self.insunits)),
            );
        }

        // --- choix normaux (info)
        if !noise.is_empty() {
            let total: usize = noise.iter().map(|(_, n)| *n).sum();
            let mut types = noise.clone();
            types.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            out.push(
                Finding::new("import.annotationsSkipped", LEVEL_INFO, total)
                    .with_types(types.into_iter().map(|(k, _)| k).collect()),
            );
        }
        if !self.unit_unknown
            && self.unit_factor != 1.0
            && self.unit_factor < crate::units::IMPLAUSIBLE_FACTOR_MM
        {
            out.push(
                Finding::new("import.unitConverted", LEVEL_INFO, 1)
                    .with_value(crate::units::unit_name(self.insunits)),
            );
        }
        if self.insunits == 0 {
            out.push(Finding::new("import.unitAssumed", LEVEL_INFO, 1));
        }
        if self.blocks_flattened > 0 {
            out.push(Finding::new(
                "import.blocksFlattened",
                LEVEL_INFO,
                self.blocks_flattened,
            ));
        }
        if self.splines > 0 {
            out.push(Finding::new("import.splinesSampled", LEVEL_INFO, self.splines));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_entities_count_as_material() {
        assert!(is_material("HATCH"));
        assert!(is_material("SOLID"));
        // Un type qu'on ne connaît pas : on ne sait pas ce qu'on jette.
        assert!(is_material("WHATEVER_NEW_ENTITY"));
        assert!(!is_material("TEXT"));
        assert!(!is_material("dimension")); // insensible à la casse
    }

    #[test]
    fn a_clean_file_says_nothing() {
        let stats = ImportStats { insunits: 4, unit_factor: 1.0, ..Default::default() };
        assert!(stats.findings().is_empty(), "un fichier propre n'affiche rien");
    }

    #[test]
    fn material_loss_is_attention_and_carries_its_count() {
        let mut skipped = std::collections::BTreeMap::new();
        skipped.insert("HATCH".to_string(), 2);
        skipped.insert("TEXT".to_string(), 5);
        skipped.insert("REGION".to_string(), 3);
        let stats = ImportStats { skipped, insunits: 4, unit_factor: 1.0, ..Default::default() };
        let f = stats.findings();
        assert_eq!(f[0].code, "import.entitiesSkipped");
        assert_eq!(f[0].level, LEVEL_ATTENTION);
        assert_eq!(f[0].count, 5, "2 HATCH + 3 REGION");
        assert_eq!(f[0].types, vec!["REGION", "HATCH"], "les plus gros d'abord");
        // le texte, lui, est du bruit : info, et compté à part
        let noise = f.iter().find(|x| x.code == "import.annotationsSkipped").unwrap();
        assert_eq!(noise.level, LEVEL_INFO);
        assert_eq!(noise.count, 5);
    }

    #[test]
    fn attention_comes_before_info() {
        let mut skipped = std::collections::BTreeMap::new();
        skipped.insert("TEXT".to_string(), 1);
        let stats = ImportStats {
            skipped,
            insunits: 7,
            unit_factor: 1.0e6,
            unit_unknown: false,
            dangling_paths: 12,
            blocks_flattened: 3,
            splines: 4,
            ..Default::default()
        };
        let f = stats.findings();
        let levels: Vec<&str> = f.iter().map(|x| x.level.as_str()).collect();
        let first_info = levels.iter().position(|l| *l == LEVEL_INFO).unwrap();
        assert!(
            levels[..first_info].iter().all(|l| *l == LEVEL_ATTENTION),
            "ordre cassé : {levels:?}"
        );
        assert_eq!(f[0].code, "import.contoursDropped");
        assert_eq!(f[0].count, 12);
    }

    #[test]
    fn an_implausible_unit_is_attention_not_info() {
        // Le fichier en kilomètres : converti exactement (×1e6), mais annoncé.
        let stats = ImportStats { insunits: 7, unit_factor: 1.0e6, ..Default::default() };
        let f = stats.findings();
        assert_eq!(f[0].code, "import.unitImplausible");
        assert_eq!(f[0].level, LEVEL_ATTENTION);
        assert_eq!(f[0].value.as_deref(), Some("km"));
        assert!(f.iter().all(|x| x.code != "import.unitConverted"));
        // Le pouce, lui, reste un info.
        let inch = ImportStats { insunits: 1, unit_factor: 25.4, ..Default::default() };
        let g = inch.findings();
        assert_eq!(g[0].code, "import.unitConverted");
        assert_eq!(g[0].level, LEVEL_INFO);
    }

    #[test]
    fn an_unknown_unit_is_attention_and_names_its_code() {
        let stats = ImportStats { insunits: 42, unit_factor: 1.0, unit_unknown: true, ..Default::default() };
        let f = stats.findings();
        assert_eq!(f[0].code, "import.unitUnknown");
        assert_eq!(f[0].level, LEVEL_ATTENTION);
        assert_eq!(f[0].value.as_deref(), Some("42"));
        // et il n'y a PAS de « converti » en plus : le facteur est 1
        assert!(f.iter().all(|x| x.code != "import.unitConverted"));
    }
}
