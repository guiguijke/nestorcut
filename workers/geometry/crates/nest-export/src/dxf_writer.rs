//! Writer DXF ASCII — sémantique `build_part` (main.py 208-320) :
//!  - entités SOURCE copiées par handle, groupées par fichier, ordre de
//!    placement préservé, transformées (rotate→translate→scale unité),
//!  - calques source chargés + BIN_BOUNDARY (5) + OUT_SHAPE (1),
//!  - tôle IMPORTÉE (option « tracer le contour » active) : le vrai contour
//!    remplace le rectangle sur BIN_BOUNDARY, chaque zone interdite est une
//!    polyligne fermée sur le calque FORBIDDEN_ZONE (couleur 6),
//!  - $ACADVER AC1027 (mesuré : ezdxf.new() par défaut, J-071),
//!    $INSUNITS/$MEASUREMENT cohérents (units.rs), pleine précision.
//! Lisible par ezdxf ET par le dxf_parser de l'app (mêmes codes de groupes).

use crate::bbox;
use crate::transform::{Affine, Placement};
use nest_import::dxf::entities::{self, Entity};
use std::collections::HashMap;
use std::fmt::Write as _;

/// (scale from mm, $INSUNITS, $MEASUREMENT) — units.output_scale_and_headers.
pub fn output_scale_and_headers(output_unit: &str) -> (f64, i32, i32) {
    if output_unit == "inch" {
        (1.0 / 25.4, 1, 0)
    } else {
        (1.0, 4, 1)
    }
}

fn num(s: &mut String, code: i32, v: f64) {
    // Pleine précision, jamais arrondi (repr shortest, lisible par ezdxf/Python).
    let _ = writeln!(s, "{}\n{}", code, fmt_dxf(v));
}
/// Entier d'un groupe DXF — **jamais de point décimal**.
///
/// La spec DXF fait des codes 60-79 et 90-99 des entiers (drapeau « fermée »,
/// nombre de sommets, couleur, degré de spline…). Nous les écrivions tous en
/// flottant (« 1.0 ») : notre propre lecteur n'y voyait rien après le lot 2b
/// (il tolère), mais un DXF exporté par NestorCut part vers des CAM tiers —
/// SheetCAM notamment — qui n'ont aucune raison de tolérer. Verrou :
/// `tests/integer_group_codes.rs` refuse tout point décimal après ces codes.
fn int_grp(s: &mut String, code: i32, v: i32) {
    let _ = writeln!(s, "{}\n{}", code, v);
}
fn grp(s: &mut String, code: i32, v: &str) {
    let _ = writeln!(s, "{}\n{}", code, v);
}
fn fmt_dxf(v: f64) -> String {
    // repr le plus court (Python float() round-trip identique).
    crate::pyfloat::py_str(v)
}

