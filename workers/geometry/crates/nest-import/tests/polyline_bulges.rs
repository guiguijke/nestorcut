//! Les arcs d'une POLYLINE classique (bulge au groupe 42 de chaque VERTEX)
//! doivent survivre jusqu'au fichier de coupe. Avant ce verrou, le DXF canonique
//! n'avait plus aucun code 42 : un demi-cercle sortait en corde, sans message.
//!
//! Valeurs attendues lues par ezdxf 1.4.4 sur ces mêmes fichiers
//! (`[(v.dxf.location, v.dxf.bulge) for v in polyline.vertices]`).

const R2010: &[u8] = include_bytes!("../../../parity/corpus_extra/polyline_bulge.dxf");
const R12: &[u8] = include_bytes!("../../../parity/corpus_extra/polyline_bulge_r12.dxf");
const R12_NO_HANDLE: &[u8] =
    include_bytes!("../../../parity/corpus_extra/polyline_bulge_r12_nohandle.dxf");

/// (x, y, bulge) des VERTEX de chaque POLYLINE, lus dans le TEXTE du DXF, par
/// paires (code, valeur) : c'est ce que lira un logiciel de découpe.
fn polylines_in_text(dxf: &[u8]) -> Vec<Vec<(f64, f64, f64)>> {
    let text = String::from_utf8_lossy(dxf);
    let lines: Vec<&str> = text.lines().collect();
    let mut out: Vec<Vec<(f64, f64, f64)>> = Vec::new();
    let mut vertex: Option<(f64, f64, f64)> = None;
    for pair in lines.chunks(2) {
        let [code, value] = pair else { break };
        let (code, value) = (code.trim(), value.trim());
        if code == "0" {
            if let Some(v) = vertex.take() {
                out.last_mut().expect("VERTEX hors POLYLINE").push(v);
            }
            match value {
                "POLYLINE" => out.push(Vec::new()),
                "VERTEX" => vertex = Some((0.0, 0.0, 0.0)),
                _ => {}
            }
        } else if let Some(v) = vertex.as_mut() {
            match code {
                "10" => v.0 = value.parse().unwrap(),
                "20" => v.1 = value.parse().unwrap(),
                "42" => v.2 = value.parse().unwrap(),
                _ => {}
            }
        }
    }
    out
}

fn plate_bulges() -> Vec<Vec<(f64, f64, f64)>> {
    vec![
        vec![(0.0, 0.0, 1.0), (100.0, 0.0, 0.0), (100.0, 50.0, 0.0), (0.0, 50.0, 0.0)],
        vec![(30.0, 15.0, 0.2), (50.0, 15.0, 0.2), (50.0, 35.0, 0.2), (30.0, 35.0, 0.2)],
        vec![
            (200.0, 100.0, 0.4142135623730951),
            (240.0, 100.0, 0.0),
            (240.0, 140.0, -0.5),
            (200.0, 140.0, 0.0),
        ],
    ]
}

#[test]
fn the_canonical_dxf_keeps_the_arcs_of_a_classic_polyline() {
    for (name, src) in [("R2010", R2010), ("R12", R12)] {
        let canonical = nest_import::canonical_dxf(src, 0.01).expect("canonical");
        assert_eq!(polylines_in_text(&canonical), plate_bulges(), "{name}");
    }
}

#[test]
fn an_r12_file_without_any_handle_keeps_its_arcs_too() {
    // La forme des vieux exporteurs : ni handle, ni $INSUNITS, ni AcDb.
    let canonical = nest_import::canonical_dxf(R12_NO_HANDLE, 0.01).expect("canonical");
    assert_eq!(
        polylines_in_text(&canonical),
        vec![vec![(0.0, 0.0, 1.0), (100.0, 0.0, 0.0), (100.0, 50.0, 0.0), (0.0, 50.0, 0.0)]]
    );
}

#[test]
fn canonical_of_a_polyline_is_a_fixed_point() {
    // Relire le canonique ne doit ni perdre ni déplacer un bulge.
    let once = nest_import::canonical_dxf(R2010, 0.01).expect("canonical");
    let twice = nest_import::canonical_dxf(&once, 0.01).expect("re-canonical");
    assert_eq!(once, twice);
}

#[test]
fn the_nesting_rings_stay_on_the_chords() {
    // D-IMP-8 : le golden Python donne la plaque 100×50, l'arc n'y entre pas.
    let r = nest_import::import_file(R2010, 0.01).expect("import");
    assert_eq!(r.parts.len(), 2);
    let plate = r.parts.iter().find(|p| p.width == 100.0).expect("plaque 100×50");
    assert_eq!(plate.height, 50.0);
    assert_eq!(plate.holes.len(), 1);
}
