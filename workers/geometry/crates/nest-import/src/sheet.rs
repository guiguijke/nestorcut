//! Lecteur de TÔLE : un dessin DXF qui décrit la matière (disque, chute,
//! contour quelconque) rendu sous forme de CONTOURS, sans aucun nettoyage.
//!
//! Même devant que l'import de pièces (signature du document, unités vers le
//! mm, blocs aplatis, espace papier ignoré, courbes aplaties en polygones
//! inscrits, MÊMES bornes d'entités et de temps, MÊME refus « trop lourd »),
//! puis le même nodage et la même polygonisation (`assemble`). Ce que l'import
//! de pièces fait ensuite — dissolution des murs partagés, micro-vides, règle
//! W, réduction des sommets, ergots — n'est PAS appliqué ici : un petit trou
//! d'une tôle est une zone interdite possible, il doit survivre.
//!
//! Différence avec l'import de pièces : une polyligne à ARCS (bulge) est lue
//! avec ses arcs. L'import de pièces garde la corde (D-IMP-8, parité avec le
//! pipeline Python) ; pour une tôle c'est faux et parfois dangereux — un
//! disque exporté en polyligne fermée de deux sommets à bulge 1 n'aurait aucune
//! aire, un contour arrondi perdrait ses courbes, et un arc rentrant lu en
//! corde ferait la tôle PLUS GRANDE que le métal réel. Chaque segment à bulge
//! est donc aplati comme une entité ARC (même règle de flèche, sommets SUR
//! l'arc : polygone inscrit pour un arc convexe), ses extrémités restant
//! exactement les sommets de la polyligne.
//!
//! Un contour est l'anneau extérieur d'UNE face bornée de l'arrangement plan
//! des traits. La polygonisation par « face de gauche » rend, pour chaque face
//! bornée, un cycle d'aire POSITIVE (sens anti-horaire) ; les trous d'une face
//! sont des cycles d'aire négative, écartés comme la face extérieure. Deux
//! carrés qui partagent un mur donnent donc deux contours (aucune union), et
//! un rectangle qui contient des formes donne son propre contour (son anneau
//! extérieur) en plus de celui de chaque forme.
//!
//! Un cycle de la marche peut repasser par un sommet (pont entre le contour et
//! une forme intérieure, trait ouvert posé sur un bord, forme attachée par un
//! seul sommet) : chaque cycle est coupé en boucles simples, seules les boucles
//! d'aire positive sont des contours. Les traits qui ne bordent aucune face
//! (pendants et ponts) sont comptés par groupes connexes dans `openPaths`.
//!
//! Seule exception au « rien n'est nettoyé » : une boucle plus fine que
//! `MIN_ZONE_WIDTH_MM` n'est pas un contour (voir cette constante), et ses
//! traits comptent comme ouverts.

use crate::assemble::{self, Pt};
use crate::budget::{Deadline, Expired, Limits};
use crate::dxf::entities::Entity;
use crate::dxf::flatten::{flatten_primitive, Primitive};
use crate::{dxf, ImportError, TooHeavy};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

/// Un contour de tôle : anneau extérieur d'une face bornée.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetContour {
    /// Anneau FERMÉ (premier point répété en dernier), anti-horaire, mm,
    /// repère du DXF (aucune translation), y vers le haut, grille 1e-4.
    pub ring: Vec<[f64; 2]>,
    /// 1 + nombre d'AUTRES contours qui contiennent strictement celui-ci.
    pub depth: usize,
    /// Indice (dans le même tableau) du plus petit contour qui le contient.
    pub parent: Option<usize>,
    pub area_mm2: f64,
    /// [minx, miny, maxx, maxy]
    pub bbox: [f64; 4],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetResult {
    pub contours: Vec<SheetContour>,
    pub source_units: i32,
    pub entity_count: usize,
    pub warnings: Vec<String>,
    /// Groupes connexes de traits qui ne bordent aucune face (pendants, ponts).
    pub open_paths: usize,
    /// Entités non lues (texte, cotes, hachures, …), espace papier compris.
    pub skipped_entities: usize,
}

