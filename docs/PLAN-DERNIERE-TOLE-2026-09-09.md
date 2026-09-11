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

### §7 — Rapport de l'implémenteur (09/09)

Commits : `b651672` (documents du lot), `9ebde5a` (moteur + post-pass +
docs), `1d2622f` (finition en parallèle + trace portée au job), `7e013f4`
(finition limitée aux runs exportés), `1dc07ae` (critère balanced du banc),
`63d0517` (dumps du harnais + verrou L5). **Non déployé.**

#### Ce que la finition donne, mesuré

Banc serveur `seed_demo_dirs.py`, 304 pièces, tôle 1500 × 3000 × 3,
espacement 2, budget 120 s, trois directions, image = HEAD, au repos.
Trois passages APRÈS (`BENCH_ASSERT=1` vert les trois fois) :

| | left (x_max) | bottom (y_max) | balanced (x_max × y_max) |
|---|---|---|---|
| **Avant** (3 passages) | 106 / 122 / 242 | 1211 / 159 / 185 | 207×1055 / 262×1039 / 837×230 |
| **Après** (3 passages) | **94 / 93 / 94** | **119 / 153 / 263** | **224×578 / 280×658 / 261×648** |

Et l'ancrage, qui manquait : `xMin` et `yMin` valent **2,0 mm** (l'espacement)
dans les neuf mesures d'après, contre des tôles flottantes avant
(`yMin` 204 pour left au passage 3, 186 pour balanced au passage 2).

Lecture directe de la trace `finish` (avant → après, même tôle, même run) :

- `left` : 856,7 → **94,4** ; 186,1 → **93,2** ; 939,1 → **94,4** (x_max)
- `bottom` : 166,0 → **118,6** ; 224,0 → **153,1** ; 345,9 → **262,9** (y_max)
- `balanced` : 683×252 → **224×578** ; 274×794 → **280×658** ; 196×1117 → **261×648**

Les trois formes sont désormais **distinctes et conformes à la direction** :
colonne −X étroite, bande −Y pleine largeur, bloc de coin.

#### Verrous

| Verrou | Avant | Après | Commande |
|---|---|---|---|
| **L3** banc serveur, 3 passages | verrous NON tenus (bottom pas le plus petit y_max ; tôle non ancrée 2 fois sur 3) | **verrous tenus 3/3** | `seed_demo_dirs.py`, `BENCH_ASSERT=1` |
| **L1** moteur natif, 3 biais | — (verrou créé) | **tenu** (`kept=spp` ×3, ancré, left x_max minimal, bottom y_max minimal, balanced max(x/W,y/H) minimal) | `bench/lock_last_sheet.py` |
| **L2** déterminisme natif ≡ wasm | — | **SHA identiques**, tolérance 0, `04944ada…` — et INCHANGÉ par la parallélisation | `bench/determinism_lock.py` |
| **L4** navigateur, 3 passages | solve 21,3 / 21,4 / 21,4 s ; tôle partielle x_max **396,3** | solve 54,7 / 57,6 / 54,6 s ; x_max **349,1 / 349,1 / 348,7** | `qa-e2e-local-2sheets.mjs` |
| **L4** long task après solve | 0 / 51 / 52 ms | 51 / 0 / 55 ms — **< 100 ms** | idem |
| **L5** démo navigateur, 3 directions | — | left 113×1493, bottom **1498×124**, balanced 244×629 ; `kept=spp` ×3, badges verts, 304/304 | `scripts/qa-derniere-tole.mjs` |
| **L6** cargo | 75 | **79** (4 verrous de finition) | `cargo test --release -p nest-engine` |
| **L6** vitest | 517 | **514** (3 tests de compaction retirés) | `npx vitest run` |
| **L6** pytest nesting | 227 | **221** (6 tests de compaction retirés) + 2 skipped | image worker + pytest |

Captures L5 : `docs/qa/derniere-tole-2026-09-09/demo-{left,bottom,balanced}.png`
et les nombres dans `demo-finish.json`.

#### Deux verrous de temps NON tenus — chiffrés

- **L3, temps de job** : référence 25 / 20 / 20 s → après **45 / 35 / 30 s**.
  Deux passages sur trois sont dans le budget (+10 et +15 s), le troisième
  est à **+23 s** pour un plafond de +20 s.
- **L4, durée de calcul navigateur** : référence 21,3 / 21,4 / 21,4 s →
  après **54,7 / 57,6 / 54,6 s**, soit **+33 s** pour un plafond de +15 s.

La cause est structurelle et mesurée : une finition coûte **15 à 17 s**
(plafond du plan) et le navigateur **n'a pas un walk mais huit**
(`QUALITY_WALKS`, AGENTS §1), chacun étant un appel wasm mono-walk avec sa
propre finition — sur 4 voies, deux vagues. Côté serveur la finition est
déjà limitée aux **champions de classe** (3 au lieu de 8, gain mesuré : de
115 s à 35 s de temps de job) ; côté navigateur la fusion se fait en JS
après les walks, le moteur ne peut donc pas savoir lesquels seront retenus.

**Décision à prendre par le vérificateur** (le plan §6 fige le budget) :
abaisser le plafond de finition de **15 s à 7 s**. A/B mesuré :

| | 15 s (livré) | 7 s (A/B) |
|---|---|---|
| temps de job serveur | 30-45 s | **25 s** |
| calcul navigateur | 54,6 s | **39,6 s** (+18 s au lieu de +33) |
| tôle partielle navigateur x_max | 349,1 | 353,0 |
| L3 `BENCH_ASSERT` | tenu 3/3 | **NON tenu** : `bottom` sort avec **`spacingOk=false`**, plus petit écart mesuré **1,849 mm pour 2,0 demandés** |

**Je n'ai pas adopté les 7 s** : l'unique passage à ce budget a produit une
tôle sous l'espacement promis. C'est un fait isolé (1 direction-run sur 3 à
7 s, contre 0 sur ~30 à 15 s) et je ne sais pas encore l'imputer — la
finition passe par le même `run_spp_mem` que les jobs mono-tôle, gravité et
`column_fill` compris (piège 14d : à space 2 les gaps du solve tombent déjà
à ~1,998 mm ; ici 1,849). À trancher avec vous : garder 15 s et accepter le
dépassement de temps, ou descendre le plafond après avoir compris ce
1,849 mm.

#### Écarts au périmètre du plan, tous mesurés

1. **`_compact_last_sheet` et `_regrid_helices` NE SONT PAS supprimées.**
   Le balayage (AGENTS §7) les a trouvées importées par
   `core/structure_multi.py` et `structureMultiClient.js` : elles
   construisent l'alternative **GRILLE**, hors périmètre du lot. Seul leur
   APPEL dans `fill_residual_bands` disparaît, avec `profile` et
   `stats['profile']`. `_sheet_needs_compaction` et
   `_relay_frees_behind_anchor` restent donc aussi (elles servent
   `_compact_last_sheet`). Résidu signalé : `_compact_receivers` est morte
   en production (seul un test l'appelle) — pas touchée, elle ne fait pas
   partie de la compaction −X de la donneuse.
2. **« balanced » n'est pas un appel SPP `balanced`.** Mesuré sur `b_demo` :
   `spp.rs::balanced_width` (J-088) équilibre les BRAS DE CHUTE sur toute
   la tôle ; sur une tôle remplie à 2,4 % cette égalité impose une région
   large et plate — **x_max 1755 sur 3000**, le PIRE des trois au critère
   du plan. Et un solveur SPP minimise toujours la largeur : on ne peut pas
   lui demander un bloc large. Le bloc de coin s'obtient en contraignant
   l'AUTRE axe — bande de hauteur `sqrt(aire_utilisée · H / W)` puis
   minimisation de la largeur dedans (le flux « left »). Résultat mesuré :
   617×369 puis 224×578 sur le banc, 244×629 en navigateur. Consigné en
   piège #54b.
3. **Constante `0x5EED_F1N1` du plan** : pas un littéral hexadécimal valide
   (`N`). Remplacée par `FINISH_SEED_XOR = 0x5EED_F111`, même intention.
4. **Signature** : `finish_partial_sheet` prend aussi le `sink` (le §3.1.7
   demande une frame live, il lui faut le puits) et se décompose en
   `plan_finish` (pur, parallélisable) + `apply_finish`.
5. **Verrou L1 « réduction stricte »** : gardé pour `left`, assoupli en
   « pas de régression » pour `bottom` — sur cette fixture le recuit avait
   DÉJÀ la bande (262,2 mm) et la finition rend 263,0 : une réduction
   stricte n'y est pas mesurable. L'absence de gain est imprimée, pas
   masquée.
6. **Verrou L3 croisé** : tenu 3/3 au final, mais il est fragile par
   nature — chaque direction est un walk différent, donc une affectation
   pièces → tôles différente ; une tôle partielle qui hérite d'une pièce de
   300 mm ne peut pas faire de bande plus étroite que 300 mm. Observé une
   fois (`left` x_max 263 = plancher matière contre `balanced` 231,6). J'ai
   ajouté au banc un verrou **apples-to-apples** : chaque direction contre
   sa propre entrée `finish.before`.

#### Autres constats

- **La trace `finish` n'arrivait pas au job** : `core/engine.py` ne la
  recopiait pas à la normalisation — ni la garde de post-pass de `main.py`,
  ni la ligne du rapport, ni le banc ne la voyaient, alors que la géométrie,
  elle, avait bien changé. Champ additif porté dans `engine.py`, main.py,
  `localBridge.js` et les deux dumps du harnais.
- **Référence de parité régénérée** : `out_user_layouts_post_py.json`
  (test `replayUserBpp`) contenait le résultat Python AVEC compaction. Son
  générateur d'origine rejouait un job Mongo disparu ; nouveau générateur
  `bench/regen_user_post_py.py`, qui repart des deux fixtures commitées.
  Après régénération : comptes par tôle [590, 509], `residualMoved 0`,
  parité JS ↔ Python verte.
- **`wasm-opt` absent du poste** : `build-wasm.sh` s'arrêtait après
  `wasm-bindgen` et laissait un artefact non optimisé (1 536 169 octets).
  Installé hors verrou (`npm i --no-save binaryen`), wasm livré à
  **1 318 630 octets** (gzip 472 474) contre 1 290 374 avant le lot.
  À noter : `npm i --no-save <x>` **élague** `playwright` (AGENTS §5) — les
  deux se réinstallent ensemble.
- **Non-fait** : le `qa-e2e-local-2sheets.mjs` en configuration espacement 2
  n'a pas été rejoué après le lot (référence prise : solve 24,4 s, tôle
  partielle x_max 517,7). Seule la configuration 0,1 l'a été, trois fois.
- **Non-fait** : `verify_l4a_corpus.sh` 11/11 et la régénération des
  benchmarks publics — ils appartiennent à l'étape de déploiement, qui
  attend le GO.


## 8. Vérification (vérificateur, 10/09, `2d61efb`) — GO qualité, NO-GO déploiement ; tranche 1-bis

### 8.1 Rejoué sur le poste (image worker et app reconstruites à HEAD, `ASSERT IMAGES=HEAD: OK`)

| Verrou | Résultat |
|---|---|
| cargo `nest-engine` release | 79 + 1 ignoré, 0 échec |
| L1 `lock_last_sheet.py` (natif, det, 3 biais) | tenu ; `kept=spp` ×3 ; left 336,7 → 263,0 (plancher matière : une pièce de 263 mm sur la tôle) ; balanced 987×278 → 618×369 ; bottom sans gain (262,2 → 263,0), imprimé |
| L2 `determinism_lock.py` | natif ≡ wasm, SHA `04944ada…` identiques, tolérance 0 |
| L3 `seed_demo_dirs.py` `BENCH_ASSERT=1` (1 passage vérificateur) | tenu : left x ≤ 83,4 ; bottom y ≤ 128,9 ; balanced 252 × 654 ; ancrage 2,0 mm partout ; badges verts ; 2 tôles ; job 35 s (référence 20-25 s) |
| L5 planches | left = bande le long de Y (x ≤ 113), bottom = bande le long de X (y ≤ 124), balanced = bloc de coin 244 × 629 — les trois formes sont distinctes et conformes |
| L4 harnais espacement 2 (non rejoué par l'implémenteur) | voir 8.4 |

Les résultats de qualité sont **validés** : la direction s'applique enfin à
la tôle partielle, ancrée au coin. Les écarts au périmètre 1 à 6 du
rapport §7 sont acceptés (compaction conservée pour l'alternative grille ;
`balanced` par corridor `sqrt(aire · H / W)` ; constante ; signature ;
verrou bottom « pas de régression » ; verrou apples-to-apples).

### 8.2 Pourquoi pas de déploiement en l'état

1. **Temps navigateur +33 s** : chaque walk wasm (8 par job) finit sa
   propre tôle partielle, alors que la fusion n'en retient qu'un par
   classe. Le serveur ne finit déjà que les champions de classe ; le
   navigateur doit faire pareil, au même endroit du code.
2. **Une finition consomme tout son plafond** (9,9 / 15,3 / 15,5 s sur la
   démo, 20,8 s en mode borné-travail) : la phase 2 hérite du temps
   restant (P5) et le plateau ne l'arrête pas sur 30 pièces. Le plafond
   est donc le coût, pas une borne.
3. **1,849 mm d'espacement à 7 s de plafond** : la finition n'a aucune
   garde de faisabilité au-delà des bornes de tôle. `poly_simpl_tolerance`
   vaut 0,001 en production : ce n'est pas la simplification, c'est un
   vrai chevauchement de 0,15 mm des formes gonflées, livré tel quel.
   Quelle qu'en soit l'origine (post-passes gravité / `column_fill` de
   la phase 2, coupure de budget), la promesse d'espacement ne peut pas
   dépendre du budget.

Décision sur la question posée (accepter le temps ou baisser le plafond) :
**ni l'un ni l'autre en l'état**. On finit une seule fois par alternative
retenue, on garde la faisabilité par construction, et on mesure ensuite
le temps réel avant de toucher au plafond.

### 8.3 Tranche 1-bis — consigne fermée

**Moteur, un seul emplacement pour la finition** :

1. `EngineConfig` (`config.rs`) gagne `finish_partial_sheet: Option<bool>`
   (absent = actif). `run_bpp_mem` ne finit que si le drapeau n'est pas
   `Some(false)` (comportement natif inchangé : champions de classe).
2. `merge.rs::merge_alternatives_json` (chemin wasm du pool) : après
   `merge_bp_runs`, appliquer `finish_partial_sheet` à **chaque
   alternative retenue** dont le run n'a pas déjà `finish` (champ
   additif présent = déjà finie), avec `engineConfig` de l'entrée et la
   seed du run (déjà parsée en u64). Même fonction, même résultat qu'en
   natif : la fusion retient le champion de classe que le natif finit.
