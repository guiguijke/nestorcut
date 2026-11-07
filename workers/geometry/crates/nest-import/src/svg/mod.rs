//! SVG → primitives — svg_to_drawing.py twin on a custom svgelements
//! replica (NO usvg: usvg converts arcs to cubic Béziers, which breaks the
//! bit-parity contract — arcs stay Arc segments here, see J-entry).
//!
//! Chain: XML walk (roxmltree) → values cascade (transform strings concat,
//! display:none) → viewport/viewBox transform → shapes/paths in px →
//! flatten (0.5 px step, clamped) → mm ×25.4/96, y flipped — then the SAME
//! linework/assembly as DXF.

use crate::dxf::flatten::Primitive;
use crate::{ImportError, ImportResult};

mod length;
mod matrix;
pub mod path;
mod pyfmt;
mod segment;
mod shapes;

use length::Length;
use matrix::Matrix;

const MM_PER_PX: f64 = 25.4 / 96.0;

struct Ctx {
    /// Cascaded transform STRING (parent + ' ' + own), parsed lazily.
    transform: String,
    display_none: bool,
}

/// Read an attribute with style fallback ("display:none" / "transform" in
/// the style attribute count, svgelements merges style into attributes).
fn attr<'a>(node: &roxmltree::Node<'a, '_>, name: &str) -> Option<String> {
    if let Some(v) = node.attribute(name) {
        return Some(v.to_string());
    }
    if let Some(style) = node.attribute("style") {
        for decl in style.split(';') {
            let mut it = decl.splitn(2, ':');
            if let (Some(k), Some(v)) = (it.next(), it.next()) {
                if k.trim() == name {
                    return Some(v.trim().to_string());
                }
            }
        }
    }
    None
}

/// Plafond d'instanciations de `<use>` : un SVG qui s'emboîte lui-même
/// (`<use>` de `<use>` doublés sur N niveaux) ne doit pas figer l'onglet.
const MAX_USE_EXPANSIONS: usize = 100_000;

/// Parcours du document : états partagés par toute la descente.
struct Walker<'a, 'input> {
    /// id → noeud, le DERNIER gagne (svgelements `event_defs[id] = node`).
    ids: std::collections::HashMap<&'a str, roxmltree::Node<'a, 'input>>,
    prims: Vec<Primitive>,
    warnings: Vec<String>,
    /// Viewport des longueurs en % (voir `root_viewport`).
    vp: (f64, f64),
    /// `<use>` en cours d'instanciation (détection de cycle).
    use_stack: Vec<&'a str>,
    expansions: usize,
}

/// `href` d'un `<use>` : `href` prime sur `xlink:href` (svgelements) et le
/// premier caractère est retiré sans regarder si c'est `#`.
fn use_target_id<'a>(node: &roxmltree::Node<'a, '_>) -> Option<&'a str> {
    let v = node
        .attribute("href")
        .or_else(|| node.attribute(("http://www.w3.org/1999/xlink", "href")))?;
    let mut it = v.chars();
    it.next()?;
    Some(it.as_str())
}

