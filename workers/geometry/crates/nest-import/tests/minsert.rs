//! MINSERT : une seule occurrence importée sur toute la grille, et le fichier de coupe
//! sortait incomplet sans message. Valeurs lues par ezdxf 1.4.4 sur ces mêmes fichiers
//! (`recursive_decompose`, qui passe par `Insert.multi_insert`).

use nest_import::budget;
use nest_import::dxf::entities::Entity;
use nest_import::dxf::Document;

const GRID: &[u8] = include_bytes!("../../../parity/corpus_extra/minsert_grid.dxf");
const ROTATED_SCALED: &[u8] = include_bytes!("../../../parity/corpus_extra/minsert_rotated_scaled.dxf");
const EDGE_CASES: &[u8] = include_bytes!("../../../parity/corpus_extra/minsert_edge_cases.dxf");

/// Premier sommet du contour de chaque occurrence (une LWPOLYLINE et un cercle par tuile).
fn first_vertices(src: &[u8]) -> Vec<[f64; 2]> {
    let bytes = nest_import::canonical_dxf(src, 0.01).expect("canonical");
    let doc = Document::parse(&bytes).expect("reparse");
    doc.entities
        .iter()
        .filter_map(|e| match e {
            Entity::LwPolyline(p) => Some(p.points[0]),
            _ => None,
        })
        .collect()
}

fn assert_vertices(src: &[u8], want: &[[f64; 2]], what: &str) {
    let got = first_vertices(src);
    assert_eq!(got.len(), want.len(), "{what} : {got:?}");
    for (g, w) in got.iter().zip(want) {
        assert!(
            (g[0] - w[0]).abs() < 1e-5 && (g[1] - w[1]).abs() < 1e-5,
            "{what} : {got:?} au lieu de {want:?}"
        );
    }
}

#[test]
fn every_cell_of_the_grid_is_cut() {
    // 2 rangées × 3 colonnes, pas 40 et 60, rotation 1° appliquée à la grille.
    assert_vertices(
        GRID,
        &[
            [98.052662, 96.965552],
            [158.043524, 98.012696],
            [218.034385, 99.059841],
            [97.354566, 136.95946],
            [157.345427, 138.006604],
            [217.336289, 139.053749],
        ],
        "grille 2 × 3",
    );
    let r = nest_import::import_file(GRID, 0.01).expect("import");
    assert_eq!(r.parts.len(), 6);
    assert_eq!(r.entity_count, 12, "chaque occurrence compte dans le plafond");
    assert!(r.parts.iter().all(|p| p.holes.len() == 1));
}

#[test]
fn the_grid_rotates_with_the_block_but_is_not_scaled() {
    // xscale=yscale=2, rotation 30, pas 90 et 150 : la tuile double, pas le pas.
    assert_vertices(
        ROTATED_SCALED,
        &[
            [-0.464102, -7.196152],
            [129.439709, 67.803848],
            [-45.464102, 70.746134],
            [84.439709, 145.746134],
            [-90.464102, 148.688420],
            [39.439709, 223.68842],
        ],
        "grille tournée",
    );
}

#[test]
fn zero_spacing_negative_spacing_and_nested_minsert_follow_ezdxf() {
    assert_vertices(
        EDGE_CASES,
        &[
            // row_count=5 à pas nul : une seule rangée de 3.
            [-1.894083, -3.067971],
            [48.075458, -1.322997],
            [98.045, 0.421978],
            // Pas négatif : vers le bas.
            [-2.0, 1997.0],
            [-2.0, 1697.0],
            [-2.0, 1397.0],
            // row_count=0 : ezdxf le ramène à 1, reste la rangée de 4.
            [-2.0, 3997.0],
            [98.0, 3997.0],
            [198.0, 3997.0],
            [298.0, 3997.0],
            // MINSERT dans un bloc inséré à 90°.
            [3.0, 4998.0],
            [-497.0, 4998.0],
        ],
        "cas limites",
    );
}

