//! Invariant du GONFLEMENT (défaut C6 de l'audit moteur).
//!
//! `offset_shape(.., Inflate, d)` doit rendre un anneau qui (1) CONTIENT la
//! pièce, (2) a une aire >= celle de la pièce, (3) a son bord à au moins
//! `d * (1 - eps)` du bord de la pièce. Avant le correctif, `geo_buffer`
//! pouvait rendre un anneau SIMPLE mais faux (plus petit que la pièce, ou
//! collé à elle) : il passait sans contrôle, le moteur calculait ses
//! collisions sur une forme trop petite, et deux pièces se chevauchaient avec
//! `thin_items` vide.
//!
//! Les volutes sont SYNTHÉTIQUES. Les versions « simplifiées » viennent du
//! VRAI `simplifyRing` du builder JS (Douglas-Peucker 0,05 mm), produites par
//! `fixtures/gen_inflate_invariant.mjs`.
//!
//! Run: cargo test --release -p nest-engine --test inflate_invariant -- --nocapture

use jagua_rs::geometry::primitives::SPolygon;
use jagua_rs::geometry::shape_modification::{
    ShapeModifyMode, offset_shape, set_current_item, take_fallback_items,
};
use jagua_rs::io::ext_repr::{ExtSPolygon, ExtShape, ExtTransformation};
use jagua_rs::io::import::import_simple_polygon;
use nest_engine::geometry_check::{place_rings, ring_min_distance, rings_of_shape};
use nest_engine::progress::EventSink;
use std::sync::{Arc, Mutex};

/// `FALLBACK_ITEMS` est global : les tests de ce fichier passent l'un après
/// l'autre pour ne pas se voler les identifiants.
static SERIE: Mutex<()> = Mutex::new(());

/// Tolérance relative du test sur la distance de bord (le tour du disque par
/// `geo_buffer` est une corde, donc légèrement sous `d`). Volontairement
/// large : le test mesure l'invariant, pas le seuil du correctif.
#[allow(dead_code)]
const EPS_TEST: f64 = 0.10;

/// Borne STRICTE du niveau « espacement tenu » : d * 0,99 - 0,001 mm.
fn strict_min(d: f32) -> f64 {
    use jagua_rs::geometry::shape_modification::{INFLATE_HELD_RATIO, INFLATE_HELD_SLACK};
    d as f64 * INFLATE_HELD_RATIO - INFLATE_HELD_SLACK
}

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

fn area(ring: &[(f32, f32)]) -> f64 {
    let n = ring.len();
    let mut a = 0.0;
    for i in 0..n {
        let (px, py) = (ring[i].0 as f64, ring[i].1 as f64);
        let (qx, qy) = (ring[(i + 1) % n].0 as f64, ring[(i + 1) % n].1 as f64);
        a += px * qy - qx * py;
    }
    (a / 2.0).abs()
}

fn pt_seg(p: (f32, f32), a: (f32, f32), b: (f32, f32)) -> f64 {
    let (px, py, ax, ay, bx, by) = (
        p.0 as f64, p.1 as f64, a.0 as f64, a.1 as f64, b.0 as f64, b.1 as f64,
    );
    let (dx, dy) = (bx - ax, by - ay);
    let l2 = dx * dx + dy * dy;
    let t = if l2 == 0.0 {
        0.0
    } else {
        (((px - ax) * dx + (py - ay) * dy) / l2).clamp(0.0, 1.0)
    };
    let (ex, ey) = (px - (ax + t * dx), py - (ay + t * dy));
    (ex * ex + ey * ey).sqrt()
}

/// Orientation (produit vectoriel) de c par rapport à la droite a->b, écrite
/// ICI : l'oracle ne s'appuie sur aucune fonction du crate testé.
fn orient(a: (f32, f32), b: (f32, f32), c: (f32, f32)) -> f64 {
    (b.0 as f64 - a.0 as f64) * (c.1 as f64 - a.1 as f64)
        - (b.1 as f64 - a.1 as f64) * (c.0 as f64 - a.0 as f64)
}

/// Les segments [p1 p2] et [q1 q2] se croisent-ils en un point strictement
/// intérieur aux deux (croisement propre) ?
fn segments_se_croisent(p1: (f32, f32), p2: (f32, f32), q1: (f32, f32), q2: (f32, f32)) -> bool {
    let (o1, o2) = (orient(p1, p2, q1), orient(p1, p2, q2));
    let (o3, o4) = (orient(q1, q2, p1), orient(q1, q2, p2));
    ((o1 > 0.0 && o2 < 0.0) || (o1 < 0.0 && o2 > 0.0))
        && ((o3 > 0.0 && o4 < 0.0) || (o3 < 0.0 && o4 > 0.0))
}

/// Une arête de `a` croise-t-elle une arête de `b` ENTRE leurs sommets ? La
/// distance sommet -> segment ne le voit pas : deux arêtes peuvent se croiser
/// sans qu'aucun sommet soit proche de l'autre arête.
fn bords_se_croisent(a: &[(f32, f32)], b: &[(f32, f32)]) -> bool {
    for i in 0..a.len() {
        let (p1, p2) = (a[i], a[(i + 1) % a.len()]);
        let (lo_x, hi_x) = (p1.0.min(p2.0), p1.0.max(p2.0));
        let (lo_y, hi_y) = (p1.1.min(p2.1), p1.1.max(p2.1));
        for j in 0..b.len() {
            let (q1, q2) = (b[j], b[(j + 1) % b.len()]);
            if q1.0.max(q2.0) < lo_x || q1.0.min(q2.0) > hi_x
                || q1.1.max(q2.1) < lo_y || q1.1.min(q2.1) > hi_y
            {
                continue;
            }
            if segments_se_croisent(p1, p2, q1, q2) {
                return true;
            }
        }
    }
    false
}

