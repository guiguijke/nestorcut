//! Décalage du contour d'une TÔLE (distance au bord réglée à part de
//! l'espacement) : l'anneau rendu est celui que le moteur reçoit comme conteneur,
//! agrandi (distance positive, vers l'extérieur) ou réduit (distance négative,
//! vers l'intérieur) d'une vraie distance euclidienne, coins arrondis.
//!
//! ## Construction
//! Tout passe par l'arrangement entier de `sheet_cut` (grille 1e-4 mm, prédicats
//! exacts, arrondi de Hobby) : aucun calcul de décalage flottant ne décide d'un
//! côté. Le voisinage du bord, d'un seul côté, est l'union d'un polygone par
//! arête : le rectangle de l'arête poussé de `r` vers ce côté, prolongé à son
//! sommet d'arrivée par le secteur de rayon `r` entre les deux normales quand
//! le sommet est saillant de ce côté. C'est exact : un point à moins de `r` du
//! bord a son plus proche voisin dans une arête (rectangle) ou en un sommet
//! (secteur).
//! - vers l'INTÉRIEUR : `cut_sheet(contour, défauts = ces polygones)` ; la
//!   région gardée est le contour moins la bande ;
//! - vers l'EXTÉRIEUR : `cut_sheet(grande boîte, défauts = contour + ces
//!   polygones)` ; le trou rendu est l'union du contour et de la bande.
//!
//! ## Toujours du côté sûr
//! Le conteneur rendu n'est JAMAIS plus grand que le décalage exact :
//! - vers l'intérieur, les arcs sont des polygones CIRCONSCRITS au cercle (la
//!   bande ôtée couvre la vraie), au rayon `r + SAFETY_MM` ; les reprises de
//!   `sheet_cut` n'ôtent que de la tôle ;
//! - vers l'extérieur, les arcs sont INSCRITS (cordes dans le cercle), au rayon
//!   `r - SAFETY_MM`. Une reprise de `sheet_cut` ajouterait ici du conteneur :
//!   le résultat n'est gardé que SANS reprise. Sinon le calcul est refait à
//!   `r - 0,5 mm` puis `r - 1 mm`, contrôlé point par point ; à défaut, pour
//!   une distance d'au plus 1 mm, le contour d'entrée ressort tel quel, et
//!   au-delà c'est un refus nommé. `applied_distance_mm` dit ce qui a été
//!   appliqué : jamais plus que demandé, jamais plus de 1 mm de moins.
//!
//! `SAFETY_MM` couvre l'écart de nodage (`MAX_SHIFT_MM`) des deux anneaux en jeu.
//! L'erreur d'arc, elle, est `r·(1 - cos(π / segments_per_turn))` au plus, du
//! côté sûr (0,12 % de `r` à 64 segments par tour).
//!
//! ## Morceaux et vides
//! Vers l'intérieur, un goulet plus étroit que `2r` sépare la région : le plus
//! grand morceau est rendu, `pieces` et `lost_area_mm2` disent le reste. Vers
//! l'extérieur, une encoche plus étroite que `2r` se referme ; si elle
//! s'élargit au fond, il reste un VIDE enfermé dans le conteneur. Un anneau
//! seul ne peut pas le décrire : refus nommé `offset_enclosed_void`, sauf si
//! l'appelant demande les vides (`keep_voids`) pour les passer au moteur comme
//! interdits.
//!
//! Sinus, cosinus et arc tangente viennent de `libm` (piège 14b : natif et
//! wasm doivent s'accorder au bit près).

use crate::assemble::{self, Pt};
use crate::budget::{Deadline, TIME_BUDGET_MS_BROWSER};
use crate::sheet_cut::{self, Coord, MAX_COORD_MM, SheetCutError};
use serde::Serialize;

