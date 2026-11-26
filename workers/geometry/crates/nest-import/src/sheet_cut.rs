//! Découpe d'une TÔLE par des défauts dessinés à la main : la région utile est
//! l'intérieur du contour, moins l'union des zones interdites et des défauts,
//! rendue PROPRE (un anneau extérieur, des trous strictement dedans, disjoints).
//!
//! ## Ce qui est « dedans » d'un défaut
//! Règle NON NULLE (nombre d'enroulement ≠ 0), celle que SVG et Canvas
//! appliquent par défaut (`fill-rule: nonzero`) : un polygone qui se recroise
//! couvre exactement ce que l'utilisateur voit rempli. La règle pair-impair
//! laisserait un vide au milieu d'une étoile à cinq branches ou d'une boucle
//! tracée deux fois, donc une pièce posée sur le défaut. Le contour, lui, est
//! lu en pair-impair (même chose pour un anneau simple, plus petit sinon).
//!
//! ## Grille et erreur
//! Même grille que l'import : 1e-4 mm (`assemble::snap`). Tout se calcule en
//! unités ENTIÈRES de grille (relatives au coin du contour), avec des prédicats
//! entiers exacts. Le nodage est un arrondi de Hobby : chaque arête est coupée à
//! tous les « pixels chauds » (sommets et croisements arrondis) qu'elle traverse,
//! ce qui borne l'écart par construction :
//! - sommet d'entrée arrondi : au plus 0,5·√2 = 0,7071 unité ;
//! - arête déplacée vers un pixel chaud : au plus 0,7071 unité de plus ;
//! - total 1,4143e-4 mm (0,14 µm) en une passe, ce qui est la règle ; chaque
//!   passe de plus ajouterait 0,7071e-4. L'écart réel est MESURÉ à chaque appel
//!   (`max_shift`) et au-delà de `MAX_SHIFT_MM` la découpe est refusée.
//!
//! La région rendue ne dépasse donc jamais la vraie de plus de `max_shift`.
//!
//! ## Nettoyage : toujours du côté sûr
//! Les reprises n'AJOUTENT que de l'interdit, jamais de tôle :
//! - contact exact (trou qui touche le bord ou un autre trou en un sommet) : un
//!   rectangle de 0,24 x 0,18 mm centré sur le contact les soude (plus toute la
//!   portion où les deux bords restent à moins de 0,01 mm, si l'angle est très
//!   fermé) ;
//! - trou ou interdit trop fin (largeur moyenne 2·aire/périmètre sous 0,1 mm,
//!   règle W), défaut sans aire (trait, point) ou aux sommets presque alignés (une
//!   fissure droite tracée en plusieurs clics) : chaque arête est épaissie de
//!   0,12 mm de chaque côté. Au-dessus du seuil, un disque de 0,1 mm y tient
//!   forcément (aire ≤ rayon inscrit × périmètre) ;
//! - portion d'un défaut REPLIÉE sur elle-même (ergot, queue de lasso, bout aplati
//!   par l'arrondi) : sans intérieur, la règle non nulle ne la voit pas. Elle reste
//!   dans l'arrangement, et ce qui en tombe dans la tôle utile est épaissi de même.
//!   Tout point du TRACÉ d'un défaut est donc interdit, à 2e-4 mm près ;
//! - goulet ou fente de moins de 0,01 mm dans un même anneau, ou détail que le
//!   moteur refuserait en f32 (sommets confondus, arêtes qui se touchent) : le
//!   passage est épaissi de même ;
//! - morceau utile trop fin (même mesure) : ce n'est pas un morceau, son aire
//!   compte dans `lost_area`.
//!
//! Tour après tour, les reprises grandissent (0,12 mm, puis 10 % de plus à chaque
//! tour) : des bords parallèles écartés d'une reprise se la renverraient sans fin.
//! Une reprise va au plus à 0,18 mm du tracé ; un interdit coupé par le contour en
//! demande parfois deux (0,45 mm au pire sur 31 000 cas faits pour cela).
//! Un détail du contour LUI-MÊME (encoche, languette trop fine) n'est pas repris : là
//! où une reprise couvre déjà tout, rien de plus n'est ajouté.
//!
//! ## Deux descriptions de la même région
//! - `outer` + `holes` : la tôle COUPÉE (rapport, aire, dessin, DXF livré) ;
//! - contour d'ORIGINE + `hazards` : ce que le moteur reçoit. Le moteur érode son
//!   contour sans contrôle ni repli (`geo_buffer`), ce qui se passe mal sur un
//!   contour à encoches ; il gonfle ses trous avec contrôle et repli. Les défauts
//!   lui partent donc en trous sur un contour intact. `hazards` est l'union des
//!   zones, des défauts, des reprises et des morceaux perdus, COUPÉE par le contour.
//!
//! Les deux sortent du même arrangement : dans la tôle, hors de tous les
//! `hazards` = dans `outer` et hors des `holes`. Les morceaux perdus sont FONDUS
//! dans l'union (un morceau perdu partage des arêtes avec ce qui l'a détaché) : un
//! éclat trop fin pour le moteur y disparaît et rien ne se recouvre.
//!
//! Coupés par le contour, les interdits ne se comptent que dans la tôle : aire du
//! contour moins aire des `hazards` = `usable_area` (à l'écart de nodage près). Or
//! c'est exactement l'aire que jagua tire du conteneur (`Container::area`), qui entre
//! dans le coût du recuit (`nest-engine/src/bpp/sa.rs`, fill²) : non coupés, les
//! trous dépassent, et cette aire devient fausse, voire négative. La sûreté est la
//! même dans les deux cas : un trou gonflé de la moitié de l'espacement ne peut rien
//! ôter, au bord, que l'érosion du contour n'ôte déjà. Une partie d'un défaut qui ne
//! touche pas l'intérieur de la tôle n'y figure pas. Un interdit le long du bord
//! reprend les arêtes du contour, sans les nœuds de croisement : mêmes sommets, mêmes
//! valeurs f32, aucune bande entre l'interdit et le bord.
//!
//! Quand la région gardée est ENTOURÉE (cadre de défauts), l'anneau interdit est
//! livré en deux polygones simples joints par deux arêtes verticales communes
//! (mêmes sommets, donc mêmes valeurs f32 : aucun jour entre eux), au-dessus de son
//! sommet le plus haut et au-dessous du plus bas. Un interdit qui l'entoure PRESQUE
//! (C, cadre manqué à un coin) est coupé aux mêmes endroits : le moteur gonfle chaque
//! anneau seul d'un demi-espacement, l'ouverture se refermerait et tout l'intérieur
//! deviendrait interdit. LIMITE : un interdit qui entoure presque une partie de la
//! région gardée qui ne contient ni ce sommet haut ni ce sommet bas (une pièce à côté
//! d'une autre, un C au milieu de la tôle) n'est pas coupé ; sous l'espacement de son
//! ouverture, le moteur perd cette partie (jamais l'inverse).
//!
//! ## Classement des faces
//! Les faces de l'arrangement (`polygonize_until`) ne sont pas sondées : le
//! nombre d'enroulement de chaque anneau est PROPAGÉ d'une face à sa voisine, de
//! part et d'autre de chaque arête (entiers, exact, linéaire). Une face d'un
//! dixième de micron est classée comme les autres, et le plan à 200 défauts
//! superposés ne coûte pas faces². La caractéristique d'Euler de chaque
//! composante est vérifiée : une marche des faces fausse est une erreur nommée,
//! jamais un anneau faux.

use crate::assemble::{self, Pt};
use crate::budget::{Deadline, Expired, TIME_BUDGET_MS_BROWSER};
use crate::sheet::split_simple_loops;
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashMap;

/// Point de la grille (unités de 1e-4 mm, relatives au coin du contour).
type P = [i64; 2];

/// Unités de grille par millimètre (`assemble::snap`).
const GRID: f64 = 1e4;
/// Coordonnée la plus grande acceptée (10 km) : au-delà, refus nommé.
pub const MAX_COORD_MM: f64 = 1e7;
/// Écart mesuré au-delà duquel la découpe est refusée (borne démontrée en une
/// passe : 1,4143e-4 mm).
pub const MAX_SHIFT_MM: f64 = 3e-4;
/// Demi-largeur d'une reprise (soudure, épaississement) au premier tour : 0,12 mm.
pub const REPAIR_HALF_MM: f64 = 0.12;
/// Un sommet à moins que ça de la corde ne demande pas sa propre reprise.
const COARSE_MM: f64 = 0.03;
/// Débord d'une reprise à ses bouts, en fraction de la demi-largeur (0,088 mm). Pas
/// un carré : ses coins seraient à 45 degrés, sur les arêtes mêmes qu'il soude, et
/// la reprise se referait sans fin de coin en coin. Le plus petit rectangle
/// (0,24 x 0,175 mm) garde une largeur moyenne de 0,101 mm, au-dessus du seuil.
const REPAIR_END: f64 = 0.73;
/// Deux bords d'un même anneau plus proches que ça (hors voisinage immédiat)
/// sont soudés : le moteur arrondit en f32 (ulp de 2,4e-4 mm à 3 m).
pub const CLEARANCE_MM: f64 = 0.01;
/// « Voisinage immédiat » : distance le long de l'anneau sous ce multiple de la
/// tolérance (un arc fin, un coin ne sont pas un goulet).
const CLEARANCE_ALONG: f64 = 4.0;
/// Portion repliée plus courte que ça (unités de grille) : un résidu de nodage, là où
/// le bord d'une reprise coupe une écaille d'un pas de haut. L'épaissir ne ferait que
/// le déplacer d'une reprise.
const RESIDUE: i64 = 3;
/// Reprises de l'arrangement (soudures successives) et passes de nodage.
const MAX_ROUNDS: usize = 16;
const MAX_PASSES: usize = 4;
/// Bornes de mémoire : croisements et reprises.
const MAX_CROSSINGS: usize = 100_000;
const MAX_REPAIRS: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SheetCutError {
    /// JSON illisible (opération wasm).
    BadInput,
    /// Contour ou zone inexploitable (coordonnée non finie ou hors borne, moins
    /// de 3 sommets distincts ou aire nulle pour le contour).
    BadGeometry,
    /// Défaut inexploitable (vide, coordonnée non finie ou hors borne).
    BadDefect,
    /// Il ne reste aucun morceau utile.
    NoUsableArea,
    /// Trop de croisements ou de reprises.
    TooComplex,
    TimeBudget,
    /// Invariant interne non tenu (lequel) : une erreur, jamais un anneau faux.
    Failed(&'static str),
}

impl SheetCutError {
    /// Code stable, lu par l'interface.
    pub fn code(&self) -> &'static str {
        match self {
            Self::BadInput => "sheet_cut_bad_input",
            Self::BadGeometry => "sheet_bad_geometry",
            Self::BadDefect => "sheet_bad_defect",
            Self::NoUsableArea => "sheet_no_usable_area",
            Self::TooComplex => "sheet_cut_too_complex",
            Self::TimeBudget => "sheet_cut_time_budget",
            Self::Failed(_) => "sheet_cut_failed",
        }
    }
}

impl std::fmt::Display for SheetCutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for SheetCutError {}

impl From<Expired> for SheetCutError {
    fn from(_: Expired) -> Self {
        Self::TimeBudget
    }
}

type Res<T> = Result<T, SheetCutError>;