/// Distance minimale entre deux frontières : 0 si une arête de l'une croise
/// une arête de l'autre (y compris entre sommets) ; sinon sommet -> segment
/// dans LES DEUX sens (exacte quand les frontières ne se croisent pas, ce qui
/// est le cas d'un anneau gonflé qui contient la pièce).
fn boundary_distance(a: &[(f32, f32)], b: &[(f32, f32)]) -> f64 {
    if bords_se_croisent(a, b) {
        return 0.0;
    }
    distance_sommets_segments(a, b)
}

/// Sommet -> segment dans les deux sens SEULEMENT (l'ancien oracle : aveugle à
/// un croisement entre sommets).
fn distance_sommets_segments(a: &[(f32, f32)], b: &[(f32, f32)]) -> f64 {
    let one_way = |x: &[(f32, f32)], y: &[(f32, f32)]| {
        let mut best = f64::INFINITY;
        for &p in x {
            for j in 0..y.len() {
                best = best.min(pt_seg(p, y[j], y[(j + 1) % y.len()]));
            }
        }
        best
    };
    one_way(a, b).min(one_way(b, a))
}

fn point_in_ring(pt: (f32, f32), ring: &[(f32, f32)]) -> bool {
    let (mut inside, n) = (false, ring.len());
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (ring[i].0 as f64, ring[i].1 as f64);
        let (xj, yj) = (ring[j].0 as f64, ring[j].1 as f64);
        if (yi > pt.1 as f64) != (yj > pt.1 as f64)
            && (pt.0 as f64) < (xj - xi) * (pt.1 as f64 - yi) / (yj - yi) + xi
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Mesures d'un gonflement : contenance, rapport d'aire, distance de bord.
struct Mesure {
    contenue: bool,
    aire_ratio: f64,
    dist: f64,
}

/// `part` = l'anneau tel que jagua le tient (`SPolygon::vertices`),
/// `inflated` = l'anneau rendu par `offset_shape`.
fn mesure(part: &[(f32, f32)], inflated: &[(f32, f32)]) -> Mesure {
    let dist = boundary_distance(part, inflated);
    // Contenue : tous les sommets de la pièce dans l'anneau gonflé ET les
    // frontières ne se touchent pas (distance > 0).
    let contenue = dist > 0.0 && part.iter().all(|&p| point_in_ring(p, inflated));
    Mesure {
        contenue,
        aire_ratio: area(inflated) / area(part),
        dist,
    }
}

fn verts(sp: &SPolygon) -> Vec<(f32, f32)> {
    sp.vertices.iter().map(|p| (p.0, p.1)).collect()
}

fn import_ring(ring: &[(f32, f32)]) -> Option<SPolygon> {
    import_simple_polygon(&ExtSPolygon(ring.to_vec())).ok()
}

struct Cas {
    nom: String,
    ring: Vec<(f32, f32)>,
}

fn fixture_volutes() -> Vec<Cas> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/inflate_invariant_volutes.json"
    );
    let raw = std::fs::read_to_string(path).expect("fixture volutes simplifiées");
    let v: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
    v.iter()
        .map(|o| Cas {
            nom: format!("simpl g{} h{} t{}", o["gap"], o["half"], o["turns"]),
            ring: o["ring"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| (p[0].as_f64().unwrap() as f32, p[1].as_f64().unwrap() as f32))
                .collect(),
        })
        .collect()
}

fn toutes_les_volutes() -> Vec<Cas> {
    let mut out = Vec::new();
    for gap in [0.05, 0.3, 1.0, 1.9, 2.0, 2.1, 3.0] {
        for half in [0.6, 1.2, 3.0] {
            for turns in [1.5, 2.5, 4.0] {
                out.push(Cas {
                    nom: format!("brute g{gap} h{half} t{turns}"),
                    ring: volute_ring(gap, half, turns, 240),
                });
            }
        }
    }
    out.extend(fixture_volutes());
    out
}

/// Le chemin PRIMAIRE rejoué : anneau de `geo_buffer` quand il est unique et
/// importable (c'est lui qui était accepté sans contrôle).
fn geo_buffer_ring(part: &SPolygon, d: f32) -> Option<Vec<(f32, f32)>> {
    let poly = geo_types::Polygon::new(
        part.vertices.iter().map(|p| (p.0 as f64, p.1 as f64)).collect(),
        vec![],
    );
    let res = geo_buffer::buffer_polygon_rounded(&poly, d as f64).0;
    if res.len() != 1 {
        return None;
    }
    let ext = ExtSPolygon(
        res[0]
            .exterior()
            .points()
            .map(|p| (p.x() as f32, p.y() as f32))
            .collect(),
    );
    import_simple_polygon(&ext).ok().map(|s| verts(&s))
}

