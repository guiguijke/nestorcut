//! INSERT resolution (ezdxf recursive_decompose twin): block references are
//! replaced by their member primitives with the reference transform applied —
//! BEFORE unit scaling (AGENTS #26). Nested INSERTs recurse.
//!
//! Le chemin Rust n'a pas d'OCS : tout ce qui sort d'ici est en coordonnées
//! monde, normale +Z. Là où ezdxf inverse l'extrusion sous un miroir (0,0,-1) et
//! garde ses valeurs brutes, on réfléchit les angles et les bulges. La courbe est
//! la même (verrou : parity/wcs_check.py), les valeurs brutes non.
//!
//! Échelle non uniforme (`Affine::is_uniform`) : ARC/CIRCLE deviennent ELLIPSE,
//! et une polyligne à arcs éclate en LINE + ELLIPSE, comme ezdxf.
//!
//! Deux écarts connus avec ezdxf, tous deux sur un INSERT imbriqué : les matrices sont
//! composées ici, alors qu'Insert.transform réécrit l'enfant dans le repère du parent
//! et perd ce que ce repère ne sait pas dire (enfant tourné sous parent à échelle
//! inégale, grille de MINSERT sous parent miroir). Verrous : tests block_transforms
//! et minsert.

use super::entities::{self, Block, Entity, Insert};
use super::flatten::Primitive;
use std::f64::consts::{FRAC_PI_2, PI, TAU};

/// Python math.isclose(a, b, rel_tol=1e-9, abs_tol).
fn isclose(a: f64, b: f64, abs_tol: f64) -> bool {
    (a - b).abs() <= (1e-9 * a.abs().max(b.abs())).max(abs_tol)
}

fn norm(v: [f64; 2]) -> f64 {
    (v[0] * v[0] + v[1] * v[1]).sqrt()
}

/// 2×2 matrix + translation (row-major [[a,b],[c,d]]).
#[derive(Debug, Clone, Copy)]
struct Affine {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    tx: f64,
    ty: f64,
}

impl Affine {
    fn identity() -> Self {
        Self { a: 1.0, b: 0.0, c: 0.0, d: 1.0, tx: 0.0, ty: 0.0 }
    }
    fn is_identity(&self) -> bool {
        self.a == 1.0
            && self.b == 0.0
            && self.c == 0.0
            && self.d == 1.0
            && self.tx == 0.0
            && self.ty == 0.0
    }
    fn apply(&self, p: [f64; 2]) -> [f64; 2] {
        [
            self.a * p[0] + self.b * p[1] + self.tx,
            self.c * p[0] + self.d * p[1] + self.ty,
        ]
    }
    /// self ∘ other (apply other first).
    fn then(&self, other: &Affine) -> Affine {
        Affine {
            a: self.a * other.a + self.b * other.c,
            b: self.a * other.b + self.b * other.d,
            c: self.c * other.a + self.d * other.c,
            d: self.c * other.b + self.d * other.d,
            tx: self.a * other.tx + self.b * other.ty + self.tx,
            ty: self.c * other.tx + self.d * other.ty + self.ty,
        }
    }
    fn apply_dir(&self, p: [f64; 2]) -> [f64; 2] {
        [
            self.a * p[0] + self.b * p[1],
            self.c * p[0] + self.d * p[1],
        ]
    }
    /// Déterminant négatif : la transformation retourne le plan. Les arcs
    /// changent de sens (ezdxf : l'extrusion passe à -Z).
    fn mirrors(&self) -> bool {
        self.a * self.d - self.b * self.c < 0.0
    }
    /// Un cercle reste un cercle : axes de même longueur (test d'ezdxf,
    /// transform_extrusion) et orthogonaux. ezdxf n'a pas à tester
    /// l'orthogonalité parce qu'il applique les matrices d'INSERT une à une ; on
    /// les compose, et deux INSERT imbriqués peuvent cisailler le plan.
    fn is_uniform(&self) -> bool {
        let xx = self.a * self.a + self.c * self.c;
        let yy = self.b * self.b + self.d * self.d;
        let dot = self.a * self.b + self.c * self.d;
        isclose(xx, yy, 1e-9) && dot.abs() <= 1e-9 * xx.max(yy)
    }
}