/// Émet une entité transformée. Retourne false si type non supporté
/// ou coordonnée non finie (dxf-viewer lève sur `nan`/`inf`).
fn write_entity(s: &mut String, e: &Entity, aff: &Affine, handle: &str) -> bool {
    match e {
        Entity::Line(l) => {
            let a = aff.apply(l.start);
            let b = aff.apply(l.end);
            if !finite_pt(a) || !finite_pt(b) {
                return false;
            }
            grp(s, 0, "LINE");
            common(s, &l.common, handle);
            grp(s, 100, "AcDbLine");
            num(s, 10, a[0]);
            num(s, 20, a[1]);
            num(s, 11, b[0]);
            num(s, 21, b[1]);
            true
        }
        Entity::LwPolyline(p) => {
            let pts: Vec<_> = p.points.iter().map(|pt| aff.apply(*pt)).collect();
            if pts.iter().any(|q| !finite_pt(*q)) {
                return false;
            }
            grp(s, 0, "LWPOLYLINE");
            common(s, &p.common, handle);
            grp(s, 100, "AcDbPolyline");
            int_grp(s, 90, p.points.len() as i32);
            int_grp(s, 70, if p.closed { 1 } else { 0 });
            for (i, q) in pts.iter().enumerate() {
                num(s, 10, q[0]);
                num(s, 20, q[1]);
                let b = p.bulges.get(i).copied().unwrap_or(0.0);
                if b != 0.0 {
                    num(s, 42, b);
                }
            }
            true
        }
        Entity::Polyline(p) => {
            grp(s, 0, "POLYLINE");
            common(s, &p.common, handle);
            int_grp(s, 70, if p.closed { 1 } else { 0 });
            int_grp(s, 66, 1);
            for (i, pt) in p.points.iter().enumerate() {
                let q = aff.apply(*pt);
                grp(s, 0, "VERTEX");
                num(s, 10, q[0]);
                num(s, 20, q[1]);
                // Rotation + translation + échelle uniforme : le bulge ne
                // change pas. Sans lui, l'arc sort en corde du fichier de coupe.
                let b = p.bulges.get(i).copied().unwrap_or(0.0);
                if b != 0.0 {
                    num(s, 42, b);
                }
                int_grp(s, 70, 0);
            }
            grp(s, 0, "SEQEND");
            true
        }
        Entity::Arc(a) => {
            let c = aff.apply(a.center);
            if !finite_pt(c) || !a.radius.is_finite() {
                return false;
            }
            grp(s, 0, "ARC");
            common(s, &a.common, handle);
            grp(s, 100, "AcDbCircle");
            num(s, 10, c[0]);
            num(s, 20, c[1]);
            num(s, 40, a.radius * aff.scale);
            // Un tour entier s'écrit 0 / 360 : tournés (185.61499999999998 /
            // 545.615), ou d'origine comme 33.3 / 393.3, ses angles ne valent plus
            // le même angle modulo 360 à l'arrondi près, et un lecteur y voit un point.
            let full = ((a.end_angle - a.start_angle).abs() - 360.0).abs() <= 1e-9;
            let (start, end) = if full {
                (0.0, 360.0)
            } else {
                (aff.rotate_deg(a.start_angle), aff.rotate_deg(a.end_angle))
            };
            num(s, 50, start);
            num(s, 51, end);
            true
        }
        Entity::Circle(c) => {
            let ce = aff.apply(c.center);
            if !finite_pt(ce) || !c.radius.is_finite() {
                return false;
            }
            grp(s, 0, "CIRCLE");
            common(s, &c.common, handle);
            grp(s, 100, "AcDbCircle");
            num(s, 10, ce[0]);
            num(s, 20, ce[1]);
            num(s, 40, c.radius * aff.scale);
            true
        }
        Entity::Ellipse(e) => {
            let ce = aff.apply(e.center);
            if !finite_pt(ce) {
                return false;
            }
            grp(s, 0, "ELLIPSE");
            common(s, &e.common, handle);
            grp(s, 100, "AcDbEllipse");
            // vecteur majeur tourné + scalé.
            let m0 = aff.apply([0.0, 0.0]);
            let m1 = aff.apply(e.major);
            num(s, 10, ce[0]);
            num(s, 20, ce[1]);
            num(s, 11, m1[0] - m0[0]);
            num(s, 21, m1[1] - m0[1]);
            num(s, 40, e.ratio);
            num(s, 41, e.start_param);
            num(s, 42, e.end_param);
            true
        }
        Entity::Spline(sp) => {
            grp(s, 0, "SPLINE");
            common(s, &sp.common, handle);
            grp(s, 100, "AcDbSpline");
            int_grp(s, 70, 0);
            int_grp(s, 71, sp.degree);
            int_grp(s, 72, sp.knots.len() as i32);
            int_grp(s, 73, sp.control.len() as i32);
            for k in &sp.knots {
                num(s, 40, *k);
            }
            for c in &sp.control {
                let q = aff.apply(*c);
                num(s, 10, q[0]);
                num(s, 20, q[1]);
            }
            for (i, w) in sp.weights.iter().enumerate() {
                num(s, 41, *w);
                let _ = i;
            }
            true
        }
        Entity::Point(p) => {
            grp(s, 0, "POINT");
            common(s, &p.common, handle);
            grp(s, 100, "AcDbPoint");
            let q = aff.apply(p.at);
            num(s, 10, q[0]);
            num(s, 20, q[1]);
            true
        }
        _ => false,
    }
}

fn next_handle(n: &mut u64) -> String {
    *n += 1;
    format!("{n:X}")
}

fn common(s: &mut String, c: &entities::Common, handle: &str) {
    grp(s, 5, handle);
    grp(s, 100, "AcDbEntity");
    grp(s, 8, if c.layer.is_empty() { "0" } else { &c.layer });
    if c.color != 256 {
        int_grp(s, 62, c.color);
    }
}

fn finite_pt(p: [f64; 2]) -> bool {
    p[0].is_finite() && p[1].is_finite()
}