#[test]
fn invariant_par_piece_sur_63_volutes_brutes_et_simplifiees() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let mut echecs = 0;
    let mut repli = 0;
    let mut total = 0;
    let mut min_repli = f64::MAX;
    for d in [1.0f32, 0.25] {
        for (i, cas) in toutes_les_volutes().iter().enumerate() {
            let Some(part) = import_ring(&cas.ring) else {
                continue;
            };
            take_fallback_items();
            set_current_item(Some(i as u64));
            let out = offset_shape(&part, ShapeModifyMode::Inflate, d);
            set_current_item(None);
            let pris_repli = !take_fallback_items().is_empty();
            total += 1;
            repli += pris_repli as usize;
            let out = match out {
                Ok(o) => o,
                Err(e) => {
                    echecs += 1;
                    println!(
                        "ECHEC d={d} {} : offset_shape refuse : {}",
                        cas.nom,
                        e.to_string().chars().take(80).collect::<String>()
                    );
                    continue;
                }
            };
            let m = mesure(&verts(&part), &verts(&out));
            if pris_repli {
                min_repli = min_repli.min(m.dist / d as f64);
            }
            let min_strict = strict_min(d);
            let ok = m.contenue && m.aire_ratio >= 1.0 && m.dist >= min_strict;
            if !ok {
                echecs += 1;
                println!(
                    "ECHEC d={d} {} : contenue={} aire_ratio={:.4} dist={:.4} (min {:.4}) repli={}",
                    cas.nom,
                    m.contenue,
                    m.aire_ratio,
                    m.dist,
                    min_strict,
                    pris_repli
                );
                println!("   ratio dist/d = {:.4}", m.dist / d as f64);
            }
        }
    }
    println!("{total} cas, {repli} par le repli (dist/d min {min_repli:.4}), {echecs} violations");
    // Le test ne doit pas pouvoir passer à vide : 126 volutes x 2 espacements.
    assert!(total >= 252, "{total} cas seulement (252 attendus) : le test passe à vide");
    assert_eq!(
        echecs, 0,
        "{echecs} gonflements violent l'invariant (voir lignes ECHEC)"
    );
}

fn formes_ordinaires() -> Vec<Cas> {
    let rect = |w: f32, h: f32| vec![(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)];
    let circle: Vec<(f32, f32)> = (0..64)
        .map(|i| {
            let a = i as f64 / 64.0 * std::f64::consts::TAU;
            ((20.0 * a.cos()) as f32, (20.0 * a.sin()) as f32)
        })
        .collect();
    let star: Vec<(f32, f32)> = (0..10)
        .map(|i| {
            let a = i as f64 / 10.0 * std::f64::consts::TAU;
            let r = if i % 2 == 0 { 25.0 } else { 10.0 };
            ((r * a.cos()) as f32, (r * a.sin()) as f32)
        })
        .collect();
    let mut v = vec![
        Cas { nom: "rect 40x40".into(), ring: rect(40.0, 40.0) },
        Cas { nom: "rect 100x5".into(), ring: rect(100.0, 5.0) },
        Cas { nom: "cercle 64".into(), ring: circle },
        Cas {
            nom: "L".into(),
            ring: vec![
                (0.0, 0.0), (60.0, 0.0), (60.0, 15.0), (15.0, 15.0), (15.0, 60.0), (0.0, 60.0),
            ],
        },
        Cas { nom: "etoile".into(), ring: star },
    ];
    let bench = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../bench/fixtures/");
    for f in [
        "b_demo/instance.json",
        "e0_volute/instance.json",
        "j7a_limite/instance.json",
        "grid_instance.json",
        "capsule300_instance.json",
    ] {
        let raw = std::fs::read_to_string(format!("{bench}{f}")).expect(f);
        let j: serde_json::Value = serde_json::from_str(&raw).unwrap();
        for (k, it) in j["items"].as_array().unwrap().iter().enumerate() {
            if it["shape"]["type"] == "simple_polygon" {
                let ring = it["shape"]["data"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| (p[0].as_f64().unwrap() as f32, p[1].as_f64().unwrap() as f32))
                    .collect();
                v.push(Cas { nom: format!("{f}#{k}"), ring });
            }
        }
    }
    v
}

fn quantile(v: &mut [f64], q: f64) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((v.len() - 1) as f64 * q) as usize]
}