#[test]
fn a_minsert_in_a_mirror_block_keeps_its_rows_on_the_composed_side() {
    // Écart ASSUMÉ avec ezdxf. Parent xscale=-1, enfant 2 rangées au pas de 500 : la
    // composition exacte garde les rangées vers +y. ezdxf réécrit l'enfant en rotation
    // 180 + yscale -1 et tourne la grille avec lui, sans son échelle : rangées vers -y.
    let dxf = "0\nSECTION\n2\nBLOCKS\n\
        0\nBLOCK\n2\nTILE\n10\n0.0\n20\n0.0\n\
        0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n10.0\n21\n0.0\n0\nENDBLK\n\
        0\nBLOCK\n2\nCOLUMN\n10\n0.0\n20\n0.0\n\
        0\nINSERT\n8\n0\n2\nTILE\n10\n0.0\n20\n0.0\n71\n2\n45\n500.0\n0\nENDBLK\n0\nENDSEC\n\
        0\nSECTION\n2\nENTITIES\n0\nINSERT\n8\n0\n2\nCOLUMN\n10\n0.0\n20\n0.0\n41\n-1.0\n\
        0\nENDSEC\n0\nEOF\n";
    let doc = Document::parse(dxf.as_bytes()).expect("parse");
    let (flat, _) = nest_import::dxf::canonical::canonical_entities(&doc);
    let lines: Vec<([f64; 2], [f64; 2])> = flat
        .iter()
        .map(|e| match e {
            Entity::Line(l) => (l.start, l.end),
            other => panic!("LINE attendue, reçu {other:?}"),
        })
        .collect();
    assert_eq!(lines, vec![([0.0, 0.0], [-10.0, 0.0]), ([0.0, 500.0], [-10.0, 500.0])]);
}

#[test]
fn every_copy_counts_against_the_ceiling() {
    // 32 000 × 32 000 occurrences d'un bloc VIDE : aucune entité émise, le plafond
    // d'entités seul ne l'arrêterait jamais. 1,5 ko ne doit pas bloquer l'onglet.
    let dxf = "0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nEMPTY\n10\n0.0\n20\n0.0\n0\nENDBLK\n0\nENDSEC\n\
        0\nSECTION\n2\nENTITIES\n0\nINSERT\n8\n0\n2\nEMPTY\n10\n0.0\n20\n0.0\n\
        70\n32000\n71\n32000\n44\n1.0\n45\n1.0\n0\nENDSEC\n0\nEOF\n";
    let start = std::time::Instant::now();
    let json = nest_import::guarded_import_json(dxf.as_bytes(), 0.01, &budget::Limits::browser())
        .expect("un refus n'est pas une erreur");
    assert!(start.elapsed().as_secs() < 5, "{:?}", start.elapsed());
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["status"], "refused", "{json}");
    assert_eq!(v["refusal"]["reason"], "entities");
    assert_eq!(v["refusal"]["entitiesAtLeast"], true);
}

#[test]
fn a_real_grid_over_the_entity_cap_is_refused_with_its_count() {
    // 200 × 100 occurrences d'une LINE : 20 000 entités pour un plafond de 10 000.
    let dxf = "0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nB\n10\n0.0\n20\n0.0\n\
        0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n1.0\n21\n0.0\n0\nENDBLK\n0\nENDSEC\n\
        0\nSECTION\n2\nENTITIES\n0\nINSERT\n8\n0\n2\nB\n10\n0.0\n20\n0.0\n\
        70\n100\n71\n200\n44\n5.0\n45\n5.0\n0\nENDSEC\n0\nEOF\n";
    let json = nest_import::guarded_import_json(dxf.as_bytes(), 0.01, &budget::Limits::browser())
        .expect("refus");
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["status"], "refused", "{json}");
    assert_eq!(v["refusal"]["entities"], 20000);
    assert_eq!(v["refusal"]["entitiesAtLeast"], false);
}
