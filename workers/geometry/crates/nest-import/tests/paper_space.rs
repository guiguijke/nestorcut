//! Espace papier (groupe 67 = 1, ou bloc `*Paper_Space…`) : ce n'est pas de la
//! pièce, c'est du cadre et du cartouche. ezdxf ne le met pas dans `modelspace()`,
//! donc le pipeline Python ne l'a jamais vu. Le navigateur, lui, en faisait des
//! pièces. Valeurs lues par ezdxf 1.4.4 sur ces mêmes fichiers : plaque 100 × 50 à
//! un trou en espace objet, 5 entités de géométrie (hors texte) par présentation.

use nest_import::findings::LEVEL_ATTENTION;
use nest_import::budget;

const R12: &[u8] = include_bytes!("../../../parity/corpus_extra/paperspace_r12.dxf");
const R2000: &[u8] = include_bytes!("../../../parity/corpus_extra/paperspace_r2000.dxf");
const R2010: &[u8] = include_bytes!("../../../parity/corpus_extra/paperspace_r2010.dxf");
const ONLY_R12: &[u8] = include_bytes!("../../../parity/corpus_extra/paperspace_only_r12.dxf");
const ONLY_R2010: &[u8] = include_bytes!("../../../parity/corpus_extra/paperspace_only_r2010.dxf");

fn paper_finding(r: &nest_import::ImportResult) -> Option<(String, usize)> {
    r.findings
        .iter()
        .find(|f| f.code == "import.paperSpaceSkipped")
        .map(|f| (f.level.clone(), f.count))
}

#[test]
fn paper_space_never_becomes_a_part() {
    for (name, src, paper) in [("R12", R12, 5), ("R2000", R2000, 5), ("R2010", R2010, 10)] {
        let r = nest_import::import_file(src, 0.01).expect(name);
        assert_eq!(r.parts.len(), 1, "{name} : la plaque, et rien d'autre");
        assert_eq!(r.parts[0].width, 100.0, "{name}");
        assert_eq!(r.parts[0].height, 50.0, "{name}");
        assert_eq!(r.parts[0].holes.len(), 1, "{name}");
        // Même nombre que len(modelspace()) côté Python : 5 entités de géométrie.
        assert_eq!(r.entity_count, 5, "{name}");
        assert_eq!(
            paper_finding(&r),
            Some((LEVEL_ATTENTION.to_string(), paper)),
            "{name} : ce qui est écarté est dit, avec son compte"
        );
    }
}

#[test]
fn the_canonical_dxf_holds_no_paper_space() {
    for (name, src) in [("R12", R12), ("R2000", R2000), ("R2010", R2010)] {
        let bytes = nest_import::canonical_dxf(src, 0.01).expect(name);
        let doc = nest_import::dxf::Document::parse(&bytes).expect("reparse");
        assert_eq!(doc.entities.len(), 5, "{name} : 4 LINE et le cercle");
    }
}

#[test]
fn a_drawing_entirely_in_paper_space_is_refused_with_its_reason() {
    for (name, src) in [("R12", ONLY_R12), ("R2010", ONLY_R2010)] {
        match nest_import::import_file(src, 0.01) {
            Ok(r) => panic!("{name} : accepté en silence, {} pièces", r.parts.len()),
            Err(e) => assert!(format!("{e}").contains("paper space"), "{name} : {e}"),
        }
    }
}

#[test]
fn the_refusal_reaches_the_browser_entry_as_a_refusal() {
    let json = nest_import::guarded_import_json(ONLY_R2010, 0.01, &budget::Limits::browser())
        .expect("un refus n'est pas une erreur");
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["status"], "refused");
    assert_eq!(v["refusal"]["reason"], "paperSpaceOnly");
    assert_eq!(v["refusal"]["entities"], 5);
}

#[test]
fn a_viewport_alone_in_paper_space_says_nothing() {
    // Toute présentation AutoCAD porte un VIEWPORT : ce n'est pas du dessin perdu.
    let dxf = "0\nSECTION\n2\nENTITIES\n\
        0\nVIEWPORT\n67\n1\n8\n0\n10\n0.0\n20\n0.0\n\
        0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n\
        10\n0.0\n20\n0.0\n10\n100.0\n20\n0.0\n10\n100.0\n20\n50.0\n10\n0.0\n20\n50.0\n\
        0\nENDSEC\n0\nEOF\n";
    let r = nest_import::import_file(dxf.as_bytes(), 0.01).expect("import");
    assert_eq!(r.parts.len(), 1);
    assert_eq!(paper_finding(&r), None);
}

#[test]
fn an_empty_model_space_without_paper_space_stays_an_empty_import() {
    // Pas de géométrie du tout : ce refus-là ne concerne que l'espace papier.
    let dxf = "0\nSECTION\n2\nENTITIES\n0\nVIEWPORT\n67\n1\n8\n0\n0\nENDSEC\n0\nEOF\n";
    let r = nest_import::import_file(dxf.as_bytes(), 0.01).expect("import");
    assert!(r.parts.is_empty());
}