/// Mesure, pas une preuve : imprime la distribution de dist/d de l'anneau de
/// `geo_buffer` sur les formes ordinaires et sur les volutes.
#[test]
fn distribution_des_rapports() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    for d in [1.0f32, 0.25] {
        let mut ord = Vec::new();
        for cas in formes_ordinaires() {
            let Some(part) = import_ring(&cas.ring) else {
                continue;
            };
            if let Some(r) = geo_buffer_ring(&part, d) {
                let m = mesure(&verts(&part), &r);
                let r = m.dist / d as f64;
                ord.push(r);
                if !(0.9..=1.5).contains(&r) || !m.contenue || m.aire_ratio < 1.0 {
                    println!(
                        "  ordinaire atypique d={d} {} : dist/d={:.4} contenue={} aire={:.3}",
                        cas.nom, m.dist / d as f64, m.contenue, m.aire_ratio
                    );
                }
            }
        }
        let (mut bonnes, mut mauvaises) = (Vec::new(), Vec::new());
        for cas in toutes_les_volutes() {
            let Some(part) = import_ring(&cas.ring) else {
                continue;
            };
            if let Some(r) = geo_buffer_ring(&part, d) {
                let m = mesure(&verts(&part), &r);
                let ratio = m.dist / d as f64;
                if m.contenue && m.aire_ratio >= 1.0 {
                    bonnes.push(ratio);
                } else {
                    mauvaises.push(ratio);
                }
                println!(
                    "  volute d={d} {} : dist/d={ratio:.4} contenue={} aire_ratio={:.3}",
                    cas.nom, m.contenue, m.aire_ratio
                );
            }
        }
        let n = ord.len();
        let mn = ord.iter().cloned().fold(f64::MAX, f64::min);
        let md = quantile(&mut ord, 0.5);
        println!("d={d} ORDINAIRES n={n} min={mn:.4} median={md:.4}");
        if !bonnes.is_empty() {
            let mn = bonnes.iter().cloned().fold(f64::MAX, f64::min);
            let md = quantile(&mut bonnes, 0.5);
            println!("d={d} VOLUTES (anneau unique importable, contenues, aire>=) n={} min={mn:.4} median={md:.4}", bonnes.len());
        }
        if !mauvaises.is_empty() {
            let mx = mauvaises.iter().cloned().fold(0.0, f64::max);
            println!("d={d} VOLUTES MAUVAISES n={} max dist/d={mx:.4}", mauvaises.len());
        }
    }
}

/// Vérité sous T2 : les formes ordinaires dont l'anneau de `geo_buffer` tient
/// déjà la borne stricte reviennent IDENTIQUES (sommets exacts) à cet anneau ;
/// les autres prennent la voie PROCHE (repli silencieux, jamais nommées) et
/// sont listées par nom.
#[test]
fn les_formes_ordinaires_identiques_a_geo_buffer_ou_voie_proche() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut identiques, mut proches) = (0, Vec::new());
    for d in [1.0f32, 0.25] {
        for (i, cas) in formes_ordinaires().iter().enumerate() {
            let Some(part) = import_ring(&cas.ring) else {
                continue;
            };
            let Some(attendu) = geo_buffer_ring(&part, d) else {
                continue;
            };
            let att_sp = import_ring(&attendu).unwrap();
            let tient = jagua_rs::geometry::shape_modification::inflate_min_boundary_distance(
                &part, &att_sp,
            ) >= strict_min(d);
            take_fallback_items();
            set_current_item(Some(i as u64));
            let out = offset_shape(&part, ShapeModifyMode::Inflate, d).expect(&cas.nom);
            set_current_item(None);
            assert!(
                take_fallback_items().is_empty(),
                "d={d} {} : nommée (la voie proche est silencieuse)",
                cas.nom
            );
            if tient || !HOLD {
                assert_eq!(
                    verts(&out),
                    attendu,
                    "d={d} {} : anneau différent de geo_buffer",
                    cas.nom
                );
                identiques += 1;
            } else {
                let m = mesure(&verts(&part), &verts(&out));
                assert!(
                    m.contenue && m.dist >= strict_min(d),
                    "d={d} {} : anneau de repli sous la borne ({:.4})",
                    cas.nom,
                    m.dist / d as f64
                );
                proches.push(format!("d={d} {}", cas.nom));
            }
        }
    }
    println!("{identiques} formes identiques à geo_buffer ; voie PROCHE : {proches:#?}");
    assert!(identiques >= 62, "{identiques} formes identiques seulement (62 attendues)");
    if HOLD {
        assert_eq!(
            proches,
            vec!["d=1 b_demo/instance.json#11".to_string(), "d=1 b_demo/instance.json#12".to_string()],
            "la liste des formes ordinaires de la voie PROCHE doit être exactement #11 et #12 de b_demo"
        );
    }
}

const HOLD: bool = jagua_rs::geometry::shape_modification::INFLATE_HOLD_SPACING;

/// b_demo #11 et #12 à d = 1 : anneaux de `geo_buffer` à 0,7155 d et 0,3631 d.
/// Le repli doit tenir la borne stricte, SANS nommer les pièces.
#[test]
fn b_demo_11_et_12_tiennent_l_espacement_en_silence() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../bench/fixtures/b_demo/instance.json");
    let j: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let items = j["items"].as_array().unwrap();
    let d = 1.0f32;
    let mut echecs = 0;
    for k in [11usize, 12] {
        let ring: Vec<(f32, f32)> = items[k]["shape"]["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| (p[0].as_f64().unwrap() as f32, p[1].as_f64().unwrap() as f32))
            .collect();
        let part = import_ring(&ring).unwrap();
        take_fallback_items();
        set_current_item(Some(k as u64));
        let out = offset_shape(&part, ShapeModifyMode::Inflate, d).expect("offset");
        set_current_item(None);
        let nommes = take_fallback_items();
        let m = mesure(&verts(&part), &verts(&out));
        println!("b_demo#{k} : dist/d = {:.4}, contenue={}, nommée={:?}", m.dist / d as f64, m.contenue, nommes);
        if !(m.contenue && m.aire_ratio >= 1.0 && m.dist >= strict_min(d)) {
            echecs += 1;
        }
        if !nommes.is_empty() {
            echecs += 1;
        }
    }
    assert_eq!(echecs, 0, "b_demo #11/#12 : borne stricte ou silence violés");
}

