//! Le repli du gonflement peut ECHOUER : le contrôle d'anneau (défaut C6) ne
//! doit alors jamais transformer en erreur un job que l'ancien code menait au
//! bout. Règle : repli en échec => on rend exactement ce que l'ancien code
//! (avant le contrôle) rendait pour cette entrée (anneau de `geo_buffer`
//! importable, sinon l'erreur d'avant), et la pièce est NOMMEE (son
//! espacement n'est plus garanti). Vaut pour les niveaux GROSSIER et PROCHE.
//!
//! Le repli est injecté (`offset_shape_with`) : aucune entrée naturelle ne
//! fait échouer `robust_inflate_ring`.
//!
//! Run: cargo test --release -p nest-engine --test inflate_fallback_failure -- --nocapture

use anyhow::bail;
use jagua_rs::geometry::primitives::{Point, SPolygon};
use jagua_rs::geometry::shape_modification::{
    INFLATE_FALLBACK_MAX_WORK, ShapeModifyMode, inflate_fallback_work, offset_shape,
    offset_shape_with, offset_shape_with_limits, robust_inflate_ring, set_current_item,
    take_fallback_items,
};
use jagua_rs::io::ext_repr::ExtSPolygon;
use jagua_rs::io::import::import_simple_polygon;
use std::cell::Cell;
use std::sync::Mutex;

static SERIE: Mutex<()> = Mutex::new(());

fn volute_ring(gap: f64, half: f64, turns: f64, steps: usize) -> Vec<(f32, f32)> {
    let pitch = 2.0 * half + gap;
    let r0 = 6.0;
    let at = |s: usize, side: f64| {
        let t = s as f64 / steps as f64 * turns * 2.0 * std::f64::consts::PI;
        let r = r0 + pitch * t / (2.0 * std::f64::consts::PI) + side * half;
        ((r * t.cos()) as f32, (r * t.sin()) as f32)
    };
    let mut ring: Vec<(f32, f32)> = (0..=steps).map(|s| at(s, -1.0)).collect();
    ring.extend((0..=steps).rev().map(|s| at(s, 1.0)));
    ring
}

fn import_ring(ring: &[(f32, f32)]) -> Option<SPolygon> {
    import_simple_polygon(&ExtSPolygon(ring.to_vec())).ok()
}

fn verts(sp: &SPolygon) -> Vec<(f32, f32)> {
    sp.vertices.iter().map(|p| (p.0, p.1)).collect()
}

/// Ce que `geo_buffer` rend pour la pièce : (nombre de polygones, premier
/// polygone importé).
fn geo_first(part: &SPolygon, d: f32) -> (usize, Option<Vec<(f32, f32)>>) {
    let poly = geo_types::Polygon::new(
        part.vertices.iter().map(|p| (p.0 as f64, p.1 as f64)).collect(),
        vec![],
    );
    let res = geo_buffer::buffer_polygon_rounded(&poly, d as f64).0;
    let first = res.first().and_then(|p| {
        let ext = ExtSPolygon(p.exterior().points().map(|p| (p.x() as f32, p.y() as f32)).collect());
        import_simple_polygon(&ext).ok().map(|s| verts(&s))
    });
    (res.len(), first)
}

type Repli = dyn Fn(&[Point], f32) -> anyhow::Result<Vec<(f32, f32)>>;

/// Appelle `offset_shape_with` avec le repli donné ; rend (résultat, pièces
/// nommées, nombre d'appels au repli).
fn run(part: &SPolygon, d: f32, fallback: &Repli) -> (anyhow::Result<SPolygon>, Vec<u64>, usize) {
    let calls = Cell::new(0usize);
    let counted = |v: &[Point], dd: f32| {
        calls.set(calls.get() + 1);
        fallback(v, dd)
    };
    take_fallback_items();
    set_current_item(Some(7));
    let out = offset_shape_with(part, ShapeModifyMode::Inflate, d, &counted);
    set_current_item(None);
    (out, take_fallback_items(), calls.get())
}

fn fails(_: &[Point], _: f32) -> anyhow::Result<Vec<(f32, f32)>> {
    bail!("repli injecté en échec")
}

/// Un anneau que `import_simple_polygon` refuse (deux points).
fn unimportable(_: &[Point], _: f32) -> anyhow::Result<Vec<(f32, f32)>> {
    Ok(vec![(0.0, 0.0), (1.0, 1.0)])
}

/// Volute g0.05 h0.6 t2.5 à d = 1 : `geo_buffer` rend UN anneau importable qui
/// traverse la pièce (verdict GROSSIER).
fn volute_grossiere() -> SPolygon {
    import_ring(&volute_ring(0.05, 0.6, 2.5, 240)).expect("import")
}

