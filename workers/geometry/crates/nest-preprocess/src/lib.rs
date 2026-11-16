//! nest-preprocess — ouverture des trous par canal capillaire, jumeau de
//! workers/nesting/core/holed_polygons.py (jagua n'a pas de pièces à trous,
//! AGENTS #2). Deux implémentations prototypées (mission v2 PR2) :
//!
//!   (a) `open_holes_difference` — sémantique GEOS répliquée sur notre
//!       arrangement maison : rectangle buffer(width/2, cap=flat) le long du
//!       segment allongé ±2·width, UNE difference (union des rectangles),
//!       plus grand morceau si éclaté, fallback outer.
//!   (b) `open_holes_splice` — splice d'anneaux : coupure des deux anneaux
//!       aux points les plus proches, rails droits décalés de ±width/2 le
//!       long des tangentes. Arithmétique pure, zéro booléen.
//!
//! Le harnais (parity/channels.py) tranche sur parité + qualité ; le
//! gagnant est porté DES DEUX CÔTÉS (décision actée mission v2).

use nest_import::assemble as ga; // géométrie d'arrangement partagée

pub mod pinwheel; // J-090 — miroir de holefill.pinwheel_capacity (J-085)

#[cfg(feature = "wasm")]
mod wasm;

pub type Pt = [f64; 2];

/// holed_polygons.CHANNEL_WIDTH / SEPARATION_MARGIN / MAX_WIDTH.
pub const CHANNEL_WIDTH: f64 = 0.01;
pub const CHANNEL_SEPARATION_MARGIN: f64 = 0.1;
pub const CHANNEL_MAX_WIDTH: f64 = 2.5;

/// channel_width_for_space twin.
pub fn channel_width_for_space(space: f64) -> f64 {
    let space = if space.is_nan() { 0.0 } else { space };
    CHANNEL_WIDTH.max(space + CHANNEL_SEPARATION_MARGIN).min(CHANNEL_MAX_WIDTH)
}

/// channels_usable twin (D-MOT-2 : scellé ⇒ trous fermés, dégradation sûre).
pub fn channels_usable(space: f64) -> bool {
    channel_width_for_space(space) > space
}

// ------------------------------------------------------- nearest points

/// LineSegment.closestPoint twin: projection clampée aux extrémités
/// (r ≤ 0 → p0, r ≥ 1 → p1, l'ordre des tests compte comme chez GEOS).
fn closest_point_on_seg(p: Pt, a: Pt, b: Pt) -> Pt {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let len2 = dx * dx + dy * dy;
    if len2 == 0.0 {
        return a;
    }
    let r = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    if r <= 0.0 {
        return a;
    }
    if r >= 1.0 {
        return b;
    }
    [a[0] + r * dx, a[1] + r * dy]
}

fn dist(a: Pt, b: Pt) -> f64 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    (dx * dx + dy * dy).sqrt()
}

/// nearest_points(hole.exterior, poly.exterior) twin : double boucle
/// segments (ordre des anneaux), mise à jour STRICTE (<) — le premier
/// couple à distance minimale gagne, comme GEOS DistanceOp.
/// Retourne (point sur le trou, point sur l'extérieur).
pub fn nearest_points(hole_ring: &[Pt], outer_ring: &[Pt]) -> Option<(Pt, Pt)> {
    let mut best: Option<(f64, Pt, Pt)> = None;
    let nh = hole_ring.len();
    let no = outer_ring.len();
    if nh < 2 || no < 2 {
        return None;
    }
    // Élagage sans effet sur le résultat (R3.4, coût) : un segment de l'extérieur
    // dont la boîte est plus loin de la boîte du trou que ne l'est un candidat
    // DÉJÀ calculé (hole_ring[0] contre tout l'extérieur) ne peut ni gagner ni
    // égaler le minimum ; les autres sont parcourus dans le même ordre, avec la
    // même mise à jour stricte.
    let hb_box = bbox_of(hole_ring);
    let seg_gap = |oa: Pt, ob: Pt| -> f64 {
        let gx = (hb_box[0] - oa[0].max(ob[0])).max(oa[0].min(ob[0]) - hb_box[2]).max(0.0);
        let gy = (hb_box[1] - oa[1].max(ob[1])).max(oa[1].min(ob[1]) - hb_box[3]).max(0.0);
        (gx * gx + gy * gy).sqrt()
    };
    // Une seule passe : `upper` (plus petite distance de hole_ring[0] à un
    // segment, donc un majorant du minimum final) ne descend que sur les
    // segments dont la boîte n'est pas déjà plus loin que lui ; les autres ne
    // peuvent figurer ni dans le résultat ni dans la liste finale.
    let mut upper = f64::INFINITY;
    let mut cand: Vec<(usize, f64)> = Vec::new();
    for j in 0..no {
        let (oa, ob) = (outer_ring[j], outer_ring[(j + 1) % no]);
        let g = seg_gap(oa, ob);
        if g > upper + 1e-9 * (upper + 1.0) {
            continue;
        }
        upper = upper.min(dist(hole_ring[0], closest_point_on_seg(hole_ring[0], oa, ob)));
        cand.push((j, g));
    }
    let reach = upper + 1e-9 * (upper + 1.0);
    let near_outer: Vec<usize> = cand.into_iter().filter(|&(_, g)| g <= reach).map(|(j, _)| j).collect();
    for i in 0..nh {
        let ha = hole_ring[i];
        let hb = hole_ring[(i + 1) % nh];
        for &j in &near_outer {
            let oa = outer_ring[j];
            let ob = outer_ring[(j + 1) % no];
            // Candidats (point sur trou, point sur ext) — ordre GEOS :
            // endpoints du trou projetés, puis endpoints de l'extérieur.
            let cands = [
                (ha, closest_point_on_seg(ha, oa, ob)),
                (hb, closest_point_on_seg(hb, oa, ob)),
            ];
            for (on_hole, on_outer) in cands {
                let d = dist(on_hole, on_outer);
                if best.map(|(bd, _, _)| d < bd).unwrap_or(true) {
                    best = Some((d, on_hole, on_outer));
                }
            }
            let cands2 = [
                (oa, closest_point_on_seg(oa, ha, hb)),
                (ob, closest_point_on_seg(ob, ha, hb)),
            ];
            for (on_outer, on_hole) in cands2 {
                let d = dist(on_hole, on_outer);
                if best.map(|(bd, _, _)| d < bd).unwrap_or(true) {
                    best = Some((d, on_hole, on_outer));
                }
            }
        }
    }
    best.map(|(_, ph, po)| (ph, po))
}

/// Rectangle GEOS buffer(width/2, cap=flat) du segment allongé de ±2·width.
/// Anneau fermé (premier == dernier), 5 points.
fn channel_rectangle(p_in: Pt, p_out: Pt, width: f64) -> Option<Vec<Pt>> {
    let dx = p_out[0] - p_in[0];
    let dy = p_out[1] - p_in[1];
    let length = (dx * dx + dy * dy).sqrt();
    if length < 1e-9 {
        return None;
    }
    let ux = dx / length;
    let uy = dy / length;
    let ext = width * 2.0;
    let s = [p_in[0] - ux * ext, p_in[1] - uy * ext];
    let e = [p_out[0] + ux * ext, p_out[1] + uy * ext];
    // Normale gauche du segment s→e, demi-largeur.
    let nx = -uy * (width / 2.0);
    let ny = ux * (width / 2.0);
    Some(vec![
        [s[0] + nx, s[1] + ny],
        [e[0] + nx, e[1] + ny],
        [e[0] - nx, e[1] - ny],
        [s[0] - nx, s[1] - ny],
        [s[0] + nx, s[1] + ny],
    ])
}

// ------------------------------------------------- (a) différence GEOS

// Règles H0-H3 (jumeau de holed_polygons.py ; spécification SPEC_H) : un trou
// n'est ouvert que si son canal est inoffensif, sinon il reste fermé (le
// moteur voit de la matière pleine, toujours sûr). Mêmes noms, mêmes valeurs.
/// H0 : un trou dont le petit côté de boîte est <= 2·width reste fermé.
pub const SMALL_HOLE_FACTOR: f64 = 2.0;
/// H0 : canal plus court que cela (trou collé à l'extérieur) = fermé.
pub const FLUSH_MIN: f64 = 0.01;
/// H1 : distance (mm) en deçà de laquelle deux canaux / trous sont en conflit.
pub const CONFLICT_TOL: f64 = 0.01;
/// H2 : un canal n'efface de la matière que jusqu'à DEPTH_FACTOR·width de ce
/// qui reste ; la grille d'échantillons a un pas de width / DEPTH_GRID.
pub const DEPTH_FACTOR: f64 = 0.55;
pub const DEPTH_GRID: usize = 8;
/// H2 : plafond du nombre de pas le long de l'axe du canal (canaux très longs).
pub const DEPTH_MAX_STEPS: usize = 4096;
/// H3 : aire (mm²) des morceaux qu'on peut abandonner si le résultat éclate.
pub const SLIVER_MAX_MM2: f64 = 0.05;
/// R3.1 : un trou de moins de 3 sommets distincts ou d'aire (valeur absolue)
/// <= cette valeur (mm2) est dégénéré : fermé « small », jamais construit.
pub const DEGENERATE_HOLE_MM2: f64 = 1e-9;

/// Décision par trou (jumeau de plan_channels Python).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChannelDecision {
    Open,
    Small,
    Flush,
    Conflict,
    Deep,
}

impl ChannelDecision {
    /// Nom stable (identique aux chaînes Python).
    pub fn name(self) -> &'static str {
        match self {
            ChannelDecision::Open => "open",
            ChannelDecision::Small => "small",
            ChannelDecision::Flush => "flush",
            ChannelDecision::Conflict => "conflict",
            ChannelDecision::Deep => "deep",
        }
    }
}

type Bbox = [f64; 4]; // minx, miny, maxx, maxy

fn bbox_of(ring: &[Pt]) -> Bbox {
    let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for p in ring {
        b[0] = b[0].min(p[0]);
        b[1] = b[1].min(p[1]);
        b[2] = b[2].max(p[0]);
        b[3] = b[3].max(p[1]);
    }
    b
}

/// Les deux boîtes, élargies de `tol`, se recouvrent-elles ?
fn bbox_near(a: &Bbox, b: &Bbox, tol: f64) -> bool {
    a[0] <= b[2] + tol && b[0] <= a[2] + tol && a[1] <= b[3] + tol && b[1] <= a[3] + tol
}

fn orient(a: Pt, b: Pt, c: Pt) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/// c (colinéaire avec a-b) est-il dans la boîte du segment a-b ?
fn in_seg_box(a: Pt, b: Pt, c: Pt) -> bool {
    c[0] >= a[0].min(b[0]) && c[0] <= a[0].max(b[0]) && c[1] >= a[1].min(b[1]) && c[1] <= a[1].max(b[1])
}

/// Les segments se touchent-ils (croisement, contact ou recouvrement) ?
fn segs_touch(a1: Pt, a2: Pt, b1: Pt, b2: Pt) -> bool {
    let d1 = orient(b1, b2, a1);
    let d2 = orient(b1, b2, a2);
    let d3 = orient(a1, a2, b1);
    let d4 = orient(a1, a2, b2);
    if ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0))
        && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
    {
        return true;
    }
    (d1 == 0.0 && in_seg_box(b1, b2, a1))
        || (d2 == 0.0 && in_seg_box(b1, b2, a2))
        || (d3 == 0.0 && in_seg_box(a1, a2, b1))
        || (d4 == 0.0 && in_seg_box(a1, a2, b2))
}

fn dist_pt_seg(p: Pt, a: Pt, b: Pt) -> f64 {
    dist(p, closest_point_on_seg(p, a, b))
}

fn dist_seg_seg(a1: Pt, a2: Pt, b1: Pt, b2: Pt) -> f64 {
    if segs_touch(a1, a2, b1, b2) {
        return 0.0;
    }
    dist_pt_seg(a1, b1, b2)
        .min(dist_pt_seg(a2, b1, b2))
        .min(dist_pt_seg(b1, a1, a2))
        .min(dist_pt_seg(b2, a1, a2))
}

fn ring_segments(ring: &[Pt]) -> Vec<(Pt, Pt)> {
    let n = ring.len();
    (0..n).map(|i| (ring[i], ring[(i + 1) % n])).collect()
}

/// Les polygones PLEINS `a` et `b` sont-ils à distance <= tol ? Distance
/// nulle si les contours se coupent ou si l'un contient l'autre, sinon la
/// plus petite distance contour à contour (boîtes englobantes d'abord).
fn filled_within(a: &[Pt], b: &[Pt], tol: f64) -> bool {
    let (ba, bb) = (bbox_of(a), bbox_of(b));
    if !bbox_near(&ba, &bb, tol) {
        return false;
    }
    let sa: Vec<(Pt, Pt)> = ring_segments(a)
        .into_iter()
        .filter(|(p, q)| bbox_near(&bbox_of(&[*p, *q]), &bb, tol))
        .collect();
    let sb: Vec<(Pt, Pt)> = ring_segments(b)
        .into_iter()
        .filter(|(p, q)| bbox_near(&bbox_of(&[*p, *q]), &ba, tol))
        .collect();
    for (a1, a2) in &sa {
        let box_a = bbox_of(&[*a1, *a2]);
        for (b1, b2) in &sb {
            if bbox_near(&box_a, &bbox_of(&[*b1, *b2]), tol) && dist_seg_seg(*a1, *a2, *b1, *b2) <= tol {
                return true;
            }
        }
    }
    // Aucun contour à portée : reste le cas « l'un dans l'autre ».
    ga::point_in_ring(a[0], b) || ga::point_in_ring(b[0], a)
}

/// q est-il exactement sur le contour (contains_xy de shapely l'exclut : un
/// échantillon posé pile sur le bord d'un trou ou de l'extérieur n'est pas
/// dans la matière) ?
fn on_ring_boundary(q: Pt, ring: &[Pt]) -> bool {
    ring_segments(ring)
        .into_iter()
        .any(|(a, b)| orient(a, b, q) == 0.0 && in_seg_box(a, b, q))
}

/// Face de l'arrangement, avec sa sonde et son classement.
struct Face {
    ring: Vec<Pt>,
    #[allow(dead_code)]
    probe: Pt,
    /// Profondeur impaire sur (extérieur + trous donnés) : de la matière.
    odd: bool,
    /// Sonde dans l'un des rectangles de canal.
    in_rect: bool,
}

type Key = (u64, u64);

fn key(p: Pt) -> Key {
    (p[0].to_bits(), p[1].to_bits())
}

// Pannes injectables, pour les tests seulement : elles simulent un
// arrangement qui perd une arête, un anneau final faux, et comptent les
// échantillons de grille de H2. Rien de cela n'existe en production.
#[cfg(test)]
thread_local! {
    static DROP_NODED_EDGE: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
    static FORCE_RING: std::cell::RefCell<Option<Vec<Pt>>> = const { std::cell::RefCell::new(None) };
    static GRID_SAMPLES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

fn intern(
    p: Pt,
    ids: &mut std::collections::HashMap<Key, usize>,
    verts: &mut Vec<Pt>,
    adj: &mut Vec<Vec<usize>>,
) -> usize {
    *ids.entry(key(p)).or_insert_with(|| {
        verts.push(p);
        adj.push(Vec::new());
        verts.len() - 1
    })
}

/// Faces minimales d'un ensemble de segments déjà nodés (règle de la face
/// de gauche), même parcours que `ga::polygonize` avec UNE différence : la
/// borne de longueur d'un parcours est le nombre d'arêtes orientées, pas
/// `sommets + 2`. Une face peut repasser deux fois par un sommet de degré 4
/// (bande en C autour d'un trou ouvert) : sur un petit arrangement elle
/// dépasse alors `sommets + 2` et `ga::polygonize` la jetait en silence
/// (fuzz F2 : « aucune face de matière », trou déclaré trop profond).
/// Retourne tous les cycles (aires positives = faces, négatives = bords
/// extérieurs) et un drapeau d'intégrité : faux si une arête a le MÊME cycle
/// de chaque côté (arête pendante ou pont) ou si un parcours ne se referme pas.
fn polygonize_local(segments: &[(Pt, Pt)]) -> (Vec<Vec<Pt>>, bool) {
    use std::collections::HashMap;
    let mut ids: HashMap<Key, usize> = HashMap::new();
    let mut verts: Vec<Pt> = Vec::new();
    let mut adj: Vec<Vec<usize>> = Vec::new();
    let mut edge_list: Vec<(usize, usize)> = Vec::with_capacity(segments.len());
    for &(a, b) in segments {
        let ia = intern(a, &mut ids, &mut verts, &mut adj);
        let ib = intern(b, &mut ids, &mut verts, &mut adj);
        if ia == ib {
            continue;
        }
        if !adj[ia].contains(&ib) {
            adj[ia].push(ib);
        }
        if !adj[ib].contains(&ia) {
            adj[ib].push(ia);
        }
        edge_list.push((ia, ib));
    }
    for (i, nbrs) in adj.iter_mut().enumerate() {
        let c = verts[i];
        nbrs.sort_by(|&x, &y| {
            let ax = libm::atan2(verts[x][1] - c[1], verts[x][0] - c[0]);
            let ay = libm::atan2(verts[y][1] - c[1], verts[y][0] - c[0]);
            ax.total_cmp(&ay)
        });
    }
    let cap = 2 * edge_list.len() + 2;
    let mut owner: HashMap<(usize, usize), usize> = HashMap::with_capacity(2 * edge_list.len());
    let mut cycles: Vec<Vec<Pt>> = Vec::new();
    let mut ok = true;
    for &(ia, ib) in &edge_list {
        for (from, to) in [(ia, ib), (ib, ia)] {
            if owner.contains_key(&(from, to)) {
                continue;
            }
            let id = cycles.len();
            let mut face: Vec<Pt> = Vec::new();
            let (mut cf, mut ct) = (from, to);
            loop {
                if owner.contains_key(&(cf, ct)) {
                    ok = false; // ne peut pas arriver : le parcours est une permutation
                    break;
                }
                owner.insert((cf, ct), id);
                face.push(verts[cf]);
                let nbrs = &adj[ct];
                let Some(pos) = nbrs.iter().position(|&x| x == cf) else {
                    ok = false;
                    break;
                };
                let next = nbrs[(pos + nbrs.len() - 1) % nbrs.len()];
                cf = ct;
                ct = next;
                if cf == from && ct == to {
                    break;
                }
                if face.len() > cap {
                    ok = false;
                    break;
                }
            }
            cycles.push(face);
        }
    }
    if ok {
        ok = edge_list.iter().all(|&(a, b)| owner.get(&(a, b)) != owner.get(&(b, a)));
    }
    (cycles, ok)
}

/// Distance (mm) sous laquelle deux sommets nodés sont le même point.
const SNAP_EPS_MM: f64 = 1e-9;

/// Nettoyage du nodage au bruit flottant, avant le parcours des faces :
/// 1. deux points de coupe distincts à quelques ulp l'un de l'autre (un
///    sommet posé presque exactement sur le côté d'un rectangle : le point
///    d'intersection calculé tombe à 1 ulp du sommet) laissent une
///    micro-arête que le parcours voit comme une arête pendante : les
///    sommets à moins de `eps` d'un sommet déjà vu sont ramenés à lui ;
/// 2. un sommet à moins de `eps` de l'intérieur d'une arête (côtés presque
///    colinéaires : le test exact de nodage les croit distincts) coupe cette
///    arête ; sans cela deux arêtes quasi superposées ne partagent aucun
///    sommet et les faces entre elles se perdent.
/// Les arêtes réduites à un point disparaissent. Ordre de rencontre et
/// tris : déterministes.
fn snap_close_vertices(segs: Vec<(Pt, Pt)>, eps: f64) -> (Vec<(Pt, Pt)>, std::collections::HashMap<Key, Pt>) {
    use std::collections::HashMap;
    let mut cells: HashMap<(i64, i64), Vec<Pt>> = HashMap::new();
    let mut memo: HashMap<Key, Pt> = HashMap::new();
    let mut snap = |p: Pt| -> Pt {
        if let Some(&q) = memo.get(&key(p)) {
            return q;
        }
        let (cx, cy) = ((p[0] / eps).floor() as i64, (p[1] / eps).floor() as i64);
        let mut found: Option<Pt> = None;
        'search: for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(v) = cells.get(&(cx + dx, cy + dy)) {
                    for &q in v {
                        if (q[0] - p[0]).abs() <= eps && (q[1] - p[1]).abs() <= eps {
                            found = Some(q);
                            break 'search;
                        }
                    }
                }
            }
        }
        let q = found.unwrap_or_else(|| {
            cells.entry((cx, cy)).or_default().push(p);
            p
        });
        memo.insert(key(p), q);
        q
    };
    let snapped: Vec<(Pt, Pt)> = segs
        .into_iter()
        .map(|(a, b)| (snap(a), snap(b)))
        .filter(|(a, b)| a != b)
        .collect();
    // Phase 2 : sommets sur l'intérieur d'une arête, à eps près.
    let mut verts: Vec<Pt> = cells.into_values().flatten().collect();
    verts.sort_by(|p, q| p[0].total_cmp(&q[0]).then(p[1].total_cmp(&q[1])));
    let mut out: Vec<(Pt, Pt)> = Vec::with_capacity(snapped.len());
    for (a, b) in snapped {
        let (lo, hi) = (a[0].min(b[0]) - eps, a[0].max(b[0]) + eps);
        let (ylo, yhi) = (a[1].min(b[1]) - eps, a[1].max(b[1]) + eps);
        let start = verts.partition_point(|p| p[0] < lo);
        let mut on: Vec<(f64, Pt)> = Vec::new();
        for &p in &verts[start..] {
            if p[0] > hi {
                break;
            }
            if p[1] < ylo || p[1] > yhi || p == a || p == b {
                continue;
            }
            if dist_pt_seg(p, a, b) <= eps {
                let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
                let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
                if t > 0.0 && t < 1.0 {
                    on.push((t, p));
                }
            }
        }
        if on.is_empty() {
            out.push((a, b));
            continue;
        }
        on.sort_by(|x, y| x.0.total_cmp(&y.0));
        let mut prev = a;
        for (_, p) in on {
            if p != prev {
                out.push((prev, p));
                prev = p;
            }
        }
        if prev != b {
            out.push((prev, b));
        }
    }
    (out, memo)
}