/// Un morceau : anneau extérieur et trous, FERMÉS, anti-horaires.
#[derive(Debug, Clone, Serialize)]
pub struct Piece {
    pub outer: Vec<Pt>,
    pub holes: Vec<Vec<Pt>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetCut {
    /// Anneau FERMÉ du morceau retenu (la plus grande aire nette) : même
    /// convention que `SheetContour` (anti-horaire, départ au plus petit x puis
    /// y, grille 1e-4) ; un anneau d'entrée que la découpe ne touche pas ressort
    /// tel quel, au bit près.
    pub outer: Vec<Pt>,
    /// Trous : d'abord les zones d'entrée intactes (leur ordre), puis les autres
    /// par aire décroissante.
    pub holes: Vec<Vec<Pt>>,
    /// Aire du morceau retenu (contour moins trous), mm².
    pub usable_area: f64,
    /// Morceaux disjoints avant le choix (les trop fins ne comptent pas).
    pub pieces: usize,
    /// Aire utile des autres morceaux, trop fins compris, mm².
    pub lost_area: f64,
    /// Aire que les défauts (et leurs reprises) ôtent à la région utile
    /// d'origine, mm².
    pub removed_area: f64,
    /// Faux : les défauts n'ôtent rien, les anneaux sont ceux de l'entrée.
    pub changed: bool,
    /// Nombre de reprises ajoutées (soudures, épaississements).
    pub repairs: usize,
    /// Plus grand écart mesuré entre une arête rendue et son tracé d'entrée, mm.
    pub max_shift: f64,
    /// Les morceaux utiles NON retenus, trop fins compris, par aire nette
    /// décroissante ; la somme de leurs aires est `lost_area`.
    pub lost_pieces: Vec<Piece>,
    /// Interdits du moteur sur le contour d'ORIGINE (voir l'en-tête) : anneaux
    /// simples, fermés, anti-horaires, qui ne se touchent qu'en des arêtes communes
    /// (coupures), COUPÉS par le contour (dedans, à `max_shift` près, un demi-pas de
    /// grille de plus au bout d'une coupure). Aire du contour moins leurs aires =
    /// `usable_area`. D'abord les zones d'entrée intactes (leur ordre, au bit près),
    /// puis les autres par aire décroissante.
    pub hazards: Vec<Vec<Pt>>,
}

// ------------------------------------------------------------------ entrée

/// Anneau d'entrée sur la grille. `raw` : les mêmes sommets non arrondis (même
/// longueur que `chain`), en unités relatives.
struct RingIn {
    chain: Vec<P>,
    raw: Vec<Pt>,
}

fn finite(ring: &[Pt]) -> bool {
    ring.iter().all(|p| {
        p[0].is_finite() && p[1].is_finite() && p[0].abs() <= MAX_COORD_MM && p[1].abs() <= MAX_COORD_MM
    })
}

/// Indice de grille : le `floor(v·1e4 + 0,5)` de `assemble::snap`.
fn grid_index(v: f64) -> i64 {
    (v * GRID + 0.5).floor() as i64
}

fn to_grid(ring: &[Pt], origin: P) -> RingIn {
    let mut chain: Vec<P> = Vec::with_capacity(ring.len());
    let mut raw: Vec<Pt> = Vec::with_capacity(ring.len());
    for v in ring {
        let p = [grid_index(v[0]) - origin[0], grid_index(v[1]) - origin[1]];
        if chain.last() == Some(&p) {
            continue;
        }
        chain.push(p);
        raw.push([v[0] * GRID - origin[0] as f64, v[1] * GRID - origin[1] as f64]);
    }
    while chain.len() > 1 && chain.first() == chain.last() {
        chain.pop();
        raw.pop();
    }
    RingIn { chain, raw }
}

fn closed(ring: &[Pt]) -> Vec<Pt> {
    let mut r = ring.to_vec();
    if r.first() != r.last() {
        r.push(r[0]);
    }
    r
}

fn unchanged(outer: &[Pt], holes: &[Vec<Pt>]) -> SheetCut {
    let usable = assemble::ring_signed_area(outer).abs()
        - holes.iter().map(|h| assemble::ring_signed_area(h).abs()).sum::<f64>();
    let kept: Vec<Vec<Pt>> = holes.iter().filter(|h| !h.is_empty()).map(|h| closed(h)).collect();
    SheetCut {
        outer: closed(outer),
        hazards: kept.clone(),
        holes: kept,
        usable_area: usable,
        pieces: 1,
        lost_area: 0.0,
        removed_area: 0.0,
        changed: false,
        repairs: 0,
        max_shift: 0.0,
        lost_pieces: Vec::new(),
    }
}

// --------------------------------------------------------- calcul entier

fn cross_i(o: P, a: P, b: P) -> i128 {
    (a[0] - o[0]) as i128 * (b[1] - o[1]) as i128 - (a[1] - o[1]) as i128 * (b[0] - o[0]) as i128
}

fn dot_i(o: P, a: P, b: P) -> i128 {
    (a[0] - o[0]) as i128 * (b[0] - o[0]) as i128 + (a[1] - o[1]) as i128 * (b[1] - o[1]) as i128
}

/// Deux fois l'aire signée, exacte.
fn area2(ring: &[P]) -> i128 {
    let n = ring.len();
    (0..n).fold(0i128, |s, i| {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        s + a[0] as i128 * b[1] as i128 - b[0] as i128 * a[1] as i128
    })
}

fn perimeter(ring: &[P]) -> f64 {
    let n = ring.len();
    (0..n).fold(0.0, |s, i| {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let (dx, dy) = ((b[0] - a[0]) as f64, (b[1] - a[1]) as f64);
        s + (dx * dx + dy * dy).sqrt()
    })
}

fn mm2(area2: i128) -> f64 {
    area2 as f64 / 2.0 / (GRID * GRID)
}

fn bbox_i(ring: &[P]) -> [i64; 4] {
    ring.iter().fold([i64::MAX, i64::MAX, i64::MIN, i64::MIN], |b, p| {
        [b[0].min(p[0]), b[1].min(p[1]), b[2].max(p[0]), b[3].max(p[1])]
    })
}

fn f(p: P) -> Pt {
    [p[0] as f64, p[1] as f64]
}

fn round_p(p: Pt) -> P {
    [(p[0] + 0.5).floor() as i64, (p[1] + 0.5).floor() as i64]
}

/// Lot de reprises d'un tour : rectangles (4 coins, anti-horaire) de demi-largeur
/// `half`. Elle grandit d'un tour à l'autre : deux bords parallèles écartés d'à peine
/// plus qu'une reprise se renverraient sinon la même, de proche en proche. `prior` :
/// les reprises des tours d'avant.
struct Repairs<'a> {
    half: f64,
    rects: Vec<Vec<P>>,
    prior: &'a [Vec<P>],
}

impl<'a> Repairs<'a> {
    fn new(step: usize, prior: &'a [Vec<P>]) -> Self {
        let half = REPAIR_HALF_MM * GRID * (1.0 + step as f64 / 10.0);
        Repairs { half, rects: Vec::new(), prior }
    }

    /// Rectangle autour de `a`-`b`, débordant de `half` sur les côtés (un peu moins aux
    /// bouts, `REPAIR_END`), dans la direction `dir` (celle du segment ; les axes si
    /// elle est nulle). Omis si une reprise couvre déjà le segment avec la moitié de sa
    /// marge :
    /// - du même lot : sur un tracé aux sommets serrés, une reprise par arête ferait des
    ///   centaines de rectangles superposés ;
    /// - d'un tour d'avant : tout y est déjà interdit, ce qui reste à redire est un détail
    ///   du contour LUI-MÊME (une languette trop fine), que le moteur reçoit tel quel
    ///   sans défaut aussi.
    fn push(&mut self, a: Pt, b: Pt, dir: Pt) {
        let holds = |r: &Vec<P>, margin: f64, p: Pt| {
            (0..r.len()).all(|i| {
                let (u, e) = (f(r[i]), assemble::sub(f(r[(i + 1) % r.len()]), f(r[i])));
                assemble::cross(e, assemble::sub(p, u)) >= margin * (e[0] * e[0] + e[1] * e[1]).sqrt()
            })
        };
        let covers = |r: &Vec<P>, margin: f64| holds(r, margin, a) && holds(r, margin, b);
        if self.rects.iter().rev().take(64).any(|r| covers(r, self.half / 2.0))
            || self.prior.iter().any(|r| covers(r, REPAIR_HALF_MM * GRID / 2.0))
        {
            return;
        }
        let len = (dir[0] * dir[0] + dir[1] * dir[1]).sqrt();
        let half = self.half;
        let (ux, uy) =
            if len > 0.0 { (dir[0] / len * half, dir[1] / len * half) } else { (half, 0.0) };
        let (ex, ey) = (ux * REPAIR_END, uy * REPAIR_END);
        self.rects.push(
            [
                [a[0] - ex + uy, a[1] - ey - ux],
                [b[0] + ex + uy, b[1] + ey - ux],
                [b[0] + ex - uy, b[1] + ey + ux],
                [a[0] - ex - uy, a[1] - ey + ux],
            ]
            .map(round_p)
            .to_vec(),
        );
    }

    /// Épaissit une ligne fermée (un point : un rectangle).
    fn thicken_all(&mut self, ring: &[P]) {
        self.thicken_path(&[ring, &ring[..1]].concat());
    }

    /// Épaissit une ligne ouverte. Les sommets à moins de `COARSE_MM` de la corde sont
    /// sautés : la corde épaissie les couvre.
    fn thicken_path(&mut self, path: &[P]) {
        let n = path.len() - 1;
        let at = |i: usize| f(path[i]);
        let mut i = 0;
        while i < n {
            let mut j = i + 1;
            while j < n
                && j - i < 256
                && (i + 1..=j).all(|k| point_segment(at(k), at(i), at(j + 1)).0 <= COARSE_MM * GRID)
            {
                j += 1;
            }
            self.push(at(i), at(j), assemble::sub(at(j), at(i)));
            i = j;
        }
    }