#[test]
fn grossier_repli_en_echec_rend_l_anneau_de_geo_buffer_et_nomme() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let part = volute_grossiere();
    let (n, first) = geo_first(&part, 1.0);
    assert_eq!(n, 1, "précondition : un seul polygone");
    let attendu = first.expect("précondition : anneau importable");
    for (nom, f) in [("repli en erreur", &fails as &Repli), ("repli à anneau non importable", &unimportable)] {
        let (out, nommes, appels) = run(&part, 1.0, f);
        assert_eq!(appels, 1, "{nom} : le repli doit être tenté");
        let out = out.unwrap_or_else(|e| panic!("{nom} : le job qui marchait devient une erreur : {e}"));
        assert_eq!(verts(&out), attendu, "{nom} : doit rendre l'anneau de geo_buffer, bit pour bit");
        assert_eq!(nommes, vec![7], "{nom} : la pièce doit être nommée");
    }
}

/// Volute g0.05 h1.2 t2.5 à d = 1 : `geo_buffer` rend DEUX polygones dont le
/// premier est importable. L'ancien code rendait ce premier polygone.
#[test]
fn plusieurs_polygones_repli_en_echec_rend_le_premier_et_nomme() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let part = import_ring(&volute_ring(0.05, 1.2, 2.5, 240)).expect("import");
    let (n, first) = geo_first(&part, 1.0);
    assert!(n > 1, "précondition : plusieurs polygones ({n})");
    let attendu = first.expect("précondition : premier polygone importable");
    let (out, nommes, appels) = run(&part, 1.0, &fails);
    assert_eq!(appels, 1);
    let out = out.unwrap_or_else(|e| panic!("le job qui marchait devient une erreur : {e}"));
    assert_eq!(verts(&out), attendu, "doit rendre le premier polygone de geo_buffer");
    assert_eq!(nommes, vec![7], "la pièce doit être nommée");
}

/// Volute g0.3 h1.2 t2.5 à d = 1 : l'anneau de `geo_buffer` n'est pas
/// importable. Ancien code : repli ; repli en échec => erreur.
#[test]
fn anneau_non_importable_repli_en_echec_reste_une_erreur() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let part = import_ring(&volute_ring(0.3, 1.2, 2.5, 240)).expect("import");
    let (n, first) = geo_first(&part, 1.0);
    assert!(n >= 1 && first.is_none(), "précondition : anneau non importable");
    let (out, _nommes, appels) = run(&part, 1.0, &fails);
    assert_eq!(appels, 1);
    let e = out.expect_err("rien d'importable : l'erreur d'avant");
    assert!(e.to_string().contains("offset fallback failed"), "message: {e}");
}

/// Niveau PROCHE : b_demo #11 à d = 1 (anneau de `geo_buffer` à 0,7155 d).
fn b_demo_piece(k: usize) -> SPolygon {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../bench/fixtures/b_demo/instance.json");
    let j: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let ring: Vec<(f32, f32)> = j["items"][k]["shape"]["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (p[0].as_f64().unwrap() as f32, p[1].as_f64().unwrap() as f32))
        .collect();
    import_ring(&ring).unwrap()
}

#[test]
fn proche_repli_en_echec_garde_l_anneau_et_nomme() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let part = b_demo_piece(11);
    let (n, first) = geo_first(&part, 1.0);
    assert_eq!(n, 1);
    let attendu = first.expect("anneau importable");
    for (nom, f) in [("repli en erreur", &fails as &Repli), ("repli à anneau non importable", &unimportable)] {
        let (out, nommes, appels) = run(&part, 1.0, f);
        assert_eq!(appels, 1, "{nom}");
        let out = out.expect("le job qui marchait ne devient pas une erreur");
        assert_eq!(verts(&out), attendu, "{nom} : anneau de geo_buffer conservé");
        assert_eq!(nommes, vec![7], "{nom} : l'espacement n'est plus tenu, la pièce doit être nommée");
    }
}

/// Garde-fous : un repli qui réussit sur une pièce PROCHE reste silencieux ;
/// un bon anneau n'appelle jamais le repli.
#[test]
fn proche_repli_reussi_silencieux_et_bon_anneau_sans_repli() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let part = b_demo_piece(11);
    let (out, nommes, appels) = run(&part, 1.0, &|v, d| robust_inflate_ring(v, d));
    assert!(out.is_ok());
    assert_eq!((appels, nommes), (1, vec![]), "voie proche réussie : silencieuse");

    let rect = import_ring(&[(0.0, 0.0), (40.0, 0.0), (40.0, 40.0), (0.0, 40.0)]).unwrap();
    let (out, nommes, appels) = run(&rect, 1.0, &fails);
    let out = out.expect("bon anneau");
    assert_eq!((appels, nommes), (0, vec![]), "bon anneau : aucun repli, aucun nom");
    take_fallback_items();
    let a = offset_shape(&rect, ShapeModifyMode::Inflate, 1.0).unwrap();
    assert_eq!(verts(&a), verts(&out));
}