/// Chaque segment d'ENTREE (avant nodage) est-il recouvert, sans trou, par
/// des arêtes du graphe nodé ? C'est ce qui attrape une arête perdue : un
/// graphe auquel il manque une arête reste un graphe plan valide (deux faces
/// fusionnent, aucune arête pendante), seul le recoupement avec les entrées
/// la montre. Les sommets du graphe à moins de eps du segment, triés le long
/// du segment, doivent se suivre par des arêtes du graphe.
fn covers_inputs(
    inputs: &[(Pt, Pt)],
    memo: &std::collections::HashMap<Key, Pt>,
    graph: &[(Pt, Pt)],
    eps: f64,
) -> bool {
    let ordered = |a: Pt, b: Pt| {
        let (ka, kb) = (key(a), key(b));
        if ka <= kb { (ka, kb) } else { (kb, ka) }
    };
    let eset: std::collections::HashSet<(Key, Key)> = graph.iter().map(|&(a, b)| ordered(a, b)).collect();
    let mut verts: Vec<Pt> = graph.iter().flat_map(|&(a, b)| [a, b]).collect();
    verts.sort_by(|p, q| p[0].total_cmp(&q[0]).then(p[1].total_cmp(&q[1])));
    verts.dedup();
    let tol = eps;
    for &(a0, b0) in inputs {
        if a0 == b0 {
            continue;
        }
        let (Some(&a), Some(&b)) = (memo.get(&key(a0)), memo.get(&key(b0))) else {
            return false;
        };
        if a == b {
            continue;
        }
        let (lo, hi) = (a[0].min(b[0]) - tol, a[0].max(b[0]) + tol);
        let (ylo, yhi) = (a[1].min(b[1]) - tol, a[1].max(b[1]) + tol);
        let start = verts.partition_point(|p| p[0] < lo);
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let mut chain: Vec<(f64, Pt)> = Vec::new();
        for &p in &verts[start..] {
            if p[0] > hi {
                break;
            }
            if p[1] < ylo || p[1] > yhi || p == a || p == b {
                continue;
            }
            if dist_pt_seg(p, a, b) <= tol {
                let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
                if t > 0.0 && t < 1.0 {
                    chain.push((t, p));
                }
            }
        }
        chain.sort_by(|x, y| x.0.total_cmp(&y.0));
        let mut prev = a;
        for (_, p) in chain.into_iter().chain(std::iter::once((1.0, b))) {
            if !eset.contains(&ordered(prev, p)) {
                return false;
            }
            prev = p;
        }
    }
    true
}

/// Arrangement CONTRÔLÉ (R3.3) : nodage, faces, puis intégrité. Rend les
/// faces d'aire positive, ou None si l'arrangement ne tient pas :
/// - une arête a la même face de chaque côté, ou un parcours ne se referme
///   pas (frontière perdue, arête pendante) ;
/// - une arête d'entrée n'est pas entièrement recouverte par le graphe nodé
///   (arête perdue : le graphe reste plan et valide, deux faces fusionnent) ;
/// - il n'y a pas exactement UN bord extérieur (arrangement non connexe) ;
/// - les faces ne couvrent pas l'aire de ce bord extérieur (1e-9 relatif).
/// Le contrôle porte sur la structure de l'arrangement, pas sur les
/// décisions : sur un arrangement sain il ne répond jamais None.
fn arrange(edges: &[(Pt, Pt)]) -> Option<Vec<Vec<Pt>>> {
    #[allow(unused_mut)]
    let mut noded = ga::node_segments(edges);
    #[cfg(test)]
    {
        if let Some(k) = DROP_NODED_EDGE.with(|c| c.take()) {
            if !noded.is_empty() {
                let n = noded.len();
                noded.remove(k % n);
            }
        }
    }
    let (noded, memo) = snap_close_vertices(noded, SNAP_EPS_MM);
    if !covers_inputs(edges, &memo, &noded, SNAP_EPS_MM) {
        return None;
    }
    let (cycles, ok) = polygonize_local(&noded);
    if !integrity_ok(ok, &cycles) {
        return None;
    }
    Some(
        cycles
            .into_iter()
            .filter(|c| ga::ring_signed_area(c) > 1e-12)
            .collect(),
    )
}

/// Le contrôle d'intégrité proprement dit (voir `arrange`).
fn integrity_ok(walk_ok: bool, cycles: &[Vec<Pt>]) -> bool {
    if !walk_ok {
        return false;
    }
    let areas: Vec<f64> = cycles.iter().map(|c| ga::ring_signed_area(c)).collect();
    let negatives: Vec<f64> = areas.iter().copied().filter(|&a| a < -1e-12).collect();
    if negatives.len() != 1 {
        return false;
    }
    let outer_area = -negatives[0];
    let positive_sum: f64 = areas.iter().copied().filter(|&a| a > 1e-12).sum();
    (positive_sum - outer_area).abs() <= 1e-9 * outer_area + 1e-9
}

/// Index par tranches horizontales de l'anneau externe (construit une fois par
/// appel) : test point-dans-anneau et arêtes d'une boîte sans parcourir tout
/// l'anneau. `contains` applique la MEME formule que `ga::point_in_ring` aux
/// seules arêtes qui peuvent croiser l'horizontale du point : même résultat.
/// Plafond de l'index par tranches : entrées par sommet de l'anneau.
const SLAB_BUDGET_PER_VERTEX: usize = 8;

struct OuterIndex<'a> {
    ring: &'a [Pt],
    bbox: Bbox,
    y0: f64,
    inv: f64,
    slabs: Vec<Vec<u32>>,
}

impl<'a> OuterIndex<'a> {
    fn new(ring: &'a [Pt]) -> Self {
        let bbox = bbox_of(ring);
        let n = ring.len();
        let h = bbox[3] - bbox[1];
        // Nombre de tranches : n/16, divisé par deux tant que l'index
        // dépasserait SLAB_BUDGET entrées. Une arête figure dans chaque
        // tranche qu'elle traverse : sur un contour en peigne (50 000 sommets,
        // chaque arête sur toute la hauteur) n/16 tranches donnaient
        // 130 millions d'entrées, 520 Mo. Moins de tranches ne change aucune
        // réponse : une tranche contient toujours toutes les arêtes qui
        // peuvent croiser l'horizontale d'un de ses points.
        let budget = SLAB_BUDGET_PER_VERTEX * n + 1024;
        let mut nslab = (n / 16).clamp(1, 1 << 16);
        let mut inv: f64;
        loop {
            inv = if h > 0.0 && h.is_finite() { nslab as f64 / h } else { 0.0 };
            if nslab == 1 {
                break;
            }
            let slab_of = |y: f64| (((y - bbox[1]) * inv).floor().max(0.0) as usize).min(nslab - 1);
            let mut entries = 0usize;
            for i in 0..n {
                let (a, b) = (ring[i], ring[(i + 1) % n]);
                if a != b {
                    entries += slab_of(a[1].max(b[1])) - slab_of(a[1].min(b[1])) + 1;
                }
            }
            if entries <= budget {
                break;
            }
            nslab /= 2;
        }
        let mut slabs: Vec<Vec<u32>> = vec![Vec::new(); nslab];
        let slab_of = |y: f64| (((y - bbox[1]) * inv).floor().max(0.0) as usize).min(nslab - 1);
        for i in 0..n {
            let (a, b) = (ring[i], ring[(i + 1) % n]);
            if a == b {
                continue;
            }
            let (s0, s1) = (slab_of(a[1].min(b[1])), slab_of(a[1].max(b[1])));
            for slab in &mut slabs[s0..=s1] {
                slab.push(i as u32);
            }
        }
        OuterIndex { ring, bbox, y0: bbox[1], inv, slabs }
    }

    fn slab_of(&self, y: f64) -> usize {
        (((y - self.y0) * self.inv).floor().max(0.0) as usize).min(self.slabs.len() - 1)
    }

    /// Même réponse que `ga::point_in_ring(p, ring)`.
    fn contains(&self, p: Pt) -> bool {
        if !(p[1] >= self.bbox[1] && p[1] <= self.bbox[3]) {
            return false;
        }
        let n = self.ring.len();
        let mut inside = false;
        for &i in &self.slabs[self.slab_of(p[1])] {
            let a = self.ring[i as usize];
            let b = self.ring[(i as usize + 1) % n];
            if (a[1] > p[1]) != (b[1] > p[1]) {
                let x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
                if p[0] < x {
                    inside = !inside;
                }
            }
        }
        inside
    }

    /// Indices (croissants) des arêtes dont la bande horizontale touche la boîte.
    fn edges_near(&self, bx: &Bbox) -> Vec<usize> {
        if bx[3] < self.bbox[1] || bx[1] > self.bbox[3] {
            return Vec::new();
        }
        let (s0, s1) = (self.slab_of(bx[1]), self.slab_of(bx[3]));
        let mut ids: Vec<usize> = Vec::new();
        for slab in &self.slabs[s0..=s1] {
            ids.extend(slab.iter().map(|&i| i as usize));
        }
        ids.sort_unstable();
        ids.dedup();
        ids
    }

    fn edge(&self, i: usize) -> (Pt, Pt) {
        (self.ring[i], self.ring[(i + 1) % self.ring.len()])
    }
}

/// Classe les faces par parité de profondeur sur (extérieur + trous donnés)
/// et appartenance aux rectangles, avec des tests point-dans-anneau sur les
/// anneaux COMPLETS. Sonde DE FACE (ga::face_probes) : sur une paroi fine, le
/// pas de bissectrice de interior_probe sortait de la face.
fn classify(cycles: Vec<Vec<Pt>>, outer: &OuterIndex, holes: &[&[Pt]], rects: &[&[Pt]]) -> Vec<Face> {
    let probes = ga::face_probes(&cycles);
    let mut out = Vec::with_capacity(cycles.len());
    for (f, &probe) in cycles.into_iter().zip(&probes) {
        let mut depth = 0usize;
        if outer.contains(probe) {
            depth += 1;
        }
        for h in holes {
            if ga::point_in_ring(probe, h) {
                depth += 1;
            }
        }
        let in_rect = rects.iter().any(|r| ga::point_in_ring(probe, r));
        out.push(Face { ring: f, probe, odd: depth % 2 == 1, in_rect });
    }
    out
}

/// Coupe le segment a-b à la boîte fermée `bx` (Liang-Barsky). Les extrémités
/// coupées sont posées EXACTEMENT sur le bord de la boîte (la coordonnée
/// d'axe est écrasée par celle du bord), pour que le nodage les voie sur
/// l'arête du cadre.
fn clip_seg_to_box(a: Pt, b: Pt, bx: &Bbox) -> Option<(Pt, Pt)> {
    let inside = |p: Pt| p[0] >= bx[0] && p[0] <= bx[2] && p[1] >= bx[1] && p[1] <= bx[3];
    if inside(a) && inside(b) {
        return Some((a, b));
    }
    let d = [b[0] - a[0], b[1] - a[1]];
    let (mut t0, mut t1) = (0.0f64, 1.0f64);
    let mut s0: Option<(usize, f64)> = None;
    let mut s1: Option<(usize, f64)> = None;
    for ax in 0..2 {
        let (lo, hi) = (bx[ax], bx[ax + 2]);
        if d[ax] == 0.0 {
            if a[ax] < lo || a[ax] > hi {
                return None;
            }
            continue;
        }
        let mut ta = (lo - a[ax]) / d[ax];
        let mut tb = (hi - a[ax]) / d[ax];
        let (mut va, mut vb) = (lo, hi);
        if ta > tb {
            std::mem::swap(&mut ta, &mut tb);
            std::mem::swap(&mut va, &mut vb);
        }
        if ta > t0 {
            t0 = ta;
            s0 = Some((ax, va));
        }
        if tb < t1 {
            t1 = tb;
            s1 = Some((ax, vb));
        }
        if t0 > t1 {
            return None;
        }
    }
    let end = |t: f64, s: Option<(usize, f64)>| -> Pt {
        let Some((ax, v)) = s else {
            return if t == 0.0 { a } else { b };
        };
        let mut p = [a[0] + t * d[0], a[1] + t * d[1]];
        p[ax] = v;
        p[0] = p[0].clamp(bx[0], bx[2]);
        p[1] = p[1].clamp(bx[1], bx[3]);
        p
    };
    Some((end(t0, s0), end(t1, s1)))
}

/// Arrangement LOCAL de H2 (R3.4) : la fenêtre est la boîte du rectangle
/// élargie de `width` ; on y garde les arêtes de l'extérieur et du trou
/// coupées à la fenêtre, le rectangle et le cadre de la fenêtre. Les faces
/// partitionnent la fenêtre (contrôle d'intégrité de `arrange`) ; le
/// classement se fait sur les anneaux complets. Les échantillons de H2 sont
/// dans le rectangle, donc à au moins `width` du cadre : rien de ce qui est
/// retenu (à <= DEPTH_FACTOR·width) n'est touché par le cadre. Si l'anneau
/// externe tient tout entier dans la fenêtre, on n'ajoute pas de cadre (il
/// ne toucherait aucune arête) et l'arrangement est celui de la pièce.
fn local_faces(outer: &OuterIndex, hole: &[Pt], rect: &[Pt], width: f64) -> Option<Vec<Face>> {
    let rb = bbox_of(rect);
    let fr: Bbox = [rb[0] - width, rb[1] - width, rb[2] + width, rb[3] + width];
    let ob = outer.bbox;
    let whole = ob[0] >= fr[0] && ob[1] >= fr[1] && ob[2] <= fr[2] && ob[3] <= fr[3];
    let mut edges: Vec<(Pt, Pt)> = Vec::new();
    let push_clipped = |a: Pt, b: Pt, edges: &mut Vec<(Pt, Pt)>| {
        if a == b {
            return;
        }
        if whole {
            edges.push((a, b));
        } else if bbox_near(&bbox_of(&[a, b]), &fr, 0.0) {
            if let Some((p, q)) = clip_seg_to_box(a, b, &fr) {
                if p != q {
                    edges.push((p, q));
                }
            }
        }
    };
    if whole {
        for i in 0..outer.ring.len() {
            let (a, b) = outer.edge(i);
            push_clipped(a, b, &mut edges);
        }
    } else {
        for i in outer.edges_near(&fr) {
            let (a, b) = outer.edge(i);
            push_clipped(a, b, &mut edges);
        }
    }
    for w in hole.windows(2) {
        push_clipped(w[0], w[1], &mut edges);
    }
    for w in rect.windows(2) {
        if w[0] != w[1] {
            edges.push((w[0], w[1]));
        }
    }
    if !whole {
        let c = [[fr[0], fr[1]], [fr[2], fr[1]], [fr[2], fr[3]], [fr[0], fr[3]]];
        for k in 0..4 {
            edges.push((c[k], c[(k + 1) % 4]));
        }
    }
    let cycles = arrange(&edges)?;
    Some(classify(cycles, outer, &[hole], &[rect]))
}

