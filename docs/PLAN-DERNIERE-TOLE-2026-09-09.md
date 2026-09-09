# Plan « dernière tôle » — la direction choisie s'applique à la tôle partielle (lot 5-moteur, tranche 1) — consigne du 2026-09-09

Rédigé par le vérificateur pour l'implémenteur. Priorité absolue posée par
le propriétaire le 09/09 sur le projet démo multi-tôles : « peu importe
l'orientation choisie, le résultat final ressemble à la même chose : −X ne
pousse pas les pièces de la dernière tôle à fond vers −X, pareil pour −Y,
et équilibré n'a même pas les pièces collées au coin ». Passe avant la
phase C import (qui reste ouverte en parallèle : elle ne touche aucun code
produit).

## 0. Constat mesuré (09/09, image worker = HEAD `6d5dec8`)

Job serveur sur les 24 pièces de la démo (304 pièces, tôle 1500 × 3000 × 3,
espacement 2, rotations 0/90/180/270, standard 4 vcores, budget 120 s,
trois directions) — banc `workers/nesting/bench/seed_demo_dirs.py`,
repère moteur X = 1500 (largeur), Y = 3000 (longueur). Tôle partielle
(la seconde ; la première est pleine à 72 %) :

| Direction | Pièces | Front moteur x_max (avant post-pass) | Après post-pass : x ∈ | y ∈ | Lecture |
|---|---|---|---|---|---|
| left (−X) | 34 | 167,3 | [21,8 ; 131,8] | [313 ; 2604] | colonne −X, mais **flottante** (ni x = 0 ni y = 0) ; 33 pièces déplacées par la compaction |
| bottom (−Y) | 36 | 222,5 | [2 ; 222] | [2 ; 1003] | **bloc 220 × 1000** — pas une bande −Y ; compaction : 0 pièce |
| balanced | 29 | 106,3 | [2 ; 106] | [2 ; 1902] | **colonne −X**, pas un bloc de coin ; compaction : 0 pièce |

Bornes basses d'étendue (aire des pièces / côté de tôle) : 44 mm en X,
88 mm en Y. Les captures du propriétaire (navigateur, mono-walk) montrent
la même chose en pire : un amas de coin de ~400 × 560 mm quelle que soit
la direction.

## 1. Cause (lue dans le code, trois niveaux qui se cumulent)

1. **Le coût du recuit BPP n'a aucune direction.** `sa.rs::layout_remnant`
   = plus grande bande ou L libre autour de l'AABB des pièces ; pour un
   bloc a × b au coin d'une tôle W × H, le L vaut WH − ab : le recuit
   minimise l'**aire** de l'AABB de la tôle partielle, jamais son étendue
   sur un axe. Un bloc carré gagne toujours contre une bande.
2. **Le biais directionnel du constructif est un multiplicateur faible.**
   `constructive.rs::HoleFillEvaluator` : `loss = growth × 10 × (1 +
   1,5 × Δextent / dimension_tôle) + tie-break`. Une pièce de 100 mm qui
   pousse le front sur 1500 mm coûte +10 % ; sur 3000 mm (Y de la démo)
   +5 %. Et le tie-break `bottom_left = 10 × x + y` (`BL_X = 10`) pousse
   TOUT vers −X, biais compris — d'où « balanced » rendu en colonne −X.
3. **Le post-pass de compaction est câblé −X, quel que soit le biais.**
   `residual.py::_compact_last_sheet` / `_regrid_helices` /
   `_relay_frees_behind_anchor` (« gravité −X », ancrage −X) et son miroir
   `residualClient.js::compactLastSheet`. Sur `bottom` et `balanced` il
   contredit la direction demandée ; sur `left` il re-pose au lattice sans
   ancrer au coin (x_min 21,8, y_min 313).

Le pièges #54 d'`AGENTS.md` décrivait déjà 1 (« coût moteur = tôles +
remnant, pas la direction par tôle ») et y répondait par 3. C'est 3 qui
est faux : la direction est un objectif de **solveur**, pas de post-pass.

## 2. Décision (arbitrage délégué, informé au propriétaire)

