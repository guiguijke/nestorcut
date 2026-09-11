//! $INSUNITS normalization — canonical mm (worker_common/geometry/units.py twin).
//!
//! Lot 2b (`docs/PLAN-IMPORT-2026-09-09.md` §9.2) : table COMPLÈTE des codes
//! 0 à 20. Avant ce lot, sept codes seulement étaient connus — un dessin
//! déclaré en kilomètres (code 7) ou en yards (10) était lu **×1**, en
//! silence, donc à l'échelle du millimètre.
//!
//! Les facteurs sont **exacts par définition** (le pouce VAUT 25,4 mm), pas
//! ceux de `ezdxf.units.METER_FACTOR` qui sont arrondis : `1000/39.37007874`
//! rend 25,400000000101603 au lieu de 25,4. Le miroir Python porte les mêmes
//! valeurs — c'est la parité qui compte, pas la source.

/// $INSUNITS code → multiplication factor to millimeters (exact).
/// `None` = code inconnu (au-delà de 20, ou négatif) et 0 = sans unité :
/// les deux cas sont traités par `factor_to_mm`.
pub fn insunits_factor(code: i32) -> Option<f64> {
    match code {
        1 => Some(25.4),                        // inches
        2 => Some(304.8),                       // feet
        3 => Some(1_609_344.0),                 // miles
        4 => Some(1.0),                         // millimeters
        5 => Some(10.0),                        // centimeters
        6 => Some(1000.0),                      // meters
        7 => Some(1.0e6),                       // kilometers
        8 => Some(2.54e-5),                     // microinches
        9 => Some(0.0254),                      // mils
        10 => Some(914.4),                      // yards
        11 => Some(1.0e-7),                     // angstroms
        12 => Some(1.0e-6),                     // nanometers
        13 => Some(1.0e-3),                     // microns
        14 => Some(100.0),                      // decimeters
        15 => Some(10_000.0),                   // decameters
        16 => Some(100_000.0),                  // hectometers
        17 => Some(1.0e12),                     // gigameters
        18 => Some(1.495_978_707e14),           // astronomical units (SI exact)
        19 => Some(9.460_730_472_580_8e18),     // light years (SI exact)
        20 => Some(3.085_677_581_491_367_3e19), // parsecs (SI exact)
        _ => None,
    }
}

/// Identifiant canonique de l'unité — MÊME chaîne des deux côtés (le verrou
/// de parité compare `unitDetected` entre les deux importeurs).
pub fn unit_name(code: i32) -> &'static str {
    match code {
        0 => "unitless",
        1 => "inch",
        2 => "foot",
        3 => "mile",
        4 => "mm",
        5 => "cm",
        6 => "m",
        7 => "km",
        8 => "microinch",
        9 => "mil",
        10 => "yard",
        11 => "angstrom",
        12 => "nanometer",
        13 => "micron",
        14 => "decimeter",
        15 => "decameter",
        16 => "hectometer",
        17 => "gigameter",
        18 => "au",
        19 => "lightyear",
        20 => "parsec",
        _ => "unknown",
    }
}

/// Au-delà de ce facteur (10 m par unité), l'unité déclarée ne peut pas être
/// celle d'une pièce de tôlerie : la conversion reste EXACTE (jamais un repli
/// silencieux sur le millimètre), mais elle est annoncée — sinon l'utilisateur
/// reçoit une pièce de trois kilomètres sans savoir pourquoi.
pub const IMPLAUSIBLE_FACTOR_MM: f64 = 1.0e4;

/// Unitless (0) / mm (4) → 1.0 sans avertissement. Code connu → son facteur
/// exact. Code inconnu → 1.0 + drapeau d'avertissement (comportement
/// historique : mm supposés).
pub fn factor_to_mm(code: i32) -> (f64, bool) {
    if code == 0 || code == 4 {
        return (1.0, false);
    }
    match insunits_factor(code) {
        Some(f) => (f, false),
        None => (1.0, true), // unknown → warn
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_factors_are_exact() {
        // Jumeau de worker_common/geometry/units.py — valeurs figées.
        assert_eq!(insunits_factor(1), Some(25.4)); // inches
        assert_eq!(insunits_factor(2), Some(304.8)); // feet
        assert_eq!(insunits_factor(4), Some(1.0)); // mm
        assert_eq!(insunits_factor(5), Some(10.0)); // cm
        assert_eq!(insunits_factor(6), Some(1000.0)); // meters
        assert_eq!(insunits_factor(8), Some(2.54e-5)); // microinches
        assert_eq!(insunits_factor(9), Some(0.0254)); // mils
    }

    /// Lot 2b : les codes qui étaient lus ×1 en silence.
    #[test]
    fn the_whole_table_zero_to_twenty_is_covered() {
        for code in 1..=20 {
            assert!(
                insunits_factor(code).is_some(),
                "code {code} sans facteur — c'est un ×1 silencieux"
            );
            assert_ne!(unit_name(code), "unknown", "code {code} sans nom");
        }
        // Les facteurs exacts que le silence coûtait le plus cher :
        assert_eq!(insunits_factor(3), Some(1_609_344.0)); // mile
        assert_eq!(insunits_factor(7), Some(1.0e6)); // km
        assert_eq!(insunits_factor(10), Some(914.4)); // yard
        assert_eq!(insunits_factor(13), Some(1.0e-3)); // micron
        assert_eq!(insunits_factor(14), Some(100.0)); // dm
        // Ces facteurs sont EXACTS, pas ceux de ezdxf (arrondis) :
        assert_ne!(insunits_factor(1), Some(1000.0 / 39.37007874));
    }

    #[test]
    fn unitless_and_mm_do_not_warn() {
        assert_eq!(factor_to_mm(0), (1.0, false));
        assert_eq!(factor_to_mm(4), (1.0, false));
    }

    #[test]
    fn codes_that_were_unknown_now_convert() {
        assert_eq!(factor_to_mm(3), (1_609_344.0, false));
        assert_eq!(factor_to_mm(7), (1.0e6, false));
        assert_eq!(factor_to_mm(20), (3.085_677_581_491_367_3e19, false));
    }

    #[test]
    fn beyond_the_table_still_warns_and_assumes_mm() {
        // 21-24 = unités « US survey » : hors table $INSUNITS 0-20 du lot 2b,
        // ezdxf n'a pas de facteur pour elles non plus.
        assert_eq!(factor_to_mm(21), (1.0, true));
        assert_eq!(factor_to_mm(99), (1.0, true));
        assert_eq!(factor_to_mm(-1), (1.0, true));
        assert_eq!(unit_name(99), "unknown");
    }

    #[test]
    fn implausible_units_are_flagged_but_still_exact() {
        // km, Mm, années-lumière : converties exactement, et au-dessus du
        // seuil qui déclenche l'avertissement.
        for code in [3, 7, 15, 16, 17, 18, 19, 20] {
            let (f, unknown) = factor_to_mm(code);
            assert!(!unknown);
            assert!(f >= IMPLAUSIBLE_FACTOR_MM, "code {code} : facteur {f}");
        }
        // Les unités d'atelier restent sous le seuil.
        for code in [1, 2, 4, 5, 6, 9, 10, 13, 14] {
            assert!(factor_to_mm(code).0 < IMPLAUSIBLE_FACTOR_MM, "code {code}");
        }
    }
}