/// Un échantillon de la grille compte-t-il ? Oui s'il est STRICTEMENT dans
/// une face de matière du rectangle (un point posé sur un contour n'est pas
/// dans la matière : contains_xy de shapely l'exclut).
fn grid_sample_counts(q: Pt, lost: &[(&Face, Bbox)]) -> bool {
    lost.iter().any(|(f, b)| {
        q[0] >= b[0]
            && q[0] <= b[2]
            && q[1] >= b[1]
            && q[1] <= b[3]
            && ga::point_in_ring(q, &f.ring)
            && !on_ring_boundary(q, &f.ring)
    })
}

/// H2 : ouvrir CE trou seul efface-t-il de la matière trop loin de ce qui
/// reste ? Matière = extérieur moins ce trou (les autres comptent pleins) ;
/// reste = matière moins le rectangle ; échantillons dans le repère du
/// rectangle (pas width/DEPTH_GRID, au plus DEPTH_MAX_STEPS pas le long de
/// l'axe), ceux qui sont STRICTEMENT dans la matière, plus les échantillons de
/// contour (arêtes de l'extérieur et du trou coupées au rectangle), doivent
/// être à <= DEPTH_FACTOR·width du reste. Reste vide = trop profond.
/// Arrangement douteux (contrôle d'intégrité) = trop profond.
fn channel_too_deep(
    outer_ring: &OuterIndex,
    hole: &[Pt],
    rect: &[Pt],
    p_in: Pt,
    length: f64,
    u: Pt,
    width: f64,
) -> bool {
    let Some(faces) = local_faces(outer_ring, hole, rect, width) else {
        return true;
    };
    deep_from_faces(&faces, outer_ring, hole, rect, p_in, length, u, width)
}

/// Le calcul de H2 une fois les faces classées (voir `channel_too_deep`).
#[allow(clippy::too_many_arguments)]
fn deep_from_faces(
    faces: &[Face],
    outer_ring: &OuterIndex,
    hole: &[Pt],
    rect: &[Pt],
    p_in: Pt,
    length: f64,
    u: Pt,
    width: f64,
) -> bool {
    let remainder: Vec<&Face> = faces.iter().filter(|f| f.odd && !f.in_rect).collect();
    if remainder.is_empty() {
        return true;
    }
    // Matière effacée : faces de matière dans le rectangle (petites, locales :
    // un test point-dans-face suffit, pas de test sur l'anneau complet).
    let lost: Vec<(&Face, Bbox)> = faces
        .iter()
        .filter(|f| f.odd && f.in_rect)
        .map(|f| (f, bbox_of(&f.ring)))
        .collect();
    // Un échantillon est DANS le rectangle, donc hors du reste : sa distance
    // au reste est sa distance au contour du reste. Seuls comptent les
    // segments à portée du seuil.
    let limit = DEPTH_FACTOR * width;
    let rb = bbox_of(rect);
    let mut near_segs: Vec<(Pt, Pt)> = Vec::new();
    for f in &remainder {
        for (a, b) in ring_segments(&f.ring) {
            if a != b && bbox_near(&bbox_of(&[a, b]), &rb, limit + 1e-6) {
                near_segs.push((a, b));
            }
        }
    }
    let (ux, uy) = (u[0], u[1]);
    let (nx, ny) = (-uy, ux);
    let span = length + 4.0 * width;
    let step = width / DEPTH_GRID as f64;
    let n_along = depth_steps(span, step);
    let s = [p_in[0] - 2.0 * width * ux, p_in[1] - 2.0 * width * uy];
    for k in 0..=n_along {
        let a = k as f64 * (span / n_along as f64);
        for m in 0..=DEPTH_GRID {
            #[cfg(test)]
            GRID_SAMPLES.with(|c| c.set(c.get() + 1));
            let v = -width / 2.0 + m as f64 * step;
            let q = [s[0] + a * ux + v * nx, s[1] + a * uy + v * ny];
            if !grid_sample_counts(q, &lost) {
                continue;
            }
            let d = near_segs
                .iter()
                .map(|(p, r)| dist_pt_seg(q, *p, *r))
                .fold(f64::INFINITY, f64::min);
            if d > limit {
                return true;
            }
        }
    }
    // Échantillons de contour (révision 2) : la grille enjambe une paroi plus
    // fine que width/DEPTH_GRID. Chaque arête de l'extérieur et du trou est
    // coupée au rectangle fermé, échantillonnée au pas width/DEPTH_GRID ; tous
    // ces échantillons comptent (pas de test d'intérieur).
    let (sx, sy) = (s[0], s[1]);
    let half = width / 2.0;
    let grown: Bbox = [rb[0] - 1e-9, rb[1] - 1e-9, rb[2] + 1e-9, rb[3] + 1e-9];
    let outer_edges = outer_ring.edges_near(&grown).into_iter().map(|i| outer_ring.edge(i));
    for (a, b) in outer_edges.chain(ring_segments(hole)) {
        if a == b || !bbox_near(&bbox_of(&[a, b]), &rb, 1e-9) {
            continue;
        }
        let fa = [(a[0] - sx) * ux + (a[1] - sy) * uy, (a[0] - sx) * nx + (a[1] - sy) * ny];
        let fb = [(b[0] - sx) * ux + (b[1] - sy) * uy, (b[0] - sx) * nx + (b[1] - sy) * ny];
        let Some((c, e)) = clip_to_frame(fa, fb, span, half) else {
            continue;
        };
        let l = ((e[0] - c[0]).powi(2) + (e[1] - c[1]).powi(2)).sqrt();
        let n = ((l / step).ceil() as usize).max(1);
        for k in 0..=n {
            let t = k as f64 / n as f64;
            let (al, ac) = (c[0] + (e[0] - c[0]) * t, c[1] + (e[1] - c[1]) * t);
            let q = [sx + al * ux + ac * nx, sy + al * uy + ac * ny];
            let d = near_segs
                .iter()
                .map(|(p, r)| dist_pt_seg(q, *p, *r))
                .fold(f64::INFINITY, f64::min);
            if d > limit {
                return true;
            }
        }
    }
    false
}

/// Nombre de pas le long de l'axe : ceil(span / step), au moins 1, au plus
/// DEPTH_MAX_STEPS.
fn depth_steps(span: f64, step: f64) -> usize {
    ((span / step).ceil() as usize).clamp(1, DEPTH_MAX_STEPS)
}

/// Coupe le segment fa-fb (repère du rectangle : abscisse le long de l'axe,
/// ordonnée en travers) au rectangle fermé 0 <= along <= span, |across| <= half
/// (Liang-Barsky). Le morceau peut se réduire à un point.
fn clip_to_frame(fa: Pt, fb: Pt, span: f64, half: f64) -> Option<(Pt, Pt)> {
    let (dx, dy) = (fb[0] - fa[0], fb[1] - fa[1]);
    let (mut t0, mut t1) = (0.0f64, 1.0f64);
    // (p, q) : p * t <= q
    for (p, q) in [(-dx, fa[0]), (dx, span - fa[0]), (-dy, fa[1] + half), (dy, half - fa[1])] {
        if p == 0.0 {
            if q < 0.0 {
                return None;
            }
        } else {
            let r = q / p;
            if p < 0.0 {
                if r > t1 {
                    return None;
                }
                t0 = t0.max(r);
            } else {
                if r < t0 {
                    return None;
                }
                t1 = t1.min(r);
            }
        }
    }
    Some(([fa[0] + dx * t0, fa[1] + dy * t0], [fa[0] + dx * t1, fa[1] + dy * t1]))
}

/// Anneau fermé (premier == dernier) : une copie, fermée si besoin. Même
/// décision pour un anneau fermé et pour son jumeau ouvert (R3.1).
fn closed_copy(ring: &[Pt]) -> Vec<Pt> {
    let mut v = ring.to_vec();
    if let (Some(&f), Some(&l)) = (v.first(), v.last()) {
        if f != l {
            v.push(f);
        }
    }
    v
}

/// R3.1 : moins de 3 sommets distincts, ou aire (valeur absolue de l'aire
/// signée) <= DEGENERATE_HOLE_MM2 : trou dégénéré, fermé (« small »), jamais
/// utilisé dans une construction de polygone.
fn is_degenerate_hole(ring: &[Pt]) -> bool {
    let mut keys: Vec<Key> = ring.iter().map(|&p| key(p)).collect();
    keys.sort();
    keys.dedup();
    if keys.len() < 3 {
        return true;
    }
    !(ga::ring_signed_area(ring).abs() > DEGENERATE_HOLE_MM2)
}

/// Anneaux d'entrée fermés (extérieur, trous).
fn prepare(outer_ring: &[Pt], hole_rings: &[Vec<Pt>]) -> (Vec<Pt>, Vec<Vec<Pt>>) {
    (closed_copy(outer_ring), hole_rings.iter().map(|h| closed_copy(h)).collect())
}

/// R3.2 : tolérance entre deux rectangles de canaux ouverts.
fn rect_rect_tolerance(width: f64) -> f64 {
    CONFLICT_TOL.max(DEPTH_FACTOR * width)
}

/// Décision par trou (ordre d'entrée) et rectangle de chaque trou examiné.
/// Anneaux déjà fermés.
fn plan(outer_ring: &[Pt], hole_rings: &[Vec<Pt>], width: f64) -> (Vec<ChannelDecision>, Vec<Option<Vec<Pt>>>) {
    let n = hole_rings.len();
    let mut decisions: Vec<Option<ChannelDecision>> = vec![None; n];
    let mut rects: Vec<Option<Vec<Pt>>> = vec![None; n];
    let mut geo: Vec<Option<(Pt, f64, Pt)>> = vec![None; n]; // p_in, L, u
    let mut candidates: Vec<usize> = Vec::new();
    for (i, ring) in hole_rings.iter().enumerate() {
        if is_degenerate_hole(ring) {
            decisions[i] = Some(ChannelDecision::Small);
            continue;
        }
        let b = bbox_of(ring);
        if (b[2] - b[0]).min(b[3] - b[1]) <= SMALL_HOLE_FACTOR * width {
            decisions[i] = Some(ChannelDecision::Small);
            continue;
        }
        let Some((p_in, p_out)) = nearest_points(ring, outer_ring) else {
            decisions[i] = Some(ChannelDecision::Deep); // l'équivalent d'une exception
            continue;
        };
        let (dx, dy) = (p_out[0] - p_in[0], p_out[1] - p_in[1]);
        let length = (dx * dx + dy * dy).sqrt();
        let rect = channel_rectangle(p_in, p_out, width);
        let Some(rect) = rect.filter(|_| length >= FLUSH_MIN) else {
            decisions[i] = Some(ChannelDecision::Flush);
            continue;
        };
        rects[i] = Some(rect);
        geo[i] = Some((p_in, length, [dx / length, dy / length]));
        candidates.push(i);
    }
    let outer_index = OuterIndex::new(outer_ring);
    // Révision 2 : ordre d'index des trous, sans tri.
    // Révision 3 (R3.2) : deux canaux ouverts restent à plus de
    // DEPTH_FACTOR·width l'un de l'autre.
    let rect_rect_tol = rect_rect_tolerance(width);
    let mut opened: Vec<usize> = Vec::new();
    for i in candidates {
        let rect = rects[i].as_ref().unwrap();
        let hole = &hole_rings[i];
        let conflict = opened.iter().any(|&j| {
            let rj = rects[j].as_ref().unwrap();
            let hj = &hole_rings[j];
            filled_within(rect, rj, rect_rect_tol)
                || filled_within(rect, hj, CONFLICT_TOL)
                || filled_within(hole, rj, CONFLICT_TOL)
                || filled_within(hole, hj, CONFLICT_TOL)
        });
        if conflict {
            decisions[i] = Some(ChannelDecision::Conflict);
            continue;
        }
        let (p_in, length, u) = geo[i].unwrap();
        if channel_too_deep(&outer_index, hole, rect, p_in, length, u, width) {
            decisions[i] = Some(ChannelDecision::Deep);
        } else {
            decisions[i] = Some(ChannelDecision::Open);
            opened.push(i);
        }
    }
    (decisions.into_iter().map(|d| d.unwrap()).collect(), rects)
}

/// Décision par trou, dans l'ordre d'entrée : Open (un canal est coupé) ou la
/// raison pour laquelle il reste fermé (jumeau de plan_channels Python).
pub fn plan_channels(outer_ring: &[Pt], hole_rings: &[Vec<Pt>], width: f64) -> Vec<ChannelDecision> {
    if hole_rings.is_empty() {
        return Vec::new();
    }
    let (outer, holes) = prepare(outer_ring, hole_rings);
    plan_checked(&outer, &holes, width).0
}

/// `plan` après le contrôle de l'anneau externe (vide / dégénéré : tout fermé).
fn plan_checked(
    outer_ring: &[Pt],
    hole_rings: &[Vec<Pt>],
    width: f64,
) -> (Vec<ChannelDecision>, Vec<Option<Vec<Pt>>>) {
    if hole_rings.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let mut distinct: Vec<Key> = outer_ring.iter().map(|&p| key(p)).collect();
    distinct.sort();
    distinct.dedup();
    if distinct.len() < 3 {
        return (vec![ChannelDecision::Deep; hole_rings.len()], vec![None; hole_rings.len()]);
    }
    plan(outer_ring, hole_rings, width)
}

/// Anneau simple : pas de sommet répété (hors fermeture), pas d'arêtes qui se
/// croisent ni se touchent hors extrémités communes consécutives (is_simple
/// de shapely).
fn is_simple_ring(ring: &[Pt]) -> bool {
    let mut pts: Vec<Pt> = ring.to_vec();
    if pts.len() > 1 && pts.first() == pts.last() {
        pts.pop();
    }
    let n = pts.len();
    if n < 3 {
        return false;
    }
    let mut keys: Vec<(u64, u64)> = pts.iter().map(|p| (p[0].to_bits(), p[1].to_bits())).collect();
    keys.sort();
    keys.dedup();
    if keys.len() != n {
        return false;
    }
    // Balayage en x : seules les arêtes aux boîtes qui se recouvrent sont testées.
    let mut idx: Vec<usize> = (0..n).collect();
    let seg = |i: usize| (pts[i], pts[(i + 1) % n]);
    let boxed: Vec<Bbox> = (0..n).map(|i| bbox_of(&[seg(i).0, seg(i).1])).collect();
    idx.sort_by(|&a, &b| boxed[a][0].total_cmp(&boxed[b][0]));
    for (pos, &i) in idx.iter().enumerate() {
        for &j in &idx[pos + 1..] {
            if boxed[j][0] > boxed[i][2] {
                break;
            }
            if boxed[j][1] > boxed[i][3] || boxed[i][1] > boxed[j][3] {
                continue;
            }
            let (a1, a2) = seg(i);
            let (b1, b2) = seg(j);
            let (lo, hi) = (i.min(j), i.max(j));
            if hi == lo + 1 || (lo == 0 && hi == n - 1) {
                // Consécutives : elles partagent un sommet ; seul un
                // recouvrement colinéaire (demi-tour) est interdit.
                let (a, v, c) = if hi == lo + 1 {
                    (seg(lo).0, seg(lo).1, seg(hi).1)
                } else {
                    (seg(hi).0, seg(hi).1, seg(lo).1)
                };
                if orient(a, v, c) == 0.0 && (v[0] - a[0]) * (c[0] - v[0]) + (v[1] - a[1]) * (c[1] - v[1]) < 0.0 {
                    return false;
                }
            } else if segs_touch(a1, a2, b1, b2) {
                return false;
            }
        }
    }
    true
}

/// R3.3 : l'anneau rendu est contrôlé contre les entrées avant d'être rendu.
/// - un point intérieur de CHAQUE trou ouvert est hors de l'anneau ;
/// - l'aire de l'anneau est dans [A(ext) - sum A(trous ouverts) -
///   sum A(rectangles ouverts) - SLIVER_MAX_MM2, A(ext)] (petite tolérance
///   relative 1e-6 + 1e-9 mm2).
/// Faux = l'anneau n'est pas prouvé, l'anneau externe est rendu à sa place.
fn ring_proven(outer: &[Pt], holes: &[&[Pt]], rects: &[Vec<Pt>], ring: &[Pt]) -> bool {
    if ring.len() < 4 {
        return false;
    }
    let a_out = ga::ring_signed_area(outer).abs();
    let a_ring = ga::ring_signed_area(ring).abs();
    let tol = 1e-6 * a_out + 1e-9;
    if !(a_ring <= a_out + tol) {
        return false;
    }
    let removed: f64 = holes.iter().map(|h| ga::ring_signed_area(h).abs()).sum::<f64>()
        + rects.iter().map(|r| ga::ring_signed_area(r).abs()).sum::<f64>();
    if !(a_ring + tol >= a_out - removed - SLIVER_MAX_MM2) {
        return false;
    }
    for h in holes {
        let probe = ga::face_probes(&[h.to_vec()])[0];
        if !ga::point_in_ring(probe, h) || ga::point_in_ring(probe, ring) {
            return false;
        }
    }
    true
}

/// Ouvre les trous dont le canal est inoffensif (plan_channels) par un canal
/// rectangulaire soustrait (difference GEOS répliquée sur l'arrangement
/// maison) ; les autres restent pleins. Retourne l'anneau extérieur du corps
/// résultant (premier == dernier), ou l'anneau externe d'origine si aucun
/// trou n'est ouvert, si le résultat éclate au-delà de SLIVER_MAX_MM2, si
/// l'anneau n'est pas simple, si l'arrangement ne passe pas son contrôle
/// d'intégrité ou si l'anneau n'est pas prouvé contre les entrées (R3.3).
pub fn open_holes_difference(outer_ring: &[Pt], hole_rings: &[Vec<Pt>], width: f64) -> Vec<Pt> {
    if hole_rings.is_empty() {
        return outer_ring.to_vec();
    }
    let (outer, holes) = prepare(outer_ring, hole_rings);
    let (decisions, rect_opts) = plan_checked(&outer, &holes, width);
    let opened: Vec<usize> = (0..holes.len()).filter(|&i| decisions[i] == ChannelDecision::Open).collect();
    if opened.is_empty() {
        return outer_ring.to_vec();
    }
    let rects: Vec<Vec<Pt>> = opened.iter().map(|&i| rect_opts[i].clone().unwrap()).collect();
    let opened_holes: Vec<&[Pt]> = opened.iter().map(|&i| holes[i].as_slice()).collect();
    match opened_ring(&outer, &opened_holes, &rects) {
        Some(ring) => ring,
        None => outer_ring.to_vec(),
    }
}

