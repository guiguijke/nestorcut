//! Assembly: flattened primitives → polygon parts (build_geometry.py twin).
//!
//! Pipeline: snap to the 1e-4 grid (GEOS set_precision rounding), noding of
//! segment intersections, minimal-face extraction (leftmost-face walk,
//! deterministic), even-odd material selection, dissolve per part, weld of
//! near polygons (0.1 mm), reduce_ring, bbox filter. Benign inputs (closed
//! rings — the whole real-world corpus) take the exact fast path; general
//! noding/union paths are exercised and measured by the parity harness.

use crate::budget::{Deadline, Expired};
use crate::dxf::flatten::{flatten_primitive, Primitive};
use crate::Part;
use std::collections::HashMap;

/// GEOS set_precision rounding: floor(v*1e4 + 0.5)/1e4 (round-half-up).
/// (La forme ×1e-4 = 13.229200000000004 vue dans certains goldens vient du
/// weld buffer(±0.1) de _merge_near_polygons, PAS de set_precision —
/// vérifié : set_precision(Point(13.229200000000001)) = 13.2292 propre.)
pub fn snap(v: f64) -> f64 {
    ((v * 1e4) + 0.5).floor() / 1e4
}

pub fn snap_pt(p: [f64; 2]) -> [f64; 2] {
    [snap(p[0]), snap(p[1])]
}

pub type Pt = [f64; 2];

/// Écart, en pas de grille et par axe, sous lequel deux bouts sont le MÊME
/// point. Un pas suffit aux arrondis de calcul ; le second pas prend les
/// dessins écrits à 4 décimales. Mesuré sur 148 dessins réels : aucun écart
/// entre deux bouts voisins n'est compris entre 0,0005 et 0,05 mm.
pub const JOIN_STEPS: i32 = 2;

/// Ferme le tracé d'une entité fermée (règle Python : premier et dernier
/// points à moins de `tol`) dont les deux bouts s'arrondissent sur deux points
/// DIFFÉRENTS de la grille ; les autres ne sont pas touchés. Un cercle calculé
/// à 0 et à 360 degrés s'ouvrait ainsi d'un pas, et le contour disparaissait.
/// Plus loin (spline ou polyligne refermée à quelques millièmes près), le trait
/// de fermeture est ajouté, comme le fait `Polygon` côté Python. Un tracé plus
/// petit que `MIN_PART_WIDTH_MM` est un petit arc ouvert : il le reste.
fn close_ring(pts: &mut Vec<Pt>) {
    let (first, last) = (pts[0], pts[pts.len() - 1]);
    let (a, b) = (snap_pt(first), snap_pt(last));
    let bb = ring_bbox(pts);
    if a == b || bb[2] - bb[0] < MIN_PART_WIDTH_MM || bb[3] - bb[1] < MIN_PART_WIDTH_MM {
        return;
    }
    let near = (JOIN_STEPS as f64 + 0.5) * 1e-4; // demi-pas : marge d'arrondi
    if (a[0] - b[0]).abs() <= near && (a[1] - b[1]).abs() <= near {
        let n = pts.len();
        pts[n - 1] = first;
    } else {
        pts.push(first);
    }
}

/// Arêtes nodées mises sur la grille 1e-4, dégénérées retirées, puis bouts
/// LIBRES posés sur le sommet voisin (`JOIN_STEPS`), s'il y en a un. Le bout d'un
/// segment est écrit, celui d'un arc est calculé : sur une coordonnée à
/// mi-chemin de deux pas (dessin en pouces au 1/32, 5 décimales) ils
/// s'arrondissent d'un pas l'un à côté de l'autre, et le contour n'est plus
/// fermé. Seul un bout libre (un seul voisin) bouge, et jamais vers son propre
/// voisin : un dessin sans un tel bout rend les mêmes arêtes.
pub fn snap_edges_until(noded: &[(Pt, Pt)], dl: &Deadline) -> Result<Vec<(Pt, Pt)>, Expired> {
    type Key = (u64, u64);
    let key = |p: Pt| -> Key { (p[0].to_bits(), p[1].to_bits()) };
    let mut edges: Vec<(Pt, Pt)> = noded
        .iter()
        .map(|&(a, b)| (snap_pt(a), snap_pt(b)))
        .filter(|(a, b)| a != b)
        .collect();
    // Sommet -> son seul voisin, None dès qu'il en a deux différents (un trait
    // dessiné deux fois ne fait pas deux voisins).
    let mut only: HashMap<Key, Option<Key>> = HashMap::new();
    for (i, &(a, b)) in edges.iter().enumerate() {
        dl.check_at(i)?;
        for (p, q) in [(a, b), (b, a)] {
            let e = only.entry(key(p)).or_insert(Some(key(q)));
            if *e != Some(key(q)) {
                *e = None;
            }
        }
    }
    let mut free: Vec<(Pt, Key)> = only
        .iter()
        .filter_map(|(k, n)| n.map(|n| ([f64::from_bits(k.0), f64::from_bits(k.1)], n)))
        .collect();
    free.sort_by(|p, q| p.0[0].total_cmp(&q.0[0]).then(p.0[1].total_cmp(&q.0[1])));
    let mut moved: HashMap<Key, Pt> = HashMap::new();
    let mut held: std::collections::HashSet<Key> = std::collections::HashSet::new();
    for (i, &(p, own)) in free.iter().enumerate() {
        dl.check_at(i)?;
        if held.contains(&key(p)) {
            continue; // un autre bout est déjà venu s'y poser
        }
        let (kx, ky) = ((p[0] * 1e4).round(), (p[1] * 1e4).round());
        // Le plus proche ; à égalité un sommet déjà relié passe avant un autre
        // bout libre, puis le plus petit (x puis y).
        let mut best: Option<(bool, Pt)> = None;
        for r in 1..=JOIN_STEPS {
            for dx in -r..=r {
                for dy in -r..=r {
                    if dx.abs().max(dy.abs()) != r {
                        continue;
                    }
                    let c = [(kx + dx as f64) / 1e4, (ky + dy as f64) / 1e4];
                    let k = key(c);
                    if k == key(p) || k == own || moved.contains_key(&k) {
                        continue;
                    }
                    let Some(n) = only.get(&k) else { continue };
                    let is_free = n.is_some();
                    if best.is_none_or(|(f, _)| f && !is_free) {
                        best = Some((is_free, c));
                    }
                }
            }
            if best.is_some() {
                break;
            }
        }
        if let Some((_, c)) = best {
            moved.insert(key(p), c);
            held.insert(key(c));
        }
    }
    if !moved.is_empty() {
        for (a, b) in edges.iter_mut() {
            *a = moved.get(&key(*a)).copied().unwrap_or(*a);
            *b = moved.get(&key(*b)).copied().unwrap_or(*b);
        }
        edges.retain(|(a, b)| a != b);
    }
    split_at_free_ends_until(edges, dl)
}

/// Distance, en mm, sous laquelle un bout libre tombe SUR une arête voisine
/// (jonction en T). Plus large que `JOIN_STEPS` : deux bouts qui se rejoignent
/// partagent les chiffres écrits du même point, alors que le point d'une
/// jonction en T est calculé puis écrit, et s'écarte du côté de la précision
/// du fichier. Mesures du 27/11 : au fuzz « tee » (10 000 dessins), il faut
/// un peu plus de 1 µm pour les dessins écrits à trois décimales (2 erreurs à
/// 0,001, aucune à 0,002) ; sur 325 dessins réels, un panneau de 222 trous en
/// retrouve 9 dès 0,0004 et ne bouge plus jusqu'à 0,05. 5 µm laisse de la
/// marge des deux côtés et reste sous la tolérance d'échantillonnage (0,01).
pub const TEE_TOL_MM: f64 = 0.005;

/// Jonctions en T que le nodage exact a manquées : un bout encore LIBRE (un
/// seul voisin) posé à moins de `TEE_TOL_MM` de l'INTÉRIEUR d'une autre arête
/// coupe cette arête en ce point. Cas type : une bosse ronde posée au milieu du
/// bord d'un rectangle. Le bout de l'arc est calculé (cos, sin, rotation,
/// insertion) et tombe à quelques ulp du bord : `point_on_segment` exige une
/// colinéarité exacte et ne coupe pas, la bosse restait pendante et la pièce
/// sortait sans elle (un cas sur quatre au fuzz du 25/11, famille « tee »).
/// Côté serveur, l'arrondi de GEOS (`set_precision`, pixels chauds) recoupe
/// l'arête qui passe dans la case d'un sommet.
///
/// Aucun sommet ne bouge : chaque arête à portée est coupée, au bout libre
/// lui-même (déjà sur la grille), puis le voisinage des coupes est nodé une
/// seconde fois (`renode_near_until`). Une arête qui touche le bout ou son
/// voisin n'est pas candidate (le tracé se replierait sur lui-même). Un dessin
/// sans bout libre rend les mêmes arêtes, au bit près.
fn split_at_free_ends_until(mut edges: Vec<(Pt, Pt)>, dl: &Deadline) -> Result<Vec<(Pt, Pt)>, Expired> {
    type Key = (u64, u64);
    let key = |p: Pt| -> Key { (p[0].to_bits(), p[1].to_bits()) };
    let mut only: HashMap<Key, Option<Key>> = HashMap::new();
    for (i, &(a, b)) in edges.iter().enumerate() {
        dl.check_at(i)?;
        for (p, q) in [(a, b), (b, a)] {
            let e = only.entry(key(p)).or_insert(Some(key(q)));
            if *e != Some(key(q)) {
                *e = None;
            }
        }
    }
    let mut free: Vec<(Pt, Pt)> = only
        .iter()
        .filter_map(|(k, n)| {
            n.map(|n| {
                (
                    [f64::from_bits(k.0), f64::from_bits(k.1)],
                    [f64::from_bits(n.0), f64::from_bits(n.1)],
                )
            })
        })
        .collect();
    if free.is_empty() {
        return Ok(edges);
    }
    free.sort_by(|p, q| p.0[0].total_cmp(&q.0[0]).then(p.0[1].total_cmp(&q.0[1])));
    let tol = TEE_TOL_MM;
    // Index : les arêtes, puis la case de tolérance de chaque bout (diagonale
    // de son carré). Une arête dont la boîte ne touche pas ce carré est à
    // plus de `tol` du bout : l'écarter ne perd rien.
    let n = edges.len();
    let mut items = edges.clone();
    items.extend(free.iter().map(|&(p, _)| ([p[0] - tol, p[1] - tol], [p[0] + tol, p[1] + tol])));
    let grid = BboxGrid::build(&items);
    let mut cand: Vec<u32> = Vec::new();
    let mut cuts: HashMap<usize, Vec<(f64, Pt)>> = HashMap::new();
    for (k, &(p, own)) in free.iter().enumerate() {
        dl.check_at(k)?;
        grid.candidates(n + k, &mut cand);
        // TOUTES les arêtes à portée, pas seulement la plus proche : un côté
        // dessiné deux fois (ou redessiné à quelques décimales près) garderait
        // une copie droite que le premier segment de l'arc traverse sans sommet
        // commun, et la face de la pièce se perdait (relecture du 27/11).
        for &jj in cand.iter() {
            let j = jj as usize;
            if j >= n {
                continue;
            }
            let (a, b) = edges[j];
            if a == p || b == p || a == own || b == own {
                continue;
            }
            let ab = sub(b, a);
            let len2 = ab[0] * ab[0] + ab[1] * ab[1];
            if len2 == 0.0 {
                continue;
            }
            let ap = sub(p, a);
            let t = (ap[0] * ab[0] + ap[1] * ab[1]) / len2;
            if !(t > 0.0 && t < 1.0) {
                continue;
            }
            if cross(ab, ap).abs() / len2.sqrt() <= tol {
                cuts.entry(j).or_default().push((t, p));
            }
        }
    }
    if !cuts.is_empty() {
        let points: std::collections::HashSet<Key> =
            cuts.values().flat_map(|v| v.iter().map(|&(_, p)| key(p))).collect();
        edges = cut_edges_until(&edges, &mut cuts, dl)?;
        // La coupe déplace l'arête jusqu'à `tol` : un côté redessiné à
        // quelques décimales près, presque confondu, peut alors être croisé
        // sans sommet commun, et la face de la pièce se perd (relecture du
        // 27/11). Second nodage, LOCAL : les arêtes qui touchent un point de
        // coupe et leurs voisines (boîtes qui se touchent). Un nodage complet
        // doublait le temps d'import des fichiers concernés.
        let touching: Vec<bool> =
            edges.iter().map(|&(a, b)| points.contains(&key(a)) || points.contains(&key(b))).collect();
        edges = renode_near_until(&edges, &touching, dl)?;
    }
    trim_stubs_until(edges, tol, dl)
}

