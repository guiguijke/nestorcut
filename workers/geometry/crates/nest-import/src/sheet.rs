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

use crate::assemble::{self, Pt};
use crate::budget::{Deadline, Expired, Limits};
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

fn key(p: Pt) -> Key {
    (p[0].to_bits(), p[1].to_bits())
}

/// Coupe un cycle de la marche des faces en boucles SIMPLES (méthode de la
/// pile). Une face peut repasser par un sommet (pont, trait ouvert aller et
/// retour, forme posée sur le bord en un seul sommet) : à la seconde visite
/// d'un sommet déjà sur la pile, la boucle qui se ferme là est extraite. Le
/// cycle est circulaire : le premier sommet est rejoué à la fin pour fermer la
/// dernière boucle. Rend chaque boucle sans point de fermeture.
fn split_simple_loops(cycle: &[Pt]) -> Vec<Vec<Pt>> {
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
fn open_stroke_groups(
    edges: &[(Pt, Pt)],
    cycles: &[Vec<Pt>],
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
        };
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
    let open_paths = open_stroke_groups(edges, &cycles, dl)?;
    let mut faces: Vec<Vec<Pt>> = Vec::new();
    for (i, c) in cycles.iter().enumerate() {
        dl.check_at(i)?;
        for mut l in split_simple_loops(c) {
            // Faces bornées = boucles d'aire strictement positive.
            if l.len() >= 3 && assemble::ring_signed_area(&l) > 1e-10 {
                rotate_to_lowest(&mut l);
                faces.push(l);
            }
        }
    }

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
    let (entities, mut warnings, stats) = dxf::flattened_modelspace_bounded(
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
    let count = entities.len();
    if count > limits.max_entities {
        return Err(crate::too_many_entities(count, false, limits, &dl));
    }
    let model_has_matter = stats.skipped.keys().any(|k| crate::findings::is_material(k))
        || entities.iter().any(|p| match p {
            dxf::flatten::Primitive::Unsupported(kind) => crate::findings::is_material(kind),
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
        .filter(|p| matches!(p, dxf::flatten::Primitive::Unsupported(_)))
        .count();
    let skipped_entities =
        stats.skipped.values().sum::<usize>() + nested_unsupported + stats.paper_space_skipped;
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
    let edges: Vec<(Pt, Pt)> = noded
        .iter()
        .map(|&(a, b)| (assemble::snap_pt(a), assemble::snap_pt(b)))
        .filter(|(a, b)| a != b)
        .collect();
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