/// INSERT transform (ezdxf Insert.matrix44, default OCS). ezdxf compose en
/// vecteur-LIGNE : p' = p·S·R, donc l'échelle s'applique AVANT la rotation.
/// En vecteur-colonne : M = R(rotation) ∘ S(xs,ys) ; t = insert − M·base_point.
/// Occurrences d'un INSERT (ezdxf Insert.mcount + multi_insert) : les rangées et colonnes
/// à pas nul sont confondues, et une grille qui se réduit à 1 est un INSERT ordinaire.
fn insert_grid(ins: &Insert) -> (i32, i32) {
    let rows = if ins.row_spacing != 0.0 { ins.rows } else { 1 };
    let columns = if ins.column_spacing != 0.0 { ins.columns } else { 1 };
    (rows, columns)
}

/// Point d'insertion d'une occurrence : la grille vit dans l'OCS, tourne avec le bloc et
/// ne subit pas son échelle (ezdxf multi_insert : « do not apply scaling to the grid »).
fn grid_position(ins: &Insert, row: i32, column: i32) -> [f64; 2] {
    if row == 0 && column == 0 {
        return ins.at;
    }
    let (dx, dy) = (column as f64 * ins.column_spacing, row as f64 * ins.row_spacing);
    let (s, c) = libm::sincos(ins.rotation * (PI / 180.0));
    [ins.at[0] + dx * c - dy * s, ins.at[1] + dx * s + dy * c]
}

/// `at` et la rotation sont dans l'OCS de l'INSERT.
fn insert_affine(block: &Block, ins: &Insert, at: [f64; 2]) -> Affine {
    let theta = ins.rotation * (PI / 180.0);
    let (s, c) = libm::sincos(theta);
    // R * S
    let a = ins.xscale * c;
    let b = -ins.yscale * s;
    let cc = ins.xscale * s;
    let d = ins.yscale * c;
    let bx = a * block.base[0] + b * block.base[1];
    let by = cc * block.base[0] + d * block.base[1];
    let local = Affine {
        a,
        b,
        c: cc,
        d,
        tx: at[0] - bx,
        ty: at[1] - by,
    };
    match ocs_basis(ins.ocs.normal) {
        Some(basis) => basis.affine(ins.ocs.elevation).then(&local),
        None => local,
    }
}

/// Axes de l'OCS en WCS (ezdxf OCS, algorithme de l'axe arbitraire DXF). `None` si la
/// normale vaut +Z ou est nulle (ezdxf la ramène à +Z) : OCS = WCS.
struct OcsBasis {
    ax: [f64; 3],
    ay: [f64; 3],
    az: [f64; 3],
}

fn cross3(u: [f64; 3], v: [f64; 3]) -> [f64; 3] {
    [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ]
}

fn unit3(v: [f64; 3]) -> [f64; 3] {
    let n = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    [v[0] / n, v[1] / n, v[2] / n]
}

fn ocs_basis(normal: [f64; 3]) -> Option<OcsBasis> {
    if normal == [0.0, 0.0, 0.0] {
        return None;
    }
    let az = unit3(normal);
    if isclose(az[0], 0.0, 1e-12) && isclose(az[1], 0.0, 1e-12) && isclose(az[2], 1.0, 1e-12) {
        return None;
    }
    let reference = if az[0].abs() < 1.0 / 64.0 && az[1].abs() < 1.0 / 64.0 {
        [0.0, 1.0, 0.0]
    } else {
        [0.0, 0.0, 1.0]
    };
    let ax = unit3(cross3(reference, az));
    let ay = unit3(cross3(az, ax));
    Some(OcsBasis { ax, ay, az })
}

impl OcsBasis {
    /// OCS → plan XY du WCS. La normale -Z donne le miroir x → -x, donc arcs et bulges
    /// suivent les mêmes règles que sous un INSERT miroir. Une normale oblique est une
    /// projection non uniforme, comme ezdxf quand il prend x et y du WCS.
    fn affine(&self, elevation: f64) -> Affine {
        Affine {
            a: self.ax[0],
            b: self.ay[0],
            c: self.ax[1],
            d: self.ay[1],
            tx: self.az[0] * elevation,
            ty: self.az[1] * elevation,
        }
    }
}