3. `app/composables/localPool.js` : `workerEngineConfig` pose
   `finish_partial_sheet: false` sur chaque walk ; le `merge` porte
   `engineConfig` complet (déjà le cas) ; `MERGE_TIMEOUT_MS` devient
   `30_000 + n_alternatives × 16_000` ; avant `postMessage` du merge, le
   pool émet vers la vue un événement `{ type: 'progress', stage:
   'bpp-finish' }` et `LiveNestingView` affiche « Finition de la
   dernière tôle » (clé i18n `live.finishing`, FR/EN) jusqu'au règlement.
4. **Garde de faisabilité dans `plan_finish`** : reconstruire un
   `Layout` jagua du bin (import de l'instance BPP déjà en mémoire :
   `instance.container(bin_id)`), `place_item` de chaque pose re-mappée
   (conversion externe → interne via `pre_transform` de l'item, inverse
   de `int_to_ext_transformation`), puis `layout.is_feasible()` ; faux →
   `kept = "bpp"`, `reason = "infeasible"`. Test cargo
   `finish_rejects_infeasible_strip` (pose SPP artificiellement décalée
   de 0,2 mm sur une paire → rejet).
5. **Trace des phases** dans `finish` : `phases: { p1Ms, p2Ms,
   p1Improvements, p2Improvements, stop: "plateau" | "budget" }`
   (`run_spp_mem` expose déjà ce qu'il faut dans ses événements ; les
   lire par le sink muet remplacé par un collecteur). Aucune décision de
   plafond dans cette tranche : la table des phases sur L3 ×3 et la démo
   navigateur ×3 décidera à la vérification.

