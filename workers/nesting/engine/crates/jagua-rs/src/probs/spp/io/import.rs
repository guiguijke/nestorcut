use crate::entities::{Instance, Item};
use crate::geometry::DTransformation;
use crate::geometry::shape_modification::ShapeModifyConfig;
use crate::io::import::{Importer, ext_to_int_transformation};
use crate::probs::spp::entities::{SPInstance, SPPlacement, SPProblem, SPSolution, Strip};
use crate::probs::spp::io::ext_repr::{ExtSPInstance, ExtSPSolution};
use anyhow::{Result, ensure};
use itertools::Itertools;
#[cfg(not(target_arch = "wasm32"))]
use rayon::prelude::*;

// SPIKE: rayon spawns OS threads — unavailable on wasm32-unknown-unknown.
// Native keeps the parallel import; wasm falls back to sequential iteration.
#[cfg(not(target_arch = "wasm32"))]
fn maybe_par_iter<T: Sync>(slice: &[T]) -> impl rayon::iter::IndexedParallelIterator<Item = &T> {
    slice.par_iter()
}
#[cfg(target_arch = "wasm32")]
fn maybe_par_iter<T>(slice: &[T]) -> std::slice::Iter<'_, T> {
    slice.iter()
}

/// Erreur typée : la hauteur de la bande ne laisse pas de quoi construire un
/// conteneur une fois l'espacement retiré, quelle que soit la largeur. Remontée
/// par `import_instance` au lieu d'une panique.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StripHeightBelowSeparation {
    pub strip_height: f32,
    pub separation: f32,
}

impl std::fmt::Display for StripHeightBelowSeparation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "strip_height_below_separation: strip height {} leaves no room for item separation {}",
            self.strip_height, self.separation
        )
    }
}

impl std::error::Error for StripHeightBelowSeparation {}

fn ensure_strip_height_above_separation(strip_height: f32, separation: f32) -> Result<()> {
    if strip_height <= separation {
        return Err(StripHeightBelowSeparation { strip_height, separation }.into());
    }
    Ok(())
}

/// Nombre d'essais de [`first_buildable_strip`]. Du plancher à la hauteur il y a
/// au plus 24 doublements (la mantisse d'un f32) ; la marge ne coûte que sur un
/// job dont la bande n'existe pas.
const STRIP_PROBE_MAX: usize = 32;

/// Première largeur `séparation + terme` dont le conteneur se construit, le
/// terme partant de `total / (H - séparation)` et doublant, avec un plancher à
/// quelques ulp de la plus grande cote : la fenêtre sans conteneur grandit avec
/// la hauteur, seule la construction dit où elle s'arrête. `None` si la hauteur
/// est en cause : une bande déjà plus large que haute ne fait que s'amincir.
fn first_buildable_strip(template: Strip, total_item_area: f32, separation: f32) -> Option<Strip> {
    let height = template.fixed_height;
    let floor = f32::EPSILON * height.max(separation);
    let mut term = total_item_area / (height - separation);
    for _ in 0..STRIP_PROBE_MAX {
        let strip = Strip { width: separation + term, ..template };
        if strip.try_container().is_ok() {
            return Some(strip);
        }
        if strip.width >= height {
            return None;
        }
        term = (term * 2.0).max(floor);
    }
    None
}

/// Imports an instance into the library
pub fn import_instance(importer: &Importer, ext_instance: &ExtSPInstance) -> Result<SPInstance> {
    let items: Vec<(Item, usize)> = {
        let mut items = maybe_par_iter(&ext_instance.items)
            .map(|ext_item| {
                let item = importer.import_item(&ext_item.base)?;
                let demand = ext_item.demand as usize;
                Ok((item, demand))
            })
            .collect::<Result<Vec<(Item, usize)>>>()?;

        items.sort_by_key(|(item, _)| item.id);
        items.retain(|(_, demand)| *demand > 0);

        ensure!(
            items.iter().enumerate().all(|(i, (item, _))| item.id == i),
            "All items should have consecutive IDs starting from 0. IDs: {:?}",
            items.iter().map(|(item, _)| item.id).sorted().collect_vec()
        );
        ensure!(
            !items.is_empty(),
            "ExtSPInstance must have at least one item with positive demand"
        );

        items
    };

    let total_item_area = items
        .iter()
        .map(|(item, demand)| item.area() * *demand as f32)
        .sum::<f32>();

    let fixed_height = ext_instance.strip_height;

    // Initialize the base width for 100% density.
    //
    // Le conteneur de la bande est DÉFLATÉ de `separation / 2` sur chaque
    // bord : une largeur à peine au-dessus de la séparation (ou dessous) n'a
    // pas de conteneur, et `Strip -> Container` panique. Voir VENDORED.patch.md,
    // point 5. Tout job dont le conteneur existe garde EXACTEMENT `total / H`.
    let separation = importer.shape_modify_config.offset.unwrap_or(0.0).max(0.0) * 2.0;
    if separation > 0.0 {
        ensure_strip_height_above_separation(fixed_height, separation)?;
    }
    let base_strip = Strip::new(
        fixed_height,
        importer.cde_config,
        ShapeModifyConfig {
            offset: importer.shape_modify_config.offset,
            simplify_tolerance: None,
            narrow_concavity_cutoff: None,
        },
        total_item_area / fixed_height,
    )?;
    let base_strip = if base_strip.width > separation && base_strip.try_container().is_ok() {
        base_strip
    } else {
        first_buildable_strip(base_strip, total_item_area, separation).ok_or(
            StripHeightBelowSeparation { strip_height: fixed_height, separation },
        )?
    };

    Ok(SPInstance::new(items, base_strip))
}

/// Imports a solution into the library.
pub fn import_solution(instance: &SPInstance, ext_solution: &ExtSPSolution) -> SPSolution {
    let mut prob = SPProblem::new(instance.clone());
    prob.change_strip_width(ext_solution.strip_width);

    for ext_placement in ext_solution.layout.placed_items.iter().cloned() {
        let item_id = ext_placement.item_id as usize;
        let d_transf = {
            let ext_transf = DTransformation::from(ext_placement.transformation);
            let item = &instance.item(item_id);
            ext_to_int_transformation(&ext_transf, &item.shape_orig.pre_transform)
        };
        prob.place_item(SPPlacement { item_id, d_transf });
    }

    prob.save()
}