    /// Sommet `p` proche de `a`-`b` : épaissit `a`-`b` en face de la portion des deux
    /// arêtes de `p` qui en reste proche. Le rectangle suit `a`-`b` : ses bouts le
    /// coupent à angle droit (un coin posé sur l'arête referait le même défaut).
    fn thicken_near(&mut self, p: Pt, ends: [Pt; 2], a: Pt, b: Pt) {
        let on = |q: Pt| {
            let t = point_segment(q, a, b).1;
            [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
        };
        for far in ends {
            let (q, r) = (on(p), on(near_until(p, far, a, b)));
            self.push(q, r, if q == r { assemble::sub(b, a) } else { assemble::sub(r, q) });
        }
    }

    /// Soudure d'un contact en `p` : un rectangle, et, si deux des arêtes qui en
    /// partent restent proches plus loin que lui (angle très fermé), toute leur
    /// portion proche. Sans cela le contact ne ferait que glisser de 0,1 mm par
    /// reprise.
    fn weld(&mut self, p: Pt, ends: &[Pt]) {
        let reach = self.half * REPAIR_END;
        self.push(p, p, [0.0, 0.0]);
        for (i, &a) in ends.iter().enumerate() {
            for (j, &b) in ends.iter().enumerate() {
                if i != j {
                    let end = near_until(p, a, p, b);
                    if assemble::dist2(p, end) > reach * reach {
                        self.push(p, end, assemble::sub(end, p));
                    }
                }
            }
        }
    }
}

/// Trop fin : la largeur moyenne (2·aire/périmètre) est sous `MIN_PART_WIDTH_MM`.
/// `aire ≤ rayon inscrit × périmètre` : au-dessus, un disque de ce diamètre
/// tient dedans (et l'enveloppe convexe passe la règle W).
fn too_thin(area2_abs: i128, perim: f64) -> bool {
    (area2_abs as f64) < assemble::MIN_PART_WIDTH_MM * GRID * perim
}

/// Deux fois la somme des aires ABSOLUES de l'éventail d'un anneau : petite, tous ses
/// sommets sont presque alignés. (L'aire signée d'un nœud papillon s'annule.)
fn fan2(ring: &[P]) -> i128 {
    let n = ring.len();
    (0..n).map(|i| cross_i(ring[0], ring[i], ring[(i + 1) % n]).abs()).sum()
}

/// Une seule table (clé = deux entiers : un point, une arête, un couple) et un
/// seul tri pour tout le module : chaque instance générique pèse plusieurs ko
/// dans le bundle wasm.
#[derive(Default)]
struct Index(HashMap<P, u32>);

impl Index {
    #[inline(never)]
    fn get(&self, k: P) -> Option<u32> {
        self.0.get(&k).copied()
    }
    /// La valeur présente, sinon `v`, posée (booléen : vrai si posée).
    #[inline(never)]
    fn or_insert(&mut self, k: P, v: u32) -> (u32, bool) {
        let n = self.0.len();
        let got = *self.0.entry(k).or_insert(v);
        (got, self.0.len() > n)
    }
    fn has(&self, k: P) -> bool {
        self.get(k).is_some()
    }
}

/// Indices `0..n` triés (tri stable).
#[inline(never)]
fn sorted(n: usize, cmp: &dyn Fn(usize, usize) -> Ordering) -> Vec<usize> {
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| cmp(a, b));
    order
}

/// Clé d'une arête non orientée, et d'une demi-arête.
fn edge_key(u: u32, v: u32) -> P {
    [u.min(v) as i64, u.max(v) as i64]
}

fn half_key(u: u32, v: u32) -> P {
    [u as i64, v as i64]
}

// --------------------------------------------------------------- nodage

/// Arêtes non orientées uniques (petit sommet d'abord), sans arête nulle ; par
/// ligne brisée, le numéro de l'arête de chaque pas (`u32::MAX` : pas nul).
fn unique_edges(paths: &[Vec<P>]) -> (Vec<(P, P)>, Vec<Vec<u32>>) {
    let mut verts = Index::default();
    let mut at = Index::default();
    let mut out: Vec<(P, P)> = Vec::new();
    let mut n = 0u32;
    let mut id = |p: P| {
        let (v, new) = verts.or_insert(p, n);
        n += new as u32;
        v
    };
    let steps = paths
        .iter()
        .map(|path| {
            path.windows(2)
                .map(|w| {
                    if w[0] == w[1] {
                        return u32::MAX;
                    }
                    let (e, new) = at.or_insert(edge_key(id(w[0]), id(w[1])), out.len() as u32);
                    if new {
                        out.push(if w[0] < w[1] { (w[0], w[1]) } else { (w[1], w[0]) });
                    }
                    e
                })
                .collect()
        })
        .collect();
    (out, steps)
}

/// Le segment traverse-t-il l'intérieur du pixel de côté 1 centré en `p` ?
/// (axes séparateurs, exact).
fn crosses_pixel(a: P, b: P, p: P) -> bool {
    let (dx, dy) = ((b[0] - a[0]).abs(), (b[1] - a[1]).abs());
    p != a
        && p != b
        && p[0] >= a[0].min(b[0])
        && p[0] <= a[0].max(b[0])
        && p[1] >= a[1].min(b[1])
        && p[1] <= a[1].max(b[1])
        && 2 * cross_i(a, b, p).abs() < (dx + dy) as i128
}

/// Boîte fermée d'une arête.
fn edge_box(a: Pt, b: Pt) -> [f64; 4] {
    [a[0].min(b[0]), a[1].min(b[1]), a[0].max(b[0]), a[1].max(b[1])]
}

/// Visite chaque couple de boîtes fermées qui se touchent, une fois. Balayage
/// sur l'axe où les boîtes sont les plus courtes devant l'étendue : après nodage
/// les arêtes sont courtes, le coût suit les vrais voisins même quand tout se
/// passe dans une bande étroite (l'index en grille uniforme de l'import y
/// mettait 4 s sur 85 000 arêtes).
fn box_pairs(
    boxes: &[[f64; 4]],
    dl: &Deadline,
    visit: &mut dyn FnMut(usize, usize) -> Res<()>,
) -> Res<()> {
    let span = |k: usize| {
        let (lo, hi) = boxes
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |r, b| (r.0.min(b[k]), r.1.max(b[k + 2])));
        let sum: f64 = boxes.iter().map(|b| b[k + 2] - b[k]).sum();
        if hi > lo { sum / (hi - lo) } else { f64::INFINITY }
    };
    let k = if span(1) < span(0) { 1 } else { 0 };
    let o = 1 - k;
    let order = sorted(boxes.len(), &|a, b| boxes[a][k].total_cmp(&boxes[b][k]));
    for (n, &i) in order.iter().enumerate() {
        dl.check_at(n)?;
        let b = boxes[i];
        for &j in &order[n + 1..] {
            let c = boxes[j];
            if c[k] > b[k + 2] {
                break;
            }
            if c[o] <= b[o + 2] && b[o] <= c[o + 2] {
                visit(i, j)?;
            }
        }
    }
    Ok(())
}

/// Arrondi de Hobby : pour chaque arête, les sommets de la grille à insérer,
/// dans l'ordre de `a` vers `b`.
fn snap_round(edges: &[(P, P)], dl: &Deadline) -> Res<Vec<Vec<P>>> {
    let n = edges.len();
    let mut inner: Vec<Vec<P>> = vec![Vec::new(); n];
    let mut hot: Vec<P> = Vec::new();
    let mut seen = Index::default();
    for &(a, b) in edges {
        for p in [a, b] {
            if seen.or_insert(p, 0).1 {
                hot.push(p);
            }
        }
    }
    let mut boxes: Vec<[f64; 4]> = edges.iter().map(|&(a, b)| edge_box(f(a), f(b))).collect();
    let mut crossings = 0usize;
    box_pairs(&boxes, dl, &mut |i, j| {
        // Toujours dans le même ordre : le point croisé ne dépend pas de la visite.
        let (i, j) = (i.min(j), i.max(j));
        let (s, t) = (edges[i], edges[j]);
        if let Some(x) = assemble::seg_intersection(f(s.0), f(s.1), f(t.0), f(t.1)) {
            let p = round_p(x);
            inner[i].push(p);
            inner[j].push(p);
            if seen.or_insert(p, 0).1 {
                hot.push(p);
            }
            crossings += 1;
            if crossings > MAX_CROSSINGS {
                return Err(SheetCutError::TooComplex);
            }
        }
        Ok(())
    })?;
    // Pixels chauds : des boîtes réduites à un point, dans le même balayage.
    boxes.extend(hot.iter().map(|&p| edge_box(f(p), f(p))));
    box_pairs(&boxes, dl, &mut |i, j| {
        let (i, j) = (i.min(j), i.max(j));
        if i < n && j >= n && crosses_pixel(edges[i].0, edges[i].1, hot[j - n]) {
            inner[i].push(hot[j - n]);
        }
        Ok(())
    })?;
    for (pts, &(a, b)) in inner.iter_mut().zip(edges) {
        if pts.is_empty() {
            continue;
        }
        let order = sorted(pts.len(), &|i, j| {
            dot_i(a, b, pts[i]).cmp(&dot_i(a, b, pts[j])).then(pts[i].cmp(&pts[j]))
        });
        let mut out: Vec<P> = Vec::with_capacity(order.len());
        for p in order.into_iter().map(|i| pts[i]) {
            if p != a && p != b && out.last() != Some(&p) {
                out.push(p);
            }
        }
        *pts = out;
    }
    Ok(inner)
}

/// Deux arêtes ne se rencontrent qu'à une extrémité commune : ni croisement, ni
/// sommet de l'une à l'intérieur de l'autre (entiers, exact).
fn is_noded(edges: &[(P, P)], dl: &Deadline) -> Res<bool> {
    let boxes: Vec<[f64; 4]> = edges.iter().map(|&(a, b)| edge_box(f(a), f(b))).collect();
    let mut ok = true;
    let inside = |p: P, a: P, b: P| {
        p != a && p != b && cross_i(a, b, p) == 0 && dot_i(p, a, b) < 0
    };
    box_pairs(&boxes, dl, &mut |i, j| {
        let ((a, b), (c, d)) = (edges[i], edges[j]);
        let (o1, o2) = (cross_i(a, b, c).signum(), cross_i(a, b, d).signum());
        let (o3, o4) = (cross_i(c, d, a).signum(), cross_i(c, d, b).signum());
        let meet = (o1 * o2 < 0 && o3 * o4 < 0)
            || (o1 == 0 && inside(c, a, b))
            || (o2 == 0 && inside(d, a, b))
            || (o3 == 0 && inside(a, c, d))
            || (o4 == 0 && inside(b, c, d));
        ok &= !meet;
        Ok(())
    })?;
    Ok(ok)
}

/// Nodage complet : rend, pour chaque segment d'entrée, sa ligne brisée sur la
/// grille (extrémités comprises).
fn node_all(segs: &[(P, P)], dl: &Deadline) -> Res<Vec<Vec<P>>> {
    let mut paths: Vec<Vec<P>> = segs.iter().map(|&(a, b)| vec![a, b]).collect();
    for _ in 0..MAX_PASSES {
        let (edges, steps) = unique_edges(&paths);
        let inner = snap_round(&edges, dl)?;
        for (path, steps) in paths.iter_mut().zip(&steps) {
            let mut out: Vec<P> = Vec::with_capacity(path.len());
            for (w, &e) in path.windows(2).zip(steps) {
                out.push(w[0]);
                if let Some(pts) = inner.get(e as usize) {
                    let n = pts.len();
                    let fwd = w[0] < w[1];
                    out.extend((0..n).map(|i| pts[if fwd { i } else { n - 1 - i }]));
                }
            }
            out.extend(path.last());
            *path = out;
        }
        if is_noded(&unique_edges(&paths).0, dl)? {
            return Ok(paths);
        }
    }
    Err(SheetCutError::Failed("noding"))
}

// ---------------------------------------------------------- arrangement

/// Anneaux de l'arrangement : 0 = contour, `1..=n_holes` = zones, puis défauts,
/// puis reprises.
struct Arrangement {
    verts: Vec<P>,
    /// (petit indice, grand indice) de sommets.
    edges: Vec<(u32, u32)>,
    /// Par arête : (anneau, passages nets du petit vers le grand indice), ≠ 0.
    /// Vide : l'arête ne change aucun enroulement, elle est ignorée (sauf `folded`).
    memb: Vec<Vec<(u32, i32)>>,
    /// Par arête : un défaut y passe autant dans un sens que dans l'autre (trait,
    /// pointe, bout aplati par la grille). Elle n'ôte rien, mais doit être vue.
    folded: Vec<bool>,
    /// Par anneau : (arête, sens), dans l'ordre du tracé.
    ring_edges: Vec<Vec<(u32, bool)>>,
    ring_boxes: Vec<[i64; 4]>,
    /// Point -> sommet ; arête -> numéro ; (anneau, sommet) : sommet d'entrée
    /// de cet anneau.
    ids: Index,
    at: Index,
    own: Index,
    /// Le contour (sommets d'entrée sur la grille).
    rim: Vec<Pt>,
    n_holes: usize,
    max_shift: f64,
}