/// Anneau externe du corps après ouverture des trous donnés (anneaux fermés) ;
/// None = on rend l'anneau externe d'origine.
fn opened_ring(outer_ring: &[Pt], holes: &[&[Pt]], rects: &[Vec<Pt>]) -> Option<Vec<Pt>> {
    let mut edges: Vec<(Pt, Pt)> = Vec::new();
    for ring in std::iter::once(outer_ring).chain(holes.iter().copied()).chain(rects.iter().map(|r| r.as_slice())) {
        for w in ring.windows(2) {
            if w[0] != w[1] {
                edges.push((w[0], w[1]));
            }
        }
    }
    // Matière = profondeur impaire sur (outer + trous ouverts) ET hors de
    // tout rectangle. Arrangement contrôlé : sinon anneau externe.
    let cycles = arrange(&edges)?;
    let rect_refs: Vec<&[Pt]> = rects.iter().map(|r| r.as_slice()).collect();
    let outer_index = OuterIndex::new(outer_ring);
    let faces = classify(cycles, &outer_index, holes, &rect_refs);
    let matter: Vec<&Face> = faces.iter().filter(|f| f.odd && !f.in_rect).collect();
    if matter.is_empty() {
        return None;
    }

    // Frontière de l'union des faces matière (XOR des arêtes) puis outlines
    // = cycles à aire négative (même règle que build_parts).
    let mut counts: std::collections::HashMap<(Key, Key), (Pt, Pt)> = std::collections::HashMap::new();
    let mut multi: std::collections::HashSet<(Key, Key)> = std::collections::HashSet::new();
    for f in &matter {
        let ring = &f.ring;
        let n = ring.len();
        for i in 0..n {
            let a = ring[i];
            let b = ring[(i + 1) % n];
            let (ka, kb) = (key(a), key(b));
            let k = if ka <= kb { (ka, kb) } else { (kb, ka) };
            if counts.insert(k, (a, b)).is_some() {
                multi.insert(k);
            }
        }
    }
    let mut keyed: Vec<_> = counts.into_iter().filter(|(k, _)| !multi.contains(k)).collect();
    keyed.sort_by(|(ka, _), (kb, _)| ka.cmp(kb)); // J-062 : ordre déterministe
    let boundary: Vec<(Pt, Pt)> = keyed.into_iter().map(|(_, ab)| ab).collect();
    let outlines: Vec<Vec<Pt>> = polygonize_local(&boundary)
        .0
        .into_iter()
        .filter(|f| ga::ring_signed_area(f) < -1e-12)
        .collect();
    if outlines.is_empty() {
        return None;
    }

    // Aire nette de chaque morceau (matière qu'il contient, trous restés
    // intérieurs déduits) : le plus grand est gardé, le reste est abandonné.
    let mut net = vec![0.0f64; outlines.len()];
    let out_area: Vec<f64> = outlines.iter().map(|o| ga::ring_signed_area(o).abs()).collect();
    for f in &matter {
        let owner = if outlines.len() == 1 {
            Some(0) // une seule enveloppe : toute face de matière lui appartient
        } else {
            (0..outlines.len())
                .filter(|&k| ga::point_in_ring(f.probe, &outlines[k]))
                .min_by(|&a, &b| out_area[a].total_cmp(&out_area[b]))
        };
        if let Some(k) = owner {
            net[k] += ga::ring_signed_area(&f.ring);
        }
    }
    let mut best = 0usize;
    for k in 1..outlines.len() {
        if net[k] > net[best] {
            best = k;
        }
    }
    let dropped = net.iter().sum::<f64>() - net[best];
    if dropped > SLIVER_MAX_MM2 {
        // Le moteur ignorerait les morceaux abandonnés et pourrait y poser des
        // pièces : on garde tous les trous fermés.
        return None;
    }
    #[allow(unused_mut)]
    let mut ring = close_ring(outlines[best].clone());
    #[cfg(test)]
    FORCE_RING.with(|c| {
        if let Some(r) = c.borrow().as_ref() {
            ring = r.clone();
        }
    });
    if !is_simple_ring(&ring) {
        return None;
    }
    if !ring_proven(outer_ring, holes, rects, &ring) {
        return None;
    }
    Some(ring)
}

fn close_ring(mut ring: Vec<Pt>) -> Vec<Pt> {
    if ring.len() >= 3 && ring.first() != ring.last() {
        ring.push(ring[0]);
    }
    ring
}


// ------------------------------------------------------ (b) ring-splice

/// Insère p dans l'anneau (au milieu du segment qui le contient) et
/// retourne (anneau, index de p). Si p n'est sur aucun segment → None.
fn insert_in_ring(ring: &[Pt], p: Pt) -> Option<(Vec<Pt>, usize)> {
    let n = ring.len();
    for i in 0..n.saturating_sub(1) {
        let a = ring[i];
        let b = ring[i + 1];
        if p == a || ga::point_on_segment(p, a, b) {
            let mut out = Vec::with_capacity(n + 1);
            out.extend_from_slice(&ring[..=i]);
            if p != a && p != b {
                out.push(p);
            }
            out.extend_from_slice(&ring[i + 1..]);
            let idx = out.iter().position(|&q| q == p)?;
            return Some((out, idx));
        }
    }
    None
}

/// Splice d'anneaux : coupe outer au point le plus proche du trou, coupe le
/// trou symétriquement, relie par deux rails droits décalés de ±width/2 le
/// long des tangentes locales. Arithmétique pure (aucun booléen).
pub fn open_holes_splice(outer_ring: &[Pt], hole_rings: &[Vec<Pt>], width: f64) -> Vec<Pt> {
    if hole_rings.is_empty() {
        return outer_ring.to_vec();
    }
    // Travail sur une copie "ouverte" (sans sommet de fermeture dupliqué).
    let mut work: Vec<Pt> = outer_ring.to_vec();
    if work.len() > 1 && work.first() == work.last() {
        work.pop();
    }
    for hole in hole_rings {
        let Some((p_in, p_out)) = nearest_points(hole, &work) else {
            continue;
        };
        // Insère p_out dans l'anneau de travail.
        let Some((ring2, idx_out)) = insert_in_ring(&work, p_out) else {
            if std::env::var("NI_DEBUG").is_ok() { eprintln!("[dbg] splice: insert p_out FAILED {p_out:?}"); }
            continue;
        };
        work = ring2;
        // Tangentes : au point de sortie (segment de l'outer) et au point
        // d'entrée (segment du trou).
        let n = work.len();
        let Some(to) = unit_between(work[(idx_out + n - 1) % n], work[(idx_out + 1) % n]) else {
            continue;
        };
        let Some(ti) = hole_tangent(hole, p_in) else {
            if std::env::var("NI_DEBUG").is_ok() { eprintln!("[dbg] splice: tangent FAILED"); }
            continue;
        };
        let h = width / 2.0;
        // Points de coupure décalés le long des anneaux.
        let q1 = [p_out[0] + to[0] * h, p_out[1] + to[1] * h];
        let q2 = [p_out[0] - to[0] * h, p_out[1] - to[1] * h];
        let r1 = [p_in[0] + ti[0] * h, p_in[1] + ti[1] * h];
        let r2 = [p_in[0] - ti[0] * h, p_in[1] - ti[1] * h];
        // Anneau du trou ouvert en p_in, parcouru en entier (sans sommet de
        // fermeture).
        let Some((hole_open, idx_in)) = insert_in_ring(hole, p_in) else {
            if std::env::var("NI_DEBUG").is_ok() { eprintln!("[dbg] splice: insert p_in FAILED {p_in:?}"); }
            continue;
        };
        let hn = if hole_open.len() > 1 && hole_open.first() == hole_open.last() {
            hole_open.len() - 1
        } else {
            hole_open.len()
        };
        // Le trou doit être parcouru dans le sens INVERSE de l'anneau
        // externe (sinon son aire s'additionne au lieu de se soustraire).
        let mut hole_walk: Vec<Pt> = (0..hn).map(|k| hole_open[(idx_in + k) % hn]).collect();
        let outer_ccw = ga::ring_signed_area(&work) > 0.0;
        let hole_ccw = ga::ring_signed_area(&hole_walk) > 0.0;
        if outer_ccw == hole_ccw {
            // Renverse en gardant p_in en tête.
            hole_walk = std::iter::once(hole_walk[0])
                .chain(hole_walk[1..].iter().rev().copied())
                .collect();
        }
        // Construction : outer de q2 → q1, rail q1→r1, trou r1→…→r2 (walk
        // complet recalé), rail r2→q2.
        let mut out: Vec<Pt> = Vec::with_capacity(work.len() + hn + 4);
        out.push(q2);
        for k in 1..n {
            out.push(work[(idx_out + k) % n]);
        }
        out.push(q1);
        out.push(r1);
        for &p in hole_walk.iter().skip(1) {
            out.push(p);
        }
        out.push(r2);
        out.push(q2);
        out.pop(); // close_ring à la fin
        if std::env::var("NI_DEBUG").is_ok() { eprintln!("[dbg] splice: out n={}", out.len()); }
        work = out;
    }
    close_ring(work)
}

fn unit_between(a: Pt, b: Pt) -> Option<Pt> {
    let d = dist(a, b);
    if d < 1e-12 {
        return None;
    }
    Some([(b[0] - a[0]) / d, (b[1] - a[1]) / d])
}

/// Tangente de l'anneau de trou au point p (direction du segment porteur ;
/// les extrémités comptent — nearest_points tombe souvent sur un sommet).
fn hole_tangent(hole: &[Pt], p: Pt) -> Option<Pt> {
    let n = hole.len();
    for i in 0..n.saturating_sub(1) {
        if p == hole[i] || ga::point_on_segment(p, hole[i], hole[i + 1]) {
            return unit_between(hole[i], hole[i + 1]);
        }
    }
    None
}

#[cfg(test)]
mod outer_index_budget {
    use super::*;

