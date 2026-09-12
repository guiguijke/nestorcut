//! Verrou lot 2c — les constats d'import arrivent jusqu'au bout de
//! `import_file`, sur de vrais fichiers du corpus versionné.
//!
//! Ce que ce verrou attrape et que les tests unitaires ne peuvent pas : le
//! câblage. Les compteurs vivent dans trois endroits différents (la lecture
//! canonique pour les entités écartées et les unités, l'assemblage pour les
//! tracés ouverts et les pièces jetées) et se rejoignent dans
//! `ImportResult::findings`. Un maillon oublié rend une liste vide — et une
//! liste vide veut dire « rien à signaler », c'est-à-dire un mensonge.

use nest_import::findings::{LEVEL_ATTENTION, LEVEL_INFO};

const BLOCKS_NESTED: &[u8] = include_bytes!("../../../parity/corpus_extra/blocks_nested.dxf");
const UNITS_NONE: &[u8] = include_bytes!("../../../parity/corpus_extra/units_none.dxf");
const UNITS_IN: &[u8] = include_bytes!("../../../parity/corpus_extra/units_in.dxf");
const UNITS_UNKNOWN: &[u8] = include_bytes!("../../../parity/corpus_extra/units_unknown.dxf");
const PIECE_TROU: &[u8] = include_bytes!("../../../../fileprocessing/tests/fixtures/Piece_Trou.DXF");
const TEXT_ONLY: &[u8] = include_bytes!("../../../parity/corpus_extra/text_only.dxf");

fn findings(src: &[u8]) -> Vec<(String, String, usize)> {
    let r = nest_import::import_file(src, 0.01).expect("import");
    r.findings
        .into_iter()
        .map(|f| (f.code, f.level, f.count))
        .collect()
}

fn code_of<'a>(f: &'a [(String, String, usize)], code: &str) -> Option<&'a (String, String, usize)> {
    f.iter().find(|(c, _, _)| c == code)
}

#[test]
fn a_clean_part_says_nothing() {
    // Piece_Trou : un contour, un trou, unité déclarée. Rien à dire — et la
    // carte fichier n'affichera rien (règle 4 du §4 du catalogue).
    assert_eq!(findings(PIECE_TROU), Vec::new());
}

#[test]
fn flattened_blocks_are_an_info_finding() {
    let f = findings(BLOCKS_NESTED);
    let blocks = code_of(&f, "import.blocksFlattened").expect("blocs aplatis attendus");
    assert_eq!(blocks.1, LEVEL_INFO);
    assert!(blocks.2 >= 1, "au moins un INSERT résolu");
}

#[test]
fn an_undeclared_unit_is_said_even_though_nothing_is_lost() {
    let f = findings(UNITS_NONE);
    let assumed = code_of(&f, "import.unitAssumed").expect("« mm supposés » attendu");
    assert_eq!(assumed.1, LEVEL_INFO);
    // Une unité DÉCLARÉE ne dit rien de plus que sa conversion.
    let inch = findings(UNITS_IN);
    let converted = code_of(&inch, "import.unitConverted").expect("conversion attendue");
    assert_eq!(converted.1, LEVEL_INFO);
    assert!(code_of(&inch, "import.unitAssumed").is_none());
}

#[test]
fn an_implausible_unit_is_an_attention_finding() {
    // units_unknown.dxf déclare le code 7 (kilomètres) : depuis le lot 2b la
    // conversion est exacte (×1e6), donc la pièce mesure 80 mètres — c'est
    // vrai, et ça doit se dire.
    let f = findings(UNITS_UNKNOWN);
    let implausible = code_of(&f, "import.unitImplausible").expect("constat d'unité attendu");
    assert_eq!(implausible.1, LEVEL_ATTENTION);
}

#[test]
fn text_only_entities_are_noise_not_material() {
    let f = findings(TEXT_ONLY);
    // Un fichier de texte seul ne produit aucune pièce : l'import échoue ou
    // rend zéro pièce, mais si des constats sortent, le TEXTE doit être du
    // bruit (info), jamais de la matière.
    if let Some(skipped) = code_of(&f, "import.annotationsSkipped") {
        assert_eq!(skipped.1, LEVEL_INFO);
    }
    assert!(
        code_of(&f, "import.entitiesSkipped").is_none(),
        "du texte n'est pas de la matière : {f:?}"
    );
}