fn point_segment(p: Pt, a: Pt, b: Pt) -> (f64, f64) {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let (ex, ey) = (p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    ((ex * ex + ey * ey).sqrt(), t)
}

impl Arrangement {
    fn build(rings: &[RingIn], n_holes: usize, repairs: &[Vec<P>], dl: &Deadline) -> Res<Self> {
        let chains: Vec<&[P]> = rings
            .iter()
            .map(|r| r.chain.as_slice())
            .chain(repairs.iter().map(|r| r.as_slice()))
            .collect();
        let mut segs: Vec<(P, P)> = Vec::new();
        let mut first: Vec<usize> = Vec::with_capacity(chains.len() + 1);
        for c in &chains {
            first.push(segs.len());
            if c.len() >= 2 {
                segs.extend((0..c.len()).map(|i| (c[i], c[(i + 1) % c.len()])));
            }
        }
        first.push(segs.len());
        let paths = node_all(&segs, dl)?;

        let mut a = Arrangement {
            verts: Vec::new(),
            edges: Vec::new(),
            memb: Vec::new(),
            folded: Vec::new(),
            ring_edges: Vec::with_capacity(chains.len()),
            ring_boxes: chains.iter().map(|c| bbox_i(c)).collect(),
            ids: Index::default(),
            at: Index::default(),
            own: Index::default(),
            rim: chains[0].iter().map(|&p| f(p)).collect(),
            n_holes,
            max_shift: 0.0,
        };
        for (k, c) in chains.iter().enumerate() {
            dl.check()?;
            let mut list: Vec<(u32, bool)> = Vec::new();
            for (s, path) in paths[first[k]..first[k + 1]].iter().enumerate() {
                for w in path.windows(2) {
                    if w[0] == w[1] {
                        continue;
                    }
                    let mut id = |p: P| {
                        let (v, new) = a.ids.or_insert(p, a.verts.len() as u32);
                        if new {
                            a.verts.push(p);
                        }
                        v
                    };
                    let (u, v) = (id(w[0]), id(w[1]));
                    let fwd = u < v;
                    let (e, new) = a.at.or_insert(edge_key(u, v), a.edges.len() as u32);
                    if new {
                        a.edges.push((u.min(v), u.max(v)));
                        a.memb.push(Vec::new());
                    }
                    let m = if fwd { 1 } else { -1 };
                    match a.memb[e as usize].iter_mut().find(|x| x.0 == k as u32) {
                        Some(x) => x.1 += m,
                        None => a.memb[e as usize].push((k as u32, m)),
                    }
                    list.push((e, fwd));
                }
                // Écart au tracé d'entrée (arête non arrondie) : la distance à
                // un segment est convexe, le pire est sur un sommet du chemin.
                if let Some(r) = rings.get(k) {
                    let n = r.raw.len();
                    for p in path {
                        let (d, _) = point_segment(f(*p), r.raw[s], r.raw[(s + 1) % n]);
                        a.max_shift = a.max_shift.max(d);
                    }
                }
            }
            for &p in c.iter() {
                if let Some(v) = a.ids.get(p) {
                    a.own.or_insert(half_key(k as u32, v), 0);
                }
            }
            a.ring_edges.push(list);
        }
        for m in a.memb.iter_mut() {
            m.retain(|x| x.1 != 0);
        }
        a.folded = vec![false; a.edges.len()];
        for k in 1 + n_holes..rings.len() {
            for &(e, _) in &a.ring_edges[k] {
                a.folded[e as usize] |= !a.turns(e, k);
            }
        }
        // Un défaut réduit à une seule arête isolée n'a pas de face à parcourir ; il est
        // aligné, donc épaissi dès le premier tour.
        let mut degree = vec![0u32; a.verts.len()];
        for (e, &(u, v)) in a.edges.iter().enumerate() {
            if a.folded[e] || !a.memb[e].is_empty() {
                degree[u as usize] += 1;
                degree[v as usize] += 1;
            }
        }
        for (e, &(u, v)) in a.edges.iter().enumerate() {
            a.folded[e] &= degree[u as usize] + degree[v as usize] > 2;
        }
        a.max_shift /= GRID;
        if a.max_shift > MAX_SHIFT_MM {
            return Err(SheetCutError::Failed("shift"));
        }
        Ok(a)
    }

    /// L'arête change-t-elle l'enroulement de l'anneau `k` ?
    fn turns(&self, e: u32, k: usize) -> bool {
        self.memb[e as usize].iter().any(|x| x.0 as usize == k)
    }

    /// L'anneau couvre-t-il quelque chose ? (une arête au moins change son
    /// enroulement).
    fn ring_covers(&self, k: usize) -> bool {
        self.ring_edges[k].iter().any(|&(e, _)| self.turns(e, k))
    }

    /// Portions du défaut `k` repliées sur elles-mêmes et restées dans la tôle utile :
    /// ni ôtées, ni couvertes par autre chose. Épaissies.
    fn lost_runs(&self, k: usize, faces: &Faces, out: &mut Repairs) -> Res<()> {
        let list = &self.ring_edges[k];
        let n = list.len();
        let mut lost: Vec<bool> = Vec::with_capacity(n);
        for &(e, _) in list {
            let (u, v) = self.edges[e as usize];
            lost.push(
                self.folded[e as usize]
                    && !self.turns(e, k)
                    && (faces.class_of(u, v)? | faces.class_of(v, u)?) & USABLE != 0,
            );
        }
        if !lost.contains(&true) {
            return Ok(());
        }
        let mut run: Vec<P> = Vec::new();
        for (i, &(e, fwd)) in list.iter().enumerate() {
            let (u, v) = self.edges[e as usize];
            let (a, b) = if fwd { (u, v) } else { (v, u) };
            if lost[i] {
                if run.is_empty() {
                    run.push(self.verts[a as usize]);
                }
                run.push(self.verts[b as usize]);
            }
            if !run.is_empty() && (!lost[i] || i + 1 == n) {
                let b = bbox_i(&run);
                if (b[2] - b[0]).max(b[3] - b[1]) > RESIDUE {
                    out.thicken_path(&run);
                }
                run.clear();
            }
        }
        Ok(())
    }

    /// L'arête vient d'un défaut ou d'une reprise.
    fn is_defect(&self, e: u32) -> bool {
        self.memb[e as usize].iter().any(|x| x.0 as usize > self.n_holes)
    }

    fn pt(&self, v: u32) -> Pt {
        f(self.verts[v as usize])
    }

    /// Indices de sommets d'un cycle rendu par la polygonisation.
    fn ids_of(&self, cycle: &[Pt]) -> Res<Vec<u32>> {
        cycle
            .iter()
            .map(|q| self.ids.get([q[0] as i64, q[1] as i64]).ok_or(SheetCutError::Failed("vertex")))
            .collect()
    }

    /// Numéro de l'arête `u`-`v`.
    fn edge(&self, u: u32, v: u32) -> Option<u32> {
        self.at.get(edge_key(u, v))
    }
}

/// Parcours des enroulements : compteurs tenus à jour à chaque arête traversée.
struct Winding {
    w: Vec<i32>,
    n_holes: usize,
    holes: usize,
    covers: usize,
}

impl Winding {
    fn add(&mut self, ring: u32, delta: i32) {
        let k = ring as usize;
        let before = self.w[k];
        let after = before + delta;
        self.w[k] = after;
        if k == 0 || (before == 0) == (after == 0) {
            return;
        }
        let hole = k <= self.n_holes;
        if after != 0 {
            self.covers += 1;
            self.holes += hole as usize;
        } else {
            self.covers -= 1;
            self.holes -= hole as usize;
        }
    }
    /// Classe de la face courante.
    fn class(&self) -> u8 {
        let inside = self.w[0] & 1 != 0;
        SEEN | if inside { INSIDE } else { 0 }
            | if self.covers > 0 { COVERED } else { 0 }
            | if inside && self.covers == 0 { USABLE } else { 0 }
            | if inside && self.holes == 0 { ORIGINAL } else { 0 }
    }
}

// Bits de classe d'une face (0 : pas encore vue). `ORIGINAL` : utile avant les
// défauts.
const SEEN: u8 = 1;
const USABLE: u8 = 2;
const ORIGINAL: u8 = 4;
const INSIDE: u8 = 8;
const COVERED: u8 = 16;

/// Faces de l'arrangement : arêtes vivantes, demi-arête -> cycle à sa gauche,
/// classe et aire double signée de chaque cycle.
struct Faces {
    alive: Vec<u32>,
    half: Index,
    class: Vec<u8>,
    areas: Vec<i128>,
}

impl Faces {
    fn class_of(&self, u: u32, v: u32) -> Res<u8> {
        self.half
            .get(half_key(u, v))
            .map(|c| self.class[c as usize])
            .ok_or(SheetCutError::Failed("half edge"))
    }
    /// Aire double d'une classe : somme des aires signées de ses cycles (un trou
    /// d'une face est un cycle d'aire négative de même classe).
    fn area2(&self, bit: u8) -> i128 {
        self.areas.iter().zip(&self.class).filter(|(_, c)| *c & bit != 0).map(|(a, _)| a).sum()
    }
}

/// Morceau en indices de sommets : boucle extérieure (aire > 0), trous (aire < 0).
struct Region {
    outer: Vec<u32>,
    holes: Vec<Vec<u32>>,
    net2: i128,
    sliver: bool,
}

/// Boucle simple du bord : sommets, points, aire double signée, boîte.
struct Loop {
    ids: Vec<u32>,
    pts: Vec<P>,
    area2: i128,
    bbox: [i64; 4],
}

/// Boucles extérieures, boucles de trous, et les trous de chaque extérieure.
type Border = (Vec<Loop>, Vec<Loop>, Vec<Vec<usize>>);

/// Interdits : boucles de l'arrangement, et anneaux simples livrés.
struct Hazards {
    loops: Vec<Vec<u32>>,
    rings: Vec<Vec<P>>,
}

struct Regions {
    regions: Vec<Region>,
    usable2: i128,
    original2: i128,
}

impl Arrangement {
    fn ring_p(&self, ids: &[u32]) -> Vec<P> {
        ids.iter().map(|&v| self.verts[v as usize]).collect()
    }

    fn faces(&self, dl: &Deadline) -> Res<Faces> {
        let alive: Vec<u32> = (0..self.edges.len() as u32)
            .filter(|&e| !self.memb[e as usize].is_empty() || self.folded[e as usize])
            .collect();
        let segs: Vec<(Pt, Pt)> = alive
            .iter()
            .map(|&e| {
                let (u, v) = self.edges[e as usize];
                (self.pt(u), self.pt(v))
            })
            .collect();
        let raw = assemble::polygonize_until(&[], &segs, dl)?;
        let mut cycles: Vec<Vec<u32>> = Vec::with_capacity(raw.len());
        for (i, c) in raw.iter().enumerate() {
            dl.check_at(i)?;
            cycles.push(self.ids_of(c)?);
        }
        drop(raw);
        // Demi-arête -> cycle à sa gauche.
        let mut half = Index::default();
        let mut filled = 0usize;
        for (c, cyc) in cycles.iter().enumerate() {
            dl.check_at(c)?;
            for k in 0..cyc.len() {
                filled += half.or_insert(half_key(cyc[k], cyc[(k + 1) % cyc.len()]), c as u32).1 as usize;
            }
        }
        if filled != 2 * alive.len() {
            return Err(SheetCutError::Failed("half edges"));
        }
        let side = |u: u32, v: u32| half.get(half_key(u, v)).ok_or(SheetCutError::Failed("half edge"));

        // Composantes connexes (union-find) et caractéristique d'Euler.
        let none = u32::MAX;
        let mut up: Vec<u32> = (0..self.verts.len() as u32).collect();
        fn root(up: &mut [u32], mut x: u32) -> u32 {
            while up[x as usize] != x {
                up[x as usize] = up[up[x as usize] as usize];
                x = up[x as usize];
            }
            x
        }
        let mut live_vert = vec![false; self.verts.len()];
        for &e in &alive {
            let (u, v) = self.edges[e as usize];
            live_vert[u as usize] = true;
            live_vert[v as usize] = true;
            let (a, b) = (root(&mut up, u), root(&mut up, v));
            if a != b {
                up[a.max(b) as usize] = a.min(b);
            }
        }
        let comp: Vec<u32> = (0..self.verts.len() as u32)
            .map(|v| if live_vert[v as usize] { root(&mut up, v) } else { none })
            .collect();
        // Sommets − arêtes + faces de chaque composante (rangée à sa racine).
        let mut euler: Vec<i64> = vec![0; self.verts.len()];
        for &c in comp.iter().filter(|&&c| c != none) {
            euler[c as usize] += 1;
        }
        for &e in &alive {
            euler[comp[self.edges[e as usize].0 as usize] as usize] -= 1;
        }
        // Cycle extérieur de chaque composante : le seul d'aire ≤ 0.
        let areas: Vec<i128> = cycles.iter().map(|c| area2(&self.ring_p(c))).collect();
        let mut roots: Vec<(u32, u32)> = Vec::new(); // (composante, cycle)
        let mut rooted = vec![0u32; self.verts.len()];
        for (c, cyc) in cycles.iter().enumerate() {
            let k = comp[cyc[0] as usize];
            euler[k as usize] += 1;
            if areas[c] <= 0 {
                rooted[k as usize] += 1;
                roots.push((k, c as u32));
            }
        }
        let planar = |v: usize| comp[v] != v as u32 || (euler[v] == 2 && rooted[v] == 1);
        if !(0..comp.len()).all(planar) {
            return Err(SheetCutError::Failed("euler"));
        }

        // Propagation des enroulements, composante par composante.
        let mut class: Vec<u8> = vec![0; cycles.len()];
        let mut st = Winding {
            w: vec![0; self.ring_edges.len()],
            n_holes: self.n_holes,
            holes: 0,
            covers: 0,
        };
        enum Ev {
            Enter(u32, u32, i32),
            Exit(u32, i32),
        }
        let step = |st: &mut Winding, e: u32, s: i32| {
            if e != none {
                for &(r, m) in &self.memb[e as usize] {
                    st.add(r, s * m);
                }
            }
        };
        let mut ticks = 0usize;
        for (ri, &(k, root_cycle)) in roots.iter().enumerate() {
            dl.check_at(ri)?;
            let base = self.base_windings(k, cycles[root_cycle as usize][0], &comp, dl)?;
            for &(r, w) in &base {
                st.add(r, w);
            }
            let mut stack = vec![Ev::Enter(root_cycle, none, 0)];
            while let Some(ev) = stack.pop() {
                ticks += 1;
                dl.check_at(ticks)?;
                match ev {
                    Ev::Exit(e, s) => step(&mut st, e, -s),
                    Ev::Enter(c, e, s) => {
                        if class[c as usize] != 0 {
                            continue;
                        }
                        step(&mut st, e, s);
                        class[c as usize] = st.class();
                        stack.push(Ev::Exit(e, s));
                        let cyc = &cycles[c as usize];
                        for i in 0..cyc.len() {
                            let (u, v) = (cyc[i], cyc[(i + 1) % cyc.len()]);
                            let next = side(v, u)?;
                            if class[next as usize] != 0 {
                                continue;
                            }
                            // De la gauche de u->v vers sa droite : l'anneau qui
                            // passe de u à v a son intérieur à gauche.
                            let e = self.edge(u, v).ok_or(SheetCutError::Failed("edge"))?;
                            stack.push(Ev::Enter(next, e, if u < v { -1 } else { 1 }));
                        }
                    }
                }
            }
            for &(r, w) in &base {
                st.add(r, -w);
            }
        }

        Ok(Faces { alive, half, class, areas })
    }

    /// Bord d'un ensemble de faces : `side(u, v)` dit si la face à gauche de la
    /// demi-arête en est (`None` : arête intérieure à l'ensemble ou à son
    /// complément, ignorée). Rend les boucles simples extérieures, les boucles de
    /// trous, et pour chaque extérieure ses trous.
    fn border(
        &self,
        faces: &Faces,
        side: &dyn Fn(u32, u32) -> Res<Option<bool>>,
        dl: &Deadline,
    ) -> Res<Border> {
        // Dissolution : seules restent les arêtes entre l'ensemble et le reste.
        let mut left = Index::default();
        let mut border: Vec<(Pt, Pt)> = Vec::new();
        for &e in &faces.alive {
            let (u, v) = self.edges[e as usize];
            if let (Some(l), Some(r)) = (side(u, v)?, side(v, u)?)
                && l != r
            {
                left.or_insert(if l { half_key(u, v) } else { half_key(v, u) }, 0);
                border.push((self.pt(u), self.pt(v)));
            }
        }
        let mut outers: Vec<Loop> = Vec::new();
        let mut inners: Vec<Loop> = Vec::new();
        for (i, cyc) in assemble::polygonize_until(&[], &border, dl)?.iter().enumerate() {
            dl.check_at(i)?;
            let c = self.ids_of(cyc)?;
            let on_left =
                (0..c.len()).filter(|&k| left.has(half_key(c[k], c[(k + 1) % c.len()]))).count();
            if on_left == 0 {
                continue; // le même bord vu de l'autre côté
            }
            if on_left != c.len() {
                return Err(SheetCutError::Failed("border side"));
            }
            for l in split_simple_loops(cyc) {
                let ids = self.ids_of(&l)?;
                let pts = self.ring_p(&ids);
                let l = Loop { area2: area2(&pts), bbox: bbox_i(&pts), ids, pts };
                match l.area2.cmp(&0) {
                    Ordering::Greater => outers.push(l),
                    Ordering::Less => inners.push(l),
                    Ordering::Equal => {}
                }
            }
        }
        // Un trou appartient au plus petit contour qui le contient. Le milieu
        // d'une de ses arêtes n'est sur aucun autre bord (arrangement nodé).
        let mut holes_of: Vec<Vec<usize>> = vec![Vec::new(); outers.len()];
        for (h, hole) in inners.iter().enumerate() {
            dl.check_at(h)?;
            let (a, b) = (hole.pts[0], hole.pts[1]);
            let mid2 = [a[0] + b[0], a[1] + b[1]];
            let owner = (0..outers.len())
                .filter(|&o| {
                    let b = outers[o].bbox;
                    mid2[0] >= 2 * b[0]
                        && mid2[0] <= 2 * b[2]
                        && mid2[1] >= 2 * b[1]
                        && mid2[1] <= 2 * b[3]
                        && contains2(&outers[o].pts, mid2)
                })
                .min_by(|&p, &q| outers[p].area2.cmp(&outers[q].area2).then(p.cmp(&q)))
                .ok_or(SheetCutError::Failed("hole owner"))?;
            holes_of[owner].push(h);
        }
        Ok((outers, inners, holes_of))
    }

    fn regions(&self, faces: &Faces, dl: &Deadline) -> Res<Regions> {
        let usable = |u: u32, v: u32| Ok(Some(faces.class_of(u, v)? & USABLE != 0));
        let (outers, inners, holes_of) = self.border(faces, &usable, dl)?;
        let (usable2, original2) = (faces.area2(USABLE), faces.area2(ORIGINAL));
        let net = |o: usize| {
            outers[o].area2 + holes_of[o].iter().map(|&h| inners[h].area2).sum::<i128>()
        };
        // Plus grande aire nette d'abord ; égalité : boîte puis premier sommet.
        let order = sorted(outers.len(), &|p, q| {
            net(q)
                .cmp(&net(p))
                .then_with(|| outers[p].bbox.cmp(&outers[q].bbox))
                .then_with(|| outers[p].pts.iter().min().cmp(&outers[q].pts.iter().min()))
        });
        let mut regions: Vec<Region> = Vec::with_capacity(outers.len());
        for o in order {
            let net2 = net(o);
            let mut perim = perimeter(&outers[o].pts);
            perim += holes_of[o].iter().map(|&h| perimeter(&inners[h].pts)).sum::<f64>();
            // Un contour trop fin l'est aussi avec ses trous (aire moindre,
            // périmètre plus grand) : un seul test.
            regions.push(Region {
                outer: outers[o].ids.clone(),
                holes: holes_of[o].iter().map(|&h| inners[h].ids.clone()).collect(),
                net2,
                sliver: too_thin(net2, perim),
            });
        }
        if regions.iter().map(|r| r.net2).sum::<i128>() != usable2 {
            return Err(SheetCutError::Failed("area sum"));
        }
        Ok(Regions { regions, usable2, original2 })
    }

    /// Enroulement de chaque anneau vu de la face qui entoure la composante `k`
    /// (compté sur les arêtes des AUTRES composantes, depuis le sommet `v`).
    fn base_windings(&self, k: u32, v: u32, comp: &[u32], dl: &Deadline) -> Res<Vec<(u32, i32)>> {
        let p = self.verts[v as usize];
        let mut out = Vec::new();
        for (r, list) in self.ring_edges.iter().enumerate() {
            dl.check_at(r)?;
            let b = self.ring_boxes[r];
            // Deux unités de marge : le nodage peut déplacer une arête.
            if p[0] < b[0] - 2 || p[0] > b[2] + 2 || p[1] < b[1] - 2 || p[1] > b[3] + 2 {
                continue;
            }
            let mut w = 0i32;
            for &(e, fwd) in list {
                let (lo, hi) = self.edges[e as usize];
                if self.memb[e as usize].is_empty() || comp[lo as usize] == k {
                    continue;
                }
                let (a, c) = if fwd { (lo, hi) } else { (hi, lo) };
                let (a, c) = (self.verts[a as usize], self.verts[c as usize]);
                if (a[1] > p[1]) == (c[1] > p[1]) {
                    continue;
                }
                let x = cross_i(a, c, p);
                if c[1] > a[1] && x > 0 {
                    w += 1;
                } else if c[1] < a[1] && x < 0 {
                    w -= 1;
                }
            }
            if w != 0 {
                out.push((r as u32, w));
            }
        }
        Ok(out)
    }

    // ------------------------------------------------------ interdits

    /// Interdits sur le contour d'origine, pour le morceau retenu `reg` : bord de
    /// tout ce qui, DANS le contour, est couvert ou perdu. Rend les boucles (pour y
    /// chercher les goulets) et les anneaux simples livrés.
    fn hazards(
        &self,
        faces: &Faces,
        reg: &Region,
        known: &Known,
        rim: bool,
        dl: &Deadline,
    ) -> Res<Hazards> {
        // Demi-arêtes qui ont le morceau retenu à leur gauche.
        let mut kept = Index::default();
        for l in std::iter::once(&reg.outer).chain(&reg.holes) {
            for i in 0..l.len() {
                kept.or_insert(half_key(l[i], l[(i + 1) % l.len()]), 0);
            }
        }
        let side = |u: u32, v: u32| {
            let c = faces.class_of(u, v)?;
            Ok(if c & USABLE == 0 {
                Some(c & COVERED != 0 && c & INSIDE != 0)
            } else if faces.class_of(v, u)? & USABLE != 0 {
                None // intérieure à un morceau
            } else {
                Some(!kept.has(half_key(u, v)))
            })
        };
        let (outers, inners, holes_of) = self.border(faces, &side, dl)?;
        let mut out = Hazards { loops: Vec::new(), rings: Vec::new() };
        for (o, lobe) in outers.iter().enumerate() {
            dl.check_at(o)?;
            out.loops.push(lobe.ids.clone());
            // Dans un contour simple, une poche ne peut être que le morceau retenu
            // (tout le reste de la tôle est interdit) : le lobe l'entoure, son bord
            // est le contour lui-même.
            let mut pockets = holes_of[o].iter().map(|&h| &inners[h]).filter(|q| {
                let n = q.ids.len();
                (0..n).any(|i| kept.has(half_key(q.ids[(i + 1) % n], q.ids[i])))
            });
            match (pockets.next(), pockets.next()) {
                (None, _) => {
                    let ring = self.clean_loop(&lobe.ids, rim);
                    if known.hole(&ring).is_some() {
                        out.rings.push(ring);
                    } else {
                        out.rings.extend(split_lobe(ring, &self.ring_p(&reg.outer), dl)?);
                    }
                }
                (Some(q), None) => {
                    out.loops.push(q.ids.clone());
                    let mut pair = [&lobe.ids, &q.ids].map(|l| self.clean_loop(l, rim));
                    if !rim || !rings_noded(&pair, dl)? {
                        // Boucles brutes : un nœud aligné où le bord et la poche se
                        // touchent doit rester un sommet des deux (il sera soudé).
                        pair = [&lobe.pts, &q.pts].map(|l| canonical(l.clone()));
                    }
                    let halves = split_annulus(&pair[0], &pair[1])
                        .ok_or(SheetCutError::Failed("annulus"))?;
                    out.rings.extend(halves);
                }
                _ => return Err(SheetCutError::Failed("pockets")),
            }
        }
        Ok(out)
    }

    // ------------------------------------------------------ reprises

    /// Reprises d'un morceau, une famille à la fois (les contacts d'abord : deux
    /// lobes soudés ne sont plus fins).
    fn repairs_of(&self, reg: &Region, dl: &Deadline, out: &mut Repairs) -> Res<()> {
        // 1. Sommet commun à deux passages du bord.
        let mut around: Vec<Vec<Pt>> = vec![Vec::new(); self.verts.len()];
        for l in std::iter::once(&reg.outer).chain(&reg.holes) {
            let n = l.len();
            for i in 0..n {
                around[l[i] as usize].extend([self.pt(l[(i + n - 1) % n]), self.pt(l[(i + 1) % n])]);
            }
        }
        for (v, ends) in around.iter().enumerate() {
            if ends.len() > 2 {
                out.weld(self.pt(v as u32), ends);
            }
        }
        if !out.rects.is_empty() {
            return Ok(());
        }
        // 2. Trou trop fin, si un défaut y est pour quelque chose (une zone
        // d'entrée intacte est celle d'avant).
        for h in &reg.holes {
            let pts = self.ring_p(h);
            if too_thin(area2(&pts).abs(), perimeter(&pts)) && self.defect_steps(h).contains(&true) {
                out.thicken_all(&pts);
            }
        }
        if !out.rects.is_empty() {
            return Ok(());
        }
        // 3. Goulets et fentes d'un même anneau.
        for l in std::iter::once(&reg.outer).chain(&reg.holes) {
            self.narrow_spots(l, dl, out)?;
        }
        Ok(())
    }

    /// Pour chaque pas de la boucle : l'arête vient d'un défaut ou d'une reprise.
    fn defect_steps(&self, l: &[u32]) -> Vec<bool> {
        (0..l.len())
            .map(|i| self.edge(l[i], l[(i + 1) % l.len()]).is_some_and(|e| self.is_defect(e)))
            .collect()
    }

    /// Sommet à moins de `CLEARANCE_MM` d'une arête du même anneau, sans en être
    /// voisin : la portion proche est épaissie. Seulement si un défaut est en jeu.
    fn narrow_spots(&self, l: &[u32], dl: &Deadline, out: &mut Repairs) -> Res<()> {
        let n = l.len();
        let clear = CLEARANCE_MM * GRID;
        let pts: Vec<Pt> = l.iter().map(|&v| self.pt(v)).collect();
        let mut along = vec![0.0f64; n + 1];
        for i in 0..n {
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            along[i + 1] = along[i] + assemble::dist2(a, b).sqrt();
        }
        let total = along[n];
        let defect = self.defect_steps(l);
        if !defect.contains(&true) {
            return Ok(());
        }
        let mut boxes: Vec<[f64; 4]> =
            (0..n).map(|i| edge_box(pts[i], pts[(i + 1) % n])).collect();
        boxes.extend(
            pts.iter().map(|p| [p[0] - clear, p[1] - clear, p[0] + clear, p[1] + clear]),
        );
        box_pairs(&boxes, dl, &mut |x, y| {
            let (j, i) = (x.min(y), x.max(y));
            if j >= n || i < n {
                return Ok(());
            }
            let i = i - n;
            let prev = (i + n - 1) % n;
            if j == i || j == prev || !(defect[i] || defect[prev] || defect[j]) {
                return Ok(());
            }
            let (a, b) = (pts[j], pts[(j + 1) % n]);
            let (d, t) = point_segment(pts[i], a, b);
            let s = (along[j] + t * (along[j + 1] - along[j]) - along[i]).abs();
            if d >= clear || s.min(total - s) <= CLEARANCE_ALONG * clear {
                return Ok(());
            }
            // Une encoche du contour LUI-MÊME : le vide est hors de la tôle, rien ne
            // peut l'épaissir.
            let mid = [
                (pts[i][0] + a[0] + t * (b[0] - a[0])) / 2.0,
                (pts[i][1] + a[1] + t * (b[1] - a[1])) / 2.0,
            ];
            if !assemble::point_in_ring(mid, &self.rim) {
                return Ok(());
            }
            out.thicken_near(pts[i], [pts[prev], pts[(i + 1) % n]], a, b);
            if out.rects.len() > MAX_REPAIRS {
                return Err(SheetCutError::TooComplex);
            }
            Ok(())
        })
    }

    /// Boucle nettoyée, anti-horaire, départ au plus petit x puis y. Un nœud de
    /// croisement (qui n'est pas un sommet d'entrée de l'anneau qui passe là) disparaît
    /// s'il est exactement aligné. Avec `rim`, ceux du contour disparaissent aussi quand
    /// tous ceux d'un même côté sont à un pas et demi de sa corde : le bord redevient
    /// l'arête d'entrée du contour.
    fn clean_loop(&self, l: &[u32], rim: bool) -> Vec<P> {
        let n = l.len();
        let at = |i: usize| self.verts[l[i % n] as usize];
        // 0 : gardé ; 1 : aligné ; 2 : nœud du contour.
        let kind: Vec<u8> = (0..n)
            .map(|i| {
                let (u, v, w) = (l[(i + n - 1) % n], l[i], l[(i + 1) % n]);
                let (Some(e), Some(g)) = (self.edge(u, v), self.edge(v, w)) else { return 0 };
                let (pu, pv, pw) = (at(i + n - 1), at(i), at(i + 1));
                // Anneaux communs aux deux arêtes ; `v` en est-il un sommet ?
                let both = |r: u32| self.memb[g as usize].iter().any(|y| y.0 == r);
                let own = |r: u32| self.own.has(half_key(r, v));
                let rings = || self.memb[e as usize].iter().map(|x| x.0).filter(|&r| both(r));
                if cross_i(pu, pv, pw) == 0 && dot_i(pv, pu, pw) < 0 && !rings().any(own) {
                    1
                } else if rim && rings().any(|r| r == 0) && !own(0) {
                    2
                } else {
                    0
                }
            })
            .collect();
        let kept: Vec<usize> = (0..n).filter(|&i| kind[i] == 0).collect();
        if kept.len() < 2 {
            return canonical((0..n).filter(|&i| kind[i] != 1).map(at).collect());
        }
        let mut out: Vec<P> = Vec::with_capacity(n);
        for (k, &i) in kept.iter().enumerate() {
            let j = if k + 1 < kept.len() { kept[k + 1] } else { kept[0] + n };
            out.push(at(i));
            let nodes = || (i + 1..j).filter(|&m| kind[m % n] == 2);
            if nodes().any(|m| point_segment(f(at(m)), f(at(i)), f(at(j))).0 > 1.5) {
                out.extend(nodes().map(at));
            }
        }
        if out.len() < 3 {
            return canonical((0..n).filter(|&i| kind[i] != 1).map(at).collect());
        }
        canonical(out)
    }

    /// Contour puis trous d'un morceau.
    fn rings_of(&self, reg: &Region, rim: bool) -> Vec<Vec<P>> {
        std::iter::once(&reg.outer).chain(&reg.holes).map(|l| self.clean_loop(l, rim)).collect()
    }
}

/// Les anneaux ne se croisent pas et ne se touchent qu'en des sommets communs.
fn rings_noded(rings: &[Vec<P>], dl: &Deadline) -> Res<bool> {
    let edges: Vec<(P, P)> = rings
        .iter()
        .flat_map(|r| (0..r.len()).map(move |i| (r[i], r[(i + 1) % r.len()])))
        .collect();
    is_noded(&edges, dl)
}

/// Anti-horaire, départ au plus petit x puis y (convention de `SheetContour`).
fn canonical(mut ring: Vec<P>) -> Vec<P> {
    if area2(&ring) < 0 {
        ring.reverse();
    }
    if let Some(k) = (0..ring.len()).min_by_key(|&i| ring[i]) {
        ring.rotate_left(k);
    }
    ring
}

/// Premier point de `ring` au-dessus de `p` (au-dessous si `down`) sur la
/// verticale, à `from` au moins : (arête, point de la grille).
fn vertical_hit(ring: &[P], p: P, down: bool, from: f64) -> Option<(usize, P)> {
    let n = ring.len();
    let mut best: Option<(f64, usize, P)> = None;
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        if p[0] < a[0].min(b[0]) || p[0] > a[0].max(b[0]) {
            continue;
        }
        let mut hits: Vec<(f64, P)> =
            [a, b].into_iter().filter(|v| v[0] == p[0]).map(|v| (v[1] as f64, v)).collect();
        if hits.is_empty() {
            let (dx, dy) = ((b[0] - a[0]) as f64, (b[1] - a[1]) as f64);
            let y = a[1] as f64 + (p[0] - a[0]) as f64 / dx * dy;
            hits.push((y, [p[0], (y + 0.5).floor() as i64]));
        }
        for (y, q) in hits {
            let gap = if down { p[1] as f64 - y } else { y - p[1] as f64 };
            if gap >= from && best.is_none_or(|b| gap < b.0) {
                best = Some((gap, i, q));
            }
        }
    }
    best.map(|b| (b.1, b.2))
}

