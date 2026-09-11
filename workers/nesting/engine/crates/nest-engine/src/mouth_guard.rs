//! Garde d'EMBOUCHURE (§19.3 du plan « dernière tôle »).
//!
//! LE DÉFAUT, mesuré le 2026-09-11 sur un job réel. Pour rendre un trou
//! accessible à jagua, l'hôte est ouvert par un canal capillaire de
//! `space + 0,1` mm (piège #2). Sur le polygone que le moteur reçoit, la
//! paroi du trou **n'existe plus** sur cette largeur : une pièce nichée
//! posée en face de l'embouchure n'est retenue que par les deux coins du
//! canal. À `d` de la ligne d'embouchure et `space/2 + 0,05` des parois,
//! sa distance aux coins vaut √(d² + 1,05²) ≥ space : tout écart entre
//! **1,70 et 2,0 mm** (à space 2) est légal pour le moteur et illégal à la
//! découpe. Le cas mesuré : **1,8867 mm sur l'anneau brut, 2,0013 mm sur le
//! polygone ouvert**, point le plus proche à **0,0 mm de l'embouchure**.
//!
//! Le moteur n'a donc pas fauté : la géométrie qu'on lui donne ne contient
//! pas la paroi. La garde rend la paroi à l'export, une seule fois pour
//! tous les chemins (SPP, BPP, finition comprise) : elle mesure chaque
//! pièce nichée contre l'anneau de trou **BRUT** (`EngineConfig::raw_holes`,
//! rempli par les deux constructeurs de charge avant l'ouverture), et
//! corrige.
//!
//! RÈGLE : sous `space − PAIR_SLACK`, la pièce est translatée à l'opposé du
//! point de contact de `space − d + 0,02` ; la translation n'est acceptée
//! que si la pièce reste entièrement dans le trou ET que sa distance
//! EXACTE à tous ses voisins reste ≥ `space − PAIR_SLACK`. Sinon la pièce
//! est RETIRÉE du trou : elle repasse en non-placée et le post-pass
//! hole-fill — exact depuis le 11/09 — la replacera ou la posera ailleurs.
//! Mieux vaut une pièce à replacer qu'une pièce livrée dans la paroi.

use std::collections::HashMap;

use jagua_rs::io::ext_repr::{ExtPlacedItem, ExtShape, ExtTransformation};

use crate::bpp::PAIR_SLACK;
use crate::geometry_check::{
    material_distance, place_rings, ring_min_distance, rings_of_shape, Rings,
};

/// Anneaux de trou bruts, par id d'item de l'instance résolue (clé JSON).
pub type RawHoles = HashMap<String, Vec<Vec<(f32, f32)>>>;

/// Marge ajoutée au déplacement correctif : la pièce doit repasser
/// FRANCHEMENT au-dessus du seuil, pas s'y poser.
const PUSH_MARGIN_MM: f32 = 0.02;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct MouthStats {
    /// Pièces nichées translatées pour rendre l'espacement.
    pub moved: usize,
    /// Pièces retirées du trou (repassent en non-placées).
    pub removed: usize,
}

impl MouthStats {
    pub fn touched(&self) -> bool {
        self.moved > 0 || self.removed > 0
    }
    pub fn as_json(&self) -> serde_json::Value {
        serde_json::json!({ "moved": self.moved, "removed": self.removed })
    }
}

/// Point du segment `[a, b]` le plus proche de `p`.
fn closest_on_segment(p: (f32, f32), a: (f32, f32), b: (f32, f32)) -> (f32, f32) {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let l2 = dx * dx + dy * dy;
    if l2 == 0.0 {
        return a;
    }
    let t = (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / l2).clamp(0.0, 1.0);
    (a.0 + t * dx, a.1 + t * dy)
}

/// Couple de points le plus proche entre deux anneaux (sommets contre
/// arêtes des deux côtés) — sert à connaître la DIRECTION du dégagement.
/// Au niveau de l'embouchure, « à l'opposé du point de contact » est
/// exactement « à l'opposé de la ligne d'embouchure » : le point de contact
/// EST sur cette ligne (mesuré : 0,0 mm de l'embouchure).
fn closest_pair(a: &[(f32, f32)], b: &[(f32, f32)]) -> ((f32, f32), (f32, f32), f32) {
    let mut best = (a[0], b[0], f32::INFINITY);
    let mut consider = |p: (f32, f32), q: (f32, f32)| {
        let d = ((p.0 - q.0) * (p.0 - q.0) + (p.1 - q.1) * (p.1 - q.1)).sqrt();
        if d < best.2 {
            best = (p, q, d);
        }
    };
    for i in 0..a.len() {
        let (a1, a2) = (a[i], a[(i + 1) % a.len()]);
        for j in 0..b.len() {
            let (b1, b2) = (b[j], b[(j + 1) % b.len()]);
            consider(a1, closest_on_segment(a1, b1, b2));
            consider(a2, closest_on_segment(a2, b1, b2));
            consider(closest_on_segment(b1, a1, a2), b1);
            consider(closest_on_segment(b2, a1, a2), b2);
        }
    }
    best
}