impl<'a, 'input> Walker<'a, 'input> {
    fn walk(&mut self, node: &roxmltree::Node<'a, 'input>, parent: &Ctx) -> Result<(), ImportError> {
        let tag = node.tag_name().name();
        // Cascade: own transform string appended to the parent's.
        let mut transform = parent.transform.clone();
        if let Some(t) = attr(node, "transform") {
            if !transform.is_empty() {
                transform.push(' ');
            }
            transform.push_str(&t);
        }
        let display_none = parent.display_none
            || attr(node, "display").map(|d| d.trim().eq_ignore_ascii_case("none")).unwrap_or(false);
        let ctx = Ctx { transform: transform.clone(), display_none };

        match tag {
            // `<defs>` : jamais rendu (svgelements ne rattache pas son contenu
            // à l'arbre). Il ne sert que par `<use>`.
            "defs" => {}
            "g" | "svg" | "a" | "symbol" | "switch" => {
                if !display_none {
                    for child in node.children().filter(|c| c.is_element()) {
                        self.walk(&child, &ctx)?;
                    }
                }
            }
            "use" => {
                if display_none {
                    return Ok(());
                }
                // Les enfants propres du `<use>` d'abord, puis la cible
                // (ordre de `_use_structure_parse`).
                for child in node.children().filter(|c| c.is_element()) {
                    self.walk(&child, &ctx)?;
                }
                let target = use_target_id(node).and_then(|id| self.ids.get(id).map(|n| (id, *n)));
                let Some((id, target)) = target else {
                    self.warnings.push("Skipping unresolved SVG <use> reference".to_string());
                    return Ok(());
                };
                if self.use_stack.contains(&id) {
                    return Err(ImportError::Corrupt(
                        "Unreadable SVG file: <use> references itself".into(),
                    ));
                }
                self.expansions += 1;
                if self.expansions > MAX_USE_EXPANSIONS {
                    return Err(ImportError::Corrupt(
                        "Unreadable SVG file: too many <use> instances".into(),
                    ));
                }
                // x/y du `<use>` : translation ajoutée APRÈS son transform,
                // AVANT celui de la cible. width/height ne servent pas.
                let px = |name: &str| {
                    attr(node, name).map(|v| Length::parse(&v).value_px(None)).unwrap_or(0.0)
                };
                let (x, y) = (px("x"), px("y"));
                let mut use_ctx = ctx;
                if x != 0.0 || y != 0.0 {
                    if !use_ctx.transform.is_empty() {
                        use_ctx.transform.push(' ');
                    }
                    use_ctx.transform.push_str(&format!("translate({x}, {y})"));
                }
                self.use_stack.push(id);
                let r = self.walk(&target, &use_ctx);
                self.use_stack.pop();
                r?;
            }
            "path" => {
                if display_none {
                    return Ok(());
                }
                if let Some(d) = node.attribute("d") {
                    let mut p = path::parse_path(d);
                    let m = Matrix::parse(&transform);
                    if !m.is_identity() {
                        for s in p.segs.iter_mut() {
                            s.transform(&m);
                        }
                    }
                    emit_path(&p, &mut self.prims);
                }
            }
            "rect" | "circle" | "ellipse" | "polyline" | "polygon" => {
                if display_none {
                    return Ok(());
                }
                let m = Matrix::parse(&transform);
                let shape = build_shape(tag, node, m, self.vp);
                if let Some(shape) = shape {
                    let p = shape.to_path();
                    emit_path(&p, &mut self.prims);
                }
            }
            // `<line>` est un `SimpleLine` pour svgelements — ABSENT de la liste
            // _CONVERTIBLE de svg_to_drawing.py : le pipeline Python le saute
            // (avec warning), donc aucune entité canonique, aucun handle (J-090,
            // verrou svg_shapes : le <line> consommait un handle ici et décalait
            // toute la séquence).
            "text" | "tspan" | "image" | "desc" | "title" | "metadata" | "style" | "pattern"
            | "line" | "linearGradient" | "radialGradient" | "clipPath" | "mask" | "marker" => {
                self.warnings.push(format!("Skipping unsupported SVG element: {tag}"));
            }
            _ => {
                if node.is_element() && !tag.is_empty() {
                    self.warnings.push(format!("Skipping unsupported SVG element: {tag}"));
                }
            }
        }
        Ok(())
    }
}