/// Sommets le plus haut et le plus bas d'un anneau.
fn top_low(ring: &[P]) -> Option<(usize, usize)> {
    let key = |&i: &usize| (ring[i][1], ring[i][0]);
    Some(((0..ring.len()).max_by_key(key)?, (0..ring.len()).min_by_key(key)?))
}

/// Parcours anti-horaire de `ring` du point `a` (arête `ea`) au point `b` (arête `eb`).
fn walk(ring: &[P], ea: usize, a: P, eb: usize, b: P) -> Vec<P> {
    let m = ring.len();
    let at = |x: P| dot_i(ring[ea], ring[(ea + 1) % m], x);
    let mut out = vec![a];
    if ea != eb || at(a) >= at(b) {
        let mut i = ea;
        loop {
            i = (i + 1) % m;
            out.push(ring[i]);
            if i == eb {
                break;
            }
        }
    }
    out.push(b);
    out
}

/// Anneau anti-horaire sans sommet répété ; `None` s'il n'a pas d'aire.
fn close(mut r: Vec<P>) -> Option<Vec<P>> {
    r.dedup();
    while r.len() > 1 && r.first() == r.last() {
        r.pop();
    }
    (r.len() >= 3 && area2(&r) > 0).then(|| canonical(r))
}

/// Couronne (bord `rim`, poche `pocket`, tous deux anti-horaires) coupée en deux
/// polygones simples par les verticales du sommet le plus haut et du sommet le
/// plus bas de la poche. Le bord d'une couronne qui entoure le morceau retenu est le
/// contour : y arrondir un point à la grille le déplace d'un demi-pas au plus, loin
/// de la région utile.
fn split_annulus(rim: &[P], pocket: &[P]) -> Option<[Vec<P>; 2]> {
    let n = pocket.len();
    let (top, low) = top_low(pocket)?;
    let (et, ht) = vertical_hit(rim, pocket[top], false, 0.0)?;
    let (el, hl) = vertical_hit(rim, pocket[low], true, 0.0)?;
    // Poche parcourue en sens horaire de `i` à `j`.
    let back = |i: usize, j: usize| {
        let mut out = vec![pocket[i]];
        let mut k = i;
        while k != j {
            k = (k + n - 1) % n;
            out.push(pocket[k]);
        }
        out
    };
    let left = [walk(rim, et, ht, el, hl), back(low, top)].concat();
    let right = [walk(rim, el, hl, et, ht), back(top, low)].concat();
    Some([close(left)?, close(right)?])
}