type Key = (u64, u64);

/// Largeur moyenne (2·aire/périmètre) sous laquelle une boucle n'est pas une
/// zone : la moitié des 0,01 mm de lecture. Une polyligne OUVERTE dont les bouts
/// sont à moins de 0,01 mm est refermée (`close_ring`, comme Python) ; si elle
/// fait l'aller-retour (aiguille), la boucle obtenue a une largeur moyenne sous
/// la moitié de cet écart, quelle que soit sa longueur (0,09 mm2 mesurés pour
/// 20 mm). Un seuil d'aire ne suffit pas : à 1e-3 mm2, 2 741 aiguilles sur
/// 3 001 restaient des zones. Toute boucle sous 7,9e-5 mm2 tombe aussi
/// (2·A/P ≤ √(A/π)). Sur 324 dessins, les plus petits contours compacts gardés
/// font 9,6e-4 mm2 (0,045 mm de côté, largeur 0,0136 mm).
const MIN_ZONE_WIDTH_MM: f64 = 0.005;

/// Boucle trop fine pour être une zone (aire absolue, anneau sans fermeture).
fn too_thin_for_a_zone(ring: &[Pt], area: f64) -> bool {
    let n = ring.len();
    let mut perim = 0.0;
    for k in 0..n {
        let (a, b) = (ring[k], ring[(k + 1) % n]);
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        perim += (dx * dx + dy * dy).sqrt();
    }
    2.0 * area < MIN_ZONE_WIDTH_MM * perim
}

/// Demi-arêtes (sommet, suivant) d'une boucle sans point de fermeture.
fn half_edges(ring: &[Pt]) -> impl Iterator<Item = (Key, Key)> + '_ {
    (0..ring.len()).map(move |k| (key(ring[k]), key(ring[(k + 1) % ring.len()])))
}

fn key(p: Pt) -> Key {
    (p[0].to_bits(), p[1].to_bits())
}

/// Coupe un cycle de la marche des faces en boucles SIMPLES (méthode de la
/// pile). Une face peut repasser par un sommet (pont, trait ouvert aller et
/// retour, forme posée sur le bord en un seul sommet) : à la seconde visite
/// d'un sommet déjà sur la pile, la boucle qui se ferme là est extraite. Le
/// cycle est circulaire : le premier sommet est rejoué à la fin pour fermer la
/// dernière boucle. Rend chaque boucle sans point de fermeture.
pub(crate) fn split_simple_loops(cycle: &[Pt]) -> Vec<Vec<Pt>> {
    let mut loops: Vec<Vec<Pt>> = Vec::new();
    let mut stack: Vec<Pt> = Vec::new();
    let mut at: HashMap<Key, usize> = HashMap::new();
    let first = match cycle.first() {
        Some(&f) => f,
        None => return loops,
    };
    for &p in cycle.iter().chain(std::iter::once(&first)) {
        match at.get(&key(p)).copied() {
            Some(i) => {
                let l: Vec<Pt> = stack.drain(i + 1..).collect();
                for q in &l {
                    at.remove(&key(*q));
                }
                // La boucle est `stack[i]` suivi des sommets retirés.
                let mut ring = Vec::with_capacity(l.len() + 1);
                ring.push(p);
                ring.extend(l);
                loops.push(ring);
            }
            None => {
                at.insert(key(p), stack.len());
                stack.push(p);
            }
        }
    }
    loops
}

/// Part du sommet de plus petit x, puis de plus petit y.
fn rotate_to_lowest(ring: &mut Vec<Pt>) {
    let mut best = 0;
    for (i, p) in ring.iter().enumerate() {
        let b = ring[best];
        if p[0].total_cmp(&b[0]).then(p[1].total_cmp(&b[1])).is_lt() {
            best = i;
        }
    }
    ring.rotate_left(best);
}