/// Un cas GROSSIER nomme toujours la pièce. Volute g0.05 h0.6 t2.5 à d = 1 :
/// `geo_buffer` rend UN SEUL anneau, importable, qui TRAVERSE la pièce (ses
/// brins sont à 0,05 mm l'un de l'autre) ; le contrôle le juge grossier, le
/// repli prend la main et la pièce est nommée. Préconditions vérifiées.
#[test]
fn un_cas_grossier_nomme_encore_la_piece() {
    use jagua_rs::geometry::shape_modification::{InflateVerdict, inflate_verdict};
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let ring = volute_ring(0.05, 0.6, 2.5, 240);
    let part = import_ring(&ring).expect("import volute");
    let geo = import_ring(&geo_buffer_ring(&part, 1.0).expect("geo_buffer : un anneau unique importable"))
        .expect("anneau importable");
    assert!(
        bords_se_croisent(&verts(&part), &verts(&geo)),
        "précondition : l'anneau unique de geo_buffer traverse la pièce"
    );
    assert!(
        matches!(inflate_verdict(&part, &geo, 1.0), InflateVerdict::Gross(_)),
        "précondition : verdict grossier"
    );
    take_fallback_items();
    set_current_item(Some(7));
    let out = offset_shape(&part, ShapeModifyMode::Inflate, 1.0);
    set_current_item(None);
    assert!(out.is_ok());
    assert_eq!(take_fallback_items(), vec![7], "la pièce grossière doit être nommée");
}

/// Croisement à seuil nul : un anneau qui TRAVERSE la pièce est GROSSIER même
/// quand les seuils sont nuls (distance 0 = croisement). Exprimé par
/// `inflate_verdict` avec une distance nulle.
#[test]
fn croisement_a_seuil_nul_est_grossier() {
    use jagua_rs::geometry::shape_modification::{InflateVerdict, inflate_verdict};
    let part = import_ring(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]).unwrap();
    // Anneau plus grand en aire mais décalé : ses bords traversent ceux de la pièce.
    let ring = import_ring(&[(5.0, 5.0), (30.0, 5.0), (30.0, 30.0), (5.0, 30.0)]).unwrap();
    assert!(ring.area >= part.area);
    for d in [0.0f32, 1.0] {
        assert!(
            matches!(inflate_verdict(&part, &ring, d), InflateVerdict::Gross(_)),
            "d={d} : un anneau qui croise doit être grossier"
        );
    }
}

fn silent() -> (EventSink, Arc<Mutex<Vec<String>>>) {
    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let store = lines.clone();
    let sink: EventSink = Arc::new(move |l: &str| {
        if let Ok(mut v) = store.lock() {
            v.push(l.to_owned());
        }
    });
    (sink, lines)
}

/// Cas de l'audit : 2 x volute g2.0 h3.0 t4.0 (240 pas), espacement 2,
/// rotations [0], bande de hauteur 91 puis 300.
#[test]
fn bout_en_bout_deux_volutes_gardent_l_espacement_et_sont_nommees() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    const SPACE: f32 = 2.0;
    let ring = volute_ring(2.0, 3.0, 4.0, 240);
    let data: Vec<[f32; 2]> = ring.iter().map(|p| [p.0, p.1]).collect();
    for strip_h in [91.0f64, 300.0] {
        let instance = serde_json::json!({
            "name": "c6-volutes-x2",
            "strip_height": strip_h,
            "items": [{
                "id": 0, "demand": 2, "allowed_orientations": [0.0],
                "shape": {"type": "simple_polygon", "data": data}
            }]
        });
        let config = serde_json::json!({
            "time_budget_sec": 2, "prng_seed": 20260912u64, "n_alternatives": 1,
            "n_workers": 1, "separator_workers": 1, "min_item_separation": SPACE,
            "poly_simpl_tolerance": 0.001, "narrow_concavity_cutoff": null,
            "max_strip_width": 3000.0, "live_events": false
        });
        let (sink, lines) = silent();
        take_fallback_items();
        let out = nest_engine::run_json_with_sink(
            "spp",
            &instance.to_string(),
            &config.to_string(),
            sink,
        )
        .expect("le moteur doit résoudre les deux volutes");
        let alt = out.alternatives.first().expect("une alternative");
        let placed = alt["solution"]["layout"]["placed_items"]
            .as_array()
            .expect("placed_items");
        assert_eq!(placed.len(), 2, "H={strip_h} : les deux volutes doivent être posées");
        let shape: ExtShape = serde_json::from_value(
            serde_json::json!({"type": "simple_polygon", "data": data}),
        )
        .unwrap();
        let base = rings_of_shape(&shape);
        let poses: Vec<_> = placed
            .iter()
            .map(|pi| {
                let t = ExtTransformation {
                    rotation: pi["transformation"]["rotation"].as_f64().unwrap() as f32,
                    translation: (
                        pi["transformation"]["translation"][0].as_f64().unwrap() as f32,
                        pi["transformation"]["translation"][1].as_f64().unwrap() as f32,
                    ),
                };
                place_rings(&base[0], &t)
            })
            .collect();
        let d = ring_min_distance(&poses[0].outer, &poses[1].outer);
        let nommee = out.thin_items.contains(&0)
            || lines.lock().unwrap().iter().any(|l| l.contains("thin_items"));
        println!(
            "H={strip_h} : distance réelle {d:.4} mm (promis {SPACE}), thin_items={:?}, évènement thin={nommee}",
            out.thin_items
        );
        assert!(
            d >= SPACE - 0.01,
            "H={strip_h} : espacement {SPACE} promis, {d:.4} mm mesuré entre les deux volutes"
        );
        assert!(
            nommee,
            "H={strip_h} : la pièce 0 devrait être nommée dans thin_items"
        );
    }
}

