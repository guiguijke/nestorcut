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
   Lot E0 de `docs/PLAN-ECLATEMENT-2026-09-12.md`.

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
   Lot E2 de `docs/PLAN-ECLATEMENT-2026-09-12.md`.

Upstream inchangé sinon. Licence : MPL-2.0 (voir LICENSE).