/// Calque des zones interdites d'une tôle importée, et sa couleur (6 =
/// magenta : distincte du bleu 5 de BIN_BOUNDARY, du rouge 1 d'OUT_SHAPE et
/// du 7 des calques source). Un opérateur FAO le masque ou l'exclut par son nom.
pub const FORBIDDEN_LAYER: &str = "FORBIDDEN_ZONE";
const FORBIDDEN_COLOR: i32 = 6;

/// Forme d'une tôle importée, en mm, repère de la tôle (boîte englobante du
/// contour en (0,0), y vers le haut) : anneaux FERMÉS (premier point répété
/// en dernier), tels que le moteur les a reçus.
///
/// Une coordonnée arrive en nombre JSON OU en chaîne : le lecteur de nombres de
/// serde_json (sans `float_roundtrip`) peut se tromper d'un ULP, et l'activer
/// changerait la lecture des poses de tous les autres jobs. Le navigateur envoie
/// donc les anneaux en chaînes (`String(x)`, représentation la plus courte), lues
/// ici par `str::parse::<f64>`, exacte : le DXF porte les anneaux au bit près.
#[derive(serde::Deserialize, Clone, Debug)]
pub struct BinShape {
    pub outer: Vec<[Coord; 2]>,
    #[serde(default)]
    pub inner: Vec<Vec<[Coord; 2]>>,
}

#[derive(Clone, Copy, Debug)]
pub struct Coord(pub f64);

impl From<f64> for Coord {
    fn from(v: f64) -> Self {
        Coord(v)
    }
}

impl<'de> serde::Deserialize<'de> for Coord {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(serde::Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Num(f64),
            Text(String),
        }
        match Raw::deserialize(d)? {
            Raw::Num(v) => Ok(Coord(v)),
            Raw::Text(t) => t
                .trim()
                .parse::<f64>()
                .map(Coord)
                .map_err(|_| serde::de::Error::custom("coordonnée illisible")),
        }
    }
}

fn pts(ring: &[[Coord; 2]]) -> Vec<[f64; 2]> {
    ring.iter().map(|p| [p[0].0, p[1].0]).collect()
}

/// Sommets d'un anneau sans le point de fermeture répété ; None si l'anneau
/// n'est pas dessinable (moins de 3 sommets distincts, coordonnée non finie).
fn ring_vertices(ring: &[[Coord; 2]]) -> Option<Vec<[f64; 2]>> {
    let mut v = pts(ring);
    if v.len() >= 2 && v[0] == v[v.len() - 1] {
        v.pop();
    }
    if v.len() < 3 || v.iter().any(|p| !finite_pt(*p)) {
        return None;
    }
    Some(v)
}

/// Polyligne fermée sur `layer` — mêmes attributs que le rectangle BIN_BOUNDARY.
fn closed_polyline(body: &mut String, hid: &mut u64, layer: &str, pts: &[[f64; 2]], unit_scale: f64) {
    grp(body, 0, "LWPOLYLINE");
    grp(body, 5, &next_handle(hid));
    grp(body, 100, "AcDbEntity");
    grp(body, 8, layer);
    grp(body, 100, "AcDbPolyline");
    int_grp(body, 90, pts.len() as i32);
    int_grp(body, 70, 1);
    for p in pts {
        num(body, 10, p[0] * unit_scale);
        num(body, 20, p[1] * unit_scale);
    }
}

/// Sources : file_slug -> (entities, blocks). Construit le DXF de tôle
/// (tôle rectangulaire : aucune forme).
pub fn build_part_dxf(
    sources: &HashMap<String, (Vec<Entity>, Vec<entities::Block>)>,
    transforms: &[Placement],
    add_out_shape: bool,
    space: f64,
    bin_width: Option<f64>,
    bin_height: Option<f64>,
    output_unit: &str,
) -> String {
    build_part_dxf_shaped(
        sources, transforms, add_out_shape, space, bin_width, bin_height, output_unit, None,
    )
}