/// Nodage des paires qui contiennent une arête du VOISINAGE : les arêtes
/// `seed` et celles dont la boîte touche la leur. Mêmes prédicats exacts que
/// `node_segments_until` (croisements, jonctions en T), point de croisement
/// calculé une fois par paire, nouveaux points mis sur la grille. Les autres
/// arêtes passent telles quelles.
fn renode_near_until(edges: &[(Pt, Pt)], seed: &[bool], dl: &Deadline) -> Result<Vec<(Pt, Pt)>, Expired> {
    let n = edges.len();
    let grid = BboxGrid::build(edges);
    let mut cand: Vec<u32> = Vec::new();
    let mut near = seed.to_vec();
    // Compteur propre : `check_at` ne lit l'horloge que tous les
    // `Deadline::STRIDE` appels, et ces boucles sautent la plupart des indices.
    let mut steps = 0usize;
    for i in 0..n {
        if seed[i] {
            steps += 1;
            dl.check_at(steps)?;
            grid.candidates(i, &mut cand);
            for &j in cand.iter() {
                near[j as usize] = true;
            }
        }
    }
    let mut splits: HashMap<usize, Vec<Pt>> = HashMap::new();
    for i in 0..n {
        if !near[i] {
            continue;
        }
        steps += 1;
        dl.check_at(steps)?;
        grid.candidates(i, &mut cand);
        for &jj in cand.iter() {
            let j = jj as usize;
            if near[j] && j < i {
                continue; // paire déjà vue depuis j
            }
            let (lo, hi) = (i.min(j), i.max(j));
            if let Some(p) = seg_intersection(edges[lo].0, edges[lo].1, edges[hi].0, edges[hi].1) {
                splits.entry(i).or_default().push(p);
                splits.entry(j).or_default().push(p);
            }
            for (x, y) in [(i, j), (j, i)] {
                let (s1, s2) = edges[x];
                for &p in &[edges[y].0, edges[y].1] {
                    if point_on_segment(p, s1, s2) {
                        splits.entry(x).or_default().push(p);
                    }
                }
            }
        }
    }
    if splits.is_empty() {
        return Ok(edges.to_vec());
    }
    let mut out: Vec<(Pt, Pt)> = Vec::with_capacity(n + splits.len() * 2);
    for (i, &(a, b)) in edges.iter().enumerate() {
        dl.check_at(i)?;
        let Some(ps) = splits.get(&i) else {
            out.push((a, b));
            continue;
        };
        let d = dist2(a, b);
        let mut ts: Vec<(f64, Pt)> = ps
            .iter()
            .map(|&p| (((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / d, snap_pt(p)))
            .collect();
        ts.sort_by(|x, y| x.0.total_cmp(&y.0).then(x.1[0].total_cmp(&y.1[0])).then(x.1[1].total_cmp(&y.1[1])));
        let mut prev = a;
        for &(_, p) in &ts {
            if p != prev && p != b {
                out.push((prev, p));
                prev = p;
            }
        }
        if prev != b {
            out.push((prev, b));
        }
    }
    Ok(out)
}

/// Les arêtes coupées aux points retenus, dans l'ordre le long de chacune.
fn cut_edges_until(
    edges: &[(Pt, Pt)],
    cuts: &mut HashMap<usize, Vec<(f64, Pt)>>,
    dl: &Deadline,
) -> Result<Vec<(Pt, Pt)>, Expired> {
    let mut out: Vec<(Pt, Pt)> = Vec::with_capacity(edges.len() + cuts.len() * 2);
    for (j, &(a, b)) in edges.iter().enumerate() {
        dl.check_at(j)?;
        let Some(ts) = cuts.get_mut(&j) else {
            out.push((a, b));
            continue;
        };
        ts.sort_by(|x, y| x.0.total_cmp(&y.0).then(x.1[0].total_cmp(&y.1[0])).then(x.1[1].total_cmp(&y.1[1])));
        let mut prev = a;
        for &(_, p) in ts.iter() {
            if p != prev {
                out.push((prev, p));
                prev = p;
            }
        }
        if prev != b {
            out.push((prev, b));
        }
    }
    Ok(out)
}

/// Moignons : l'arc qui DÉPASSE le côté d'un micron au lieu de s'arrêter juste
/// avant le croise (le nodage exact le coupe là) et laisse au-delà un bout de
/// trait libre plus court que `tol`, accroché à un carrefour (trois voisins ou
/// plus). Ce bout ne borde aucune face ; gardé, il compte comme un tracé
/// ouvert (« contours abandonnés », traits ouverts de la tôle) alors que rien
/// n'est perdu. Il est retiré. Un tracé ouvert qui ne finit pas sur un
/// carrefour n'est pas touché.
fn trim_stubs_until(edges: Vec<(Pt, Pt)>, tol: f64, dl: &Deadline) -> Result<Vec<(Pt, Pt)>, Expired> {
    type Key = (u64, u64);
    let key = |p: Pt| -> Key { (p[0].to_bits(), p[1].to_bits()) };
    // Voisins DISTINCTS (un trait dessiné deux fois compte une fois).
    let mut seen: std::collections::HashSet<(Key, Key)> = std::collections::HashSet::new();
    let mut degree: HashMap<Key, u32> = HashMap::new();
    for (i, &(a, b)) in edges.iter().enumerate() {
        dl.check_at(i)?;
        let (ka, kb) = (key(a), key(b));
        if seen.insert(if ka < kb { (ka, kb) } else { (kb, ka) }) {
            *degree.entry(ka).or_default() += 1;
            *degree.entry(kb).or_default() += 1;
        }
    }
    let stub = |a: Pt, b: Pt| -> bool {
        let (da, db) = (degree[&key(a)], degree[&key(b)]);
        ((da == 1 && db >= 3) || (db == 1 && da >= 3)) && dist2(a, b) <= tol * tol
    };
    if !edges.iter().any(|&(a, b)| stub(a, b)) {
        return Ok(edges);
    }
    Ok(edges.into_iter().filter(|&(a, b)| !stub(a, b)).collect())
}

/// Ponts : arêtes dont la même face borde les deux côtés, ENTRE deux parties
/// qui contiennent chacune un cycle (une fente tracée d'un trou jusqu'au bord,
/// un trait qui relie deux contours). La marche des faces les traverse deux
/// fois et soude les deux contours en un seul anneau : le trou n'est plus
/// compté dans la profondeur pair/impair et passe pour de la matière. GEOS les
/// rend à part (`polygonize_full`, `cuts`) et le serveur les ignore ; ici ils
/// sont retirés avant la marche des faces. Les traits pendants (une seule
/// attache) ne sont pas touchés : ils ne soudent rien et restent comptés par
/// `dangling_paths`. Un dessin sans pont rend les mêmes arêtes.
///
/// Méthode : graphe des arêtes distinctes (un trait dessiné deux fois compte
/// une fois), traits pendants pelés, puis ponts du reste (Tarjan, itératif :
/// pas de récursion sur 30 000 arêtes en wasm).
fn drop_bridges_until(edges: Vec<(Pt, Pt)>, dl: &Deadline) -> Result<Vec<(Pt, Pt)>, Expired> {
    type Key = (u64, u64);
    let key = |p: Pt| -> Key { (p[0].to_bits(), p[1].to_bits()) };
    let mut index: HashMap<Key, u32> = HashMap::new();
    let mut pair_id: HashMap<(u32, u32), u32> = HashMap::new();
    let mut pairs: Vec<(u32, u32)> = Vec::new();
    for (i, &(a, b)) in edges.iter().enumerate() {
        dl.check_at(i)?;
        let next = index.len() as u32;
        let ia = *index.entry(key(a)).or_insert(next);
        let next = index.len() as u32;
        let ib = *index.entry(key(b)).or_insert(next);
        if ia == ib {
            continue;
        }
        let pr = (ia.min(ib), ia.max(ib));
        let next = pairs.len() as u32;
        if *pair_id.entry(pr).or_insert(next) == next {
            pairs.push(pr);
        }
    }
    let n = index.len();
    let mut adj: Vec<Vec<(u32, u32)>> = vec![Vec::new(); n];
    for (e, &(u, v)) in pairs.iter().enumerate() {
        adj[u as usize].push((v, e as u32));
        adj[v as usize].push((u, e as u32));
    }
    // Pelage des traits pendants.
    let mut alive = vec![true; pairs.len()];
    let mut degree: Vec<u32> = adj.iter().map(|a| a.len() as u32).collect();
    let mut queue: Vec<u32> = (0..n as u32).filter(|&v| degree[v as usize] == 1).collect();
    let mut steps = 0usize;
    while let Some(v) = queue.pop() {
        steps += 1;
        dl.check_at(steps)?;
        for &(w, e) in &adj[v as usize] {
            if alive[e as usize] {
                alive[e as usize] = false;
                degree[v as usize] -= 1;
                degree[w as usize] -= 1;
                if degree[w as usize] == 1 {
                    queue.push(w);
                }
            }
        }
    }
    // Ponts du reste (Tarjan itératif).
    const NONE: u32 = u32::MAX;
    let mut disc = vec![NONE; n];
    let mut low = vec![0u32; n];
    let mut bridge = vec![false; pairs.len()];
    let mut any = false;
    let mut timer = 0u32;
    let mut stack: Vec<(u32, u32, usize)> = Vec::new();
    for s in 0..n {
        if disc[s] != NONE || degree[s] == 0 {
            continue;
        }
        disc[s] = timer;
        low[s] = timer;
        timer += 1;
        stack.push((s as u32, NONE, 0));
        while let Some(&(v, parent_edge, i)) = stack.last() {
            steps += 1;
            dl.check_at(steps)?;
            let v = v as usize;
            if i < adj[v].len() {
                stack.last_mut().expect("pile non vide").2 += 1;
                let (w, e) = adj[v][i];
                if !alive[e as usize] || e == parent_edge {
                    continue;
                }
                let w = w as usize;
                if disc[w] == NONE {
                    disc[w] = timer;
                    low[w] = timer;
                    timer += 1;
                    stack.push((w as u32, e, 0));
                } else {
                    low[v] = low[v].min(disc[w]);
                }
            } else {
                stack.pop();
                if let Some(&(u, _, _)) = stack.last() {
                    let u = u as usize;
                    low[u] = low[u].min(low[v]);
                    if low[v] > disc[u] {
                        bridge[parent_edge as usize] = true;
                        any = true;
                    }
                }
            }
        }
    }
    if !any {
        return Ok(edges);
    }
    Ok(edges
        .into_iter()
        .filter(|&(a, b)| {
            let (ia, ib) = (index[&key(a)], index[&key(b)]);
            ia == ib || !pair_id.get(&(ia.min(ib), ia.max(ib))).is_some_and(|&e| bridge[e as usize])
        })
        .collect())
}

pub fn sub(a: Pt, b: Pt) -> Pt {
    [a[0] - b[0], a[1] - b[1]]
}
pub fn cross(a: Pt, b: Pt) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}
pub fn dist2(a: Pt, b: Pt) -> f64 {
    let d = sub(a, b);
    d[0] * d[0] + d[1] * d[1]
}

pub struct Linework {
    /// Closed rings (closed flag or |first−last| < tol) — become cycle candidates.
    pub rings: Vec<Vec<Pt>>,
    /// Open polylines → segments.
    pub segments: Vec<(Pt, Pt)>,
    /// Footprints pour l'attachement des handles (attach.rs) : encre
    /// SNAPPÉE (même grille que les corps — coïncidence exacte encre↔bord,
    /// voir attach.rs) + nature fermée (centroïde du fallback).
    pub footprints: Vec<crate::attach::Footprint>,
}

/// Splits primitives into closed rings and open segments (convert_entity_to_
/// shapely's Polygon-vs-LineString rule: |first−last| < tol ⇒ closed).
pub fn collect_linework(
    prims: &[Primitive],
    tol: f64,
) -> (Linework, Vec<String>, usize) {
    // Deadline::unlimited() n'expire jamais : le Result est toujours Ok.
    collect_linework_until(prims, tol, &Deadline::unlimited())
        .unwrap_or_else(|_| unreachable!("échéance illimitée"))
}

/// `collect_linework` sous ÉCHÉANCE (lot 2a) : l'échantillonnage des courbes
/// (`flatten_primitive`) est le premier poste facturé sur un fichier riche en
/// splines — l'abandon doit pouvoir tomber ici aussi.
pub fn collect_linework_until(
    prims: &[Primitive],
    tol: f64,
    dl: &Deadline,
) -> Result<(Linework, Vec<String>, usize), Expired> {
    let mut lw = Linework {
        rings: Vec::new(),
        segments: Vec::new(),
        footprints: Vec::new(),
    };
    let warnings = Vec::new();
    let mut count = 0usize;
    for p in prims {
        dl.check_at(count)?;
        count += 1;
        let handle = p.handle().to_string();
        let mut pts = flatten_primitive(p, tol);
        if pts.is_empty() {
            continue;
        }
        // Règle Python (convert_entity_to_shapely) : Polygon ⇔ len>2 ET
        // |first−last| < tol — décidée sur les points BRUTS (l'encre, elle,
        // est stockée snappée pour l'attachement).
        let closed = pts.len() > 2 && dist2(pts[0], pts[pts.len() - 1]).sqrt() < tol;
        if closed {
            close_ring(&mut pts);
        }
        lw.footprints.push(crate::attach::Footprint {
            handle,
            ink: pts.iter().map(|&q| snap_pt(q)).collect(),
            closed,
        });
        if pts.len() == 1 {
            continue; // POINT: footprint only
        }
        if closed && pts.len() >= 3 {
            lw.rings.push(pts);
        } else {
            for w in pts.windows(2) {
                lw.segments.push((w[0], w[1]));
            }
        }
    }
    Ok((lw, warnings, count))
}

// ---------------------------------------------------------------- noding

/// Segment intersection point (f64, exact for straight segments).
pub fn seg_intersection(a1: Pt, a2: Pt, b1: Pt, b2: Pt) -> Option<Pt> {
    let r = sub(a2, a1);
    let s = sub(b2, b1);
    let denom = cross(r, s);
    if denom == 0.0 {
        return None; // parallel or collinear — no split (GEOS noding note)
    }
    let t = cross(sub(b1, a1), s) / denom;
    let u = cross(sub(b1, a1), r) / denom;
    if t > 0.0 && t < 1.0 && u > 0.0 && u < 1.0 {
        Some([a1[0] + t * r[0], a1[1] + t * r[1]])
    } else {
        None
    }
}

/// Point strictly inside a segment (collinear + between), f64 exact.
pub fn point_on_segment(p: Pt, a: Pt, b: Pt) -> bool {
    let ab = sub(b, a);
    let ap = sub(p, a);
    if cross(ab, ap) != 0.0 {
        return false;
    }
    let d = dist2(a, b);
    if d == 0.0 {
        return false;
    }
    let t = (ap[0] * ab[0] + ap[1] * ab[1]) / d;
    t > 0.0 && t < 1.0
}

/// Split all segments at mutual intersections AND at T-junctions (an
/// endpoint lying strictly inside another segment) — GEOS noding parity.
/// O(n²); noded graph edges are then re-snapped so coincident vertices
/// merge exactly.
pub fn node_segments(segments: &[(Pt, Pt)]) -> Vec<(Pt, Pt)> {
    node_segments_until(segments, &Deadline::unlimited())
        .unwrap_or_else(|_| unreachable!("échéance illimitée"))
}

/// Index de boîtes englobantes pour le noding (lot 2e).
///
/// Les DEUX prédicats du noding sont EXACTS et STRICTS : `seg_intersection`
/// exige `t, u ∈ (0,1)` (et rend None sur des segments parallèles ou
/// colinéaires), `point_on_segment` exige `cross == 0.0` exactement puis
/// `t ∈ (0,1)`. Dans les deux cas le point retenu est **à l'intérieur des
/// deux segments**, donc **dans les deux boîtes englobantes fermées**.
///
/// Écarter une paire dont les boîtes fermées sont DISJOINTES ne peut donc
/// rien changer au résultat : ce n'est pas une approximation, c'est une
/// implication. Aucune tolérance n'entre ici — et c'est pour cela que le lot
/// peut exiger « même sortie » plutôt que « sortie proche ».
///
/// La grille est uniforme. Sa maille ne descend pas sous la taille moyenne
/// des boîtes (sinon un segment long peuple des milliers de cellules) et un
/// segment qui couvre trop de cellules va dans une liste `wide`, candidate à
/// tout — borne le pire cas sans jamais perdre une paire.
struct BboxGrid {
    cell: f64,
    minx: f64,
    miny: f64,
    cols: usize,
    rows: usize,
    cells: Vec<Vec<u32>>,
    wide: Vec<u32>,
    boxes: Vec<[f64; 4]>,
}

/// Au-delà de ce nombre de cellules couvertes, un segment devient `wide`.
const GRID_MAX_SPAN: usize = 64;

impl BboxGrid {
    fn build(segments: &[(Pt, Pt)]) -> Self {
        let n = segments.len();
        let boxes: Vec<[f64; 4]> = segments
            .iter()
            .map(|&(a, b)| {
                [
                    a[0].min(b[0]),
                    a[1].min(b[1]),
                    a[0].max(b[0]),
                    a[1].max(b[1]),
                ]
            })
            .collect();
        let mut minx = f64::INFINITY;
        let mut miny = f64::INFINITY;
        let mut maxx = f64::NEG_INFINITY;
        let mut maxy = f64::NEG_INFINITY;
        let mut span = 0.0f64;
        for bb in &boxes {
            minx = minx.min(bb[0]);
            miny = miny.min(bb[1]);
            maxx = maxx.max(bb[2]);
            maxy = maxy.max(bb[3]);
            span += (bb[2] - bb[0]) + (bb[3] - bb[1]);
        }
        if n == 0 || !minx.is_finite() {
            return Self {
                cell: 1.0,
                minx: 0.0,
                miny: 0.0,
                cols: 1,
                rows: 1,
                cells: vec![Vec::new()],
                wide: Vec::new(),
                boxes,
            };
        }
        // Maille : l'étendue divisée par ~√n (une poignée de segments par
        // cellule), jamais sous la taille moyenne d'une boîte.
        let extent = ((maxx - minx).max(maxy - miny)).max(1e-9);
        let target = (n as f64).sqrt().max(1.0);
        let mean_box = (span / (2.0 * n as f64)).max(0.0);
        let cell = (extent / target).max(mean_box).max(1e-9);
        let cols = (((maxx - minx) / cell).floor() as usize + 1).max(1);
        let rows = (((maxy - miny) / cell).floor() as usize + 1).max(1);
        let mut grid = Self {
            cell,
            minx,
            miny,
            cols,
            rows,
            cells: vec![Vec::new(); cols * rows],
            wide: Vec::new(),
            boxes,
        };
        for i in 0..n {
            let (c0, r0, c1, r1) = grid.span_of(i);
            let covered = (c1 - c0 + 1) * (r1 - r0 + 1);
            if covered > GRID_MAX_SPAN {
                grid.wide.push(i as u32);
                continue;
            }
            for r in r0..=r1 {
                for c in c0..=c1 {
                    grid.cells[r * grid.cols + c].push(i as u32);
                }
            }
        }
        grid
    }

    fn span_of(&self, i: usize) -> (usize, usize, usize, usize) {
        let bb = self.boxes[i];
        let c0 = (((bb[0] - self.minx) / self.cell).floor().max(0.0) as usize).min(self.cols - 1);
        let r0 = (((bb[1] - self.miny) / self.cell).floor().max(0.0) as usize).min(self.rows - 1);
        let c1 = (((bb[2] - self.minx) / self.cell).floor().max(0.0) as usize).min(self.cols - 1);
        let r1 = (((bb[3] - self.miny) / self.cell).floor().max(0.0) as usize).min(self.rows - 1);
        (c0, r0, c1, r1)
    }

    /// Boîtes FERMÉES qui se touchent.
    fn boxes_overlap(&self, i: usize, j: usize) -> bool {
        let a = self.boxes[i];
        let b = self.boxes[j];
        a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
    }

    /// Candidats de `i`, TRIÉS croissants et sans doublon — l'ordre de visite
    /// des paires retenues reste donc celui de la double boucle d'origine,
    /// ce qui compte : `ts` est trié par `t` de façon STABLE puis dédupliqué,
    /// donc l'ordre d'insertion décide en cas d'égalité.
    fn candidates(&self, i: usize, out: &mut Vec<u32>) {
        out.clear();
        let (c0, r0, c1, r1) = self.span_of(i);
        let covered = (c1 - c0 + 1) * (r1 - r0 + 1);
        if covered > GRID_MAX_SPAN {
            // Segment `wide` : on ne peut pas le localiser, tout est candidat.
            out.extend(0..self.boxes.len() as u32);
        } else {
            for r in r0..=r1 {
                for c in c0..=c1 {
                    out.extend_from_slice(&self.cells[r * self.cols + c]);
                }
            }
            out.extend_from_slice(&self.wide);
            out.sort_unstable();
            out.dedup();
        }
        out.retain(|&j| j as usize != i && self.boxes_overlap(i, j as usize));
    }
}

/// `node_segments` sous ÉCHÉANCE (lot 2a), avec l'index de boîtes du lot 2e.
///
/// C'était LE poste dominant mesuré sur le corpus réel : 7,4 s des 16 s
/// natifs du pire fichier (30 000 arêtes, O(n²)), ~5× cela en wasm. L'index
/// ne change pas le résultat (voir `BboxGrid`), il ne fait qu'éviter de
/// tester des paires qui ne peuvent rien produire. Le contrôle d'échéance
/// reste échantillonné sur la boucle EXTERNE (`Deadline::STRIDE`).
pub fn node_segments_until(segments: &[(Pt, Pt)], dl: &Deadline) -> Result<Vec<(Pt, Pt)>, Expired> {
    // Intersections canoniques par PAIRE (i<j) : le point croisé est calculé
    // UNE fois et partagé par les deux segments — sinon chaque côté le
    // reconstruit avec sa propre formule (ulp différent) et l'adjacence du
    // polygonize ne fusionne plus (arêtes pendantes, faces perdues). Sans
    // snap en aval (chemin canaux nest-preprocess), c'était fatal.
    let n = segments.len();
    let grid = BboxGrid::build(segments);
    let mut cand: Vec<u32> = Vec::new();
    let mut pair_pts: std::collections::HashMap<(usize, usize), Pt> =
        std::collections::HashMap::new();
    for i in 0..n {
        dl.check_at(i)?;
        grid.candidates(i, &mut cand);
        for &jj in cand.iter() {
            let j = jj as usize;
            if j <= i {
                continue;
            }
            let (a1, a2) = segments[i];
            let (b1, b2) = segments[j];
            if let Some(p) = seg_intersection(a1, a2, b1, b2) {
                pair_pts.insert((i, j), p);
            }
        }
    }
    let mut out: Vec<(Pt, Pt)> = Vec::new();
    for (i, &(a1, a2)) in segments.iter().enumerate() {
        dl.check_at(i)?;
        let mut ts: Vec<(f64, Pt)> = Vec::new();
        grid.candidates(i, &mut cand);
        for &jj in cand.iter() {
            let j = jj as usize;
            let (b1, b2) = segments[j];
            let canon = if i < j {
                pair_pts.get(&(i, j)).copied()
            } else {
                pair_pts.get(&(j, i)).copied()
            };
            if let Some(p) = canon {
                let d = dist2(a1, a2);
                if d > 0.0 {
                    let t = (sub(p, a1)[0] * (a2[0] - a1[0]) + sub(p, a1)[1] * (a2[1] - a1[1])) / d;
                    ts.push((t, p));
                }
            }
            // T-junction: an endpoint of (b1,b2) strictly inside (a1,a2).
            for &p in &[b1, b2] {
                if point_on_segment(p, a1, a2) {
                    let d = dist2(a1, a2);
                    let t = (sub(p, a1)[0] * (a2[0] - a1[0]) + sub(p, a1)[1] * (a2[1] - a1[1])) / d;
                    ts.push((t, p));
                }
            }
        }
        if ts.is_empty() {
            out.push((a1, a2));
            continue;
        }
        // Ordre le long du segment : le paramètre t, puis, à t égal, la
        // coordonnée de l'axe dominant dans le sens du segment (deux points
        // distincts à 1 ulp l'un de l'autre ont le même t sur une arête de
        // 1800 mm).
        let along = |q: Pt| -> f64 {
            let (dx, dy) = (a2[0] - a1[0], a2[1] - a1[1]);
            if dx.abs() >= dy.abs() {
                if dx >= 0.0 { q[0] } else { -q[0] }
            } else if dy >= 0.0 {
                q[1]
            } else {
                -q[1]
            }
        };
        ts.sort_by(|x, y| x.0.total_cmp(&y.0).then(along(x.1).total_cmp(&along(y.1))));
        // On ne retire que les points IDENTIQUES (mêmes bits). Avant le
        // 16/11, deux points de coupe distincts dont les t différaient de
        // moins de 1e-12 étaient confondus : l'un était écarté, l'autre
        // segment gardait pourtant son extrémité en ce point, qui restait
        // posée au milieu d'une arête non coupée. `polygonize` (sommets par
        // bits exacts) ne reliait plus rien, et la face de matière fusionnait
        // avec la face extérieure : sur un cadre de 670x1800 à 111 trous,
        // l'anneau ouvert tombait de 867 477 à 13 696 mm². Le cas se produit
        // quand deux canaux se touchent bord à bord.
        let same = |p: Pt, q: Pt| p[0].to_bits() == q[0].to_bits() && p[1].to_bits() == q[1].to_bits();
        ts.dedup_by(|x, y| same(x.1, y.1));
        let mut prev = a1;
        for &(t, p) in &ts {
            if !(0.0..=1.0).contains(&t) || same(p, a1) || same(p, a2) || same(p, prev) {
                continue;
            }
            out.push((prev, p));
            prev = p;
        }
        out.push((prev, a2));
    }
    Ok(out)
}

// ------------------------------------------------------- polygonization

/// Minimal faces of a planar segment set via the leftmost-face rule.
/// Returns rings (closed cycles of vertices). Deterministic.
pub fn polygonize(rings: &[Vec<Pt>], segments: &[(Pt, Pt)]) -> Vec<Vec<Pt>> {
    polygonize_until(rings, segments, &Deadline::unlimited())
        .unwrap_or_else(|_| unreachable!("échéance illimitée"))
}

/// `polygonize` sous ÉCHÉANCE (lot 2a).
pub fn polygonize_until(
    rings: &[Vec<Pt>],
    segments: &[(Pt, Pt)],
    dl: &Deadline,
) -> Result<Vec<Vec<Pt>>, Expired> {
    // Build undirected edges from rings (consecutive pairs) + segments.
    let mut edges: Vec<(Pt, Pt)> = Vec::new();
    for ring in rings {
        for w in ring.windows(2) {
            edges.push((w[0], w[1]));
        }
    }
    edges.extend_from_slice(segments);

    // Map snapped points to ids (exact f64 bits after snap).
    let mut ids: HashMap<(u64, u64), usize> = HashMap::new();
    let mut verts: Vec<Pt> = Vec::new();
    let id_of = |p: Pt, ids: &mut HashMap<(u64, u64), usize>, verts: &mut Vec<Pt>| {
        *ids.entry((p[0].to_bits(), p[1].to_bits()))
            .or_insert_with(|| {
                verts.push(p);
                verts.len() - 1
            })
    };
    let mut adj: Vec<Vec<usize>> = Vec::new();
    for (i, &(a, b)) in edges.iter().enumerate() {
        dl.check_at(i)?;
        let ia = id_of(a, &mut ids, &mut verts);
        let ib = id_of(b, &mut ids, &mut verts);
        if ia == ib {
            continue;
        }
        if adj.len() <= ia.max(ib) {
            adj.resize(ia.max(ib) + 1, Vec::new());
        }
        if !adj[ia].contains(&ib) {
            adj[ia].push(ib);
        }
        if !adj[ib].contains(&ia) {
            adj[ib].push(ia);
        }
    }

    // Sort neighbors by angle around each vertex (CCW from +x axis).
    let mut adj_sorted: Vec<Vec<usize>> = adj.clone();
    for (i, nbrs) in adj_sorted.iter_mut().enumerate() {
        dl.check_at(i)?;
        let c = verts[i];
        nbrs.sort_by(|&x, &y| {
            let ax = libm::atan2(verts[x][1] - c[1], verts[x][0] - c[0]);
            let ay = libm::atan2(verts[y][1] - c[1], verts[y][0] - c[0]);
            ax.total_cmp(&ay)
        });
    }

    // Leftmost-face walk on directed edges.
    let mut used: HashMap<(usize, usize), bool> = HashMap::new();
    let mut faces: Vec<Vec<Pt>> = Vec::new();
    for (i, &(a, b)) in edges.iter().enumerate() {
        dl.check_at(i)?;
        let ia = ids[&(a[0].to_bits(), a[1].to_bits())];
        let ib = ids[&(b[0].to_bits(), b[1].to_bits())];
        if ia == ib {
            continue;
        }
        for (from, to) in [(ia, ib), (ib, ia)] {
            if used.contains_key(&(from, to)) {
                continue;
            }
            let mut face: Vec<Pt> = Vec::new();
            let mut cur_from = from;
            let mut cur_to = to;
            let mut ok = true;
            loop {
                if used.contains_key(&(cur_from, cur_to)) {
                    // Reached an already-used edge: valid only if closing.
                    if cur_from == from && cur_to == to {
                        break;
                    }
                    ok = false;
                    break;
                }
                used.insert((cur_from, cur_to), true);
                face.push(verts[cur_from]);
                // Leftmost-face rule: at cur_to, take the neighbor just
                // BEFORE the incoming edge in CCW order (= next in clockwise
                // order) — the face on the left of the walk. (No special
                // pinch handling: walking BOTH directions of every edge
                // already yields the union outline as the negative-side
                // cycle at pinches — the dissolve pass selects on area sign.)
                let nbrs = &adj_sorted[cur_to];
                let Some(pos) = nbrs.iter().position(|&x| x == cur_from) else {
                    ok = false;
                    break;
                };
                let next = nbrs[(pos + nbrs.len() - 1) % nbrs.len()];
                cur_from = cur_to;
                cur_to = next;
                if cur_from == from && cur_to == to {
                    break;
                }
                // Garde-fou de longueur : une face parcourt chaque arête
                // orientée au plus une fois, donc au plus 2 x arêtes. Avant le
                // 16/11 la borne était « sommets + 2 » : une face qui repasse
                // par ses sommets (un trait ouvert de 4 segments ou plus qui
                // touche le contour, parcouru aller et retour) la dépassait
                // dans un petit dessin, la face était abandonnée en silence et
                // la pièce disparaissait à l'import (carré + trait de pliage :
                // 0 pièce).
                if face.len() > 2 * edges.len() + 2 {
                    ok = false;
                    break;
                }
            }
            if ok && face.len() >= 3 {
                faces.push(face);
            }
        }
    }
    Ok(faces)
}

// ------------------------------------------------------------- measures

pub fn ring_signed_area(r: &[Pt]) -> f64 {
    let mut a = 0.0;
    let n = r.len();
    for i in 0..n {
        let (x0, y0) = (r[i][0], r[i][1]);
        let (x1, y1) = (r[(i + 1) % n][0], r[(i + 1) % n][1]);
        a += x0 * y1 - x1 * y0;
    }
    a / 2.0
}

pub fn point_in_ring(p: Pt, ring: &[Pt]) -> bool {
    // Ray casting (+x), f64 — boundary cases are resolved by the 1e-4 grid.
    let mut inside = false;
    let n = ring.len();
    for i in 0..n {
        let a = ring[i];
        let b = ring[(i + 1) % n];
        if (a[1] > p[1]) != (b[1] > p[1]) {
            let x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
            if p[0] < x {
                inside = !inside;
            }
        }
    }
    inside
}

/// Probe from a convex vertex: a step along the interior angle bisector
/// (quarter of the shorter adjacent edge, at most 1 mm). The ear-centroid
/// shortcut is NOT safe (the diagonal can cross a notch).
///
/// NOT a face probe: the step can land inside a loop nested in the ring
/// (thin-walled frame) or leave a narrow ring altogether. Depth counts must
/// go through `face_probes`, which keeps this point only when it is valid.
pub fn interior_probe(ring: &[Pt]) -> Pt {
    let n = ring.len();
    // Orientation-agnostic: the convex-vertex turn sign follows the ring's
    // signed area (CW exterior in this pipeline).
    let turn_sign = if ring_signed_area(ring) < 0.0 { -1.0 } else { 1.0 };
    for i in 0..n {
        let a = ring[i];
        let b = ring[(i + 1) % n];
        let c = ring[(i + 2) % n];
        let ba = sub(a, b);
        let bc = sub(c, b);
        if cross(bc, ba) * turn_sign > 0.0 {
            // Convex vertex (left turn ba→bc… cross(bc,ba)>0 means interior < 180°).
            let la = (ba[0] * ba[0] + ba[1] * ba[1]).sqrt();
            let lc = (bc[0] * bc[0] + bc[1] * bc[1]).sqrt();
            if la == 0.0 || lc == 0.0 {
                continue;
            }
            let ux = ba[0] / la + bc[0] / lc;
            let uy = ba[1] / la + bc[1] / lc;
            let ul = (ux * ux + uy * uy).sqrt();
            if ul == 0.0 {
                continue;
            }
            // Step: quarter of the shorter adjacent edge, within [1e-3, 1.0].
            let eps = (la.min(lc) / 4.0).clamp(1e-3, 1.0);
            return [b[0] + ux / ul * eps, b[1] + uy / ul * eps];
        }
    }
    // Fallback: vertex centroid (convex rings always work above).
    let mut cx = 0.0;
    let mut cy = 0.0;
    for p in ring {
        cx += p[0];
        cy += p[1];
    }
    [cx / n as f64, cy / n as f64]
}

/// Sondes « de face » : pour chaque anneau, un point DANS l'anneau et HORS
/// de tout anneau plus petit — donc dans la face elle-même, jamais dans une
/// boucle imbriquée. C'est ce que rend `representative_point()` côté Python,
/// où `polygonize` livre des faces AVEC leurs trous.
///
/// Pourquoi (défaut de prod du 14/11) : `interior_probe` avance jusqu'à 1 mm
/// le long de la bissectrice d'un coin. Un cadre dont la paroi fait moins de
/// 0,7 mm voyait sa sonde tomber dans son propre vide : compté à la
/// profondeur 2, il n'était plus de la matière, et ses deux contours
/// partaient avec la petite pièce posée en son milieu (attach.rs, repli au
/// centroïde). Une face étroite (bande en C d'un trou ouvert) voyait de même
/// sa sonde sortir d'elle-même.
///
/// Les anneaux viennent d'un linework nodé : ils ne se croisent pas (sauf
/// croisement créé par le snap à 1e-4, qui n'est pas re-nodé — de l'ordre de
/// la grille). Un anneau plus petit qui contient un point de l'anneau `i`
/// est donc imbriqué dans `i` ; un anneau plus grand le contient en entier.
/// « Dans l'anneau, hors des plus petits » suffit.
///
/// La sonde historique est GARDÉE dès qu'elle est valide : la sortie reste
/// identique au bit près sur tout dessin où elle ne se trompait pas.
pub fn face_probes(rings: &[Vec<Pt>]) -> Vec<Pt> {
    face_probes_until(rings, &Deadline::unlimited())
        .unwrap_or_else(|_| unreachable!("échéance illimitée"))
}

/// `face_probes` sous échéance.
pub fn face_probes_until(rings: &[Vec<Pt>], dl: &Deadline) -> Result<Vec<Pt>, Expired> {
    let areas: Vec<f64> = rings.iter().map(|r| ring_signed_area(r).abs()).collect();
    let boxes: Vec<[f64; 4]> = rings.iter().map(|r| ring_bbox(r)).collect();
    let mut out: Vec<Pt> = Vec::with_capacity(rings.len());
    for (i, ring) in rings.iter().enumerate() {
        dl.check_at(i)?;
        let legacy = interior_probe(ring);
        if ring.len() < 3 {
            out.push(legacy);
            continue;
        }
        let nested = |j: usize| j != i && areas[j] < areas[i];
        let valid = |p: Pt| {
            // Même garde de boîte que `ring_depths_until` : la sonde retenue
            // est comptée dans son propre anneau par le compte de profondeur.
            in_bbox(p, &boxes[i])
                && point_in_ring(p, ring)
                && !(0..rings.len()).any(|j| {
                    nested(j) && in_bbox(p, &boxes[j]) && point_in_ring(p, &rings[j])
                })
        };
        if valid(legacy) {
            out.push(legacy);
            continue;
        }
        let bi = boxes[i];
        let inner: Vec<&[Pt]> = (0..rings.len())
            .filter(|&j| {
                let b = boxes[j];
                nested(j) && b[0] <= bi[2] && b[2] >= bi[0] && b[1] <= bi[3] && b[3] >= bi[1]
            })
            .map(|j| rings[j].as_slice())
            .collect();
        let found = scanline_probe(ring, &inner, &valid);
        if found.is_none() && std::env::var("NI_DEBUG").is_ok() {
            // Ne se produit que si des anneaux se croisent : on garde alors
            // la sonde historique, comme avant ce lot.
            eprintln!("[probe] anneau {i} : aucune sonde de face, sonde historique gardée");
        }
        out.push(found.unwrap_or(legacy));
    }
    Ok(out)
}

/// Profondeur de chaque sonde : nombre d'anneaux qui la contiennent. Même
/// compte qu'avant (`point_in_ring` sur tous les anneaux), avec un rejet par
/// boîte englobante : hors de la boîte, `point_in_ring` répond toujours faux
/// (aucune traversée si y est hors bornes ou x au-delà du bord droit, un
/// nombre pair si x est avant le bord gauche). Le résultat est le même, à
/// une exception près, mesurée en relecture : pour un point posé à 1 ou 2 ulp
/// HORS de la boîte en x, à l'ordonnée exacte d'un sommet, l'ancienne formule
/// pouvait répondre « dedans » par arrondi ; le rejet répond « dehors », ce
/// qui est la bonne réponse. Aucune sonde ne tombe là (724 dessins comparés,
/// profondeurs égales). Le coût passe d'anneaux × sommets à anneaux × boîtes,
/// ce qui paie largement le contrôle des sondes de `face_probes`.
pub fn ring_depths_until(
    rings: &[Vec<Pt>],
    probes: &[Pt],
    dl: &Deadline,
) -> Result<Vec<usize>, Expired> {
    let boxes: Vec<[f64; 4]> = rings.iter().map(|r| ring_bbox(r)).collect();
    let mut depths: Vec<usize> = Vec::with_capacity(probes.len());
    for (i, &p) in probes.iter().enumerate() {
        dl.check_at(i)?;
        depths.push(
            rings
                .iter()
                .zip(&boxes)
                .filter(|(r, b)| in_bbox(p, b) && point_in_ring(p, r))
                .count(),
        );
    }
    Ok(depths)
}

fn in_bbox(p: Pt, b: &[f64; 4]) -> bool {
    p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]
}

