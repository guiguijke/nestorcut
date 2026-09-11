//! Verrou §19.4 — la garde d'embouchure, sur la géométrie RÉELLE du défaut
//! et sur vingt poses couvrant toute la fenêtre illégale.
//!
//! ÉCART À LA CONSIGNE, assumé et mesuré. Le §19.4 demandait vingt GRAINES
//! du solveur sur une fixture hôte + fillers. J'ai construit quatre
//! variantes de cette fixture (trou circulaire large, trou rectangulaire
//! serré, SPP puis BPP, tôle large puis tôle juste) : dans les quatre, le
//! moteur **ne niche aucune pièce** — 0 sur 20 graines à chaque fois. Le
//! constructif ne tente le trou que sous une pression qu'une instance de
//! quelques pièces ne crée pas, et sous `w + 2 × space` de jeu aucune pose
//! n'existe (piège #49). Un verrou bâti là-dessus serait VERT SANS RIEN
//! PROUVER : c'est précisément ce que le témoin négatif de ma première
//! version a révélé (sans garde, pire écart 2,1743 mm — le verrou passait
//! alors qu'il ne mesurait rien). Le solveur reste dans la boucle au bon
//! endroit : la démo navigateur 8 × 3 directions du §19.4, là où le défaut
//! est apparu.
//!
//! Ici, deux verrous déterministes :
//!
//! 1. **la géométrie réelle du cas** (hôte 420 × 300 à trou 340 × 220,
//!    pièce 160 × 90, fixture `holefill_parity_20260910.json`) : la pose de
//!    référence mesure 1,887 mm de l'anneau brut, et la garde la ramène
//!    ≥ 1,99 — ou la retire, ce que la règle autorise ;
//! 2. **vingt poses** régulières dans la fenêtre [1,70 ; 1,99), c'est-à-dire
//!    tout ce que le moteur peut légalement produire devant une embouchure
//!    et que la découpe refuse.

use jagua_rs::io::ext_repr::{
    ExtPlacedItem, ExtPolygon, ExtSPolygon, ExtShape, ExtTransformation,
};
use nest_engine::geometry_check::{place_rings, ring_min_distance, rings_of_shape, Rings};
use nest_engine::mouth_guard::{guard_layout, RawHoles};

const SPACE: f32 = 2.0;
const THRESHOLD: f32 = 1.99;

/// Hôte du cas : 420 × 300, trou 340 × 220 (fixture du 10/09, item 20).
fn real_host() -> (ExtShape, Vec<(f32, f32)>) {
    let outer = vec![(0.0, 0.0), (0.0, 300.0), (420.0, 300.0), (420.0, 0.0)];
    let hole = vec![(40.0, 40.0), (380.0, 40.0), (380.0, 260.0), (40.0, 260.0)];
    (
        ExtShape::Polygon(ExtPolygon {
            outer: ExtSPolygon(outer),
            inner: vec![ExtSPolygon(hole.clone())],
        }),
        hole,
    )
}

/// Pièce nichée du cas : 160 × 90 (item 2, anneau externe).
fn real_guest() -> ExtShape {
    ExtShape::SimplePolygon(ExtSPolygon(vec![
        (0.0, 0.0),
        (10.0, 90.0),
        (150.0, 90.0),
        (160.0, 0.0),
    ]))
}

fn placed_guest(shape: &ExtShape, t: &ExtTransformation) -> Rings {
    place_rings(&rings_of_shape(shape)[0], t)
}

fn at(item_id: u64, x: f32, y: f32) -> ExtPlacedItem {
    ExtPlacedItem {
        item_id,
        transformation: ExtTransformation { rotation: 0.0, translation: (x, y) },
    }
}