// ---------------------------------------------------------------------------
// F6 : borne de travail du repli, niveau PROCHE seulement.
// ---------------------------------------------------------------------------

/// Cercle ondulé (8 lobes, 10 %) de `n` sommets et de rayon `r`.
fn cercle_ondule(n: usize, r: f64) -> SPolygon {
    let ring: Vec<(f32, f32)> = (0..n)
        .map(|i| {
            let a = i as f64 / n as f64 * std::f64::consts::TAU;
            let rr = r * (1.0 + 0.1 * (a * 8.0).sin());
            ((rr * a.cos()) as f32, (rr * a.sin()) as f32)
        })
        .collect();
    import_ring(&ring).expect("import")
}

/// Niveau PROCHE, travail estimé au-dessus de la borne : le repli n'est PAS
/// appelé, l'anneau de `geo_buffer` reste et la pièce est nommée. Borne
/// ouverte (infinie) : le repli est appelé et reste silencieux.
#[test]
fn proche_au_dessus_de_la_borne_garde_l_anneau_sans_appeler_le_repli() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let part = b_demo_piece(11);
    let attendu = geo_first(&part, 1.0).1.expect("anneau importable");
    let calls = Cell::new(0usize);
    let spy = |v: &[Point], d: f32| {
        calls.set(calls.get() + 1);
        robust_inflate_ring(v, d)
    };
    let work = inflate_fallback_work(&part.vertices, 1.0, f64::INFINITY);
    assert!(work > 0.0 && work < INFLATE_FALLBACK_MAX_WORK, "la pièce réelle est sous la borne ({work})");

    take_fallback_items();
    set_current_item(Some(7));
    let out = offset_shape_with_limits(&part, ShapeModifyMode::Inflate, 1.0, &spy, work - 1.0);
    set_current_item(None);
    assert_eq!(calls.get(), 0, "borne dépassée : le repli ne doit pas être appelé");
    assert_eq!(verts(&out.expect("anneau de geo_buffer")), attendu);
    assert_eq!(take_fallback_items(), vec![7], "borne dépassée : la pièce doit être nommée");

    take_fallback_items();
    set_current_item(Some(7));
    let out = offset_shape_with_limits(&part, ShapeModifyMode::Inflate, 1.0, &spy, work);
    set_current_item(None);
    assert_eq!(calls.get(), 1, "travail = borne : le repli est appelé");
    assert!(out.is_ok());
    assert!(take_fallback_items().is_empty(), "repli réussi : silencieux");
}

/// Le niveau GROSSIER n'a pas de borne (ces pièces prenaient déjà le repli) :
/// borne nulle, le repli est quand même appelé.
#[test]
fn grossier_ignore_la_borne() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let part = volute_grossiere();
    let calls = Cell::new(0usize);
    let spy = |v: &[Point], d: f32| {
        calls.set(calls.get() + 1);
        robust_inflate_ring(v, d)
    };
    take_fallback_items();
    set_current_item(Some(7));
    let out = offset_shape_with_limits(&part, ShapeModifyMode::Inflate, 1.0, &spy, 0.0);
    set_current_item(None);
    assert!(out.is_ok());
    assert_eq!(calls.get(), 1, "GROSSIER : repli appelé malgré la borne nulle");
    assert_eq!(take_fallback_items(), vec![7]);
}

/// La borne sépare le pathologique du réel (calibrage : `inflate_corpus.rs`,
/// `calibrage_du_repli`) : 500 sommets sur un rayon de 0,5 mm à d = 5 (255 s
/// mesurés) est refusé, vite ; un bord long de 2 000 sommets (1 s) passe.
#[test]
fn la_borne_separe_le_pathologique_du_reel() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let pire = cercle_ondule(500, 0.5);
    let t = std::time::Instant::now();
    let w = inflate_fallback_work(&pire.vertices, 5.0, INFLATE_FALLBACK_MAX_WORK);
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    println!("500 sommets r=0,5 d=5 : travail {w} en {ms:.2} ms");
    assert!(w > INFLATE_FALLBACK_MAX_WORK, "pathologique accepté : {w}");
    assert!(ms < 50.0, "le compte doit rester bon marché : {ms:.1} ms");

    let long = cercle_ondule(2000, 50.0);
    let w = inflate_fallback_work(&long.vertices, 5.0, INFLATE_FALLBACK_MAX_WORK);
    println!("2000 sommets r=50 d=5 : travail {w}");
    assert!(w < INFLATE_FALLBACK_MAX_WORK, "bord long refusé : {w}");
}
