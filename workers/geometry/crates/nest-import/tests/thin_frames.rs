//! Cadre à paroi fine (défaut de prod du 14/11) : le cadre est une pièce, ses deux
//! contours ne partent pas avec la petite pièce posée en son milieu.

fn lwpoly(pts: &[(f64, f64)]) -> String {
    let mut s = format!("0\nLWPOLYLINE\n8\n0\n90\n{}\n70\n1\n", pts.len());
    for (x, y) in pts {
        s.push_str(&format!("10\n{x}\n20\n{y}\n"));
    }
    s
}

fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> String {
    lwpoly(&[(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
}

fn dxf(entities: &[String]) -> String {
    format!("0\nSECTION\n2\nENTITIES\n{}0\nENDSEC\n0\nEOF\n", entities.concat())
}

#[test]
fn a_thin_frame_keeps_its_two_polylines_and_the_island_its_own() {
    // Entités dans l'ordre : cadre extérieur (2F), cadre intérieur (30, paroi
    // de 0,3 mm), îlot (31), autre pièce (32).
    let doc = dxf(&[
        rect(0.0, 0.0, 10.0, 5.0),
        rect(0.3, 0.3, 9.7, 4.7),
        rect(4.0, 2.0, 6.0, 3.0),
        rect(20.0, 0.0, 25.0, 5.0),
    ]);
    let r = nest_import::import_file(doc.as_bytes(), 0.01).expect("import");
    assert_eq!(r.parts.len(), 3);

    let dims = |p: &nest_import::Part| ((p.width * 1e3).round() / 1e3, (p.height * 1e3).round() / 1e3);
    let frame = r.parts.iter().find(|p| dims(p) == (10.0, 5.0)).expect("cadre");
    let mut hs = frame.handles.clone();
    hs.sort();
    assert_eq!(hs, vec!["2F", "30"]);
    assert_eq!(frame.holes.len(), 1);

    let island = r.parts.iter().find(|p| dims(p) == (2.0, 1.0)).expect("îlot");
    assert_eq!(island.handles, vec!["31"]);

    let other = r.parts.iter().find(|p| dims(p) == (5.0, 5.0)).expect("autre pièce");
    assert_eq!(other.handles, vec!["32"]);

    assert!(
        r.findings.iter().all(|f| f.code != "import.entitiesUncut"),
        "aucune entité ne doit rester sans pièce"
    );
}
