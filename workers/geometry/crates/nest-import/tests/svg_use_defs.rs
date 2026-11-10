//! SVG : `<defs>` n'est jamais rendu et `<use>` instancie sa cible (position,
//! transform, symbol, id en double, cible absente, cycle).
//!
//! Valeurs attendues lues par svgelements 1.9.6 (chemin serveur,
//! `svg_bytes_to_drawing` puis `build_geometry`) sur ces mêmes fichiers :
//! boîtes englobantes des pièces en mm, y vers le haut.

const DEFS_USE: &[u8] = include_bytes!("../../../parity/corpus_svg/svg_defs_use.svg");
const USE_NESTED: &[u8] = include_bytes!("../../../parity/corpus_svg/svg_use_nested.svg");
const USE_CYCLE: &[u8] = include_bytes!("../../../parity/corpus_svg/svg_use_cycle.svg");

type Bbox = [f64; 4];

/// (boîte, nombre de trous) de chaque pièce, triées par x puis y.
fn parts(src: &[u8]) -> Vec<(Bbox, usize)> {
    let r = nest_import::import_svg(src, 0.01).expect("import");
    let mut out: Vec<(Bbox, usize)> = r
        .parts
        .iter()
        .map(|p| {
            let xs = p.coordinates.iter().map(|c| c[0]);
            let ys = p.coordinates.iter().map(|c| c[1]);
            let fold = |it: Box<dyn Iterator<Item = f64>>, f: fn(f64, f64) -> f64, init: f64| it.fold(init, f);
            (
                [
                    fold(Box::new(xs.clone()), f64::min, f64::INFINITY),
                    fold(Box::new(ys.clone()), f64::min, f64::INFINITY),
                    fold(Box::new(xs), f64::max, f64::NEG_INFINITY),
                    fold(Box::new(ys), f64::max, f64::NEG_INFINITY),
                ],
                p.holes.len(),
            )
        })
        .collect();
    out.sort_by(|a, b| a.0[0].total_cmp(&b.0[0]).then(a.0[1].total_cmp(&b.0[1])));
    out
}

fn assert_parts(src: &[u8], want: &[(Bbox, usize)], what: &str) {
    let got = parts(src);
    assert_eq!(got.len(), want.len(), "{what} : {got:?}");
    for (g, w) in got.iter().zip(want) {
        assert_eq!(g.1, w.1, "{what} : trous {got:?}");
        for k in 0..4 {
            assert!((g.0[k] - w.0[k]).abs() < 0.01, "{what} : {got:?} au lieu de {want:?}");
        }
    }
}

#[test]
fn defs_content_is_not_a_part_and_use_places_each_instance() {
    // Le cadre 200 × 150 de <defs> était la pièce et le dessin un trou. Trois
    // instances : le rectangle en (10,10), le même tourné de 90° en (100,50), le
    // symbole (cercle de rayon 8) en (150,100).
    assert_parts(
        DEFS_USE,
        &[
            ([2.6458, -7.9375, 10.5833, -2.6458], 0),
            ([21.1667, -21.1667, 26.4583, -13.2292], 0),
            ([40.2167, -31.2208, 44.45, -26.9875], 0),
        ],
        "defs + use",
    );
}

#[test]
fn nested_use_ids_and_unresolved_targets() {
    // <use> de groupe transformé (la cible garde son scale(2)), <use> imbriqué,
    // id en double (le dernier rectangle, 12 × 12), <use> rangé dans <defs> ou en
    // display:none ou sans cible : rien.
    assert_parts(
        USE_NESTED,
        &[
            ([0.0, -23.8125, 5.2917, -18.5208], 0),
            ([9.2604, -13.2292, 14.5521, -7.9375], 0),
            ([22.225, -12.1708, 25.4, -8.9958], 0),
            ([39.6875, -19.05, 42.8625, -15.875], 0),
        ],
        "use imbriqués",
    );
    let r = nest_import::import_svg(USE_NESTED, 0.01).expect("import");
    assert!(
        r.warnings.iter().any(|w| w.contains("unresolved SVG <use>")),
        "la cible absente doit être signalée : {:?}",
        r.warnings
    );
}

#[test]
fn a_use_that_contains_itself_is_refused() {
    // svgelements : « maximum recursion depth exceeded », fichier illisible.
    let err = nest_import::import_svg(USE_CYCLE, 0.01).unwrap_err();
    assert!(err.to_string().contains("Unreadable SVG file"), "{err}");
}

#[test]
fn use_translation_applies_to_its_own_children_too() {
    // <use x="50"> : la cible (rect 10 × 10 en 0,0) sort en x de 50 à 60, et l'enfant
    // propre du <use> (rect x=0 de largeur 5) doit aussi sortir décalé, en x de 50 à 55.
    // En unités du viewBox ; le facteur mm est 25,4 / 96 (viewBox = largeur en px).
    let src = br##"<svg viewBox="0 0 200 200" width="200" height="200" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><rect id="a" width="10" height="10"/></defs><use x="50" xlink:href="#a"><rect id="child" x="0" y="100" width="5" height="5"/></use></svg>"##;
    let k = 25.4 / 96.0;
    let mut xs: Vec<(f64, f64)> = parts(src).iter().map(|(b, _)| (b[0], b[2])).collect();
    xs.sort_by(|a, b| a.0.total_cmp(&b.0));
    assert_eq!(xs.len(), 2, "cible et enfant : {xs:?}");
    let want = [(50.0 * k, 55.0 * k), (50.0 * k, 60.0 * k)];
    for (g, w) in xs.iter().zip(want.iter()) {
        assert!((g.0 - w.0).abs() < 0.01 && (g.1 - w.1).abs() < 0.01, "{xs:?} au lieu de {want:?}");
    }
}
