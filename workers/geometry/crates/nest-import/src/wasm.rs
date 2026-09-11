//! WASM bindings (feature `wasm`). Same API as the native lib — never a
//! browser-only shape (mission v2, règle 1).

use wasm_bindgen::prelude::*;

/// import_dxf(bytes, flatten_tol_mm) -> JSON ImportResult
/// (parts: coordinates/holes/width/height, sourceUnits, entityCount, warnings)
#[wasm_bindgen]
pub fn import_dxf(bytes: &[u8], flatten_tol: f64) -> Result<String, JsError> {
    let out = crate::import_dxf(bytes, flatten_tol)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    serde_json::to_string(&out).map_err(|e| JsError::new(&format!("{e}")))
}

/// import_file_limited(bytes, tol, max_entities, time_budget_ms) -> JSON
/// `{status:"ok"|"refused", ...}` — l'entrée BORNÉE du chemin navigateur
/// (lot 2a). Un refus « trop lourd » n'est pas une exception : il porte le
/// compte d'entités et le temps écoulé, que le message affiche.
#[wasm_bindgen]
pub fn import_file_limited(
    bytes: &[u8],
    flatten_tol: f64,
    max_entities: usize,
    // u32 et non u64 : wasm-bindgen mappe u64 sur BigInt côté JS
    // (« Cannot convert 20000 to a BigInt ») — piège #16b, un entier qui
    // traverse la frontière JS reste un `number` ou une string.
    time_budget_ms: u32,
) -> Result<String, JsError> {
    let limits = crate::budget::Limits { max_entities, time_budget_ms: time_budget_ms as u64 };
    crate::guarded_import_json(bytes, flatten_tol, &limits)
        .map_err(|e| JsError::new(&format!("{e}")))
}

/// import_svg(bytes, flatten_tol_mm) -> JSON ImportResult — feature `svg`
/// (opt-in wasm : le bundle DXF-only reste léger).
#[cfg(feature = "svg")]
#[wasm_bindgen]
pub fn import_svg(bytes: &[u8], flatten_tol: f64) -> Result<String, JsError> {
    let out = crate::import_svg(bytes, flatten_tol)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    serde_json::to_string(&out).map_err(|e| JsError::new(&format!("{e}")))
}

/// import_file(bytes, flatten_tol_mm) -> JSON ImportResult — détection par
/// signature de contenu (AGENTS #31), jamais l'extension.
#[wasm_bindgen]
pub fn import_file(bytes: &[u8], flatten_tol: f64) -> Result<String, JsError> {
    let out = crate::import_file(bytes, flatten_tol)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    serde_json::to_string(&out).map_err(|e| JsError::new(&format!("{e}")))
}

/// canonical_dxf(bytes, flatten_tol_mm) -> bytes DXF canoniques mm (J-090,
/// `_make_dxf_copy` twin) — handles frais séquentiels = ceux de
/// `parts[].handles`. Retourne un Uint8Array côté JS (Vec<u8> natif).
#[wasm_bindgen]
pub fn canonical_dxf(bytes: &[u8], flatten_tol: f64) -> Result<Vec<u8>, JsError> {
    crate::canonical_dxf(bytes, flatten_tol).map_err(|e| JsError::new(&format!("{e}")))
}