fn ring_bbox(r: &[Pt]) -> [f64; 4] {
    r.iter().fold(
        [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY],
        |a, p| [a[0].min(p[0]), a[1].min(p[1]), a[2].max(p[0]), a[3].max(p[1])],
    )
}

/// Abscisses où l'horizontale `y` traverse l'anneau, triées. Même règle
/// demi-ouverte et même formule que `point_in_ring` : les intervalles
/// [x0,x1), [x2,x3)… sont exactement ceux où `point_in_ring` répond vrai.
fn scan_crossings(ring: &[Pt], y: f64) -> Vec<f64> {
    let n = ring.len();
    let mut xs: Vec<f64> = Vec::new();
    for i in 0..n {
        let a = ring[i];
        let b = ring[(i + 1) % n];
        if (a[1] > y) != (b[1] > y) {
            xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
    }
    xs.sort_by(|p, q| p.total_cmp(q));
    xs
}

/// Nombre maximal d'horizontales essayées par passe de `scanline_probe`.
/// Sans croisement d'anneaux la première suffit (les anneaux imbriqués ne
/// touchent pas le bord) ; la borne majore le coût d'un cas dégénéré.
const SCANLINE_MAX_TRIES: usize = 64;

/// Sonde par balayage (algorithme de `InteriorPointArea` de GEOS, sur la
/// face = anneau moins anneaux imbriqués) : sur une horizontale passant
/// entre deux ordonnées de sommets, on retire aux intervalles intérieurs de
/// l'anneau ceux des anneaux imbriqués et on prend le milieu du plus large
/// reste. Que des +, −, ×, ÷ et des tris : identique en natif et en wasm.
///
/// Deux passes. D'abord les bandes prises entre les seules ordonnées de
/// l'anneau : sans croisement d'anneaux la première convient, et le coût ne
/// dépend pas du nombre d'anneaux imbriqués. Si aucune ne convient (une
/// bande entièrement couverte, ce qui demande des anneaux qui se croisent),
/// on reprend avec, en plus, les ordonnées des anneaux imbriqués, comme
/// GEOS.
fn scanline_probe(ring: &[Pt], inner: &[&[Pt]], valid: &dyn Fn(Pt) -> bool) -> Option<Pt> {
    let own_ys: Vec<f64> = ring.iter().map(|p| p[1]).collect();
    if let Some(p) = scan_bands(ring, inner, own_ys.clone(), valid) {
        return Some(p);
    }
    let (y_lo, y_hi) = own_ys
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &y| (lo.min(y), hi.max(y)));
    let mut ys = own_ys;
    let n_own = ys.len();
    for r in inner {
        ys.extend(r.iter().map(|p| p[1]).filter(|&y| y > y_lo && y < y_hi));
    }
    if ys.len() == n_own {
        return None;
    }
    scan_bands(ring, inner, ys, valid)
}