/// Nombre de groupes connexes de traits qui ne bordent aucune face : une arête
/// ne borde aucune face quand ses deux demi-arêtes orientées sont dans le MÊME
/// cycle de la marche (trait pendant, pont, trait aller et retour). Les arêtes
/// sont regroupées par sommets communs. Un trait isolé (deux sommets) n'est
/// rendu par la marche dans aucun cycle (moins de 3 sommets) : ses deux
/// demi-arêtes sans cycle comptent aussi comme « ne borde aucune face ».
/// Une arête d'une boucle trop fine (`thin`) qui ne borde aucun contour gardé
/// (`kept`) est ouverte aussi : l'aiguille refermée reste un trait ouvert.
fn open_stroke_groups(
    edges: &[(Pt, Pt)],
    cycles: &[Vec<Pt>],
    thin: &HashSet<(Key, Key)>,
    kept: &HashSet<(Key, Key)>,
    dl: &Deadline,
) -> Result<usize, Expired> {
    let mut owner: HashMap<(Key, Key), usize> = HashMap::new();
    for (ci, c) in cycles.iter().enumerate() {
        dl.check_at(ci)?;
        for (k, &a) in c.iter().enumerate() {
            let b = c[(k + 1) % c.len()];
            owner.insert((key(a), key(b)), ci);
        }
    }
    let mut parent: HashMap<Key, Key> = HashMap::new();
    fn find(parent: &mut HashMap<Key, Key>, x: Key) -> Key {
        let mut r = x;
        while let Some(&p) = parent.get(&r) {
            if p == r {
                break;
            }
            r = p;
        }
        let mut c = x;
        while c != r {
            let next = parent[&c];
            parent.insert(c, r);
            c = next;
        }
        r
    }
    for (i, &(a, b)) in edges.iter().enumerate() {
        dl.check_at(i)?;
        let (ka, kb) = (key(a), key(b));
        if ka == kb {
            continue;
        }
        let open = match (owner.get(&(ka, kb)), owner.get(&(kb, ka))) {
            (Some(x), Some(y)) => x == y,
            (None, None) => true,
            _ => false,
        } || ((thin.contains(&(ka, kb)) || thin.contains(&(kb, ka)))
            && !kept.contains(&(ka, kb))
            && !kept.contains(&(kb, ka)));
        if open {
            parent.entry(ka).or_insert(ka);
            parent.entry(kb).or_insert(kb);
            let (ra, rb) = (find(&mut parent, ka), find(&mut parent, kb));
            if ra != rb {
                parent.insert(ra, rb);
            }
        }
    }
    let keys: Vec<Key> = parent.keys().copied().collect();
    let mut roots: HashSet<Key> = HashSet::new();
    for k in keys {
        roots.insert(find(&mut parent, k));
    }
    Ok(roots.len())
}

fn bbox_of(r: &[Pt]) -> [f64; 4] {
    r.iter().fold(
        [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY],
        |a, p| [a[0].min(p[0]), a[1].min(p[1]), a[2].max(p[0]), a[3].max(p[1])],
    )
}