/// Segments d'un tour complet d'arc, par défaut.
pub const DEFAULT_SEGMENTS_PER_TURN: u32 = 64;
const MIN_SEGMENTS_PER_TURN: u32 = 8;
const MAX_SEGMENTS_PER_TURN: u32 = 720;
/// Marge prise sur le rayon pour couvrir l'arrondi de la grille (mm).
pub const SAFETY_MM: f64 = 5e-4;
/// Plus grande distance acceptée (mm).
pub const MAX_DISTANCE_MM: f64 = 1e5;
/// Replis du décalage extérieur quand `sheet_cut` a dû reprendre le résultat
/// (une reprise va au plus à 0,45 mm de son tracé) : rayon réduit d'autant.
const FALLBACK_STEPS_MM: [f64; 2] = [0.5, 1.0];
/// Un repli n'est gardé que si chaque point contrôlé reste à cette marge sous
/// la distance demandée (mm).
const FALLBACK_SLACK_MM: f64 = 0.05;
/// Contrôle point par point abandonné au-delà (couples sommet x arête).
const CHECK_MAX_PAIRS: usize = 60_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OffsetError {
    /// JSON illisible, anneau inexploitable (moins de 3 sommets distincts, aire
    /// nulle, coordonnée non finie ou hors borne, arêtes qui se croisent),
    /// distance non finie ou hors borne.
    BadInput,
    /// Il ne reste rien du contour (distance négative trop grande).
    Empty,
    /// Le conteneur enferme un vide (voir l'en-tête) et l'appelant ne l'a pas
    /// demandé.
    EnclosedVoid,
    TooComplex,
    TimeBudget,
    /// Invariant interne non tenu (lequel) : une erreur, jamais un anneau faux.
    Failed(&'static str),
}

impl OffsetError {
    /// Code stable, lu par l'interface.
    pub fn code(&self) -> &'static str {
        match self {
            Self::BadInput => "offset_bad_input",
            Self::Empty => "offset_empty",
            Self::EnclosedVoid => "offset_enclosed_void",
            Self::TooComplex => "offset_too_complex",
            // Le code du budget de temps de la découpe : même cause, même message.
            Self::TimeBudget => "sheet_cut_time_budget",
            Self::Failed(_) => "offset_failed",
        }
    }
}

impl std::fmt::Display for OffsetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for OffsetError {}

impl From<SheetCutError> for OffsetError {
    fn from(e: SheetCutError) -> Self {
        match e {
            SheetCutError::BadInput | SheetCutError::BadGeometry | SheetCutError::BadDefect => Self::BadInput,
            SheetCutError::NoUsableArea => Self::Empty,
            SheetCutError::TooComplex => Self::TooComplex,
            SheetCutError::TimeBudget => Self::TimeBudget,
            SheetCutError::Failed(what) => Self::Failed(what),
        }
    }
}

type Res<T> = Result<T, OffsetError>;

#[derive(Debug, Clone, Copy)]
pub struct OffsetOptions {
    pub segments_per_turn: u32,
    /// Rendre les vides enfermés au lieu de refuser.
    pub keep_voids: bool,
}

