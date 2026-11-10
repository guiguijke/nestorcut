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

/// Écart (mm) à partir duquel un bulge de polyligne mérite d'être dit : l'imbrication
/// travaille sur la corde (D-IMP-8), le fichier de coupe garde l'arc. Deux arcs face à face
/// perdent chacun leur flèche, donc l'espacement perdu vaut jusqu'à 2 x la flèche : c'est
/// cette valeur qui est comparée au seuil. Sous ce seuil, l'écart est plus petit que le
/// trait de découpe : rien à dire.
pub const NOTABLE_SAGITTA_MM: f64 = 0.1;

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
    /// Entités de dessin écartées parce qu'elles sont en espace papier.
    pub paper_space_skipped: usize,
    /// Trous rebouchés parce que trop petits pour être découpés (lot E1).
    pub micro_voids: usize,
    /// Sommets retirés des aller-retours de largeur nulle (lot E1).
    pub spurs_removed: usize,
    /// Entités lues et gardées dans le DXF canonique mais rattachées à aucune
    /// pièce : le fichier de coupe est construit pièce par pièce, elles n'y
    /// seront pas. Type d'entité → nombre.
    pub uncut: std::collections::BTreeMap<String, usize>,
    /// Segments de polyligne à bulge dont 2 x la flèche atteint `NOTABLE_SAGITTA_MM`.
    pub bulge_segments: usize,
    /// Plus grande flèche (mm) de tous les segments à bulge (0 si aucun).
    pub bulge_max_sagitta: f64,
    /// Handle canonique → type DXF, pour nommer les entités non rattachées.
    /// Rempli par la lecture, jamais sérialisé.
    pub kinds_by_handle: std::collections::HashMap<String, &'static str>,
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
        if !self.uncut.is_empty() {
            let total: usize = self.uncut.values().sum();
            let mut types: Vec<(&String, &usize)> = self.uncut.iter().collect();
            types.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
            out.push(
                Finding::new("import.entitiesUncut", LEVEL_ATTENTION, total)
                    .with_types(types.into_iter().map(|(k, _)| k.clone()).collect()),
            );
        }
        if self.bulge_segments > 0 && 2.0 * self.bulge_max_sagitta >= NOTABLE_SAGITTA_MM {
            out.push(
                Finding::new("import.bulgesChorded", LEVEL_ATTENTION, self.bulge_segments)
                    .with_value(format!("{:.2}", 2.0 * self.bulge_max_sagitta)),
            );
        }
        if self.dropped_parts > 0 {
            out.push(Finding::new(
                "import.partsDropped",
                LEVEL_ATTENTION,
                self.dropped_parts,
            ));
        }
        // Attention : un cadre le plus souvent, mais on ne sait pas ce qu'on écarte
        // (règle 2), et une pièce oubliée là ne serait jamais découpée.
        if self.paper_space_skipped > 0 {
            out.push(Finding::new(
                "import.paperSpaceSkipped",
                LEVEL_ATTENTION,
                self.paper_space_skipped,
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
        // Lot E1 : ce que le nettoyage géométrique a retiré. Information, pas
        // attention — ni l'un ni l'autre n'enlève de la matière à découper
        // (un micro-vide rebouché REND de la matière), mais on ne modifie pas
        // un dessin en silence.
        if self.micro_voids > 0 {
            out.push(Finding::new(
                "import.microVoidsFilled",
                LEVEL_INFO,
                self.micro_voids,
            ));
        }
        if self.spurs_removed > 0 {
            out.push(Finding::new(
                "import.spursRemoved",
                LEVEL_INFO,
                self.spurs_removed,
            ));
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
    fn uncut_entities_are_attention_and_named_by_decreasing_count() {
        let mut uncut = std::collections::BTreeMap::new();
        uncut.insert("LINE".to_string(), 2);
        uncut.insert("SPLINE".to_string(), 478);
        uncut.insert("ARC".to_string(), 2);
        let stats = ImportStats { uncut, insunits: 4, unit_factor: 1.0, ..Default::default() };
        let f = stats.findings();
        assert_eq!(f[0].code, "import.entitiesUncut");
        assert_eq!(f[0].level, LEVEL_ATTENTION);
        assert_eq!(f[0].count, 482);
        assert_eq!(f[0].types, vec!["SPLINE", "ARC", "LINE"]);
    }

    #[test]
    fn chorded_bulges_carry_the_largest_sagitta_with_two_decimals() {
        let stats = ImportStats {
            bulge_segments: 3,
            bulge_max_sagitta: 0.5858,
            insunits: 4,
            unit_factor: 1.0,
            ..Default::default()
        };
        let f = stats.findings();
        assert_eq!(f[0].code, "import.bulgesChorded");
        assert_eq!(f[0].level, LEVEL_ATTENTION);
        assert_eq!(f[0].count, 3);
        // deux arcs face à face perdent chacun leur flèche : 2 x 0,5858
        assert_eq!(f[0].value.as_deref(), Some("1.17"));
    }

    #[test]
    fn chorded_bulges_are_announced_from_twice_the_sagitta_threshold() {
        // 2 x 0,09 = 0,18 >= 0,1 : constat émis, valeur doublée.
        let big = ImportStats {
            bulge_segments: 1,
            bulge_max_sagitta: 0.09,
            insunits: 4,
            unit_factor: 1.0,
            ..Default::default()
        };
        let f = big.findings();
        assert_eq!(f[0].code, "import.bulgesChorded");
        assert_eq!(f[0].value.as_deref(), Some("0.18"));
        // 2 x 0,04 = 0,08 < 0,1 : aucun constat, même avec un segment compté.
        let quiet = ImportStats {
            bulge_segments: 1,
            bulge_max_sagitta: 0.04,
            insunits: 4,
            unit_factor: 1.0,
            ..Default::default()
        };
        assert!(quiet.findings().iter().all(|x| x.code != "import.bulgesChorded"));
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