/// Contours d'un jeu d'arêtes déjà nodées et snappées (cœur testable sans
/// DXF). Rend aussi le nombre de chaînes ouvertes.
pub fn contours_of_edges(
    edges: &[(Pt, Pt)],
    dl: &Deadline,
) -> Result<(Vec<SheetContour>, usize), Expired> {
    // Marche des faces sur TOUTES les arêtes (pas de pelage préalable : le
    // découpage en boucles simples écarte les traits pendants, les ponts et
    // les formes attachées par un sommet, qui sont des boucles d'aire nulle ou
    // négative).
    let cycles = assemble::polygonize_until(&[], edges, dl)?;
    let mut faces: Vec<Vec<Pt>> = Vec::new();
    let (mut thin, mut kept) = (HashSet::new(), HashSet::new());
    for (i, c) in cycles.iter().enumerate() {
        dl.check_at(i)?;
        for mut l in split_simple_loops(c) {
            // Faces bornées = boucles d'aire strictement positive, assez larges.
            let area = assemble::ring_signed_area(&l);
            if l.len() >= 3 && area > 1e-10 {
                if too_thin_for_a_zone(&l, area) {
                    thin.extend(half_edges(&l));
                    continue;
                }
                kept.extend(half_edges(&l));
                rotate_to_lowest(&mut l);
                faces.push(l);
            }
        }
    }
    let open_paths = open_stroke_groups(edges, &cycles, &thin, &kept, dl)?;

    // Cycles uniques (même ensemble de sommets = même cycle).
    let mut unique: Vec<Vec<Pt>> = Vec::new();
    let mut seen: HashSet<Vec<(u64, u64)>> = HashSet::new();
    for f in &faces {
        let mut k: Vec<(u64, u64)> = f.iter().map(|p| (p[0].to_bits(), p[1].to_bits())).collect();
        k.sort();
        k.dedup();
        if seen.insert(k) {
            unique.push(f.clone());
        }
    }
    dl.check()?;
    let areas: Vec<f64> = unique.iter().map(|r| assemble::ring_signed_area(r)).collect();
    let boxes: Vec<[f64; 4]> = unique.iter().map(|r| bbox_of(r)).collect();
    // Sonde DANS la face (pas dans un contour imbriqué) : un contour contient
    // le contour `i` ssi il contient la sonde de la face `i`.
    let probes = assemble::face_probes_until(&unique, dl)?;

    // Pour chaque contour : indices des contours qui le contiennent.
    let mut containers: Vec<Vec<usize>> = Vec::with_capacity(unique.len());
    for (i, &p) in probes.iter().enumerate() {
        dl.check_at(i)?;
        let mut c = Vec::new();
        for j in 0..unique.len() {
            if j == i || areas[j] <= areas[i] {
                continue;
            }
            let b = &boxes[j];
            if p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]
                && assemble::point_in_ring(p, &unique[j])
            {
                c.push(j);
            }
        }
        containers.push(c);
    }

    // Ordre déterministe : profondeur, aire décroissante, minx, miny.
    let depth: Vec<usize> = containers.iter().map(|c| 1 + c.len()).collect();
    let mut order: Vec<usize> = (0..unique.len()).collect();
    order.sort_by(|&a, &b| {
        depth[a]
            .cmp(&depth[b])
            .then(areas[b].total_cmp(&areas[a]))
            .then(boxes[a][0].total_cmp(&boxes[b][0]))
            .then(boxes[a][1].total_cmp(&boxes[b][1]))
    });
    let mut new_index = vec![0usize; unique.len()];
    for (n, &o) in order.iter().enumerate() {
        new_index[o] = n;
    }
    let out = order
        .iter()
        .map(|&o| {
            let mut ring = unique[o].clone();
            if ring.first() != ring.last() {
                ring.push(ring[0]);
            }
            let parent = containers[o]
                .iter()
                .copied()
                .min_by(|&a, &b| areas[a].total_cmp(&areas[b]).then(a.cmp(&b)))
                .map(|p| new_index[p]);
            SheetContour {
                ring,
                depth: depth[o],
                parent,
                area_mm2: areas[o],
                bbox: boxes[o],
            }
        })
        .collect();
    Ok((out, open_paths))
}

/// Arc d'un segment à bulge : (centre, angle de début, angle de fin en degrés,
/// rayon), toujours dans le sens trigonométrique (jumeau de `bulge_to_arc` de
/// la décomposition, AGENTS #1 : le rayon SIGNÉ place le centre, et un bulge
/// négatif échange début et fin). Transcendantes par `libm` (AGENTS #14b).
fn bulge_arc(a: Pt, b: Pt, bulge: f64) -> (Pt, f64, f64, f64) {
    let angle = |p: Pt, q: Pt| libm::atan2(q[1] - p[1], q[0] - p[0]);
    let chord = ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
    let r = chord * (1.0 + bulge * bulge) / 4.0 / bulge;
    let t = angle(a, b) + (std::f64::consts::FRAC_PI_2 - libm::atan(bulge) * 2.0);
    let c = [a[0] + libm::cos(t) * r, a[1] + libm::sin(t) * r];
    let (start, end) = if bulge < 0.0 { (b, a) } else { (a, b) };
    (c, angle(c, start).to_degrees(), angle(c, end).to_degrees(), r.abs())
}

