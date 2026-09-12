//! Verrous du lot E1 — les deux écritures DXF de l'« import avancé » :
//! mise à l'échelle et extraction d'une pièce.
//!
//! Ce qui compte : le document produit doit être un DXF canonique à son tour
//! (relisible par l'import ordinaire, handles frais séquentiels), et ne
//! porter QUE ce qu'on a demandé. Sans ces deux propriétés, l'éclatement
//! casse l'export par handle et l'aperçu.
//!
//! Run: cargo test --release -p nest-import --test advanced_import

use nest_import::{canonical_dxf_scaled, canonical_dxf_subset, import_file};

/// Deux carrés séparés (10×10 en bas à gauche, 20×20 plus loin) : deux
/// pièces, chacune ses entités.
fn two_squares() -> Vec<u8> {
    let mut s = String::from("0\nSECTION\n2\nENTITIES\n");
    let mut push = |pts: &[(f64, f64)]| {
        s.push_str("0\nLWPOLYLINE\n8\n0\n90\n");
        s.push_str(&format!("{}\n70\n1\n", pts.len()));
        for (x, y) in pts {
            s.push_str(&format!("10\n{x}\n20\n{y}\n"));
        }
    };
    push(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]);
    push(&[(50.0, 0.0), (70.0, 0.0), (70.0, 20.0), (50.0, 20.0)]);
    s.push_str("0\nENDSEC\n0\nEOF\n");
    s.into_bytes()
}

#[test]
fn l_echelle_multiplie_les_longueurs_et_reste_relisible() {
    let src = two_squares();
    let base = import_file(&src, 0.01).expect("import source");
    assert_eq!(base.parts.len(), 2);
    let w0 = base.parts[0].width;
    let h1 = base.parts[1].height;

    for factor in [0.5f64, 2.0, 0.62] {
        let scaled = canonical_dxf_scaled(&src, factor).expect("échelle");
        let out = import_file(&scaled, 0.01).expect("import du DXF mis à l'échelle");
        assert_eq!(out.parts.len(), 2, "facteur {factor}");
        // Les longueurs suivent le facteur, au flottant près.
        assert!(
            (out.parts[0].width - w0 * factor).abs() < 1e-6,
            "facteur {factor} : largeur {} au lieu de {}",
            out.parts[0].width,
            w0 * factor
        );
        assert!((out.parts[1].height - h1 * factor).abs() < 1e-6, "facteur {factor}");
        // Handles canoniques : la séquence ezdxf fraîche (piège #33b).
        assert_eq!(out.parts[0].handles.first().map(|h| h.as_str()), Some("2F"));
    }
}

#[test]
fn un_facteur_de_1_ne_change_rien() {
    // NO-OP obligatoire : l'option éteinte ne doit RIEN toucher.
    let src = two_squares();
    let a = canonical_dxf_scaled(&src, 1.0).expect("facteur 1");
    let b = nest_import::canonical_dxf(&src, 0.0).expect("canonique");
    assert_eq!(a, b, "facteur 1 doit rendre le DXF canonique tel quel");
}

#[test]
fn un_facteur_invalide_est_refuse() {
    let src = two_squares();
    for bad in [0.0f64, -1.0, f64::NAN, f64::INFINITY] {
        assert!(canonical_dxf_scaled(&src, bad).is_err(), "facteur {bad}");
    }
}

#[test]
fn le_dxf_d_une_piece_ne_porte_que_cette_piece() {
    let src = two_squares();
    let base = import_file(&src, 0.01).expect("import source");
    let canonical = nest_import::canonical_dxf(&src, 0.0).expect("canonique");
    for (k, part) in base.parts.iter().enumerate() {
        let one = canonical_dxf_subset(&canonical, &part.handles).expect("sous-ensemble");
        let out = import_file(&one, 0.01).expect("import de la pièce");
        assert_eq!(out.parts.len(), 1, "pièce {k} : {} pièces", out.parts.len());
        // Même taille que dans le dessin d'origine : extraction à l'identité.
        assert!((out.parts[0].width - part.width).abs() < 1e-9, "pièce {k}");
        assert!((out.parts[0].height - part.height).abs() < 1e-9, "pièce {k}");
        // Le document produit est canonique : handles frais.
        assert_eq!(out.parts[0].handles.first().map(|h| h.as_str()), Some("2F"));
    }
}

#[test]
fn un_handle_inconnu_ne_fabrique_pas_de_piece() {
    let src = two_squares();
    let canonical = nest_import::canonical_dxf(&src, 0.0).expect("canonique");
    let empty = canonical_dxf_subset(&canonical, &["ZZZ".to_string()]).expect("sous-ensemble");
    // Un DXF vide reste un DXF lisible ; l'import n'y voit aucune pièce.
    match import_file(&empty, 0.01) {
        Ok(r) => assert!(r.parts.is_empty(), "{} pièces", r.parts.len()),
        Err(_) => { /* refus propre : acceptable aussi */ }
    }
}

#[test]
fn echelle_puis_eclatement_se_composent() {
    // L'ordre du plan : échelle D'ABORD (sur le dessin complet), éclatement
    // ENSUITE (sur le document mis à l'échelle) — sinon les handles demandés
    // ne sont pas ceux du document qu'on découpe.
    let src = two_squares();
    let scaled = canonical_dxf_scaled(&src, 0.5).expect("échelle");
    let mid = import_file(&scaled, 0.01).expect("import mis à l'échelle");
    let one = canonical_dxf_subset(&scaled, &mid.parts[1].handles).expect("pièce");
    let out = import_file(&one, 0.01).expect("import de la pièce");
    assert_eq!(out.parts.len(), 1);
    assert!((out.parts[0].width - 10.0).abs() < 1e-6, "{}", out.parts[0].width);
}