/// Ramène en WCS, normale +Z, des entités lues avec le repère `ocs`. Sans objet à
/// +Z : les entités passent telles quelles, aucun bit ne bouge.
pub fn to_world(read: Vec<Entity>, ocs: &entities::Ocs) -> Vec<Entity> {
    let Some(basis) = ocs_basis(ocs.normal) else {
        return read;
    };
    let mut out = Vec::with_capacity(read.len());
    for e in &read {
        match e {
            // Centre et grand axe d'une ELLIPSE sont déjà en WCS : seul le petit axe
            // (normale × grand axe) dépend de la normale (ezdxf ConstructionEllipse).
            Entity::Ellipse(el) => {
                let major = [el.major[0], el.major[1], ocs.major_z];
                let n = cross3(basis.az, major);
                let k = (major[0] * major[0] + major[1] * major[1] + major[2] * major[2]).sqrt()
                    * el.ratio
                    / (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
                out.push(transform_ellipse(
                    el.center,
                    el.major,
                    [n[0] * k, n[1] * k],
                    el.start_param,
                    el.end_param,
                    &Affine::identity(),
                    &el.common,
                ));
            }
            other => transform_into(other, &basis.affine(ocs.elevation), &mut out),
        }
    }
    out
}

/// Dépassement de l'expansion des INSERT (lot 2a) : plafond dur d'entités
/// atteint, ou graphe de blocs trop profond / cyclique.
#[derive(Debug, Clone, Copy)]
pub struct Overflow {
    /// Entités émises au moment de l'arrêt (plancher du compte réel).
    pub entities: usize,
    pub depth_exceeded: bool,
}

/// INSERT resolution at the ENTITY level (J-090) : garde la charge complète de
/// l'entité (bulges, couleur, calque) pour le DXF canonique — les handles sont
/// (ré)attribués en aval (dxf/canonical.rs), comme la séquence ezdxf fraîche.
///
/// BORNÉE (lot 2a — garde posée avant la décomposition, `budget.rs`) : arrêt net
/// au plafond dur d'entités et à la profondeur d'INSERT, au lieu de saturer la
/// mémoire (ou la pile, sur un graphe de blocs cyclique) avant le refus. Miroir
/// de `decompose_bounded` + `assert_insert_depth`
/// (worker_common/geometry/dxf_bounds.py).
pub fn decompose_to_entities_bounded(
    entities: &[Entity],
    blocks: &[Block],
    ceiling: usize,
    max_depth: usize,
) -> Result<Vec<Entity>, Overflow> {
    let mut out = Vec::new();
    let mut copies = 0usize;
    match decompose_entities_bounded_into(
        entities,
        blocks,
        Affine::identity(),
        &mut out,
        &mut copies,
        ceiling,
        max_depth,
        0,
    ) {
        Ok(()) => Ok(out),
        Err(depth_exceeded) => Err(Overflow { entities: out.len().max(copies), depth_exceeded }),
    }
}

/// Err(true) = profondeur dépassée, Err(false) = plafond d'entités atteint. Chaque
/// occurrence résolue compte (`copies`) : une grille d'un bloc vide n'émet aucune
/// entité, le plafond d'entités seul ne l'arrêterait jamais.
#[allow(clippy::too_many_arguments)]
fn decompose_entities_bounded_into(
    entities: &[Entity],
    blocks: &[Block],
    m: Affine,
    out: &mut Vec<Entity>,
    copies: &mut usize,
    ceiling: usize,
    max_depth: usize,
    depth: usize,
) -> Result<(), bool> {
    if depth > max_depth {
        return Err(true);
    }
    for e in entities {
        match e {
            Entity::Insert(ins) => {
                if let Some(block) = blocks.iter().find(|b| b.name == ins.block) {
                    let (rows, columns) = insert_grid(ins);
                    for row in 0..rows {
                        for column in 0..columns {
                            *copies += 1;
                            if *copies > ceiling {
                                return Err(false);
                            }
                            let local = insert_affine(block, ins, grid_position(ins, row, column));
                            decompose_entities_bounded_into(
                                &block.entities,
                                blocks,
                                m.then(&local),
                                out,
                                copies,
                                ceiling,
                                max_depth,
                                depth + 1,
                            )?;
                        }
                    }
                }
                // Missing block definition: ezdxf raises — recover skips.
            }
            _ => {
                if out.len() >= ceiling {
                    return Err(false);
                }
                transform_into(e, &m, out);
            }
        }
    }
    Ok(())
}

/// Applies the affine map to one entity, keeping the full payload (common,
/// bulges, knots/weights). The nesting rings then read the geometry through
/// `primitive_of` : a SINGLE implementation of the transform math, so the rings
/// and the canonical entities can never drift apart. Une polyligne à arcs sous
/// une échelle non uniforme rend plusieurs entités (ezdxf : virtual_entities).
fn transform_into(e: &Entity, m: &Affine, out: &mut Vec<Entity>) {
    // Hors bloc, ezdxf ne transforme rien : aucune valeur ne doit bouger d'un bit.
    if m.is_identity() {
        out.push(e.clone());
        return;
    }
    let has_arc = |bulges: &[f64]| bulges.iter().any(|b| *b != 0.0);
    match e {
        Entity::LwPolyline(p) if !m.is_uniform() && has_arc(&p.bulges) => {
            explode_polyline(&p.points, &p.bulges, p.closed, &p.common, m, out);
        }
        Entity::Polyline(p) if !m.is_uniform() && has_arc(&p.bulges) => {
            explode_polyline(&p.points, &p.bulges, p.closed, &p.common, m, out);
        }
        _ => out.push(transform_entity(e, m)),
    }
}

fn transform_entity(e: &Entity, m: &Affine) -> Entity {
    match e {
        Entity::Line(l) => Entity::Line(entities::Line {
            start: m.apply(l.start),
            end: m.apply(l.end),
            common: l.common.clone(),
        }),
        Entity::LwPolyline(p) => Entity::LwPolyline(entities::LwPolyline {
            points: p.points.iter().map(|&pt| m.apply(pt)).collect(),
            bulges: mapped_bulges(&p.bulges, m),
            closed: p.closed,
            common: p.common.clone(),
        }),
        Entity::Polyline(p) => Entity::Polyline(entities::Polyline {
            points: p.points.iter().map(|&pt| m.apply(pt)).collect(),
            bulges: mapped_bulges(&p.bulges, m),
            closed: p.closed,
            common: p.common.clone(),
            vertex_handles: p.vertex_handles.clone(),
            seqend_handle: p.seqend_handle.clone(),
        }),
        Entity::Point(p) => Entity::Point(entities::Point {
            at: m.apply(p.at),
            common: p.common.clone(),
        }),
        Entity::Circle(c) => circle_entity(c, m),
        Entity::Arc(a) => arc_entity(a.center, a.radius, a.start_angle, a.end_angle, m, &a.common),
        Entity::Ellipse(el) => {
            // Petit axe = +Z × grand axe, à la longueur grand axe × ratio.
            let minor = [-el.major[1] * el.ratio, el.major[0] * el.ratio];
            transform_ellipse(el.center, el.major, minor, el.start_param, el.end_param, m, &el.common)
        }
        Entity::Spline(sp) => Entity::Spline(entities::Spline {
            degree: sp.degree,
            knots: sp.knots.clone(),
            control: sp.control.iter().map(|&pt| m.apply(pt)).collect(),
            weights: sp.weights.clone(),
            common: sp.common.clone(),
        }),
        Entity::Unsupported(kind) => Entity::Unsupported(kind.clone()),
        // INSERT never reaches here — resolved by decompose_entities_bounded_into.
        Entity::Insert(ins) => Entity::Insert(ins.clone()),
    }
}

/// Le bulge garde sa valeur sous une similitude, son SIGNE suit le sens du plan.
fn mapped_bulges(bulges: &[f64], m: &Affine) -> Vec<f64> {
    if m.mirrors() {
        bulges.iter().map(|b| if *b == 0.0 { 0.0 } else { -*b }).collect()
    } else {
        bulges.to_vec()
    }
}

/// Geometry projection Entity → Primitive (no transform — identity map).
/// The nesting rings only ever see this projection (bulges dropped, D-IMP-8).
pub fn primitive_of(e: &Entity) -> Primitive {
    match e {
        Entity::Line(l) => Primitive::Line {
            start: l.start,
            end: l.end,
            handle: l.common.handle.clone(),
            layer: l.common.layer.clone(),
        },
        Entity::LwPolyline(p) => Primitive::Polyline {
            points: p.points.clone(),
            closed: p.closed,
            handle: p.common.handle.clone(),
            layer: p.common.layer.clone(),
        },
        Entity::Polyline(p) => Primitive::Polyline {
            points: p.points.clone(),
            closed: p.closed,
            handle: p.common.handle.clone(),
            layer: p.common.layer.clone(),
        },
        Entity::Point(p) => Primitive::Point {
            at: p.at,
            handle: p.common.handle.clone(),
            layer: p.common.layer.clone(),
        },
        Entity::Circle(c) => Primitive::Circle {
            center: c.center,
            radius: c.radius,
            handle: c.common.handle.clone(),
            layer: c.common.layer.clone(),
        },
        Entity::Arc(a) => Primitive::Arc {
            center: a.center,
            radius: a.radius,
            start_angle: a.start_angle,
            end_angle: a.end_angle,
            handle: a.common.handle.clone(),
            layer: a.common.layer.clone(),
        },
        Entity::Ellipse(el) => Primitive::Ellipse {
            center: el.center,
            major: el.major,
            ratio: el.ratio,
            start_param: el.start_param,
            end_param: el.end_param,
            handle: el.common.handle.clone(),
            layer: el.common.layer.clone(),
        },
        Entity::Spline(sp) => Primitive::Spline {
            degree: sp.degree,
            knots: sp.knots.clone(),
            control: sp.control.clone(),
            weights: sp.weights.clone(),
            handle: sp.common.handle.clone(),
            layer: sp.common.layer.clone(),
        },
        Entity::Unsupported(kind) => Primitive::Unsupported(kind.clone()),
        Entity::Insert(_) => Primitive::Unsupported("INSERT".into()),
    }
}

/// CIRCLE under an affine map (entity level): uniform scale stays a Circle
/// (radius × s) ; non-uniform converts to an ellipse (ezdxf Ellipse.from_arc).
fn circle_entity(c: &entities::Circle, m: &Affine) -> Entity {
    if m.is_uniform() {
        Entity::Circle(entities::Circle {
            center: m.apply(c.center),
            radius: c.radius * norm([m.a, m.c]),
            common: c.common.clone(),
        })
    } else {
        let r = c.radius.abs();
        transform_ellipse(c.center, [r, 0.0], [0.0, r], 0.0, TAU, m, &c.common)
    }
}

/// ARC under an affine map (entity level). Uniform scale: radius × s, angles
/// rotated, and swapped when the plane flips: a direction at angle φ maps to
/// α − φ (α = image of the x axis), so the counter-clockwise arc s→e becomes the
/// counter-clockwise arc (α−e)→(α−s). Non-uniform: ELLIPSE (ezdxf from_arc).
fn arc_entity(
    center: [f64; 2],
    radius: f64,
    start_angle: f64,
    end_angle: f64,
    m: &Affine,
    common: &entities::Common,
) -> Entity {
    if m.is_uniform() {
        let theta = libm::atan2(m.c, m.a).to_degrees();
        let (start_angle, end_angle) = if m.mirrors() {
            (theta - end_angle, theta - start_angle)
        } else {
            (start_angle + theta, end_angle + theta)
        };
        Entity::Arc(entities::Arc {
            center: m.apply(center),
            radius: radius * norm([m.a, m.c]),
            start_angle,
            end_angle,
            common: common.clone(),
        })
    } else {
        let r = radius.abs();
        transform_ellipse(
            center,
            [r, 0.0],
            [0.0, r],
            start_angle * (PI / 180.0),
            end_angle * (PI / 180.0),
            m,
            common,
        )
    }
}

/// ezdxf bulge_to_arc : (centre, début, fin, rayon) d'un arc toujours orienté
/// dans le sens trigonométrique, angles en degrés. Le rayon SIGNÉ place le centre,
/// le rayon renvoyé est |r| (AGENTS #1).
fn bulge_to_arc(a: [f64; 2], b: [f64; 2], bulge: f64) -> ([f64; 2], f64, f64, f64) {
    let angle = |p: [f64; 2], q: [f64; 2]| libm::atan2(q[1] - p[1], q[0] - p[0]);
    let chord = norm([b[0] - a[0], b[1] - a[1]]);
    let r = chord * (1.0 + bulge * bulge) / 4.0 / bulge;
    let t = angle(a, b) + (FRAC_PI_2 - libm::atan(bulge) * 2.0);
    let c = [a[0] + libm::cos(t) * r, a[1] + libm::sin(t) * r];
    let (start, end) = if bulge < 0.0 { (b, a) } else { (a, b) };
    (c, angle(c, start).to_degrees(), angle(c, end).to_degrees(), r.abs())
}

/// Polyligne à arcs sous échelle non uniforme : ses segments deviennent des LINE
/// et ses arcs des ELLIPSE (ezdxf _virtual_polyline_entities + from_arc).
fn explode_polyline(
    points: &[[f64; 2]],
    bulges: &[f64],
    closed: bool,
    common: &entities::Common,
    m: &Affine,
    out: &mut Vec<Entity>,
) {
    let n = points.len();
    if n < 2 {
        return;
    }
    let segments = if closed { n } else { n - 1 };
    for i in 0..segments {
        let (a, b) = (points[i], points[(i + 1) % n]);
        let bulge = bulges.get(i).copied().unwrap_or(0.0);
        if bulge != 0.0 {
            let (center, start, end, radius) = bulge_to_arc(a, b, bulge);
            if radius > 0.0 {
                out.push(arc_entity(center, radius, start, end, m, common));
            }
        } else {
            out.push(Entity::Line(entities::Line {
                start: m.apply(a),
                end: m.apply(b),
                common: common.clone(),
            }));
        }
    }
}

/// Rytz (ezdxf rytz_axis_construction) : les vrais axes d'une ellipse à partir de
/// deux demi-diamètres conjugués. Rend (grand axe, petit axe, ratio).
fn rytz_axes(d1: [f64; 2], d2: [f64; 2]) -> Option<([f64; 2], [f64; 2], f64)> {
    let q = d1;
    let p1 = [d2[1], -d2[0]]; // d2 tourné de -90°
    let d = [(p1[0] + q[0]) / 2.0, (p1[1] + q[1]) / 2.0];
    let radius = norm(d);
    let qp = [q[0] - p1[0], q[1] - p1[1]];
    let qp_len = norm(qp);
    if qp_len == 0.0 {
        return None;
    }
    let rv = [qp[0] / qp_len * radius, qp[1] / qp_len * radius];
    let a = [d[0] - rv[0], d[1] - rv[1]];
    let b = [d[0] + rv[0], d[1] + rv[1]];
    let major_len = norm([a[0] - q[0], a[1] - q[1]]);
    let minor_len = norm([b[0] - q[0], b[1] - q[1]]);
    let (a_len, b_len) = (norm(a), norm(b));
    if major_len == 0.0 || minor_len == 0.0 || a_len == 0.0 || b_len == 0.0 {
        return None;
    }
    Some((
        [b[0] / b_len * major_len, b[1] / b_len * major_len],
        [a[0] / a_len * minor_len, a[1] / a_len * minor_len],
        minor_len / major_len,
    ))
}

/// ELLIPSE sous une transformation quelconque : portage de
/// ConstructionEllipse.transform (ezdxf). Sous cisaillement les images des axes ne
/// sont plus orthogonales (Rytz, et les paramètres sont recalculés), un ratio > 1
/// échange les axes. Le résultat est ramené en normale +Z : sous un miroir ezdxf
/// garde (0,0,-1) et ses paramètres, ici on rend (-fin, -début), même courbe.
fn transform_ellipse(
    center: [f64; 2],
    major: [f64; 2],
    minor: [f64; 2],
    start_param: f64,
    end_param: f64,
    m: &Affine,
    common: &entities::Common,
) -> Entity {
    let vertex = |c: [f64; 2], maj: [f64; 2], min: [f64; 2], p: f64| -> [f64; 2] {
        let (cos, sin) = (libm::cos(p), libm::sin(p));
        [c[0] + cos * maj[0] + sin * min[0], c[1] + cos * maj[1] + sin * min[1]]
    };
    let new_center = m.apply(center);
    let mut new_major = m.apply_dir(major);
    let mut new_minor = m.apply_dir(minor);
    let (major_len, minor_len) = (norm(new_major), norm(new_minor));
    let degenerate = || {
        Entity::Ellipse(entities::Ellipse {
            center: new_center,
            major: [0.0, 0.0],
            ratio: 1.0,
            start_param: 0.0,
            end_param: TAU,
            common: common.clone(),
        })
    };
    // Une échelle nulle aplatit la courbe : aucune géométrie, jamais de NaN.
    if major_len == 0.0 || minor_len == 0.0 {
        return degenerate();
    }
    let dot = (new_major[0] * new_minor[0] + new_major[1] * new_minor[1]) / (major_len * minor_len);
    let (mut start, mut end) = (start_param, end_param);
    let mut ratio;
    if dot.abs() > 1e-6 {
        let Some((axis_major, axis_minor, r)) = rytz_axes(new_major, new_minor) else {
            return degenerate();
        };
        new_major = axis_major;
        new_minor = axis_minor;
        ratio = r;
        if !isclose(start, end, 1e-9) {
            // Ellipse ouverte : les paramètres se recalculent sur les vrais axes.
            let old_span = (end - start).rem_euclid(TAU);
            let (x_len, y_len) = (norm(new_major), norm(new_minor));
            let x_axis = [new_major[0] / x_len, new_major[1] / x_len];
            let y_axis = [new_minor[0] / y_len, new_minor[1] / y_len];
            let param = |v: [f64; 2]| -> f64 {
                let dx = x_axis[0] * v[0] + x_axis[1] * v[1];
                let dy = (y_axis[0] * v[0] + y_axis[1] * v[1]) / ratio;
                libm::atan2(dy, dx).rem_euclid(TAU)
            };
            let relative = |p: [f64; 2]| [p[0] - new_center[0], p[1] - new_center[1]];
            start = param(relative(m.apply(vertex(center, major, minor, start_param))));
            end = param(relative(m.apply(vertex(center, major, minor, end_param))));
            // Le bon côté de la courbe : même étendue qu'avant ; à π exactement
            // l'étendue ne tranche pas, on regarde le point du milieu.
            if !isclose(old_span, PI, 1e-9) {
                if !isclose(old_span, (end - start).rem_euclid(TAU), 1e-9) {
                    std::mem::swap(&mut start, &mut end);
                }
            } else {
                let mid = |s: f64, e: f64| (s + if e < s { e + TAU } else { e }) / 2.0;
                let old_chk = m.apply(vertex(center, major, minor, mid(start_param, end_param)));
                let new_chk = vertex(new_center, new_major, new_minor, mid(start, end));
                if !isclose(old_chk[0], new_chk[0], 1e-9) || !isclose(old_chk[1], new_chk[1], 1e-9) {
                    std::mem::swap(&mut start, &mut end);
                }
            }
        }
    } else {
        ratio = minor_len / major_len;
    }
    // Sens du plan après transformation : la normale (grand × petit) vaut ±Z.
    let positive = new_major[0] * new_minor[1] - new_major[1] * new_minor[0] >= 0.0;
    if ratio > 1.0 {
        // Le grand axe devient normale × grand axe, à la longueur du petit.
        let z = if positive { 1.0 } else { -1.0 };
        new_major = [-z * new_major[1] * ratio, z * new_major[0] * ratio];
        ratio = 1.0 / ratio;
        if !(start == 0.0 && isclose(end, TAU, 0.0)) {
            start -= FRAC_PI_2;
            end -= FRAC_PI_2;
        }
    }
    start = start.rem_euclid(TAU);
    end = end.rem_euclid(TAU);
    if isclose(start, end, 0.0) {
        start = 0.0;
        end = TAU;
    } else if !positive {
        // (0,0,-1) → +Z : p(t) = c + cos t·M − sin t·N, soit t' = −t.
        (start, end) = ((-end).rem_euclid(TAU), (-start).rem_euclid(TAU));
    }
    Entity::Ellipse(entities::Ellipse {
        center: new_center,
        major: new_major,
        ratio: ratio.max(1e-6),
        start_param: start,
        end_param: end,
        common: common.clone(),
    })
}