/// Sommets d'un segment `a` -> `b` à bulge, sans `a`, avec `b` : sur l'arc vrai,
/// aplati comme une entité ARC à la tolérance `tol`, les deux extrémités remises
/// EXACTEMENT sur les sommets de la polyligne (les segments voisins se joignent
/// sans écart). Un segment sans arc exploitable (bulge nul ou non fini, corde
/// nulle, flèche négligeable, rayon sous la tolérance) reste sa corde.
fn bulge_segment(a: Pt, b: Pt, bulge: f64, tol: f64, out: &mut Vec<Pt>) {
    let chord = ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
    let usable = bulge.is_finite()
        && bulge != 0.0
        && chord.is_finite()
        && chord > 0.0
        && bulge.abs() * chord / 2.0 > 1e-9;
    if usable {
        let (center, start_angle, end_angle, radius) = bulge_arc(a, b, bulge);
        let arc = Primitive::Arc {
            center,
            radius,
            start_angle,
            end_angle,
            handle: String::new(),
            layer: String::new(),
        };
        let mut pts = flatten_primitive(&arc, tol);
        if pts.len() >= 2 && pts.iter().all(|p| p[0].is_finite() && p[1].is_finite()) {
            if bulge < 0.0 {
                pts.reverse();
            }
            let last = pts.len() - 1;
            pts[0] = a;
            pts[last] = b;
            out.extend_from_slice(&pts[1..]);
            return;
        }
    }
    out.push(b);
}

/// Une polyligne à arcs devient la polyligne de ses sommets aplatis (le segment
/// de fermeture compte : son bulge est celui du dernier sommet ; une fermée de
/// deux sommets à bulge 1 donne le disque). Sans bulge, ou moins de deux
/// sommets : la projection habituelle.
fn polyline_primitive(
    points: &[[f64; 2]],
    bulges: &[f64],
    closed: bool,
    handle: &str,
    layer: &str,
    tol: f64,
) -> Primitive {
    let n = points.len();
    let tol = tol.max(0.001);
    if n < 2 || !bulges.iter().any(|b| *b != 0.0) {
        return Primitive::Polyline {
            points: points.to_vec(),
            closed,
            handle: handle.to_string(),
            layer: layer.to_string(),
        };
    }
    let segments = if closed { n } else { n - 1 };
    let mut out: Vec<Pt> = Vec::with_capacity(n + 8);
    out.push(points[0]);
    for i in 0..segments {
        let bulge = bulges.get(i).copied().unwrap_or(0.0);
        bulge_segment(points[i], points[(i + 1) % n], bulge, tol, &mut out);
    }
    // Fermée : le dernier sommet EST le premier (le contour se ferme de lui-même).
    Primitive::Polyline {
        points: out,
        closed: false,
        handle: handle.to_string(),
        layer: layer.to_string(),
    }
}

/// Insère une fois le nœud `u` dans une B-spline de degré `p` (Boehm, The NURBS
/// Book A5.1) ; `span` est l'indice tel que `knots[span] <= u <= knots[span+1]`
/// et `knots[span] < knots[span+1]`. Points en coordonnées homogènes.
fn insert_knot(p: usize, knots: &mut Vec<f64>, ctrl: &mut Vec<[f64; 3]>, u: f64, span: usize) {
    let n = ctrl.len();
    let mut q: Vec<[f64; 3]> = Vec::with_capacity(n + 1);
    for i in 0..=n {
        if i + p <= span {
            q.push(ctrl[i]);
        } else if i > span {
            q.push(ctrl[i - 1]);
        } else {
            let a = (u - knots[i]) / (knots[i + p] - knots[i]);
            let (c, d) = (ctrl[i], ctrl[i - 1]);
            q.push([a * c[0] + (1.0 - a) * d[0], a * c[1] + (1.0 - a) * d[1], a * c[2] + (1.0 - a) * d[2]]);
        }
    }
    knots.insert(span + 1, u);
    *ctrl = q;
}