/// Anneau « gonflé » construit à la main (pas `geo_buffer`, dont le coût sur
/// 20 000 sommets est le sien et ne se termine pas) : mêmes angles que la
/// pièce, chaque sommet repoussé de `d` le long de sa direction radiale.
fn gonfle_radial(ring: &[(f32, f32)], d: f64) -> Vec<(f32, f32)> {
    ring.iter()
        .map(|&(x, y)| {
            let (x, y) = (x as f64, y as f64);
            let r = (x * x + y * y).sqrt();
            (((x / r) * (r + d)) as f32, ((y / r) * (r + d)) as f32)
        })
        .collect()
}

/// Spirale CARREE épaisse (bande de demi-largeur `h` autour d'une polyligne
/// en spirale carrée, pas entre brins de 6 mm), `m` points de ligne centrale,
/// donc `2 m` sommets (coins en onglet : exact pour des virages à 90 degrés).
/// Les bouts sont prolongés de `ext`. Tournée de `deg` degrés. Une spirale de demi-largeur 1 et son « anneau
/// décalé de 1 » (demi-largeur 2) forment une paire pièce / anneau gonflé
/// dont le bord est à 1 mm partout, avec de LONGUES arêtes qui, tournées de
/// 45 degrés, couvrent presque toute la boîte de la pièce.
fn spirale_carree(h: f64, ext: f64, m: usize, deg: f64) -> Vec<(f32, f32)> {
    let dirs = [(1.0f64, 0.0f64), (0.0, 1.0), (-1.0, 0.0), (0.0, -1.0)];
    let mut pts = vec![(0.0f64, 0.0f64)];
    for k in 0..m - 1 {
        let len = 10.0 + 6.0 * (k / 2) as f64;
        let (dx, dy) = dirs[k % 4];
        let (x, y) = *pts.last().unwrap();
        pts.push((x + dx * len, y + dy * len));
    }
    // Prolongement des deux bouts de `ext` (les capuchons de l'anneau
    // gonflé sont à `ext` de ceux de la pièce).
    pts[0].0 -= dirs[0].0 * ext;
    pts[0].1 -= dirs[0].1 * ext;
    let (dl, last) = (dirs[(m - 2) % 4], m - 1);
    pts[last].0 += dl.0 * ext;
    pts[last].1 += dl.1 * ext;
    // Normale gauche de l'arête k.
    let normal = |k: usize| {
        let (dx, dy) = dirs[k % 4];
        (-dy, dx)
    };
    let (mut left, mut right) = (Vec::new(), Vec::new());
    for (k, &(x, y)) in pts.iter().enumerate() {
        let (nx, ny) = if k == 0 {
            normal(0)
        } else if k == m - 1 {
            normal(m - 2)
        } else {
            let (a, b) = (normal(k - 1), normal(k));
            (a.0 + b.0, a.1 + b.1)
        };
        left.push((x + h * nx, y + h * ny));
        right.push((x - h * nx, y - h * ny));
    }
    let (s, c) = deg.to_radians().sin_cos();
    left.into_iter()
        .chain(right.into_iter().rev())
        .map(|(x, y)| ((x * c - y * s) as f32, (x * s + y * c) as f32))
        .collect()
}

