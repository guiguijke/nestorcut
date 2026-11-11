//! MESURE (pas une preuve) du défaut C6 sur des pièces RÉELLES : classe le
//! résultat de `geo_buffer` pour chaque pièce et chaque demi-espacement d, et
//! compare les deux seuils candidats du contrôle d'anneau gonflé :
//!   T1 = 0,1 d            (défauts grossiers seulement)
//!   T2 = 0,99 d - 0,001   (espacement tenu)
//! Les seuils sont posés ICI (indépendants des consts du crate) pour que la
//! mesure ne dépende pas de celui qui est commité.
//!
//! Les anneaux du corpus viennent d'un script Node hors dépôt (vrai import
//! wasm + vrai `simplifyRing`) ; ils ne sont jamais copiés dans le dépôt.
//!
//! Run (corpus) : NEST_C6_CORPUS=<corpus_rings.json> \
//!   cargo test --release -p nest-engine --test inflate_corpus -- --ignored --nocapture

use jagua_rs::geometry::primitives::SPolygon;
use jagua_rs::geometry::shape_modification::{inflate_min_boundary_distance, robust_inflate_ring};
use jagua_rs::io::ext_repr::ExtSPolygon;
use jagua_rs::io::import::import_simple_polygon;
use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

const T1_RATIO: f64 = 0.1;
const T2_RATIO: f64 = 0.99;
const T2_SLACK: f64 = 0.001;
/// Au-delà, `geo_buffer` peut ne pas finir (20 000 sommets : 5,6 Go, jamais
/// terminé) : la pièce est comptée et nommée, pas mesurée.
const MAX_VERTS: usize = 4000;

const CLASSES: [&str; 9] = [
    "0 polygone",
    "plusieurs polygones",
    "anneau unique non importable",
    "anneau unique, aire < pièce",
    "anneau unique, ne contient pas",
    "ratio < 0,1",
    "0,1 <= ratio < 0,9",
    "0,9 <= ratio < T2",
    ">= T2",
];

struct Piece {
    file: String,
    idx: usize,
    ring: Vec<(f32, f32)>,
}

