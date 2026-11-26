//! nest-report — réplique de workers/nesting/core/metrics.py (rapport de
//! nesting : comptabilité matière mesurée, offcut, verify_layout).
//! Dual-cible (natif + wasm). Parité valeurs contre goldens Python (J-072).

pub mod geom;
pub mod shape;
#[cfg(feature = "wasm")]
pub mod wasm;

use geom::Pt;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub coords: Vec<Pt>,
    #[serde(default)]
    pub holes: Vec<Vec<Pt>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transform {
    pub item_id: String,
    pub angle: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Container {
    pub bin_width: f64,
    pub bin_height: f64,
    pub transforms: Vec<Transform>,
    /// Tôle importée (contour + zones interdites), repère de la tôle. ADDITIF :
    /// absent = tôle rectangulaire, chemin d'avant strictement inchangé.
    #[serde(default)]
    pub shape: Option<shape::SheetShape>,
}

fn rotate_translate(ring: &[Pt], angle: f64, x: f64, y: f64) -> Vec<Pt> {
    let (c, s) = (libm::cos(angle), libm::sin(angle));
    ring.iter()
        .map(|p| [c * p[0] - s * p[1] + x, s * p[0] + c * p[1] + y])
        .collect()
}

fn placed(item: &Item, t: &Transform) -> (Vec<Pt>, Vec<Vec<Pt>>) {
    (
        rotate_translate(&item.coords, t.angle, t.x, t.y),
        item.holes
            .iter()
            .map(|h| rotate_translate(h, t.angle, t.x, t.y))
            .collect(),
    )
}

/// Arrondi décimal half-even comme Python `round(v, p)` (le formatage Rust
/// `{:.*}` est aussi half-even sur la représentation décimale du binaire).
fn round(v: f64, p: i32) -> f64 {
    format!("{:.*}", p as usize, v).parse::<f64>().unwrap_or(v)
}

/// per_sheet_metrics — comptabilité matière mesurée par tôle.
///
/// Tôle importée (`shape`) : `sheetAreaMm2` est l'aire UTILE (contour moins
/// zones interdites), jamais la boîte englobante, qui reste la TAILLE
/// (`widthMm` x `heightMm`) ; la chute rectangle n'a pas de sens sur une tôle
/// courbe : `offcut` reste null et le scan n'est pas lancé.
pub fn per_sheet_metrics(containers: &[Container], items: &[Item]) -> Vec<serde_json::Value> {
    let by_id: std::collections::HashMap<&str, &Item> =
        items.iter().map(|i| (i.id.as_str(), i)).collect();
    let mut sheets = Vec::new();
    for (index, c) in containers.iter().enumerate() {
        let ready = c.shape.as_ref().and_then(|s| s.ready());
        let sheet_area = match &ready {
            Some(r) => r.usable_area(),
            None => c.bin_width * c.bin_height,
        };
        let mut parts_area = 0.0;
        let mut part_count = 0;
        for t in &c.transforms {
            if let Some(item) = by_id.get(t.item_id.as_str()) {
                let (o, h) = placed(item, t);
                parts_area += geom::material_area(&o, &h);
                part_count += 1;
            }
        }
        let offcut = if c.shape.is_some() {
            None
        } else {
            largest_empty_rectangle(&[c.clone()], items)
        };
        let mut row = serde_json::json!({
            "index": index,
            "widthMm": round(c.bin_width, 3),
            "heightMm": round(c.bin_height, 3),
            "sheetAreaMm2": round(sheet_area, 1),
            "partsAreaMm2": round(parts_area, 1),
            "freeAreaMm2": round((sheet_area - parts_area).max(0.0), 1),
            "densityPct": if sheet_area > 0.0 { Some(round(parts_area / sheet_area * 100.0, 1)) } else { None },
            "partCount": part_count,
            "offcut": enrich_offcut(offcut.as_ref()),
        });
        if c.shape.is_some() {
            // Champs ADDITIFS, présents seulement pour une tôle importée.
            row["shaped"] = serde_json::json!(true);
            if let Some(r) = &ready {
                row["outlineAreaMm2"] = serde_json::json!(round(r.outline_area(), 1));
                row["zonesAreaMm2"] = serde_json::json!(round(r.zones_area(), 1));
            }
        }
        sheets.push(row);
    }
    sheets
}

/// report_totals — totaux inter-tôles + formats distincts.
pub fn report_totals(sheets: &[serde_json::Value]) -> serde_json::Value {
    let sheet_area: f64 = sheets.iter().map(|s| s["sheetAreaMm2"].as_f64().unwrap_or(0.0)).sum();
    let parts_area: f64 = sheets.iter().map(|s| s["partsAreaMm2"].as_f64().unwrap_or(0.0)).sum();
    // (largeur, hauteur, nombre, importée, aires) : une tôle importée ne se
    // confond pas avec un rectangle de même boîte, ni avec une autre forme de
    // même boîte (aires contour, zones et utile : trois signatures de la forme).
    let mut formats: Vec<(f64, f64, i64, bool, [f64; 3])> = Vec::new();
    for s in sheets {
        let w = s["widthMm"].as_f64().unwrap_or(0.0);
        let h = s["heightMm"].as_f64().unwrap_or(0.0);
        let shaped = s["shaped"].as_bool().unwrap_or(false);
        let sig = if shaped {
            [
                s["outlineAreaMm2"].as_f64().unwrap_or(-1.0),
                s["zonesAreaMm2"].as_f64().unwrap_or(-1.0),
                s["sheetAreaMm2"].as_f64().unwrap_or(-1.0),
            ]
        } else {
            [0.0; 3]
        };
        if let Some(e) = formats.iter_mut().find(|e| e.0 == w && e.1 == h && e.3 == shaped && e.4 == sig) {
            e.2 += 1;
        } else {
            formats.push((w, h, 1, shaped, sig));
        }
    }
    formats.sort_by(|a, b| (b.0 * b.1).partial_cmp(&(a.0 * a.1)).unwrap());
    let shaped_count = sheets.iter().filter(|s| s["shaped"].as_bool().unwrap_or(false)).count();
    let mut totals = serde_json::json!({
        "sheetCount": sheets.len(),
        "formats": formats.iter().map(|(w, h, n, shaped, _sig)| {
            let mut f = serde_json::json!({"widthMm": w, "heightMm": h, "count": n});
            if *shaped {
                f["shaped"] = serde_json::json!(true);
            }
            f
        }).collect::<Vec<_>>(),
        "sheetAreaMm2": round(sheet_area, 1),
        "partsAreaMm2": round(parts_area, 1),
        "freeAreaMm2": round((sheet_area - parts_area).max(0.0), 1),
        "densityPct": if sheet_area > 0.0 { Some(round(parts_area / sheet_area * 100.0, 1)) } else { None },
    });
    if shaped_count > 0 {
        totals["shapedSheetCount"] = serde_json::json!(shaped_count);
    }
    totals
}

/// compute_used_sheet_share.
pub fn compute_used_sheet_share(containers: &[Container], items: &[Item]) -> Option<f64> {
    let by_id: std::collections::HashMap<&str, &Item> =
        items.iter().map(|i| (i.id.as_str(), i)).collect();
    let mut bbox_total = 0.0;
    let mut sheet_total = 0.0;
    for c in containers {
        bbox_total += used_bbox_area(c, &by_id);
        // Clé de tri : la boîte de la tôle (jumeau JS usedSheetShareOf). Sur
        // l'aire utile, la part saturerait à 1 sur une tôle courbe.
        sheet_total += c.bin_width * c.bin_height;
    }
    if sheet_total <= 0.0 {
        return None;
    }
    Some((bbox_total / sheet_total).min(1.0))
}

fn used_bbox_area(c: &Container, by_id: &std::collections::HashMap<&str, &Item>) -> f64 {
    let (mut x0, mut y0) = (f64::INFINITY, f64::INFINITY);
    let (mut x1, mut y1) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    let mut any = false;
    for t in &c.transforms {
        if let Some(item) = by_id.get(t.item_id.as_str()) {
            let (o, _h) = placed(item, t);
            let b = geom::ring_bounds(&o);
            x0 = x0.min(b[0]);
            y0 = y0.min(b[1]);
            x1 = x1.max(b[2]);
            y1 = y1.max(b[3]);
            any = true;
        }
    }
    if !any {
        return 0.0;
    }
    (x1 - x0) * (y1 - y0)
}

pub const OFFCUT_REUSABLE_MIN_MM: f64 = 100.0;
pub const EXACT_OFFCUT_MAX_PARTS: usize = 60;
pub const EXACT_OFFCUT_MAX_VERTICES: usize = 600;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Offcut {
    pub width: f64,
    pub height: f64,
    pub area: f64,
}

pub fn enrich_offcut(o: Option<&Offcut>) -> serde_json::Value {
    match o {
        None => serde_json::Value::Null,
        Some(o) => serde_json::json!({
            "widthMm": round(o.width, 3),
            "heightMm": round(o.height, 3),
            "areaMm2": round(o.area, 1),
            "reusable": o.width.min(o.height) >= OFFCUT_REUSABLE_MIN_MM,
        }),
    }
}

fn band_offcut(
    containers: &[Container],
    by_id: &std::collections::HashMap<&str, &Item>,
) -> Option<Offcut> {
    let mut best: Option<Offcut> = None;
    for c in containers {
        let (sw, sh) = (c.bin_width, c.bin_height);
        if sw <= 0.0 || sh <= 0.0 || c.transforms.is_empty() {
            continue;
        }
        let (mut x0, mut y0) = (f64::INFINITY, f64::INFINITY);
        let (mut x1, mut y1) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
        let mut any = false;
        for t in &c.transforms {
            if let Some(item) = by_id.get(t.item_id.as_str()) {
                let b = geom::ring_bounds(&placed(item, t).0);
                x0 = x0.min(b[0]);
                y0 = y0.min(b[1]);
                x1 = x1.max(b[2]);
                y1 = y1.max(b[3]);
                any = true;
            }
        }
        if !any {
            continue;
        }
        for (w, h) in [(sw - x1, sh), (sw, sh - y1), (sw, y0), (x0, sh)] {
            let area = w * h;
            if w > 0.0 && h > 0.0 && best.as_ref().map_or(true, |b| area > b.area) {
                best = Some(Offcut { width: w, height: h, area });
            }
        }
    }
    best
}

/// largest_empty_rectangle — scan exact (petits layouts) sinon band offcut.
pub fn largest_empty_rectangle(containers: &[Container], items: &[Item]) -> Option<Offcut> {
    let by_id: std::collections::HashMap<&str, &Item> =
        items.iter().map(|i| (i.id.as_str(), i)).collect();
    let mut total_parts = 0;
    let mut total_vertices = 0;
    for c in containers {
        total_parts += c.transforms.len();
        for t in &c.transforms {
            if let Some(item) = by_id.get(t.item_id.as_str()) {
                total_vertices +=
                    item.coords.len() + item.holes.iter().map(|h| h.len()).sum::<usize>();
            }
        }
    }
    if total_parts > EXACT_OFFCUT_MAX_PARTS || total_vertices > EXACT_OFFCUT_MAX_VERTICES {
        return band_offcut(containers, &by_id);
    }

    let mut best: Option<Offcut> = None;
    let mut bailed = false;
    for c in containers {
        let (sw, sh) = (c.bin_width, c.bin_height);
        if sw <= 0.0 || sh <= 0.0 {
            continue;
        }
        let mut placed_polys: Vec<Vec<Pt>> = Vec::new();
        for t in &c.transforms {
            if let Some(item) = by_id.get(t.item_id.as_str()) {
                placed_polys.push(placed(item, t).0);
            }
        }
        // Candidats xs/ys = sommets de l'espace LIBRE (sheet − placed), comme
        // Python qui lit les coordonnées des anneaux du polygone free.
        let (mut xs, mut ys) = free_space_vertices(sw, sh, &placed_polys);
        xs.push(0.0);
        xs.push(sw);
        ys.push(0.0);
        ys.push(sh);
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        xs.dedup();
        ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
        ys.dedup();
        if xs.len() * ys.len() > 40_000 {
            bailed = true;
            break;
        }
        for i in 0..xs.len() {
            for j in (i + 1)..xs.len() {
                let (x1, x2) = (xs[i], xs[j]);
                if x2 - x1 <= 0.0 {
                    continue;
                }
                let mut blockers: Vec<(f64, f64)> = Vec::new();
                for poly in &placed_polys {
                    if geom::poly_intersects_rect(poly, x1, 0.0, x2, sh) {
                        let b = geom::ring_bounds(poly);
                        blockers.push((b[1], b[3]));
                    }
                }
                let span = if blockers.is_empty() {
                    sh
                } else {
                    blockers.sort_by(|a, b| a.partial_cmp(b).unwrap());
                    let mut merged: Vec<[f64; 2]> = vec![[blockers[0].0, blockers[0].1]];
                    for blk in &blockers[1..] {
                        let last = merged.len() - 1;
                        if blk.0 <= merged[last][1] {
                            merged[last][1] = merged[last][1].max(blk.1);
                        } else {
                            merged.push([blk.0, blk.1]);
                        }
                    }
                    let mut span = merged[0][0];
                    for k in 0..merged.len() - 1 {
                        span = span.max(merged[k + 1][0] - merged[k][1]);
                    }
                    span.max(sh - merged[merged.len() - 1][1])
                };
                let area = (x2 - x1) * span;
                if area > 0.0 && best.as_ref().map_or(true, |b| area > b.area) {
                    best = Some(Offcut { width: x2 - x1, height: span, area });
                }
            }
        }
    }
    if bailed {
        return band_offcut(containers, &by_id);
    }
    best
}

pub const VERIFY_MAX_PARTS_PER_SHEET: usize = 5000;
pub const OVERLAP_EPS_MM2: f64 = 0.01;
// Paire à distance 0 recouvrant >= 99 % de la plus petite = pose dupliquée.
pub const DUPLICATE_AREA_FRACTION: f64 = 0.99;
// Tolérance de couverture tôle : le lattice cale au bord avec du bruit
// flottant (A15, miroir Python INSIDE_EPS).
pub const INSIDE_EPS: f64 = 1e-6;

/// verify_layout — validation physique mesurée.
pub fn verify_layout(containers: &[Container], items: &[Item], space: f64) -> serde_json::Value {
    let by_id: std::collections::HashMap<&str, &Item> =
        items.iter().map(|i| (i.id.as_str(), i)).collect();
    let mut smallest_gap = f64::INFINITY;
    let mut overlap_free = true;
    let mut pair_checks_done = true;
    let mut inside_sheet = true;
    let mut holes_filled = 0i64;
    let mut holes_total = 0i64;
    let mut duplicate_poses = 0i64;
    // Tôle importée : contrôles sur la vraie forme (additifs, absents d'un job
    // à tôles rectangulaires — le rapport rendu y est identique octet pour octet).
    let mut shaped_sheets = 0i64;
    let mut shape_unready = false;
    let mut zones_total = 0i64;
    let mut shape_sum = shape::ShapeChecks::default();
    // Broadphase : les paires plus loin que space+1 mm ne peuvent être le
    // minimum (ni violer l'espacement) — on ne paie ring_distance que sur
    // les candidates bbox (A3/D12, miroir du STRtree Python).
    let search_r = (space + 1.0).max(1.0);

    for c in containers {
        let (sw, sh) = (c.bin_width, c.bin_height);
        let mut placed_polys: Vec<(Vec<Pt>, Vec<Vec<Pt>>)> = Vec::new();
        for t in &c.transforms {
            if let Some(item) = by_id.get(t.item_id.as_str()) {
                placed_polys.push(placed(item, t));
            }
        }
        // Forme de la tôle : un contour inexploitable ne se rabat pas sur la
        // boîte en silence (piège 60) — le rapport dit « non vérifié ».
        let ready = match &c.shape {
            Some(sp) => {
                shaped_sheets += 1;
                let r = sp.ready();
                if r.is_none() {
                    shape_unready = true;
                }
                r
            }
            None => None,
        };
        if let Some(r) = &ready {
            // La boîte englobante ne dit rien d'une tôle courbe : le contrôle
            // porte sur le contour réel et sur les zones interdites.
            let ck = shape::check_sheet(&placed_polys, r, OVERLAP_EPS_MM2);
            zones_total += r.zones.len() as i64;
            shape_sum.parts_outside += ck.parts_outside;
            shape_sum.zone_violations += ck.zone_violations;
            shape_sum.zone_overlap_area += ck.zone_overlap_area;
            if let Some(g) = ck.min_outline_gap {
                shape_sum.min_outline_gap = Some(shape_sum.min_outline_gap.map_or(g, |m| m.min(g)));
                if g < smallest_gap {
                    smallest_gap = g;
                }
            }
            if let Some(g) = ck.min_zone_gap {
                shape_sum.min_zone_gap = Some(shape_sum.min_zone_gap.map_or(g, |m| m.min(g)));
                // La zone interdite compte dans l'écart minimal comme le contour :
                // applySpacingMargin la juge contre l'espacement demandé.
                if g < smallest_gap {
                    smallest_gap = g;
                }
            }
            if ck.parts_outside > 0 {
                inside_sheet = false;
            }
        } else {
            for (o, _h) in &placed_polys {
                let b = geom::ring_bounds(o);
                if b[0] < -INSIDE_EPS
                    || b[1] < -INSIDE_EPS
                    || b[2] > sw + INSIDE_EPS
                    || b[3] > sh + INSIDE_EPS
                {
                    inside_sheet = false;
                }
            }
        }
        holes_total += placed_polys.iter().map(|(_o, h)| h.len() as i64).sum::<i64>();
        for (idx, (o, _h)) in placed_polys.iter().enumerate() {
            let cc = ring_centroid(o);
            for (host_idx, (_ho, hh)) in placed_polys.iter().enumerate() {
                if host_idx == idx {
                    continue;
                }
                if hh.iter().any(|hole| geom::point_in_ring(cc, hole)) {
                    holes_filled += 1;
                    break;
                }
            }
        }
        if placed_polys.len() > VERIFY_MAX_PARTS_PER_SHEET {
            pair_checks_done = false;
            continue;
        }
        let n = placed_polys.len();
        // Précalcul + ordre de balayage sur x min.
        let bounds: Vec<[f64; 4]> = placed_polys.iter().map(|(o, _)| geom::ring_bounds(o)).collect();
        let areas: Vec<f64> =
            placed_polys.iter().map(|(o, h)| geom::material_area(o, h)).collect();
        let mut order: Vec<usize> = (0..n).collect();
        order.sort_by(|&a, &b| bounds[a][0].partial_cmp(&bounds[b][0]).unwrap());
        for i in 0..n {
            // Tôle importée : l'écart au bord est celui du contour réel, déjà
            // compté plus haut (l'écart à la boîte serait un faux bord).
            if ready.is_none() {
                let gap_edge = ring_to_sheet_edge_dist(&placed_polys[i].0, sw, sh);
                if gap_edge < smallest_gap {
                    smallest_gap = gap_edge;
                }
            }
            let reach = bounds[i][2] + search_r;
            for &j in &order {
                if bounds[j][0] > reach {
                    break;
                }
                if j <= i {
                    continue;
                }
                if bounds[j][3] < bounds[i][1] - search_r || bounds[j][1] > bounds[i][3] + search_r {
                    continue;
                }
                // AGENTS #4 : le polygone placé = anneau externe MOINS les
                // trous. Une pièce nichée dans le trou d'un hôte ne chevauche
                // PAS le matériau de l'hôte : son espacement se mesure contre
                // la paroi du trou, pas contre l'anneau externe (matériau
                // fantôme → faux badge overlap / gap 0 côté Python si on ne
                // soustrait pas les trous ; ici on traite le cas explicitement).
                //
                // « i dans un trou de j » se décide par CONTENANCE de l'anneau entier
                // (ring_within_hole), pas par le centroïde : celui d'un L fin tombe dans
                // son encoche, donc dans la matière de l'hôte (B11). La contenance admet le
                // contact (paroi touchée, sommets sur la paroi) mais refuse tout bord qui
                // sort du trou ou toute matière qui y entre.
                // Quand l'un des côtés est établi par contenance, l'autre n'est pas cherché
                // au centroïde : deux cadres concentriques ne se chevauchent pas.
                let in_hole_of_j = placed_polys[j]
                    .1
                    .iter()
                    .find(|h| ring_within_hole(&placed_polys[i].0, h));
                let in_hole_of_i = if in_hole_of_j.is_some() {
                    None
                } else {
                    placed_polys[i]
                        .1
                        .iter()
                        .find(|h| ring_within_hole(&placed_polys[j].0, h))
                };
                let (nested, hole) = match (in_hole_of_j, in_hole_of_i) {
                    (Some(h), _) => (Some(i), Some(h)),
                    (None, Some(h)) => (Some(j), Some(h)),
                    _ => (None, None),
                };
                if let (Some(n), Some(h)) = (nested, hole) {
                    // Pièce nichée : l'écart se mesure à la paroi du trou.
                    let g = geom::ring_gap(&placed_polys[n].0, h);
                    if g < smallest_gap {
                        smallest_gap = g;
                    }
                    continue;
                }
                // Non contenue : ou bien les contours sont disjoints (écart vrai), ou
                // bien ils se touchent, se croisent ou s'emboîtent, et seule l'aire
                // commune des deux matières décide. Le centre d'une pièce ne dit rien :
                // celui d'un C tombe dans le trou d'une pièce posée dans son creux, sans
                // qu'elles se touchent.
                let d = geom::ring_distance(&placed_polys[i].0, &placed_polys[j].0);
                if d < smallest_gap {
                    smallest_gap = d;
                }
                if d <= CONTACT_EPS_MM {
                    match shape::material_overlap(&placed_polys[i], &placed_polys[j]) {
                        Some(inter) => {
                            if inter > OVERLAP_EPS_MM2 {
                                overlap_free = false;
                            }
                            if inter > DUPLICATE_AREA_FRACTION * areas[i].min(areas[j]) {
                                duplicate_poses += 1;
                            }
                        }
                        // Aire non fiable (bords presque confondus) : recouvrement,
                        // compté comme un recouvrement ; pas de doublon sans aire connue.
                        None => overlap_free = false,
                    }
                }
            }
        }
    }

    let mut report = serde_json::json!({
        "smallestGapMm": serde_json::Value::Null,
        "overlapFree": serde_json::Value::Null,
        "insideSheet": inside_sheet,
        "spacingOk": serde_json::Value::Null,
        "holesFilled": holes_filled,
        "holesTotal": holes_total,
        "holesOverflow": 0i64,
        "duplicatePoses": duplicate_poses,
        "verifyStatus": if pair_checks_done { "measured" } else { "skipped" },
    });
    if pair_checks_done && smallest_gap != f64::INFINITY {
        report["smallestGapMm"] = serde_json::json!(round(smallest_gap, 3));
        report["overlapFree"] = serde_json::json!(overlap_free);
        report["spacingOk"] = serde_json::json!(smallest_gap >= (space - 0.01));
    }
    if shaped_sheets > 0 {
        // Champs ADDITIFS (piège 19b) : seules les tôles importées les portent.
        report["shapedSheets"] = serde_json::json!(shaped_sheets);
        report["shapeVerified"] = serde_json::json!(!shape_unready);
        report["partsOutsideOutline"] = serde_json::json!(shape_sum.parts_outside);
        report["minDistToOutlineMm"] = match shape_sum.min_outline_gap {
            Some(g) => serde_json::json!(round(g, 3)),
            None => serde_json::Value::Null,
        };
        report["zonesChecked"] = serde_json::json!(zones_total);
        report["zoneViolations"] = serde_json::json!(shape_sum.zone_violations);
        report["zoneOverlapAreaMm2"] = serde_json::json!(round(shape_sum.zone_overlap_area, 3));
        report["minDistToZoneMm"] = match shape_sum.min_zone_gap {
            Some(g) => serde_json::json!(round(g, 3)),
            None => serde_json::Value::Null,
        };
        report["zoneClear"] = if shape_unready || zones_total == 0 {
            serde_json::Value::Null
        } else {
            serde_json::json!(shape_sum.zone_violations == 0)
        };
        if shape_unready {
            // Jamais vert sur une forme qu'on n'a pas pu lire.
            report["insideSheet"] = serde_json::Value::Null;
            report["verifyStatus"] = serde_json::json!("skipped");
        }
    }
    report
}

fn ring_centroid(ring: &[Pt]) -> Pt {
    let mut a = 0.0;
    let mut cx = 0.0;
    let mut cy = 0.0;
    for i in 0..ring.len() - 1 {
        let cr = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        a += cr;
        cx += (ring[i][0] + ring[i + 1][0]) * cr;
        cy += (ring[i][1] + ring[i + 1][1]) * cr;
    }
    a /= 2.0;
    if a.abs() < 1e-12 {
        return ring[0];
    }
    [cx / (6.0 * a), cy / (6.0 * a)]
}

fn ring_to_sheet_edge_dist(ring: &[Pt], sw: f64, sh: f64) -> f64 {
    let b = geom::ring_bounds(ring);
    b[0].min(b[1]).min(sw - b[2]).min(sh - b[3])
}

const WITHIN_EPS: f64 = 1e-7;

/// Contours au contact : sous cet écart, l'aire commune est mesurée (une pièce
/// posée bord à bord DANS une autre n'est pas vue par le test des arêtes).
const CONTACT_EPS_MM: f64 = 1e-6;

/// Point dans le trou, bord compris (tolérance WITHIN_EPS).
fn point_in_closed_ring(p: Pt, ring: &[Pt]) -> bool {
    for w in ring.windows(2) {
        if geom::point_seg_dist(p, w[0], w[1]) <= WITHIN_EPS {
            return true;
        }
    }
    geom::point_in_ring(p, ring)
}

/// Paramètres t (0..1) où l'arête a-b est coupée par l'anneau `ring` :
/// sommets de l'anneau posés sur l'arête et croisements d'arêtes.
fn edge_split_params(a: Pt, b: Pt, ring: &[Pt]) -> Vec<f64> {
    let mut ts = vec![0.0, 1.0];
    let ab = [b[0] - a[0], b[1] - a[1]];
    let l2 = ab[0] * ab[0] + ab[1] * ab[1];
    if l2 == 0.0 {
        return ts;
    }
    for p in ring {
        if geom::point_seg_dist(*p, a, b) <= WITHIN_EPS {
            let t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2;
            ts.push(t.clamp(0.0, 1.0));
        }
    }
    for w in ring.windows(2) {
        let cd = [w[1][0] - w[0][0], w[1][1] - w[0][1]];
        let den = ab[0] * cd[1] - ab[1] * cd[0];
        if den == 0.0 {
            continue;
        }
        let ac = [w[0][0] - a[0], w[0][1] - a[1]];
        let t = (ac[0] * cd[1] - ac[1] * cd[0]) / den;
        let u = (ac[0] * ab[1] - ac[1] * ab[0]) / den;
        if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) {
            ts.push(t);
        }
    }
    ts.sort_by(|x, y| x.partial_cmp(y).unwrap());
    ts
}