/// Une SPLINE aux nœuds NON bloqués (fermée périodique : nœuds uniformes, points
/// de contrôle rejoués en fin) n'est une courbe que sur son domaine valide
/// `[nœuds[degré], nœuds[nb de points]]` ; hors de lui les fonctions de base sont
/// incomplètes et la courbe file vers l'origine. Le code partagé aplatit TOUT
/// l'intervalle des nœuds (jumeau d'ezdxf), ce qui fait une pointe de la tôle à
/// l'origine. Ici la courbe est ramenée à son domaine par insertion de nœuds
/// (même courbe, nœuds bloqués aux deux bouts) ; une spline déjà bloquée, ou
/// dont le vecteur de nœuds est incohérent, est rendue telle quelle.
/// Rend (nœuds, points de contrôle, poids) ; poids vides si la spline est non
/// rationnelle.
fn spline_on_valid_domain(
    degree: i32,
    knots: &[f64],
    control: &[[f64; 2]],
    weights: &[f64],
) -> Option<(Vec<f64>, Vec<[f64; 2]>, Vec<f64>)> {
    if !(1..=25).contains(&degree) {
        return None;
    }
    let p = degree as usize;
    let n = control.len();
    if n < p + 1 || knots.len() != n + p + 1 {
        return None;
    }
    let finite = knots.iter().all(|k| k.is_finite())
        && control.iter().all(|c| c[0].is_finite() && c[1].is_finite())
        && weights.iter().all(|w| w.is_finite());
    if !finite || knots.windows(2).any(|w| w[0] > w[1]) {
        return None;
    }
    let (a, b) = (knots[p], knots[n]);
    let clamped = knots[..=p].iter().all(|&k| k == a) && knots[n..].iter().all(|&k| k == b);
    if clamped || !(a < b) {
        return None;
    }
    let rational = weights.len() >= n;
    let mut ks = knots.to_vec();
    let mut cs: Vec<[f64; 3]> = control
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let w = if rational { weights[i] } else { 1.0 };
            [c[0] * w, c[1] * w, w]
        })
        .collect();
    // Début : nœud `a` porté à la multiplicité p + 1.
    loop {
        let m = ks.iter().filter(|&&k| k == a).count();
        if m >= p + 1 {
            break;
        }
        let span = ks.iter().rposition(|&k| k == a)?;
        if span + 1 >= ks.len() || span >= cs.len() {
            return None;
        }
        insert_knot(p, &mut ks, &mut cs, a, span);
    }
    // Fin : nœud `b` porté à la multiplicité p + 1.
    loop {
        let m = ks.iter().filter(|&&k| k == b).count();
        if m >= p + 1 {
            break;
        }
        let span = ks.iter().position(|&k| k == b)?.checked_sub(1)?;
        if ks[span] >= b {
            return None;
        }
        insert_knot(p, &mut ks, &mut cs, b, span);
    }
    let s = ks.iter().position(|&k| k == a)?;
    let e = ks.iter().position(|&k| k == b)?;
    if e < s + p + 1 || e > cs.len() {
        return None;
    }
    let knots_out = ks[s..e + p + 1].to_vec();
    let cs = &cs[s..e];
    if knots_out.len() != cs.len() + p + 1 {
        return None;
    }
    let control_out: Vec<[f64; 2]> = cs
        .iter()
        .map(|c| if rational { [c[0] / c[2], c[1] / c[2]] } else { [c[0], c[1]] })
        .collect();
    let weights_out = if rational { cs.iter().map(|c| c[2]).collect() } else { Vec::new() };
    Some((knots_out, control_out, weights_out))
}

/// Projection d'une entité en primitive, pour une TÔLE : comme
/// `decompose::primitive_of`, sauf les polylignes à bulges (voir l'en-tête).
fn sheet_primitive(e: &Entity, tol: f64) -> Primitive {
    match e {
        Entity::LwPolyline(p) => {
            polyline_primitive(&p.points, &p.bulges, p.closed, &p.common.handle, &p.common.layer, tol)
        }
        Entity::Polyline(p) => {
            polyline_primitive(&p.points, &p.bulges, p.closed, &p.common.handle, &p.common.layer, tol)
        }
        Entity::Spline(sp) => match spline_on_valid_domain(sp.degree, &sp.knots, &sp.control, &sp.weights) {
            Some((knots, control, weights)) => Primitive::Spline {
                degree: sp.degree,
                knots,
                control,
                weights,
                handle: sp.common.handle.clone(),
                layer: sp.common.layer.clone(),
            },
            None => dxf::decompose::primitive_of(e),
        },
        other => dxf::decompose::primitive_of(other),
    }
}