/// Comme `build_part_dxf`, avec la forme d'une tôle importée. La forme n'est
/// dessinée QUE si `add_out_shape` est vrai (l'option « tracer le contour de
/// la tôle ») ; option coupée ou forme illisible : sortie identique à
/// `build_part_dxf`, octet pour octet. Les pièces ne dépendent jamais de la forme.
#[allow(clippy::too_many_arguments)]
pub fn build_part_dxf_shaped(
    sources: &HashMap<String, (Vec<Entity>, Vec<entities::Block>)>,
    transforms: &[Placement],
    add_out_shape: bool,
    space: f64,
    bin_width: Option<f64>,
    bin_height: Option<f64>,
    output_unit: &str,
    bin_shape: Option<&BinShape>,
) -> String {
    let (unit_scale, insunits, measurement) = output_scale_and_headers(output_unit);

    let mut body = String::new();
    let mut layers: Vec<(String, i32)> = Vec::new();
    let mut out_bbox: Option<[f64; 4]> = None;
    let mut hid = 0u64;

    // Group by file, preserve order.
    let mut by_file: Vec<(String, Vec<&Placement>)> = Vec::new();
    for t in transforms {
        if let Some(e) = by_file.iter_mut().find(|(s, _)| *s == t.file_slug) {
            e.1.push(t);
        } else {
            by_file.push((t.file_slug.clone(), vec![t]));
        }
    }

    for (slug, file_transforms) in &by_file {
        let (ents, blocks) = match sources.get(slug) {
            Some(v) => v,
            None => continue,
        };
        // Un handle peut porter plusieurs entités : une polyligne à arcs sous normale
        // oblique sort de la lecture éclatée (copie canonique écrite par ezdxf).
        let mut by_handle: HashMap<&str, Vec<&Entity>> = HashMap::new();
        for e in ents {
            by_handle.entry(handle_of(e)).or_default().push(e);
        }
        for t in file_transforms {
            let aff = Affine::new(t.angle, t.x, t.y, unit_scale);
            for h in &t.handles {
                for e in by_handle.get(h.as_str()).into_iter().flatten().copied() {
                    if !layers.iter().any(|(n, _)| *n == layer_of(e)) {
                        layers.push((layer_of(e), 7));
                    }
                    let hnd = next_handle(&mut hid);
                    write_entity(&mut body, e, &aff, &hnd);
                }
            }
            // OUT_SHAPE bbox (avant scale unité : on accumule en mm puis on
            // scale à l'émission).
            if let Some(bb) = bbox::entities_bbox(&collected(&t.handles, &by_handle), blocks, &Affine::new(t.angle, t.x, t.y, 1.0))
            {
                out_bbox = Some(match out_bbox {
                    None => bb,
                    Some(mut o) => {
                        o[0] = o[0].min(bb[0]);
                        o[1] = o[1].min(bb[1]);
                        o[2] = o[2].max(bb[2]);
                        o[3] = o[3].max(bb[3]);
                        o
                    }
                });
            }
        }
    }

    // Forme de tôle importée (décision du propriétaire, 20/11) : dès que le
    // contour est lisible, il remplace TOUJOURS le rectangle sur BIN_BOUNDARY,
    // option cochée ou non — le rectangle englobant d'un disque n'est pas la
    // tôle — et les zones interdites sont toujours sur leur calque. Contour
    // illisible ou tôle rectangulaire : le rectangle d'avant, inchangé.
    let outline = bin_shape.and_then(|b| ring_vertices(&b.outer).map(|v| (v, b)));
    let shape_drawn = outline.is_some();

    // BIN_BOUNDARY.
    if let Some((verts, shape)) = outline {
        if !layers.iter().any(|(n, _)| n == "BIN_BOUNDARY") {
            layers.push(("BIN_BOUNDARY".into(), 5));
        }
        closed_polyline(&mut body, &mut hid, "BIN_BOUNDARY", &verts, unit_scale);
        // Zones interdites : exactement les anneaux reçus par le moteur.
        for zone in &shape.inner {
            if let Some(zv) = ring_vertices(zone) {
                if !layers.iter().any(|(n, _)| n == FORBIDDEN_LAYER) {
                    layers.push((FORBIDDEN_LAYER.into(), FORBIDDEN_COLOR));
                }
                closed_polyline(&mut body, &mut hid, FORBIDDEN_LAYER, &zv, unit_scale);
            }
        }
    } else if let (Some(bw), Some(bh)) = (bin_width, bin_height) {
        if !layers.iter().any(|(n, _)| n == "BIN_BOUNDARY") {
            layers.push(("BIN_BOUNDARY".into(), 5));
        }
        grp(&mut body, 0, "LWPOLYLINE");
        grp(&mut body, 5, &next_handle(&mut hid));
        grp(&mut body, 100, "AcDbEntity");
        grp(&mut body, 8, "BIN_BOUNDARY");
        grp(&mut body, 100, "AcDbPolyline");
        int_grp(&mut body, 90, 4);
        int_grp(&mut body, 70, 1);
        for (x, y) in [(0.0, 0.0), (bw, 0.0), (bw, bh), (0.0, bh)] {
            num(&mut body, 10, x * unit_scale);
            num(&mut body, 20, y * unit_scale);
        }
    }

    // OUT_SHAPE : cadre rectangulaire autour des pièces posées. Jamais sur une
    // tôle importée (décision du propriétaire, 20/11) : il peut traverser une
    // zone interdite ou sortir du métal, et un opérateur peut le découper.
    if add_out_shape && !shape_drawn {
        if let Some(bb) = out_bbox {
            if !layers.iter().any(|(n, _)| n == "OUT_SHAPE") {
                layers.push(("OUT_SHAPE".into(), 1));
            }
            let (x0, y0, x1, y1) = (
                (bb[0] - space) * unit_scale,
                (bb[1] - space) * unit_scale,
                (bb[2] + space) * unit_scale,
                (bb[3] + space) * unit_scale,
            );
            grp(&mut body, 0, "LWPOLYLINE");
            grp(&mut body, 5, &next_handle(&mut hid));
            grp(&mut body, 100, "AcDbEntity");
            grp(&mut body, 8, "OUT_SHAPE");
            grp(&mut body, 100, "AcDbPolyline");
            int_grp(&mut body, 90, 4);
            int_grp(&mut body, 70, 1);
            for (x, y) in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)] {
                num(&mut body, 10, x);
                num(&mut body, 20, y);
            }
        }
    }

    // Assemble full document.
    let mut s = String::new();
    grp(&mut s, 0, "SECTION");
    grp(&mut s, 2, "HEADER");
    grp(&mut s, 9, "$ACADVER");
    grp(&mut s, 1, "AC1027");
    grp(&mut s, 9, "$INSUNITS");
    // Lot 2b : le code 70 est un ENTIER. Écrit en flottant (« 4.0 »), il
    // était relu « sans unité » par notre propre importeur navigateur — un
    // export en pouces se relisait ×1 au lieu de ×25,4. ezdxf écrit un
    // entier ; on fait pareil.
    int_grp(&mut s, 70, insunits);
    grp(&mut s, 9, "$MEASUREMENT");
    int_grp(&mut s, 70, measurement);
    grp(&mut s, 0, "ENDSEC");

    grp(&mut s, 0, "SECTION");
    grp(&mut s, 2, "TABLES");
    grp(&mut s, 0, "TABLE");
    grp(&mut s, 2, "LAYER");
    for (name, color) in &layers {
        grp(&mut s, 0, "LAYER");
        grp(&mut s, 2, name);
        int_grp(&mut s, 70, 0);
        int_grp(&mut s, 62, *color);
    }
    grp(&mut s, 0, "ENDTAB");
    grp(&mut s, 0, "ENDSEC");

    grp(&mut s, 0, "SECTION");
    grp(&mut s, 2, "ENTITIES");
    s.push_str(&body);
    grp(&mut s, 0, "ENDSEC");
    grp(&mut s, 0, "EOF");
    s
}