/// Lobe (simple, anti-horaire) qui n'entoure pas le morceau retenu mais peut s'en
/// approcher en C : le moteur gonfle chaque interdit seul, une ouverture plus étroite
/// que l'espacement se referme et tout l'intérieur devient interdit. Coupé, comme une
/// couronne, par les verticales des sommets le plus haut et le plus bas du morceau
/// retenu, jusqu'au bord (au-dessus du plus haut il n'y a que de l'interdit, puis le
/// contour). Une coupe n'est gardée que si ses deux moitiés valent seules un interdit.
fn split_lobe(lobe: Vec<P>, kept: &[P], dl: &Deadline) -> Res<Vec<Vec<P>>> {
    let Some((top, low)) = top_low(kept) else { return Ok(vec![lobe]) };
    let mut parts = vec![lobe];
    for (p, down) in [(kept[top], false), (kept[low], true)] {
        for k in 0..parts.len() {
            let ring = &parts[k];
            let Some(i) = ring.iter().position(|&v| v == p) else { continue };
            let Some((e, q)) = vertical_hit(ring, p, down, f64::MIN_POSITIVE) else { continue };
            let before = (i + ring.len() - 1) % ring.len();
            let halves = [walk(ring, i, p, e, q), walk(ring, e, q, before, p)].map(close);
            let [Some(a), Some(b)] = halves else { continue };
            let halves = [a, b];
            let mut bad = Repairs::new(0, &[]);
            for h in &halves {
                if too_thin(area2(h), perimeter(h)) {
                    bad.thicken_all(h);
                }
                engine_conflicts(h, [0, 0], dl, &mut bad)?;
            }
            if bad.rects.is_empty() {
                let [a, b] = halves;
                parts[k] = a;
                parts.push(b);
            }
        }
    }
    Ok(parts)
}

