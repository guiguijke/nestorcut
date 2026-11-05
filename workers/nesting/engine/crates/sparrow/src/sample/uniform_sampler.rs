use itertools::Itertools;
use jagua_rs::entities::Item;
use jagua_rs::geometry::geo_enums::RotationRange;
use jagua_rs::geometry::geo_traits::TransformableFrom;
use jagua_rs::geometry::primitives::Rect;
use jagua_rs::geometry::{normalize_rotation, DTransformation, Transformation};
use ordered_float::OrderedFloat;
use rand::prelude::IndexedRandom;
use rand::{Rng, RngExt};
use std::f32::consts::PI;
use std::ops::Range;

const ROT_N_SAMPLES: usize = 16; // number of rotations to sample for continuous rotation

/// A sampler that creates uniform samples for an item within a bounding box
#[derive(Clone, Debug)]
pub struct UniformBBoxSampler {
    /// The list of possible rotations and their corresponding x and y ranges
    rot_entries: Vec<RotEntry>,
}

#[derive(Clone, Debug)]
struct RotEntry {
    pub r: f32,
    pub x_range: Range<f32>,
    pub y_range: Range<f32>,
}

impl UniformBBoxSampler {
    pub fn new(sample_bbox: Rect, item: &Item, container_bbox: Rect) -> Option<Self> {
        let rotations = match &item.allowed_rotation {
            RotationRange::None => &vec![0.0],
            RotationRange::Discrete(r) => r,
            RotationRange::Continuous => {
                // for continuous rotation, we sample a set of rotations spaced evenly
                let step = (2.0 * PI) / ROT_N_SAMPLES as f32;
                &(0..ROT_N_SAMPLES)
                    .map(|i| i as f32 * step)
                    .collect_vec()
            }
        };

        let mut shape_buffer = item.shape_cd.as_ref().clone();

        let sample_x_range = sample_bbox.x_min..sample_bbox.x_max;
        let sample_y_range = sample_bbox.y_min..sample_bbox.y_max;

        // for each possible rotation, calculate the sample ranges (x and y)
        // where the item resides fully inside the container and is within the sample bounding box
        let rot_entries = rotations.iter()
            .filter_map(|&r| {
                let r_shape_bbox = shape_buffer.transform_from(item.shape_cd.as_ref(), &Transformation::from_rotation(r)).bbox;

                //narrow the container range to account for the rotated shape
                let cont_x_range = (container_bbox.x_min - r_shape_bbox.x_min)..(container_bbox.x_max - r_shape_bbox.x_max);
                let cont_y_range = (container_bbox.y_min - r_shape_bbox.y_min)..(container_bbox.y_max - r_shape_bbox.y_max);

                //intersect with the sample bbox
                let x_range = intersect_range(&cont_x_range, &sample_x_range);
                let y_range = intersect_range(&cont_y_range, &sample_y_range);

                //make sure the ranges are not empty
                if x_range.is_empty() || y_range.is_empty() {
                    None
                } else {
                    Some(RotEntry { r, x_range, y_range })
                }
            }).collect_vec();

        // Pièce À LA COTE EXACTE (patch lot A, VENDORED.patch.md point 6) :
        // quand AUCUNE rotation n'a de plage de largeur > 0, on accepte les
        // rotations dont les plages sont de largeur NULLE (start == end, pas
        // négative) : la pièce tient exactement et sa pose est imposée. Avant,
        // l'échantillonneur renvoyait None et le constructif paniquait
        // (lbf.rs) ou le BPP posait zéro pièce. Ce repli n'est évalué que si
        // `rot_entries` est vide : tout cas qui donnait un échantillonneur
        // avant le patch est inchangé, tirages RNG compris.
        let rot_entries = if rot_entries.is_empty() {
            rotations.iter()
                .filter_map(|&r| {
                    let r_shape_bbox = shape_buffer.transform_from(item.shape_cd.as_ref(), &Transformation::from_rotation(r)).bbox;
                    let cont_x_range = (container_bbox.x_min - r_shape_bbox.x_min)..(container_bbox.x_max - r_shape_bbox.x_max);
                    let cont_y_range = (container_bbox.y_min - r_shape_bbox.y_min)..(container_bbox.y_max - r_shape_bbox.y_max);
                    let x_range = intersect_range(&cont_x_range, &sample_x_range);
                    let y_range = intersect_range(&cont_y_range, &sample_y_range);
                    (x_range.start <= x_range.end && y_range.start <= y_range.end)
                        .then_some(RotEntry { r, x_range, y_range })
                }).collect_vec()
        } else {
            rot_entries
        };

        match rot_entries.is_empty() {
            true => None,
            false => Some(Self { rot_entries }),
        }
    }

    pub fn sample(&self, rng: &mut impl Rng) -> DTransformation {
        // randomly select a rotation
        let r_entry = self.rot_entries.choose(rng).unwrap();

        // sample a random x and y value within the valid range
        let r = r_entry.r;
        // Plage de largeur nulle (pièce à la cote exacte) : valeur imposée,
        // sans tirage — `random_range` panique sur une plage vide.
        let x_sample = if r_entry.x_range.is_empty() { r_entry.x_range.start } else { rng.random_range(r_entry.x_range.clone()) };
        let y_sample = if r_entry.y_range.is_empty() { r_entry.y_range.start } else { rng.random_range(r_entry.y_range.clone()) };

        DTransformation::new(r, (x_sample, y_sample))
    }
}

fn intersect_range(a: &Range<f32>, b: &Range<f32>) -> Range<f32> {
    let min = f32::max(a.start, b.start);
    let max = f32::min(a.end, b.end);
    min..max
}

/// Converts a sample transformation to the closest feasible transformation. (for now just mapping rotation to the closest allowed one)
pub fn convert_sample_to_closest_feasible(dt: DTransformation, item: &Item) -> DTransformation {
    let feasible_rotation = match &item.allowed_rotation {
        RotationRange::None => 0.0,
        RotationRange::Discrete(v) => {
            // find the closest rotation in the discrete set
            v.iter().min_by_key(|&&r| {
                // make sure to normalize the delta to the range [-PI, PI]
                let norm_delta = normalize_rotation(dt.rotation() - r);
                OrderedFloat(norm_delta.abs())
            }).cloned().unwrap()
        }
        RotationRange::Continuous => {
            // for continuous rotation, we can just use the sample rotation
            dt.rotation()
        }
    };
    DTransformation::new(feasible_rotation, dt.translation())
}