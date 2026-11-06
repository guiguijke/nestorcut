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

5. **Largeur de la bande : seule la construction du conteneur dit si elle
   existe** (piège AGENTS #2b). Le conteneur d'une bande est DÉFLATÉ de
   `séparation / 2` par côté. Juste au-dessus de la séparation il reste un
   rectangle de quelques ulp : `geo_buffer` le rend vide, ou `SPolygon::new`
   le refuse (« Offset resulted in an empty polygon », « Simple polygon must
   have at least 3 points », « no pole found »), et `Strip -> Container`
   paniquait. Avec `panic = "abort"`, c'était `unreachable` en navigateur et
   l'abort rc 3221226505 sur le worker. La fenêtre grandit avec la hauteur
   (mesuré à espacement 2 : piège jusqu'à +1e-5 mm pour H = 1000, +3e-5 pour
   H = 2000, +1e-4 pour H = 6000) : aucun seuil en mm ne la décrit.
   - `src/probs/spp/entities/strip.rs` : `Strip::try_container` construit par le
     chemin faillible. Pur : ni tirage, ni écriture dans `FALLBACK_ITEMS` (le
     repli du point 3 ne sert qu'au gonflement). `From<Strip>` reste, réservé
     aux largeurs déjà construites.
   - `src/probs/spp/io/import.rs` (+ réexport dans `src/probs/spp/io/mod.rs`) :
     la largeur reste EXACTEMENT `total / H` si elle dépasse la séparation et que
     son conteneur se construit. Sinon `séparation + terme`, le terme partant de
     `total / (H - séparation)` et doublant, plancher `EPSILON × max(H,
     séparation)`, 32 essais au plus, arrêt dès qu'une bande plus large que haute
     échoue (elle ne ferait que s'amincir). Rien ne se construit, ou `H ≤
     séparation` : erreur TYPÉE `StripHeightBelowSeparation` (message préfixé
     `strip_height_below_separation:`).
   - `src/probs/spp/entities/problem.rs` : `try_change_strip_width` et
     `apply_strip` ; `fit_strip` garde la bande actuelle si la largeur ajustée n'a
     pas de conteneur. Côté sparrow et nest-engine, qui réduit ou élargit la bande
     en cours de recherche traite le refus : `lbf.rs` rend `ItemDoesNotFit`,
     `explore.rs` et `compress.rs` s'arrêtent à la dernière largeur construite,
     `separator.rs` sonde AVANT de déplacer une pièce, `column_fill.rs` passe.
   - `src/geometry/primitives/simple_polygon.rs` : `SPolygon::try_from_rect`,
     car `From<Rect>` panique sur un rectangle sans pôle AVANT l'offset (largeur
     minuscule sans espacement). `src/geometry/fail_fast/pole.rs` +
     `primitives/rect.rs` : `try_quadrants`, une cellule trop petite pour être
     coupée arrête la descente. `src/entities/container.rs` + `rect.rs` :
     `can_split`, un conteneur que le quadtree ne pourrait pas couper
     `quadtree_depth` fois est refusé au lieu de paniquer dans `Rect::quadrants`.
   Bit-identique sur tout job dont le conteneur existait : mêmes flottants, seuls
   des chemins qui paniquaient changent (verrou `bench/determinism_lock.py`,
   tests `nest-engine/tests/small_job_default_path.rs`
   et `strip_container_window.rs`). Les gardes amont (`main.py`,
   `localPayloadBuilder.js`) restent en défense.

6. **Copie sparrow** (`crates/sparrow`, pas jagua mais documenté ici avec ses
   voisins) — pièce À LA COTE EXACTE, lot A :
   - `src/sample/uniform_sampler.rs` : **inchangé**. Un premier essai du lot
     retenait les rotations à plage de largeur nulle quand toutes les autres
     étaient vides ; il a été retiré : il faisait tirer et évaluer là où
     l'échantillonneur rendait `None`, donc changeait la trajectoire (layout,
     évaluations) de jobs qui aboutissaient déjà (bande 1000 + pièce 100x996
     en rotations 0/90, BPP 996x1996 sur deux tôles), sans faire poser une
     seule pièce de plus. Verrou : `tests/exact_fit_refusal.rs`,
     `bpp_deux_toles_dont_une_trop_juste_garde_la_trajectoire_de_la_baseline`.
     Le refus typé ci-dessous n'en dépend pas.
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