/// `q2` (coordonnées doublées) est-il dans l'anneau ? Exact ; `q2` n'est pas sur
/// le bord.
fn contains2(ring: &[P], q2: P) -> bool {
    let n = ring.len();
    let mut inside = false;
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let (a, b) = ([2 * a[0], 2 * a[1]], [2 * b[0], 2 * b[1]]);
        if (a[1] > q2[1]) != (b[1] > q2[1]) && (cross_i(a, b, q2) > 0) == (b[1] > a[1]) {
            inside = !inside;
        }
    }
    inside
}

/// De `p` vers `far`, dernier point à moins de 1,5 `CLEARANCE_MM` du segment `a`-`b` (la
/// distance à un convexe est convexe : un seul intervalle ; dichotomie à pas fixes). La
/// marge : arrêtée au seuil pile, une reprise laisserait à son bout un passage du seuil,
/// repris au tour suivant, et ainsi de suite.
fn near_until(p: Pt, far: Pt, a: Pt, b: Pt) -> Pt {
    let clear = 1.5 * CLEARANCE_MM * GRID;
    let at = |t: f64| [p[0] + t * (far[0] - p[0]), p[1] + t * (far[1] - p[1])];
    if point_segment(far, a, b).0 <= clear {
        return far;
    }
    let (mut lo, mut hi) = (0.0f64, 1.0f64);
    for _ in 0..40 {
        let m = (lo + hi) / 2.0;
        if point_segment(at(m), a, b).0 <= clear {
            lo = m;
        } else {
            hi = m;
        }
    }
    at(lo)
}

// ------------------------------------------------------ lecture du moteur

/// Le moteur range l'anneau en f32 dans le repère de la tôle (boîte du contour
/// en 0,0), fusionne deux sommets consécutifs à 4 ulp près et refuse tout
/// anneau qui a un sommet en double ou deux arêtes non voisines qui se touchent
/// (`import_simple_polygon`, `SPolygon::new`). Ajoute les reprises qu'il faut, et
/// d'abord la soudure d'un sommet repris deux fois (moitié de couronne dont le bord
/// et la poche se touchent), que la fusion à 4 ulp pourrait cacher.
fn engine_conflicts(ring: &[P], corner: P, dl: &Deadline, out: &mut Repairs) -> Res<()> {
    let m = ring.len();
    let around = |i: usize| [f(ring[(i + m - 1) % m]), f(ring[(i + 1) % m])];
    let mut twice = Index::default();
    for (i, &p) in ring.iter().enumerate() {
        let (j, new) = twice.or_insert(p, i as u32);
        if !new {
            out.weld(f(p), &[around(i), around(j as usize)].concat());
        }
    }
    if !out.rects.is_empty() {
        return Ok(());
    }
    let to = |v: i64| (v as f64 / GRID) as f32;
    let read: Vec<[f32; 2]> =
        ring.iter().map(|p| [to(p[0] - corner[0]), to(p[1] - corner[1])]).collect();
    let near = |a: f32, b: f32| {
        a == b
            || (a - b).abs() <= f32::EPSILON
            || (a.to_bits() as i64 - b.to_bits() as i64).abs() <= 4
    };
    let kept: Vec<usize> = (0..ring.len())
        .filter(|&i| {
            let (a, b) = (read[i], read[(i + 1) % ring.len()]);
            !(near(a[0], b[0]) && near(a[1], b[1]))
        })
        .collect();
    let n = kept.len();
    if n < 3 {
        out.thicken_all(ring);
        return Ok(());
    }
    // Sommet gardé `i` : sur la grille, en f32, et ses deux voisins.
    let p = |i: usize| f(ring[kept[i % n]]);
    let q = |i: usize| read[kept[i % n]].map(|v| v as f64);
    let ends = |i: usize| [p(i + n - 1), p(i + 1)];
    let mut at = Index::default();
    for i in 0..n {
        let (j, new) = at.or_insert(read[kept[i]].map(|v| v.to_bits() as i64), i as u32);
        if !new {
            let j = j as usize;
            out.weld(p(i), &[ends(i), ends(j)].concat());
            out.weld(p(j), &[ends(i), ends(j)].concat());
        }
    }
    let boxes: Vec<[f64; 4]> = (0..n).map(|i| edge_box(q(i), q(i + 1))).collect();
    box_pairs(&boxes, dl, &mut |i, j| {
        let (i, j) = (i.min(j), i.max(j));
        if j == i + 1 || (i == 0 && j == n - 1) || !touch((q(i), q(i + 1)), (q(j), q(j + 1))) {
            return Ok(());
        }
        // Autour du sommet le plus proche de l'autre arête.
        let tips = [(i, j), (i + 1, j), (j, i), (j + 1, i)]
            .map(|(v, e)| (point_segment(q(v), q(e), q(e + 1)).0, v, e));
        let t = tips.iter().skip(1).fold(tips[0], |b, e| if e.0 < b.0 { *e } else { b });
        out.thicken_near(p(t.1), ends(t.1), p(t.2), p(t.2 + 1));
        Ok(())
    })
}

/// Segments fermés qui se touchent (coordonnées f32 : différences et produits
/// exacts en f64).
fn touch(s: (Pt, Pt), t: (Pt, Pt)) -> bool {
    let o = |a: Pt, b: Pt, c: Pt| assemble::cross(assemble::sub(b, a), assemble::sub(c, a));
    let on = |a: Pt, b: Pt, c: Pt| {
        c[0] >= a[0].min(b[0]) && c[0] <= a[0].max(b[0]) && c[1] >= a[1].min(b[1]) && c[1] <= a[1].max(b[1])
    };
    let (d1, d2) = (o(t.0, t.1, s.0), o(t.0, t.1, s.1));
    let (d3, d4) = (o(s.0, s.1, t.0), o(s.0, s.1, t.1));
    if ((d1 > 0.0) != (d2 > 0.0) && d1 != 0.0 && d2 != 0.0)
        && ((d3 > 0.0) != (d4 > 0.0) && d3 != 0.0 && d4 != 0.0)
    {
        return true;
    }
    (d1 == 0.0 && on(t.0, t.1, s.0))
        || (d2 == 0.0 && on(t.0, t.1, s.1))
        || (d3 == 0.0 && on(s.0, s.1, t.0))
        || (d4 == 0.0 && on(s.0, s.1, t.1))
}

// ------------------------------------------------------------------ entrée