fn point_in_ring(pt: (f32, f32), ring: &[(f32, f32)]) -> bool {
    let mut inside = false;
    let n = ring.len();
    if n < 3 {
        return false;
    }
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = ring[i];
        let (xj, yj) = ring[j];
        if (yi > pt.1) != (yj > pt.1) && pt.0 < (xj - xi) * (pt.1 - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn translated(r: &Rings, dx: f32, dy: f32) -> Rings {
    Rings {
        outer: r.outer.iter().map(|(x, y)| (x + dx, y + dy)).collect(),
        holes: r
            .holes
            .iter()
            .map(|h| h.iter().map(|(x, y)| (x + dx, y + dy)).collect())
            .collect(),
    }
}

/// Applique la garde à UN layout. `item_shapes` est indexé par id d'item de
/// l'instance résolue (l'ordre des items de l'instance externe).
pub fn guard_layout(
    item_shapes: &[ExtShape],
    raw_holes: &RawHoles,
    space: f32,
    placed: &mut Vec<ExtPlacedItem>,
) -> MouthStats {
    let mut stats = MouthStats::default();
    if raw_holes.is_empty() || space <= 0.0 || placed.len() < 2 {
        return stats;
    }
    let limit = (space - PAIR_SLACK).max(0.0);

    // Anneaux posés de chaque pièce (état courant, mis à jour au fil des
    // corrections) et anneaux de trou BRUTS posés de chaque hôte.
    let base: Vec<Vec<Rings>> = item_shapes.iter().map(rings_of_shape).collect();
    let placed_rings = |pi: &ExtPlacedItem| -> Vec<Rings> {
        base.get(pi.item_id as usize)
            .map(|rs| rs.iter().map(|r| place_rings(r, &pi.transformation)).collect())
            .unwrap_or_default()
    };
    let mut current: Vec<Vec<Rings>> = placed.iter().map(placed_rings).collect();
    // Trous bruts posés, par index de pose.
    let raw_placed: Vec<Vec<Vec<(f32, f32)>>> = placed
        .iter()
        .map(|pi| {
            raw_holes
                .get(&pi.item_id.to_string())
                .map(|holes| {
                    holes
                        .iter()
                        .map(|h| {
                            place_rings(
                                &Rings { outer: h.clone(), holes: vec![] },
                                &pi.transformation,
                            )
                            .outer
                        })
                        .collect()
                })
                .unwrap_or_default()
        })
        .collect();

    // Pièces à retirer, collectées puis appliquées en fin de passe (retirer
    // en cours de route décalerait les index).
    let mut to_remove: Vec<usize> = Vec::new();

    for host in 0..placed.len() {
        if raw_placed[host].is_empty() {
            continue;
        }
        for hole in &raw_placed[host] {
            for guest in 0..placed.len() {
                if guest == host || to_remove.contains(&guest) {
                    continue;
                }
                let Some(guest_rings) = current[guest].first() else {
                    continue;
                };
                // Nichée dans CE trou ? Un sommet suffit : la pièce est
                // entièrement dedans ou entièrement dehors tant que les
                // frontières ne se croisent pas, et si elles se croisent la
                // distance est nulle — donc sous le seuil de toute façon.
                if !guest_rings
                    .outer
                    .first()
                    .is_some_and(|v| point_in_ring(*v, hole))
                {
                    continue;
                }
                let d = ring_min_distance(hole, &guest_rings.outer);
                if d >= limit {
                    continue;
                }
                // Dégagement : à l'opposé du point de contact, de ce qui
                // manque plus une marge franche.
                let (p_hole, p_guest, _) = closest_pair(hole, &guest_rings.outer);
                let (vx, vy) = (p_guest.0 - p_hole.0, p_guest.1 - p_hole.1);
                let norm = (vx * vx + vy * vy).sqrt();
                let push = space - d + PUSH_MARGIN_MM;
                let (dx, dy) = if norm > 1e-6 {
                    (vx / norm * push, vy / norm * push)
                } else {
                    (0.0, 0.0)
                };
                let moved_rings: Vec<Rings> =
                    current[guest].iter().map(|r| translated(r, dx, dy)).collect();
                // 1. la pièce doit rester ENTIÈREMENT dans le trou ;
                let stays_in = moved_rings
                    .first()
                    .is_some_and(|r| r.outer.iter().all(|v| point_in_ring(*v, hole)))
                    && moved_rings
                        .first()
                        .is_some_and(|r| ring_min_distance(hole, &r.outer) >= limit);
                // 2. et sa distance EXACTE à tous les voisins doit tenir.
                let neighbours_ok = stays_in
                    && (0..placed.len()).filter(|k| *k != guest).all(|k| {
                        if to_remove.contains(&k) {
                            return true;
                        }
                        current[k].iter().all(|other| {
                            moved_rings
                                .iter()
                                .all(|mine| material_distance(mine, other) >= limit)
                        })
                    });
                if neighbours_ok && norm > 1e-6 {
                    placed[guest].transformation = ExtTransformation {
                        rotation: placed[guest].transformation.rotation,
                        translation: (
                            placed[guest].transformation.translation.0 + dx,
                            placed[guest].transformation.translation.1 + dy,
                        ),
                    };
                    current[guest] = moved_rings;
                    stats.moved += 1;
                } else {
                    // Aucune translation légale : la pièce sort du trou. Le
                    // post-pass hole-fill (exact) la replacera, ou elle
                    // sera posée ailleurs — jamais livrée dans la paroi.
                    to_remove.push(guest);
                    stats.removed += 1;
                }
            }
        }
    }

    if !to_remove.is_empty() {
        to_remove.sort_unstable();
        to_remove.dedup();
        for idx in to_remove.iter().rev() {
            placed.remove(*idx);
        }
    }
    stats
}

#[cfg(test)]
mod tests {
    use super::*;
    use jagua_rs::io::ext_repr::ExtSPolygon;

    /// Hôte carré 200 × 200 avec un trou carré 100 × 100 OUVERT par un
    /// canal de 2,1 mm vers la droite — la forme que le moteur reçoit.
    fn opened_host() -> ExtShape {
        // Contour : extérieur puis incursion par le canal jusqu'au trou.
        ExtShape::SimplePolygon(ExtSPolygon(vec![
            (0.0, 0.0),
            (200.0, 0.0),
            (200.0, 98.95),
            (150.0, 98.95),
            (150.0, 50.0),
            (50.0, 50.0),
            (50.0, 150.0),
            (150.0, 150.0),
            (150.0, 101.05),
            (200.0, 101.05),
            (200.0, 200.0),
            (0.0, 200.0),
        ]))
    }

    fn raw_hole() -> Vec<(f32, f32)> {
        vec![(50.0, 50.0), (150.0, 50.0), (150.0, 150.0), (50.0, 150.0)]
    }

    fn square(side: f32) -> ExtShape {
        ExtShape::SimplePolygon(ExtSPolygon(vec![
            (0.0, 0.0),
            (side, 0.0),
            (side, side),
            (0.0, side),
        ]))
    }

    fn at(item_id: u64, x: f32, y: f32) -> ExtPlacedItem {
        ExtPlacedItem {
            item_id,
            transformation: ExtTransformation { rotation: 0.0, translation: (x, y) },
        }
    }

    fn raw_map() -> RawHoles {
        let mut m = RawHoles::new();
        m.insert("0".to_string(), vec![raw_hole()]);
        m
    }

    /// Le cas du 11/09 : une pièce EN FACE DE L'EMBOUCHURE à 1,90 mm de la
    /// paroi brute. Légale pour le moteur (la paroi n'existe pas sur les
    /// 2,1 mm du canal), illégale à la découpe — la garde la dégage.
    #[test]
    fn piece_facing_the_mouth_is_pushed_back() {
        let shapes = vec![opened_host(), square(40.0)];
        // trou x ∈ [50, 150] ; pièce de 40 posée à x = 108,1 → bord droit
        // à 148,1, soit 1,9 mm de la paroi x = 150.
        let mut placed = vec![at(0, 0.0, 0.0), at(1, 108.1, 80.0)];
        let stats = guard_layout(&shapes, &raw_map(), 2.0, &mut placed);
        assert_eq!(stats, MouthStats { moved: 1, removed: 0 }, "la pièce doit être dégagée");
        assert_eq!(placed.len(), 2, "aucune pièce ne devait être retirée");
        // Et la mesure EXACTE contre l'anneau brut tient maintenant.
        let guest = place_rings(&rings_of_shape(&shapes[1])[0], &placed[1].transformation);
        let d = ring_min_distance(&raw_hole(), &guest.outer);
        assert!(d >= 1.99, "distance à l'anneau brut {d} < 1,99");
    }

    /// Une pièce qui remplit le trou ne peut pas être dégagée : elle est
    /// RETIRÉE plutôt que livrée dans la paroi.
    #[test]
    fn piece_that_cannot_be_freed_is_removed() {
        let shapes = vec![opened_host(), square(97.0)];
        // trou 100 × 100, pièce 97 × 97 : 1,5 mm de chaque côté, aucun
        // dégagement possible.
        let mut placed = vec![at(0, 0.0, 0.0), at(1, 51.5, 51.5)];
        let stats = guard_layout(&shapes, &raw_map(), 2.0, &mut placed);
        assert_eq!(stats, MouthStats { moved: 0, removed: 1 });
        assert_eq!(placed.len(), 1, "la pièce nichée doit avoir quitté le layout");
        assert_eq!(placed[0].item_id, 0, "c'est l'hôte qui reste");
    }

    /// `ExtPlacedItem` n'implémente ni `PartialEq` ni `Debug` : on compare
    /// les poses elles-mêmes.
    fn poses(placed: &[ExtPlacedItem]) -> Vec<(u64, f32, f32, f32)> {
        placed
            .iter()
            .map(|pi| {
                (
                    pi.item_id,
                    pi.transformation.rotation,
                    pi.transformation.translation.0,
                    pi.transformation.translation.1,
                )
            })
            .collect()
    }

    /// Une pièce nichée DÉJÀ conforme ne bouge pas : la garde ne retouche
    /// pas un layout correct (le churn micrométrique est un défaut connu du
    /// dépôt, piège 14f).
    #[test]
    fn conforming_nested_piece_is_left_alone() {
        let shapes = vec![opened_host(), square(40.0)];
        // centrée dans le trou : 30 mm de chaque côté.
        let mut placed = vec![at(0, 0.0, 0.0), at(1, 80.0, 80.0)];
        let before = poses(&placed);
        let stats = guard_layout(&shapes, &raw_map(), 2.0, &mut placed);
        assert_eq!(stats, MouthStats::default());
        assert_eq!(poses(&placed), before);
    }

    /// Sans `raw_holes` (anciens payloads), la garde est inactive et ne
    /// touche à rien — jamais une erreur.
    #[test]
    fn no_raw_holes_means_no_guard() {
        let shapes = vec![opened_host(), square(40.0)];
        let mut placed = vec![at(0, 0.0, 0.0), at(1, 108.1, 80.0)];
        let before = poses(&placed);
        let stats = guard_layout(&shapes, &RawHoles::new(), 2.0, &mut placed);
        assert_eq!(stats, MouthStats::default());
        assert_eq!(poses(&placed), before);
    }
}

/// Espacement demandé (mm), jamais négatif.
fn space_of(config: &crate::config::EngineConfig) -> f32 {
    config.min_item_separation.unwrap_or(0.0).max(0.0)
}

/// Garde appliquée aux solutions BPP qui vont être EXPORTÉES — un seul
/// point pour le chemin natif et pour la fusion du navigateur, finition
/// comprise (la finition réécrit les poses AVANT la fusion).
pub fn guard_bp_runs(
    ext_instance: &jagua_rs::probs::bpp::io::ext_repr::ExtBPInstance,
    config: &crate::config::EngineConfig,
    runs: &mut [crate::merge::BpRun],
) -> MouthStats {
    let Some(raw) = config.raw_holes.as_ref() else {
        return MouthStats::default();
    };
    let space = space_of(config);
    if raw.is_empty() || space <= 0.0 {
        return MouthStats::default();
    }
    let shapes: Vec<ExtShape> = ext_instance
        .items
        .iter()
        .map(|it| it.base.shape.clone())
        .collect();
    let mut total = MouthStats::default();
    for run in runs.iter_mut() {
        for layout in run.solution.layouts.iter_mut() {
            let s = guard_layout(&shapes, raw, space, &mut layout.placed_items);
            total.moved += s.moved;
            total.removed += s.removed;
        }
    }
    total
}

/// Idem pour les solutions SPP.
pub fn guard_sp_runs(
    ext_instance: &jagua_rs::probs::spp::io::ext_repr::ExtSPInstance,
    config: &crate::config::EngineConfig,
    runs: &mut [crate::merge::SpRun],
) -> MouthStats {
    let Some(raw) = config.raw_holes.as_ref() else {
        return MouthStats::default();
    };
    let space = space_of(config);
    if raw.is_empty() || space <= 0.0 {
        return MouthStats::default();
    }
    let shapes: Vec<ExtShape> = ext_instance
        .items
        .iter()
        .map(|it| it.base.shape.clone())
        .collect();
    let mut total = MouthStats::default();
    for run in runs.iter_mut() {
        let s = guard_layout(&shapes, raw, space, &mut run.solution.layout.placed_items);
        total.moved += s.moved;
        total.removed += s.removed;
    }
    total
}