/// `inner` entièrement contenu dans `hole`, contact admis : le bord de `inner`,
/// découpé à chaque sommet ou croisement du trou, reste partout dans le trou
/// fermé (milieu de chaque tronçon). Le trou étant un anneau simple, le bord
/// dedans suffit pour que l'intérieur y soit : la pièce ne recouvre aucune
/// matière de l'hôte (AGENTS #4). Un contact (sommet sur arête, arêtes
/// colinéaires) ne la fait pas sortir ; une pointe de matière qui entre ou un
/// bord qui sort, si.
fn ring_within_hole(inner: &[Pt], hole: &[Pt]) -> bool {
    for w in inner.windows(2) {
        let ts = edge_split_params(w[0], w[1], hole);
        for k in 0..ts.len() - 1 {
            let (t0, t1) = (ts[k], ts[k + 1]);
            if t1 - t0 <= 1e-12 {
                continue;
            }
            let tm = 0.5 * (t0 + t1);
            let m = [w[0][0] + tm * (w[1][0] - w[0][0]), w[0][1] + tm * (w[1][1] - w[0][1])];
            if !point_in_closed_ring(m, hole) {
                return false;
            }
        }
    }
    true
}

/// Sommets de l'espace libre (sheet − placed) via l'arrangement partagé
/// (nest_import::assemble) — jumeau de `sheet.difference(unary_union(placed))`.
fn free_space_vertices(sw: f64, sh: f64, placed_polys: &[Vec<Pt>]) -> (Vec<f64>, Vec<f64>) {
    use nest_import::assemble as ga;
    let mut edges: Vec<(Pt, Pt)> = Vec::new();
    let sheet = [[0.0, 0.0], [sw, 0.0], [sw, sh], [0.0, sh], [0.0, 0.0]];
    for w in sheet.windows(2) {
        edges.push((w[0], w[1]));
    }
    for poly in placed_polys {
        if poly.len() >= 2 {
            let closed = if poly.first() == poly.last() { poly.to_vec() } else {
                let mut p = poly.to_vec();
                p.push(poly[0]);
                p
            };
            for w in closed.windows(2) {
                edges.push((w[0], w[1]));
            }
        }
    }
    let noded = ga::node_segments(&edges);
    let faces = ga::polygonize(&[], &noded);
    let mut xs = Vec::new();
    let mut ys = Vec::new();
    for f in &faces {
        if ga::ring_signed_area(f) <= 1e-12 {
            continue;
        }
        let c = face_centroid(f);
        let in_placed = placed_polys.iter().any(|p| geom::point_in_ring(c, p));
        if in_placed {
            continue;
        }
        for p in f {
            xs.push(p[0]);
            ys.push(p[1]);
        }
    }
    (xs, ys)
}