fn import_ring(ring: &[(f32, f32)]) -> Option<SPolygon> {
    let mut r = ring.to_vec();
    if r.len() > 1 && r.first() == r.last() {
        r.pop();
    }
    import_simple_polygon(&ExtSPolygon(r)).ok()
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

struct Mesure {
    classe: usize,
    verts: usize,
    ratio: f64,
    /// T2 refuserait, T1 non : le repli prendrait la pièce seulement avec T2.
    t2_seul: Option<T2Seul>,
}

struct T2Seul {
    geo_verts: usize,
    repli_verts: usize,
    geo_ms: f64,
    repli_ms: f64,
    repli_ok_t2: bool,
    repli_ratio: f64,
}

fn classe_de(part: &SPolygon, d: f32) -> Mesure {
    let verts = part.vertices.len();
    let poly = geo_types::Polygon::new(
        part.vertices.iter().map(|p| (p.0 as f64, p.1 as f64)).collect(),
        vec![],
    );
    let t = Instant::now();
    let res = geo_buffer::buffer_polygon_rounded(&poly, d as f64).0;
    let geo_ms = t.elapsed().as_secs_f64() * 1000.0;
    let sans = |classe| Mesure { classe, verts, ratio: f64::NAN, t2_seul: None };
    if res.is_empty() {
        return sans(0);
    }
    if res.len() > 1 {
        return sans(1);
    }
    let ext = ExtSPolygon(
        res[0].exterior().points().map(|p| (p.x() as f32, p.y() as f32)).collect(),
    );
    let Ok(ring) = import_simple_polygon(&ext) else {
        return sans(2);
    };
    let dist = inflate_min_boundary_distance(part, &ring);
    let ratio = dist / d as f64;
    let mk = |classe| Mesure { classe, verts, ratio, t2_seul: None };
    if !(ring.area >= part.area) {
        return mk(3);
    }
    let rv: Vec<(f32, f32)> = ring.vertices.iter().map(|p| (p.0, p.1)).collect();
    if !point_in_ring((part.vertices[0].0, part.vertices[0].1), &rv) {
        return mk(4);
    }
    let t2 = d as f64 * T2_RATIO - T2_SLACK;
    let mut m = if ratio < T1_RATIO {
        mk(5)
    } else if ratio < 0.9 {
        mk(6)
    } else if dist < t2 {
        mk(7)
    } else {
        mk(8)
    };
    if m.classe == 6 || m.classe == 7 {
        let t = Instant::now();
        let rep = robust_inflate_ring(&part.vertices, d)
            .ok()
            .and_then(|r| import_simple_polygon(&ExtSPolygon(r)).ok());
        let repli_ms = t.elapsed().as_secs_f64() * 1000.0;
        if let Some(rep) = rep {
            let rd = inflate_min_boundary_distance(part, &rep);
            m.t2_seul = Some(T2Seul {
                geo_verts: ring.vertices.len(),
                repli_verts: rep.vertices.len(),
                geo_ms,
                repli_ms,
                repli_ok_t2: rd >= t2,
                repli_ratio: rd / d as f64,
            });
        }
    }
    m
}

fn mediane(v: &mut [f64]) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

fn mesure_ensemble(titre: &str, pieces: &[Piece], ds: &[f32]) {
    let nfiles = pieces.iter().map(|p| p.file.as_str()).collect::<BTreeSet<_>>().len();
    println!("\n===== {titre} : {} pièces, {nfiles} fichiers =====", pieces.len());
    let mut hors: Vec<&Piece> = Vec::new();
    let mut mesurables: Vec<(&Piece, SPolygon)> = Vec::new();
    let mut non_importees = 0;
    for p in pieces {
        if p.ring.len() > MAX_VERTS {
            hors.push(p);
            continue;
        }
        match import_ring(&p.ring) {
            Some(s) => mesurables.push((p, s)),
            None => non_importees += 1,
        }
    }
    println!(
        "pièces non importables par jagua : {non_importees} ; au-dessus de {MAX_VERTS} sommets (non mesurées) : {}",
        hors.len()
    );
    for p in &hors {
        println!("  non mesurée : {}#{} ({} sommets)", p.file, p.idx, p.ring.len());
    }
    let n = mesurables.len();
    let nfm = mesurables.iter().map(|(p, _)| p.file.as_str()).collect::<BTreeSet<_>>().len();
    for &d in ds {
        println!("\n--- d = {d} (espacement {}) : {n} pièces mesurées, {nfm} fichiers ---", d * 2.0);
        let mut par_classe: Vec<(usize, BTreeSet<&str>)> = vec![(0, BTreeSet::new()); 9];
        let mut pires: Vec<(f64, &Piece, usize, usize)> = Vec::new();
        let mut t2_seul: Vec<(&Piece, usize, T2Seul)> = Vec::new();
        for (p, s) in &mesurables {
            let m = classe_de(s, d);
            par_classe[m.classe].0 += 1;
            par_classe[m.classe].1.insert(p.file.as_str());
            if m.ratio.is_finite() {
                pires.push((m.ratio, p, m.verts, m.classe));
            }
            if let Some(x) = m.t2_seul {
                t2_seul.push((p, m.verts, x));
            }
        }
        println!("{:<34} {:>6} {:>8} {:>8} {:>9}", "classe", "pièces", "% pièces", "fichiers", "% fichiers");
        for (c, (k, fs)) in par_classe.iter().enumerate() {
            println!(
                "{:<34} {:>6} {:>7.2}% {:>8} {:>8.2}%",
                CLASSES[c],
                k,
                100.0 * *k as f64 / n as f64,
                fs.len(),
                100.0 * fs.len() as f64 / nfm as f64
            );
        }
        pires.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        println!("15 pires (ratio = distance de bord / d) :");
        for (r, p, v, c) in pires.iter().take(15) {
            println!("  {:<60} #{:<3} {:>5} sommets ratio {:.4}  [{}]", p.file, p.idx, v, r, CLASSES[*c]);
        }
        println!(
            "T2 enverrait au repli et T1 non : {} pièces (sur {n}) dans {} fichiers",
            t2_seul.len(),
            t2_seul.iter().map(|x| x.0.file.as_str()).collect::<BTreeSet<_>>().len()
        );
        for (p, v, x) in t2_seul.iter().take(15) {
            println!(
                "  {:<60} #{:<3} pièce {v:>5} s | geo_buffer {:>5} s {:>8.2} ms | repli {:>5} s {:>8.2} ms | repli ratio {:.4} T2 tenu: {}",
                p.file, p.idx, x.geo_verts, x.geo_ms, x.repli_verts, x.repli_ms, x.repli_ratio, x.repli_ok_t2
            );
        }
        if !t2_seul.is_empty() {
            let mut gv: Vec<f64> = t2_seul.iter().map(|x| x.2.geo_verts as f64).collect();
            let mut rv: Vec<f64> = t2_seul.iter().map(|x| x.2.repli_verts as f64).collect();
            let mut gt: Vec<f64> = t2_seul.iter().map(|x| x.2.geo_ms).collect();
            let mut rt: Vec<f64> = t2_seul.iter().map(|x| x.2.repli_ms).collect();
            let ok = t2_seul.iter().filter(|x| x.2.repli_ok_t2).count();
            println!(
                "  médianes : sommets geo_buffer {:.0} / repli {:.0} ; temps geo_buffer {:.2} ms / repli {:.2} ms ; repli tient T2 : {ok}/{}",
                mediane(&mut gv),
                mediane(&mut rv),
                mediane(&mut gt),
                mediane(&mut rt),
                t2_seul.len()
            );
            let mut lents: Vec<&(&Piece, usize, T2Seul)> = t2_seul.iter().collect();
            lents.sort_by(|a, b| b.2.repli_ms.partial_cmp(&a.2.repli_ms).unwrap());
            for (p, v, x) in lents.iter().take(3).map(|t| (t.0, t.1, &t.2)) {
                println!(
                    "  repli le plus lent : {}#{} pièce {v} s : {:.2} ms (geo_buffer {:.2} ms, repli {} s, ratio repli {:.4})",
                    p.file, p.idx, x.repli_ms, x.geo_ms, x.repli_verts, x.repli_ratio
                );
            }
            let mut par_fichier: BTreeMap<&str, usize> = BTreeMap::new();
            for x in &t2_seul {
                *par_fichier.entry(x.0.file.as_str()).or_default() += 1;
            }
            println!("  pièces T2-seul par fichier :");
            for (f, k) in &par_fichier {
                println!("    {f} : {k}");
            }
        }
    }
}

#[test]
#[ignore = "mesure sur le corpus réel (NEST_C6_CORPUS)"]
fn corpus_reel() {
    let Ok(path) = std::env::var("NEST_C6_CORPUS") else {
        println!("NEST_C6_CORPUS non défini : mesure du corpus sautée");
        return;
    };
    let raw = std::fs::read_to_string(&path).expect("JSON du corpus");
    let v: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
    let pieces: Vec<Piece> = v
        .iter()
        .map(|o| Piece {
            file: o["file"].as_str().unwrap().to_owned(),
            idx: o["part"].as_u64().unwrap() as usize,
            ring: o["ring"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| (p[0].as_f64().unwrap() as f32, p[1].as_f64().unwrap() as f32))
                .collect(),
        })
        .collect();
    mesure_ensemble("CORPUS RÉEL (DXF -> import wasm -> simplifyRing)", &pieces, &[0.25, 0.5, 1.0, 1.5]);
}

/// Items des instances du banc, avec l'espacement de leur config quand il y en a une.
#[test]
#[ignore = "mesure sur les fixtures du banc"]
fn fixtures_du_banc() {
    let bench = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../bench/fixtures/");
    let lire = |f: &str| -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(format!("{bench}{f}")).expect(f)).unwrap()
    };
    let mut fichiers: Vec<String> = Vec::new();
    for e in std::fs::read_dir(bench).unwrap() {
        let e = e.unwrap();
        let n = e.file_name().to_string_lossy().into_owned();
        if e.path().is_dir() {
            for g in std::fs::read_dir(e.path()).unwrap() {
                let g = g.unwrap().file_name().to_string_lossy().into_owned();
                if g == "instance.json" || g == "merge_input.json" {
                    fichiers.push(format!("{n}/{g}"));
                }
            }
        } else if n.contains("instance") && n.ends_with(".json") {
            fichiers.push(n);
        }
    }
    fichiers.sort();
    let mut tous: Vec<Piece> = Vec::new();
    let mut vus: BTreeMap<String, f64> = BTreeMap::new();
    for f in &fichiers {
        let j = lire(f);
        let (inst, cfg) = if j.get("instance").is_some() {
            (j["instance"].clone(), j["engineConfig"].clone())
        } else {
            let dossier = f.rsplit_once('/').map(|x| x.0);
            let cfg = match dossier {
                Some(d) if std::path::Path::new(&format!("{bench}{d}/config_det.json")).exists() => {
                    lire(&format!("{d}/config_det.json"))
                }
                // grid_* et capsule* n'ont pas de config propre : grid_config.json.
                _ => lire("grid_config.json"),
            };
            (j, cfg)
        };
        let space = cfg["min_item_separation"].as_f64().unwrap_or(f64::NAN);
        vus.insert(f.clone(), space);
        for (k, it) in inst["items"].as_array().unwrap().iter().enumerate() {
            if it["shape"]["type"] != "simple_polygon" {
                continue;
            }
            tous.push(Piece {
                file: f.clone(),
                idx: k,
                ring: it["shape"]["data"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| (p[0].as_f64().unwrap() as f32, p[1].as_f64().unwrap() as f32))
                    .collect(),
            });
        }
    }
    for (f, s) in &vus {
        println!("{f} : espacement de la config = {s} (d = {})", s / 2.0);
    }
    // d = 1,0 est l'espacement réel de toutes ces configs (2 mm) ; 0,5 en plus.
    mesure_ensemble("FIXTURES DU BANC (toutes instances)", &tous, &[0.5, 1.0]);
}