/// Nombre de SPLINE que le lecteur DXF partagé a retirées SANS le dire : il
/// applique la règle d'ezdxf.recover (nœuds < points de contrôle + degré + 1 →
/// l'entité est supprimée, `dxf/mod.rs` `with_recover_drops`) et ne lit pas les
/// points d'ajustement (groupes 11/21 : `dxf/entities.rs`, lecture de SPLINE).
/// Une SPLINE ne portant que des points d'ajustement (aucun point de contrôle ni
/// nœud) disparaît donc avant l'entité canonique, sans compte ni avertissement
/// — pour une tôle, un contour manquant en silence. Le code partagé ne se
/// touche pas (l'import de pièces reste identique) : on recompte ici les SPLINE
/// du texte (ENTITIES hors espace papier, et tous les blocs) et on retranche
/// celles que le document a gardées. DXF texte seulement, comme le lecteur.
fn silently_dropped_splines(bytes: &[u8], doc: &dxf::Document) -> usize {
    let text = String::from_utf8_lossy(bytes);
    let mut lines = text.lines();
    let mut section = String::new();
    let mut after_section = false;
    let mut spline = false;
    let mut paper = false;
    let mut raw = 0usize;
    let close = |spline: &mut bool, paper: &mut bool, section: &str, raw: &mut usize| {
        if *spline && !(*paper && section == "ENTITIES") {
            *raw += 1;
        }
        *spline = false;
        *paper = false;
    };
    while let Some(code_line) = lines.next() {
        let value = lines.next().unwrap_or("").trim();
        let code: i32 = code_line.trim().parse().unwrap_or(-1);
        match code {
            0 => {
                close(&mut spline, &mut paper, &section, &mut raw);
                after_section = value == "SECTION";
                if value == "ENDSEC" {
                    section.clear();
                } else if value == "SPLINE" && (section == "ENTITIES" || section == "BLOCKS") {
                    spline = true;
                }
            }
            2 if after_section => {
                section = value.to_string();
                after_section = false;
            }
            67 if spline => {
                paper = value.parse::<f64>().map(|v| v != 0.0).unwrap_or(false);
            }
            _ => {}
        }
    }
    close(&mut spline, &mut paper, &section, &mut raw);
    let kept = doc
        .entities
        .iter()
        .chain(doc.blocks.iter().flat_map(|b| b.entities.iter()))
        .filter(|e| matches!(e, Entity::Spline(_)))
        .count();
    raw.saturating_sub(kept)
}