/// Région utile d'une tôle (contour moins zones et défauts), propre. Voir
/// l'en-tête du module. Sans défaut, ou si les défauts n'ôtent rien, les
/// anneaux d'entrée ressortent au bit près.
pub fn cut_sheet(
    outer: &[Pt],
    holes: &[Vec<Pt>],
    defects: &[Vec<Pt>],
    dl: &Deadline,
) -> Res<SheetCut> {
    if !finite(outer) || !holes.iter().all(|h| finite(h)) {
        return Err(SheetCutError::BadGeometry);
    }
    if defects.iter().any(|d| d.is_empty() || !finite(d)) {
        return Err(SheetCutError::BadDefect);
    }
    let origin = outer.iter().fold([i64::MAX, i64::MAX], |o, v| {
        [o[0].min(grid_index(v[0])), o[1].min(grid_index(v[1]))]
    });
    if outer.is_empty() {
        return Err(SheetCutError::BadGeometry);
    }
    let outline = to_grid(outer, origin);
    let mut distinct = Index::default();
    if outline.chain.iter().filter(|&&p| distinct.or_insert(p, 0).1).count() < 3
        || assemble::ring_signed_area(outer).abs() * GRID * GRID < 1.0
    {
        return Err(SheetCutError::BadGeometry);
    }
    if defects.is_empty() {
        return Ok(unchanged(outer, holes));
    }
    let obox = bbox_i(&outline.chain);
    let mut rings: Vec<RingIn> = vec![outline];
    rings.extend(holes.iter().map(|h| to_grid(h, origin)));
    let n_holes = holes.len();
    for d in defects {
        let r = to_grid(d, origin);
        let b = bbox_i(&r.chain);
        // Boîtes disjointes : le défaut n'ôte rien.
        if b[0] <= obox[2] && b[2] >= obox[0] && b[1] <= obox[3] && b[3] >= obox[1] {
            rings.push(r);
        }
    }
    let known = Known::new(&rings, n_holes);
    let mut repairs: Vec<Vec<P>> = Vec::new();
    let mut step = 0;
    for round in 0..MAX_ROUNDS {
        dl.check()?;
        if repairs.len() > MAX_REPAIRS {
            return Err(SheetCutError::TooComplex);
        }
        let arr = Arrangement::build(&rings, n_holes, &repairs, dl)?;
        let mut add = Repairs::new(step, &repairs);
        if round == 0 {
            // Défaut sans aire (trait, point), ou aux sommets presque alignés : épaissi
            // d'un bout à l'autre, sur son tracé.
            for (k, r) in rings.iter().enumerate().skip(1 + n_holes) {
                if too_thin(fan2(&r.chain), perimeter(&r.chain)) || !arr.ring_covers(k) {
                    add.thicken_all(&r.chain);
                }
            }
            if !add.rects.is_empty() {
                repairs = add.rects;
                continue;
            }
        }
        let faces = arr.faces(dl)?;
        // À chaque tour : un croisement nouveau peut replier une portion très fine.
        for k in 1 + n_holes..rings.len() {
            arr.lost_runs(k, &faces, &mut add)?;
        }
        if !add.rects.is_empty() {
            let rects = add.rects;
            repairs.extend(rects);
            continue;
        }
        let regs = arr.regions(&faces, dl)?;
        if regs.original2 <= 0 {
            return Err(SheetCutError::NoUsableArea);
        }
        if regs.usable2 == regs.original2 {
            return Ok(unchanged(outer, holes));
        }
        let best = regs
            .regions
            .iter()
            .position(|r| !r.sliver)
            .ok_or(SheetCutError::NoUsableArea)?;
        let reg = &regs.regions[best];
        arr.repairs_of(reg, dl, &mut add)?;
        if add.rects.is_empty() {
            // Le bord remis sur les arêtes du contour, sauf si un détail d'un pas de
            // grille s'y trouvait croisé.
            let mut hz = arr.hazards(&faces, reg, &known, true, dl)?;
            let mut on_grid = arr.rings_of(reg, true);
            if !rings_noded(&hz.rings, dl)? || !rings_noded(&on_grid, dl)? {
                hz = arr.hazards(&faces, reg, &known, false, dl)?;
                on_grid = arr.rings_of(reg, false);
            }
            // Un interdit est un polygone à lui seul : trop fin, il est épaissi
            // (une fente fine à cheval sur le bord n'est pas un trou fin).
            for ring in hz.rings.iter().filter(|r| known.hole(r).is_none()) {
                if too_thin(area2(ring), perimeter(ring)) {
                    add.thicken_all(ring);
                }
            }
            if add.rects.is_empty() {
                for l in &hz.loops {
                    arr.narrow_spots(l, dl, &mut add)?;
                }
            }
            // Dernier contrôle : les anneaux tels que le moteur les lira (la tôle
            // coupée dans son repère, les interdits dans celui du contour).
            if add.rects.is_empty() {
                for ring in hz.rings.iter().filter(|r| known.hole(r).is_none()) {
                    engine_conflicts(ring, [0, 0], dl, &mut add)?;
                }
                let b = bbox_i(&on_grid[0]);
                for ring in &on_grid {
                    engine_conflicts(ring, [b[0], b[1]], dl, &mut add)?;
                }
            }
            if add.rects.is_empty() {
                let n = repairs.len();
                return Ok(emit(&arr, &regs, best, &on_grid, &hz, &known, origin, outer, holes, n));
            }
        }
        let rects = add.rects;
        repairs.extend(rects);
        step += 1;
    }
    Err(SheetCutError::Failed("rounds"))
}

/// Anneaux d'entrée déjà sur la grille (au flou de translation près) : rendus
/// tels quels s'ils ressortent intacts. (forme canonique, rang : 0 = contour.)
struct Known(Vec<(Vec<P>, usize)>);

impl Known {
    fn new(rings: &[RingIn], n_holes: usize) -> Self {
        let on_grid = |r: &RingIn| {
            r.raw.iter().zip(&r.chain).all(|(v, p)| {
                (v[0] - p[0] as f64).abs() <= 1e-9 * GRID && (v[1] - p[1] as f64).abs() <= 1e-9 * GRID
            })
        };
        Known(
            rings[..=n_holes]
                .iter()
                .enumerate()
                .filter(|(_, r)| r.chain.len() >= 3 && on_grid(r))
                .map(|(k, r)| (canonical(r.chain.clone()), k))
                .collect(),
        )
    }
    fn rank(&self, ring: &[P]) -> Option<usize> {
        self.0.iter().find(|x| x.0 == ring).map(|x| x.1)
    }
    /// Rang de la zone d'entrée identique.
    fn hole(&self, ring: &[P]) -> Option<usize> {
        self.rank(ring).filter(|&k| k > 0).map(|k| k - 1)
    }
}

/// Résultat final ; `on_grid` : les anneaux retenus sur la grille, contour en tête.
#[allow(clippy::too_many_arguments)]
fn emit(
    arr: &Arrangement,
    regs: &Regions,
    best: usize,
    on_grid: &[Vec<P>],
    hz: &Hazards,
    known: &Known,
    origin: P,
    outer: &[Pt],
    holes: &[Vec<Pt>],
    repairs: usize,
) -> SheetCut {
    let mm = |ring: &[P]| -> Vec<Pt> {
        let mut r: Vec<Pt> = ring
            .iter()
            .map(|p| [(origin[0] + p[0]) as f64 / GRID, (origin[1] + p[1]) as f64 / GRID])
            .collect();
        if let Some(&p) = r.first() {
            r.push(p);
        }
        r
    };
    // Zones intactes dans leur ordre, puis aire décroissante.
    let ordered = |rings: &[Vec<P>]| -> Vec<Vec<Pt>> {
        let list: Vec<(usize, i128)> =
            rings.iter().map(|p| (known.hole(p).unwrap_or(usize::MAX), area2(p))).collect();
        sorted(rings.len(), &|i, j| {
            list[i].0.cmp(&list[j].0).then(list[j].1.cmp(&list[i].1)).then_with(|| rings[i].cmp(&rings[j]))
        })
        .into_iter()
        .map(|i| holes.get(list[i].0).map_or_else(|| mm(&rings[i]), |h| closed(h)))
        .collect()
    };
    let out_ring = match known.rank(&on_grid[0]) {
        Some(0) => closed(outer),
        _ => mm(&on_grid[0]),
    };
    let lost: Vec<Vec<Vec<P>>> = regs
        .regions
        .iter()
        .enumerate()
        .filter(|&(i, _)| i != best)
        .map(|(_, r)| arr.rings_of(r, false))
        .collect();
    let lost_pieces = lost
        .iter()
        .map(|q| Piece { outer: mm(&q[0]), holes: q[1..].iter().map(|h| mm(h)).collect() })
        .collect();
    // Les aires des anneaux RENDUS (le nettoyage du bord les déplace d'un pas).
    let net = |q: &[Vec<P>]| area2(&q[0]) - q[1..].iter().map(|h| area2(h)).sum::<i128>();
    let usable2 = net(on_grid);
    let lost2: i128 = lost.iter().map(|q| net(q)).sum();
    SheetCut {
        outer: out_ring,
        holes: ordered(&on_grid[1..]),
        usable_area: mm2(usable2),
        pieces: regs.regions.iter().filter(|r| !r.sliver).count(),
        lost_area: mm2(lost2),
        removed_area: mm2(regs.original2 - usable2 - lost2),
        changed: true,
        repairs,
        max_shift: arr.max_shift,
        lost_pieces,
        hazards: ordered(&hz.rings),
    }
}

// -------------------------------------------------------------------- JSON

/// Coordonnée lue d'un nombre JSON, ou d'une CHAÎNE : le lecteur de nombres de
/// serde_json peut se tromper d'un ulp (AGENTS #33d), `str::parse` est exact.
/// Une valeur illisible devient NaN : le refus est le même que pour un NaN.
#[derive(Clone, Copy)]
pub(crate) struct Coord(pub(crate) f64);

impl<'de> serde::Deserialize<'de> for Coord {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(serde::Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Num(f64),
            Text(String),
            Null(()),
        }
        Ok(Coord(match Raw::deserialize(d)? {
            Raw::Num(v) => v,
            Raw::Text(t) => t.trim().parse::<f64>().unwrap_or(f64::NAN),
            Raw::Null(_) => f64::NAN,
        }))
    }
}

/// `{outer, holes?, defects?, time_budget_ms?}` -> `SheetCut` (JSON camelCase).
/// Chaque coordonnée est un nombre ou une chaîne (exacte au bit près).
pub fn cut_sheet_json(json: &str) -> Res<String> {
    #[derive(serde::Deserialize)]
    struct In {
        outer: Vec<[Coord; 2]>,
        #[serde(default)]
        holes: Vec<Vec<[Coord; 2]>>,
        #[serde(default)]
        defects: Vec<Vec<[Coord; 2]>>,
        time_budget_ms: Option<u64>,
    }
    let i: In = serde_json::from_str(json).map_err(|_| SheetCutError::BadInput)?;
    let ring = |r: &Vec<[Coord; 2]>| -> Vec<Pt> { r.iter().map(|p| [p[0].0, p[1].0]).collect() };
    let holes: Vec<Vec<Pt>> = i.holes.iter().map(ring).collect();
    let defects: Vec<Vec<Pt>> = i.defects.iter().map(ring).collect();
    let dl = Deadline::new(i.time_budget_ms.unwrap_or(TIME_BUDGET_MS_BROWSER));
    let cut = cut_sheet(&ring(&i.outer), &holes, &defects, &dl)?;
    serde_json::to_string(&cut).map_err(|_| SheetCutError::Failed("json"))
}
