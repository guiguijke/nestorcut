//! Verrou du GONFLEMENT ROBUSTE (lot E0 de `docs/PLAN-ECLATEMENT-2026-09-12.md`).
//!
//! Le défaut de production : jagua gonfle chaque pièce de `space/2` à
//! l'import (`min_item_separation`, piège AGENTS #3). Sur une pièce dont deux
//! brins de matière laissent un CANAL plus étroit que le gonflement — une
//! volute, une spirale, un lettrage plein — `geo_buffer` rend un contour qui
//! se recoupe, `SPolygon::new` le refuse, et le moteur MEURT à l'import :
//! côté utilisateur « The on-device compute stopped unexpectedly », avec
//! remboursement.
//!
//! La fixture est SYNTHÉTIQUE (volute paramétrique, aucun fichier réel) et
//! reproduit le mécanisme exact : brin de 2,4 mm de large, canal de 0,3 mm,
//! 2,5 tours.
//!
//! Run: cargo test --release -p nest-engine --test inflate_fallback -- --nocapture

use jagua_rs::geometry::shape_modification::{ShapeModifyMode, offset_shape};
use jagua_rs::io::ext_repr::ExtSPolygon;
use jagua_rs::io::import::import_simple_polygon;
use nest_engine::geometry_check::{place_rings, ring_min_distance, rings_of_shape};

/// Volute : un brin de largeur `2*half` enroulé en spirale, deux tours
/// consécutifs séparés par un canal de `gap`. Anneau fermé, sens direct.
fn volute_ring(gap: f64, half: f64, turns: f64, steps: usize) -> Vec<(f32, f32)> {
    let pitch = 2.0 * half + gap;
    let r0 = 6.0;
    let at = |s: usize, side: f64| {
        let t = s as f64 / steps as f64 * turns * 2.0 * std::f64::consts::PI;
        let r = r0 + pitch * t / (2.0 * std::f64::consts::PI) + side * half;
        ((r * t.cos()) as f32, (r * t.sin()) as f32)
    };
    let mut ring: Vec<(f32, f32)> = (0..=steps).map(|s| at(s, -1.0)).collect();
    ring.extend((0..=steps).rev().map(|s| at(s, 1.0)));
    ring
}

fn ring_area(ring: &[(f32, f32)]) -> f64 {
    let n = ring.len();
    let mut a = 0.0;
    for i in 0..n {
        let (px, py) = ring[i];
        let (qx, qy) = ring[(i + 1) % n];
        a += px as f64 * qy as f64 - qx as f64 * py as f64;
    }
    (a / 2.0).abs()
}

/// Le chemin PRIMAIRE de jagua rejoué à l'identique (`geo_buffer` puis
/// `import_simple_polygon`) : c'est le contrôle négatif du verrou.
///
/// L'entrée est l'anneau TEL QUE JAGUA LE TIENT (`SPolygon::vertices`, donc
/// après réorientation à l'import) — un anneau donné dans l'autre sens ferait
/// creuser `geo_buffer` au lieu de gonfler, et le contrôle négatif
/// « réussirait » pour une raison qui n'est pas la bonne.
fn primary_path_only(ring: &[(f32, f32)], distance: f32) -> Result<f32, String> {
    let geo_poly = geo_types::Polygon::new(
        ring.iter().map(|p| (p.0 as f64, p.1 as f64)).collect(),
        vec![],
    );
    let offsets = geo_buffer::buffer_polygon_rounded(&geo_poly, distance as f64).0;
    let first = offsets.first().ok_or("geo_buffer: empty".to_string())?;
    let ext = ExtSPolygon(
        first
            .exterior()
            .points()
            .map(|p| (p.x() as f32, p.y() as f32))
            .collect(),
    );
    import_simple_polygon(&ext)
        .map(|sp| sp.area)
        .map_err(|e| format!("{e}"))
}

#[test]
fn controle_negatif_geo_buffer_seul_perd_la_volute() {
    let ring = volute_ring(0.3, 1.2, 2.5, 400);
    let brut = ring_area(&ring);
    let sp = import_simple_polygon(&ExtSPolygon(ring.clone())).unwrap();
    let vues: Vec<(f32, f32)> = sp.vertices.iter().map(|p| (p.0, p.1)).collect();
    println!("volute brute : aire {brut:.1} mm2, {} sommets", ring.len());
    // Aux deux espacements de la spécification (2 mm et 0,5 mm, donc offsets
    // 1 mm et 0,25 mm), le chemin primaire ne rend PAS un gonflement.
    for distance in [1.0f32, 0.25] {
        match primary_path_only(&vues, distance) {
            // Le message de jagua embarque tout l'anneau : on n'en garde
            // que la tête, sinon le journal du test est illisible.
            Err(e) => println!(
                "  offset {distance} : geo_buffer seul ECHOUE — {}",
                e.chars().take(90).collect::<String>()
            ),
            Ok(area) => {
                println!("  offset {distance} : geo_buffer seul rend {area:.1} mm2");
                assert!(
                    (area as f64) < brut,
                    "offset {distance} : le chemin primaire tient tout seul \
                     (aire {area:.1} >= {brut:.1}) — la fixture ne mesure plus rien, \
                     il faut la resserrer"
                );
            }
        }
    }
}