/// Une passe de `scanline_probe` sur les bandes définies par `ys`.
fn scan_bands(
    ring: &[Pt],
    inner: &[&[Pt]],
    mut ys: Vec<f64>,
    valid: &dyn Fn(Pt) -> bool,
) -> Option<Pt> {
    ys.sort_by(|p, q| p.total_cmp(q));
    ys.dedup();
    // Bandes entre ordonnées consécutives : la plus haute d'abord (à
    // égalité, la plus basse en y) — ordre déterministe.
    let mut bands: Vec<(f64, f64)> = ys
        .windows(2)
        .map(|w| (w[1] - w[0], (w[0] + w[1]) / 2.0))
        .collect();
    bands.sort_by(|p, q| q.0.total_cmp(&p.0).then(p.1.total_cmp(&q.1)));
    for &(_, y) in bands.iter().take(SCANLINE_MAX_TRIES) {
        let own = scan_crossings(ring, y);
        let mut cuts: Vec<(f64, f64)> = Vec::new();
        for r in inner {
            for c in scan_crossings(r, y).chunks_exact(2) {
                cuts.push((c[0], c[1]));
            }
        }
        cuts.sort_by(|p, q| p.0.total_cmp(&q.0).then(p.1.total_cmp(&q.1)));
        // (largeur, milieu) du plus large reste ; à égalité, le premier.
        let mut best: Option<(f64, f64)> = None;
        let mut consider = |a: f64, b: f64| {
            let w = b - a;
            if w > 0.0 && best.map(|(bw, _)| w > bw).unwrap_or(true) {
                best = Some((w, (a + b) / 2.0));
            }
        };
        for seg in own.chunks_exact(2) {
            let (lo, hi) = (seg[0], seg[1]);
            let mut cur = lo;
            for &(c0, c1) in &cuts {
                if c1 <= cur {
                    continue;
                }
                if c0 >= hi {
                    break;
                }
                if c0 > cur {
                    consider(cur, c0);
                }
                cur = cur.max(c1);
                if cur >= hi {
                    break;
                }
            }
            if cur < hi {
                consider(cur, hi);
            }
        }
        if let Some((_, x)) = best {
            let p = [x, y];
            if valid(p) {
                return Some(p);
            }
        }
    }
    None
}

