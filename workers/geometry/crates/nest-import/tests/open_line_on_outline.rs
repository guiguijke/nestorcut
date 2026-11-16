//! Trait ouvert qui touche le contour (ligne de pliage, gravure) : la pièce ne
//! disparaît pas à l'import. Défaut trouvé le 16/11 : la marche des faces
//! abandonnait toute face plus longue que « sommets du dessin + 3 ».

fn lwpoly(pts: &[(f64, f64)], closed: bool) -> String {
    let mut s = format!("0
LWPOLYLINE
8
0
90
{}
70
{}
", pts.len(), if closed { 1 } else { 0 });
    for (x, y) in pts {
        s.push_str(&format!("10
{x}
20
{y}
"));
    }
    s
}

fn dxf(entities: &[String]) -> String {
    format!("0
SECTION
2
ENTITIES
{}0
ENDSEC
0
EOF
", entities.concat())
}

fn square() -> String {
    lwpoly(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)], true)
}

#[test]
fn a_square_with_an_open_line_of_four_segments_on_its_edge_is_one_part() {
    let doc = dxf(&[
        square(),
        lwpoly(&[(0.0, 5.0), (2.0, 5.0), (2.0, 6.0), (3.0, 6.0), (3.0, 7.0)], false),
    ]);
    let r = nest_import::import_file(doc.as_bytes(), 0.01).expect("import");
    assert_eq!(r.parts.len(), 1, "la pièce ne doit pas disparaître");
    let p = &r.parts[0];
    assert!((p.width - 10.0).abs() < 1e-9 && (p.height - 10.0).abs() < 1e-9);
}

#[test]
fn a_square_with_an_open_line_of_six_segments_on_its_edge_is_one_part() {
    let doc = dxf(&[
        square(),
        lwpoly(
            &[(0.0, 5.0), (1.0, 5.0), (1.0, 6.0), (2.0, 6.0), (2.0, 7.0), (3.0, 7.0), (3.0, 8.0)],
            false,
        ),
    ]);
    let r = nest_import::import_file(doc.as_bytes(), 0.01).expect("import");
    assert_eq!(r.parts.len(), 1);
}

#[test]
fn a_square_with_a_short_open_line_stays_one_part() {
    let doc = dxf(&[square(), lwpoly(&[(0.0, 5.0), (2.0, 5.0), (2.0, 6.0)], false)]);
    let r = nest_import::import_file(doc.as_bytes(), 0.01).expect("import");
    assert_eq!(r.parts.len(), 1);
}