/// Shapes: attribute Lengths resolved against the viewport (x/width vs
/// viewport width, y/height vs viewport height — svgelements render()).
fn build_shape(tag: &str, node: &roxmltree::Node, m: Matrix, vp: (f64, f64)) -> Option<shapes::Shape> {
    let (vw, vh) = vp;
    let len = |name: &str, default: &str, rel: f64| -> f64 {
        Length::parse(&attr(node, name).unwrap_or_else(|| default.to_string())).value_px(Some(rel))
    };
    match tag {
        "circle" => {
            let r = Length::parse(&attr(node, "r").unwrap_or_else(|| "0".into())).value_px(None);
            Some(shapes::Shape::Circle {
                cx: len("cx", "0", vw),
                cy: len("cy", "0", vh),
                rx: r,
                ry: r,
                transform: m,
            })
        }
        "ellipse" => Some(shapes::Shape::Circle {
            cx: len("cx", "0", vw),
            cy: len("cy", "0", vh),
            rx: len("rx", "0", vw),
            ry: len("ry", "0", vh),
            transform: m,
        }),
        "rect" => {
            let rxs = attr(node, "rx");
            let rys = attr(node, "ry");
            let rx = rxs.as_deref().map(|s| Length::parse(s).value_px(Some(vw)));
            let ry = rys.as_deref().map(|s| Length::parse(s).value_px(Some(vh)));
            Some(shapes::Shape::Rect {
                x: len("x", "0", vw),
                y: len("y", "0", vh),
                width: len("width", "0", vw),
                height: len("height", "0", vh),
                rx,
                ry,
                transform: m,
            })
        }
        "line" => Some(shapes::Shape::Line {
            x1: len("x1", "0", vw),
            y1: len("y1", "0", vh),
            x2: len("x2", "0", vw),
            y2: len("y2", "0", vh),
            transform: m,
        }),
        "polyline" | "polygon" => {
            let pts_attr = node.attribute("points").unwrap_or("");
            let nums = tokenize_floats(pts_attr);
            let mut points = Vec::with_capacity(nums.len() / 2);
            for pair in nums.chunks_exact(2) {
                points.push([pair[0], pair[1]]);
            }
            Some(shapes::Shape::Poly { points, polygon: tag == "polygon", transform: m })
        }
        _ => None,
    }
}

/// points attribute: floats separated by comma-wsp (REGEX_COORD_PAIR twin).
fn tokenize_floats(s: &str) -> Vec<f64> {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b',' || (c as char).is_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && bytes[i] != b',' && !(bytes[i] as char).is_whitespace() {
            i += 1;
        }
        if let Ok(v) = s[start..i].parse::<f64>() {
            out.push(v);
        }
    }
    out
}

/// Flattened subpaths → polyline primitives (px → mm, y flipped).
fn emit_path(p: &path::PathBuf, prims: &mut Vec<Primitive>) {
    for (points, closed) in path::flatten_path(p) {
        let mm: Vec<[f64; 2]> = points
            .iter()
            .map(|q| [q[0] * MM_PER_PX, -q[1] * MM_PER_PX])
            .collect();
        if mm.len() >= 2 {
            prims.push(Primitive::Polyline {
                points: mm,
                closed,
                handle: String::new(),
                layer: "0".to_string(),
            });
        }
    }
}

/// Taille du viewport racine et transform viewBox → viewport (SVG.parse
/// twin, svgelements 1.9.6).
///
/// * `width` / `height` absents valent `100%`, et un pourcentage se résout
///   contre les dimensions du viewBox (1000 sans viewBox) : `width="100%"`
///   garde donc l'échelle 1 du viewBox, `width="50%"` la divise par deux.
///   Chaque attribut se résout seul : un seul des deux en pourcentage, ou
///   un seul présent, ne change pas l'autre.
/// * Longueurs `%` des formes : contre le viewBox s'il y en a un ; sinon
///   svgelements les résout contre la taille physique avec largeur et
///   hauteur permutées (`height, width = s.width, s.height` dans
///   `SVG.parse`). Reproduit tel quel : le fichier de coupe doit sortir
///   pareil des deux chemins.
/// * viewBox de largeur ou hauteur nulle, ou taille physique nulle avec
///   viewBox : svgelements rend un document vide (`None` ici).
fn root_viewport(node: &roxmltree::Node) -> Option<((f64, f64), String)> {
    let viewbox = node.attribute("viewBox").and_then(|vb| {
        let nums = tokenize_floats(vb);
        if nums.len() == 4 {
            Some((nums[0], nums[1], nums[2], nums[3]))
        } else {
            None
        }
    });
    let aspect = node.attribute("preserveAspectRatio").unwrap_or("").to_string();
    let (ref_w, ref_h) = match viewbox {
        Some((_, _, vw, vh)) => (vw, vh),
        None => (1000.0, 1000.0),
    };
    let resolve = |name: &str, rel: f64| -> f64 {
        Length::parse(node.attribute(name).unwrap_or("100%")).value_px(Some(rel))
    };
    let w_px = resolve("width", ref_w);
    let h_px = resolve("height", ref_h);
    match viewbox {
        None => Some(((h_px, w_px), String::new())),
        Some((vbx, vby, vbw, vbh)) => {
            if w_px == 0.0 || h_px == 0.0 || vbw == 0.0 || vbh == 0.0 {
                return None;
            }
            Some((
                (vbw, vbh),
                viewbox_transform(0.0, 0.0, w_px, h_px, vbx, vby, vbw, vbh, &aspect),
            ))
        }
    }
}