fn face_centroid(ring: &[Pt]) -> Pt {
    let n = ring.len();
    let mut a = 0.0;
    let mut cx = 0.0;
    let mut cy = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        let cr = ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
        a += cr;
        cx += (ring[i][0] + ring[j][0]) * cr;
        cy += (ring[i][1] + ring[j][1]) * cr;
    }
    a /= 2.0;
    if a.abs() < 1e-12 {
        return ring[0];
    }
    [cx / (6.0 * a), cy / (6.0 * a)]
}

#[cfg(test)]
mod shaped_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_matches_python() {
        // Goldens CPython round().
        assert_eq!(round(2.675, 2), 2.67); // Python round(2.675,2)=2.67 (float)
        assert_eq!(round(0.5, 0), 0.0); // half-even
        assert_eq!(round(1.5, 0), 2.0);
        assert_eq!(round(123.456, 1), 123.5);
        assert_eq!(round(41231.25, 1), 41231.2); // half-even au .1
        assert_eq!(round(2.5, 0), 2.0);
    }

    #[test]
    fn per_sheet_area_simple() {
        let items = vec![Item {
            id: "a".into(),
            coords: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
            holes: vec![],
        }];
        let c = Container {
            bin_width: 100.0,
            bin_height: 100.0,
            transforms: vec![Transform { item_id: "a".into(), angle: 0.0, x: 0.0, y: 0.0 }],
            ..Default::default()
        };
        let sheets = per_sheet_metrics(&[c], &items);
        assert_eq!(sheets[0]["partsAreaMm2"], serde_json::json!(100.0));
        assert_eq!(sheets[0]["densityPct"], serde_json::json!(1.0));
        assert_eq!(sheets[0]["partCount"], serde_json::json!(1));
    }

    #[test]
    fn used_share_and_totals() {
        let items = vec![Item {
            id: "a".into(),
            coords: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
            holes: vec![],
        }];
        let c = Container {
            bin_width: 100.0,
            bin_height: 100.0,
            transforms: vec![Transform { item_id: "a".into(), angle: 0.0, x: 0.0, y: 0.0 }],
            ..Default::default()
        };
        let share = compute_used_sheet_share(&[c.clone()], &items).unwrap();
        assert!((share - 0.01).abs() < 1e-9, "share={share}");
        let sheets = per_sheet_metrics(&[c], &items);
        let totals = report_totals(&sheets);
        assert_eq!(totals["sheetCount"], serde_json::json!(1));
    }

    // AGENTS #4 : une pièce nichée dans le trou d'un hôte ne chevauche PAS
    // le matériau de l'hôte (l'anneau externe seul la ferait « intersecter »
    // le matériau fantôme → faux badges overlap/gap 0).
    #[test]
    fn verify_filler_in_hole_is_not_an_overlap() {
        // Hôte 100×100 avec un trou 40×40 centré ; filler 20×20 au centre
        // du trou (écart 10 mm avec chaque paroi).
        let items = vec![
            Item {
                id: "host".into(),
                coords: vec![[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0], [0.0, 0.0]],
                holes: vec![vec![
                    [30.0, 30.0], [70.0, 30.0], [70.0, 70.0], [30.0, 70.0], [30.0, 30.0],
                ]],
            },
            Item {
                id: "filler".into(),
                coords: vec![[0.0, 0.0], [20.0, 0.0], [20.0, 20.0], [0.0, 20.0], [0.0, 0.0]],
                holes: vec![],
            },
        ];
        let c = Container {
            bin_width: 200.0,
            bin_height: 200.0,
            transforms: vec![
                // À 10 mm des bords pour que le plus petit écart mesuré soit
                // celui filler↔paroi du trou (pas filler/paroi ↔ bord tôle).
                Transform { item_id: "host".into(), angle: 0.0, x: 10.0, y: 10.0 },
                Transform { item_id: "filler".into(), angle: 0.0, x: 50.0, y: 50.0 },
            ],
            ..Default::default()
        };
        let r = verify_layout(&[c], &items, 2.0);
        assert_eq!(r["overlapFree"], serde_json::json!(true), "{r}");
        assert_eq!(r["holesFilled"], serde_json::json!(1), "{r}");
        // Écart filler ↔ paroi du trou = 10 mm (pas 0).
        assert_eq!(r["smallestGapMm"], serde_json::json!(10.0), "{r}");
        assert_eq!(r["spacingOk"], serde_json::json!(true), "{r}");
    }

    // Le filler qui DÉBORDE du trou reste un vrai chevauchement.
    #[test]
    fn verify_filler_spilling_out_of_hole_is_an_overlap() {
        let items = vec![
            Item {
                id: "host".into(),
                coords: vec![[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0], [0.0, 0.0]],
                holes: vec![vec![
                    [30.0, 30.0], [70.0, 30.0], [70.0, 70.0], [30.0, 70.0], [30.0, 30.0],
                ]],
            },
            Item {
                id: "big".into(),
                coords: vec![[0.0, 0.0], [60.0, 0.0], [60.0, 60.0], [0.0, 60.0], [0.0, 0.0]],
                holes: vec![],
            },
        ];
        let c = Container {
            bin_width: 200.0,
            bin_height: 200.0,
            transforms: vec![
                Transform { item_id: "host".into(), angle: 0.0, x: 0.0, y: 0.0 },
                // Centré dans le trou mais plus grand que lui → déborde.
                Transform { item_id: "big".into(), angle: 0.0, x: 20.0, y: 20.0 },
            ],
            ..Default::default()
        };
        let r = verify_layout(&[c], &items, 2.0);
        assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
    }

    // A3/D12 : une tôle de 600 pièces est MESURÉE (plus de plafond 250) et
    // une pose dupliquée est comptée — c'est le filet qui manquait au cas
    // 100+800 (overlapFree/spacingOk null + aucune détection de doublon).
    #[test]
    fn verify_large_sheet_measured_and_duplicate_counted() {
        let items = vec![Item {
            id: "a".into(),
            coords: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
            holes: vec![],
        }];
        // Grille 30×20 = 600 pièces, pas 2 mm (10 + 2), sur 1000×700.
        let mut transforms = Vec::new();
        for j in 0..20 {
            for i in 0..30 {
                transforms.push(Transform {
                    item_id: "a".into(),
                    angle: 0.0,
                    x: i as f64 * 12.0 + 2.0,
                    y: j as f64 * 12.0 + 2.0,
                });
            }
        }
        // Doublon : même pièce re-posée sur la case (2,2) → distance 0,
        // recouvrement 100 %.
        transforms.push(Transform { item_id: "a".into(), angle: 0.0, x: 2.0, y: 2.0 });
        let c = Container { bin_width: 1000.0, bin_height: 700.0, transforms, ..Default::default() };
        let r = verify_layout(&[c], &items, 2.0);
        assert_eq!(r["verifyStatus"], serde_json::json!("measured"), "{r}");
        assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
        assert_eq!(r["duplicatePoses"], serde_json::json!(1), "{r}");
        assert_eq!(r["smallestGapMm"], serde_json::json!(0.0), "{r}");
        assert_eq!(r["spacingOk"], serde_json::json!(false), "{r}");
    }

    // Sans le doublon, la même tôle mesure l'écart réel (2.0) — le
    // broadphase sweep ne doit pas rater les paires proches.
    #[test]
    fn verify_large_sheet_measures_real_gap() {
        let items = vec![Item {
            id: "a".into(),
            coords: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
            holes: vec![],
        }];
        let mut transforms = Vec::new();
        for j in 0..20 {
            for i in 0..30 {
                transforms.push(Transform {
                    item_id: "a".into(),
                    angle: 0.0,
                    x: i as f64 * 12.0 + 2.0,
                    y: j as f64 * 12.0 + 2.0,
                });
            }
        }
        let c = Container { bin_width: 1000.0, bin_height: 700.0, transforms, ..Default::default() };
        let r = verify_layout(&[c], &items, 2.0);
        assert_eq!(r["verifyStatus"], serde_json::json!("measured"), "{r}");
        assert_eq!(r["smallestGapMm"], serde_json::json!(2.0), "{r}");
        assert_eq!(r["spacingOk"], serde_json::json!(true), "{r}");
        assert_eq!(r["duplicatePoses"], serde_json::json!(0), "{r}");
    }

    // ---- Pièce en L dans un trou en L (B11). Valeurs de référence : shapely, par
    // `metrics.verify_layout` du worker nesting, sur les mêmes anneaux, tôle 200 x 200,
    // espacement 2, hôte et pièce posés en (20 ; 20).
    //   L dans le trou          : smallestGapMm 2.0, overlapFree true,  duplicatePoses 0
    //   L qui mord la matière   : smallestGapMm 0.0, overlapFree false, duplicatePoses 0
    //   carré sur la matière    : smallestGapMm 0.0, overlapFree false, duplicatePoses 1
    // Le centroïde du L fin (33,2 ; 33,2) tombe dans l'encoche du trou, donc dans la matière
    // de l'hôte : il ne dit pas que la pièce est dans le trou.

    fn closed(mut ring: Vec<Pt>) -> Vec<Pt> {
        ring.push(ring[0]);
        ring
    }

    fn l_hole_host() -> Item {
        Item {
            id: "host".into(),
            coords: closed(vec![[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]]),
            holes: vec![closed(vec![
                [10.0, 10.0], [90.0, 10.0], [90.0, 30.0], [30.0, 30.0], [30.0, 90.0], [10.0, 90.0],
            ])],
        }
    }

    fn thin_l(dx: f64) -> Item {
        Item {
            id: "in".into(),
            coords: closed(vec![
                [12.0 + dx, 12.0], [88.0 + dx, 12.0], [88.0 + dx, 18.0],
                [18.0 + dx, 18.0], [18.0 + dx, 88.0], [12.0 + dx, 88.0],
            ]),
            holes: vec![],
        }
    }

    fn pair_report(other: Item) -> serde_json::Value {
        let c = Container {
            bin_width: 200.0,
            bin_height: 200.0,
            transforms: vec![
                Transform { item_id: "host".into(), angle: 0.0, x: 20.0, y: 20.0 },
                Transform { item_id: other.id.clone(), angle: 0.0, x: 20.0, y: 20.0 },
            ],
            ..Default::default()
        };
        verify_layout(&[c], &[l_hole_host(), other], 2.0)
    }

    #[test]
    fn an_l_part_inside_an_l_hole_is_not_an_overlap() {
        let r = pair_report(thin_l(0.0));
        assert_eq!(r["overlapFree"], serde_json::json!(true), "{r}");
        assert_eq!(r["smallestGapMm"], serde_json::json!(2.0), "{r}");
        assert_eq!(r["spacingOk"], serde_json::json!(true), "{r}");
        assert_eq!(r["duplicatePoses"], serde_json::json!(0), "{r}");
    }

    #[test]
    fn an_l_part_biting_into_the_host_material_is_still_an_overlap() {
        // Décalée de 5 mm vers la gauche : ses sommets (7 ; 12) passent la paroi du trou.
        let r = pair_report(thin_l(-5.0));
        assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
        assert_eq!(r["smallestGapMm"], serde_json::json!(0.0), "{r}");
        assert_eq!(r["spacingOk"], serde_json::json!(false), "{r}");
    }

    #[test]
    fn a_part_lying_on_the_host_material_is_still_an_overlap() {
        let square = Item {
            id: "sq".into(),
            coords: closed(vec![[92.0, 92.0], [98.0, 92.0], [98.0, 98.0], [92.0, 98.0]]),
            holes: vec![],
        };
        let r = pair_report(square);
        assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
        assert_eq!(r["smallestGapMm"], serde_json::json!(0.0), "{r}");
        assert_eq!(r["duplicatePoses"], serde_json::json!(1), "{r}");
    }

    #[test]
    fn the_order_of_the_pair_does_not_matter() {
        // La même paire, pièce posée avant l'hôte : le sens i / j s'inverse.
        let other = thin_l(0.0);
        let c = Container {
            bin_width: 200.0,
            bin_height: 200.0,
            transforms: vec![
                Transform { item_id: other.id.clone(), angle: 0.0, x: 20.0, y: 20.0 },
                Transform { item_id: "host".into(), angle: 0.0, x: 20.0, y: 20.0 },
            ],
            ..Default::default()
        };
        let r = verify_layout(&[c], &[l_hole_host(), other], 2.0);
        assert_eq!(r["overlapFree"], serde_json::json!(true), "{r}");
        assert_eq!(r["smallestGapMm"], serde_json::json!(2.0), "{r}");
    }

    // ---- Contacts et cadres concentriques. Valeurs de référence : shapely
    // (Polygon(ext, trous).intersection / .distance) sur les mêmes anneaux fermés,
    // tôle 300 x 300, pose commune en (50 ; 50) pour que le bord de tôle (50 mm)
    // ne masque pas l'écart mesuré.

    fn square(id: &str, x0: f64, y0: f64, x1: f64, y1: f64) -> Item {
        Item {
            id: id.into(),
            coords: closed(vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]]),
            holes: vec![],
        }
    }

    fn frame100() -> Item {
        Item {
            id: "host".into(),
            coords: closed(vec![[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]]),
            holes: vec![closed(vec![[10.0, 10.0], [90.0, 10.0], [90.0, 90.0], [10.0, 90.0]])],
        }
    }

    fn same_pose_report(a: Item, b: Item, space: f64) -> serde_json::Value {
        let c = Container {
            bin_width: 300.0,
            bin_height: 300.0,
            transforms: vec![
                Transform { item_id: a.id.clone(), angle: 0.0, x: 50.0, y: 50.0 },
                Transform { item_id: b.id.clone(), angle: 0.0, x: 50.0, y: 50.0 },
            ],
            ..Default::default()
        };
        verify_layout(&[c], &[a, b], space)
    }

    #[test]
    fn a_washer_in_the_hollow_of_a_c_is_not_an_overlap() {
        // Le centre du C (dans son creux) tombe dans le trou de la rondelle carrée.
        // shapely : intersection 0, distance 1.116.
        let c = Item {
            id: "c".into(),
            coords: closed(vec![
                [0.0, 0.0], [60.0, 0.0], [60.0, 6.0], [6.0, 6.0], [6.0, 54.0], [60.0, 54.0],
                [60.0, 60.0], [0.0, 60.0],
            ]),
            holes: vec![],
        };
        let washer = |x0: f64, id: &str| Item {
            id: id.into(),
            coords: closed(vec![[x0, 12.0], [x0 + 36.0, 12.0], [x0 + 36.0, 48.0], [x0, 48.0]]),
            holes: vec![closed(vec![
                [x0 + 4.0, 16.0], [x0 + 32.0, 16.0], [x0 + 32.0, 44.0], [x0 + 4.0, 44.0],
            ])],
        };
        let o = ring_centroid(&c.coords);
        assert!(geom::point_in_ring(o, &washer(7.116, "w").holes[0]), "précondition {o:?}");
        for swap in [false, true] {
            let (a, b) = (c.clone(), washer(7.116, "w"));
            let r = if swap { same_pose_report(b, a, 1.0) } else { same_pose_report(a, b, 1.0) };
            assert_eq!(r["overlapFree"], serde_json::json!(true), "{r}");
            assert_eq!(r["smallestGapMm"], serde_json::json!(1.116), "{r}");
            assert_eq!(r["spacingOk"], serde_json::json!(true), "{r}");
            assert_eq!(r["duplicatePoses"], serde_json::json!(0), "{r}");
        }
        // La même rondelle enfoncée de 0,5 mm dans l'âme du C : 0,5 x 36 = 18 mm2.
        let r = same_pose_report(c, washer(5.5, "w"), 1.0);
        assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
        assert_eq!(r["smallestGapMm"], serde_json::json!(0.0), "{r}");
        assert_eq!(r["duplicatePoses"], serde_json::json!(0), "{r}");
    }

    #[test]
    fn two_parts_of_the_same_shape_on_the_same_place_are_an_overlap() {
        // Bords confondus : aucune arête ne croise, aucun sommet n'est dedans.
        for pose in [0.0, 0.3, 1.234] {
            let mut items = [frame100(), frame100()];
            items[1].id = "twin".into();
            let c = Container {
                bin_width: 400.0,
                bin_height: 400.0,
                transforms: items
                    .iter()
                    .map(|i| Transform { item_id: i.id.clone(), angle: pose, x: 200.0, y: 200.0 })
                    .collect(),
                ..Default::default()
            };
            let r = verify_layout(&[c], &items, 1.0);
            assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
            assert_eq!(r["duplicatePoses"], serde_json::json!(1), "{r}");
        }
    }

    #[test]
    fn a_part_inside_another_one_along_its_edge_is_an_overlap() {
        // shapely : intersection 1000 mm2 (la pièce entière).
        let r = same_pose_report(square("big", 0.0, 0.0, 100.0, 100.0), square("in", 0.0, 30.0, 50.0, 50.0), 0.0);
        assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
        assert_eq!(r["duplicatePoses"], serde_json::json!(1), "{r}");
    }

    #[test]
    fn two_parts_crossing_by_a_corner_are_not_a_duplicate() {
        // shapely : intersection 100 mm2 sur 2500.
        let r = same_pose_report(square("a", 0.0, 0.0, 50.0, 50.0), square("b", 40.0, 40.0, 90.0, 90.0), 0.0);
        assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
        assert_eq!(r["duplicatePoses"], serde_json::json!(0), "{r}");
    }

    #[test]
    fn a_part_touching_the_hole_through_its_vertices_still_covers_host_material() {
        // Trou à pointe de matière (45;10)-(50;60)-(55;10) ; pièce (20;10)-(80;80).
        // shapely : intersection 250.0 mm2, distance 0.0 -> chevauchement réel.
        let host = Item {
            id: "host".into(),
            coords: closed(vec![[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]]),
            holes: vec![closed(vec![
                [10.0, 10.0], [45.0, 10.0], [50.0, 60.0], [55.0, 10.0],
                [90.0, 10.0], [90.0, 90.0], [10.0, 90.0],
            ])],
        };
        let r = same_pose_report(host, square("in", 20.0, 10.0, 80.0, 80.0), 0.0);
        assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
        assert_eq!(r["smallestGapMm"], serde_json::json!(0.0), "{r}");
    }

    #[test]
    fn concentric_frames_do_not_overlap() {
        // shapely : intersection 0.0 mm2, distance 10.0 (grand cadre / petit cadre).
        let small = Item {
            id: "small".into(),
            coords: closed(vec![[20.0, 20.0], [80.0, 20.0], [80.0, 80.0], [20.0, 80.0]]),
            holes: vec![closed(vec![[30.0, 30.0], [70.0, 30.0], [70.0, 70.0], [30.0, 70.0]])],
        };
        let r = same_pose_report(frame100(), small, 2.0);
        assert_eq!(r["overlapFree"], serde_json::json!(true), "{r}");
        assert_eq!(r["smallestGapMm"], serde_json::json!(10.0), "{r}");
        assert_eq!(r["duplicatePoses"], serde_json::json!(0), "{r}");
    }

    #[test]
    fn a_part_straddling_the_hole_edge_is_an_overlap() {
        // Pièce (70;40)-(110;60) : moitié dans le trou (x < 90), moitié sur la matière.
        // shapely : intersection 200.0 mm2, distance 0.0.
        let r = same_pose_report(frame100(), square("in", 70.0, 40.0, 110.0, 60.0), 0.0);
        assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
        assert_eq!(r["smallestGapMm"], serde_json::json!(0.0), "{r}");
    }

    #[test]
    fn a_part_strictly_inside_a_convex_hole_measures_the_wall_gap() {
        // Pièce (15;15)-(85;85) dans le trou (10;10)-(90;90). shapely : distance 5.0, inter 0.
        let r = same_pose_report(frame100(), square("in", 15.0, 15.0, 85.0, 85.0), 2.0);
        assert_eq!(r["overlapFree"], serde_json::json!(true), "{r}");
        assert_eq!(r["smallestGapMm"], serde_json::json!(5.0), "{r}");
        assert_eq!(r["spacingOk"], serde_json::json!(true), "{r}");
    }

    #[test]
    fn a_part_touching_the_hole_wall_is_allowed_only_at_spacing_zero() {
        // Pièce (10;20)-(50;50) collée à la paroi x = 10. shapely : intersection 0.0, distance 0.0.
        let r0 = same_pose_report(frame100(), square("in", 10.0, 20.0, 50.0, 50.0), 0.0);
        assert_eq!(r0["overlapFree"], serde_json::json!(true), "{r0}");
        assert_eq!(r0["smallestGapMm"], serde_json::json!(0.0), "{r0}");
        assert_eq!(r0["spacingOk"], serde_json::json!(true), "{r0}");
        let r2 = same_pose_report(frame100(), square("in", 10.0, 20.0, 50.0, 50.0), 2.0);
        assert_eq!(r2["overlapFree"], serde_json::json!(true), "{r2}");
        assert_eq!(r2["spacingOk"], serde_json::json!(false), "{r2}");
    }

    #[test]
    fn two_identical_parts_at_the_same_pose_are_a_duplicate() {
        // Deux carrés 60 x 60 identiques. shapely : intersection 3600.0 mm2 = 100 % de l'aire.
        let r = same_pose_report(
            square("a", 0.0, 0.0, 60.0, 60.0),
            square("b", 0.0, 0.0, 60.0, 60.0),
            2.0,
        );
        assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
        assert_eq!(r["duplicatePoses"], serde_json::json!(1), "{r}");
    }

    // ---- Bords presque confondus (relecture du 25/11). À ~1e-7 mm d'un bord,
    // un tronçon de contour était dit « sur le bord » à un endroit et pas à
    // l'autre : l'aire de Green sortait négative, coupée à 0, donc « pas de
    // recouvrement ». Vérités : shapely (intersection, distance) sur les mêmes
    // anneaux ; poses telles quelles (angle 0, x 0, y 0), dans les deux ordres.

    fn raw_item(id: &str, coords: &[Pt], holes: &[&[Pt]]) -> Item {
        Item { id: id.into(), coords: coords.to_vec(), holes: holes.iter().map(|h| h.to_vec()).collect() }
    }

    /// Rapports de la paire dans les deux ordres de pose.
    fn both_orders(a: &Item, b: &Item, space: f64) -> [serde_json::Value; 2] {
        let one = |x: &Item, y: &Item| {
            let c = Container {
                bin_width: 4000.0,
                bin_height: 4000.0,
                transforms: [x, y]
                    .iter()
                    .map(|i| Transform { item_id: i.id.clone(), angle: 0.0, x: 0.0, y: 0.0 })
                    .collect(),
                ..Default::default()
            };
            verify_layout(&[c], &[x.clone(), y.clone()], space)
        };
        [one(a, b), one(b, a)]
    }

    #[test]
    fn a_strip_inside_a_plate_one_edge_1e7_from_its_side_is_an_overlap() {
        // Plaque 248 x 53, languette 2,78 x 45,45 dans sa matière, bord droit à
        // ~1e-7 mm du sien. shapely : intersection 126,6 mm2 (toute la languette).
        let plate = raw_item("plate", &[
            [1866.0441594890724, 2661.0499764377946], [1618.0441594890724, 2661.0499764377946],
            [1618.0441594890724, 2608.0499764377946], [1866.0441594890724, 2608.0499764377946],
            [1866.0441594890724, 2661.0499764377946],
        ], &[]);
        let strip = raw_item("strip", &[
            [1866.0441593960263, 2608.0499764377946], [1866.0441593828707, 2653.5044272047626],
            [1863.2598924381628, 2653.5044272047626], [1863.2598924381628, 2608.0499764377946],
            [1866.0441593960263, 2608.0499764377946],
        ], &[]);
        for r in both_orders(&plate, &strip, 0.0) {
            assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
        }
        // Même garde pour une zone interdite de tôle, dans les deux rôles.
        let z1 = shape::material_zone_overlap(&plate.coords, &[], &strip.coords);
        let z2 = shape::material_zone_overlap(&strip.coords, &[], &plate.coords);
        assert!(z1.is_none_or(|a| a > OVERLAP_EPS_MM2), "{z1:?}");
        assert!(z2.is_none_or(|a| a > OVERLAP_EPS_MM2), "{z2:?}");
    }

    #[test]
    fn a_sliver_seen_on_the_edge_in_both_orders_does_not_hide_a_real_overlap() {
        // Paire construite par la relecture (91100001) : un bord croise l'autre sous
        // un angle infime ; le même tronçon est perdu dans les deux ordres, l'aire
        // fausse reste dans les bornes. shapely (grille 1e-9) : 1,131 mm2 communs.
        let a = raw_item("a", &[
            [1682.0524910637118, 3140.893513306419], [1682.0524910637118, 3700.1643966237507],
            [1176.5871879136432, 3700.1643966237507], [1176.5871879136432, 3140.893513306419],
            [1682.0524910637118, 3140.893513306419],
        ], &[]);
        let b = raw_item("b", &[
            [1672.0524910637118, 3091.331827114955], [1672.0524910637118, 3141.047027330487],
            [1664.6852522257034, 3141.047027330487], [1664.6852522257034, 3140.893507524324],
            [1643.826173207107, 3140.893513306619], [1643.826173207107, 3091.331827114955],
            [1672.0524910637118, 3091.331827114955],
        ], &[]);
        for r in both_orders(&a, &b, 0.0) {
            assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
        }
        let z1 = shape::material_zone_overlap(&a.coords, &[], &b.coords);
        let z2 = shape::material_zone_overlap(&b.coords, &[], &a.coords);
        assert!(z1.is_none_or(|v| v > OVERLAP_EPS_MM2), "{z1:?}");
        assert!(z2.is_none_or(|v| v > OVERLAP_EPS_MM2), "{z2:?}");
    }

    #[test]
    fn a_part_in_a_hole_1e7_from_its_wall_is_judged_on_its_real_area() {
        let host = raw_item("host", &[
            [30.82143783569336, 502.0532531738281], [-29.382999728542345, 520.6119626541246],
            [-54.42252839243437, 439.3837532420605], [5.781909171801338, 420.82504376176405],
            [30.82143783569336, 502.0532531738281],
        ], &[&[
            [13.772644590067813, 489.5193531874746], [-22.350017948473607, 500.6545788756525],
            [-37.373735146808826, 451.91765322841405], [-1.2510726082673997, 440.7824275402362],
            [13.772644590067813, 489.5193531874746],
        ]]);
        // Posée 1e-7 mm au-delà de la paroi : shapely 0,70 mm2 sur la matière.
        let biting = raw_item("in", &[
            [8.222038236860037, 471.51319062050663], [-28.091749500298008, 482.7073328467172],
            [-29.122788915870032, 479.36264187092627], [3.84630784549714, 469.19953906028775],
            [-2.7818026831801603, 447.6979542159179], [0.5628882926107082, 446.66691480034586],
            [8.222038236860037, 471.51319062050663],
        ], &[]);
        for r in both_orders(&host, &biting, 0.0) {
            assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
        }
        // Posée 1e-7 mm en deçà de la paroi d'un autre trou : shapely 3,6e-7 mm2.
        let frame = raw_item("host", &[
            [13.630993843078613, 274.824951171875], [25.370317645351285, 192.65933624284648],
            [165.94281547573743, 212.74348057926477], [154.20349167346475, 294.9090955082933],
            [13.630993843078613, 274.824951171875],
        ], &[&[
            [44.093358169610376, 262.40865705335295], [51.13695245097398, 213.10928809593585],
            [135.48045114920566, 225.15977469778682], [128.43685686784207, 274.45914365520395],
            [44.093358169610376, 262.40865705335295],
        ]]);
        let resting = raw_item("in", &[
            [119.3017067079566, 233.75792701004278], [120.82923317861376, 223.06649759759085],
            [122.61113808068907, 223.32108534270037], [121.33819935514143, 232.23060985307697],
            [134.20751253679651, 234.06929912331248], [133.952924791687, 235.85120402538777],
            [119.3017067079566, 233.75792701004278],
        ], &[]);
        for r in both_orders(&frame, &resting, 0.0) {
            assert_eq!(r["overlapFree"], serde_json::json!(true), "{r}");
        }
    }

    #[test]
    fn two_triangles_in_contact_on_a_slanted_edge_do_not_overlap() {
        // Les deux moitiés d'un rectangle 60 x 80, la diagonale de b pivotée de
        // 1e-6 mm : elle croise celle de a. L'ancien test prenait alors l'aire
        // commune des boîtes (2 400 mm2). shapely : intersection 2e-5 mm2,
        // distance 0,0.
        let d = 1e-6;
        let a = raw_item("a", &[[0.0, 0.0], [60.0, 0.0], [0.0, 80.0], [0.0, 0.0]], &[]);
        let b = raw_item("b", &[[60.0 - d, 0.0], [60.0, 80.0], [d, 80.0], [60.0 - d, 0.0]], &[]);
        for r in both_orders(&a, &b, 0.0) {
            assert_eq!(r["overlapFree"], serde_json::json!(true), "{r}");
            assert_eq!(r["smallestGapMm"], serde_json::json!(0.0), "{r}");
            assert_eq!(r["duplicatePoses"], serde_json::json!(0), "{r}");
        }
    }

    #[test]
    fn a_copy_moved_by_1e8_to_1e5_mm_is_an_overlap() {
        // Cas tiré : copie à 3,3e-8 mm, un sommet de plus sur un bord.
        // shapely : intersection 65 504 mm2 (toute la pièce).
        let a = raw_item("a", &[
            [1902.9488461355122, 2629.8901512347575], [1902.9488462529464, 2985.8901512347575],
            [1718.9488462529464, 2985.890151295454], [1718.9488462127958, 2864.1740838025],
            [1718.9488461355122, 2629.890151295454], [1753.9518123437701, 2629.8901512839075],
            [1902.9488461355122, 2629.8901512347575],
        ], &[]);
        let b = raw_item("b", &[
            [1902.948846102525, 2629.890151267745], [1902.948846102525, 2985.890151267745],
            [1718.948846102525, 2985.890151267745], [1718.948846102525, 2629.890151267745],
            [1902.948846102525, 2629.890151267745],
        ], &[]);
        for r in both_orders(&a, &b, 0.0) {
            assert_eq!(r["overlapFree"], serde_json::json!(false), "{r}");
        }
        // Cadre à trou et sa copie décalée de 1e-8 à 1e-5 mm, dans huit directions.
        let host = frame100();
        let at = |id: &str, dx: f64, dy: f64| -> Item {
            let mv = |r: &Vec<Pt>| r.iter().map(|p| [p[0] + 1234.5 + dx, p[1] + 2345.25 + dy]).collect::<Vec<Pt>>();
            Item { id: id.into(), coords: mv(&host.coords), holes: host.holes.iter().map(mv).collect() }
        };
        let original = at("orig", 0.0, 0.0);
        for e in [1e-8, 3e-8, 1e-7, 3e-7, 1e-6, 3e-6, 1e-5] {
            for (sx, sy) in [(1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0), (1.0, 1.0), (-1.0, 1.0), (1.0, -1.0), (-1.0, -1.0)] {
                for r in both_orders(&original, &at("copy", sx * e, sy * e), 0.0) {
                    assert_eq!(r["overlapFree"], serde_json::json!(false), "{e} {sx} {sy} {r}");
                }
            }
        }
    }
}