#[test]
fn le_repli_gonfle_vraiment_la_volute() {
    let ring = volute_ring(0.3, 1.2, 2.5, 400);
    let brut = ring_area(&ring);
    let sp = import_simple_polygon(&ExtSPolygon(ring.clone())).unwrap();
    for distance in [1.0f32, 0.25] {
        let out = offset_shape(&sp, ShapeModifyMode::Inflate, distance)
            .unwrap_or_else(|e| panic!("offset {distance} refusé : {e}"));
        let gonflee: Vec<(f32, f32)> = out.vertices.iter().map(|p| (p.0, p.1)).collect();
        let aire = ring_area(&gonflee);
        println!(
            "offset {distance} : aire {brut:.1} -> {aire:.1} mm2, {} -> {} sommets",
            ring.len(),
            gonflee.len()
        );
        // 1. Un gonflement AGRANDIT. (Sans le repli : 353 -> 47 mm2.)
        assert!(
            aire >= brut,
            "offset {distance} : aire gonflée {aire:.1} < aire brute {brut:.1}"
        );
        // 2. Le bord gonflé est à au moins `distance` du bord d'origine :
        //    c'est la promesse d'espacement, et une approximation par
        //    l'intérieur la casserait sans changer l'aire de façon visible.
        let d = ring_min_distance(&ring, &gonflee);
        println!("  distance bord brut <-> bord gonflé : {d:.4} mm");
        assert!(
            d >= distance - 0.01,
            "offset {distance} : le bord gonflé passe à {d:.4} mm du bord brut"
        );
    }
}

#[test]
fn spp_trois_volutes_garde_l_espacement() {
    const SPACE: f32 = 2.0;
    let ring = volute_ring(0.3, 1.2, 2.5, 400);
    let data: Vec<[f32; 2]> = ring.iter().map(|p| [p.0, p.1]).collect();
    let instance = serde_json::json!({
        "name": "e0-volute-x3",
        "strip_height": 60.0,
        "items": (0..3).map(|id| serde_json::json!({
            "id": id,
            "demand": 1,
            "allowed_orientations": [0.0],
            "shape": {"type": "simple_polygon", "data": data}
        })).collect::<Vec<_>>()
    });
    // Bande de 60 mm de haut, pas 1500 : la largeur de départ de sparrow est
    // `aire totale / hauteur` DEFLATEE de space/2 (piège AGENTS #2b) — sur
    // 1500 mm de haut, trois volutes de 353 mm2 donnent 0,7 mm de large et le
    // moteur panique avant même d'arriver au gonflement des pièces.
    let config = serde_json::json!({
        "time_budget_sec": 2,
        "prng_seed": 20260912u64,
        "n_alternatives": 1,
        "n_workers": 1,
        "separator_workers": 1,
        "min_item_separation": SPACE,
        "poly_simpl_tolerance": 0.001,
        "narrow_concavity_cutoff": null,
        "max_strip_width": 3000.0,
        "live_events": false
    });
    // Sans le repli, cet appel meurt sur « importing SPP instance into
    // jagua-rs: Simple polygon contains intersecting edges ».
    let out = nest_engine::run_json("spp", &instance.to_string(), &config.to_string())
        .expect("le moteur doit importer et résoudre les trois volutes");
    let alt = out.alternatives.first().expect("une alternative");
    let placed = alt["solution"]["layout"]["placed_items"]
        .as_array()
        .expect("placed_items");
    assert_eq!(placed.len(), 3, "les trois volutes doivent être posées");

    // Distance EXACTE arête a arête entre les pièces posées (anneaux BRUTS,
    // non gonflés) : c'est la promesse faite à l'utilisateur.
    let shape: jagua_rs::io::ext_repr::ExtShape =
        serde_json::from_value(serde_json::json!({"type": "simple_polygon", "data": data}))
            .unwrap();
    let base = rings_of_shape(&shape);
    let poses: Vec<_> = placed
        .iter()
        .map(|pi| {
            let t = jagua_rs::io::ext_repr::ExtTransformation {
                rotation: pi["transformation"]["rotation"].as_f64().unwrap() as f32,
                translation: (
                    pi["transformation"]["translation"][0].as_f64().unwrap() as f32,
                    pi["transformation"]["translation"][1].as_f64().unwrap() as f32,
                ),
            };
            place_rings(&base[0], &t)
        })
        .collect();
    let mut min = f32::MAX;
    for i in 0..poses.len() {
        for j in (i + 1)..poses.len() {
            let d = ring_min_distance(&poses[i].outer, &poses[j].outer);
            println!("  volutes {i}-{j} : {d:.4} mm");
            min = min.min(d);
        }
    }
    println!("distance minimale entre volutes : {min:.4} mm (espacement demandé {SPACE})");
    assert!(
        min >= SPACE - 0.01,
        "espacement {SPACE} promis, {min:.4} mm mesuré entre deux volutes"
    );
}
