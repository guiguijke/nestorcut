//! Bounding box des entités placés — pour OUT_SHAPE (build_part).
//! Les courbes sont échantillonnées denses SUR la courbe (jamais à
//! l'extérieur), donc la bbox Rust sous-estime la bbox vraie d'ezdxf de
//! < sagitta(N) (~1e-3 mm ici) ; le comparateur DXF tolère 1e-2 mm sur
//! OUT_SHAPE (J-070). Les sommets droits sont exacts.

use crate::transform::Affine;
use nest_import::dxf::entities::{self, Entity};

pub type BBox = [f64; 4]; // minx, miny, maxx, maxy

fn add(b: &mut Option<BBox>, p: [f64; 2]) {
    *b = Some(match *b {
        None => [p[0], p[1], p[0], p[1]],
        Some(mut o) => {
            o[0] = o[0].min(p[0]);
            o[1] = o[1].min(p[1]);
            o[2] = o[2].max(p[0]);
            o[3] = o[3].max(p[1]);
            o
        }
    });
}

const CURVE_N: usize = 512;

/// Points extrêmes source-space d'une entité (échantillonnage dense).
fn entity_extrema(e: &Entity) -> Vec<[f64; 2]> {
    let mut v: Vec<[f64; 2]> = Vec::new();
    match e {
        Entity::Line(l) => {
            v.push(l.start);
            v.push(l.end);
        }
        Entity::Point(p) => v.push(p.at),
        Entity::LwPolyline(p) => polyline_extrema(&p.points, &p.bulges, p.closed, &mut v),
        Entity::Polyline(p) => polyline_extrema(&p.points, &p.bulges, p.closed, &mut v),
        Entity::Circle(c) => {
            for i in 0..CURVE_N {
                let a = i as f64 / CURVE_N as f64 * 2.0 * std::f64::consts::PI;
                v.push([c.center[0] + c.radius * libm::cos(a), c.center[1] + c.radius * libm::sin(a)]);
            }
        }
        Entity::Arc(a) => {
            let s = a.start_angle;
            let e2 = if a.end_angle <= s { a.end_angle + 360.0 } else { a.end_angle };
            for i in 0..=CURVE_N {
                let t = s + (e2 - s) * i as f64 / CURVE_N as f64;
                let rad = t * std::f64::consts::PI / 180.0;
                v.push([a.center[0] + a.radius * libm::cos(rad), a.center[1] + a.radius * libm::sin(rad)]);
            }
        }
        Entity::Ellipse(e) => {
            let a_mag = (e.major[0] * e.major[0] + e.major[1] * e.major[1]).sqrt();
            let b_mag = a_mag * e.ratio;
            let base = libm::atan2(e.major[1], e.major[0]);
            // Balayage vers l'avant : une fin <= début ferme le tour (ellipse partielle qui
            // franchit 0), sans toucher à l'ellipse pleine 0 -> TAU.
            let end = if e.end_param <= e.start_param {
                e.end_param + 2.0 * std::f64::consts::PI
            } else {
                e.end_param
            };
            for i in 0..=CURVE_N {
                let t = e.start_param + (end - e.start_param) * i as f64 / CURVE_N as f64;
                let lx = a_mag * libm::cos(t);
                let ly = b_mag * libm::sin(t);
                v.push([
                    e.center[0] + lx * libm::cos(base) - ly * libm::sin(base),
                    e.center[1] + lx * libm::sin(base) + ly * libm::cos(base),
                ]);
            }
        }
        Entity::Spline(sp) => v.extend(sp.control.iter().copied()),
        _ => {}
    }
    v
}

/// Sommets d'une polyligne (LWPOLYLINE ou POLYLINE 2D) et points de ses arcs. Le segment de
/// fermeture compte, avec le bulge du dernier sommet.
fn polyline_extrema(points: &[[f64; 2]], bulges: &[f64], closed: bool, v: &mut Vec<[f64; 2]>) {
    let n = points.len();
    if n == 0 {
        return;
    }
    let count = if closed { n } else { n - 1 };
    for i in 0..count {
        let a = points[i];
        let b = points[(i + 1) % n];
        let bulge = bulges.get(i).copied().unwrap_or(0.0);
        v.push(a);
        if bulge.abs() > 1e-12 {
            sample_bulge(a, b, bulge, v);
        }
    }
    if !closed {
        v.push(points[n - 1]);
    }
}