impl Default for OffsetOptions {
    fn default() -> Self {
        Self { segments_per_turn: DEFAULT_SEGMENTS_PER_TURN, keep_voids: false }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RingOffset {
    /// Anneau FERMÉ, anti-horaire, sur la grille 1e-4 mm (convention de
    /// `SheetCut::outer`), dans le repère de l'entrée. Distance nulle ou repli
    /// complet : l'anneau d'entrée, refermé et mis anti-horaire.
    pub ring: Vec<Pt>,
    /// Morceaux disjoints avant le choix du plus grand (1 vers l'extérieur).
    pub pieces: usize,
    /// Aire des morceaux non retenus, mm².
    pub lost_area_mm2: f64,
    /// Plus grand écart de nodage mesuré, mm.
    pub max_shift_mm: f64,
    /// Distance réellement appliquée (signée) : la demandée, ou moins en valeur
    /// absolue après un repli (voir l'en-tête).
    pub applied_distance_mm: f64,
    /// Vides enfermés dans le conteneur (anneaux fermés, anti-horaires) : à
    /// passer au moteur comme interdits. Vide sans `keep_voids`.
    pub voids: Vec<Vec<Pt>>,
}

// ------------------------------------------------------------------ entrée

/// Indice de grille (`assemble::snap`).
fn grid_index(v: f64) -> i64 {
    (v * 1e4 + 0.5).floor() as i64
}

/// Anneau ouvert, anti-horaire, sans sommets confondus sur la grille.
fn clean(ring: &[Pt]) -> Res<Vec<Pt>> {
    let finite = ring.iter().all(|p| {
        p[0].is_finite() && p[1].is_finite() && p[0].abs() <= MAX_COORD_MM && p[1].abs() <= MAX_COORD_MM
    });
    if !finite {
        return Err(OffsetError::BadInput);
    }
    let mut out: Vec<Pt> = Vec::with_capacity(ring.len());
    let cell = |p: &Pt| [grid_index(p[0]), grid_index(p[1])];
    for p in ring {
        if out.last().map(cell) != Some(cell(p)) {
            out.push(*p);
        }
    }
    while out.len() > 1 && cell(&out[0]) == cell(&out[out.len() - 1]) {
        out.pop();
    }
    let mut cells: Vec<[i64; 2]> = out.iter().map(cell).collect();
    cells.sort_unstable();
    cells.dedup();
    let area = assemble::ring_signed_area(&out);
    if cells.len() < 3 || area.abs() * 1e8 < 1.0 {
        return Err(OffsetError::BadInput);
    }
    if area < 0.0 {
        out.reverse();
    }
    Ok(out)
}

fn cross_i(o: [i64; 2], a: [i64; 2], b: [i64; 2]) -> i128 {
    (a[0] - o[0]) as i128 * (b[1] - o[1]) as i128 - (a[1] - o[1]) as i128 * (b[0] - o[0]) as i128
}

/// Deux arêtes de l'anneau se CROISENT (intérieurs sécants), en entiers exacts.
/// Un contact (pincement) n'est pas un croisement : la région reste lisible.
fn self_crossing(ring: &[Pt], dl: &Deadline) -> Res<bool> {
    let n = ring.len();
    let pts: Vec<[i64; 2]> = ring.iter().map(|p| [grid_index(p[0]), grid_index(p[1])]).collect();
    let seg = |i: usize| (pts[i], pts[(i + 1) % n]);
    let mut order: Vec<usize> = (0..n).collect();
    let min_x = |i: usize| seg(i).0[0].min(seg(i).1[0]);
    let max_x = |i: usize| seg(i).0[0].max(seg(i).1[0]);
    order.sort_by_key(|&i| min_x(i));
    for (k, &i) in order.iter().enumerate() {
        dl.check_at(k).map_err(|_| OffsetError::TimeBudget)?;
        let (a, b) = seg(i);
        let (lo, hi) = (a[1].min(b[1]), a[1].max(b[1]));
        for &j in &order[k + 1..] {
            if min_x(j) > max_x(i) {
                break;
            }
            let (c, d) = seg(j);
            if c[1].max(d[1]) < lo || c[1].min(d[1]) > hi {
                continue;
            }
            let (d1, d2) = (cross_i(a, b, c).signum(), cross_i(a, b, d).signum());
            let (d3, d4) = (cross_i(c, d, a).signum(), cross_i(c, d, b).signum());
            if d1 * d2 < 0 && d3 * d4 < 0 {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

// ----------------------------------------------------------------- la bande

/// Les polygones de la bande d'un côté du contour `ring` (ouvert, anti-horaire) :
/// `outward` vrai = côté extérieur, arcs inscrits de rayon `radius` ; faux = côté
/// intérieur, arcs circonscrits au cercle de rayon `radius`.
fn band(ring: &[Pt], radius: f64, outward: bool, segments_per_turn: u32) -> Vec<Vec<Pt>> {
    let n = ring.len();
    let side = if outward { 1.0 } else { -1.0 };
    let step = 2.0 * core::f64::consts::PI / segments_per_turn as f64;
    // Normale unitaire de l'arête i, du côté de la bande (l'extérieur d'un anneau
    // anti-horaire est à droite du sens de parcours).
    let normal = |i: usize| -> Option<Pt> {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let len = libm::sqrt(dx * dx + dy * dy);
        (len > 0.0).then(|| [side * dy / len, -side * dx / len])
    };
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let Some(ni) = normal(i) else { continue };
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let mut poly: Vec<Pt> = vec![a, b];
        // `clean` a ôté les sommets confondus : l'arête suivante a une longueur.
        if let Some(nj) = normal((i + 1) % n) {
            let c = ring[(i + 2) % n];
            let turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
            // Sommet saillant du côté de la bande : virage à gauche vu de
            // l'extérieur, à droite vu de l'intérieur.
            if side * turn > 0.0 {
                let phi = libm::atan2(ni[0] * nj[1] - ni[1] * nj[0], ni[0] * nj[0] + ni[1] * nj[1]);
                let k = (phi.abs() / step).ceil().max(1.0) as usize;
                let t0 = libm::atan2(ni[1], ni[0]);
                let at = |t: f64, r: f64| -> Pt { [b[0] + r * libm::cos(t), b[1] + r * libm::sin(t)] };
                let mut arc: Vec<Pt> = vec![[b[0] + radius * ni[0], b[1] + radius * ni[1]]];
                if outward {
                    for m in 1..k {
                        arc.push(at(t0 + phi * m as f64 / k as f64, radius));
                    }
                } else {
                    // Sommets sur les tangentes : le polygone contient l'arc.
                    let far = radius / libm::cos(phi.abs() / (2.0 * k as f64));
                    for m in 0..k {
                        arc.push(at(t0 + phi * (m as f64 + 0.5) / k as f64, far));
                    }
                }
                arc.push([b[0] + radius * nj[0], b[1] + radius * nj[1]]);
                poly.extend(arc.into_iter().rev());
            } else {
                poly.push([b[0] + radius * ni[0], b[1] + radius * ni[1]]);
            }
        } else {
            poly.push([b[0] + radius * ni[0], b[1] + radius * ni[1]]);
        }
        poly.push([a[0] + radius * ni[0], a[1] + radius * ni[1]]);
        out.push(poly);
    }
    out
}

// ---------------------------------------------------------------- contrôles

fn point_seg_dist(p: Pt, a: Pt, b: Pt) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let l2 = dx * dx + dy * dy;
    let t = if l2 == 0.0 { 0.0 } else { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2).clamp(0.0, 1.0) };
    let (qx, qy) = (a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
    libm::sqrt(qx * qx + qy * qy)
}

/// Distance d'un point au BORD de l'anneau ouvert `ring`.
fn boundary_dist(p: Pt, ring: &[Pt]) -> f64 {
    let n = ring.len();
    (0..n).fold(f64::INFINITY, |d, i| d.min(point_seg_dist(p, ring[i], ring[(i + 1) % n])))
}

fn open(ring: &[Pt]) -> &[Pt] {
    if ring.len() > 1 && ring[0] == ring[ring.len() - 1] { &ring[..ring.len() - 1] } else { ring }
}

/// Points contrôlés d'un anneau rendu : ses sommets et trois points par arête.
fn probes(ring: &[Pt]) -> Vec<Pt> {
    let r = open(ring);
    let n = r.len();
    let mut out = Vec::with_capacity(4 * n);
    for i in 0..n {
        let (a, b) = (r[i], r[(i + 1) % n]);
        out.push(a);
        for t in [0.25, 0.5, 0.75] {
            out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
    }
    out
}

/// Chaque point contrôlé de `result` est dans `ring` ou à `limit` au plus de son
/// bord. `None` : trop de couples pour être contrôlé.
fn within(result: &[Pt], ring: &[Pt], limit: f64) -> Option<bool> {
    let pts = probes(result);
    if pts.len().saturating_mul(ring.len()) > CHECK_MAX_PAIRS {
        return None;
    }
    Some(pts.iter().all(|&p| assemble::point_in_ring(p, ring) || boundary_dist(p, ring) <= limit))
}

/// Chaque point contrôlé de `result` est à `limit` au moins du bord de `ring`.
fn clear_of(result: &[Pt], ring: &[Pt], limit: f64) -> Option<bool> {
    let pts = probes(result);
    if pts.len().saturating_mul(ring.len()) > CHECK_MAX_PAIRS {
        return None;
    }
    Some(pts.iter().all(|&p| boundary_dist(p, ring) >= limit))
}

fn closed(ring: &[Pt]) -> Vec<Pt> {
    let mut r = ring.to_vec();
    if r.first() != r.last() {
        r.push(r[0]);
    }
    r
}

fn unchanged(ring: &[Pt]) -> RingOffset {
    RingOffset {
        ring: closed(ring),
        pieces: 1,
        lost_area_mm2: 0.0,
        max_shift_mm: 0.0,
        applied_distance_mm: 0.0,
        voids: Vec::new(),
    }
}

// ------------------------------------------------------------------ calcul

fn inward(ring: &[Pt], r: f64, opts: &OffsetOptions, dl: &Deadline) -> Res<RingOffset> {
    let shapes = band(ring, r + SAFETY_MM, false, opts.segments_per_turn);
    let cut = sheet_cut::cut_sheet(&closed(ring), &[], &shapes, dl)?;
    if !cut.changed {
        return Err(OffsetError::Failed("inward_unchanged"));
    }
    // Un îlot interdit au milieu du morceau (une reprise) : un vide, comme vers
    // l'extérieur.
    if !cut.holes.is_empty() && !opts.keep_voids {
        return Err(OffsetError::EnclosedVoid);
    }
    // Garde-fou : la région ne s'approche nulle part du bord à moins de `r`
    // (à l'écart de nodage près).
    if clear_of(&cut.outer, ring, r - 1e-6) == Some(false) {
        return Err(OffsetError::Failed("inward_check"));
    }
    Ok(RingOffset {
        ring: cut.outer,
        pieces: cut.pieces,
        lost_area_mm2: cut.lost_area,
        max_shift_mm: cut.max_shift,
        applied_distance_mm: -r,
        voids: cut.holes,
    })
}

/// Une tentative vers l'extérieur au rayon `radius` : l'anneau, ses vides, le
/// nombre de reprises et l'écart de nodage.
fn outward_once(
    ring: &[Pt],
    radius: f64,
    opts: &OffsetOptions,
    dl: &Deadline,
) -> Res<(Vec<Pt>, Vec<Vec<Pt>>, usize, f64)> {
    let b = ring.iter().fold([f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY], |b, p| {
        [b[0].min(p[0]), b[1].min(p[1]), b[2].max(p[0]), b[3].max(p[1])]
    });
    // Boîte assez large pour que son reste soit toujours le plus grand morceau
    // (un vide tient dans la boîte du contour) et que rien ne touche son bord.
    let m = radius + (b[2] - b[0]).max(b[3] - b[1]) + 10.0;
    let (x0, y0) = ((b[0] - m).floor(), (b[1] - m).floor());
    let (x1, y1) = ((b[2] + m).ceil(), (b[3] + m).ceil());
    let frame = vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    let mut defects = vec![closed(ring)];
    defects.extend(band(ring, radius, true, opts.segments_per_turn));
    let cut = sheet_cut::cut_sheet(&frame, &[], &defects, dl)?;
    if !cut.changed || cut.holes.len() != 1 {
        return Err(OffsetError::Failed("outward_union"));
    }
    let voids: Vec<Vec<Pt>> = cut.lost_pieces.iter().map(|p| p.outer.clone()).collect();
    let mut holes = cut.holes;
    Ok((holes.swap_remove(0), voids, cut.repairs, cut.max_shift))
}

fn outward(ring: &[Pt], r: f64, opts: &OffsetOptions, dl: &Deadline) -> Res<RingOffset> {
    let done = |res: (Vec<Pt>, Vec<Vec<Pt>>, usize, f64), applied: f64| -> Res<RingOffset> {
        if !res.1.is_empty() && !opts.keep_voids {
            return Err(OffsetError::EnclosedVoid);
        }
        Ok(RingOffset {
            ring: res.0,
            pieces: 1,
            lost_area_mm2: 0.0,
            max_shift_mm: res.3,
            applied_distance_mm: applied,
            voids: res.1,
        })
    };
    // Ce qui a empêché de rendre le décalage demandé, s'il faut le dire.
    let mut cause = OffsetError::Failed("outward_repairs");
    if r - SAFETY_MM > 0.0 {
        match outward_once(ring, r - SAFETY_MM, opts, dl) {
            // Sans reprise, l'union est exacte à l'écart de nodage près.
            Ok(res) if res.2 == 0 => return done(res, r),
            Ok(_) => {}
            Err(e @ (OffsetError::Failed(_) | OffsetError::TooComplex)) => cause = e,
            Err(e) => return Err(e),
        }
    }
    for step in FALLBACK_STEPS_MM {
        let radius = r - step;
        if radius <= SAFETY_MM {
            break;
        }
        match outward_once(ring, radius, opts, dl) {
            Ok(res) => {
                if within(&res.0, ring, r - FALLBACK_SLACK_MM) == Some(true) {
                    return done(res, radius);
                }
            }
            Err(e @ (OffsetError::Failed(_) | OffsetError::TooComplex)) => cause = e,
            Err(e) => return Err(e),
        }
    }
    // Rien de sûr au-delà du contour lui-même, qui l'est toujours. Il ne vaut
    // réponse que s'il est aussi près du décalage demandé qu'un repli ; au-delà,
    // rendre le contour ferait croire à un réglage appliqué : refus nommé.
    if r <= FALLBACK_STEPS_MM[FALLBACK_STEPS_MM.len() - 1] + SAFETY_MM {
        return Ok(unchanged(ring));
    }
    Err(cause)
}

/// Contour décalé de `distance_mm` : positif vers l'extérieur, négatif vers
/// l'intérieur. Voir l'en-tête du module.
pub fn offset_ring(ring: &[Pt], distance_mm: f64, opts: &OffsetOptions, dl: &Deadline) -> Res<RingOffset> {
    if !distance_mm.is_finite() || distance_mm.abs() > MAX_DISTANCE_MM {
        return Err(OffsetError::BadInput);
    }
    let opts = OffsetOptions {
        segments_per_turn: opts.segments_per_turn.clamp(MIN_SEGMENTS_PER_TURN, MAX_SEGMENTS_PER_TURN),
        keep_voids: opts.keep_voids,
    };
    let ring = clean(ring)?;
    if self_crossing(&ring, dl)? {
        return Err(OffsetError::BadInput);
    }
    if distance_mm == 0.0 {
        return Ok(unchanged(&ring));
    }
    if distance_mm > 0.0 {
        outward(&ring, distance_mm, &opts, dl)
    } else {
        inward(&ring, -distance_mm, &opts, dl)
    }
}

// -------------------------------------------------------------------- JSON

/// `{ring, distance_mm, segments_per_turn?, time_budget_ms?, keep_voids?}` ->
/// `{ring, pieces, lost_area_mm2, max_shift_mm, applied_distance_mm, voids}`.
/// Chaque coordonnée est un nombre ou une chaîne (exacte au bit près).
pub fn offset_ring_json(json: &str) -> Res<String> {
    #[derive(serde::Deserialize)]
    struct In {
        ring: Vec<[Coord; 2]>,
        distance_mm: Coord,
        segments_per_turn: Option<u32>,
        time_budget_ms: Option<u64>,
        #[serde(default)]
        keep_voids: bool,
    }
    let i: In = serde_json::from_str(json).map_err(|_| OffsetError::BadInput)?;
    let ring: Vec<Pt> = i.ring.iter().map(|p| [p[0].0, p[1].0]).collect();
    let opts = OffsetOptions {
        segments_per_turn: i.segments_per_turn.unwrap_or(DEFAULT_SEGMENTS_PER_TURN),
        keep_voids: i.keep_voids,
    };
    let dl = Deadline::new(i.time_budget_ms.unwrap_or(TIME_BUDGET_MS_BROWSER));
    let out = offset_ring(&ring, i.distance_mm.0, &opts, &dl)?;
    serde_json::to_string(&out).map_err(|_| OffsetError::Failed("json"))
}