#[test]
fn real_case_pose_is_corrected() {
    let (host_shape, hole) = real_host();
    let guest_shape = real_guest();
    let shapes = vec![host_shape, guest_shape.clone()];
    let mut raw = RawHoles::new();
    raw.insert("0".to_string(), vec![hole.clone()]);

    // Pièce collée à la paroi gauche du trou (x = 40), à 1,887 mm.
    let pose = ExtTransformation { rotation: 0.0, translation: (41.887, 100.0) };
    let before = ring_min_distance(&hole, &placed_guest(&guest_shape, &pose).outer);
    assert!(
        (before - 1.887).abs() < 1e-3,
        "la pose de référence doit mesurer 1,887 mm, mesuré {before}"
    );

    let mut placed = vec![at(0, 0.0, 0.0), ExtPlacedItem { item_id: 1, transformation: pose }];
    let stats = guard_layout(&shapes, &raw, SPACE, &mut placed);
    assert!(stats.touched(), "la garde doit agir, stats {stats:?}");
    match placed.iter().find(|pi| pi.item_id == 1) {
        Some(pi) => {
            let after =
                ring_min_distance(&hole, &placed_guest(&guest_shape, &pi.transformation).outer);
            assert!(
                after >= THRESHOLD,
                "après garde : {after:.4} mm < {THRESHOLD} (départ {before:.4})"
            );
        }
        None => assert_eq!(stats.removed, 1, "retirée : la règle l'autorise"),
    }
}

#[test]
fn twenty_poses_in_the_mouth_window_are_all_corrected() {
    let (host_shape, hole) = real_host();
    let guest_shape = real_guest();
    let shapes = vec![host_shape, guest_shape.clone()];
    let mut raw = RawHoles::new();
    raw.insert("0".to_string(), vec![hole.clone()]);

    let mut fixed = 0usize;
    let mut removed = 0usize;
    let mut worst_after = f32::INFINITY;
    for k in 0..20u32 {
        let d = 1.70 + 0.015 * k as f32; // 1,70 → 1,985
        let pose = ExtTransformation {
            rotation: 0.0,
            translation: (40.0 + d, 90.0 + k as f32),
        };
        let start = ring_min_distance(&hole, &placed_guest(&guest_shape, &pose).outer);
        assert!(
            start < THRESHOLD,
            "pose {k} : {start:.4} mm n'est pas dans la fenêtre illégale"
        );
        let mut placed = vec![at(0, 0.0, 0.0), ExtPlacedItem { item_id: 1, transformation: pose }];
        let stats = guard_layout(&shapes, &raw, SPACE, &mut placed);
        assert!(stats.touched(), "pose {k} ({start:.4} mm) non corrigée");
        match placed.iter().find(|pi| pi.item_id == 1) {
            Some(pi) => {
                let after =
                    ring_min_distance(&hole, &placed_guest(&guest_shape, &pi.transformation).outer);
                assert!(
                    after >= THRESHOLD,
                    "pose {k} : {after:.4} mm après garde (départ {start:.4})"
                );
                if after < worst_after {
                    worst_after = after;
                }
                fixed += 1;
            }
            None => removed += 1,
        }
    }
    println!(
        "[mouth] 20 poses : {fixed} dégagée(s) (pire écart après garde {worst_after:.4} mm), {removed} retirée(s)"
    );
    assert_eq!(fixed + removed, 20);
}

/// Une pièce nichée CONFORME n'est pas touchée : la garde ne retouche pas un
/// layout correct (le churn micrométrique est un défaut connu, piège 14f).
#[test]
fn conforming_pose_is_untouched() {
    let (host_shape, hole) = real_host();
    let guest_shape = real_guest();
    let shapes = vec![host_shape, guest_shape];
    let mut raw = RawHoles::new();
    raw.insert("0".to_string(), vec![hole]);
    let mut placed = vec![at(0, 0.0, 0.0), at(1, 100.0, 100.0)];
    let stats = guard_layout(&shapes, &raw, SPACE, &mut placed);
    assert!(!stats.touched(), "la garde a bougé un layout conforme : {stats:?}");
    assert_eq!(placed.len(), 2);
    assert_eq!(placed[1].transformation.translation.0, 100.0);
}