/// Viewbox.viewbox_transform twin (SVG 2.0 8.2).
#[allow(clippy::too_many_arguments)]
fn viewbox_transform(
    e_x: f64,
    e_y: f64,
    e_width: f64,
    e_height: f64,
    vb_x: f64,
    vb_y: f64,
    vb_width: f64,
    vb_height: f64,
    aspect: &str,
) -> String {
    let mut parts = aspect.split_whitespace();
    let align = parts.next().unwrap_or("xMidyMid");
    let meet_or_slice = parts.next().unwrap_or("meet");
    let mut scale_x = e_width / vb_width;
    let mut scale_y = e_height / vb_height;
    if align != "none" && meet_or_slice == "meet" {
        scale_x = scale_x.min(scale_y);
        scale_y = scale_x;
    } else if align != "none" && meet_or_slice == "slice" {
        scale_x = scale_x.max(scale_y);
        scale_y = scale_x;
    }
    let mut translate_x = e_x - vb_x * scale_x;
    let mut translate_y = e_y - vb_y * scale_y;
    let align = align.to_lowercase();
    if align.contains("xmid") {
        translate_x += (e_width - vb_width * scale_x) / 2.0;
    }
    if align.contains("xmax") {
        translate_x += e_width - vb_width * scale_x;
    }
    if align.contains("ymid") {
        translate_y += (e_height - vb_height * scale_y) / 2.0;
    }
    if align.contains("ymax") {
        translate_y += e_height - vb_height * scale_y;
    }
    if translate_x == 0.0 && translate_y == 0.0 {
        if scale_x == 1.0 && scale_y == 1.0 {
            String::new()
        } else {
            format!("scale({}, {})", pyfmt::fmt_length_str(scale_x), pyfmt::fmt_length_str(scale_y))
        }
    } else if scale_x == 1.0 && scale_y == 1.0 {
        format!(
            "translate({}, {})",
            pyfmt::fmt_length_str(translate_x),
            pyfmt::fmt_length_str(translate_y)
        )
    } else {
        format!(
            "translate({}, {}) scale({}, {})",
            pyfmt::fmt_length_str(translate_x),
            pyfmt::fmt_length_str(translate_y),
            pyfmt::fmt_length_str(scale_x),
            pyfmt::fmt_length_str(scale_y)
        )
    }
}

/// svg_bytes_to_drawing twin: parse → flatten → primitives mm (y-up).
/// Zero convertible geometry = clean error (parity of behavior).
///
/// Handles (J-090) : les primitives reçoivent la séquence canonique ezdxf
/// (2F, 30, …, une LWPOLYLINE = un handle) — les mêmes handles que portent
/// les LWPOLYLINEs synthétisés de `canonical_dxf`, pour l'export par handle.
pub fn import_svg(bytes: &[u8], flatten_tol: f64) -> Result<ImportResult, ImportError> {
    import_svg_limited(bytes, flatten_tol, &crate::budget::Limits::unlimited())
}

/// `import_svg` sous les bornes du lot 2a (plafond d'entités + budget de
/// temps) — le chemin navigateur accepte le SVG comme le DXF, la garde ne
/// peut pas ne valoir que pour l'un des deux.
pub fn import_svg_limited(
    bytes: &[u8],
    flatten_tol: f64,
    limits: &crate::budget::Limits,
) -> Result<ImportResult, ImportError> {
    let dl = crate::budget::Deadline::new(limits.time_budget_ms);
    let (prims, mut warnings, entity_count) = svg_primitives(bytes)?;
    if entity_count > limits.max_entities {
        return Err(crate::too_many_entities(entity_count, false, limits, &dl));
    }
    let (linework, w2, _) = crate::assemble::collect_linework_until(&prims, flatten_tol, &dl)
        .map_err(|e| crate::out_of_time(entity_count, limits, e))?;
    warnings.extend(w2);
    let (parts, asm) = crate::assemble::build_parts_stats_until(linework, flatten_tol, &dl)
        .map_err(|e| crate::out_of_time(entity_count, limits, e))?;
    // Un SVG n'a ni $INSUNITS ni blocs : seuls les constats d'assemblage et
    // les éléments non supportés (déjà dans `warnings`) ont un sens ici.
    let mut stats = crate::findings::ImportStats {
        insunits: 4,
        unit_factor: 1.0,
        ..Default::default()
    };
    stats.dangling_paths = asm.dangling_paths;
    stats.dropped_parts = asm.dropped_parts;
    Ok(ImportResult {
        parts,
        source_units: 4,
        entity_count,
        warnings,
        findings: stats.findings(),
    })
}