/// Coût du CONTRÔLE seul (pas de `geo_buffer`) : anneau pièce de 500, 5 000 et
/// 20 000 sommets, cercle et couronne ondulée (bord long, beaucoup d'arêtes
/// proches), anneau gonflé construit analytiquement. Bornes 5 / 20 / 100 ms (marge x4 à x10 au
/// moins sur la mesure) : le test attrape un retour au double balayage O(n.m).
#[test]
fn cout_du_controle() {
    use jagua_rs::geometry::shape_modification::{
        inflate_min_boundary_distance, inflate_ring_defect,
    };
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let d = 1.0f32;
    let mut pire_ms: [f64; 3] = [0.0; 3];
    for (k, n) in [500usize, 5000, 20000].into_iter().enumerate() {
        let formes: [(&str, Vec<(f32, f32)>); 2] = [
            (
                "cercle",
                (0..n)
                    .map(|i| {
                        let a = i as f64 / n as f64 * std::f64::consts::TAU;
                        ((100.0 * a.cos()) as f32, (100.0 * a.sin()) as f32)
                    })
                    .collect(),
            ),
            (
                "ondulée",
                (0..n)
                    .map(|i| {
                        let a = i as f64 / n as f64 * std::f64::consts::TAU;
                        let r = 100.0 + 8.0 * (a * 40.0).sin();
                        ((r * a.cos()) as f32, (r * a.sin()) as f32)
                    })
                    .collect(),
            ),
        ];
        for (nom, ring) in formes {
            let part = import_ring(&ring).expect("import");
            let inf = import_ring(&gonfle_radial(&ring, d as f64)).expect("import gonflé");
            let t = std::time::Instant::now();
            let r = inflate_ring_defect(&part, &inf, d);
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            let t = std::time::Instant::now();
            let dist = inflate_min_boundary_distance(&part, &inf);
            let ms_mesure = t.elapsed().as_secs_f64() * 1000.0;
            println!(
                "controle {nom} : {} sommets pièce, {} gonflé -> {ms:.2} ms (verdict {r:?}), mesure exacte {ms_mesure:.2} ms (dist {dist:.4})",
                part.vertices.len(),
                inf.vertices.len()
            );
            pire_ms[k] = pire_ms[k].max(ms).max(ms_mesure);
            // La couronne pousse radialement : sa distance réelle est <= d
            // (la normale n'est pas radiale) ; le cercle est exact.
            if nom == "cercle" {
                assert!(r.is_none(), "cercle n={n} : anneau sain refusé : {r:?}");
                assert!((dist - d as f64).abs() < 0.01, "cercle n={n} : dist {dist}");
            }
        }
    }
    println!("pire coût : 500 -> {:.2} ms, 5000 -> {:.2} ms, 20000 -> {:.2} ms", pire_ms[0], pire_ms[1], pire_ms[2]);
    assert!(pire_ms[0] < 5.0, "500 sommets : {:.2} ms", pire_ms[0]);
    assert!(pire_ms[1] < 20.0, "5 000 sommets : {:.2} ms", pire_ms[1]);
    assert!(pire_ms[2] < 100.0, "20 000 sommets : {:.2} ms", pire_ms[2]);

    // Spirale carrée de 4 002 sommets et son anneau décalé de 1 : alignée sur
    // les axes la grille est parfaite (4 ms mesurés) ; tournée de 45 degrés
    // les arêtes diagonales remplissent leur boîte de cellules (1 310 ms
    // mesurés avec la grille seule, 157 ms pour la double boucle simple). Le
    // contrôle doit rester dans un facteur 2,5 de la double boucle.
    for (deg, borne_ms) in [(0.0f64, 30.0f64), (45.0, 400.0)] {
        let part = import_ring(&spirale_carree(1.0, 0.0, 2001, deg)).expect("spirale pièce");
        let inf = import_ring(&spirale_carree(2.0, 1.0, 2001, deg)).expect("spirale anneau");
        assert_eq!((part.vertices.len(), inf.vertices.len()), (4002, 4002));
        let t = std::time::Instant::now();
        let r = inflate_ring_defect(&part, &inf, d);
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        let t = std::time::Instant::now();
        let dist = inflate_min_boundary_distance(&part, &inf);
        let ms_mesure = t.elapsed().as_secs_f64() * 1000.0;
        println!("spirale {deg} deg : verdict {r:?} en {ms:.1} ms, mesure exacte {ms_mesure:.1} ms (dist {dist:.4})");
        assert!(r.is_none(), "spirale {deg} : anneau décalé de 1 refusé : {r:?}");
        assert!((dist - 1.0).abs() < 0.01, "spirale {deg} : dist {dist}");
        assert!(ms < borne_ms, "spirale {deg} : contrôle {ms:.1} ms (borne {borne_ms})");
        assert!(ms_mesure < 400.0, "spirale {deg} : mesure exacte {ms_mesure:.1} ms (borne 400)");
    }
}