fn collected(handles: &[String], by_handle: &HashMap<&str, Vec<&Entity>>) -> Vec<Entity> {
    handles
        .iter()
        .filter_map(|h| by_handle.get(h.as_str()))
        .flatten()
        .map(|e| (*e).clone())
        .collect()
}

fn handle_of(e: &Entity) -> &str {
    use Entity::*;
    match e {
        Line(x) => &x.common.handle,
        LwPolyline(x) => &x.common.handle,
        Polyline(x) => &x.common.handle,
        Arc(x) => &x.common.handle,
        Circle(x) => &x.common.handle,
        Ellipse(x) => &x.common.handle,
        Spline(x) => &x.common.handle,
        Point(x) => &x.common.handle,
        Insert(x) => &x.common.handle,
        Unsupported(_) => "",
    }
}
fn layer_of(e: &Entity) -> String {
    use Entity::*;
    let l: &str = match e {
        Line(x) => x.common.layer.as_str(),
        LwPolyline(x) => x.common.layer.as_str(),
        Polyline(x) => x.common.layer.as_str(),
        Arc(x) => x.common.layer.as_str(),
        Circle(x) => x.common.layer.as_str(),
        Ellipse(x) => x.common.layer.as_str(),
        Spline(x) => x.common.layer.as_str(),
        Point(x) => x.common.layer.as_str(),
        Insert(x) => x.common.layer.as_str(),
        Unsupported(_) => "0",
    };
    if l.is_empty() { "0".into() } else { l.to_string() }
}