pub fn ring_contains(outer: &[Pt], inner: &[Pt]) -> bool {
    inner.iter().any(|&p| point_in_ring(p, outer))
}

/// reduce_ring (build_geometry.to_mongo_dict twin): keep a point iff it
/// moved > 0.01 from the last KEPT point (x or y).
pub fn reduce_ring(ring: &[Pt]) -> Vec<Pt> {
    let mut out: Vec<Pt> = Vec::new();
    for &p in ring {
        match out.last() {
            None => out.push(p),
            Some(&last) => {
                if (p[0] - last[0]).abs() > 0.01 || (p[1] - last[1]).abs() > 0.01 {
                    out.push(p);
                }
            }
        }
    }
    out
}

/// Seuils du NETTOYAGE GÉOMÉTRIQUE (lot E1 de
/// `docs/PLAN-ECLATEMENT-2026-09-12.md` §3) — miroir exact du Python
/// (`core/geometry/build_geometry.py`).
///
/// Un trou plus petit que ça n'est pas une découpe : c'est un artefact de
/// dessin (deux traits qui ne se rejoignent pas tout à fait, un congé
/// dégénéré). Le garder coûte cher et ne sert à rien — jagua ouvre chaque
/// trou par un canal capillaire (piège AGENTS #2) et un canal dans un vide
/// de 0,3 mm² écrase l'anneau.
pub const MICRO_VOID_AREA_MM2: f64 = 1.0;
pub const MICRO_VOID_MIN_DIM_MM: f64 = 0.5;
/// Tolérance des aller-retours de largeur nulle (même 0,01 mm que
/// `reduce_ring`, qui fusionne déjà deux sommets CONSÉCUTIFS sous ce seuil).
pub const SPUR_EPS_MM: f64 = 0.01;
/// Largeur minimale d'une pièce (règle W) : un corps dont l'anneau extérieur
/// nettoyé a une largeur minimale (distance entre deux parallèles qui
/// l'enserrent) sous ce seuil n'est pas une pièce. Miroir exact de
/// `MIN_PART_WIDTH_MM` (`worker_common/geometry/cleanup.py`).
pub const MIN_PART_WIDTH_MM: f64 = 0.1;

#[inline]
fn cross3(o: Pt, a: Pt, b: Pt) -> f64 {
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/// Règle W : la largeur minimale (plus petit calibre de l'enveloppe convexe)
/// est-elle sous `MIN_PART_WIDTH_MM` ? Anneau ouvert ou fermé. Arithmétique
/// identique au Python : ni `mul_add`, ni `hypot`, ni `sqrt`.
pub fn ring_too_thin(ring: &[Pt]) -> bool {
    let mut pts: Vec<Pt> = ring.to_vec();
    pts.sort_by(|a, b| {
        a[0].partial_cmp(&b[0])
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a[1].partial_cmp(&b[1]).unwrap_or(std::cmp::Ordering::Equal))
    });
    pts.dedup_by(|a, b| a[0] == b[0] && a[1] == b[1]);
    if pts.len() < 3 {
        return true;
    }
    let mut lower: Vec<Pt> = Vec::new();
    for &p in &pts {
        while lower.len() >= 2 && cross3(lower[lower.len() - 2], lower[lower.len() - 1], p) <= 0.0 {
            lower.pop();
        }
        lower.push(p);
    }
    let mut upper: Vec<Pt> = Vec::new();
    for &p in pts.iter().rev() {
        while upper.len() >= 2 && cross3(upper[upper.len() - 2], upper[upper.len() - 1], p) <= 0.0 {
            upper.pop();
        }
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    let mut hull = lower;
    hull.extend(upper);
    let m = hull.len();
    if m < 3 {
        return true;
    }
    let w2 = MIN_PART_WIDTH_MM * MIN_PART_WIDTH_MM;
    let mut j = 1usize;
    for i in 0..m {
        let p = hull[i];
        let q = hull[(i + 1) % m];
        let dx = q[0] - p[0];
        let dy = q[1] - p[1];
        let len2 = dx * dx + dy * dy;
        let mut steps = 0usize;
        while steps < m && cross3(p, q, hull[(j + 1) % m]) > cross3(p, q, hull[j]) {
            j = (j + 1) % m;
            steps += 1;
        }
        let c = cross3(p, q, hull[j]);
        if c * c < w2 * len2 {
            // Les calibres ne sont qu'un FILTRE : en flottant, l'enveloppe garde
            // des sommets colinéaires à l'arrondi près, la boucle ci-dessus
            // s'arrête sur un faux plateau et `c` est une largeur fausse et
            // minuscule (revue B1). On confirme par un balayage complet du côté.
            let mut lo = 0.0f64;
            let mut hi = 0.0f64;
            for k in 0..m {
                let v = cross3(p, q, hull[k]);
                if v < lo {
                    lo = v;
                }
                if v > hi {
                    hi = v;
                }
            }
            let e = hi - lo;
            if e * e < w2 * len2 {
                return true;
            }
        }
    }
    false
}

/// Un trou trop petit pour être découpé (aire ou plus petit côté).
pub fn is_micro_void(ring: &[Pt]) -> bool {
    if ring.len() < 3 {
        return true;
    }
    let (min_x, max_x, min_y, max_y) = ring.iter().fold(
        (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY),
        |(a, b, c, d), p| (a.min(p[0]), b.max(p[0]), c.min(p[1]), d.max(p[1])),
    );
    let (w, h) = (max_x - min_x, max_y - min_y);
    ring_signed_area(ring).abs() < MICRO_VOID_AREA_MM2 || w.min(h) < MICRO_VOID_MIN_DIM_MM
}

/// Supprime les ALLER-RETOURS DE LARGEUR NULLE d'un anneau (ouvert, cyclique)
/// et rend le nombre de sommets retirés.
///
/// Le motif : le tracé part de A, va en B et revient en A' à moins de
/// 0,01 mm de A. `reduce_ring` ne le voit pas (A et B sont à 7 mm l'un de
/// l'autre, A et A' ne sont pas consécutifs), et ce qui reste est un ergot
/// d'aire nulle. Mesuré au lot E0 : c'est ce motif qui fait échouer le
/// *surrogate* de jagua (« no pole found with 10 levels of recursion ») et
/// tue le job à l'import — deux fichiers du corpus, un DXF de marquage dont
/// la polyligne revient sur elle-même à 0,0001 mm près.
///
/// On garde A, on jette B et A'. Itératif : un ergot niché dans un ergot
/// disparaît au passage suivant.
pub fn strip_spurs(ring: &mut Vec<Pt>) -> usize {
    let eps2 = SPUR_EPS_MM * SPUR_EPS_MM;
    let mut total = 0usize;
    loop {
        let n = ring.len();
        if n < 4 {
            return total;
        }
        let mut keep = vec![true; n];
        let mut removed = 0usize;
        let mut i = 0usize;
        while i < n {
            let prev = (i + n - 1) % n;
            let next = (i + 1) % n;
            if keep[i] && keep[prev] && keep[next] && prev != next {
                let (a, c) = (ring[prev], ring[next]);
                let (dx, dy) = (a[0] - c[0], a[1] - c[1]);
                if dx * dx + dy * dy <= eps2 {
                    keep[i] = false;
                    keep[next] = false;
                    removed += 2;
                    i += 2;
                    continue;
                }
            }
            i += 1;
        }
        if removed == 0 {
            return total;
        }
        *ring = ring
            .iter()
            .zip(keep.iter())
            .filter(|(_, k)| **k)
            .map(|(p, _)| *p)
            .collect();
        total += removed;
    }
}

/// Boundary of the union of material BODIES: edges (undirected, snapped)
/// appearing in exactly one body — a body = a material face PLUS its hole
/// rings (a hole edge borders exactly one body → kept; a shared outer edge
/// borders two → dissolved). Returns None when there is nothing to dissolve
/// for a single body: no material, or one body no two rings of which share
/// an edge (a ring that walks one of its own edges twice, a zero-width spur,
/// does not count: `strip_spurs` deals with it, and sending such a drawing
/// through the second pass would only reorder its rings).
///
/// A single body whose HOLES share walls (a grid drawn inside an opening)
/// does go through the second pass, like any drawing with several bodies:
/// its cells merge into one hole outline. Without it the cells came out as
/// separate touching holes for a one-part drawing and as one hole as soon
/// as the drawing had a second part (measured 14/11 on two real drawings:
/// 205 touching holes, an opened ring that was not valid and left 2.6 % of
/// the material uncovered, against 13 holes and a valid ring once merged).
fn dissolve_boundary(
    unique: &[Vec<Pt>],
    depths: &[usize],
    probes: &[Pt],
    material: &[usize],
    dl: &Deadline,
) -> Result<Option<Vec<(Pt, Pt)>>, Expired> {
    if material.is_empty() {
        return Ok(None);
    }
    let mut counts: HashMap<((u64, u64), (u64, u64)), (Pt, Pt)> = HashMap::new();
    let mut multi: std::collections::HashSet<((u64, u64), (u64, u64))> = std::collections::HashSet::new();
    // Première boucle à avoir posé chaque arête, et : deux boucles
    // DIFFÉRENTES partagent-elles une arête ?
    let mut owner: HashMap<((u64, u64), (u64, u64)), usize> = HashMap::new();
    let mut shared_wall = false;
    let mut account = |ring: &[Pt], ring_id: usize| {
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
            if *owner.entry(key).or_insert(ring_id) != ring_id {
                shared_wall = true;
            }
        }
    };
    for (mi_idx, &mi) in material.iter().enumerate() {
        dl.check_at(mi_idx)?;
        account(&unique[mi], mi);
        // Holes of this body: cycles one level deeper contained in it.
        for (j, u) in unique.iter().enumerate() {
            if j == mi || depths[j] != depths[mi] + 1 {
                continue;
            }
            if ring_contains(&unique[mi], &[probes[j]]) {
                account(u, j);
            }
        }
    }
    if material.len() == 1 && !shared_wall {
        return Ok(None);
    }
    // Iteration d'une HashMap = ordre aléatoire par processus (RandomState) :
    // il faut un ordre d'émission DÉTERMINISTE des arêtes de frontière, sinon
    // la re-polygonisation part d'un sommet arbitraire et la sortie n'est pas
    // reproductible (verrou : parity/determinism_lock.mjs). Tri par clé
    // canonique (arête non orientée, bits exacts post-snap).
    let mut keyed: Vec<_> = counts
        .into_iter()
        .filter(|(k, _)| !multi.contains(k))
        .collect();
    keyed.sort_by(|(ka, _), (kb, _)| ka.cmp(kb));
    let boundary: Vec<(Pt, Pt)> = keyed.into_iter().map(|(_, ab)| ab).collect();
    Ok(Some(boundary))
}