/// La grille ne change pas le verdict : sur les volutes et les formes
/// ordinaires, la mesure exacte égale la distance forcée brute (sommet ->
/// segment dans les deux sens, exacte quand les bords ne se croisent pas) et
/// le verdict « trop près » suit `mesure < seuil`.
#[test]
fn mesure_exacte_egale_la_force_brute() {
    use jagua_rs::geometry::shape_modification::{
        INFLATE_GROSS_RATIO, InflateVerdict, inflate_min_boundary_distance,
        inflate_verdict,
    };
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let (mut n, mut croises) = (0, 0);
    for d in [1.0f32, 0.25] {
        let mut cas = toutes_les_volutes();
        cas.extend(formes_ordinaires());
        for c in cas {
            let Some(part) = import_ring(&c.ring) else { continue };
            let Some(r) = geo_buffer_ring(&part, d) else { continue };
            let inf = import_ring(&r).unwrap();
            let m = mesure(&verts(&part), &verts(&inf));
            let exact = inflate_min_boundary_distance(&part, &inf);
            if m.dist == 0.0 {
                // L'oracle (croisement d'arêtes écrit dans ce fichier) voit un
                // croisement : la mesure exacte du crate doit dire 0 aussi.
                assert_eq!(exact, 0.0, "d={d} {} : l'oracle voit un croisement, pas la mesure", c.nom);
                croises += 1;
                continue;
            }
            if !m.contenue {
                continue;
            }
            assert!(exact > 0.0, "d={d} {} : mesure 0 sans croisement de l'oracle", c.nom);
            assert!(
                (exact - m.dist).abs() <= 1e-9 * m.dist.max(1.0),
                "d={d} {} : exacte {exact} != brute {}",
                c.nom,
                m.dist
            );
            let thr = (d as f64 * INFLATE_GROSS_RATIO).max(0.0);
            let verdict = inflate_verdict(&part, &inf, d);
            if inf.area >= part.area {
                assert_eq!(
                    verdict == InflateVerdict::Gross("boundary closer than the offset distance"),
                    exact < thr,
                    "d={d} {} : verdict {verdict:?} pour exacte {exact} seuil {thr}",
                    c.nom
                );
            }
            n += 1;
        }
    }
    println!("{n} anneaux comparés à la force brute, {croises} à bords croisés (mesure 0)");
    assert!(n >= 240, "{n} anneaux comparés seulement");
    assert!(croises >= 1, "aucun anneau à bords croisés : l'oracle n'est pas exercé");

    // Spirale carrée de 4 002 sommets (arêtes longues) et son anneau décalé de
    // 1, alignée puis tournée de 45 degrés : la mesure exacte (grille ou
    // double boucle selon le coût) égale la force brute, le verdict est sain.
    for deg in [0.0f64, 45.0] {
        let part = import_ring(&spirale_carree(1.0, 0.0, 2001, deg)).expect("spirale pièce");
        let inf = import_ring(&spirale_carree(2.0, 1.0, 2001, deg)).expect("spirale anneau");
        let m = mesure(&verts(&part), &verts(&inf));
        let exact = inflate_min_boundary_distance(&part, &inf);
        assert!(m.contenue, "spirale {deg} : l'anneau doit contenir la pièce");
        assert!(
            (exact - m.dist).abs() <= 1e-9 * m.dist.max(1.0),
            "spirale {deg} : exacte {exact} != brute {}",
            m.dist
        );
        assert_eq!(inflate_verdict(&part, &inf, 1.0), InflateVerdict::Good, "spirale {deg}");
    }
}

/// Les trois volutes de `bench/fixtures/e0_volute/instance.json` (espacement
/// 2 mm, d = 1) prennent toujours le REPLI et sont NOMMEES ; leur anneau tient
/// la borne stricte (c'est l'anneau de repli, pas celui de `geo_buffer`).
#[test]
fn les_trois_volutes_de_e0_prennent_le_repli_et_sont_nommees() {
    let _g = SERIE.lock().unwrap_or_else(|e| e.into_inner());
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../bench/fixtures/e0_volute/instance.json");
    let j: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let items = j["items"].as_array().unwrap();
    assert_eq!(items.len(), 3, "trois volutes attendues dans la fixture");
    let d = 1.0f32;
    for (k, it) in items.iter().enumerate() {
        let ring: Vec<(f32, f32)> = it["shape"]["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| (p[0].as_f64().unwrap() as f32, p[1].as_f64().unwrap() as f32))
            .collect();
        let part = import_ring(&ring).expect("import volute e0");
        take_fallback_items();
        set_current_item(Some(k as u64));
        let out = offset_shape(&part, ShapeModifyMode::Inflate, d).expect("offset");
        set_current_item(None);
        assert_eq!(take_fallback_items(), vec![k as u64], "volute e0 #{k} : doit être nommée");
        let m = mesure(&verts(&part), &verts(&out));
        println!("e0_volute#{k} : dist/d = {:.4}, contenue={}", m.dist / d as f64, m.contenue);
        assert!(
            m.contenue && m.aire_ratio >= 1.0 && m.dist >= strict_min(d),
            "volute e0 #{k} : l'anneau de repli doit tenir la borne stricte ({:.4})",
            m.dist / d as f64
        );
    }
}

/// L'oracle voit un croisement d'arêtes ENTRE les sommets : pièce = barre
/// 100 x 10, anneau = grand rectangle qui contient tous ses sommets mais dont
/// une fente étroite (x de 50 à 54) traverse son bord haut au milieu. Aucun
/// sommet n'est près de l'autre bord (5 mm) : la distance sommet -> segment
/// seule dit 5 et « contenue » ; avec le croisement, l'oracle dit 0 et refuse.
#[test]
fn l_oracle_voit_un_croisement_entre_sommets() {
    let barre = [(0.0f32, 0.0f32), (100.0, 0.0), (100.0, 10.0), (0.0, 10.0)];
    let anneau = [
        (-50.0f32, -50.0f32), (150.0, -50.0), (150.0, 60.0),
        (54.0, 60.0), (54.0, 5.0), (50.0, 5.0), (50.0, 60.0), (-50.0, 60.0),
    ];
    let seul = distance_sommets_segments(&barre, &anneau);
    assert!((seul - 5.0).abs() < 1e-9, "précondition : l'ancien oracle voit {seul}");
    assert!(barre.iter().all(|&p| point_in_ring(p, &anneau)), "précondition : sommets dedans");
    assert!(bords_se_croisent(&barre, &anneau));
    let m = mesure(&barre, &anneau);
    assert_eq!(m.dist, 0.0);
    assert!(!m.contenue, "l'oracle doit refuser un anneau dont le bord traverse la pièce");
    // et la mesure exacte du crate dit la même chose
    let (p, r) = (import_ring(&barre).unwrap(), import_ring(&anneau).unwrap());
    assert_eq!(jagua_rs::geometry::shape_modification::inflate_min_boundary_distance(&p, &r), 0.0);
}