/// Parse + flatten SVG → primitives mm (y-up), handles canoniques assignés.
/// Point d'injection unique partagé par import_svg et canonical_dxf : même
/// source ⇒ même ordre ⇒ même séquence de handles.
fn svg_primitives(bytes: &[u8]) -> Result<(Vec<Primitive>, Vec<String>, usize), ImportError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|e| ImportError::Corrupt(format!("Unreadable SVG file: {e}")))?;
    let doc = roxmltree::Document::parse(text)
        .map_err(|e| ImportError::Corrupt(format!("Unreadable SVG file: {e}")))?;
    let root = doc.root_element();
    if root.tag_name().name() != "svg" {
        return Err(ImportError::Corrupt("Unreadable SVG file: root is not <svg>".into()));
    }
    let Some((vp, viewport_transform)) = root_viewport(&root) else {
        return Err(ImportError::Corrupt(
            "No convertible geometry found in SVG (paths/shapes only)".to_string(),
        ));
    };
    // svgelements : transform propre de la racine PUIS viewport transform.
    let mut root_transform = String::new();
    if let Some(t) = attr(&root, "transform") {
        root_transform.push_str(&t);
    }
    if !viewport_transform.is_empty() {
        if !root_transform.is_empty() {
            root_transform.push(' ');
        }
        root_transform.push_str(&viewport_transform);
    }
    let mut ids = std::collections::HashMap::new();
    for n in doc.descendants().filter(|n| n.is_element()) {
        if let Some(id) = n.attribute("id") {
            ids.insert(id, n);
        }
    }
    let mut walker = Walker {
        ids,
        prims: Vec::new(),
        warnings: Vec::new(),
        vp,
        use_stack: Vec::new(),
        expansions: 0,
    };
    let ctx = Ctx { transform: root_transform, display_none: false };
    for child in root.children().filter(|c| c.is_element()) {
        walker.walk(&child, &ctx)?;
    }
    let Walker { mut prims, warnings, .. } = walker;
    let entity_count = prims.len();
    if entity_count == 0 {
        return Err(ImportError::Corrupt(
            "No convertible geometry found in SVG (paths/shapes only)".to_string(),
        ));
    }
    // Séquence canonique (svg_bytes_to_drawing → ezdxf.new("R2010") : les
    // add_lwpolyline reçoivent 2F, 30, 31, … dans l'ordre d'émission).
    let mut hg = crate::dxf::canonical::HandleGen::new();
    for p in prims.iter_mut() {
        if let Primitive::Polyline { handle, .. } = p {
            *handle = hg.next_handle();
        }
    }
    Ok((prims, warnings, entity_count))
}

/// Bytes DXF canoniques d'une source SVG (svg_bytes_to_drawing twin) :
/// LWPOLYLINEs aplaties (0,5 px, mm, y-up) avec handles canoniques,
/// $INSUNITS=4 / $MEASUREMENT=1, ACADVER AC1024 (ezdxf.new("R2010")).
pub fn canonical_dxf(bytes: &[u8]) -> Result<Vec<u8>, ImportError> {
    let (prims, _, _) = svg_primitives(bytes)?;
    let entities: Vec<crate::dxf::entities::Entity> = prims
        .into_iter()
        .filter_map(|p| match p {
            Primitive::Polyline { points, closed, handle, layer } => {
                Some(crate::dxf::entities::Entity::LwPolyline(
                    crate::dxf::entities::LwPolyline {
                        bulges: vec![0.0; points.len()],
                        points,
                        closed,
                        common: crate::dxf::entities::Common {
                            handle,
                            layer,
                            color: 256,
                        },
                    },
                ))
            }
            _ => None,
        })
        .collect();
    Ok(crate::dxf::canonical::emit_dxf(&entities, "AC1024"))
}