    /// Contour en peigne : chaque arête traverse toute la hauteur. L'index ne
    /// dépasse pas son plafond et répond comme ga::point_in_ring.
    #[test]
    fn comb_outline_keeps_the_index_small_and_the_answers_equal() {
        let teeth = 4000usize;
        let mut ring: Vec<Pt> = Vec::new();
        for k in 0..teeth {
            let x = k as f64;
            ring.push([x, 0.0]);
            ring.push([x + 0.25, 100.0]);
            ring.push([x + 0.5, 100.0]);
            ring.push([x + 0.75, 0.0]);
        }
        ring.push([teeth as f64, 0.0]);
        ring.push([teeth as f64, -10.0]);
        ring.push([0.0, -10.0]);
        ring.push([0.0, 0.0]);
        let oi = OuterIndex::new(&ring);
        let entries: usize = oi.slabs.iter().map(|s| s.len()).sum();
        assert!(
            entries <= SLAB_BUDGET_PER_VERTEX * ring.len() + 1024,
            "index de {} entrees pour {} sommets",
            entries,
            ring.len()
        );
        let mut k = 0u64;
        for i in 0..4000 {
            k = k.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let x = (k >> 11) as f64 / (1u64 << 53) as f64 * (teeth as f64 + 2.0) - 1.0;
            k = k.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let y = (k >> 11) as f64 / (1u64 << 53) as f64 * 114.0 - 12.0;
            let q = [x, if i % 7 == 0 { 100.0 } else { y }];
            assert_eq!(oi.contains(q), ga::point_in_ring(q, &ring), "point {:?}", q);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Pt> {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    }

    #[test]
    fn channel_width_rules() {
        assert_eq!(channel_width_for_space(0.0), 0.1); // max(0.01, 0+0.1)
        assert_eq!(channel_width_for_space(2.0), 2.1);
        assert_eq!(channel_width_for_space(3.0), 2.5); // cap
        assert!(channels_usable(2.0));
        assert!(!channels_usable(2.5)); // 2.5 > 2.5 faux → scellé
    }

    #[test]
    fn nearest_points_axis_aligned() {
        let outer = rect(0.0, 0.0, 100.0, 100.0);
        let hole = rect(40.0, 40.0, 60.0, 60.0);
        let (p_in, p_out) = nearest_points(&hole, &outer).unwrap();
        let d = dist(p_in, p_out);
        assert!((d - 40.0).abs() < 1e-9, "d={d}");
    }

    #[test]
    fn two_channels_edge_to_edge_keep_the_material() {
        // Garde du nodage : ce cas ne passe plus par open_holes_difference (les
        // deux triangles sont "small", voir two_narrow_triangles_stay_closed) ;
        // il reste sous test par la construction d'avant les regles H0-H3
        // (previous_open_holes_difference, copie gelee), meme nodage.
        // Défaut du 16/11 : deux canaux de 0,6 mm qui se touchent bord à bord
        // coupent le bord extérieur en deux points distants de 1 ulp
        // (32,400000000000006 et 32,4). Le nodage en écartait un, la face de
        // matière fusionnait avec la face extérieure et l'anneau rendu était
        // l'extérieur intact (10 000 mm²) — ou, sur un vrai dessin, un
        // morceau de 13 696 mm² pour une pièce de 867 477 mm².
        // Sens et point de départ de l'anneau comptent : c'est le t le long
        // du bord haut, parcouru de x = 0 vers x = 100, qui confondait les
        // deux points.
        let outer: Vec<Pt> = vec![[0.0, 0.0], [0.0, 100.0], [100.0, 100.0], [100.0, 0.0], [0.0, 0.0]];
        let h1: Vec<Pt> = vec![[31.85, 80.0], [32.35, 80.0], [32.1, 90.0], [31.85, 80.0]];
        let h2: Vec<Pt> = vec![[32.45, 80.0], [32.95, 80.0], [32.7, 90.0], [32.45, 80.0]];
        let ring = previous_open_holes_difference(&outer, &[h1, h2], 0.6);
        let area = ga::ring_signed_area(&ring).abs();
        // Valeur de la référence Python (shapely) sur les mêmes entrées.
        assert!((area - 9981.632).abs() < 0.01, "aire {area}");
    }

    #[test]
    fn difference_opens_channel() {
        let outer = rect(0.0, 0.0, 100.0, 100.0);
        let hole = rect(40.0, 40.0, 60.0, 60.0);
        let ring = open_holes_difference(&outer, &[hole], 2.1);
        // Le résultat est un anneau simple : outer − trou − canal.
        let area = ga::ring_signed_area(&ring).abs();
        let expected = 10000.0 - 400.0 - 40.0 * 2.1;
        assert!((area - expected).abs() / expected < 0.02, "area={area} vs {expected}");
        assert!(ring.first() == ring.last());
    }

    #[test]
    fn splice_opens_channel() {
        let outer = rect(0.0, 0.0, 100.0, 100.0);
        let hole = rect(40.0, 40.0, 60.0, 60.0);
        let ring = open_holes_splice(&outer, &[hole], 2.1);
        let area = ga::ring_signed_area(&ring).abs();
        let expected = 10000.0 - 400.0 - 40.0 * 2.1;
        assert!((area - expected).abs() / expected < 0.05, "area={area} vs {expected}");
        assert!(ring.first() == ring.last());
    }

    /// Trou presque aussi grand que la plaque 100x50 : parois `(gauche, bas,
    /// droite, haut)` toutes inférieures au pas de la sonde historique
    /// (0,7 mm). Le canal de 0,6 mm perce la paroi la plus fine ; le corps
    /// restant est une bande en C dont la sonde de bissectrice sort de la face.
    fn assert_channel_cut(walls: (f64, f64, f64, f64)) {
        let (l, b, r, t) = walls;
        let outer = rect(0.0, 0.0, 100.0, 50.0);
        let hole = rect(l, b, 100.0 - r, 50.0 - t);
        let ring = open_holes_difference(&outer, &[hole.clone()], 0.6);
        assert_ne!(ring, outer, "walls={walls:?} : anneau extérieur rendu intact");
        let area = ga::ring_signed_area(&ring).abs();
        let h = ga::ring_signed_area(&hole).abs();
        let thinnest = l.min(b).min(r).min(t);
        // Matière retirée par le canal, au centième de mm² près : la paroi
        // la plus fine sur 0,6 de large, plus 0,3 x 1,2 dans la paroi voisine
        // (le canal est centré sur un coin du trou et prolongé de deux
        // largeurs : sa moitié extérieure longe le trou sur 1,2 mm).
        let expected = 5000.0 - h - thinnest * 0.6 - 0.3 * 1.2;
        assert!((area - expected).abs() < 0.01, "walls={walls:?} area={area} vs {expected}");
    }

    #[test]
    fn thin_left_wall_still_opens_the_channel() {
        assert_channel_cut((0.3, 0.5, 0.6, 0.6));
    }

    // Les deux cas suivants (paroi fine en bas, à droite) passaient déjà avant
    // le correctif : l'anneau de la face y commence sur un autre sommet. Ils
    // restent pour fixer le résultat sur les quatre côtés.
    #[test]
    fn thin_bottom_wall_still_opens_the_channel() {
        assert_channel_cut((0.5, 0.3, 0.6, 0.6));
    }

    #[test]
    fn thin_right_wall_still_opens_the_channel() {
        assert_channel_cut((0.6, 0.6, 0.3, 0.5));
    }

    #[test]
    fn thin_top_wall_still_opens_the_channel() {
        assert_channel_cut((0.6, 0.6, 0.5, 0.3));
    }

    #[test]
    fn sealed_channels_stay_closed_semantics() {
        // D-MOT-2 : à space 3.0 le canal est scellé → l'appelant garde les
        // trous fermés (channels_usable = false) — jamais d'ouverture.
        assert!(!channels_usable(3.0));
    }

    // ------------------------------------------------------------------
    // Quels trous reçoivent un canal (règles H0-H3). Miroir test pour test
    // de workers/nesting/tests/test_holed_polygons.py : mêmes coordonnées,
    // mêmes décisions attendues.
    // ------------------------------------------------------------------

    use super::ChannelDecision::{Conflict, Deep, Flush, Open, Small};

    /// Ferme un anneau donné sans point de fermeture (les anneaux de
    /// l'import sont fermés : premier == dernier).
    fn closed(pts: &[Pt]) -> Vec<Pt> {
        let mut v = pts.to_vec();
        if v.first() != v.last() {
            v.push(v[0]);
        }
        v
    }

    fn area_of(ring: &[Pt]) -> f64 {
        ga::ring_signed_area(ring).abs()
    }

    /// Un anneau simple, qui ne sort pas de l'extérieur (à 1e-6 près).
    fn assert_simple_ring(ring: &[Pt], outer: &[Pt]) {
        assert!(ring.first() == ring.last(), "anneau non fermé");
        assert!(is_simple_ring(ring), "anneau non simple : {ring:?}");
        for p in ring {
            let inside = ga::point_in_ring(*p, outer);
            let near = ring_segments(outer).iter().any(|(a, b)| dist_pt_seg(*p, *a, *b) <= 1e-6);
            assert!(inside || near, "sommet {p:?} hors de l'extérieur");
        }
    }

    fn contains(ring: &[Pt], x: f64, y: f64) -> bool {
        ga::point_in_ring([x, y], ring)
    }

    // Pièce à grand trou et trou trop étroit.
    fn part_40x20() -> Vec<Pt> {
        rect(0.0, 0.0, 40.0, 20.0)
    }
    fn big_hole_10x12() -> Vec<Pt> {
        rect(20.0, 5.0, 32.0, 15.0)
    }

    // Deux trous alignés : losanges dont le sommet droit pointe vers le bord
    // droit. F (loin) a son point extérieur le plus proche en (62, 50) et le
    // canal de là à x=100 traverse N (près).
    fn square_100() -> Vec<Pt> {
        rect(0.0, 0.0, 100.0, 100.0)
    }
    fn diamond_far() -> Vec<Pt> {
        closed(&[[52.0, 50.0], [57.0, 42.0], [62.0, 50.0], [57.0, 58.0]])
    }
    fn diamond_near() -> Vec<Pt> {
        closed(&[[71.0, 50.0], [77.0, 42.0], [83.0, 50.0], [77.0, 58.0]])
    }

    // Deux coins dont les pointes (40, 50) et (40, 50 + d) visent le bord droit
    // d'une pièce 60 x 100 : canaux parallèles distants de d - w.
    fn part_60x100() -> Vec<Pt> {
        rect(0.0, 0.0, 60.0, 100.0)
    }
    fn wedge_pair(d: f64) -> Vec<Vec<Pt>> {
        let lower = closed(&[[40.0, 50.0], [22.0, 44.0], [22.0, 49.0]]);
        let upper = closed(&[[40.0, 50.0 + d], [22.0, 50.4 + d], [22.0, 56.0]]);
        vec![lower, upper]
    }

    // Cadre mince (paroi 0,3) et cadre à paroi de 3 mm.
    fn thin_frame() -> (Vec<Pt>, Vec<Vec<Pt>>) {
        (rect(0.0, 0.0, 10.0, 5.0), vec![rect(0.3, 0.3, 9.7, 4.7)])
    }
    fn wall3_frame() -> (Vec<Pt>, Vec<Vec<Pt>>) {
        (rect(0.0, 0.0, 16.0, 11.0), vec![rect(3.0, 3.0, 13.0, 8.0)])
    }

    /// Trou à péninsule (langue) pointant vers le point extérieur le plus
    /// proche : l'ouvrir effacerait la langue.
    fn tongue_hole(w: f64) -> Vec<Pt> {
        let top = 18.6;
        let tip = top - 15.0 * w / 16.0;
        let tw = (0.8 * w).min(1.0);
        closed(&[
            [5.0, 5.0],
            [5.0, 18.5],
            [10.0, top],
            [15.0, 18.5],
            [15.0, 5.0],
            [10.0 + tw / 2.0, 5.0],
            [10.0 + tw / 2.0, tip],
            [10.0 - tw / 2.0, tip],
            [10.0 - tw / 2.0, 5.0],
        ])
    }

    /// Disque de rayon 5 avec une clé de 0,5 x 3 mm pendue à sa paroi haute
    /// (disque moins boîte (9,75 ; 13)-(10,25 ; 16)) : le canal effacerait la
    /// clé. Anneau produit par shapely, sommets repris tels quels.
    fn key_hole() -> Vec<Pt> {
        closed(&[
            [10.348782368720627, 14.987820251299121],
            [10.522642316338267, 14.972609476841367],
            [10.695865504800329, 14.951340343707852],
            [10.868240888334652, 14.92403876506104],
            [11.039558454088798, 14.890738003669028],
            [11.20960947799834, 14.851478631379983],
            [11.378186779084995, 14.806308479691594],
            [11.545084971874736, 14.755282581475768],
            [11.710100716628345, 14.69846310392954],
            [11.87303296707956, 14.635919272833938],
            [12.033683215379002, 14.567727288213003],
            [12.191855733945388, 14.493970231495835],
            [12.347357813929454, 14.414737964294634],
            [12.5, 14.330127018922193],
            [12.649596321166024, 14.24024048078213],
            [12.795964517353735, 14.14518786277521],
            [12.938926261462367, 14.045084971874736],
            [13.078307376628292, 13.94005376803361],
            [13.213938048432697, 13.83022221559489],
            [13.345653031794292, 13.71572412738697],
            [13.473291852294986, 13.596699001693256],
            [13.596699001693256, 13.473291852294986],
            [13.71572412738697, 13.345653031794292],
            [13.83022221559489, 13.213938048432697],
            [13.94005376803361, 13.078307376628292],
            [14.045084971874736, 12.938926261462367],
            [14.14518786277521, 12.795964517353735],
            [14.24024048078213, 12.649596321166024],
            [14.330127018922195, 12.5],
            [14.414737964294634, 12.347357813929454],
            [14.493970231495835, 12.191855733945387],
            [14.567727288213003, 12.033683215379],
            [14.635919272833938, 11.87303296707956],
            [14.698463103929543, 11.710100716628343],
            [14.755282581475768, 11.545084971874736],
            [14.806308479691594, 11.378186779084995],
            [14.851478631379983, 11.209609477998338],
            [14.890738003669028, 11.039558454088796],
            [14.92403876506104, 10.868240888334652],
            [14.951340343707852, 10.695865504800327],
            [14.972609476841367, 10.522642316338267],
            [14.987820251299121, 10.348782368720627],
            [14.996954135095478, 10.174497483512505],
            [15.0, 10.0],
            [14.996954135095478, 9.825502516487497],
            [14.987820251299121, 9.651217631279376],
            [14.972609476841367, 9.477357683661733],
            [14.951340343707852, 9.304134495199671],
            [14.92403876506104, 9.131759111665344],
            [14.890738003669028, 8.9604415459112],
            [14.851478631379983, 8.79039052200166],
            [14.806308479691594, 8.621813220915001],
            [14.755282581475768, 8.454915028125262],
            [14.698463103929543, 8.289899283371657],
            [14.635919272833936, 8.126967032920438],
            [14.567727288213005, 7.966316784620999],
            [14.493970231495837, 7.808144266054615],
            [14.414737964294634, 7.652642186070546],
            [14.330127018922191, 7.499999999999998],
            [14.240240480782127, 7.350403678833971],
            [14.145187862775206, 7.204035482646264],
            [14.045084971874736, 7.061073738537633],
            [13.940053768033607, 6.9216926233717055],
            [13.830222215594889, 6.7860619515673015],
            [13.71572412738697, 6.65434696820571],
            [13.596699001693255, 6.526708147705012],
            [13.473291852294983, 6.403300998306741],
            [13.345653031794289, 6.284275872613027],
            [13.213938048432697, 6.16977778440511],
            [13.078307376628292, 6.059946231966391],
            [12.938926261462365, 5.954915028125262],
            [12.795964517353731, 5.85481213722479],
            [12.649596321166023, 5.759759519217869],
            [12.5, 5.669872981077807],
            [12.347357813929452, 5.585262035705364],
            [12.191855733945387, 5.506029768504165],
            [12.033683215379003, 5.432272711786997],
            [11.87303296707956, 5.364080727166063],
            [11.710100716628341, 5.301536896070457],
            [11.545084971874736, 5.244717418524232],
            [11.378186779084997, 5.193691520308406],
            [11.209609477998336, 5.148521368620017],
            [11.039558454088793, 5.109261996330971],
            [10.86824088833465, 5.075961234938959],
            [10.695865504800327, 5.048659656292148],
            [10.522642316338265, 5.027390523158633],
            [10.348782368720626, 5.012179748700879],
            [10.174497483512507, 5.0030458649045215],
            [9.999999999999998, 5.0],
            [9.825502516487491, 5.0030458649045215],
            [9.651217631279373, 5.012179748700879],
            [9.477357683661733, 5.027390523158633],
            [9.304134495199675, 5.048659656292148],
            [9.131759111665348, 5.07596123493896],
            [8.960441545911202, 5.109261996330972],
            [8.790390522001662, 5.148521368620018],
            [8.621813220915005, 5.193691520308405],
            [8.454915028125262, 5.244717418524233],
            [8.289899283371653, 5.301536896070459],
            [8.126967032920438, 5.364080727166064],
            [7.966316784621, 5.432272711786995],
            [7.808144266054612, 5.506029768504166],
            [7.652642186070546, 5.585262035705365],
            [7.499999999999998, 5.669872981077807],
            [7.350403678833975, 5.75975951921787],
            [7.204035482646264, 5.854812137224793],
            [7.061073738537633, 5.954915028125264],
            [6.92169262337171, 6.059946231966389],
            [6.786061951567302, 6.1697777844051105],
            [6.654346968205708, 6.28427587261303],
            [6.526708147705013, 6.4033009983067455],
            [6.403300998306745, 6.526708147705014],
            [6.284275872613029, 6.654346968205709],
            [6.16977778440511, 6.786061951567303],
            [6.059946231966389, 6.921692623371711],
            [5.954915028125263, 7.061073738537635],
            [5.854812137224791, 7.204035482646267],
            [5.759759519217869, 7.350403678833976],
            [5.669872981077807, 7.5],
            [5.585262035705366, 7.652642186070546],
            [5.506029768504164, 7.808144266054615],
            [5.432272711786995, 7.966316784621001],
            [5.364080727166063, 8.12696703292044],
            [5.301536896070457, 8.289899283371657],
            [5.244717418524233, 8.454915028125262],
            [5.1936915203084055, 8.621813220915005],
            [5.148521368620018, 8.790390522001662],
            [5.1092619963309716, 8.960441545911205],
            [5.07596123493896, 9.131759111665348],
            [5.048659656292148, 9.304134495199673],
            [5.027390523158633, 9.477357683661735],
            [5.012179748700879, 9.651217631279376],
            [5.0030458649045215, 9.825502516487495],
            [5.0, 10.0],
            [5.0030458649045215, 10.174497483512503],
            [5.012179748700879, 10.348782368720627],
            [5.027390523158633, 10.522642316338269],
            [5.048659656292148, 10.695865504800329],
            [5.07596123493896, 10.868240888334652],
            [5.1092619963309716, 11.039558454088796],
            [5.148521368620018, 11.209609477998338],
            [5.193691520308406, 11.378186779084999],
            [5.244717418524233, 11.545084971874738],
            [5.301536896070458, 11.710100716628345],
            [5.364080727166064, 11.873032967079562],
            [5.432272711786997, 12.033683215379002],
            [5.506029768504165, 12.191855733945387],
            [5.585262035705366, 12.347357813929456],
            [5.669872981077806, 12.5],
            [5.75975951921787, 12.649596321166024],
            [5.854812137224792, 12.795964517353735],
            [5.954915028125264, 12.938926261462367],
            [6.059946231966391, 13.078307376628292],
            [6.1697777844051105, 13.213938048432698],
            [6.28427587261303, 13.345653031794292],
            [6.403300998306744, 13.473291852294986],
            [6.526708147705015, 13.596699001693256],
            [6.654346968205709, 13.71572412738697],
            [6.786061951567303, 13.83022221559489],
            [6.921692623371708, 13.94005376803361],
            [7.061073738537635, 14.045084971874736],
            [7.204035482646267, 14.14518786277521],
            [7.350403678833976, 14.24024048078213],
            [7.500000000000001, 14.330127018922195],
            [7.652642186070548, 14.414737964294636],
            [7.8081442660546125, 14.493970231495835],
            [7.966316784621, 14.567727288213005],
            [8.12696703292044, 14.635919272833938],
            [8.289899283371657, 14.698463103929543],
            [8.454915028125264, 14.755282581475768],
            [8.621813220915005, 14.806308479691594],
            [8.790390522001662, 14.851478631379983],
            [8.960441545911204, 14.890738003669028],
            [9.131759111665348, 14.92403876506104],
            [9.304134495199673, 14.951340343707852],
            [9.477357683661733, 14.972609476841367],
            [9.651217631279373, 14.987820251299121],
            [9.75, 14.992997215876088],
            [9.75, 13.0],
            [10.25, 13.0],
            [10.25, 14.992997215876088]

        ])
    }

    /// Pièce en U : bras gauche à trou en losange dont le sommet droit est à
    /// 1,5 mm du bord intérieur du U, et bras droit mince (0,5 de large) à
    /// 0,3 mm : le prolongement du canal au-delà de l'extérieur coupe le bras.
    fn u_part(arm_top: f64) -> (Vec<Pt>, Vec<Vec<Pt>>) {
        let outer = closed(&[
            [0.0, 0.0],
            [12.8, 0.0],
            [12.8, arm_top],
            [12.3, arm_top],
            [12.3, 2.0],
            [12.0, 2.0],
            [12.0, 20.0],
            [0.0, 20.0],
        ]);
        let hole = closed(&[[2.5, 11.0], [6.5, 6.0], [10.5, 11.0], [6.5, 16.0]]);
        (outer, vec![hole])
    }

    // Formes de la suite historique (cercles r35 / r5).
    fn square() -> Vec<Pt> {
        closed(&[[-50.0, -50.0], [50.0, -50.0], [50.0, 50.0], [-50.0, 50.0]])
    }
    fn hole_r35() -> Vec<Pt> {
        let pts: Vec<Pt> = (0..32)
            .map(|i| {
                let t = i as f64 * std::f64::consts::PI / 16.0;
                [35.0 * t.cos(), 35.0 * t.sin()]
            })
            .collect();
        closed(&pts)
    }
    fn small_circle(cx: f64, cy: f64) -> Vec<Pt> {
        let pts: Vec<Pt> = (0..16)
            .map(|i| {
                let t = i as f64 * std::f64::consts::PI / 8.0;
                [5.0 * t.cos() + cx, 5.0 * t.sin() + cy]
            })
            .collect();
        closed(&pts)
    }
    fn hole_r5() -> Vec<Pt> {
        small_circle(38.0, 38.0)
    }
    fn hole_r5_collinear() -> Vec<Pt> {
        small_circle(-43.0, 0.0)
    }

    /// Forme hôte du banc (carré 100 x 100, trou circulaire de rayon 35 au
    /// centre, 416 sommets).
    fn host_ring() -> (Vec<Pt>, Vec<Vec<Pt>>) {
        let outer = closed(&[[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0]]);
        let pts: Vec<Pt> = (0..416)
            .map(|i| {
                let t = 2.0 * std::f64::consts::PI * i as f64 / 416.0;
                [35.0 * t.cos(), 35.0 * t.sin()]
            })
            .collect();
        (outer, vec![closed(&pts)])
    }

    /// Copie GELÉE de la construction d'avant les règles H0-H3 : un canal pour
    /// CHAQUE trou. Sert à vérifier que les formes que les règles ne touchent
    /// pas gardent exactement le même anneau, et à garder le défaut du nodage
    /// du 16/11 (deux canaux bord à bord) sous test.
    fn previous_open_holes_difference(outer_ring: &[Pt], hole_rings: &[Vec<Pt>], width: f64) -> Vec<Pt> {
        if hole_rings.is_empty() {
            return outer_ring.to_vec();
        }
        let mut rects: Vec<Vec<Pt>> = Vec::new();
        for hole in hole_rings {
            let Some((p_in, p_out)) = nearest_points(hole, outer_ring) else {
                continue;
            };
            if let Some(r) = channel_rectangle(p_in, p_out, width) {
                rects.push(r);
            }
        }
        if rects.is_empty() {
            return outer_ring.to_vec();
        }
        let mut edges: Vec<(Pt, Pt)> = Vec::new();
        let mut push_ring = |ring: &[Pt]| {
            for w in ring.windows(2) {
                if w[0] != w[1] {
                    edges.push((w[0], w[1]));
                }
            }
        };
        push_ring(outer_ring);
        for h in hole_rings {
            push_ring(h);
        }
        for r in &rects {
            push_ring(r);
        }
        let noded = ga::node_segments(&edges);
        let faces = ga::polygonize(&[], &noded);
        let positive: Vec<Vec<Pt>> = faces.iter().filter(|f| ga::ring_signed_area(f) > 1e-12).cloned().collect();
        let probes = ga::face_probes(&positive);
        let mut matter: Vec<Vec<Pt>> = Vec::new();
        for (f, &probe) in positive.iter().zip(&probes) {
            let mut depth = 0usize;
            if ga::point_in_ring(probe, outer_ring) {
                depth += 1;
            }
            for h in hole_rings {
                if ga::point_in_ring(probe, h) {
                    depth += 1;
                }
            }
            if depth % 2 == 0 || rects.iter().any(|r| ga::point_in_ring(probe, r)) {
                continue;
            }
            matter.push(f.clone());
        }
        if matter.is_empty() {
            return outer_ring.to_vec();
        }
        let mut counts: std::collections::HashMap<((u64, u64), (u64, u64)), (Pt, Pt)> =
            std::collections::HashMap::new();
        let mut multi: std::collections::HashSet<((u64, u64), (u64, u64))> = std::collections::HashSet::new();
        for ring in &matter {
            let n = ring.len();
            for i in 0..n {
                let a = ring[i];
                let b = ring[(i + 1) % n];
                let ka = (a[0].to_bits(), a[1].to_bits());
                let kb = (b[0].to_bits(), b[1].to_bits());
                let key = if ka <= kb { (ka, kb) } else { (kb, ka) };
                if counts.insert(key, (a, b)).is_some() {
                    multi.insert(key);
                }
            }
        }
        let mut keyed: Vec<_> = counts.into_iter().filter(|(k, _)| !multi.contains(k)).collect();
        keyed.sort_by(|(ka, _), (kb, _)| ka.cmp(kb));
        let boundary: Vec<(Pt, Pt)> = keyed.into_iter().map(|(_, ab)| ab).collect();
        let outlines: Vec<Vec<Pt>> = ga::polygonize(&[], &boundary)
            .into_iter()
            .filter(|f| ga::ring_signed_area(f) < -1e-12)
            .collect();
        if outlines.is_empty() {
            return outer_ring.to_vec();
        }
        let best = outlines
            .into_iter()
            .max_by(|a, b| ga::ring_signed_area(a).abs().total_cmp(&ga::ring_signed_area(b).abs()))
            .unwrap();
        close_ring(best)
    }

    // ---------------------------------------------------- H0 : petit, collé

    #[test]
    fn narrow_hole_stays_closed_while_a_large_one_opens() {
        let narrow = rect(5.0, 5.0, 6.0, 15.0); // 1,0 de large = 2 * 0,5
        let holes = [narrow, big_hole_10x12()];
        assert_eq!(plan_channels(&part_40x20(), &holes, 0.5), vec![Small, Open]);
        let ring = open_holes_difference(&part_40x20(), &holes, 0.5);
        assert_simple_ring(&ring, &part_40x20());
        assert!(contains(&ring, 5.5, 10.0)); // le trou étroit est plein
        assert!(!contains(&ring, 26.0, 10.0)); // le grand est ouvert
        assert!((area_of(&ring) - (800.0 - 120.0 - 5.0 * 0.5)).abs() <= 0.5);
    }

    #[test]
    fn hole_just_wider_than_twice_the_width_is_not_small() {
        let wider = rect(5.0, 5.0, 6.2, 15.0); // 1,2 de large > 2 * 0,5
        assert_eq!(plan_channels(&part_40x20(), &[wider], 0.5), vec![Open]);
    }

    #[test]
    fn small_decision_does_not_depend_on_neighbours() {
        let narrow = rect(5.0, 5.0, 6.0, 15.0);
        assert_eq!(plan_channels(&part_40x20(), &[narrow.clone()], 0.5), vec![Small]);
        assert_eq!(open_holes_difference(&part_40x20(), &[narrow], 0.5), part_40x20());
    }

    #[test]
    fn hole_touching_the_exterior_stays_closed() {
        let flush = rect(2.0, 0.005, 8.0, 10.0); // à 0,005 du bord bas : canal < 0,01
        let holes = [flush, big_hole_10x12()];
        assert_eq!(plan_channels(&part_40x20(), &holes, 0.6), vec![Flush, Open]);
        let ring = open_holes_difference(&part_40x20(), &holes, 0.6);
        assert_simple_ring(&ring, &part_40x20());
        assert!(contains(&ring, 5.0, 5.0)); // le trou collé est plein
    }

    #[test]
    fn hole_at_the_flush_limit_is_not_flush() {
        // Canal de 0,02 mm (>= 0,01) : jugé par les autres règles, pas flush.
        assert_ne!(plan_channels(&part_40x20(), &[rect(2.0, 0.02, 8.0, 10.0)], 0.6), vec![Flush]);
    }

    // ------------------------------------------------------- H1 : conflit

    #[test]
    fn index_order_decides_which_of_two_crossing_holes_opens() {
        // DIAMOND_NEAR a le canal le plus court (17 mm contre 38 mm) : examiné
        // par longueur il s'ouvrirait toujours. En ordre d'index, le premier
        // listé s'ouvre et le second est en conflit, quelles que soient les
        // longueurs (jumeau du test Python du même nom).
        for order in [[0usize, 1], [1, 0]] {
            for w in [0.6, 1.1, 2.1] {
                let pool = [diamond_far(), diamond_near()];
                let holes: Vec<Vec<Pt>> = order.iter().map(|&i| pool[i].clone()).collect();
                assert_eq!(plan_channels(&square_100(), &holes, w), vec![Open, Conflict], "w={w} order={order:?}");
                let ring = open_holes_difference(&square_100(), &holes, w);
                assert_simple_ring(&ring, &square_100());
                let first = [(57.0, 50.0), (77.0, 50.0)][order[0]];
                let second = [(57.0, 54.0), (77.0, 54.0)][order[1]];
                assert!(!contains(&ring, first.0, first.1), "w={w} order={order:?}");
                assert!(contains(&ring, second.0, second.1), "w={w} order={order:?}");
            }
        }
    }

    #[test]
    fn parallel_channels_closer_than_the_tolerance() {
        let holes = wedge_pair(0.605); // canaux de 0,6 de large, à 0,005 l'un de l'autre
        assert_eq!(plan_channels(&part_60x100(), &holes, 0.6), vec![Open, Conflict]);
        let ring = open_holes_difference(&part_60x100(), &holes, 0.6);
        assert_simple_ring(&ring, &part_60x100());
        assert!(!contains(&ring, 30.0, 47.0)); // trou du bas ouvert
        assert!(contains(&ring, 30.0, 52.5)); // trou du haut plein
    }

    #[test]
    fn parallel_channels_far_enough_both_open() {
        // R3.2 : l'écart entre deux canaux ouverts dépasse DEPTH_FACTOR·w
        // (0,33 pour w = 0,6) ; 0,7·w d'écart (d = w + 0,42) : les deux s'ouvrent.
        let holes = wedge_pair(0.6 + 0.7 * 0.6);
        assert_eq!(plan_channels(&part_60x100(), &holes, 0.6), vec![Open, Open]);
        assert_simple_ring(&open_holes_difference(&part_60x100(), &holes, 0.6), &part_60x100());
    }

    #[test]
    fn parallel_channels_at_a_third_of_the_width_conflict() {
        // R3.2 : écart 0,3·w (0,18 pour w = 0,6) : au-delà de CONFLICT_TOL
        // (0,01) mais sous DEPTH_FACTOR·w, donc conflit.
        let holes = wedge_pair(0.6 + 0.3 * 0.6);
        assert_eq!(plan_channels(&part_60x100(), &holes, 0.6), vec![Open, Conflict]);
    }

    #[test]
    fn independent_holes_all_open() {
        assert_eq!(plan_channels(&square(), &[hole_r35(), hole_r5()], 1.1), vec![Open, Open]);
    }

    // ---------------------------------------------------------- H2 : profond

    #[test]
    fn thin_frame_stays_closed_and_returns_the_outer_ring() {
        let (outer, holes) = thin_frame();
        for w in [0.6, 1.1, 2.1] {
            assert_eq!(plan_channels(&outer, &holes, w), vec![Deep], "w={w}");
            assert_eq!(open_holes_difference(&outer, &holes, w), outer, "w={w}");
        }
    }

    #[test]
    fn frame_with_a_3mm_wall_opens() {
        let (outer, holes) = wall3_frame();
        for w in [0.6, 1.1, 2.1] {
            assert_eq!(plan_channels(&outer, &holes, w), vec![Open], "w={w}");
            let ring = open_holes_difference(&outer, &holes, w);
            assert_simple_ring(&ring, &outer);
            assert!(!contains(&ring, 8.0, 5.5), "w={w}");
        }
    }

    #[test]
    fn tongue_stays_closed() {
        let outer = rect(0.0, 0.0, 20.0, 20.0);
        for w in [0.6, 1.1, 2.1] {
            assert_eq!(plan_channels(&outer, &[tongue_hole(w)], w), vec![Deep], "w={w}");
            assert_eq!(open_holes_difference(&outer, &[tongue_hole(w)], w), outer, "w={w}");
        }
    }

    #[test]
    fn key_stays_closed() {
        for w in [1.1, 2.1] {
            assert_eq!(plan_channels(&rect(0.0, 0.0, 20.0, 17.0), &[key_hole()], w), vec![Deep], "w={w}");
        }
    }

    #[test]
    fn deep_hole_does_not_block_the_others() {
        let outer = rect(0.0, 0.0, 60.0, 30.0);
        let thin_wall = rect(0.3, 0.3, 9.7, 4.7); // parois de 0,3 mm à gauche et en bas
        let large = rect(25.0, 5.0, 50.0, 25.0);
        for w in [0.6, 1.1] {
            assert_eq!(plan_channels(&outer, &[thin_wall.clone(), large.clone()], w), vec![Deep, Open], "w={w}");
        }
    }

    // ------------------------------------------- H3 : éclaté, anneau simple

    #[test]
    fn split_part_returns_the_outer_ring() {
        let (outer, holes) = u_part(20.0);
        // Le prolongement du canal coupe le bras mince en deux : 4,35 mm²
        // seraient ignorés par le moteur, la pièce garde tous ses trous fermés.
        assert_eq!(plan_channels(&outer, &holes, 0.6), vec![Open]);
        assert_eq!(open_holes_difference(&outer, &holes, 0.6), outer);
    }

    #[test]
    fn dropped_piece_just_above_the_limit_returns_the_outer_ring() {
        let (outer, holes) = u_part(11.42); // morceau abandonné 0,5 * 0,12 = 0,06 mm²
        assert_eq!(open_holes_difference(&outer, &holes, 0.6), outer);
    }

    #[test]
    fn dropped_sliver_under_the_limit_is_ignored() {
        let (outer, holes) = u_part(11.38); // morceau abandonné 0,5 * 0,08 = 0,04 mm² < 0,05
        let ring = open_holes_difference(&outer, &holes, 0.6);
        assert_ne!(ring, outer);
        assert_simple_ring(&ring, &outer);
        assert!(!contains(&ring, 6.5, 11.0)); // le trou est ouvert
        assert!((area_of(&ring) - (area_of(&outer) - area_of(&holes[0]))).abs() <= 2.0);
    }

    #[test]
    fn simple_ring_check() {
        let cases: [(Vec<Pt>, bool); 4] = [
            (vec![[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0], [0.0, 0.0]], true),
            (vec![[0.0, 0.0], [4.0, 4.0], [4.0, 0.0], [0.0, 4.0], [0.0, 0.0]], false), // noeud papillon
            (vec![[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [2.0, 2.0], [0.0, 4.0], [2.0, 2.0], [0.0, 0.0]], false), // sommet répété
            (vec![[0.0, 0.0], [4.0, 0.0], [2.0, 0.0], [0.0, 0.0]], false), // dégénéré
        ];
        for (ring, simple) in cases {
            assert_eq!(is_simple_ring(&ring), simple, "{ring:?}");
        }
    }

    // -------------------------------------- inchangé là où les règles ne jouent

    #[test]
    fn host_ring_identical_to_previous_construction() {
        let (outer, holes) = host_ring();
        for width in [0.01, 0.2, 1.1, 2.1, 2.5] {
            let new = open_holes_difference(&outer, &holes, width);
            assert_eq!(new, previous_open_holes_difference(&outer, &holes, width), "w={width}");
            assert_ne!(new, outer, "w={width} : le trou doit être ouvert");
        }
    }

    #[test]
    fn host_ring_default_width_identical() {
        let (outer, holes) = host_ring();
        assert_eq!(
            open_holes_difference(&outer, &holes, CHANNEL_WIDTH),
            previous_open_holes_difference(&outer, &holes, CHANNEL_WIDTH)
        );
    }

    #[test]
    fn host_ring_spacing_widths_identical() {
        let (outer, holes) = host_ring();
        for space in [0.0, 0.5, 1.0, 2.0] {
            let w = channel_width_for_space(space);
            assert_eq!(
                open_holes_difference(&outer, &holes, w),
                previous_open_holes_difference(&outer, &holes, w),
                "space={space}"
            );
        }
    }

    #[test]
    fn no_spacing_keeps_the_existing_shapes_identical() {
        for holes in [
            vec![hole_r35()],
            vec![hole_r35(), hole_r5()],
            vec![hole_r35(), hole_r5_collinear()],
        ] {
            assert_eq!(
                open_holes_difference(&square(), &holes, CHANNEL_WIDTH),
                previous_open_holes_difference(&square(), &holes, CHANNEL_WIDTH)
            );
        }
    }

    // ----------------------------------------------------- plan, sans trous

    #[test]
    fn plan_without_holes_is_empty() {
        assert!(plan_channels(&square(), &[], CHANNEL_WIDTH).is_empty());
    }

    #[test]
    fn nothing_opened_returns_the_outer_ring_unchanged() {
        let ring = open_holes_difference(&part_40x20(), &[rect(5.0, 5.0, 6.0, 15.0)], 0.5);
        assert_eq!(ring, part_40x20());
    }

    #[test]
    fn decision_names_are_stable() {
        let names: Vec<&str> = [Open, Small, Flush, Conflict, Deep].iter().map(|d| d.name()).collect();
        assert_eq!(names, ["open", "small", "flush", "conflict", "deep"]);
    }

    // ------------------------------------------- propres au jumeau Rust

    #[test]
    fn two_narrow_triangles_stay_closed() {
        // Le test du 16/11 (deux canaux bord à bord) : ces deux triangles font
        // 0,5 de large, moins de 2 * 0,6 : les règles les laissent fermés.
        let outer = closed(&[[0.0, 0.0], [0.0, 100.0], [100.0, 100.0], [100.0, 0.0]]);
        let h1 = closed(&[[31.85, 80.0], [32.35, 80.0], [32.1, 90.0]]);
        let h2 = closed(&[[32.45, 80.0], [32.95, 80.0], [32.7, 90.0]]);
        assert_eq!(plan_channels(&outer, &[h1.clone(), h2.clone()], 0.6), vec![Small, Small]);
        assert_eq!(open_holes_difference(&outer, &[h1, h2], 0.6), outer);
    }

    #[test]
    fn thin_frame_with_a_skewed_channel_stays_closed() {
        // Cadre 10 x 5, trou collé au coin bas gauche : le point extérieur le
        // plus proche est (0,3000000000000007 ; 0), le rectangle est penché de
        // 1e-15 et son bord gauche est presque colinéaire avec le bord de la
        // pièce. L'arrangement perd alors une face ; la garde d'aire ferme.
        // Python (GEOS) donne aussi « deep » sur ces entrées.
        let outer = closed(&[[0.0, 5.0], [10.0, 5.0], [10.0, 0.0], [0.0, 0.0]]);
        let hole = rect(0.3, 0.3, 5.0, 3.0);
        assert_eq!(plan_channels(&outer, &[hole], 0.6), vec![Deep]);
    }

    #[test]
    fn sample_on_the_hole_boundary_is_not_in_the_material() {
        // Cadre 10 x 5 à parois de 0,1 mm (dessin du corpus, w = 1,1). Les
        // échantillons de grille posés pile sur le bord du trou ne comptent pas
        // (contains_xy exclut le bord) et les autres colonnes (pas de 0,1375 >
        // 0,1) enjambent la paroi. Révision 1 : « open ». Révision 2 : les
        // échantillons de contour voient la paroi, donc « deep » (le test
        // épinglait « Open » avant la règle).
        let outer = closed(&[[0.0, 0.0], [0.0, 5.0], [10.0, 5.0], [10.0, 0.0]]);
        let hole = closed(&[[9.9, 0.1], [9.9, 4.9], [0.1, 4.9], [0.1, 0.1]]);
        assert_eq!(plan_channels(&outer, &[hole], 1.1), vec![Deep]);
    }

    #[test]
    fn frames_thinner_than_the_grid_step_stay_closed() {
        // Une paroi plus fine que width/8 tombe entre les échantillons de la
        // grille : seuls les échantillons de contour la voient.
        for space in [0.5, 1.0, 2.0] {
            for wall in [0.2, 0.1, 0.08] {
                let w = channel_width_for_space(space);
                let outer = rect(0.0, 0.0, 10.0, 5.0);
                let holes = vec![rect(wall, wall, 10.0 - wall, 5.0 - wall)];
                assert_eq!(plan_channels(&outer, &holes, w), vec![Deep], "wall={wall} space={space}");
                assert_eq!(open_holes_difference(&outer, &holes, w), outer, "wall={wall} space={space}");
            }
        }
    }

    #[test]
    fn constants_of_revision_2() {
        assert_eq!(DEPTH_MAX_STEPS, 4096);
        assert_eq!(DEPTH_FACTOR, 0.55);
        assert_eq!(DEPTH_GRID, 8);
    }

    #[test]
    fn along_axis_steps_are_capped() {
        // Canal de 190 mm à w = 0,1 : 190,4 / 0,0125 = 15232 pas sans plafond.
        assert_eq!(depth_steps(190.4, 0.0125), 4096);
        assert_eq!(depth_steps(4096.0, 1.0), 4096);
        assert_eq!(depth_steps(4097.0, 1.0), 4096);
        assert_eq!(depth_steps(10.0, 1.0), 10);
        assert_eq!(depth_steps(0.0, 1.0), 1);
    }

    #[test]
    fn very_long_channel_at_a_small_width_decides_quickly() {
        // Pièce 400 x 400, trou 20 x 20 au centre : canal d'environ 190 mm. A
        // w = 0,1 le pas de grille est 0,0125 mm : plus de 15 000 pas sans
        // plafond (jumeau du test Python ; le plafond ne se voit que par la
        // décision « open » et le temps).
        let outer = rect(0.0, 0.0, 400.0, 400.0);
        let hole = rect(190.0, 190.0, 210.0, 210.0);
        let t = std::time::Instant::now();
        assert_eq!(plan_channels(&outer, &[hole], 0.1), vec![Open]);
        assert!(t.elapsed().as_secs_f64() < 2.0);
    }

    #[test]
    fn filled_polygon_distance_rules() {
        let a = rect(0.0, 0.0, 10.0, 10.0);
        // Contenu : distance nulle, sans contour à portée.
        assert!(filled_within(&a, &rect(4.0, 4.0, 6.0, 6.0), CONFLICT_TOL));
        assert!(filled_within(&rect(4.0, 4.0, 6.0, 6.0), &a, CONFLICT_TOL));
        // Contours qui se croisent.
        assert!(filled_within(&a, &rect(8.0, 8.0, 12.0, 12.0), CONFLICT_TOL));
        // À 0,005 : en conflit ; à 0,02 : non.
        assert!(filled_within(&a, &rect(10.005, 0.0, 12.0, 10.0), CONFLICT_TOL));
        assert!(!filled_within(&a, &rect(10.02, 0.0, 12.0, 10.0), CONFLICT_TOL));
        // Boîtes disjointes.
        assert!(!filled_within(&a, &rect(50.0, 50.0, 51.0, 51.0), CONFLICT_TOL));
    }

    // ---------------------------------------- toujours un anneau simple

    #[test]
    fn result_is_always_one_simple_ring() {
        let host = host_ring();
        let u_split = u_part(20.0);
        let u_sliver = u_part(11.38);
        let u_over = u_part(11.42);
        let cases: Vec<(&str, Vec<Pt>, Vec<Vec<Pt>>, f64)> = vec![
            ("r35", square(), vec![hole_r35()], 1.1),
            ("r35+r5", square(), vec![hole_r35(), hole_r5()], 1.1),
            ("collinear", square(), vec![hole_r35(), hole_r5_collinear()], 0.6),
            ("narrow+big", part_40x20(), vec![rect(5.0, 5.0, 6.0, 15.0), big_hole_10x12()], 0.5),
            ("flush+big", part_40x20(), vec![rect(2.0, 0.005, 8.0, 10.0), big_hole_10x12()], 0.6),
            ("line", square_100(), vec![diamond_far(), diamond_near()], 1.1),
            ("line-rev", square_100(), vec![diamond_near(), diamond_far()], 2.1),
            ("side-by-side-close", part_60x100(), wedge_pair(0.605), 0.6),
            ("side-by-side-far", part_60x100(), wedge_pair(0.8), 0.6),
            ("thin-frame", thin_frame().0, thin_frame().1, 1.1),
            ("frame3", wall3_frame().0, wall3_frame().1, 2.1),
            ("tongue", rect(0.0, 0.0, 20.0, 20.0), vec![tongue_hole(2.1)], 2.1),
            ("key", rect(0.0, 0.0, 20.0, 17.0), vec![key_hole()], 2.1),
            ("u-split", u_split.0, u_split.1, 0.6),
            ("u-sliver", u_sliver.0, u_sliver.1, 0.6),
            ("u-over", u_over.0, u_over.1, 0.6),
            ("host", host.0, host.1, 2.1),
        ];
        for (name, outer, holes, w) in cases {
            let ring = open_holes_difference(&outer, &holes, w);
            assert!(is_simple_ring(&ring), "{name}");
            assert_simple_ring(&ring, &outer);
        }
    }
}

/// Révision 3 (SPEC_H, section « Revision 3 ») : R3.1 trous dégénérés et
/// anneaux fermés à l'entrée, R3.2 distance canal-canal, R3.3 résultat
/// prouvé, R3.4 H2 sur le voisinage du rectangle. Chaque garde a un test qui
/// échoue quand on la retire.
#[cfg(test)]
mod rev3 {
    use super::*;
    use ChannelDecision::*;


    fn pts(r: &[[u64; 2]]) -> Vec<Pt> {
        r.iter().map(|p| [f64::from_bits(p[0]), f64::from_bits(p[1])]).collect()
    }

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Pt> {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    }

    fn area(ring: &[Pt]) -> f64 {
        ga::ring_signed_area(ring).abs()
    }

    fn inside(ring: &[Pt], p: Pt) -> bool {
        ga::point_in_ring(p, ring)
    }

    fn part_40x20() -> Vec<Pt> {
        rect(0.0, 0.0, 40.0, 20.0)
    }

    fn big_hole() -> Vec<Pt> {
        rect(20.0, 5.0, 32.0, 15.0)
    }

    /// Centre d'un trou convexe (moyenne des sommets distincts).
    fn centre(ring: &[Pt]) -> Pt {
        let n = ring.len() - 1;
        [
            ring[..n].iter().map(|p| p[0]).sum::<f64>() / n as f64,
            ring[..n].iter().map(|p| p[1]).sum::<f64>() / n as f64,
        ]
    }

    fn assert_simple(ring: &[Pt]) {
        assert!(is_simple_ring(ring), "anneau non simple : {ring:?}");
    }

    fn edges_of(ring: &[Pt]) -> Vec<(Pt, Pt)> {
        ring.windows(2).map(|w| (w[0], w[1])).collect()
    }

    /// Rectangle de canal du trou `hole` dans `outer` (comme `plan`).
    fn channel_of(outer: &[Pt], hole: &[Pt], w: f64) -> Vec<Pt> {
        let (a, b) = nearest_points(hole, outer).unwrap();
        channel_rectangle(a, b, w).unwrap()
    }

    // ------------------------------------------------------------ R3.3 / F1

    /// Les cinq entrees F1 du fuzz (w5/fuzz.txt), telles que serde_json les LIT (parse
    /// par defaut, a 1 ulp pres de la valeur exacte) : motifs de bits exacts, aucun
    /// parseur JSON dans le test. Colonne 3 : aire attendue de l'anneau (mm2).
    #[allow(clippy::type_complexity)]
    const F1_CASES: [(&str, f64, &[[u64; 2]], &[&[[u64; 2]]], f64); 5] = [
        ("1415_shift_w2_1", 2.1, &[[0xc03a618dca9d14da, 0x4023d4704fdc311a], [0xc02ebaf7fa3f3af1, 0xc0219999dd70a0ba], [0xc03aa64bcee05c58, 0xc02ee266a8febc51], [0xc042d52ece2ee9dd, 0x400a2e8e11385610], [0xc03a618dca9d14da, 0x4023d4704fdc311a]], &[&[[0xc03ac509a0288b50, 0x3fedafa0153704d1], [0xc03d9e86bfa0f006, 0xbfe7fcced95f6018], [0xc03bf123482c3cdf, 0xc00ccb1cb21afdae], [0xc03917a628b3d829, 0xbffec001eceac8e8], [0xc03ac509a0288b50, 0x3fedafa0153704d1]]], 257.79827034071),
        ("1838_shift_w2_1", 2.1, &[[0xc049d1594e5c5964, 0xc041a845dfe1e172], [0xc021e13730089790, 0x40264ff5d186555b], [0x4048a3c395d87286, 0xc0452ab208ef9208], [0x401a55c09bf1f830, 0xc056337aae998468], [0xc049d1594e5c5964, 0xc041a845dfe1e172]], &[&[[0xc018f6140f67e838, 0xc04a4d8b9ed54285], [0x3ff551793c715301, 0xc0462e88a363da34], [0xc01ba3b98c6eedc8, 0xc042653a57935296], [0xc02cf715f5799561, 0xc046843d5304bae6], [0xc018f6140f67e838, 0xc04a4d8b9ed54285]], &[[0xc04499b747b314da, 0xc03af380de7918f2], [0xc048630593839c78, 0xc04198c36aadf4c8], [0xc04444029812342a, 0xc0456211b67e7c65], [0xc0407ab44c41ac8c, 0xc041430ebb0d1416], [0xc04499b747b314da, 0xc03af380de7918f2]]], 4687.88335),
        ("197_shift_w0_1", 0.1, &[[0x3fd0b9d4bee1bc40, 0xc03de68459ebc5eb], [0xc00e24c7727ba5bd, 0xc03d02422113e346], [0xc005bcfd3481e260, 0xc03842c412b4b9dd], [0x3ff4fe09ababf5cb, 0xc03927064b8c9c81], [0x3fd0b9d4bee1bc40, 0xc03de68459ebc5eb]], &[&[[0xbff3c910e5e89872, 0xc0398af8a72ccdc9], [0xbfe248725f207ea8, 0xc039b0a83f7452cf], [0xbfdb24feac5fbba1, 0xc039065ac40ecd3d], [0xbff16e1761704806, 0xc038e0ab2bc74837], [0xbff3c910e5e89872, 0xc0398af8a72ccdc9]], &[[0x3fc9b545e4e8fca1, 0xc039dc66c4fb7958], [0x3febb700e5eaf168, 0xc03a02165d42fe5e], [0x3ff03679f76dc921, 0xc03957c8e1dd78cc], [0x3fd646890455c000, 0xc03932194995f3c6], [0x3fc9b545e4e8fca1, 0xc039dc66c4fb7958]]], 19.06947),
        ("197_shift_w0_2", 0.2, &[[0x3fd0b9d4bee1bc40, 0xc03de68459ebc5eb], [0xc00e24c7727ba5bd, 0xc03d02422113e346], [0xc005bcfd3481e260, 0xc03842c412b4b9dd], [0x3ff4fe09ababf5cb, 0xc03927064b8c9c81], [0x3fd0b9d4bee1bc40, 0xc03de68459ebc5eb]], &[&[[0xbfd7b8ea40b5b008, 0xc03909623aae9dfe], [0xbfe09268294b78dc, 0xc039b3afb6142390], [0x3fc2dd1d0d94e590, 0xc039d95f4e5ba897], [0x3fd2da7498abb478, 0xc0392f11d2f62306], [0xbfd7b8ea40b5b008, 0xc03909623aae9dfe]], &[[0x3fc9b545e4e8fca1, 0xc039dc66c4fb7958], [0x3febb700e5eaf168, 0xc03a02165d42fe5e], [0x3ff03679f76dc921, 0xc03957c8e1dd78cc], [0x3fd646890455c000, 0xc03932194995f3c6], [0x3fc9b545e4e8fca1, 0xc039dc66c4fb7958]], &[[0xbff72f86ef4877ce, 0xc03a3feefda12ac9], [0xbff4d48d6ad02762, 0xc03995a1823ba536], [0xbfff796521288081, 0xc0396ff1e9f4202f], [0xc000ea2f52d06876, 0xc03a1a3f6559a5c1], [0xbff72f86ef4877ce, 0xc03a3feefda12ac9]]], 18.25782),
        ("995_rev_w0_1", 0.1, &[[0x404d14565fd25d8e, 0x4050bf9582989590], [0x4033db5094b96b72, 0x40580259b52a55f6], [0xc0415e6c1e4c279d, 0x403809a6a811764b], [0x400c841f72980381, 0xc01405a888d62d30], [0x404d14565fd25d8e, 0x4050bf9582989590]], &[&[[0x401ddc41f322599c, 0x4043e703b270ea10], [0xbfef0cc4687aedff, 0x403cae213f7d1ca2], [0x40244f000441c01e, 0x40343eaa9f70aecb], [0x403296f6a22d4de6, 0x403f5e90c4d5664a], [0x401ddc41f322599c, 0x4043e703b270ea10]]], 4147.39342),
    ];

    /// Fuzz F2 (w5/fuzz.txt, s20261116_803 a w = 0,6) : cadre mince, trou arrondi de 21
    /// sommets ; motifs de bits exacts.
    const F2_OUTER: &[[u64; 2]] = &[[0xc039205f1663165b, 0x40343659e2f54a86], [0xc038bce8e61a634d, 0x4034a667d7bff6f0], [0xc03836234384cbdb, 0x4034e7de40bb7368], [0xc037a092be4c2415, 0x4034f0c5cd0108cd], [0xc02aa03715b1ff01, 0x4033850fc2ae4d32], [0xc029850a6f032f8b, 0x4033540d67df2b9a], [0xc028a4ee856dd6b7, 0x4032f0973796788d], [0xc0282201b376ddc6, 0x403269d19500e11a], [0xc02810329aebb2fd, 0x4031d4410fc83955], [0xc02c821d7c1f7d19, 0x3ffb1bbe47b21af6], [0xc02ce42231bdc048, 0x3ff24259123b9f42], [0xc02dab0e924f2663, 0x3fe682f38b21b14a], [0xc02eb899d77a5549, 0x3fdca84cd764447a], [0xc02fe3bae1eba4d3, 0x3fda6e69c5feeb5e], [0xc03a4254a468f6fe, 0x3ffd56fb16ab7482], [0xc03acfeaf7c05eba, 0x4000339061cec6fe], [0xc03b3ff8ec8b0b23, 0x40034f41e4145f69], [0xc03b816f5586879c, 0x4007856ef8c11aff], [0xc03b8a56e1cc1d00, 0x400c31f322865928], [0xc0395161713237f2, 0x4033a8c38f9de2cb], [0xc039205f1663165b, 0x40343659e2f54a86]];
    const F2_HOLE: &[[u64; 2]] = &[[0xc0390506bb3f4fc4, 0x400eb3bbfa736981], [0xc03098a64954aba1, 0x40056b7e0aee0a75], [0xc0307abc951623ac, 0x400579bd51c3c648], [0xc0305fc8415e9efc, 0x4005e27ac6895a3c], [0xc0304be3d15014c6, 0x400695c44e3407b4], [0xc03042168bf37475, 0x4007784e6d264744], [0xc02c979ecf773e40, 0x40312d783769601e], [0xc02c9b2ea12cad34, 0x40314b61eba7e812], [0xc02cb55dfe5e1232, 0x403166563f5f6cc2], [0xc02ce2306048bd8f, 0x40317a3aaf6df6f9], [0xc02d1ad2e8054d74, 0x40318407f4ca974a], [0xc036f9c9e5ed4ade, 0x4032ad0fb2bb432c], [0xc03717b39a2bd2d2, 0x4032ab47c9e08bb1], [0xc03732a7ede35782, 0x40329e301b47d932], [0xc037468c5df1e1b9, 0x403287c6ea528384], [0xc0375059a34e820a, 0x40326b75a6743b92], [0xc03946a0c786575f, 0x4010b41cf2be9171], [0xc03944d8deab9fe4, 0x40103c7621c471a0], [0xc03937c13012ed66, 0x400fa149a5ccbdbc], [0xc0392157ff1d97b7, 0x400f022625586c0c], [0xc0390506bb3f4fc4, 0x400eb3bbfa736981]];

    #[test]
    fn f1_reproducers_return_the_right_ring() {
        // Les cinq entrees du fuzz F1 : le parse JSON par defaut de serde_json (celui du
        // wasm) les decale d'1 ulp. L'anneau rendu est le bon : tous les trous sont
        // ouverts, aucun n'est recouvert, l'aire est celle de ext - trous - canaux.
        for (name, w, outer, holes, expected_area) in F1_CASES {
            let outer = pts(outer);
            let holes: Vec<Vec<Pt>> = holes.iter().map(|h| pts(h)).collect();
            let decisions = plan_channels(&outer, &holes, w);
            assert!(decisions.iter().all(|d| *d == Open), "{name}: {decisions:?}");
            let ring = open_holes_difference(&outer, &holes, w);
            assert_ne!(ring, outer, "{name}: l'anneau externe est rendu tel quel");
            assert_simple(&ring);
            for h in &holes {
                assert!(!inside(&ring, centre(h)), "{name}: un trou ouvert est recouvert par l'anneau");
            }
            let got = area(&ring);
            assert!((got - expected_area).abs() < 1e-4, "{name}: aire {got} au lieu de {expected_area}");
            let rects: Vec<Vec<Pt>> = holes.iter().map(|h| channel_of(&outer, h, w)).collect();
            let hole_refs: Vec<&[Pt]> = holes.iter().map(|h| h.as_slice()).collect();
            assert!(ring_proven(&outer, &hole_refs, &rects, &ring), "{name}");
            assert!(opened_ring(&outer, &hole_refs, &rects).is_some(), "{name}");
        }
    }

    // ----------------------------------------------------- R3.3 : les gardes

    /// Pose une panne d'arrangement (arete perdue au rang k du nodage) le temps de `f`.
    fn with_lost_edge<T>(k: usize, f: impl FnOnce() -> T) -> T {
        DROP_NODED_EDGE.with(|c| c.set(Some(k)));
        let r = f();
        DROP_NODED_EDGE.with(|c| c.set(None));
        r
    }

    fn with_forced_ring<T>(ring: Vec<Pt>, f: impl FnOnce() -> T) -> T {
        FORCE_RING.with(|c| *c.borrow_mut() = Some(ring));
        let r = f();
        FORCE_RING.with(|c| *c.borrow_mut() = None);
        r
    }

    #[test]
    fn a_healthy_arrangement_passes_the_integrity_check() {
        let faces = arrange(&edges_of(&rect(0.0, 0.0, 4.0, 4.0))).expect("carre sain");
        assert_eq!(faces.len(), 1);
        assert!((area(&faces[0]) - 16.0).abs() < 1e-12);
    }

    #[test]
    fn a_dangling_edge_fails_the_integrity_check() {
        // Un carre avec une arete pendante vers l'interieur : la meme face est de chaque
        // cote de l'arete. C'est la signature d'une frontiere perdue.
        let mut edges = edges_of(&rect(0.0, 0.0, 4.0, 4.0));
        edges.push(([2.0, 0.0], [2.0, 2.0]));
        assert!(arrange(&edges).is_none());
    }

    #[test]
    fn two_separate_components_fail_the_integrity_check() {
        // Un trou qui n'est relie a rien (deux composantes) : il n'y a pas UN bord exterieur.
        let mut edges = edges_of(&rect(0.0, 0.0, 10.0, 10.0));
        edges.extend(edges_of(&rect(3.0, 3.0, 5.0, 5.0)));
        assert!(arrange(&edges).is_none());
    }

    #[test]
    fn faces_that_do_not_tile_their_outer_boundary_fail_the_integrity_check() {
        // Cycles construits a la main : un bord exterieur de 16 mm2 pour une seule face de 9.
        let outer_cycle = vec![[0.0, 0.0], [0.0, 4.0], [4.0, 4.0], [4.0, 0.0]]; // sens horaire : -16
        let small_face = vec![[0.0, 0.0], [3.0, 0.0], [3.0, 3.0], [0.0, 3.0]]; // +9
        assert!(!integrity_ok(true, &[outer_cycle.clone(), small_face]));
        let full_face = vec![[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0]];
        assert!(integrity_ok(true, &[outer_cycle, full_face]));
        assert!(!integrity_ok(false, &[]));
    }

    #[test]
    fn a_lost_boundary_makes_the_hole_deep_and_returns_the_outer_ring() {
        // Panne : l'arrangement local perd une arete. Sans controle, le trou serait juge
        // sur des faces fausses. Avec : H2 dit « trop profond », l'anneau externe est rendu.
        let (outer, holes) = (part_40x20(), vec![big_hole()]);
        assert_eq!(plan_channels(&outer, &holes, 1.1), vec![Open]);
        for k in 0..16 {
            let d = with_lost_edge(k, || plan_channels(&outer, &holes, 1.1));
            assert_eq!(d, vec![Deep], "arete perdue au rang {k}");
            let ring = with_lost_edge(k, || open_holes_difference(&outer, &holes, 1.1));
            assert_eq!(ring, outer, "arete perdue au rang {k}");
        }
    }

    #[test]
    fn a_lost_boundary_in_the_result_arrangement_returns_the_outer_ring() {
        let (outer, hole) = (part_40x20(), big_hole());
        let rects = vec![channel_of(&outer, &hole, 1.1)];
        let holes: Vec<&[Pt]> = vec![hole.as_slice()];
        assert!(opened_ring(&outer, &holes, &rects).is_some());
        for k in 0..16 {
            assert!(with_lost_edge(k, || opened_ring(&outer, &holes, &rects)).is_none(), "rang {k}");
        }
    }

    #[test]
    fn a_ring_that_covers_an_opened_hole_is_refused() {
        // Le defaut que F1 decrivait : l'anneau rendu contient tout le trou. L'arrangement
        // est sain, l'anneau est simple : seul le controle final (point interieur du
        // trou hors de l'anneau) l'arrete.
        let (outer, hole) = (part_40x20(), big_hole());
        let rects = vec![channel_of(&outer, &hole, 1.1)];
        let holes: Vec<&[Pt]> = vec![hole.as_slice()];
        // L'anneau externe lui-meme, rendu a la place du bon : recouvre le trou.
        assert!(with_forced_ring(outer.clone(), || opened_ring(&outer, &holes, &rects)).is_none());
        assert!(!ring_proven(&outer, &holes, &rects, &outer));
    }

    #[test]
    fn the_ring_area_must_lie_between_the_bounds() {
        let (outer, hole) = (part_40x20(), big_hole());
        let rects = vec![channel_of(&outer, &hole, 1.1)];
        let holes: Vec<&[Pt]> = vec![hole.as_slice()];
        let good = opened_ring(&outer, &holes, &rects).unwrap();
        assert!(ring_proven(&outer, &holes, &rects, &good));
        // Trop petit : un carre de 1 mm2 loin du trou (le point du trou est bien hors de lui).
        let tiny = rect(1.0, 1.0, 2.0, 2.0);
        assert!(!ring_proven(&outer, &holes, &rects, &tiny));
        // Trop grand : sans trou, un anneau plus grand que l'exterieur.
        let big = rect(-1.0, -1.0, 41.0, 21.0);
        assert!(!ring_proven(&outer, &[], &[], &big));
        // Sans trou ni rectangle, l'exterieur lui-meme passe.
        assert!(ring_proven(&outer, &[], &[], &outer));
    }

    #[test]
    fn a_non_simple_ring_falls_back_to_the_outer_ring() {
        // Le vrai anneau avec un sommet repete : meme aire, trou hors de l'anneau (le
        // controle final passe), mais pas simple : seul is_simple_ring l'arrete.
        let (outer, hole) = (part_40x20(), big_hole());
        let rects = vec![channel_of(&outer, &hole, 1.1)];
        let holes: Vec<&[Pt]> = vec![hole.as_slice()];
        let good = opened_ring(&outer, &holes, &rects).unwrap();
        let mut bad = good.clone();
        bad.insert(2, bad[1]);
        assert!(!is_simple_ring(&bad));
        assert!(ring_proven(&outer, &holes, &rects, &bad));
        assert!(with_forced_ring(bad, || opened_ring(&outer, &holes, &rects)).is_none());
    }

    // ------------------------------------------------------------- H2 : gardes

    #[test]
    fn an_empty_remainder_means_deep() {
        // Une seule face, de la matiere dans le rectangle, rien autour : reste vide.
        let rect_ring = rect(0.0, -0.5, 6.0, 0.5);
        let face = Face { ring: rect_ring.clone(), probe: [3.0, 0.0], odd: true, in_rect: true };
        let outer = rect(-10.0, -10.0, 10.0, 10.0);
        let hole = rect(-5.0, -2.0, 1.0, 2.0);
        assert!(deep_from_faces(&[face], &OuterIndex::new(&outer), &hole, &rect_ring, [0.0, 0.0], 3.0, [1.0, 0.0], 1.0));
    }

    #[test]
    fn grid_samples_on_a_contour_do_not_count() {
        let ring = rect(0.0, 0.0, 4.0, 4.0);
        let face = Face { ring: ring.clone(), probe: [2.0, 2.0], odd: true, in_rect: true };
        let lost = vec![(&face, bbox_of(&ring))];
        assert!(grid_sample_counts([2.0, 2.0], &lost)); // strictement dedans
        assert!(!grid_sample_counts([2.0, 0.0], &lost)); // sur une arete
        assert!(!grid_sample_counts([0.0, 0.0], &lost)); // sur un sommet
        assert!(!grid_sample_counts([5.0, 2.0], &lost)); // dehors
    }

    #[test]
    fn the_step_cap_applies_inside_the_depth_computation() {
        // Canal de ~1000 mm a w = 0,01 : sans plafond, 8e5 pas le long de l'axe. Le
        // compteur de la grille (test seulement) vaut exactement (cap + 1) * (grille + 1).
        let outer = rect(0.0, 0.0, 2000.0, 2000.0);
        let hole = rect(1000.0, 1000.0, 1001.0, 1001.0);
        GRID_SAMPLES.with(|c| c.set(0));
        let d = plan_channels(&outer, &[hole], 0.01);
        assert_eq!(d, vec![Open]);
        let n = GRID_SAMPLES.with(|c| c.get());
        assert_eq!(n, (DEPTH_MAX_STEPS + 1) * (DEPTH_GRID + 1));
    }

    // ------------------------------------------------- R3.4 : le voisinage

    /// H2 sur la piece entiere (arrangement sans cadre), comme avant R3.4.
    fn too_deep_whole(outer: &[Pt], hole: &[Pt], rect: &[Pt], p_in: Pt, length: f64, u: Pt, width: f64) -> bool {
        let mut edges: Vec<(Pt, Pt)> = Vec::new();
        for ring in [outer, hole, rect] {
            edges.extend(edges_of(ring).into_iter().filter(|(a, b)| a != b));
        }
        let Some(cycles) = arrange(&edges) else { return true };
        let oi = OuterIndex::new(outer);
        let faces = classify(cycles, &oi, &[hole], &[rect]);
        deep_from_faces(&faces, &oi, hole, rect, p_in, length, u, width)
    }

    fn circle(cx: f64, cy: f64, r: f64, n: usize) -> Vec<Pt> {
        let mut v: Vec<Pt> = (0..n)
            .map(|k| {
                let a = std::f64::consts::TAU * k as f64 / n as f64;
                [cx + r * a.cos(), cy + r * a.sin()]
            })
            .collect();
        v.push(v[0]);
        v
    }

    #[test]
    fn local_and_whole_part_arrangements_decide_alike() {
        let frame = (rect(0.0, 0.0, 10.0, 5.0), rect(0.3, 0.3, 9.7, 4.7));
        let wall3 = (rect(0.0, 0.0, 16.0, 11.0), rect(3.0, 3.0, 13.0, 8.0));
        let disc = (circle(0.0, 0.0, 50.0, 3000), circle(5.0, 3.0, 20.0, 40));
        let slab = (part_40x20(), big_hole());
        let thin_slab = (rect(0.0, 0.0, 40.0, 20.0), rect(0.2, 0.2, 39.8, 19.8));
        let mut deep = 0;
        let mut open = 0;
        for (outer, hole) in [frame, wall3, disc, slab, thin_slab] {
            for w in [0.1, 0.6, 1.1, 2.1] {
                let Some((p_in, p_out)) = nearest_points(&hole, &outer) else { continue };
                let (dx, dy) = (p_out[0] - p_in[0], p_out[1] - p_in[1]);
                let l = (dx * dx + dy * dy).sqrt();
                let Some(r) = channel_rectangle(p_in, p_out, w) else { continue };
                let u = [dx / l, dy / l];
                let local = channel_too_deep(&OuterIndex::new(&outer), &hole, &r, p_in, l, u, w);
                let whole = too_deep_whole(&outer, &hole, &r, p_in, l, u, w);
                assert_eq!(local, whole, "w={w} outer={} points", outer.len());
                if local {
                    deep += 1
                } else {
                    open += 1
                }
            }
        }
        assert!(deep > 0 && open > 0, "le jeu doit contenir les deux issues ({deep} deep, {open} open)");
    }

    #[test]
    fn the_local_arrangement_is_small_on_a_large_outline() {
        // 50 000 sommets d'anneau externe : l'arrangement local garde les aretes de la
        // fenetre, pas celles de la piece.
        let outer = circle(0.0, 0.0, 5000.0, 50_000);
        let hole = circle(4900.0, 0.0, 40.0, 24);
        let r = channel_of(&outer, &hole, 1.1);
        let faces = local_faces(&OuterIndex::new(&outer), &hole, &r, 1.1).expect("arrangement local sain");
        let verts: usize = faces.iter().map(|f| f.ring.len()).sum();
        assert!(verts < 200, "{verts} sommets de faces");
    }

    #[test]
    fn faces_that_revisit_a_vertex_are_not_dropped() {
        // Cinq carres en chaine, touchant par un coin : le bord exterieur passe 2 fois par
        // chaque coin commun et fait 20 sommets, plus que sommets + 3 = 19 (la borne de
        // ga::polygonize, qui jetait cette face en silence : fuzz F2).
        let mut edges: Vec<(Pt, Pt)> = Vec::new();
        for k in 0..5 {
            let o = k as f64;
            edges.extend(edges_of(&rect(o, o, o + 1.0, o + 1.0)));
        }
        let (cycles, ok) = polygonize_local(&edges);
        assert!(ok);
        assert_eq!(cycles.len(), 6);
        assert_eq!(cycles.iter().map(|c| c.len()).max(), Some(20));
        assert_eq!(cycles.iter().filter(|c| ga::ring_signed_area(c) > 0.0).count(), 5);
        assert!(arrange(&edges).is_some());
    }

    #[test]
    fn f2_thin_frame_with_a_rounded_hole_opens() {
        // Fuzz F2 : « aucune face de matiere » dans l'arrangement, donc « deep » ; Python
        // et la spec disent « open ».
        let outer = pts(F2_OUTER);
        let hole = pts(F2_HOLE);
        assert_eq!(plan_channels(&outer, &[hole.clone()], 0.6), vec![Open]);
        let ring = open_holes_difference(&outer, &[hole], 0.6);
        assert_ne!(ring, outer);
        assert_simple(&ring);
    }

    #[test]
    fn near_collinear_edges_are_noded_together() {
        // Un sommet a 1e-16 d'une arete (rectangle dont le cote suit presque une arete du
        // trou) : sans accrochage les deux aretes ne partagent aucun sommet et l'arete
        // pendante fait echouer l'integrite.
        let a = [0.0, 0.0];
        let b = [0.0, 10.0];
        let c = [1e-16, 4.0];
        let d = [1e-16, 6.0];
        let (snapped, _) = snap_close_vertices(vec![(a, b), (c, d)], SNAP_EPS_MM);
        let ys: Vec<f64> = snapped.iter().flat_map(|(p, q)| [p[1], q[1]]).collect();
        assert!(snapped.len() >= 3, "{snapped:?}");
        assert!(ys.contains(&4.0) && ys.contains(&6.0));
        // Micro-arete : deux points a 1 ulp.
        let e = [5.0, 5.0];
        let f = [5.0, f64::from_bits(5.0f64.to_bits() + 1)];
        let (merged, _) = snap_close_vertices(vec![(e, f), (f, [9.0, 9.0])], SNAP_EPS_MM);
        assert_eq!(merged.len(), 1);
    }

    // -------------------------------------------------------- R3.1 : trous degeneres

    #[test]
    fn degenerate_holes_are_small_and_leave_the_outer_ring() {
        let outer = part_40x20();
        let cases: Vec<Vec<Pt>> = vec![
            vec![[20.0, 5.0], [26.0, 10.0], [32.0, 15.0]], // aire nulle, grande boite
            vec![[20.0, 5.0], [26.0, 10.0], [32.0, 15.0], [20.0, 5.0]],
            vec![[5.0, 5.0], [30.0, 15.0]], // deux points
            vec![[5.0, 5.0], [30.0, 15.0], [5.0, 5.0]],
            vec![[5.0, 5.0], [5.0, 5.0], [30.0, 15.0]], // deux sommets distincts
            vec![[5.0, 5.0]],
            vec![],
        ];
        for h in cases {
            assert_eq!(plan_channels(&outer, &[h.clone()], 1.1), vec![Small], "{h:?}");
            assert_eq!(open_holes_difference(&outer, &[h.clone()], 1.1), outer, "{h:?}");
        }
    }

    #[test]
    fn a_degenerate_hole_does_not_disturb_the_others() {
        let outer = part_40x20();
        let alone = open_holes_difference(&outer, &[big_hole()], 1.1);
        for degenerate in [vec![[5.0, 5.0], [30.0, 15.0]], vec![[20.0, 5.0], [26.0, 10.0], [32.0, 15.0]]] {
            for holes in [vec![degenerate.clone(), big_hole()], vec![big_hole(), degenerate.clone()]] {
                let mut d = plan_channels(&outer, &holes, 1.1);
                d.sort_by_key(|x| x.name());
                assert_eq!(d, vec![Open, Small]);
                assert_eq!(open_holes_difference(&outer, &holes, 1.1), alone);
            }
        }
    }

    #[test]
    fn the_degenerate_area_limit() {
        assert!(!is_degenerate_hole(&[[20.0, 5.0], [32.0, 5.0], [32.0, 5.0 + 1e-6]]));
        assert!(is_degenerate_hole(&[[20.0, 5.0], [32.0, 5.0], [32.0, 5.0 + 1e-10]]));
        assert!(!is_degenerate_hole(&[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]));
        assert!(!is_degenerate_hole(&[[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0]])); // sens horaire
        assert_eq!(DEGENERATE_HOLE_MM2, 1e-9);
    }

    #[test]
    fn closed_and_unclosed_copies_decide_the_same() {
        for hole in [big_hole()[..4].to_vec(), rect(5.0, 5.0, 6.0, 15.0)[..4].to_vec()] {
            for w in [0.5, 1.1] {
                let mut closed = hole.clone();
                closed.push(hole[0]);
                assert_eq!(
                    plan_channels(&part_40x20(), &[closed.clone()], w),
                    plan_channels(&part_40x20(), &[hole.clone()], w)
                );
                let a = open_holes_difference(&part_40x20(), &[closed], w);
                let b = open_holes_difference(&part_40x20(), &[hole.clone()], w);
                assert_eq!(a, b);
            }
        }
    }

    #[test]
    fn closed_and_unclosed_outer_with_holes_decide_the_same() {
        let open_copy = |r: &Vec<Pt>| r[..r.len() - 1].to_vec();
        let (outer, holes) = (rect(0.0, 0.0, 10.0, 5.0), vec![rect(0.3, 0.3, 9.7, 4.7)]);
        let (outer_u, holes_u): (Vec<Pt>, Vec<Vec<Pt>>) = (open_copy(&outer), holes.iter().map(open_copy).collect());
        assert_eq!(plan_channels(&outer_u, &holes_u, 1.1), plan_channels(&outer, &holes, 1.1));
        // Une piece ou le trou s'ouvre : meme anneau avec les copies ouvertes.
        let (o2, h2) = (part_40x20(), vec![big_hole()]);
        let (o2u, h2u): (Vec<Pt>, Vec<Vec<Pt>>) = (open_copy(&o2), h2.iter().map(open_copy).collect());
        assert_eq!(plan_channels(&o2u, &h2u, 1.1), vec![Open]);
        assert_eq!(open_holes_difference(&o2u, &h2u, 1.1), open_holes_difference(&o2, &h2, 1.1));
        // Rien d'ouvert : l'anneau externe est rendu tel qu'il est entre.
        assert_eq!(open_holes_difference(&outer_u, &holes_u, 1.1), outer_u);
    }

    // ------------------------------------------------ R3.2 : canal contre canal

    fn wedge_pair(d: f64) -> Vec<Vec<Pt>> {
        vec![
            vec![[40.0, 50.0], [22.0, 44.0], [22.0, 49.0], [40.0, 50.0]],
            vec![[40.0, 50.0 + d], [22.0, 50.4 + d], [22.0, 56.0], [40.0, 50.0 + d]],
        ]
    }

    #[test]
    fn channels_at_a_third_and_at_seven_tenths_of_the_width() {
        let part = rect(0.0, 0.0, 60.0, 100.0);
        for w in [0.6, 1.0, 1.5] {
            assert_eq!(plan_channels(&part, &wedge_pair(w + 0.3 * w), w), vec![Open, Conflict], "w={w}");
            assert_eq!(plan_channels(&part, &wedge_pair(w + 0.7 * w), w), vec![Open, Open], "w={w}");
        }
        // Limite 0,55 w.
        let w = 1.0;
        assert_eq!(plan_channels(&part, &wedge_pair(w + 0.54 * w), w), vec![Open, Conflict]);
        assert_eq!(plan_channels(&part, &wedge_pair(w + 0.56 * w), w), vec![Open, Open]);
    }

    #[test]
    fn the_other_three_pairs_keep_the_small_tolerance() {
        let part = rect(0.0, 0.0, 60.0, 100.0);
        let w = 1.0;
        let first = wedge_pair(2.0)[0].clone();
        for (gap, expected) in [(0.3, Open), (0.005, Conflict)] {
            let tall = rect(42.0, 50.5 + gap, 46.0, 90.0);
            assert_eq!(plan_channels(&part, &[first.clone(), tall], w), vec![Open, expected], "gap {gap}");
        }
        assert_eq!(rect_rect_tolerance(0.01), CONFLICT_TOL);
        assert_eq!(rect_rect_tolerance(1.0), 0.55);
    }

    /// Revue S1 : deux trous dont les canaux paralleles (gap) s'appuient chacun sur
    /// la pointe d'un doigt que l'autre canal efface.
    fn fingers(w: f64, gap: f64, margin: f64) -> (Vec<Pt>, Vec<Vec<Pt>>) {
        let s = w / 1.1;
        let yi = w + gap;
        let f1tip = w / 2.0 + gap + margin;
        let f2tip = w / 2.0 - margin;
        let x = |v: f64| v * s;
        let outer = vec![
            [x(-5.0), x(-6.0)],
            [x(6.0), x(-6.0)],
            [x(6.0), x(-5.0)],
            [x(7.3), x(-5.0)],
            [x(7.3), f2tip],
            [x(7.0), f2tip],
            [x(7.0), x(-4.0)],
            [x(6.0), x(-4.0)],
            [x(6.0), x(5.0) + yi],
            [x(7.0), x(5.0) + yi],
            [x(7.0), f1tip],
            [x(7.3), f1tip],
            [x(7.3), x(6.0) + yi],
            [x(6.0), x(6.0) + yi],
            [x(6.0), x(7.0) + yi],
            [x(-5.0), x(7.0) + yi],
            [x(-5.0), x(-6.0)],
        ];
        let hole_i = vec![[x(4.0), yi], [0.0, yi + x(3.0)], [0.0, w / 2.0 + 0.02], [x(4.0), yi]];
        let hole_j = vec![[x(4.0), 0.0], [0.0, w / 2.0 + gap - 0.02], [0.0, x(-3.0)], [x(4.0), 0.0]];
        (outer, vec![hole_i, hole_j])
    }

    #[test]
    fn two_fingers_leaning_on_each_other_open_only_one_hole() {
        for (space, gap, margin) in [(0.5, 0.015, 0.03), (1.0, 0.015, 0.05), (2.0, 0.015, 0.1)] {
            let w = channel_width_for_space(space);
            let (outer, holes) = fingers(w, gap, margin);
            let mut d = plan_channels(&outer, &holes, w);
            d.sort_by_key(|x| x.name());
            assert_eq!(d, vec![Conflict, Open], "space {space}");
            let ring = open_holes_difference(&outer, &holes, w);
            assert_simple(&ring);
            assert_ne!(ring, outer);
        }
    }
}