**La tôle partielle d'un job multi-tôles doit être exactement ce que
donnerait un job mono-tôle SPP des mêmes pièces avec la même direction.**
Le moteur sait déjà le faire : `spp.rs::run_spp_mem` en mode directions
(`left` = largeur min puis phase 2 transposée ; `bottom` = transposé ;
`balanced` = corridor « bras équilibrés » J-088 ; gravité orientée
`gravity_for_bias` ; remplissage `column_fill`). On l'appelle **dans le
moteur, à la fin de chaque walk BPP**, sur les pièces de la tôle la moins
remplie — un seul code, natif ≡ wasm, la vue live et l'export inchangés
dans leur schéma. La compaction −X du post-pass disparaît des deux
langues. Le recuit et le constructif ne changent pas dans cette tranche
(l'affectation des pièces aux tôles est déjà la bonne : 2 tôles, 304
pièces).

## 3. Périmètre fermé

### 3.1 Moteur — `workers/nesting/engine/crates/nest-engine/src/bpp/mod.rs`

Nouvelle fonction `finish_partial_sheet(ext_instance: &ExtBPInstance,
run: &mut BpRun, config: &EngineConfig, started: &Instant) ->
Option<FinishReport>`, appelée dans `run_bpp_mem` sur chaque élément de
`exported: Vec<BpRun>` (ligne ~241, après l'export de chaque walk,
**avant** `merge_bp_runs`). Étapes, dans l'ordre :

1. **Tôle partielle** = layout de `run.solution.layouts` au plus petit
   taux de remplissage (aire des pièces posées / aire du bin, ex æquo →
   index le plus haut). Ne rien faire si `run.cost.unplaced > 0`, si le
   taux > 0,5, ou si le layout a < 2 pièces.
2. **Instance SPP** (`ExtSPInstance`) : les items de ce layout, ids
   réindexés 0..k−1 (piège #3b) avec table de retour vers l'id BPP,
   `demand` = nombre d'occurrences, `strip_height` = hauteur du bin
   (AABB du polygone du `ExtBin` du layout), items = clones des
   `ExtItem.base` (mêmes `allowed_orientations`).
3. **Config de finition** = `config.clone()` puis : `biases =
   Some(vec![run.bias.as_str()])`, `n_workers = Some(1)`,
   `separator_workers = Some(1)`, `max_strip_width = Some(largeur du
   bin)`, `two_phase = Some(true)`, `live_events = Some(false)`,
   `initial_sequence = None`, `n_alternatives = 1`, `prng_seed =
   run.seed ^ 0x5EED_F1N1` (constante nommée), `time_budget_sec =
   clamp(0,25 × time_budget_sec, 3, 15)`, `plateau_patience_sec =
   Some(min(existant, 3,0))`. **Mode déterministe** (`sa_max_iterations`
   est `Some`) : `explore_max_conseq_failed_attempts = Some(30)` et
   `compress_failure_decay = Some(0.7)` s'ils sont `None` (valeurs des
   fixtures SPP du banc) — la finition doit être bornée en travail, pas en
   temps, sinon le verrou natif ≡ wasm tombe.
4. `run_spp_mem(sp_instance, &cfg, &sink_muet)` avec un sink qui jette
   tout (aucun événement SPP ne doit sortir d'un job BPP : Python et
   `engine.worker.js` lisent le flux). Prendre
   `alternatives[0]["solution"]["layout"]["placed_items"]` (repère
   d'origine : pour `bottom`, le mode directions a déjà appliqué
   `map_back_solution`).