/// Constats de l'assemblage (lot 2c) : ce que l'assemblage a laissé de côté.
#[derive(Debug, Clone, Default)]
pub struct AssemblyStats {
    /// Tracés ouverts qui ne referment aucune pièce (« dangles » de GEOS),
    /// comptés en CHAÎNES, comme `len(dangles.geoms)` côté shapely.
    pub dangling_paths: usize,
    /// Corps écartés à l'émission (côté sous 0,1 mm, anneau dégénéré).
    pub dropped_parts: usize,
    /// Trous rebouchés parce que trop petits pour être découpés (lot E1).
    pub micro_voids: usize,
    /// Sommets retirés par `strip_spurs` (aller-retours de largeur nulle).
    pub spurs_removed: usize,
    /// Handles des entités rattachées à AUCUNE pièce (avant les filtres
    /// d'émission, dont les handles des corps écartés partent déjà avec eux
    /// sous `dropped_parts`). Miroir de `build_geometry.py`.
    pub uncut_handles: Vec<String>,
}

/// Tracés ouverts d'un jeu d'arêtes : pelage itératif des sommets de degré 1
/// (définition des « dangles » du polygonize GEOS), puis comptage des
/// CHAÎNES connexes parmi les arêtes pelées.
///
/// Pourquoi cette mesure existe (lot 2c) : côté navigateur, le nombre de
/// tracés pendants n'était **pas produit du tout** (`openContours` nul sur
/// les 85 JSON du lot B) alors que le serveur le voyait — 33 fichiers réels
/// sur 153 perdent du linework en silence. On ne peut pas afficher un compte
/// qu'on ne mesure pas.
pub fn dangling_paths(edges: &[(Pt, Pt)]) -> usize {
    dangling_paths_until(edges, &Deadline::unlimited())
        .unwrap_or_else(|_| unreachable!("échéance illimitée"))
}

/// `dangling_paths` sous ÉCHÉANCE : l'union-find compresse ses chemins (un
/// tracé ouvert de 50 000 arêtes formait une liste de 50 000 maillons parcourue
/// à chaque recherche, quadratique) et l'horloge est lue dans chaque boucle.
pub fn dangling_paths_until(edges: &[(Pt, Pt)], dl: &Deadline) -> Result<usize, Expired> {
    type Key = (u64, u64);
    let key = |p: Pt| -> Key { (p[0].to_bits(), p[1].to_bits()) };
    let mut inc: HashMap<Key, Vec<usize>> = HashMap::new();
    for (i, &(a, b)) in edges.iter().enumerate() {
        if key(a) == key(b) {
            continue;
        }
        inc.entry(key(a)).or_default().push(i);
        inc.entry(key(b)).or_default().push(i);
    }
    let mut degree: HashMap<Key, usize> = inc.iter().map(|(k, v)| (*k, v.len())).collect();
    let mut peeled = vec![false; edges.len()];
    // File des sommets de degré 1 — ordre déterministe (tri des clés).
    let mut queue: Vec<Key> = degree.iter().filter(|(_, d)| **d == 1).map(|(k, _)| *k).collect();
    queue.sort();
    let mut steps = 0usize;
    while let Some(v) = queue.pop() {
        steps += 1;
        dl.check_at(steps)?;
        if degree.get(&v).copied().unwrap_or(0) != 1 {
            continue;
        }
        let Some(edges_of_v) = inc.get(&v) else { continue };
        let Some(&ei) = edges_of_v.iter().find(|&&i| !peeled[i]) else { continue };
        peeled[ei] = true;
        let (a, b) = edges[ei];
        for k in [key(a), key(b)] {
            if let Some(d) = degree.get_mut(&k) {
                *d = d.saturating_sub(1);
                if *d == 1 {
                    queue.push(k);
                }
            }
        }
    }
    // Chaînes : composantes connexes des arêtes pelées (union-find).
    let mut parent: HashMap<Key, Key> = HashMap::new();
    fn find(parent: &mut HashMap<(u64, u64), (u64, u64)>, x: (u64, u64)) -> (u64, u64) {
        let mut r = x;
        while let Some(&p) = parent.get(&r) {
            if p == r {
                break;
            }
            r = p;
        }
        // compression de chemin : chaque maillon traversé pointe sur la racine.
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
        if !peeled[i] {
            continue;
        }
        let (ka, kb) = (key(a), key(b));
        parent.entry(ka).or_insert(ka);
        parent.entry(kb).or_insert(kb);
        let (ra, rb) = (find(&mut parent, ka), find(&mut parent, kb));
        if ra != rb {
            parent.insert(ra, rb);
        }
    }
    let mut roots: std::collections::HashSet<Key> = std::collections::HashSet::new();
    let keys: Vec<Key> = parent.keys().copied().collect();
    for (i, k) in keys.into_iter().enumerate() {
        dl.check_at(i)?;
        let r = find(&mut parent, k);
        roots.insert(r);
    }
    Ok(roots.len())
}

/// Full assembly: linework → parts. Mirrors build_geometry + to_mongo_dict.
pub fn build_parts(lw: Linework, tol: f64) -> Vec<Part> {
    build_parts_until(lw, tol, &Deadline::unlimited())
        .unwrap_or_else(|_| unreachable!("échéance illimitée"))
}

/// `build_parts` sous ÉCHÉANCE (lot 2a) : tout le temps d'import d'un fichier
/// lourd se passe ici (mesuré sur le corpus réel : 16 s des 16,1 s natifs du
/// pire fichier, dont 7,4 s de `node_segments`).
pub fn build_parts_until(lw: Linework, tol: f64, dl: &Deadline) -> Result<Vec<Part>, Expired> {
    build_parts_stats_until(lw, tol, dl).map(|(p, _)| p)
}

