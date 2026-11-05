# Vendored patches on jagua-rs 0.7.2 (upstream: MPL-2.0, Jeroen Gardeyn)

1. `src/probs/spp/io/import.rs`, `src/probs/bpp/io/import.rs`,
   `src/probs/mspp/io/import.rs` :
   `par_iter()` → `iter()` sous `cfg(target_arch = "wasm32")`.
   Raison : rayon spawne des threads OS — panique sur wasm32-unknown-unknown
   (pool global). Natif inchangé.

2. `src/geometry/transformation.rs` : `atan2` → `libm::atan2f`,
   `sin_cos` → `libm::sincosf` (3 sites). Raison : les libms plateforme
   (msvcrt / glibc / Rust libm sur wasm32) divergent par ulps et cassent la
   reproductibilité cross-device (AGENTS.md moteur — libm). Dép libm ajoutée.

3. `src/geometry/shape_modification.rs` : `offset_shape` gagne un **repli**
   quand le chemin primaire (`geo_buffer` puis `import_simple_polygon`) ne
   rend pas un anneau simple. Le repli **recalcule le gonflement depuis
   l'anneau d'origine**, comme une somme de Minkowski explicite : réunion de
   la pièce, d'un rectangle par arête et d'un polygone à 32 côtés
   CIRCONSCRIT au disque par sommet, union faite en arithmétique ENTIÈRE
   (`i_overlay`, règle positive). Il ne s'exécute QUE sur l'erreur et
   seulement en mode `Inflate`, donc le chemin normal est bit-identique
   (verrou `bench/determinism_lock.py` inchangé).

   Pourquoi ne pas réparer la sortie de `geo_buffer` : elle n'est pas
   réparable. Mesuré sur la fixture synthétique du verrou (volute de 2,5
   tours, brin de 2,4 mm, canal de 0,3 mm) à un offset de 1 mm, `geo_buffer`
   rend un contour de 278 points d'aire 47 mm² là où la pièce brute en fait
   353 : l'information est déjà perdue, aucune union ne la rend. Une première
   version du repli (union « non nulle » de ce contour) livrait donc un
   gonflement PLUS PETIT que la pièce — c'est ce que le verrou d'aire
   attrape.

   Raison du chantier : jagua gonfle chaque pièce de `space/2` à l'import
   (`min_item_separation`). Sur une pièce dont deux brins de matière laissent
   un canal plus étroit que le gonflement — volute, spirale, lettrage plein —
   les deux bords décalés se croisent, `SPolygon::new` refuse le contour, et
   le moteur MEURT à l'import : le job finissait en « The on-device compute
   stopped unexpectedly » avec remboursement. Dépendance ajoutée :
   `i_overlay` 4 (booléen entier ⇒ déterministe natif ≡ wasm) ; les seules
   transcendantales du repli sont celles du crate `libm` (règle AGENTS #14b).
   Verrous : `crates/nest-engine/tests/inflate_fallback.rs` (contrôle négatif
   compris) et la fixture de déterminisme `bench/fixtures/e0_volute`.
   Lot E0 de `docs/archive/2026-09-import-eclatement/PLAN-ECLATEMENT-2026-09-12.md`.

4. `src/geometry/shape_modification.rs` + `src/io/import.rs` : le repli du
   point 3 **dit sur quelles pièces il est passé**. `CURRENT_ITEM`
   (thread_local, posé par `Importer::import_item` avec un garde qui le
   remet à None au Drop) donne l'id de la pièce en cours d'import ;
   `FALLBACK_ITEMS` (`Mutex<Vec<u64>>`) collecte ces ids quand le repli
   s'exécute ; `take_fallback_items()` les rend triés et dédupliqués.
   nest-engine les draine après l'import et les publie
   (`EngineOutput.thin_items`, évènement `thin_items`, JSON wasm).
   Raison : un gonflement qui a pris le repli signale une pièce plus fine
   que l'espacement demandé — le job est livré, mais l'utilisateur doit
   pouvoir NOMMER la pièce concernée (sinon le constat est inexploitable).
   Aucun effet sur la géométrie : ce sont deux canaux d'observation, et le
   verrou de déterminisme reste bit-identique.
   Lot E2 de `docs/archive/2026-09-import-eclatement/PLAN-ECLATEMENT-2026-09-12.md`.

5. `src/probs/spp/io/import.rs` (+ réexport dans `src/probs/spp/io/mod.rs`) :
   **largeur initiale de la bande** (piège AGENTS #2b). Le conteneur d'une
   bande est DÉFLATÉ de `séparation / 2` par côté ; la largeur initiale
   `aire totale / hauteur` pouvait être ≤ séparation, le polygone déflaté
   était vide et `Strip -> Container` paniquait (`strip.rs`,
   « Offset resulted in an empty polygon »). Avec `panic = "abort"`, c'était
   `unreachable` en navigateur et le calcul perdu. Le cas se présente dès deux
   pièces dont l'aire totale ne dépasse pas hauteur × espacement (2×40×40 sur
   1000×2000 à espacement 2, réglages d'usine) : la bascule J7-a envoie le job
   en BPP, puis la finition de tôle partielle recrée la même bande.
   - si `total / H ≤ séparation`, la largeur devient
     `séparation + total / (H − séparation)` ;
   - si `H ≤ séparation`, `import_instance` rend l'erreur TYPÉE
     `StripHeightBelowSeparation` (message préfixé
     `strip_height_below_separation:`) au lieu de laisser le dénominateur
     nul ou négatif ;
   - sinon la largeur reste EXACTEMENT `total / H` : bit-identique sur tout
     job qui ne paniquait pas (verrou `bench/determinism_lock.py`, test
     `nest-engine/tests/small_job_default_path.rs`).
   Les gardes amont (`main.py`, `localPayloadBuilder.js`) restent en défense.

6. **Copie sparrow** (`crates/sparrow`, pas jagua mais documenté ici avec ses
   voisins) — pièce À LA COTE EXACTE, lot A :
   - `src/sample/uniform_sampler.rs` : `UniformBBoxSampler::new` écartait toute
     rotation dont une plage d'échantillonnage était vide, donc aussi celles
     de largeur NULLE (`start == end`, pièce qui tient pile). Un job dont
     aucune rotation n'avait de plage de largeur > 0 recevait `None` et mourait
     plus loin. Désormais, **seulement si `rot_entries` est vide**, les rotations
     à plage de largeur nulle (jamais négative) sont retenues, et `sample()`
     rend leur borne sans tirage (`random_range` panique sur une plage vide).
     Tout cas qui donnait un échantillonneur avant le patch est inchangé,
     tirages RNG compris (verrou `bench/determinism_lock.py`). Mesuré : sur
     une pièce à la cote exacte (h=996,0 sur 1000, espacement 2) l'échantillonneur
     rend désormais une pose, que l'évaluateur juge encore `Invalid` à cause de
     l'arrondi f32 de la boîte englobante : l'effet visible est le refus typé
     ci-dessous, pas une pose. Aucun cas n'a été trouvé où ce repli seul fait
     poser la pièce.
   - `src/optimizer/lbf.rs` + `src/optimizer/mod.rs` : l'assertion « strip-width
     is running away … item N does not seem to fit » (`panic = "abort"` :
     `unreachable` en navigateur) devient l'erreur TYPÉE `ItemDoesNotFit
     { item_id, strip_width }`. `LBFBuilder::construct` et `optimize` rendent
     un `Result`. `nest-engine` la traduit en `item_unplaceable:<id>:` (même
     modèle que `item_geometry`, `import_error.rs`). Une PHASE 2 qui échoue
     (cadre transposé, bande = largeur de phase 1 + 1 mm) retombe sur le
     résultat de la phase 1 au lieu de tuer la classe : c'était la panique de
     la volute du constat (une orientation, bande de 66,5 mm) sur le wasm, qui
     disparaît avec `two_phase: false` — mesuré sur le wasm d'origine, graines
     100 et 101 du pool.

7. `src/probs/bpp/entities/solution.rs` : `BPSolution::density` rend 0 pour une
   solution sans tôle (aucune pièce posée) au lieu de 0/0 = NaN. Le NaN était
   sérialisé en `null`, et `merge_alternatives` échouait à relire son propre
   export (« invalid type: null, expected f32 »). Sans autre effet : seul le
   cas vide change de valeur.

Upstream inchangé sinon. Licence : MPL-2.0 (voir LICENSE).