5. **Faisabilité** (piège #6, pas de borne dure en SPP) : transformer les
   polygones externes (rotation, translation) et vérifier x_min ≥ −1e−3,
   y_min ≥ −1e−3, x_max ≤ W + 1e−3, y_max ≤ H + 1e−3, et
   `placed_items.len()` = nombre de pièces du layout. Échec → **le layout
   BPP est conservé**, `FinishReport.kept = "bpp"` avec la raison.
6. **Remplacement** : `layouts[idx].placed_items` = les poses SPP avec
   `item_id` re-mappé ; `container_id` inchangé. `run.cost.remnant`
   recalculé avec la même règle que `sa.rs::layout_remnant` (bandes et L
   autour de l'AABB) sur les AABB externes de **tous** les layouts, max —
   écrire `ext_layout_remnant` à côté de `layout_remnant` et un test qui
   les compare sur un même layout.
7. **Frame live finale** (V14, pièges 14g/46) : si `config.live_events()`,
   émettre une frame `type: layout` de **même schéma** que
   `layout_event`, `stage: "bpp-finish"`, items `[item_id, bin,
   rotation_deg, x, y]` lus directement dans les layouts externes du run
   fini. Le verrou `bpp_live_frame_matches_final_export_off_center` doit
   rester vert avec la finition active.
8. **Traçabilité** : `BpRun` gagne `finish: Option<serde_json::Value>`
   (`{"sheet": idx, "bias": "...", "before": {"xMax","yMax"}, "after":
   {"xMax","yMax"}, "elapsedMs", "kept": "spp"|"bpp", "reason"}`),
   émis dans l'alternative à côté de `cost_detail` (`merge.rs` ~l. 362)
   et relu dans le parse wasm des runs (`merge.rs` ~l. 619, champ
   additif, absent = `None`).

Invariants : `sa.rs` et `constructive.rs` **inchangés** (pas de retouche de
`BL_X` ni `DIR_ALPHA` dans cette tranche) ; affectation pièces → tôles
inchangée ; schémas JSON live et export inchangés (champs additifs
seulement) ; `merge_bp_runs` inchangé hors passage du champ `finish`.

### 3.2 Post-pass Python et JS (un seul post-pass, miroir exact)

- `workers/nesting/core/residual.py` : **supprimer** `_compact_last_sheet`,
  `_regrid_helices`, `_sheet_needs_compaction`, `_relay_frees_behind_anchor`
  si plus appelée, le bloc `perPass["compact"]` de `fill_residual_bands`
  et le paramètre `profile` s'il ne sert plus qu'à la compaction. Balayage
  de code mort obligatoire (convention `AGENTS.md` §7 : grep `scripts/`,
  tests, `workers/`).
- `workers/nesting/core/main.py` (~l. 1705) : si l'alternative moteur
  porte `finish.kept == "spp"`, **ne pas appeler** `fill_residual_bands`
  (la finition remplace fusion et compaction) ; sinon, comportement
  actuel moins la compaction.
- `app/composables/residualClient.js` : supprimer `compactLastSheet`,
  `regridHelices`, `sheetNeedsCompaction` et le bloc « Compaction de la
  tôle la moins remplie » (~l. 1447) ; `app/composables/localBridge.js`
  (~l. 982) : même garde `finish.kept === 'spp'`.
- Tests : retirer les tests de compaction de
  `workers/nesting/tests/test_residual.py` et `app/tests/residualClient.test.js`
  (les nommer dans le rapport), garder ceux de la fusion et de la
  validation (`pairViolates`, T9 coin couvert, distance ≈ 0 multi-itérations).
- `app/components/ResultModal.vue` (~l. 487, détails techniques) :
  remplacer la ligne compaction par la ligne finition : « Dernière tôle :
  bande −X, front 167 → 62 mm » (clés i18n `report.finish.left/bottom/
  balanced/kept`, FR et EN, `app/utils/i18n.js`).

### 3.3 Documentation

`AGENTS.md` : piège #54 réécrit (la compaction −X est retirée ; la tôle
partielle est finie en SPP dans le moteur) et nouveau piège : « **la
direction d'un job BPP est un objectif de solveur** : le remnant du recuit
est sans direction (aire d'AABB), le biais du constructif est un
multiplicateur ≤ +10 % et le tie-break `BL_X` pousse tout vers −X — jamais
un post-pass −X pour corriger ça ». `docs/PLAN-DERNIERE-TOLE-2026-09-09.md`
(ce fichier) reçoit le rapport en §7.

## 4. Verrous chiffrés et commandes

Baseline **avant** toute modification (image actuelle), à rejouer après :

- **L3 banc démo serveur** : `seed_demo_dirs.py` (commande en tête du
  fichier), `BENCH_BUDGET=120`, **trois passages** au repos, workers
  recréés sur l'image mesurée. Après le lot, `BENCH_ASSERT=1` doit sortir
  « verrous L3 tenus » sur les trois passages : tôle partielle **ancrée**
  (x_min et y_min ≤ 5 mm) pour les trois directions ; `left` a le plus
  petit x_max des trois ; `bottom` le plus petit y_max ; `balanced` le
  plus petit max(x_max/W, y_max/H) ; badges overlapFree / spacingOk /
  insideSheet verts ; 304 pièces, 2 tôles. Temps de job : baseline + au
  plus 20 s.
- **L1 verrou moteur** (nouveau) `workers/nesting/bench/lock_last_sheet.py` :
  binaire natif sur `fixtures/b_demo/instance.json` × `config_det.json`
  avec `biases` ∈ {left, bottom, balanced} (une exécution par biais) ;
  imprime la table x/y min/max de la tôle partielle avant (`finish.before`)
  / après, et applique les mêmes verrous comparatifs que L3, plus
  `finish.kept == "spp"` pour les trois et `after.xMax < before.xMax`
  pour `left`, `after.yMax < before.yMax` pour `bottom`.
- **L2 déterminisme** : `python workers/nesting/bench/determinism_lock.py`
  natif ≡ wasm, SHA identiques (la finition est dans le périmètre du
  verrou puisque `b_demo` est un BPP à 3 tôles).
- **L4 navigateur** : `scripts/qa-e2e-local-2sheets.mjs` dans ses deux
  configurations : 900/900, long task après-solve < 100 ms, durée de
  calcul au repos trois passages (baseline aujourd'hui ≈ 9 s ; autorisé
  ≤ baseline + 15 s) ; la seconde tôle de T-A est une tôle partielle : sa
  bande −X (x_max) doit être **inférieure** à la baseline (valeur
  rapportée). `verify_l4a_corpus.sh` 11/11 après `docker compose up -d
  --force-recreate nesting-worker`.
- **L5 démo navigateur en local** (pile locale, compte de test, **aucune
  écriture en production**) : capture Playwright de la tôle partielle des
  trois directions → `docs/qa/derniere-tole-2026-09-09/demo-{left,bottom,
  balanced}.png` + les nombres du rapport (x/y max lus dans le SVG de la
  tôle).
- **L6 suites** : `cargo test --release -p nest-engine` (75 + nouveaux :
  `finish_left_reduces_x_max`, `finish_bottom_reduces_y_max`,
  `finish_keeps_bpp_when_strip_exceeds_sheet`,
  `ext_layout_remnant_matches_layout_remnant`, frame live ≡ export après
  finition) ; `npx vitest run` (517 − tests de compaction retirés) ;
  pytest nesting (≈ 233 − retirés) ; `determinism_lock.py`.
- **Benchmarks publics** régénérés avant déploiement (le moteur change) ;
  déploiement worker + app + wasm dans la même livraison (piège #33b),
  terminé sur le homelab (`assert_overflow_head.py`).

## 5. Ordre imposé

1. `assert_images_head.sh` OK ; baselines L3 (×3) et L4 (×3) sur l'image
   actuelle, valeurs dans le rapport.
2. Moteur (§3.1) + tests cargo + L1 + L2.
3. Post-pass Python et JS (§3.2) + suites.
4. Image worker reconstruite, workers recréés, L3 ×3 avec `BENCH_ASSERT=1`.
5. wasm reconstruit (`build-wasm.sh`), cache navigateur vidé (piège 14i),
   L4 ×3, corpus 11/11, L5 captures.
6. Rapport §7 ci-dessous, constat par constat ; GO vérificateur ;
   benchmarks régénérés ; déploiement complet.

## 6. Pas de décision ouverte — choix déjà tranchés

- Budget de finition 25 % / 3-15 s : si le plateau SPP ne suffit pas sur
  la démo (x_max `left` non minimal à l'œil), proposer **une** valeur
  chiffrée et attendre.
- Seuil « tôle partielle » 0,5 de remplissage : fixe dans cette tranche.
- La fusion inter-tôles (`merge`) reste appelée quand la finition n'a
  pas eu lieu (`kept == "bpp"`) ; son retrait complet se décide à la
  vérification sur les comptes `perPass.merge.moved` du corpus (0 attendu
  partout).
- Hors périmètre : `BL_X`, `DIR_ALPHA`, la direction des tôles pleines,
  les libellés de direction dans l'UI (vue tournée de la démo).

## 7. Rapport (à remplir par l'implémenteur)

Pour chaque verrou : valeur baseline, valeur après, commande, nombre de
passages ; tests retirés nommés ; non-faits énoncés ; hashes de commits.
