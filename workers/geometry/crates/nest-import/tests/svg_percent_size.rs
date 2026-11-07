//! SVG : `width` / `height` en pourcentage se résolvent contre le viewBox, et
//! les longueurs en % des formes suivent svgelements.
//!
//! Valeurs attendues lues par svgelements 1.9.6 (chemin serveur,
//! `svg_bytes_to_drawing` puis `build_geometry`) sur ces mêmes fichiers :
//! boîtes englobantes des pièces en mm, y vers le haut.

const PERCENT: &[u8] = include_bytes!("../../../parity/corpus_svg/svg_width_percent.svg");
const PERCENT_MIXED: &[u8] = include_bytes!("../../../parity/corpus_svg/svg_width_percent_mixed.svg");
const PERCENT_ONLY: &[u8] = include_bytes!("../../../parity/corpus_svg/svg_width_percent_only.svg");
const PERCENT_NO_VIEWBOX: &[u8] =
    include_bytes!("../../../parity/corpus_svg/svg_width_percent_no_viewbox.svg");
const SHAPES_VIEWBOX: &[u8] = include_bytes!("../../../parity/corpus_svg/svg_percent_shapes_viewbox.svg");
const SHAPES_NO_VIEWBOX: &[u8] =
    include_bytes!("../../../parity/corpus_svg/svg_percent_shapes_no_viewbox.svg");

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
fn percent_size_takes_the_viewbox_scale() {
    // width = height = 100 % d'un viewBox 500 × 300 : échelle 1 (pièce de
    // 480 × 280 px = 127 × 74,08 mm), pas 100 px physiques (échelle 0,2).
    assert_parts(PERCENT, &[([2.6458, -76.7292, 129.6458, -2.6458], 1)], "100 %");
}

#[test]
fn one_percent_attribute_resolves_alone() {
    // width = 1000 px, height = 50 % de 300 = 150 : la hauteur borne l'échelle
    // à 0,5 et le dessin est centré (translation 375 px).
    assert_parts(PERCENT_MIXED, &[([99.2188, -13.2292, 125.6771, 0.0], 0)], "px + %");
    // width = 50 % de 400 = 200, height absent = 100 % de 200 : échelle 0,5.
    assert_parts(PERCENT_ONLY, &[([2.6458, -37.0417, 50.2708, -15.875], 0)], "width seul");
}

#[test]
fn percent_size_without_viewbox_does_not_scale() {
    assert_parts(PERCENT_NO_VIEWBOX, &[([0.0, -15.875, 26.4583, 0.0], 0)], "sans viewBox");
}

#[test]
fn shape_percentages_follow_svgelements() {
    // Avec viewBox 200 × 100 sur un viewport 400 × 200 : x = 10 % vaut 20
    // unités du viewBox (puis ×2), pas 40.
    assert_parts(
        SHAPES_VIEWBOX,
        &[
            ([10.5833, -31.75, 63.5, -5.2917], 0),
            ([74.0833, -50.2708, 84.6667, -39.6875], 0),
        ],
        "% des formes avec viewBox",
    );
    // Sans viewBox svgelements permute largeur et hauteur (x = 10 % de 200 = 20) ;
    // reproduit pour que les deux chemins découpent la même pièce.
    assert_parts(SHAPES_NO_VIEWBOX, &[([5.2917, -63.5, 31.75, -10.5833], 0)], "% des formes sans viewBox");
}