/// Points de l'arc d'un bulge entre `a` et `b`, extrema compris (0, 90, 180, 270 degrés
/// quand l'arc les traverse : une bbox ne doit rien sous-estimer).
///
/// Le rayon est pris en VALEUR ABSOLUE (piège 1 d'AGENTS.md) : `d / (2 sin(theta/2))` est
/// signé comme le bulge. Le centre est à gauche de la corde pour un bulge positif
/// (arc antihoraire), à droite pour un bulge négatif, et de l'autre côté de la corde quand
/// l'arc dépasse le demi-cercle : décalage `s * |r| * cos(theta/2)` le long de la normale gauche.
fn sample_bulge(a: [f64; 2], b: [f64; 2], bulge: f64, out: &mut Vec<[f64; 2]>) {
    let theta = 4.0 * libm::atan(bulge);
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let d = (dx * dx + dy * dy).sqrt();
    if d < 1e-12 || theta.abs() < 1e-12 {
        return;
    }
    let r = (d / (2.0 * libm::sin(theta / 2.0))).abs();
    let mx = (a[0] + b[0]) / 2.0;
    let my = (a[1] + b[1]) / 2.0;
    let off = bulge.signum() * r * libm::cos(theta / 2.0);
    let cx = mx - dy / d * off;
    let cy = my + dx / d * off;
    let a0 = libm::atan2(a[1] - cy, a[0] - cx);
    for i in 1..128 {
        let t = a0 + theta * i as f64 / 128.0;
        out.push([cx + r * libm::cos(t), cy + r * libm::sin(t)]);
    }
    // Extrema exacts : les angles multiples de 90 degrés dans le balayage [a0, a0 + theta].
    let (lo, hi) = if theta > 0.0 { (a0, a0 + theta) } else { (a0 + theta, a0) };
    let quarter = std::f64::consts::FRAC_PI_2;
    let mut k = libm::ceil(lo / quarter);
    while k * quarter <= hi {
        let t = k * quarter;
        out.push([cx + r * libm::cos(t), cy + r * libm::sin(t)]);
        k += 1.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nest_import::dxf::entities::{Common, LwPolyline, Polyline};

    // Valeurs de référence lues par ezdxf 1.4.4 (`ezdxf.bbox.extents`) sur les mêmes polylignes.
    fn lw(points: Vec<[f64; 2]>, bulges: Vec<f64>, closed: bool) -> Entity {
        Entity::LwPolyline(LwPolyline { points, bulges, closed, common: Common::default() })
    }

    fn bbox_of(e: Entity) -> BBox {
        entities_bbox(&[e], &[], &Affine::new(0.0, 0.0, 0.0, 1.0)).expect("bbox")
    }

    fn assert_close(got: BBox, want: BBox) {
        assert_within(got, want, 1e-9);
    }

    fn assert_within(got: BBox, want: BBox, tol: f64) {
        for i in 0..4 {
            assert!((got[i] - want[i]).abs() < tol, "{got:?} contre {want:?}");
        }
    }

    #[test]
    fn a_bulge_arc_is_framed_on_the_arc_not_around_a_mirrored_centre() {
        // Bulge 0,5 sur 100 mm : flèche 25, rayon 62,5, centre (50 ; 37,5).
        assert_close(bbox_of(lw(vec![[0.0, 0.0], [100.0, 0.0]], vec![0.5, 0.0], false)), [0.0, -25.0, 100.0, 0.0]);
        assert_close(bbox_of(lw(vec![[0.0, 0.0], [100.0, 0.0]], vec![-0.5, 0.0], false)), [0.0, 0.0, 100.0, 25.0]);
    }

    #[test]
    fn an_arc_beyond_a_half_circle_sticks_out_of_its_chord() {
        // Analytique : rayon 325/6, centre (50 ; -125/6), donc x de -25/6 à 100 + 25/6. ezdxf
        // rend -4,1705 : il approche l'arc par des Bézier, à 4e-3 mm près.
        let got = bbox_of(lw(vec![[0.0, 0.0], [100.0, 0.0]], vec![1.5, 0.0], false));
        assert_within(got, [-25.0 / 6.0, -75.0, 100.0 + 25.0 / 6.0, 0.0], 1e-9);
        assert_within(got, [-4.1705, -75.0, 104.1705, 0.0], 1e-2);
    }

    #[test]
    fn the_closing_segment_of_a_closed_polyline_counts() {
        let pts = vec![[0.0, 0.0], [100.0, 0.0], [100.0, 50.0], [0.0, 50.0]];
        assert_close(bbox_of(lw(pts.clone(), vec![0.5, 0.0, -0.5, 0.0], true)), [0.0, -25.0, 100.0, 50.0]);
        let classic = Entity::Polyline(Polyline {
            points: pts,
            bulges: vec![0.5, 0.0, -0.5, 0.0],
            closed: true,
            common: Common::default(),
            vertex_handles: vec![],
            seqend_handle: String::new(),
        });
        assert_close(bbox_of(classic), [0.0, -25.0, 100.0, 50.0]);
    }

    #[test]
    fn a_partial_ellipse_with_start_after_end_sweeps_forward() {
        // Balayage de 5,5 rad à 0,785 + TAU (arc de 90 degrés), pas l'arc complémentaire.
        // Référence ezdxf 1.4.4 : x de 7,0739 à 10,0 et y de -3,5277 à 3,5341.
        let e = Entity::Ellipse(nest_import::dxf::entities::Ellipse {
            center: [0.0, 0.0],
            major: [10.0, 0.0],
            ratio: 0.5,
            start_param: 5.5,
            end_param: 0.785,
            common: Common::default(),
        });
        assert_within(bbox_of(e), [7.0739, -3.5277, 10.0, 3.5341], 1e-2);
    }

    #[test]
    fn an_empty_polyline_has_no_bbox_and_no_panic() {
        assert!(entities_bbox(&[lw(vec![], vec![], false)], &[], &Affine::new(0.0, 0.0, 0.0, 1.0)).is_none());
    }
}

/// BBox des entités SOURCE transformés par `aff` (chaque point extrême).
pub fn entities_bbox(
    entities: &[entities::Entity],
    _blocks: &[entities::Block],
    aff: &Affine,
) -> Option<BBox> {
    let mut bb: Option<BBox> = None;
    for e in entities {
        for p in entity_extrema(e) {
            add(&mut bb, aff.apply(p));
        }
    }
    bb
}