**Ménage** : `_compact_receivers` (Python) est morte en production (seul
un test l'appelle) — la retirer avec son test ; miroir JS si présent.

**Verrous de la tranche 1-bis** (en plus de L1, L2, L3 ×3 rejoués tels
quels) :

- L4 harnais **deux configurations** ×3 au repos : 900/900, long task
  après solve < 100 ms, durée de calcul ≤ référence + 16 s (une seule
  finition, 1 direction) — référence 21,4 s (0,1) et 24,4 s (2) ; tôle
  partielle x_max ≤ 349,1 (0,1) et < 517,7 (2).
- L5 démo navigateur ×3 directions : `kept=spp`, formes identiques à la
  planche du 09/09 (mêmes x/y max ± 5 mm à seed égale), temps de calcul
  ≤ référence 21,3 s + 16 s ; un seul événement `bpp-finish` par job.
- Compteur `kept=bpp reason=infeasible` = **0** sur L3 ×3, L4 ×6, L5 ×3
  (toute occurrence est rapportée avec sa trace, elle ne bloque pas si
  ≤ 1 sur 12 mais elle est inscrite au registre).
- L2 déterminisme : inchangé (le drapeau absent = actif ; le verrou
  compare le CLI natif et `run_nesting` wasm, tous deux avec finition).
- vitest, pytest, cargo : comptes rapportés.

Puis rapport en §9, GO vérificateur, benchmarks régénérés (moteur), et
déploiement complet worker + app + wasm + homelab.

### 8.4 Harnais espacement 2 (vérificateur, 10/09, un passage au repos, app locale servant le wasm `9d45dea6…`)

900/900, 2 alternatives (grille + −X), durée de calcul **33 s** (référence
24,4 s : +8,6 s), long task après solve 68 ms. Tôle partielle de −X :
x_max **493,3 → 435,2** (`kept=spp`, 16,4 s), ancrée à 2,0 / 2,0 ; tôle 1
inchangée [2 ; 988]. La finition tient donc aussi dans la configuration
à 2 mm ; le coût de 16 s par finition est confirmé.

## 9. Rapport tranche 1-bis (implémenteur, 10/09)

Commits : `b0751eb` (les cinq points + ménage), `fc51a0c4` (garde de
faisabilité affinée), `d1b201a2` (documents du vérificateur). **Non
déployé.** Image worker et app reconstruites, `ASSERT IMAGES=HEAD: OK`.

### 9.1 Le temps, qui était le motif du NO-GO

| Mesure | Référence (avant) | Tranche 1-bis | Verrou |
|---|---|---|---|
| Harnais navigateur, espacement 0,1 (×3) | 21,3 / 21,4 / 21,4 s | **30,4 / 30,3 / 30,4 s** — **+9 s** | ≤ +16 s ✅ |
| Harnais navigateur, espacement 2 (×3) | 24,4 s (1 passage) | **30,4 / 30,4 / 30,4 s** — **+6 s** | ≤ +16 s ✅ |
| Banc serveur, temps de job (×3) | 20-25 s | **40 / 35 / 40 s** | (pas de verrou 1-bis) |
| Démo navigateur, `left` / `bottom` / `balanced` | 148 / 191 / 191 s (09/09) | **74 / 65 / 102 s** | — |

Le navigateur passe donc de **+33 s à +9 s** : une seule finition par job au
lieu de huit. Le compte se lit directement dans le record — **un seul objet
`finish`** par job dans les six passages du harnais, et le pool n'émet
**qu'un seul** événement `bpp-finish` (verrouillé par `localPool.test.js`,
qui compte l'événement et les frames séparément).

Qualité inchangée là où elle compte : tôle partielle du harnais
**x_max 347,7 / 347,5 / 347,8** à 0,1 (verrou ≤ 349,1) et
**437,4 / 437,4 / 437,0** à 2 (verrou < 517,7 ; le vérificateur mesurait
435,2 sur son poste).

### 9.2 La table des phases — ce que le plafond paie réellement

Elle ne dit pas la même chose selon le job, et c'est le résultat :

| Job | p1 (largeur) | p2 (compaction transposée) | améliorations p1 / p2 | arrêt |
|---|---|---|---|---|
| Harnais 0,1 (×3) | **15,5 s** | **0,14 s** | 14-15 / 1 | budget |
| Harnais 2 (×3) | **15,3 s** | **0,19 s** | 16 / 1 | budget |
| Démo `left` | 2,2 s | **13,2 s** | 2 / 10 | budget |
| Démo `bottom` | 2,2 s | 2,6 s (**4,7 s au total**) | 2 / 2 | **plateau** |
| Démo `balanced` | 6,1 s | 7,5 s | 3 / 5 | plateau |

Sur le harnais (900 pièces, une seule direction) **la phase 1 mange tout le
plafond et la phase 2 reçoit 140 à 190 ms** — la compaction transposée n'a
pas lieu. Sur la démo (304 pièces, 24 formes) le partage est inverse, et
`bottom` s'arrête de lui-même à 4,7 s. Un plafond unique ne convient donc pas
aux deux ; je ne propose pas de valeur, c'était l'objet de la tranche.

### 9.3 La garde de faisabilité a servi deux fois — et ce n'est pas le budget

Elle a d'abord révélé un **faux positif de ma première version** : sur
`b_demo`, `left` sortait `kept=bpp / infeasible` alors que le défaut n'était
pas une paire mais un **contact avec le contour** de la tôle (la carte de
collision déflate le conteneur de space/2, piège #49, et la phase 2
transposée rend des coordonnées à ~1e-4 du bord). `infeasibility_of` dit
maintenant laquelle des deux causes s'applique : **seul « pair » rejette**,
« sheet » est noté dans la trace (`reason: "sheet-contact"`, `kept` reste
`spp`). Le containment réel reste contrôlé sur les anneaux BRUTS (±1e-3) et
remesuré par `insideSheet` en aval.

Puis elle a attrapé **deux vraies violations de paire**, avec le plafond de
15 s — donc **le 1,849 mm n'était pas un effet du budget de 7 s** :

| Occurrence | Job | Direction | Effet |
|---|---|---|---|
| 1 | banc serveur, passage 3 | `balanced` | `kept=bpp`, `reason="infeasible: pair"` — layout moteur conservé, badges verts |
| 2 | démo navigateur | `balanced` | idem |

**Compteur `kept=bpp reason=infeasible` : 2 sur 18 exécutions de direction**
(L3 ×3 = 9, L4 ×6, L5 ×3). Le plan tolère « ≤ 1 sur 12 » : nous sommes au
même taux, au-dessus en valeur absolue. **Les deux occurrences sont sur
`balanced`** — c'est le chemin que j'ai construit en corridor de hauteur
(§7 écart 2), avec gravité et `column_fill` dans un corridor serré : le
suspect désigné est là, pas dans le budget. Sans la garde, ces deux tôles
partaient telles quelles (c'est ce qui s'est passé le 09/09 à 7 s).

Verrou dédié : `finish_rejects_infeasible_strip` — deux carrés à 2,5 mm
acceptés, à 1,8 mm rejetés, à 10 mm des bords pour isoler la distance entre
pièces du contact au contour.

### 9.4 Verrous rejoués

| Verrou | Résultat |
|---|---|
| **L1** `lock_last_sheet.py` | **tenu** — `kept=spp` ×3 (`left` avec `sheet-contact` noté), ancrage 2,0 mm, left x_max minimal, bottom y_max minimal, balanced max(x/W, y/H) minimal |
| **L2** `determinism_lock.py` | **natif ≡ wasm**, tolérance 0, SHA `04944ada…` — **la MÊME valeur qu'avant la tranche** : ni la garde, ni le drapeau, ni le collecteur ne changent la géométrie livrée |
| **L3** `seed_demo_dirs.py BENCH_ASSERT=1` ×3 | **2 passages sur 3** — le troisième tombe sur le rejet `balanced` ci-dessus (badges verts, 304/304, 2 tôles) |
| **L4** harnais ×3 en 0,1 et ×3 en 2 | **tenu** (temps, x_max, 900/900, long task après solve 0-59 ms) |
| **L5** démo ×3 directions | `kept=spp` sur `left` (x 113,0 — identique à la planche du 09/09) et `bottom` (y 153,0) ; `balanced` rejeté. Captures refaites |
| cargo `nest-engine` | **80** + 1 ignoré (nouveau : `finish_rejects_infeasible_strip`) |
| vitest | **514** |
| pytest nesting | **220** + 2 skipped (−1 : le test de `_compact_receivers`) |

### 9.5 Écarts et non-faits

1. **Point 2 du §8.3 appliqué AVANT `merge_bp_runs`, pas après.** Finir les
   alternatives déjà construites obligerait à reconstruire le JSON de sortie.
   Je sélectionne les champions avec la règle EXACTE de `merge_bp_runs`
   (coût lexicographique, seed en tie-break, faisables d'abord) puis je
   finis, puis je fusionne — c'est ce que fait le chemin natif, donc « même
   fonction, même résultat » comme demandé. `finish_exported_runs` est la
   fonction unique appelée des deux côtés.
2. **Verrou L5 « mêmes x/y max ± 5 mm à seed égale » non vérifiable** : la
   démo navigateur tire un master seed neuf à chaque job, les seeds ne sont
   pas égales d'un passage à l'autre. `left` retombe exactement sur 113,0,
   `bottom` sort à 153,0 contre 124,1 le 09/09 — écart de tirage, pas de
   régression (badges verts, forme conforme).
3. **Compteur d'infaisabilité au-dessus de la tolérance** (2/18 contre
   « ≤ 1 sur 12 ») — inscrit ici avec sa trace, comme demandé. Je n'ai pas
   cherché la cause dans le SPP : la tranche interdit toute décision de
   plafond et la garde contient le défaut.
4. **`.testparts/` est passé au `.gitignore`.** AGENTS.md le décrit comme
   ignoré ; il ne l'était pas. Le corpus d'import (phase C) y a déposé
   18 Mio, dont des fichiers LibreDWG en GPL v3 : un `git add -A` les
   publiait.
5. **Non-fait** : `verify_l4a_corpus.sh` 11/11 et la régénération des
   benchmarks publics — étape de déploiement, elle attend le GO.

## 10. Vérification tranche 1-bis (vérificateur, 10/09, `eaf11ff7`) — temps réglé, NO-GO déploiement pour deux trous de la garde ; tranche 1-ter

### 10.1 Rejoué sur le poste (images worker et app reconstruites à HEAD, `ASSERT IMAGES=HEAD: OK`, wasm servi = dépôt `164ed3d4…`)

| Verrou | Résultat |
|---|---|
| cargo `nest-engine` release | 80 + 1 ignoré |
| L2 `determinism_lock.py` | natif ≡ wasm, SHA `04944ada…` (inchangé) |
| L1 `lock_last_sheet.py` | tenu — mais `balanced` rend **628,0 × 360,8** là où le même fixture en mode déterministe donnait **617,6 × 368,6** le 09/09 : la finition `balanced` n'est pas reproductible d'une version à l'autre en mode borné-travail (voir 10.2, point 3) |
| L3 `seed_demo_dirs.py BENCH_ASSERT=1` ×2 | passage 1 tenu (left 123, bottom 118, balanced 303 × 574, phases : left et balanced s'arrêtent au plateau en 6-9 s, bottom au budget) ; **passage 2 : `balanced` rejeté `infeasible: pair`** → 3e occurrence connue, toutes sur `balanced` (2 sur 6 au banc serveur, 1 sur 3 en démo navigateur) ; left et bottom : 0 sur 12 |
| L4 harnais 0,1 (1 passage au repos) | voir 10.3 |

Le temps est réglé (une finition par alternative, +6 à +9 s navigateur
mesurés par l'implémenteur, table des phases lisible). Le point 2 appliqué
avant la fusion avec la règle exacte des champions est accepté.

### 10.2 Ce qui bloque encore le déploiement

1. **La garde masque les paires dès qu'une pièce touche le contour.**
   `infeasibility_of` rend `"sheet"` (non bloquant) dès qu'UNE pièce seule
   collisionne avec le conteneur déflaté, **sans avoir vérifié les paires**.
   Or le contact au contour est fréquent (2 des 3 biais de L1 le portent) :
   un layout avec contact ET chevauchement de paire passe aujourd'hui.
2. **Le contact au contour n'est pas borné.** « sheet » est accepté quelle
   que soit sa profondeur ; seul le containment brut (±1e−3) le limite.
   Une pièce peut donc être livrée à moins de `space` du bord de tôle.
3. **`balanced` produit des paires infaisables une fois sur trois** et
   dérive en mode déterministe. Cause non cherchée (la tranche
   l'interdisait). Le suspect est le chemin corridor : `gravity_for_bias`
   et `column_fill` dans un corridor de hauteur `ty`, et la patience de
   plateau **en temps** (P5) qui reste active en mode borné-travail — la
   finition peut donc s'arrêter à un autre endroit selon la machine.

### 10.3 Harnais 0,1 (vérificateur, un passage au repos)

900/900, durée de calcul **24 s**, un seul objet `finish` dans le record,
aucun événement parasite ; tôle partielle −X x_max **396,3 → 348,7**
(verrou ≤ 349,1), ancrée 0,1 / 0,1 ; long task après solve 72 ms ; phases
p1 15,8 s / p2 0,19 s, arrêt au budget (même profil que l'implémenteur :
sur 374 pièces la phase 1 consomme le plafond et améliore encore).

### 10.4 Tranche 1-ter — consigne fermée (petite, avant déploiement)

1. **Paires d'abord, contour ensuite** (`infeasibility_of`) : la
   vérification de paire se fait avec un filtre de hasards qui **exclut le
   conteneur** (`HazardFilter` jagua sur la clé du bin, ou probe dans un
   conteneur agrandi de 2·space) ; `"pair"` rejette toujours, même en
   présence d'un contact. Test cargo `finish_rejects_pair_even_with_sheet_contact`.
2. **Contact au contour borné** : `"sheet"` n'est accepté que si l'AABB
   BRUTE de chaque pièce garde ≥ `space − 0,05 mm` des quatre bords du bin
   ; sinon rejet `reason = "sheet"`. Test `finish_rejects_deep_sheet_contact`.
3. **Mode borné-travail vraiment borné** : quand `sa_max_iterations` est
   `Some`, la config de finition pose `plateau_patience_sec = None` et
   `time_budget_sec = 86 400` (comme `run_spp_mem` en det). L1 exécute
   chaque biais **deux fois** et exige des `finish` identiques (JSON
   égal) ; L2 doit rester à `04944ada…` ou la nouvelle valeur est
   expliquée (le changement de config det est une raison valable, à
   écrire).
4. **Cause des paires `balanced`** : variable `NEST_FINISH_DUMP=<dir>`
   (natif) qui écrit, pour tout rejet, l'instance SPP, la config de
   finition et la solution rejetée ; rejouer le rejet du banc L3 ; mesurer
   la paire (distance, pièces) et dire quel pas l'a produite : solve
   phase 1, phase 2 transposée, `gravity_for_bias`, `column_fill`
   (comparer les poses après chaque pas). Règle de décision : si le pas
   fautif est un post-pass (gravité ou `column_fill`), le désactiver
   **dans la finition pour les trois biais** (`cfg.gravity = Some(false)`
   et/ou `cfg.column_fill = Some(false)`) et remesurer ; si c'est le
   solve lui-même, rapporter avec le dump, sans décision.
5. Verrous : L1 ×2 identiques ; L2 ; L3 ×3 `BENCH_ASSERT=1` avec compteur
   `infeasible` = **0 sur 9** ; L5 ×3 = 0 sur 3 ; L4 deux configurations
   ×1 (temps ≤ référence + 16 s, un seul `finish`) ; cargo, vitest, pytest.
   Si après le point 4 le compteur n'est pas nul, le rapport le dit et le
   déploiement se décide au registre avec le taux mesuré.

Puis rapport §11, GO, benchmarks régénérés, déploiement complet.

## 11. Rapport tranche 1-ter (implémenteur, 10/09)

Commits : `74f5e6f6` (§10 du vérificateur), `76092d90` (points 1 à 4),
`73bcc95b` puis `bd2c9bca` (les deux recalibrations de la garde imposées
par la mesure). **Non déployé.** Images reconstruites,
`ASSERT IMAGES=HEAD: OK` avant chaque banc, poste au repos.

### 11.1 Les trois points de forme : tenus

| Point | Résultat mesuré |
|---|---|
| **1. Paires d'abord** | La détection ne peut plus être masquée par un contact : probe dédié dans un conteneur agrandi de 2·space, items ré-importés. Verrou `finish_rejects_pair_even_with_sheet_contact` (une pièce collée au bord + deux pièces qui se chevauchent → verdict `pair`). **Votre trou n°1 est confirmé** : en 1-bis, `left` sur `b_demo` passait derrière son `sheet-contact` |
| **2. Contact au contour borné** | L'AABB **brute** de chaque pièce doit garder `space − 0,05 mm` des quatre bords, sinon rejet `reason = "sheet"`. Arithmétique exacte, **aucun faux positif** sur 14 exécutions de direction. Verrou `finish_rejects_deep_sheet_contact` (marge 0 rejetée, 2,0 mm pour 2,0 promis acceptée) |
| **3. Borné-travail sans horloge** | `plateau_patience_sec = None` et `time_budget_sec = 86 400` dès que `sa_max_iterations` est posé. **Géométrie reproductible au dernier chiffre** : deux exécutions des trois biais rendent les mêmes `before`/`after`. La dérive `balanced` (628 × 361 contre 618 × 369) a disparu |

Deux corrections de méthode dans mes propres verrous :

- le verrou de reproductibilité comparait le JSON `finish` **entier**,
  durées comprises. `elapsedMs` est du temps mur et les compteurs
  d'améliorations comptent des événements émis sous throttle temporel :
  ni les uns ni les autres ne peuvent être identiques, et l'exiger rendait
  le verrou intenable pour rien. Il porte désormais sur la **géométrie et
  le verdict** ;
- `phases.stop` rend `"work"` en mode borné-travail : annoncer « plateau »
  avec un budget de 24 h serait faux.

**Effet de bord assumé du point 3** : c'était la patience *en temps* qui
bornait la finition en déterministe. Sans elle, elle va à sa borne de
travail : **190 / 203 / 456 s** par biais au lieu de 8 à 21 s, donc L1
dure ~25 min. **Aucune conséquence en production** — `sa_max_iterations`
n'existe que dans les fixtures de banc et le verrou de déterminisme.

### 11.2 Le point 4 a retourné la garde, et c'est le résultat du lot

Le dump a servi immédiatement : le rejet `left` de `b_demo` est
**reproductible** en mode déterministe, sans attendre la loterie du banc.

**Étape 1 — votre règle de décision ne s'applique pas.** Les quatre
variantes rejouées sur l'instance SPP dumpée (telle quelle, sans
`gravity`, sans `column_fill`, sans les deux) rendent le **même verdict de
mesure** : `pairsUnderSpace: 0`, distance minimale **2,0001 mm pour 2,0
promis**. Aucun post-pass n'est fautif — il n'y a pas de faute.

**Étape 2 — mesure sur les poses REJETÉES elles-mêmes** (dumpées puis
passées à l'outil qui produit `spacingOk`, `measure_finish_pairs.py`) :
anneaux **bruts**, sans nettoyage `buffer(0)`, **25 polygones valides**,
**distance minimale 2,0001 mm, 0,0000 mm² d'intersection**. L'agencement
était légal ; ma garde le jetait.

**Étape 3 — deuxième constat, indépendant, côté navigateur.** Le harnais à
0,1 rejetait aussi. Or les trois passages de la tranche 1-bis ont **livré**
cette même finition, et la vérification du pipeline l'a mesurée
**`spacingOk: true`, `smallestGapMm: 0.1`** — exactement la promesse, sur
les trois passages.

**Conclusion : la carte de collision de jagua n'est pas un oracle de
« distance ≥ space ».** Elle travaille sur des formes simplifiées puis
gonflées (l'offset d'un sommet convexe dépasse le demi-espacement
uniforme), et l'inflation **referme les canaux capillaires** des pièces à
trous (piège #2) — un hôte redevient plein et sa fan nichée le
« chevauche ». Trois calibrations essayées, trois fois des faux positifs :

| Calibration du probe | Résultat |
|---|---|
| gonflé à `space`, avec l'échappatoire « sheet » (1-bis) | masque les paires derrière un contact — le trou que vous avez trouvé |
| gonflé à `space`, paires d'abord (1-ter) | rejette `left` de `b_demo`, **mesuré légal à 2,0001 mm** |
| gonflé à `space − 0,05` | rejette encore le même cas (seuil mesuré entre 2,00 et 2,02) |
| **sans inflation** (chevauchement seul) | rejette le harnais 0,1, **mesuré `spacingOk: true`, gap 0,1** |

**Ce que j'ai livré** : « pair » devient une **TRACE** —
`reason: "pair-suspect"` plus les poses suspectes, bornées, y compris côté
navigateur où le dump fichier n'existe pas — et n'empêche plus la
livraison. Le **rejet** ne concerne plus que le contour (point 2), exact
et sans faux positif. Le verrou cargo du point 1 garde la **détection** et
son ordre ; son commentaire dit que la politique, elle, est une trace.

**Ce que ça coûte, écrit sans détour** : l'écart sous l'espacement **sans
recouvrement** — le 1,849 mm du §8.2.3 — **n'est pas attrapé par le
moteur**. Il l'est en aval par la vérification, qui l'affiche
(`spacingOk: false`, badge rouge), sans écarter l'alternative.

**Ce qu'il faudrait pour tenir §10.4.1** : l'oracle **exact**, distance
**arête↔arête** sur les anneaux avec trous — le miroir de `pairViolates`,
qui existe déjà en JS et en Python. jagua expose `Edge` mais **aucune**
distance arête↔arête : il faut l'écrire, plus un test de
point-dans-polygone pour les fans nichées (piège #4), et le confronter à
la mesure du pipeline sur le corpus. **Estimé une demi-journée avec ses
verrous. Non engagé** : je ne livre pas un oracle géométrique maison en
fin de tranche sans pouvoir le valider contre la mesure de référence —
le piège #55 rappelle qu'une distance sommet→arête ne voit pas deux
arêtes qui se croisent en leur milieu.

### 11.3 Verrous du §10.4.5

| Verrou | Résultat |
|---|---|
| **L1** `lock_last_sheet.py`, ×2 par biais | **tenu** — `kept=spp` ×3, géométrie identique au dernier chiffre entre les deux exécutions de chaque biais |
| **L2** `determinism_lock.py` | **natif ≡ wasm**, tolérance 0, SHA **`ee837411…`**, stable sur deux passages |
| **L3** `seed_demo_dirs.py BENCH_ASSERT=1` ×3 | **tenu 3/3** — `kept=spp` sur les 9 exécutions de direction, badges verts, ancrage 2,0 mm, 2 tôles, 304/304, job 35 s |
| **L4** harnais 0,1 (×1) | **30,4 s** (référence 21,4 → **+9 s**, verrou ≤ +16) ; tôle partielle **347,7 mm** (verrou ≤ 349,1) ; **une seule finition** ; long task après solve 0 ms ; `spacingOk: true`, gap 0,1 |
| **L4** harnais 2 (×1) | **30,4 s** (référence 24,4 → **+6 s**) ; tôle partielle **437,6 mm** (verrou < 517,7) ; une seule finition ; `spacingOk: true`, gap 2 |
| **L5** démo ×3 directions | **tenu** — `kept=spp` ×3, badges verts, 304/304 ; left 123,0 × 1126,6, bottom **1445,6 × 115,3**, balanced 231,8 × 591,7 ; **74 / 74 / 73 s** contre 148 / 191 / 191 s le 09/09 |
| **Compteur `kept=bpp reason=infeasible`** | **0 sur 14** (L3 ×9, L4 ×2, L5 ×3) — le verrou demandait 0 sur 9 + 3 |
| cargo / vitest / pytest nesting | **82** + 1 ignoré / **514** / **220** + 2 skipped |

Le SHA de L2 change deux fois dans cette tranche, chaque fois pour une
raison écrite : d'abord la config déterministe sans horloge (point 3),
ensuite la finition de `left` de nouveau **appliquée** au lieu d'être
rejetée par la garde (front 336,7 → 263,0 mm). C'est la correction
elle-même, pas un effet de bord.

Une seule occurrence de `pair-suspect` sur les 14 : le harnais à 0,1 — et
la vérification du pipeline mesure cette livraison `spacingOk: true`,
gap 0,1. La trace est donc une **fausse suspicion**, et c'est exactement
ce que tracer au lieu de rejeter permet de voir.

### 11.4 Non-faits

1. **§10.4.1 n'est pas tenu au sens strict** : « pair » ne rejette plus.
   Motif mesuré ci-dessus ; l'oracle qui le tiendrait est chiffré et non
   engagé. La décision vous revient avant déploiement.
2. `verify_l4a_corpus.sh` 11/11 et la régénération des benchmarks publics
   (le moteur a changé) : étape de déploiement, elles attendent le GO —
   avec le worker, l'app, le wasm, et la fin sur le homelab
   (`assert_overflow_head.py`).
3. Le corpus d'import n'a toujours que **4 fichiers issus d'une vraie
   CAO** : `specs/import-corpus/` n'existe pas sur ce poste.

## 12. Vérification tranche 1-ter (vérificateur, 10/09, `a3c4d378`) — décision sur l'oracle, GO déploiement

### 12.1 Rejeu vérificateur

Images worker et app reconstruites à HEAD (`ASSERT IMAGES=HEAD: OK`, wasm
servi = dépôt `d4f35e79…`).

| Verrou | Résultat |
|---|---|
| cargo `nest-engine` release | 82 + 1 ignoré |
| L2 `determinism_lock.py` | natif ≡ wasm, tolérance 0, `ee837411…` (valeur annoncée) |
| L3 `seed_demo_dirs.py BENCH_ASSERT=1` ×1 | `kept=spp` ×3, ancrage 2,0 mm, badges verts, 304/304, 2 tôles, job 35 s ; bottom 1663 → 117,5 (y), balanced 341×568 → 234×621. Le verrou **croisé** tombe sur ce tirage : la tôle −X ne porte que 15 pièces dont une de 300 mm — plancher matière (x 302 → 303, y 546 → 422). Le verrou apples-to-apples tient. À corriger au banc : exempter la comparaison croisée quand la plus grande dimension minimale d'une pièce de la tôle ≥ 0,95 × x_max |
| L4 harnais 0,1 ×1 au repos | 900/900, durée de calcul **21 s** (référence 21,4 s), une seule finition, x_max **396,3 → 347,8**, `pair-suspect` tracé et **mesuré `spacingOk: true`, gap 0,1** par la vérification aval, long task après solve 54 ms, badges verts |

Résultat : la finition livre les trois formes, ancrées, dans les temps,
sans régression mesurable. **GO déploiement** avec la politique de
garde du §12.2.

### 12.2 Décision sur le point 1 (arbitrage délégué, informé au propriétaire)

La mesure de l'implémenteur est acceptée : la carte de collision de jagua
n'est pas un oracle de distance, et une garde qui rejette des agencements
légaux (2,0001 mm mesurés, `spacingOk: true` en aval) est pire qu'une
trace. « pair » en trace, rejet sur le contour seul : **accepté**.

Ce que ça laisse ouvert — un écart sous l'espacement **sans**
recouvrement — n'est **pas une exposition nouvelle** : la finition passe
par le même `run_spp_mem` que tout job mono-tôle, qui n'a jamais eu
d'oracle de distance non plus, et la vérification aval mesure et affiche
le cas (`spacingOk: false`). Le déploiement ne dépend donc pas de
l'oracle exact. **L'oracle exact est engagé en tranche 2**, parce que la
promesse « ≥ space » doit être tenue par le moteur pour tout ce qu'il
livre, finition et mono-tôle compris.

### 12.3 Tranche 2 — oracle de distance exact (après déploiement, ~1 j)

1. `nest-engine` : `ring_min_distance(a: &[(f32,f32)], b: &[(f32,f32)])
   -> f32` arête↔arête (0 si croisement propre — piège #55), plus
   point-dans-polygone pour le containment (fan nichée dans le trou de
   son hôte, piège #4 : distance calculée contre les anneaux **de trou**
   de l'hôte, pas son anneau externe). Module `geometry_check.rs`.
2. **Validation contre la référence, pas contre l'intuition** :
   `bench/measure_finish_pairs.py` (shapely) est la référence ; verrou
   `bench/oracle_parity.py` : sur ≥ 50 layouts (dumps `NEST_FINISH_DUMP`
   des trois biais de `b_demo`, corpus 11 cas, harnais deux
   configurations), `|d_rust − d_shapely| ≤ 1e−3 mm` pour la distance
   minimale de chaque layout, et même verdict `< space − 0,01`.
3. Politique : dans la finition, `d_min < space − 0,01` ⇒ `kept = "bpp"`,
   `reason = "pair"` (rejet redevenu réel, sur mesure exacte) ; dans
   `run_spp_mem` mode directions, une classe dont le champion viole la
   distance est **tracée** (`spacing_violation` dans l'événement `done`)
   — pas de rejet sans repli mono-tôle, on mesure d'abord la fréquence
   sur le corpus avant de décider un repli.
4. Effet de bord du mode borné-travail : les finitions déterministes
   durent 190-456 s (L1 ~25 min, L2 plusieurs minutes). Borner le
   **travail** de la finition en det (`explore_max_conseq_failed_attempts`
   de la finition à 10, `compress_failure_decay` inchangé) pour ramener
   L1 sous 5 min ; le SHA de L2 change une fois, noté.
5. Verrous : parité oracle ≥ 50/50 ; L1 ×2 ; L2 ; L3 ×3 ; compteur
   `reason=pair` rapporté (0 attendu au plafond 15 s) ; suites.

### 12.4 Déploiement (après GO ci-dessous)

Livraison **moteur** : `verify_l4a_corpus.sh` 11/11 après
`docker compose up -d --force-recreate nesting-worker` ; benchmarks
publics régénérés (`densities_corpus.py`, version affichée = commit
déployé) ; déploiement worker + app + wasm dans la même fenêtre (piège
#33b) ; homelab `docker compose pull && up -d --force-recreate` +
`assert_overflow_head.py` ; `NEST_COMPUTE_TOKENS` aligné. Contrôle prod
en lecture seule : démo, trois directions, capture de la tôle partielle
de chacune → `docs/qa/derniere-tole-2026-09-09/prod-{left,bottom,balanced}.png`.

## 13. Déploiement du lot « dernière tôle » (implémenteur, 10/09)

**Déployé** : `f48ac8dd` (app, worker, wasm, homelab). Le contenu moteur
est celui de `179b126` qui a produit les benchmarks —
`git diff 179b1264..f48ac8dd -- workers public/engine` est **vide**, seul
`data/benchmarks.js` sépare les deux commits.

### 13.1 Ordre suivi (§12.4)

1. `docker compose up -d --force-recreate nesting-worker`, puis
   **`verify_l4a_corpus.sh` : CORPUS 11/11 OK** sur l'image reconstruite à
   HEAD (T-A 900/900, tôles [587, 313] — la référence ; T-F partiel et T-J
   refus attendus).
2. Images publiées par le workflow « Build and publish Docker images »,
   puis **corpus rejoué sur l'IMAGE PUBLIÉE** (`ghcr.io/…:179b126`, deux
   workers dédiés, workers compose arrêtés) : **11/11 OK** de nouveau.
3. **Benchmarks publics régénérés** (`densities_corpus.py` sur ce run) :
   **huit des neuf densités publiées sont identiques** au run `b0c36f3`.
   La finition ne refait que la tôle la MOINS remplie d'un job
   multi-tôles, et le corpus public tourne en une seule direction (−X),
   déjà l'axe de l'ancienne compaction : c'est le résultat attendu, pas une
   absence d'effet. Seul **T-F** bouge d'une pièce (89 → 88 sur 90,
   densité 89,0 → 88,0) ; mesuré **trois fois** sur cette image (88, 89,
   88) avant d'être écrit — bruit d'affectation du BPP sur un stock serré,
   noté en commentaire au-dessus du cas.
4. **Worker + app + wasm dans la même fenêtre** (piège #33b) :
   `docker compose pull && up -d` sur Hetzner.
5. **Homelab** : `pull` + `up -d --force-recreate` puis
   **`ASSERT OVERFLOW=HEAD: OK`**.

### 13.2 Contrôles après déploiement (lecture seule)

| Contrôle | Mesure |
|---|---|
| wasm moteur servi par `app.nestorcut.com` | `0cb846ee…` = dépôt HEAD, avec ET sans cache-buster (`cf-cache-status: DYNAMIC`, aucune copie CDN périmée — piège 14i) |
| wasm géométrie servi | `583f24b2…` = dépôt HEAD |
| wasm dans le conteneur app | `0cb846ee…` |
| `core/main.py` du worker prod | `f1fe1bfd…` = HEAD |
| binaire moteur du worker prod | contient `pair-suspect` — donc postérieur à `bd2c9bca` |
| digest worker **prod** | `sha256:e2952edf…` |
| digest worker **homelab** | `sha256:e2952edf…` — **le même**, la file n'est plus servie par deux moteurs |
| `compute_pool` | total **28**, used 0 ; `NEST_COMPUTE_TOKENS=28` des deux côtés |
| Pages | `/`, `/plans`, `/benchmarks`, `/licences` → 200 ; `/benchmarks` affiche **179b126 / 2026-09-10** |
| Journaux | app connectée à Mongo, démo semée, purge passée ; worker en polling, aucune erreur |

**Effet de bord à connaître** : `docker compose pull` tire aussi `mongo:7`,
donc `up -d` a **recréé le conteneur Mongo** (volume intact, `healthy` en
6 s, app reconnectée immédiatement). C'est la procédure du runbook telle
qu'écrite ; l'éviter demande d'épingler le digest de `mongo:7` dans le
compose — décision owner, non prise ici.

### 13.3 Les trois directions sur l'artefact déployé — et un badge rouge

**Ce que je n'ai pas fait comme demandé** : les captures ne sont pas prises
sur `app.nestorcut.com`. `/project/demo` est derrière le middleware `auth`,
il n'existe pas de démo anonyme, et je n'ai pas de compte de production —
or créer un compte de test en prod est précisément ce qui a été interdit
le 09/09. J'ai donc fait tourner **l'image publiée** (celle de prod, mêmes
octets) sur la pile locale et rejoué la démo, trois directions :
`publie-{left,bottom,balanced}.png`, `publie-finish.json`.

| Direction | Tôle partielle | Finition | Badges | Écart min mesuré |
|---|---|---|---|---|
| `left` | 93,2 × 2026,6 | `kept=spp`, 167,8 → 93,2 en x, plateau | verts | 2 mm |
| `bottom` | 1473,0 × 109,9 | `kept=spp`, 224,6 → 109,9 en y, plateau | verts | 2 mm |
| `balanced` | 302,9 × 484,0 | `kept=spp`, 546,0 → 484,0 en y, plateau | **`spacingOk: false`** | (non capturé) |

`balanced` a rendu **une fois** un layout que la vérification aval mesure
sous l'espacement : `overlapFree: true`, `insideSheet: true`, 304/304,
`finish.reason` **vide** (la garde du moteur n'a rien suspecté). Ce tirage
est celui de la pièce de 300 mm (15 pièces, x_max 302).

**Rejoué sept fois de plus sur la même image : sept fois VERT**, écart
minimal mesuré **2,000 mm** à chaque fois — la promesse exactement. Le
défaut est donc réel et **d'une occurrence sur huit**, non reproduit.

**Ce que je ne sais pas encore, et que je n'invente pas** : la
vérification (`nest-report::verify_layout`) prend le minimum de DEUX
familles — écart entre pièces ET écart au bord de tôle — sur TOUTES les
tôles. Un badge rouge ne dit donc ni la famille, ni la tôle : la tôle 0,
dense, n'est pas touchée par la finition. Sans le chiffre ni les poses de
ce passage, l'attribuer à la finition serait une supposition.

**Ce que j'ai livré pour que le prochain rouge soit un constat** :

- le harnais L5 rapporte désormais `smallestGapMm`, `verifyStatus` et
  `duplicatePoses` — un badge sans son chiffre n'est pas une mesure — et
  **dumpe les poses** (`spacing-fail-<dir>.json`) dès que le badge tombe ;
  `QA_DIRS` permet de rejouer une seule direction ;
- `workers/nesting/bench/measure_svg_gaps.py` mesure les SVG de tôles
  LIVRÉS (anneaux bruts, trous compris, shapely) et **sépare les deux
  familles** que le rapport confond en un seul minimum, tôle par tôle,
  avec la paire fautive et la pièce la plus proche du bord.

C'est exactement l'exposition écrite au §11.2 — l'écart sous l'espacement
sans recouvrement n'est plus attrapé par le moteur, seulement mesuré et
affiché en aval. La tranche 2 (§12.3) est donc le bon endroit pour la
fermer, et sa parité oracle ≥ 50 layouts donnera la fréquence chiffrée.

### 13.4 Point 3 : exemption du plancher matière au banc (§12.1)

`piece_floor` rend la plus grande « dimension minimale » d'une pièce de la
tôle (min(w, h) de l'AABB par entité — avec les rotations 0/90 du banc,
une pièce ne peut pas occuper moins sur un axe). Si ce plancher atteint
**0,95 × l'étendue objective** de la direction (x pour `left`, y pour
`bottom`, le côté étroit du bloc pour `balanced`), la comparaison croisée
est **exemptée avec ses chiffres imprimés** — jamais en silence. Les
verrous apples-to-apples restent inchangés. Rejoué une fois : sur un
tirage à 34 pièces, aucun plancher, la comparaison croisée **tient**
(left 83,4 · bottom 136,4 · balanced 236,6 × 610,6, `kept=spp` ×3).

### 13.5 Non-faits

1. **Captures sur app.nestorcut.com** : bloquées par l'authentification,
   voir §13.3. À faire par le propriétaire, ou avec un accès qu'il fournit.
2. **Cause du badge rouge de `balanced`** : non établie (1 sur 8, non
   reproduit) ; l'outillage de mesure est en place.
3. **`app-ci` est rouge depuis le 08/09** (5 exécutions) : `admin/tsconfig.json`
   étend `./.nuxt/tsconfig.json`, absent du runner faute de `nuxt prepare`
   pour l'admin avant vitest. Le workflow qui PUBLIE les images
   (« Build and publish Docker images ») est vert — le déploiement n'en
   dépend pas. Hors périmètre du lot, signalé.
4. Épinglage du digest `mongo:7` dans le compose (§13.2) : décision owner.

## 14. Rapport tranche 2 — oracle de distance exact (implémenteur, 10/09)

Commits : `2a885c65` (l'oracle et la garde), `f500a280` (borne de travail
mesurée). **Non déployé** — le moteur a changé, le déploiement demande de
nouveau corpus, benchmarks publics et homelab, et votre GO.

### 14.1 Ce qui est livré

**L'oracle** (`nest-engine/src/geometry_check.rs`) : distance **arête↔arête**
entre matières, trous soustraits, containment inclus — la sémantique exacte
de `shapely.Polygon.distance`, la mesure de référence du pipeline. 0 sur
croisement (piège #55 : une distance sommet→arête ne voit pas deux arêtes
qui se croisent en leur milieu). Une pièce nichée dans un TROU se mesure
contre l'anneau du trou (piège #4), une pièce dans la MATIÈRE rend 0.
Rotations d'un quart de tour exactes, aucune transcendantale hors angle
libre (piège 14b).

**La garde de la finition rejette de nouveau une paire**, sur mesure
exacte, sous `space − 0,01 mm` — la **même tolérance que `spacingOk`** en
aval, pour que le moteur et le rapport ne puissent pas dire l'inverse l'un
de l'autre du même layout. **L'écart sous l'espacement sans recouvrement —
le 1,849 mm du §8.2.3, hors de portée depuis la tranche 1 — est attrapé
dans le moteur.** Verrou : 2,5 passe, 2,0 passe, **1,8 rejeté**, 1,985
rejeté, chevauchement rejeté, pose dupliquée rejetée.

**Le chiffre est livré, pas seulement le verdict** : `finish.minDistanceMm`
dans la trace (serveur ET navigateur), et le dump `NEST_FINISH_DUMP` devient
auto-suffisant (formes des pièces posées + poses + chiffre mesuré) — c'est
ce que consomme la parité.

**Le mode directions de `run_spp_mem` mesure ce qu'il livre** :
`spacing_violations` dans l'événement `done` (champ additif, tableau vide
quand tout est conforme). Trace et non rejet : en finition, rejeter veut
dire « garder le layout BPP » ; sur un job mono-tôle, rejeter voudrait dire
ne rien livrer. On mesure la fréquence d'abord.

**La carte de collision quitte la garde**, et avec elle **l'import jagua
complet que le thread de fusion du navigateur payait** uniquement pour
finir une tôle.

### 14.2 Le verrou de parité a attrapé un faux positif dans mon oracle

À écrire en premier parce que c'est le fait marquant de la tranche : la
**première** version de l'oracle rejetait `left` de `b_demo` en mesurant
**0,0 mm**. La parité contre shapely sur le même dump (23 pièces, 7 formes
de 6 à 133 sommets, aucun polygone invalide) donnait **2,0 mm**.

**Cause** : je testais le containment en échantillonnant centroïde, sommets
et milieux d'arêtes — le miroir du code JS. Or **le centroïde d'aire d'une
pièce concave tombe hors de la pièce** (un C, un L : la moitié des pièces
marines de la démo), et il peut tomber dans la matière du voisin. La garde
concluait « l'une est dans l'autre ». Un point d'épreuve ne vaut que si
l'on sait de quel côté de la frontière il est.

**Correctif, plus simple que la version fausse** : si les frontières ne se
croisent pas, la frontière de A est entièrement dedans ou entièrement
dehors de B — un **sommet** de A suffit à trancher, et un sommet est par
construction sur la frontière de A. Plus de centroïde, plus
d'échantillonnage, plus d'epsilon « strictement intérieur », plus
d'heuristique d'AABB. Vérifié par un miroir Python de l'algorithme corrigé
contre shapely sur les 9 layouts déjà dumpés (**écart max 0,000000 mm**)
AVANT de rebâtir les images.

C'est exactement ce que le §12.3.2 demandait : « validation contre la
référence, pas contre l'intuition ». Sans ce verrou, je livrais une garde
qui jette des finitions correctes — le défaut de la tranche 1-bis, à
l'envers.

### 14.3 Verrous du §12.3.5

| Verrou | Résultat |
|---|---|
| **Parité oracle** `bench/oracle_parity.py` | **TENUE — 50 layouts**, écart max **0,0001 mm** (tolérance 1e−3), **0 désaccord de valeur, 0 de verdict**. Corpus des layouts : les 11 cas T-A..T-K, la démo (trois directions), et les fixtures à TROUS (`trou100`, `trou600`) — le cas qui piège les distances naïves |
| **L1** `lock_last_sheet.py` ×2 par biais | **tenu** — `kept=spp` ×3, géométrie identique entre les deux exécutions, ancrage 2,0 mm, **574 s** (contre ~25 min en 1-ter) |
| **L2** `determinism_lock.py` | **natif ≡ wasm**, tolérance 0, SHA **`a1bd8810…`** (était `ee837411…`) — la borne de travail change, donc la trajectoire : raison écrite avant la mesure, pas après |
| **L3** `seed_demo_dirs.py BENCH_ASSERT=1` | **15 passages, 15/15 tenus**, **45/45 `kept=spp`**, badges verts, 304/304 |
| **Compteur `reason=pair`** | **0** — sur **62 layouts finis** mesurés (50 serveur + 12 natifs) |
| **Corpus** 11 cas | **11/11 OK** |
| **L4** harnais 0,1 (au repos) | **30,4 s** (réf. 21,4 → +9 s, verrou ≤ +16) ; tôle partielle 396,3 → **348,4** (verrou ≤ 349,1) ; **une finition** ; `minDistanceMm` **0,1000** = `smallestGapMm` **0,1** ; `reason` vide |
| **L4** harnais 2 (au repos) | **30,4 s** (réf. 24,4 → +6 s) ; 487,7 → **436,8** (verrou < 517,7) ; `minDistanceMm` **2,0000** = `smallestGapMm` **2** |
| **L5** démo ×3 directions | **3/3 `kept=spp`**, badges verts, 304/304, écart mesuré **2 mm** partout ; left 94,4 × 1470,8, bottom **1497,1 × 116,3**, balanced 236,9 × 621,6 ; 64 / 73 / 74 s |
| cargo / vitest / pytest nesting | **90** (89 + 1 ignoré ; 7 nouveaux verrous d'oracle) / **514** / **220** + 2 skipped |

**Ce que mesurent les 62 tôles finies**, puisque le chiffre est maintenant
dans la trace :

| Écart minimal mesuré | Occurrences (espacement demandé 2,0 mm) |
|---|---|
| 2,0000 | 23 |
| 2,0001 | 25 |
| 2,0002 à 2,0006 | 9 |
| 1,9999 | 1 (dans la tolérance de 0,01) |

Plus une tôle à 0,1 pour 0,1 demandé et une à 0,5 pour 0,5. **Aucune sous
la promesse.** La finition tenait donc déjà l'espacement : ce que la
tranche apporte n'est pas un gain de qualité, c'est la **preuve** — et une
garde qui ne se trompe plus dans les deux sens.

Le harnais à 0,1 mérite une phrase : en tranche 1-ter, ce cas portait un
`pair-suspect`, une **fausse suspicion** de la carte de collision. La
mesure exacte la fait disparaître (`reason` vide, `minDistanceMm` = 0,1000
= la vérification aval).

### 14.4 Non-faits et écarts

1. **« L1 sous 5 minutes » n'est pas atteint** : 574 s mesurés (9,6 min).
   La courbe, mesurée biais par biais sur `b_demo` :

   | Borne d'exploration (déterministe) | `left` | `balanced` | L1 |
   |---|---|---|---|
   | 30 (1-ter) | 190 s | 456 s | ~25 min |
   | 10 | 112 s → x 263,0 | 285 s → 603,4 | 17,4 min |
   | **4 (livré)** | 52 s → x **263,0** | 160 s → **602,3** | **9,6 min** |
   | 2 | 25 s → x 263,0 | 103 s → **614,5** | ~6,2 min |

   **4 est le dernier palier sans perte** : la géométrie y est celle de la
   borne 30 sur les trois biais. Descendre à 2 gagne trois minutes et fait
   reculer `balanced` de 1,2 % (max(x/W, y/H) 0,242 → 0,245) ; passer sous
   5 min demanderait cette perte, ou de ne vérifier la reproductibilité que
   sur un biais au lieu de trois. Je n'ai fait ni l'un ni l'autre : rogner
   un verrou pour tenir un chiffre, c'est perdre le verrou et le chiffre.
   L'arbitrage vous revient. La production n'est concernée par aucune de
   ces valeurs (`sa_max_iterations` n'existe qu'au banc et dans L2).
2. **`spacing_violations` n'a encore rien à montrer** : le tableau est vide
   sur tout ce que j'ai mesuré. C'est le résultat attendu — et il faut le
   lire pour ce qu'il est : la fréquence sur le corpus n'est pas
   « mesurée à zéro », elle est **inférieure à ce que 62 layouts
   révèlent**. La décision d'un repli en mono-tôle attend cette fréquence.
3. **La trace navigateur n'est pas affichée** : `spacing_violations` et
   `minDistanceMm` vivent dans le record IndexedDB et dans l'événement
   `done`, pas dans l'UI. Le badge d'espacement du rapport reste la seule
   chose que voit l'utilisateur — c'est délibéré, mais ce n'est pas de
   l'observabilité produit.
4. **Le badge rouge du §13.3 (1 sur 8) n'est pas expliqué par cette
   tranche** : s'il venait d'une paire de la tôle FINIE, la garde exacte le
   rejetterait désormais et garderait le layout BPP ; s'il venait de la
   tôle dense que la finition ne touche pas, il reste possible. Non
   reproduit depuis (L5 ×3, 15 passages L3, harnais ×2, tous verts) ;
   l'outillage du §13.3 l'attrapera avec ses chiffres.
5. **Déploiement** : le moteur a changé, donc corpus 11/11 sur l'image
   publiée, benchmarks publics régénérés, worker + app + wasm dans la même
   fenêtre et homelab — après votre GO.

## 15. Vérification tranche 2 (vérificateur, 10/09, `eb43defb`) — GO déploiement, fin du chantier

Rejoué sur le poste, images worker et app reconstruites à HEAD
(`ASSERT IMAGES=HEAD: OK`) :

| Verrou | Résultat |
|---|---|
| cargo `nest-engine` release | 89 + 1 ignoré |
| L2 `determinism_lock.py` | natif ≡ wasm, tolérance 0, `a1bd8810…` (valeur annoncée) |
| L1 `lock_last_sheet.py` avec `NEST_FINISH_DUMP` | tenu, `kept=spp` ×3 ; left 263,0, bottom 828,7 × 263,0, balanced 602,3 × 368,7 (mêmes valeurs que le rapport, au dixième) |
| Parité oracle `oracle_parity.py` sur mes 6 dumps | **tenue** : écart max **5,8e−5 mm**, 0 désaccord de valeur, 0 de verdict, 0 rejet (note : sous Git Bash le montage docker exige `MSYS_NO_PATHCONV=1`, sinon `/data` est vide et le verrou échoue à raison) |
| L3 `seed_demo_dirs.py BENCH_ASSERT=1` ×1 | tenu ; `kept=spp` ×3, ancrage 2,0, badges verts ; exemption plancher matière imprimée (balanced 260 pour 263, left 130 pour 133) |
| L4 harnais 0,1 ×1 au repos | 900/900, **21 s**, une finition, x_max 396,3 → 347,7, `minDistanceMm` 0,1000 = `smallestGapMm` 0,1, `reason` vide, long task après solve 55 ms |

**Arbitrages (délégués, informés)** : borne de travail déterministe **4
conservée** (dernier palier sans perte ; l'objectif « L1 < 5 min » est
abandonné, 9,6 min acceptés — aucun effet en production) ; `spacing_violations`
reste une trace jusqu'à une fréquence mesurée non nulle ; la trace
navigateur non affichée est un résidu d'observabilité, pas un défaut.

**GO déploiement tranche 2** (procédure §12.4 : corpus 11/11 sur l'image
publiée, benchmarks publics régénérés, worker + app + wasm dans la même
fenêtre, homelab, contrôles en lecture seule). Après ce déploiement, le
chantier « dernière tôle » est **clos** ; le badge rouge 1/8 du §13.3 est
couvert par la garde exacte si sa cause est la tôle finie, et par
l'outillage `measure_svg_gaps.py` sinon.

## 16. Déploiement de la tranche 2 (implémenteur, 10/09)

**Déployé** : `b6e9082d` (app, worker, wasm, homelab). Le contenu moteur est
celui de `e51e294c` qui a produit le corpus et les benchmarks —
`git diff e51e294c..b6e9082d -- workers public/engine` est **vide**, seul
`data/benchmarks.js` sépare les deux commits.

### 16.1 Ordre suivi (§12.4)

1. **Corpus 11/11 OK sur l'image PUBLIÉE** (`ghcr.io/…:e51e294c`, deux
   workers dédiés tirés du registre, workers locaux arrêtés) — vérifiée
   porteuse du nouveau moteur avant de semer (`minDistanceMm` et
   `spacing_violations` présents dans le binaire).
2. **Benchmarks publics régénérés** sur ce run : **les neuf densités
   publiées sont IDENTIQUES** au run `179b126`. C'est le résultat attendu —
   la garde exacte ne déplace aucune pièce, elle mesure. T-F revient à
   89 sur 90 : ce cas oscille d'une pièce selon le tirage (88, 89, 88 sur
   l'image précédente, 89 ici), la série est écrite au-dessus du cas pour
   qu'on ne lise pas une oscillation comme une régression.
3. **Worker + app + wasm dans la même fenêtre** (piège #33b) : `pull` puis
   `up -d` sur Hetzner. Mongo **n'a pas été recréé** cette fois (up depuis
   3 h) — l'effet de bord du §13.2 venait d'un nouveau digest `mongo:7`,
   pas de la procédure.
4. **Homelab** : `pull` + `up -d --force-recreate`, puis
   **`ASSERT OVERFLOW=HEAD: OK`**.
5. **app-ci est VERT sur `main`** (point 2 de la consigne) : voir §16.4.

### 16.2 Contrôles après déploiement (lecture seule)

| Contrôle | Mesure |
|---|---|
| digest worker **prod** | `sha256:3a0c5031…` |
| digest worker **homelab** | `sha256:3a0c5031…` — **le même** |
| binaire moteur prod | porte `minDistanceMm` **et** `spacing_violations` |
| `core/main.py` prod | `f1fe1bfd…` = HEAD |
| wasm moteur servi | `cb87f45a…` = dépôt HEAD, **avec et sans** cache-buster |
| wasm géométrie servi | `583f24b2…` = HEAD |
| `/benchmarks` | affiche **e51e294 / 2026-09-10** |
| Pages | `/`, `/plans`, `/benchmarks`, `/licences`, `/privacy` → 200 |
| `compute_pool` | total **28**, used 0 ; aucun job en attente |
| Journaux | app connectée, démo semée, purge OK ; worker en polling, aucune erreur |

### 16.3 Le badge rouge du §13.3 est LOCALISÉ — et ce n'est pas la finition

Le contrôle de l'artefact déployé (démo trois directions sur les images
publiées, en local faute de compte de production) a **reproduit le défaut**,
cette fois sur `bottom`, et l'instrumentation du §13.3 a fait son travail :
le harnais a écrit le chiffre **et** les poses.

| | Mesure |
|---|---|
| Rapport du job | `spacingOk: false`, `smallestGapMm` **1,883 mm** pour 2,0 promis (`overlapFree` et `insideSheet` verts, 304/304) |
| **Trace de la finition** | `kept=spp`, `reason` vide, **`minDistanceMm` 2,0001 mm** |
| **Tôle 1** (celle que la finition refait, 33 pièces) | paires **2,0002 mm**, bord **2,000 mm** → **conforme** |
| **Tôle 0** (dense, 271 pièces, **jamais touchée par la finition**) | paires **1,883 mm**, **1 paire sous le seuil**, bord 2,002 → **sous le seuil** |
| Paire fautive (anneaux BRUTS, 0 polygone invalide) | une pièce de 420 × 300 mm et une de 90 × 160 mm **logée dans son AABB** — donc un hôte et une pièce nichée |

**Conclusion, mesurée et non déduite : l'écart ne vient ni de la finition,
ni de sa garde.** Il est sur la tôle dense, que la finition ne touche pas ;
et sur la tôle qu'elle refait, sa propre mesure (2,0001) est confirmée par
la vérification aval. La tranche 2 n'a donc pas « raté » ce cas : il est
ailleurs.

**Où, précisément, reste à établir.** Deux mécanismes sont candidats, et je
ne tranche pas sans la mesure qui les sépare :

1. **le solve lui-même** : le navigateur simplifie les anneaux à
   `SIMPLIFY_MM = 0,05` avant de les envoyer (`localPayloadBuilder`), et
   jagua gonfle de `space/2` sur ces anneaux simplifiés — une pose exacte à
   2,0 sur les formes simplifiées peut mesurer ~1,90 sur les anneaux bruts
   que le DXF livre. 1,883 est **en dessous** de cette borne (2 × 0,05 +
   marge), donc ce mécanisme seul ne suffit pas à l'expliquer ;
2. **un post-pass** (hole-fill ou bandes résiduelles) : la paire fautive est
   un hôte et sa pièce nichée, ce qui désigne ce chemin ; mais le repli de
   tolérance de `validateReturn` est `space − 2 × 0,05` = **1,90**, donc
   1,883 aurait dû y être refusé aussi.

Aucun des deux ne rend compte du chiffre à lui seul — c'est exactement
pourquoi je ne conclus pas. **La mesure qui discrimine** : comparer les
poses de cette paire AVANT post-pass (`window.__lastSolveResult`, déjà
dumpé par `qa-e2e-local-2sheets.mjs`) et après livraison. Une demi-journée
avec ses verrous. **Non engagé** : votre consigne est de n'ouvrir aucun
chantier sans votre mot.

**Ce que ça coûte aujourd'hui, en clair** : sur un job multi-tôles du
navigateur, une paire de la tôle DENSE peut sortir sous l'espacement promis
d'environ 0,12 mm, sans recouvrement. La vérification l'affiche
(`spacingOk: false`, badge rouge, écart chiffré) — l'utilisateur n'est pas
trompé, mais la promesse n'est pas tenue sur ce tirage. Fréquence observée
aujourd'hui : **2 sur 12** exécutions de la démo navigateur (une sur
`balanced` avant la tranche 2, une sur `bottom` après). Le serveur, lui,
n'a produit **aucun** cas sur 15 passages du banc L3 (45 exécutions de
direction).

Pièces au dossier : `t2prod-bottom-rouge.png`, `t2prod-finish.json`,
`t2prod-ecart-bottom.json` (mesure par tôle).

### 16.4 app-ci réparé, avec sa cause

Correctif du plan d'import §6 appliqué (`esbuild: { tsconfigRaw: '{}' }`)
et **vérifié dans les deux sens** en masquant `admin/.nuxt`, la condition
exacte du runner :

- sans le correctif : `TSConfckParseError … Cannot find module
  './.nuxt/tsconfig.json'`, 1 fichier en échec, **507** tests ;
- avec : 48 fichiers, **514/514**.

Et une cause de fond que le plan ne mentionnait pas :
**`vitest.config.js` n'était pas dans les chemins déclencheurs d'app-ci** —
le correctif qui répare la CI ne la déclenchait donc pas. Ajouté, avec
`package.json` / `package-lock.json` côté `push` (ils n'y étaient que sur
`pull_request`). **`app-ci` est vert sur `main`** (2 min 13, run
`34512629091`) : le critère « fait quand » est atteint.

### 16.5 Non-faits

1. **Captures sur `app.nestorcut.com`** : toujours bloquées par
   l'authentification (pas de compte de production, et je n'en crée pas).
   La planche vient des images publiées rejouées en local.
2. **Cause exacte du 1,883 mm** : localisée (tôle dense, paire hôte/pièce
   nichée), mécanisme non tranché, mesure discriminante chiffrée et non
   engagée (§16.3).
3. **Diagrammes du site marketing** (plan d'import §6, second point) : les
   64 occurrences de `#007bff` sont toujours là — non demandé dans cette
   consigne, non fait.

## 17. Chantier suivant — l'écart sous l'espacement de la tôle DENSE (consigne fermée, prête à envoyer)

Décision propriétaire du 10/09 : « si je veux 2 mm et que j'ai 1,883, ça
ne me sera pas pardonné ». C'est donc la **priorité 1** du reste à livrer.
Constat (§16.3) : 1,883 mm sur la tôle pleine (271 pièces), paire hôte
420 × 300 / pièce nichée 90 × 160, 2 occurrences sur 12 exécutions de la
démo navigateur, 0 sur 45 côté serveur ; la tôle finie mesure 2,0001.

### 17.1 Objectif

> Aucune paire sous `space − 0,01 mm` sur **aucune** tôle d'un job livré,
> navigateur et serveur, mesurée par l'oracle du moteur ET par la
> vérification aval ; 0 occurrence sur 24 exécutions de la démo (8 par
> direction) et sur les deux configurations du harnais ×3.

### 17.2 Étape 1 — la mesure qui discrimine (½ journée, aucune décision)

1. `app/composables/localBridge.js` : sous `QA_DUMP_PRE_POSTPASS` (variable
   du harnais, jamais en production), conserver dans le record IndexedDB
   les layouts **tels que sortis du moteur** (avant `expandMeta`,
   `applyHoleFill`, `fillResidualBands`) à côté des layouts livrés.
2. `scripts/qa-derniere-tole.mjs` : `QA_DIRS=bottom,balanced`, 12 exécutions ;
   à chaque `spacingOk: false`, dumper la paire fautive **avant** et
   **après** post-pass (`spacing-fail-<dir>-<n>.json` : les deux poses de
   chaque pièce, l'écart mesuré avant et après par `measure_svg_gaps.py`).
3. Verdict par cas : (a) l'écart existe déjà **avant** post-pass → cause =
   solve sur anneaux simplifiés (`NEST_SIMPLIFY_MM` 0,05 côté pipeline) ;
   (b) l'écart apparaît **après** → cause = une passe (`applyHoleFill` /
   `expandMeta` / fusion), nommer laquelle ; (c) ni l'un ni l'autre →
   rapporter avec le dump, sans correctif.

### 17.3 Étape 2 — le correctif, par règle

- Cas (a) : la séparation demandée au moteur devient
  `space + 2 × NEST_SIMPLIFY_MM` **dans les deux constructeurs de charge**
  (`nesting_input_builder.build_engine_config` et
  `localPayloadBuilder.js`, une seule constante partagée dans `shared/`),
  pour que l'écart sur anneaux BRUTS soit ≥ `space`. Coût mesuré :
  densité du corpus 11 cas avant / après (perte tolérée ≤ 0,3 point) et
  T-A 900/900 conservé.
- Cas (b) : la validation de la passe fautive passe à l'oracle exact au
  seuil `space − 0,01` sur anneaux bruts (les fonctions `pairViolates`
  JS / Python existent ; le repli de tolérance à 1,90 disparaît), miroir
  exact des deux langues, verrou qui compte les paires < seuil sur le
  chemin multi-itérations (piège #56).
- Dans tous les cas : **l'export BPP du moteur mesure toutes ses tôles**
  avec `geometry_check::min_pair_distance_upto` et écrit
  `spacing_violations` (tôle, paire, écart) dans l'événement `done`, comme
  le mode directions SPP le fait déjà — la source dit le chiffre.

### 17.4 Verrous

Démo navigateur 8 × 3 directions : `smallestGapMm ≥ space − 0,01` sur
100 % des jobs, `spacing_violations` vide ; harnais deux configurations
×3 : 900/900, temps ≤ référence + 1 s ; corpus 11/11 et densités
rapportées avant / après ; L2 déterminisme ; cargo, vitest, pytest.
Rapport en §18, GO, déploiement complet (moteur si 17.3 touche le
moteur : benchmarks, homelab).

## 18. Rapport « espacement tenu sur toutes les tôles » (implémenteur, 11/09)

Commits : `bda94d4b` (le correctif et ses verrous), `87af9187` (validation
indexée + mesure du temps de la passe), `6e7e1ee0` (docs du vérificateur et
consigne §17), `8f35729a` (ce rapport).
**Non déployé.** Images reconstruites, `ASSERT IMAGES=HEAD: OK`.

**Deux défauts distincts sous un même symptôme.** L'un est trouvé, corrigé
et verrouillé ; l'autre est un **verdict (c)** que je documente sans y
toucher, parce que les trois causes candidates sont infirmées par la mesure.

### 18.1 Étape 1 — le verdict, et ce qu'il a coûté de le mesurer

L'événement est rare : **2 sur 12** exécutions au §16.3, puis **0 sur 47**
le lendemain. Attendre une occurrence coûte une heure de banc, et ne dit
toujours pas quelle passe a bougé quoi. J'ai donc élargi l'instrumentation
de l'étape 1 (toujours de la mesure, aucun correctif) :

- l'état MOTEUR des layouts est conservé sous `QA_DUMP_PRE_POSTPASS`, le
  drapeau voyage **explicitement** (option `qa`) et non par le payload —
  le seed canonique se calcule sur le contenu du payload, y glisser un
  champ de QA changerait la mesure elle-même ;
- le cliché est pris **avant la première mutation** : les passes mutent les
  layouts en place, un cliché tardif comparerait l'état final à lui-même ;
- les **deux états sont écrits à chaque exécution**, pas seulement quand le
  badge tombe : la distribution avant/après sur douze exécutions vaut mieux
  qu'une occurrence par heure ;
- le cas « **toutes les alternatives écartées** » (job remboursé) ne
  laissait ni record ni artefact — donc aucune trace du pire cas. Ses
  états de poses sont maintenant conservés et relayés au harnais ;
- `scripts/qa-replay-postpass.mjs` rejoue les passes **une par une** sur un
  état figé, et chaque étape est mesurée par `measure_svg_gaps.py`
  (shapely, anneaux bruts) — la mesure ne se fait pas dans le langage qui
  a produit le défaut.

Une correction de ma part dans l'outil : j'avais converti la rotation des
poses en degrés alors qu'elle **est** déjà en degrés. Erreur de facteur 57
qui aurait rendu toute la mesure absurde sans le dire ; le commentaire du
code la fixe désormais.

**Verdict, sur deux occurrences capturées :**

| Occurrence | Avant post-pass | Après post-pass | Verdict |
|---|---|---|---|
| rejet total du 10/09 (`balanced`) | **2,0001 mm**, 0 paire sous le seuil | **0,0 mm**, **27 paires**, **9 doublons** | **(b) une passe** |
| 1,8867 mm du 11/09 (`bottom`) | **1,8867 mm** | 1,8867 mm | **(a) puis (c)** — voir 18.4 |

Le rejeu passe par passe nomme la passe du cas (b) : `applyHoleFill`
(13 relocalisations) ; `fillResidualBands` déplace 0 pièce et le second
hole-fill 0 — ils ne touchent à rien.

### 18.2 La divergence JS ↔ Python, à la ligne

Sur la paire fautive de ce rejet — un hôte de 420 × 300 et une pièce de
60 × 70 **posée dedans** :

| Mesure de la même paire | Résultat |
|---|---|
| `localBridge._polyPolyDist`, la fonction qui validait le hole-fill | **4,2477 mm** |
| `shapely.distance`, ce que le Python et la vérification aval utilisent | **0,0 mm** |

`_polyPolyDist` était une distance **sommet→segment** dans les deux sens :
elle ne teste ni le croisement d'arêtes, ni le containment. Une pièce
posée *dans* une autre lui rend la distance de ses sommets au bord de
l'autre. C'est le **piège #55 du dépôt**, corrigé en septembre dans
`residualClient` et **jamais dans `localBridge`** — là où le hole-fill
valide. Rejoué sur la MÊME entrée : l'ancien Python relocalisait **0**
pièce, l'ancien JS **13**, toutes illégales.

### 18.3 Correctif, miroir exact des deux langues

1. **Distance exacte** (JS) : arête↔arête, 0 au croisement, containment
   tranché sur un **sommet** (frontières disjointes ⇒ la frontière de A est
   entièrement dedans ou dehors), et distance de **MATIÈRE** — trous
   soustraits. Ce dernier point n'est pas un détail : ma première version
   validait sur les anneaux extérieurs et faisait tomber deux verrous du
   dépôt à 0 relocalisation, parce qu'un filler niché dans un trou est
   **légal** (piège #4).
2. **Portée TÔLE** et non trou : chaque pose est validée contre tous les
   occupants de la tôle, **y compris les pièces déplacées par la même
   passe** — c'est ainsi que deux pièces envoyées au même endroit se
   voient. Seuil `space − 0,01`, celui de `verify_layout` : la passe et la
   vérification disent désormais la même chose du même layout, et le repli
   à `space − 2 × SIMPLIFY` (1,90 pour 2,0 demandés) disparaît.
3. **Ceinture par tôle** : cliché avant la première mutation (piège #58),
   mesure exacte après la passe, toute paire sous le seuil ou pose
   dupliquée **annule la passe sur cette tôle** (`postPass.holeFillRollback`).
   Le layout moteur conforme est livré plutôt qu'un job remboursé.
4. **Python aligné** sur la portée et la ceinture (sa distance était déjà
   exacte) : les deux langues appliquent la même règle, sinon la prochaine
   divergence est déjà écrite.

Deux optimisations, honnêtement présentées : index spatial des occupants et
plafond avec élagage par bbox d'arête sur la distance. Elles rendent la
validation exacte insensible à la densité — mais elles ne visaient pas la
bonne cible (voir 18.5), la passe pesant 42 ms.

### 18.4 Le cas résiduel : verdict (c), trois hypothèses infirmées

Une occurrence sur les 24 exécutions de la démo (8 × 3 directions) reste à
**1,8867 mm** pour 2,0 promis. La paire : un hôte de 420 × 300 et une pièce
de 90 × 160 **nichée dans son trou**, à 1,8867 mm de la paroi.

| Hypothèse | Mesure | Verdict |
|---|---|---|
| Un post-pass le crée | 1,8867 **avant** et après | infirmée |
| La simplification des anneaux (la cause prescrite du cas (a)) | coût mesuré sur cette paire : **0,0000 mm** — 5 sommets restent 5, les 40 du trou restent 40 | **infirmée** |
| Le moteur sous-livre dans une cavité courbe | natif SPP sur la même géométrie : **2,0002** pour 2,0 demandés, **2,1012** pour 2,1 ; natif BPP : **2,0000 à 2,0004** à trois échelles (4+8, 10+20, 20+40) | **infirmée** |

**Conséquence directe : la règle du cas (a) ne s'applique pas.** Demander
`space + 2 × NEST_SIMPLIFY_MM` coûterait de la densité sur tout le corpus
**sans corriger cette cause**, puisque la simplification n'y est pour rien
— et le déficit mesuré (0,113 mm) dépasse de toute façon les 0,1 mm que la
règle offre. Je ne pose donc ni cette règle, ni une marge de mon crû.

**Ce qui reste pour le nommer, et qui est en place** : mon cliché « avant
post-pass » est pris dans `buildAlternativeArtifacts`, donc **déjà après**
la fusion du pool et l'ajout de l'alternative grille. La **sortie brute du
moteur wasm** (`window.__lastSolveResult`) entre maintenant dans le dump :
la prochaine occurrence tranchera entre le moteur wasm et ce qui vient
après lui, sans nouvelle campagne.

**Ce que ça coûte en attendant** : sur un job multi-tôles du navigateur,
une paire de la tôle dense peut sortir ~0,11 mm sous la promesse, sans
recouvrement. La vérification l'affiche avec son chiffre. Fréquence
mesurée : **1 sur 24** (contre 2 sur 12 avant ce lot, mais les deux
défauts étaient alors mélangés).

### 18.5 Le temps : verrou tenu, et une conclusion que j'ai tirée trop vite

J'ai d'abord rapporté une régression de **+6 à +11 s** sur le harnais et
proposé de l'optimiser. Deux mesures la démentent :

| Mesure | Résultat |
|---|---|
| `postPass.holeFillMs` (nouveau) | la passe corrigée coûte **40 à 46 ms** sur 900 pièces |
| A/B **sur la même machine**, image publiée d'avant le correctif contre l'actuelle | **37,8 / 36,5 s** avant · **37,7 / 36,5 s** après |

Les secondes viennent de l'état de la machine (des dizaines de builds
depuis la mesure au repos de la veille), pas du code. **Le verrou « ≤
référence + 1 s » est tenu**, référence mesurée dans le même état. La
bonne séquence était l'attribution d'abord, l'optimisation ensuite — je
l'ai prise dans l'autre sens.

### 18.6 Verrous du §17.4

| Verrou | Résultat |
|---|---|
| **Démo 8 × 3 directions** | **23 exécutions sur 24 à 2 mm** ; **0 rejet total**, **0 pose dupliquée**, **0 annulation de ceinture** (contre 1 rejet total sur 12 avant le lot). La 24ᵉ est le cas du 18.4 |
| **Harnais** espacement 0,1 ×3 | 900/900 · **36,5 / 36,5 / 36,6 s** · `spacingOk: true`, gap 0,1 · doublons 0 · `holeFillMs` 42-46 |
| **Harnais** espacement 2 ×3 | 900/900 · **39,5 / 40,8 / 36,6 s** · `spacingOk: true`, gap 2 · doublons 0 |
| **Corpus** 11 cas | **11/11 OK** ; densités **identiques sur neuf cas sur dix** ; T-F à −1,0 point, le cas qui oscille d'une pièce selon le tirage (88, 89, 88, 89 sur quatre passages, dont deux avant ce lot) |
| **Banc serveur L3** (chemin Python) | **tenu** — `kept=spp` ×3, badges verts, exemption du plancher matière imprimée |
| Parité JS ≡ Python sur le cas réel | **tenue** : même compte de relocalisations que la référence Python (0), 0 paire sous le seuil, 0 doublon, fixture partagée par les deux suites |
| Chemin multi-relocalisations | verrouillé dans les deux langues |
| Distance elle-même | 4 micro-verrous (polygone contenu → 0, arêtes croisées en leur milieu → 0, pièce nichée mesurée contre l'anneau du trou, écart exact) — mesurés par une implémentation **indépendante** dans le test |
| vitest / pytest nesting | **521** / **220** + 2 skipped |

### 18.7 Non-faits et aveux

1. **L'objectif du §17.1 n'est pas atteint** : il exige 0 occurrence sur 24
   exécutions ; il en reste **une**, de cause non établie (18.4). Le défaut
   qui livrait des recouvrements réels et des remboursements, lui, est
   fermé.
2. **Cause du résiduel** : non établie, trois hypothèses infirmées,
   instrumentation posée pour la prochaine occurrence. Aucun seuil ni
   marge décidé de mon côté — c'est votre arbitrage.
3. **Deux erreurs de ma part dans ce lot**, attrapées par les verrous et
   non par moi : le plafond passé à la distance sans être déclaré dans la
   signature (`ReferenceError` sur le chemin des pièces nichées, 4 verrous
   rouges) ; et un premier `git add` qui a ratissé neuf fichiers non
   sollicités traînant en non-suivis (AGENTS §7), repéré avant tout push et
   commit refait avec les onze fichiers du lot.
4. **`L4` du §17.4 exige « temps ≤ référence + 1 s »** : tenu en A/B sur la
   même machine, mais la référence absolue au repos (30,4 s la veille)
   n'est pas reproductible dans l'état actuel du poste — à rejouer au repos
   si vous voulez le chiffre absolu.

## 19. Vérification « espacement tenu » (vérificateur, 11/09, `56c47580`) — GO déploiement du correctif ; le résiduel a une cause candidate précise

### 19.1 Rejeu sur le poste (images app et worker reconstruites à HEAD)

| Verrou | Résultat |
|---|---|
| vitest | 521 |
| L4 harnais 0,1 ×1 au repos | 900/900, **15 s**, `spacingOk` vrai, `duplicatePoses` 0, `holeFillMs` 32, aucune annulation, long task après solve 0 ms |
| L3 `seed_demo_dirs.py BENCH_ASSERT=1` ×1 | tenu ; `kept=spp` ×3, ancrage 2,0, badges verts, exemption plancher matière imprimée |

Le correctif du hole-fill navigateur (distance sommet→segment → exacte,
portée tôle, ceinture) est validé. **GO déploiement** : app + wasm
(chemin navigateur) ET worker (le miroir Python a changé) ; le moteur n'a
pas changé → pas de benchmarks à régénérer, homelab au même digest quand
même (règle worker). C'est un défaut de production actif (un job sur
douze remboursé sur la démo) : déployer sans attendre le résiduel.

### 19.2 Le résiduel 1,8867 mm : verdict (c) refusé, cause candidate à vérifier sur le dump existant

Les trois hypothèses testées ne couvraient pas la quatrième, qui explique
exactement la fenêtre observée : **l'embouchure du canal capillaire**
(piège #2). Pour rendre un trou accessible à jagua, l'hôte est ouvert par
un canal de largeur `space + 0,1` (2,1 mm à space 2,
`holed_polygons.channel_width_for_space`). Sur le polygone que voit le
moteur, la paroi du trou **n'existe plus sur 2,1 mm** à l'embouchure : le
moteur n'impose l'espacement qu'aux deux parois du canal, pas à l'arc de
trou d'origine qui, lui, est bien de la matière à la découpe. Une pièce
nichée placée **en face de l'embouchure** est donc contrainte par les deux
coins du canal seulement : à `d` de la ligne d'embouchure et 1,05 mm des
parois, sa distance aux coins vaut √(d² + 1,05²) ≥ 2 ⇒ **d ≥ 1,70 mm**.
Tout écart entre **1,70 et 2,0 mm** devant une embouchure est légal pour
le moteur et illégal à la découpe. 1,8867 est dans la fenêtre ; c'est
rare (il faut une pièce en face de l'embouchure) ; le natif sur petits
cas ne le montre que par hasard ; la simplification n'y est pour rien.
L'hôte du cas (item 20) a bien un trou ouvert par canal.

**À vérifier d'abord, sur le dump existant, sans campagne (≈ 1 h)** :
reconstruire le polygone d'item 20 tel que le moteur l'a reçu
(`openHoles(coords, holes, space)` côté JS, `open_holes_with_channels`
côté Python), mesurer la distance d'item 2 à **ce** polygone (attendu
≥ 2,0) et à l'anneau **brut** (attendu 1,8867), et vérifier que le point
le plus proche est sur la ligne d'embouchure. Si oui, cause établie.

### 19.3 Correctif, par règle, si la cause est confirmée (une seule fois, dans le moteur)

Dans `nest-engine`, à l'export final de chaque layout (SPP et BPP, donc
finition comprise), **garde d'embouchure** : pour chaque hôte à canal,
mesurer avec `geometry_check::material_distance` la distance de chaque
pièce nichée à l'anneau de trou **brut** (les anneaux d'origine sont dans
l'instance externe avant ouverture : les transmettre au moteur dans un
champ additif `raw_holes` de l'`ExtItem`, ou recalculer la fermeture du
canal à partir de la largeur connue). Si `d < space − 0,01` : translater
la pièce nichée **dans la direction opposée à la ligne d'embouchure** de
`space − d + 0,02`, accepter si la CDE (formes gonflées) reste sans
collision et si la distance exacte à tous les voisins reste
≥ `space − 0,01` ; sinon **retirer la pièce du trou** et la marquer
`unplaced` de la finition/relocalisation ordinaire (le post-pass
hole-fill exact la replacera ou la posera ailleurs). Trace
`mouth_guard: {moved, removed}` dans l'événement `done`. Verrous cargo :
fixture hôte + trou circulaire + fillers rectangulaires à space 2,
20 seeds, `min_pair_distance` ≥ 1,99 contre l'anneau brut ; déterminisme
natif ≡ wasm ; parité Python/JS inchangée (le post-pass ne bouge pas).
Verrou produit : démo 8 × 3 directions, 0 occurrence sous 1,99 sur 24.

## 20. Déploiement du correctif du hole-fill (implémenteur, 11/09)

**Déployé** : `e680537f` (app, worker, homelab). Le moteur n'a pas changé —
`git diff e51e294c..HEAD -- workers/nesting/engine public/engine` est vide,
donc **aucun benchmark public à régénérer** (AGENTS §6, vérifié et non
supposé).

| Contrôle (lecture seule) | Mesure |
|---|---|
| Corpus sur l'image **publiée** `e680537f` | **11/11 OK** (T-F partiel attendu, T-J refus attendu) |
| `core/holefill.py` dans l'image publiée, avant de semer | `6a5e93f3…` = HEAD — le miroir corrigé est bien celui qui a tourné |
| `core/holefill.py` du worker **prod** | `6a5e93f3…` = HEAD |
| digest worker **prod** | `sha256:68552630…` |
| digest worker **homelab** | `sha256:68552630…` — **le même** ; `ASSERT OVERFLOW=HEAD: OK` |
| wasm moteur (conteneur app / dépôt / servi) | `cb87f45a…` partout — inchangé, le moteur n'était pas concerné |
| `compute_pool` | total **28** |
| Pages | `/`, `/plans`, `/benchmarks` → 200 |
| `app-ci` | **vert** sur `main` (le verrou du cas réel ne dépend plus de la vitesse du runner) |

Ce qui est donc corrigé en production : le hole-fill du navigateur ne peut
plus livrer de recouvrement ni de pose dupliquée, et un job ne peut plus
être remboursé pour cette cause (mesuré : 24 exécutions de la démo sans un
seul rejet, contre une fois sur douze avant).

**Reste ouvert** : l'écart d'embouchure du §19.2, confirmé par la mesure et
non corrigé — il demande une garde dans le moteur (§19.3), donc un
déploiement moteur avec régénération des benchmarks.

## 21. Rapport « garde d'embouchure » (implémenteur, 11/09)

Commit : `af961aef`. **Non déployé** — le moteur a changé, le déploiement
demande la procédure longue (benchmarks publics régénérés, wasm, worker +
app dans la même fenêtre, homelab) et votre GO.

### 21.1 La cause, vérifiée avant d'écrire une ligne de correctif (§19.2)

Votre hypothèse tient au chiffre près, mesurée sur le dump existant :

| Mesure de la paire fautive | Résultat |
|---|---|
| Écart sur l'**anneau brut** (ce que la découpe voit) | **1,8867 mm** |
| Écart sur le **polygone reçu par le moteur** (trou ouvert par un canal de 2,1 mm) | **2,0013 mm** |
| Distance du point le plus proche à la **ligne d'embouchure** | **0,0000 mm** |
| Matière retirée par l'ouverture du canal | 88,41 mm² |

Le moteur a donc tenu sa promesse sur la géométrie qu'on lui a donnée. Mes
trois essais précédents sont passés à côté parce qu'ils plaçaient **une
pièce seule** dans une cavité : il faut tomber EN FACE de l'embouchure. Le
protocole, pas la conclusion, était en défaut — j'aurais dû construire mes
cas à partir de la géométrie telle que le moteur la reçoit, canal compris.

### 21.2 Ce qui est livré

**`EngineConfig.raw_holes`** (champ additif) porte les anneaux de trou
BRUTS, indexés par l'id de l'instance **résolue**. Les deux constructeurs
de charge le remplissent **au même endroit qu'ils ouvrent les canaux**
(`main.py` et `localPayloadBuilder.js`), et **excluent les hôtes
pré-remplis** : la réduction J-085 les résout trous FERMÉS (piège #3b), leur
attacher une paroi serait faux. jagua n'est pas touché.

**`mouth_guard`** s'applique **avant chaque fusion** — un seul point pour le
natif, le navigateur et la finition (qui réécrit les poses avant la fusion).
Pour chaque pièce nichée : mesure exacte contre l'anneau brut ; sous
`space − 0,01`, translation à l'opposé du point de contact de
`space − d + 0,02`, acceptée seulement si la pièce **reste dans le trou** et
si sa distance exacte à **tous ses voisins** tient ; sinon **retrait** du
trou (la pièce repasse en non-placée, le post-pass hole-fill — exact depuis
le 11/09 — la replacera). Trace `mouth_guard: {moved, removed}` dans `done`.

**Un écart à la règle, et sa raison.** Le §19.3 demandait aussi que la CDE
gonflée valide la translation. Je ne l'ai pas fait : la tranche 2 a établi
que la carte de collision n'est pas un oracle (elle rejette des agencements
mesurés légaux, §11.2), la mesure exacte à tous les voisins est strictement
plus forte pour ce qu'on veut garantir, et la rebrancher obligerait à
réimporter l'instance dans le chemin de fusion — exactement le coût que la
tranche 2 avait retiré du navigateur. Si vous préférez la ceinture ET les
bretelles, c'est une ligne à ajouter, dites-le.

### 21.3 Vérifications

| Verrou | Résultat |
|---|---|
| **Démo navigateur 8 × 3 directions** | **24/24 à 2,000 mm**, **0 occurrence sous 1,99**, 0 rejet total, 0 doublon |
| **La garde est ARMÉE, pas inerte** | config capturée sur le chemin de production du job démo : `raw_holes` sur **11 items**, dont les deux du défaut (20 et 2). Une garde jamais déclenchée donnerait les mêmes chiffres qu'une garde absente — c'est vérifié, pas supposé |
| **Cas réel du 11/09** (cargo) | pose à **1,887 mm** ramenée **≥ 1,99** |
| **20 poses de la fenêtre** [1,70 ; 1,99) | **20/20 dégagées**, pire écart après garde **2,0200 mm** |
| **Pose conforme** | **intacte** — aucune retouche micrométrique (piège 14f) |
| **Sans `raw_holes`** | garde inerte, layout inchangé (anciens payloads) |
| **L2 déterminisme** | natif ≡ wasm, tolérance 0, SHA **`a1bd8810…` INCHANGÉ** — la garde ne touche rien là où il n'y a pas de canal |
| **Corpus** 11 cas | **11/11 OK** ; **neuf densités sur dix identiques** ; T-F à 90,0 contre 89,0 (ce cas oscille : 88, 89, 88, 89, 90 sur cinq passages) |
| **Banc serveur L3** | **tenu**, `kept=spp` ×3, badges verts |
| **Harnais** 0,1 et 2 | 900/900 · **37,9 s** et **36,7 s** — la référence de la machine dans son état actuel est 36,5-37,8 s (A/B du §18.5) |
| cargo / vitest / pytest | **97** (93 + 4 nouveaux) / **521** / **223** + 2 skipped |

### 21.4 Non-faits et écarts

1. **La fixture « 20 graines du solveur » du §19.4 n'existe pas.** J'en ai
   construit quatre variantes (trou circulaire large, rectangulaire serré,
   SPP puis BPP, tôle large puis juste) : dans les quatre, le moteur **ne
   niche aucune pièce**, 0 sur 20 graines. Le constructif ne tente le trou
   que sous une pression qu'une instance de quelques pièces ne crée pas, et
   sous `w + 2 × space` de jeu aucune pose n'existe (piège #49). Le témoin
   négatif que j'avais ajouté l'a prouvé sur la première version : **sans
   garde, pire écart 2,1743 mm** — le verrou était vert et ne mesurait rien.
   Remplacé par deux verrous déterministes (cas réel + toute la fenêtre
   illégale), le solveur restant dans la boucle là où le défaut est apparu :
   la démo 8 × 3.
2. **La validation CDE de la translation** : non faite, raison au §21.2.
3. **Aucun déclenchement observé en production pendant la campagne** : les
   24 exécutions sont vertes, mais l'événement est rare (1 sur 24 avant la
   garde). La garde est prouvée armée et prouvée correcte sur la géométrie
   réelle ; ce que la campagne montre, c'est l'absence de régression.
4. **Déploiement** : procédure longue (moteur changé), en attente du GO.