/// `build_parts_until` + les constats de l'assemblage (lot 2c).
pub fn build_parts_stats_until(
    lw: Linework,
    tol: f64,
    dl: &Deadline,
) -> Result<(Vec<Part>, AssemblyStats), Expired> {
    let mut asm = AssemblyStats::default();
    // 1) Noding at FULL precision over EVERYTHING (ring edges + open
    //    segments) — GEOS's first unary_union nodes the whole linework set
    //    together; snapping comes after (set_precision).
    let mut all_edges: Vec<(Pt, Pt)> = Vec::new();
    for ring in &lw.rings {
        for w in ring.windows(2) {
            all_edges.push((w[0], w[1]));
        }
    }
    all_edges.extend_from_slice(&lw.segments);
    let noded_full = node_segments_until(&all_edges, dl)?;

    // 2) Snap to the 1e-4 grid (set_precision), drop degenerate edges, join
    //    the free ends that the rounding set one step apart.
    let mut edges = snap_edges_until(&noded_full, dl)?;
    // Constat lot 2c : le linework qui ne referme rien (mesuré sur le jeu
    // d'arêtes SNAPPÉ, celui que la polygonisation voit).
    asm.dangling_paths = dangling_paths_until(&edges, dl)?;
    // A second union pass in GEOS re-nodes snap-induced crossings — the
    // polygonizer below sees a clean edge set either way.
    // Ponts entre deux contours fermés retirés, comme `polygonize_full` côté
    // serveur (ses `cuts`) : gardés, ils soudent un trou au bord et le trou
    // passe pour de la matière.
    edges = drop_bridges_until(edges, dl)?;

    let mut faces = polygonize_until(&[], &edges, dl)?;
    if std::env::var("NI_DEBUG").is_ok() {
        eprintln!("[dbg] rings={} edges={} faces={}", lw.rings.len(), edges.len(), faces.len());
        for f in &faces {
            eprintln!("[dbg] face n={} area={:.4}", f.len(), ring_signed_area(f));
        }
    }

    // The leftmost-face walk emits the UNBOUNDED exterior face too (negative
    // signed area) — shapely's polygonize never returns it, and it breaks the
    // even-odd depth count. Drop it: exterior = negative area here.
    faces.retain(|f| ring_signed_area(f) > 1e-10);

    // GEOS output orientation for this pipeline is CW exterior (measured on
    // the golden corpus — do NOT "fix" to CCW). Normalize to it.
    for f in faces.iter_mut() {
        if ring_signed_area(f) > 0.0 {
            f.reverse();
        }
    }

    // 3) Even-odd on unique cycles (dedup by coordinate set, like Python's
    //    _ring_key frozenset). Depth counts the face's OWN ring (Python
    //    _material_faces parity); probe = guaranteed-interior ear centroid.
    let mut unique: Vec<Vec<Pt>> = Vec::new();
    let mut seen: std::collections::HashSet<Vec<(u64, u64)>> = std::collections::HashSet::new();
    for f in &faces {
        let mut key: Vec<(u64, u64)> = f
            .iter()
            .map(|p| (p[0].to_bits(), p[1].to_bits()))
            .collect();
        key.sort();
        key.dedup();
        if seen.insert(key) {
            unique.push(f.clone());
        }
    }
    dl.check()?;
    let probes: Vec<Pt> = face_probes_until(&unique, dl)?;
    let depths: Vec<usize> = ring_depths_until(&unique, &probes, dl)?;
    let material: Vec<usize> = (0..unique.len()).filter(|&i| depths[i] % 2 == 1).collect();
    if std::env::var("NI_DEBUG").is_ok() {
        eprintln!("[dbg] unique={} depths={:?} material={:?}", unique.len(), depths, material);
        for (i, u) in unique.iter().enumerate() {
            eprintln!("[dbg] face{} probe={:?} contains_self={} n={}", i, probes[i],
                point_in_ring(probes[i], u), u.len());
        }
    }

    // 3b) Dissolve (GEOS unary_union twin): material faces that share an edge
    //     merge into one body. The union boundary = edges appearing in
    //     EXACTLY ONE material face; re-walking that boundary yields the
    //     bodies (voids become holes naturally).
    let boundary = dissolve_boundary(&unique, &depths, &probes, &material, dl)?;

    // 4) Bodies from the boundary: the union outlines are the NEGATIVE-area
    //    cycles of the boundary walk (a body's exterior outline is the
    //    "exterior side" of its minimal faces — GEOS unary_union orientation
    //    CW). At a pinch vertex (figure-8) the walk switches lobes and
    //    produces ONE self-touching ring, which reproduces the Python weld
    //    (_merge_near_polygons buffer ±0.1) vertex-for-vertex.
    let (unique, depths, probes, material) = if boundary.is_some() {
        let mut faces2 = polygonize_until(&[], &boundary.unwrap(), dl)?;
        faces2.retain(|f| ring_signed_area(f) < -1e-10);
        let mut uniq2: Vec<Vec<Pt>> = Vec::new();
        let mut seen2: std::collections::HashSet<Vec<(u64, u64)>> = std::collections::HashSet::new();
        for f in &faces2 {
            let mut key: Vec<(u64, u64)> = f.iter().map(|p| (p[0].to_bits(), p[1].to_bits())).collect();
            key.sort();
            key.dedup();
            if seen2.insert(key) {
                uniq2.push(f.clone());
            }
        }
        dl.check()?;
        let probes2: Vec<Pt> = face_probes_until(&uniq2, dl)?;
        let depths2: Vec<usize> = ring_depths_until(&uniq2, &probes2, dl)?;
        let mat2: Vec<usize> = (0..uniq2.len()).filter(|&i| depths2[i] % 2 == 1).collect();
        if std::env::var("NI_DEBUG").is_ok() {
            eprintln!("[dbg] pass2 uniq2={} depths2={:?} mat2={:?}", uniq2.len(), depths2, mat2);
            for (i, u) in uniq2.iter().enumerate() {
                eprintln!("[dbg] p2 face{} n={} area={:.4} probe={:?}", i, u.len(), ring_signed_area(u), probes2[i]);
            }
        }
        (uniq2, depths2, probes2, mat2)
    } else {
        (unique, depths, probes, material)
    };

    // 5) Parts: body ring + holes = cycles one level deeper contained in it.
    let mut parts: Vec<(Vec<Pt>, Vec<Vec<Pt>>)> = Vec::new();
    for (mi_idx, &mi) in material.iter().enumerate() {
        dl.check_at(mi_idx)?;
        let mut holes: Vec<Vec<Pt>> = Vec::new();
        for (j, u) in unique.iter().enumerate() {
            if j == mi || depths[j] != depths[mi] + 1 {
                continue;
            }
            if ring_contains(&unique[mi], &[probes[j]]) {
                holes.push(u.clone());
            }
        }
        parts.push((unique[mi].clone(), holes));
    }

    // 5) Emit parts (reduce_ring, bbox filter, orientation), ordered by
    //    (y-min, x-min) ascending — GEOS unary_union collection order
    //    (re-mesuré 2026-08-07 sur corpus SVG : probes disjoints, tie-break
    //    x ; l'ordre x-d'abord de PR1 était une coïncidence du corpus DXF).
    let mut ordered = parts;
    ordered.sort_by(|(a, _), (b, _)| {
        let amin = a.iter().fold((f64::INFINITY, f64::INFINITY), |acc, p| (acc.0.min(p[1]), acc.1.min(p[0])));
        let bmin = b.iter().fold((f64::INFINITY, f64::INFINITY), |acc, p| (acc.0.min(p[1]), acc.1.min(p[0])));
        amin.partial_cmp(&bmin).unwrap_or(std::cmp::Ordering::Equal)
    });
    let parts = ordered;
    // Attachement des handles (build_geometry.py lignes ~328-367, J-090) :
    // sur les corps ORDONNÉS mais AVANT les filtres d'émission (le Python
    // attache sur tous les bodies puis to_mongo_dict écarte les petits —
    // les handles des corps filtrés disparaissent avec eux). probe_tol =
    // max(tolerance, 1e-6) côté Python ; ici tolerance = tol (flattening).
    let bodies: Vec<crate::attach::Body> = parts
        .iter()
        .map(|(outer, holes)| crate::attach::Body { outer, holes })
        .collect();
    let assigned =
        crate::attach::attach_handles_until(&lw.footprints, &bodies, tol.max(1e-6), dl)?;
    {
        let attached: std::collections::HashSet<&str> =
            assigned.iter().flatten().map(|h| h.as_str()).collect();
        asm.uncut_handles = lw
            .footprints
            .iter()
            .filter(|f| !attached.contains(f.handle.as_str()))
            .map(|f| f.handle.clone())
            .collect();
    }
    let mut out: Vec<Part> = Vec::new();
    for ((outer, holes), handles) in parts.into_iter().zip(assigned) {
        let mut ext = reduce_ring(&outer);
        // Lot E1 : les aller-retours de largeur nulle partent AVANT la
        // mesure de la bbox et avant la fermeture — ils ne portent pas de
        // matière et le moteur ne sait pas les préparer.
        asm.spurs_removed += strip_spurs(&mut ext);
        if ext.len() < 3 {
            asm.dropped_parts += 1;
            continue;
        }
        // shapely emits the closing vertex (first == last) — match it.
        if ext.first() != ext.last() {
            ext.push(ext[0]);
        }
        let (min_x, max_x, min_y, max_y) = ext.iter().fold(
            (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY),
            |(a, b, c, d), p| (a.min(p[0]), b.max(p[0]), c.min(p[1]), d.max(p[1])),
        );
        let width = max_x - min_x;
        let height = max_y - min_y;
        if width.abs() < 0.1 || height.abs() < 0.1 {
            asm.dropped_parts += 1;
            continue;
        }
        if ring_too_thin(&ext) {
            asm.dropped_parts += 1;
            continue;
        }
        let mut holes_out: Vec<Vec<Pt>> = Vec::new();
        for h in &holes {
            let mut hh = reduce_ring(h);
            asm.spurs_removed += strip_spurs(&mut hh);
            // Lot E1 : un micro-vide n'est plus un trou — il est rebouché
            // (retiré de la liste : la matière reprend sa place) et compté.
            if hh.len() < 3 || is_micro_void(&hh) {
                asm.micro_voids += 1;
                continue;
            }
            if ring_signed_area(&hh) < 0.0 {
                hh.reverse(); // holes CCW (mirror of the CW exterior)
            }
            if hh.first() != hh.last() {
                hh.push(hh[0]);
            }
            if hh.len() >= 4 {
                holes_out.push(hh);
            } else {
                asm.micro_voids += 1;
            }
        }
        let mut ext_final = ext;
        if ring_signed_area(&ext_final) > 0.0 {
            ext_final.reverse(); // exterior CW (GEOS parity)
        }
        out.push(Part {
            coordinates: ext_final,
            holes: holes_out,
            handles,
            width,
            height,
        });
    }
    let _ = tol;
    Ok((out, asm))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Chaîne ouverte de `n` arêtes, dans l'ordre : l'union-find sans
    /// compression de chemin y forme une liste de n maillons.
    fn long_open_chain(n: usize) -> Vec<(Pt, Pt)> {
        (0..n).map(|i| ([i as f64, 0.0], [i as f64 + 1.0, 0.0])).collect()
    }

    #[test]
    fn a_very_long_open_path_is_counted_in_near_linear_time() {
        let edges = long_open_chain(52_000);
        let t = std::time::Instant::now();
        assert_eq!(dangling_paths(&edges), 1);
        assert!(
            t.elapsed().as_secs_f64() < 3.0,
            "tracé ouvert de 52 000 arêtes : {:?}",
            t.elapsed()
        );
    }

    #[test]
    fn dangling_paths_obeys_the_deadline() {
        let edges = long_open_chain(52_000);
        let dl = Deadline::new(1);
        std::thread::sleep(std::time::Duration::from_millis(5));
        assert!(dangling_paths_until(&edges, &dl).is_err());
    }

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Primitive {
        Primitive::Polyline {
            points: vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
            closed: true,
            handle: "h".into(),
            layer: "0".into(),
        }
    }

    #[test]
    fn snap_is_geos_round_half_up() {
        // Valeurs dorées Python : math.floor(v*1e4 + 0.5)/1e4.
        assert_eq!(snap(0.12345).to_bits(), 0.1235f64.to_bits());
        assert_eq!(snap(-0.12345).to_bits(), (-0.1234f64).to_bits());
        assert_eq!(snap(1.00006).to_bits(), 1.0001f64.to_bits());
        assert_eq!(snap(0.0).to_bits(), 0.0f64.to_bits());
        assert_eq!(snap(-0.00004).to_bits(), 0.0f64.to_bits());
        assert_eq!(snap(123456.78905).to_bits(), 123456.7891f64.to_bits());
    }

    #[test]
    fn single_rectangle_yields_one_cw_part() {
        let (lw, _, n) = collect_linework(&[rect(0.0, 0.0, 10.0, 10.0)], 0.01);
        assert_eq!(n, 1);
        let parts = build_parts(lw, 0.01);
        assert_eq!(parts.len(), 1);
        let p = &parts[0];
        assert_eq!(p.width, 10.0);
        assert_eq!(p.height, 10.0);
        assert_eq!(p.coordinates.len(), 5); // sommet de fermeture inclus (shapely)
        assert_eq!(p.coordinates.first(), p.coordinates.last());
        assert!(ring_signed_area(&p.coordinates) < 0.0, "extérieur CW (parité GEOS)");
        assert!(p.holes.is_empty());
    }

    #[test]
    fn nested_rectangle_becomes_ccw_hole() {
        let (lw, _, _) =
            collect_linework(&[rect(0.0, 0.0, 20.0, 20.0), rect(5.0, 5.0, 10.0, 10.0)], 0.01);
        let parts = build_parts(lw, 0.01);
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0].holes.len(), 1);
        assert!(ring_signed_area(&parts[0].holes[0]) > 0.0, "trou CCW (miroir)");
    }

    #[test]
    fn disjoint_parts_sort_by_bbox_min() {
        // Inséré dans le désordre : l'émission suit (y-min, x-min) — ordre GEOS.
        let (lw, _, _) = collect_linework(
            &[rect(30.0, 30.0, 40.0, 40.0), rect(0.0, 0.0, 10.0, 10.0)],
            0.01,
        );
        let parts = build_parts(lw, 0.01);
        assert_eq!(parts.len(), 2);
        assert!(parts[0].coordinates.iter().all(|p| p[0] <= 10.0));
        assert!(parts[1].coordinates.iter().all(|p| p[0] >= 30.0));
    }

    #[test]
    fn build_parts_is_deterministic_across_calls() {
        // Verrou contre les ordres d'itération de HashMap (RandomState) :
        // deux exécutions du même linework doivent produire la même sortie
        // bit à bit (voir parity/determinism_lock.mjs côté processus).
        let mk = || {
            let (lw, _, _) = collect_linework(
                &[
                    rect(0.0, 0.0, 20.0, 20.0),
                    rect(5.0, 5.0, 10.0, 10.0),
                    rect(30.0, 30.0, 40.0, 40.0),
                ],
                0.01,
            );
            build_parts(lw, 0.01)
        };
        let a = mk();
        let b = mk();
        assert_eq!(a.len(), b.len());
        for (pa, pb) in a.iter().zip(b.iter()) {
            assert_eq!(format!("{:?}", pa.coordinates), format!("{:?}", pb.coordinates));
            assert_eq!(format!("{:?}", pa.holes), format!("{:?}", pb.holes));
        }
    }
    // ---- Lot E1 : nettoyage géométrique (miroir des tests Python de
    // workers/common/tests/test_geometry_cleanup.py) ----

    #[test]
    fn micro_vide_un_vrai_trou_reste_un_trou() {
        // Ø35 mm de la pièce annulaire du corpus : 962 mm².
        let ring: Vec<Pt> = (0..36)
            .map(|t| {
                let a = t as f64 * std::f64::consts::PI / 18.0;
                [17.5 * a.cos(), 17.5 * a.sin()]
            })
            .collect();
        assert!(!is_micro_void(&ring));
    }

    #[test]
    fn micro_vide_par_l_aire_et_par_le_petit_cote() {
        // 0,8 × 0,8 = 0,64 mm² < 1 mm².
        assert!(is_micro_void(&[[0.0, 0.0], [0.8, 0.0], [0.8, 0.8], [0.0, 0.8]]));
        // 20 × 0,3 mm : 6 mm² mais 0,3 mm de large — rien ne passe là.
        assert!(is_micro_void(&[[0.0, 0.0], [20.0, 0.0], [20.0, 0.3], [0.0, 0.3]]));
        assert!(is_micro_void(&[[0.0, 0.0], [1.0, 0.0]]));
    }

    #[test]
    fn ergot_de_largeur_nulle_du_fichier_c04() {
        // Motif MESURÉ au lot E0 (« no pole found with 10 levels of
        // recursion ») : la polyligne part à gauche sur 6,9 mm et revient
        // 0,0001 mm plus haut.
        let mut ring: Vec<Pt> = vec![
            [72.871, 84.6031],
            [65.9436, 84.6031],
            [72.871, 84.6032],
            [74.8711, 82.6031],
            [74.871, 73.5209],
            [74.871, 82.6031],
        ];
        let removed = strip_spurs(&mut ring);
        assert_eq!(removed, 4, "{ring:?}");
        assert_eq!(ring, vec![[72.871, 84.6031], [74.8711, 82.6031]]);
    }

    #[test]
    fn un_anneau_propre_n_est_pas_touche() {
        // NO-OP obligatoire : sinon le seed canonique de tous les fichiers
        // changerait.
        let mut ring: Vec<Pt> = vec![[0.0, 0.0], [100.0, 0.0], [100.0, 50.0], [0.0, 50.0]];
        let before = ring.clone();
        assert_eq!(strip_spurs(&mut ring), 0);
        assert_eq!(ring, before);

        let mut circle: Vec<Pt> = (0..64)
            .map(|t| {
                let a = t as f64 * std::f64::consts::PI / 32.0;
                [10.0 * a.cos(), 10.0 * a.sin()]
            })
            .collect();
        let n = circle.len();
        assert_eq!(strip_spurs(&mut circle), 0);
        assert_eq!(circle.len(), n);
    }

    // ---- Sondes de face (défaut de prod du 14/11 : cadres à paroi fine) ----

    fn rect_ring(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Pt> {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    }

    fn parts_of(prims: &[Primitive]) -> Vec<Part> {
        let (lw, _, _) = collect_linework(prims, 0.01);
        build_parts(lw, 0.01)
    }

    fn dims(p: &Part) -> (f64, f64) {
        ((p.width * 1e3).round() / 1e3, (p.height * 1e3).round() / 1e3)
    }

    #[test]
    fn face_probes_keeps_the_historical_probe_when_valid() {
        let rings = vec![rect_ring(0.0, 0.0, 20.0, 20.0), rect_ring(5.0, 5.0, 10.0, 10.0)];
        let probes = face_probes(&rings);
        assert_eq!(probes.len(), 2);
        for (r, p) in rings.iter().zip(&probes) {
            let h = interior_probe(r);
            assert_eq!(p[0].to_bits(), h[0].to_bits());
            assert_eq!(p[1].to_bits(), h[1].to_bits());
        }
    }

    #[test]
    fn face_probe_of_a_thin_frame_stays_in_the_wall() {
        for w in [0.05, 0.1, 0.3, 0.5, 0.7] {
            let outer = rect_ring(0.0, 0.0, 10.0, 5.0);
            let inner = rect_ring(w, w, 10.0 - w, 5.0 - w);
            // Le défaut : la sonde historique tombe dans le vide du cadre.
            assert!(
                point_in_ring(interior_probe(&outer), &inner),
                "w={w} : la sonde historique devait tomber dans l'anneau intérieur"
            );
            let rings = vec![outer.clone(), inner.clone()];
            let probes = face_probes(&rings);
            assert!(point_in_ring(probes[0], &outer), "w={w} : hors de l'extérieur");
            assert!(!point_in_ring(probes[0], &inner), "w={w} : dans le vide");
            assert!(point_in_ring(probes[1], &inner), "w={w} : sonde du vide hors du vide");
        }
    }

    #[test]
    fn face_probe_of_a_narrow_c_ring_stays_inside() {
        // Bande en C de 0,2 mm, jambes de 10 mm ; premier sommet = coin
        // convexe (10,0) : le pas de 1 mm sort de la bande.
        let ring: Vec<Pt> = vec![
            [10.0, 0.0],
            [10.0, 10.0],
            [0.0, 10.0],
            [0.0, 9.8],
            [9.8, 9.8],
            [9.8, 0.2],
            [0.0, 0.2],
            [0.0, 0.0],
        ];
        assert!(!point_in_ring(interior_probe(&ring), &ring), "défaut documenté");
        let probes = face_probes(std::slice::from_ref(&ring));
        assert!(point_in_ring(probes[0], &ring), "{:?}", probes[0]);
    }

    #[test]
    fn thin_frame_with_island_gives_frame_island_and_neighbour() {
        for w in [0.05, 0.1, 0.3, 0.5, 0.7, 1.0] {
            let parts = parts_of(&[
                rect(0.0, 0.0, 10.0, 5.0),
                rect(w, w, 10.0 - w, 5.0 - w),
                rect(4.0, 2.0, 6.0, 3.0),
                rect(20.0, 0.0, 25.0, 5.0),
            ]);
            assert_eq!(parts.len(), 3, "w={w}");
            let frame: Vec<_> = parts.iter().filter(|p| dims(p) == (10.0, 5.0)).collect();
            assert_eq!(frame.len(), 1, "w={w}");
            assert_eq!(frame[0].holes.len(), 1, "w={w}");
            let island: Vec<_> = parts.iter().filter(|p| dims(p) == (2.0, 1.0)).collect();
            assert_eq!(island.len(), 1, "w={w}");
            assert!(island[0].holes.is_empty(), "w={w}");
            let other: Vec<_> = parts.iter().filter(|p| dims(p) == (5.0, 5.0)).collect();
            assert_eq!(other.len(), 1, "w={w}");
        }
    }

    #[test]
    fn hole_near_the_walls_does_not_make_the_part_vanish() {
        // Trou à 0,3 mm des parois haute et droite.
        let parts = parts_of(&[rect(0.0, 0.0, 10.0, 5.0), rect(5.0, 2.0, 9.7, 4.7)]);
        assert_eq!(parts.len(), 1);
        assert_eq!(dims(&parts[0]), (10.0, 5.0));
        assert_eq!(parts[0].holes.len(), 1);
    }

    #[test]
    fn frame_inside_a_frame_with_an_island_gives_three_parts() {
        let parts = parts_of(&[
            rect(0.0, 0.0, 20.0, 20.0),
            rect(0.3, 0.3, 19.7, 19.7),
            rect(1.3, 1.3, 18.7, 18.7),
            rect(1.6, 1.6, 18.4, 18.4),
            rect(8.0, 8.0, 12.0, 12.0),
        ]);
        assert_eq!(parts.len(), 3);
        let mut holes: Vec<usize> = parts.iter().map(|p| p.holes.len()).collect();
        holes.sort();
        assert_eq!(holes, vec![0, 1, 1]);
        let mut sizes: Vec<(f64, f64)> = parts.iter().map(dims).collect();
        sizes.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert_eq!(sizes, vec![(4.0, 4.0), (17.4, 17.4), (20.0, 20.0)]);
    }

    #[test]
    fn thin_frame_rotated_45_degrees_is_a_part_with_one_hole() {
        let (s, c) = (std::f64::consts::FRAC_PI_4.sin(), std::f64::consts::FRAC_PI_4.cos());
        let rot = |pts: Vec<Pt>| -> Primitive {
            Primitive::Polyline {
                points: pts.into_iter().map(|p| [p[0] * c - p[1] * s, p[0] * s + p[1] * c]).collect(),
                closed: true,
                handle: "h".into(),
                layer: "0".into(),
            }
        };
        let parts = parts_of(&[
            rot(rect_ring(0.0, 0.0, 10.0, 5.0)),
            rot(rect_ring(0.3, 0.3, 9.7, 4.7)),
            rot(rect_ring(4.0, 2.0, 6.0, 3.0)),
        ]);
        assert_eq!(parts.len(), 2);
        let with_hole: Vec<_> = parts.iter().filter(|p| p.holes.len() == 1).collect();
        let without: Vec<_> = parts.iter().filter(|p| p.holes.is_empty()).collect();
        assert_eq!((with_hole.len(), without.len()), (1, 1));
        // Cadre : 10 x 5 tourné de 45 degrés -> boîte (10+5)/racine(2).
        let side = 15.0 * c;
        assert!((with_hole[0].width - side).abs() < 0.01, "{}", with_hole[0].width);
        assert!((without[0].width - 3.0 * c).abs() < 0.01, "{}", without[0].width);
    }

    #[test]
    fn face_probe_uses_the_ordinates_of_nested_rings_too() {
        // Cas de la relecture : entre les seules ordonnées du carré (0 et 10)
        // l'unique bande passe à y = 5, entièrement couverte par la barre.
        // Avec les ordonnées des anneaux plus petits, une bande libre existe.
        let square = rect_ring(0.0, 0.0, 10.0, 10.0);
        let bar = rect_ring(-1.0, 4.9, 11.0, 5.1);
        // Un petit anneau posé sur la sonde historique du carré.
        let h = interior_probe(&square);
        let on_probe = rect_ring(h[0] - 0.25, h[1] - 0.25, h[0] + 0.25, h[1] + 0.25);
        assert!(point_in_ring(h, &on_probe), "précondition");
        let rings = vec![square.clone(), bar.clone(), on_probe.clone()];
        let p = face_probes(&rings)[0];
        assert!(point_in_ring(p, &square), "{p:?}");
        assert!(!point_in_ring(p, &bar) && !point_in_ring(p, &on_probe), "{p:?}");
    }

    #[test]
    fn ring_depths_match_the_plain_count() {
        // Le rejet par boîte ne change pas le compte : même résultat que
        // `point_in_ring` sur tous les anneaux, sondes hors boîte comprises.
        let rings = vec![
            rect_ring(0.0, 0.0, 20.0, 20.0),
            rect_ring(5.0, 5.0, 10.0, 10.0),
            rect_ring(6.0, 6.0, 7.0, 7.0),
            rect_ring(30.0, 0.0, 40.0, 10.0),
            vec![[0.0, 30.0], [10.0, 30.0], [5.0, 40.0]],
        ];
        let probes: Vec<Pt> = vec![
            [6.5, 6.5], [5.5, 5.5], [1.0, 1.0], [35.0, 5.0], [5.0, 33.0], [9.9, 30.1],
            [20.0, 20.0], [0.0, 0.0], [10.0, 5.0], [-1.0, 5.0], [50.0, 5.0], [5.0, 30.0],
        ];
        let got = ring_depths_until(&rings, &probes, &Deadline::unlimited()).unwrap();
        let want: Vec<usize> = probes
            .iter()
            .map(|&p| rings.iter().filter(|r| point_in_ring(p, r)).count())
            .collect();
        assert_eq!(got, want);
    }

    #[test]
    fn hole_cells_sharing_a_wall_merge_whatever_the_number_of_parts() {
        // Une grille dessinée dans une ouverture : deux cases 5x5 collées.
        // Elles forment UN trou 10x5, que le dessin ait une pièce ou deux.
        let plate = [
            rect(0.0, 0.0, 30.0, 20.0),
            rect(5.0, 5.0, 10.0, 10.0),
            rect(10.0, 5.0, 15.0, 10.0),
        ];
        let alone = parts_of(&plate);
        assert_eq!(alone.len(), 1);
        assert_eq!(alone[0].holes.len(), 1, "les deux cases font un seul trou");
        let hole_area = ring_signed_area(&alone[0].holes[0]).abs();
        assert!((hole_area - 50.0).abs() < 1e-9, "aire du trou {hole_area}");

        let mut two = plate.to_vec();
        two.push(rect(40.0, 0.0, 45.0, 5.0));
        let with_neighbour = parts_of(&two);
        assert_eq!(with_neighbour.len(), 2);
        let big = with_neighbour.iter().find(|p| dims(p) == (30.0, 20.0)).expect("plaque");
        assert_eq!(big.holes.len(), 1);
        assert_eq!(big.holes, alone[0].holes, "même trou avec ou sans seconde pièce");
    }

    #[test]
    fn face_probes_until_obeys_the_deadline() {
        let rings = vec![rect_ring(0.0, 0.0, 10.0, 5.0), rect_ring(1.0, 1.0, 9.0, 4.0)];
        let dl = Deadline::new(1);
        std::thread::sleep(std::time::Duration::from_millis(5));
        assert!(face_probes_until(&rings, &dl).is_err());
    }

}