/// Lit une tôle DXF sous les bornes données. Un document qui n'est pas un DXF
/// (SVG) est une erreur : une tôle importée est un dessin DXF.
pub fn import_sheet_contours(
    bytes: &[u8],
    flatten_tol: f64,
    limits: &Limits,
) -> Result<SheetResult, ImportError> {
    #[cfg(feature = "svg")]
    if crate::is_svg_signature(bytes) {
        return Err(ImportError::Corrupt(
            "a sheet must be a DXF drawing (SVG is not supported here)".into(),
        ));
    }
    let dl = Deadline::new(limits.time_budget_ms);
    let doc = dxf::Document::parse(bytes)?;
    // Les mêmes entités canoniques que `flattened_modelspace_bounded` (blocs
    // résolus, échelles et miroirs appliqués, unités en mm), mais lues ici avec
    // leurs bulges au lieu de la projection sans arcs de l'import de pièces.
    let (flat, mut warnings, stats) = dxf::canonical::canonical_entities_stats_bounded(
        &doc,
        limits.expansion_ceiling(),
        crate::budget::MAX_INSERT_DEPTH,
    )
    .map_err(|o| {
        if o.depth_exceeded {
            ImportError::TooHeavy(TooHeavy {
                reason: crate::budget::TooHeavyReason::BlockDepth,
                entities: o.entities,
                entities_at_least: true,
                max_entities: limits.max_entities,
                elapsed_ms: dl.elapsed_ms(),
                time_budget_ms: limits.time_budget_ms,
            })
        } else {
            crate::too_many_entities(o.entities, true, limits, &dl)
        }
    })?;
    let entities: Vec<Primitive> = flat.iter().map(|e| sheet_primitive(e, flatten_tol)).collect();
    // SPLINE retirées en silence par le lecteur partagé : comptées comme non
    // lues et signalées, une par une, comme les autres entités écartées.
    let dropped_splines = silently_dropped_splines(bytes, &doc);
    for _ in 0..dropped_splines {
        warnings.push(
            "skipped entity SPLINE (no control points or knots, e.g. fit points only)".to_string(),
        );
    }
    let count = entities.len();
    if count > limits.max_entities {
        return Err(crate::too_many_entities(count, false, limits, &dl));
    }
    let model_has_matter = stats.skipped.keys().any(|k| crate::findings::is_material(k))
        || entities.iter().any(|p| match p {
            Primitive::Unsupported(kind) => crate::findings::is_material(kind),
            _ => true,
        });
    if stats.paper_space_skipped > 0 && !model_has_matter {
        return Err(ImportError::TooHeavy(TooHeavy {
            reason: crate::budget::TooHeavyReason::PaperSpaceOnly,
            entities: stats.paper_space_skipped,
            entities_at_least: false,
            max_entities: limits.max_entities,
            elapsed_ms: dl.elapsed_ms(),
            time_budget_ms: limits.time_budget_ms,
        }));
    }
    let nested_unsupported = entities
        .iter()
        .filter(|p| matches!(p, Primitive::Unsupported(_)))
        .count();
    let skipped_entities =
        stats.skipped.values().sum::<usize>()
            + nested_unsupported
            + stats.paper_space_skipped
            + dropped_splines;
    let (lw, w2, entity_count) =
        assemble::collect_linework_until(&entities, flatten_tol, &dl)
            .map_err(|e| crate::out_of_time(count, limits, e))?;
    warnings.extend(w2);

    // Même nodage et même snap que `build_parts_stats_until` (étapes 1 et 2).
    let mut all_edges: Vec<(Pt, Pt)> = Vec::new();
    for ring in &lw.rings {
        for w in ring.windows(2) {
            all_edges.push((w[0], w[1]));
        }
    }
    all_edges.extend_from_slice(&lw.segments);
    let noded = assemble::node_segments_until(&all_edges, &dl)
        .map_err(|e| crate::out_of_time(count, limits, e))?;
    let edges = assemble::snap_edges_until(&noded, &dl)
        .map_err(|e| crate::out_of_time(count, limits, e))?;
    let (contours, open_paths) = contours_of_edges(&edges, &dl)
        .map_err(|e| crate::out_of_time(count, limits, e))?;
    Ok(SheetResult {
        contours,
        source_units: doc.source_insunits,
        entity_count,
        warnings,
        open_paths,
        skipped_entities,
    })
}

/// Sortie JSON de l'import de tôle BORNÉ — mêmes enveloppes que
/// `guarded_import_json` : `{status:"ok", result:{...}}` ou
/// `{status:"refused", refusal:{...}, message:"..."}`.
pub fn guarded_sheet_json(
    bytes: &[u8],
    flatten_tol: f64,
    limits: &Limits,
) -> Result<String, ImportError> {
    match import_sheet_contours(bytes, flatten_tol, limits) {
        Ok(result) => serde_json::to_string(&serde_json::json!({
            "status": "ok",
            "result": result,
        }))
        .map_err(|e| ImportError::Corrupt(format!("{e}"))),
        Err(ImportError::TooHeavy(t)) => {
            let message = format!("{}", ImportError::TooHeavy(t));
            serde_json::to_string(&serde_json::json!({
                "status": "refused",
                "refusal": t,
                "message": message,
            }))
            .map_err(|e| ImportError::Corrupt(format!("{e}")))
        }
        Err(other) => Err(other),
    }
}
