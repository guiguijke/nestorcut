# Vérification de la phase A du lot 4 (dette) + suite — 2026-09-07, 8 h

Vérification indépendante du rapport
[`RAPPORT-PERF-UX-L4-PHASE-A-2026-09-07.md`](archive/2026-09-perf-ux/RAPPORT-PERF-UX-L4-PHASE-A-2026-09-07.md)
(commits `381d2b8` → `d313e38`), contre la fiche
[`FICHE-LOT4-T2-2026-09-06.md`](FICHE-LOT4-T2-2026-09-06.md) §3, §5, §6, §7.
Méthode : `assert_images_head.sh` OK (2026-09-07T06:10:53Z, HEAD
`d313e38`) ; **machine à vide** pour les bancs serveur (rien d'autre en
parallèle), puis vitest, pytest (commande exacte du rapport), harnais 4 mm
dans ses deux configurations, e2e orphelin de l'implémenteur, corpus
11 cas, relecture des diffs déjà faite aux points d'étape (§5, §7, AH6).
Identifiants **AI** = constats de ce tour. Artefacts :
`docs/qa/perf-audit-2026-09-05/l4-verif/verif-fable/`.

## 0. Verdict

**GO déploiement de la phase A** (Hetzner puis homelab, `assert_overflow_head.py`
OK à la fin), avec un verrou non tenu et tracé : **job serveur T-A ≤ 15 s**.
Mes sept runs séquentiels à vide donnent 15,3 à 17,6 s, comme les six de
l'implémenteur (14,7 à 18,1). Le dépassement n'est **pas imputable à la
phase A** : le post-pass est passé de 5,1-9,4 s à 1,2-1,4 s (mesure
ventilée), le reste est le moteur (~13 s, budget gelé par décision
propriétaire) et la prise du job par le worker (0,9 à 2,8 s, boucle
`idle_sleep = 5 s`). Le verrou est **reporté au début de la phase B** avec
deux leviers sans effet sur la qualité (§3). Tout le reste est vert et
reproduit.

## 1. Mesures (images = HEAD `d313e38`, machine à vide)

| Verrou (fiche §3, §6) | Implémenteur | Vérificateur | Verdict |
|---|---|---|---|
| Post-pass T-A ≤ 3 s CPU | 2,07 s (0,1) / 2,36 s (2), post-pass + finalisation | `postPassTimingsMs` : holeFill 0,11-0,17 s + résiduel 1,00-1,33 s = **1,2-1,5 s** aux deux espacements ; traitement complet (startAt → finishedAt) 14,3-15,6 s | ✓ |
| Grille bit-identique | [587, 313] ×6 / [573, 327] | **[587, 313] ×7** (0,1), **[573, 327] ×2** (2), chute 580,4 / 544,1 identiques | ✓ |
| Ventilation par passe | perPass + postPassTimingsMs | présents sur chaque job (perPass : merge/compact moved + frontX + rolledBack) | ✓ (AI2) |
| okRelayed / STRtree 1×/tôle | corrigés | diff relu au §5 ; aucune cascade déclenchée sur ces runs (champ absent = attendu) | ✓ |
| Gardes à perte injectée (JS + Python) | 3 + 3 tests | `test_guard_ah1.py` : passes réelles, perte de l'hôte après les passes, détectée par la capture et muette pour le recalcul (relu) ; vitest 37/37 localBridge | ✓ |
| Harnais 4 mm, deux configurations | 894/900 ×2, 3 leviers | **894/900** (2×1000×1000) et **894/900** (1×1000×2000), « Gap ≥ 4 mm » ✓, panneau partiel « 6 parts not placed … About 3 sheets needed at this spacing » | ✓ |
| Orphelin awaiting_local (e2e) | VERT | `qa-l4-orphan.mjs` rejoué : lecture projet 200 dans les deux contextes, job vieilli de 11 min, **expiré à t+1 s** à l'ouverture du flux (cancelled / awaiting_local_expired / refunded), carte visible, POST suivant 200 | ✓ |
| Job T-A création → fin ≤ 15 s, 6 runs | 14,7 · 18,1 · 18,1 · 18,1 · 18,1 · 17,0 | **15,3 · 17,3 · 17,1 · 16,8 · 16,2 · 17,6 · 17,6** (prise 0,9-2,8 s ; traitement 14,3-15,6 s) ; à 2 : 18,0 · 18,0 | **✗ — reporté phase B (§3)** |
| Corpus 11/11 | 11/11 | **11/11 OK** (T-A 900/900 [587, 313], T-F partiel attendu, T-J refus attendu, physique propre, FUSION 2/11) | ✓ |
| vitest / pytest | 485/485 ; 227 + 2 + 3 err | **485/485** (43 fichiers) ; **227 passed, 2 skipped, 3 errors, 232 collectés** avec la commande exacte du rapport — l'écart avec mon 233 + 1 du 06/09 vient bien du périmètre de collecte, le compte de référence est désormais celui de la commande §D | ✓ |
| Images = HEAD | OK | OK 06:10:53Z (après stash de mon édition de fiche) | ✓ |
| Benchmarks régénérés | densités identiques à fb5e184 | `data/benchmarks.js` version `2e48ad2`, valeurs inchangées — voir AI1 | ✓ (AI1) |

Compaction serveur à 0,1 (7 runs) : 520,7 ×3 (fusion acceptée) et 602,6 /
608,8 / 614,0 (compaction annulée « front ») — bimodalité connue (C8/Y6),
inchangée. À 2 : 479,2 (fusion) et 518,8 (fusion gardée, compaction
annulée). Zéro alternative écartée sur 9 runs.

## 2. Constats

### 2.1 Conformes

- P8 : cache vidé par job (54b16a6), ventilation exploitable, post-pass
  divisé par quatre ; les layouts sont inchangés (grille bit-identique,
  benchmarks identiques).
- A2/AH1 : la référence des deux gardes est prise au même moment dans les
  deux langues (après expansion, avant les passes de déplacement).
- A3/AH2/AH3/AH5 : utilitaire unique, transition atomique, remboursement
  idempotent, TTL configurable ; AH6 confirmé par l'e2e corrigé.
- Non-faits énoncés (AH4, écriture depuis un GET, pas de miroir JS de
  perPass, 3 erreurs pytest préexistantes) : acceptés tels quels.

### 2.2 À corriger

| Id | Sév. | Constat | Instruction fermée |
|---|---|---|---|
| **AI0** | **M (verrou)** | Job T-A serveur 15,3-17,6 s (cible ≤ 15 s). Décomposition mesurée : prise 0,9-2,8 s (deux workers locaux, `idle_sleep` 5 s — en prod six workers, prise moyenne ≈ 0,7 s), moteur ≈ 13 s, post-pass 1,2-1,5 s, écritures < 0,5 s. | Voir §3 : deux leviers sans effet sur la qualité au début de la phase B, puis re-mesure ; arbitrage propriétaire seulement si le verrou est encore manqué. |
| AI1 | m | `data/benchmarks.js` porte `version: '2e48ad2'` et la date du 07/09 alors que la page affirme « produites par l'image déployée en production » — vrai seulement après le déploiement, et le hash déployé sera celui du commit de déploiement, pas `2e48ad2`. | Au déploiement de la phase A, poser `version` = hash effectivement déployé (valeurs inchangées, note conservée) ; règle à ajouter à `AGENTS.md` §6 : la version est écrite **au moment du déploiement**. |
| AI2 | m | `eval_corpus.py` affiche `perPass` de l'alternative évaluée (la grille pour T-A : `perPass null`) : la mesure qui doit trancher le lot 5 n'apparaît pas sur le cas principal. | Afficher `perPass` de **chaque** alternative (grille et compaction) sur une ligne par alternative, sans changer le verdict OK/PARTIEL/REFUS. |
| AI3 | m | `workers/nesting/bench/assert_overflow_head.py` est toujours **non suivi** (le ménage n'a pris que `docs/`), alors que `AGENTS.md` §6 et la fiche s'y réfèrent. | `git add` + commit avec le déploiement de la phase A. |
| AI5 | m (post-déploiement, 07/09 9 h 40) | La page /benchmarks **en production** affiche « images Docker du commit `2e48ad2` » alors que le hash déployé est `6b39a9d` : la version a été posée dans `face204`, commit de record **postérieur** au build de l'image déployée (`Cache-Control: no-cache`, donc pas un cache). Les bits runtime sont identiques (commits intermédiaires = docs + bench), la page ne ment pas sur les chiffres, mais le hash affiché n'est pas celui déployé et le dépôt dit autre chose que la prod. Un commit ne peut pas connaître son propre hash : la règle AI1 est inapplicable telle quelle. | Injecter le hash au **build** : `ARG GIT_SHA` dans le Dockerfile de l'app, passé par le script de déploiement (`--build-arg GIT_SHA=$(git rev-parse --short HEAD)`), exposé en `runtimeConfig.public.buildCommit` et affiché par `benchmarks.vue` à la place de `meta.version` (qui reste le hash du **run** des chiffres, libellé « chiffres du run … / image déployée … »). 0,25 j, à livrer avec le prochain déploiement app ; d'ici là la page reste telle quelle (aucun redéploiement pour un hash). Corriger la phrase du §H du rapport (« posé au moment du déploiement » : posé après). |
| AI4 | m (hors lot) | Le harnais journalise `POST /api/track → 400` à chaque run (déjà présent dans les journaux du lot 2) : un évènement de suivi est rejeté par le serveur. | À inscrire au lot 5 UX (pas dans la phase A) : identifier l'évènement et corriger l'émetteur ou le validateur. |

## 3. Suite : le verrou 15 s au début de la phase B

Ordre imposé (masterplan §8), avant P4 :

1. **Prise du job ≤ 1 s** : `WorkerConfig.idle_sleep` du worker nesting
   lu depuis l'env `NEST_IDLE_SLEEP` (défaut **1.0** pour le nesting ; les
   autres workers inchangés) ; documenter la clé dans le compose Hetzner
   **et** dans `/containers/nestorcut-overflow/docker-compose.yml`. Coût :
   une requête Mongo par seconde et par worker à vide, négligeable.
2. **P9 avancé de lot 6 en phase B** (plan perf/UX : cache « tôle saturée
   par classe » dans `constructive.rs:287-321`, −15-20 % par itération,
   0,5 j) : **bit-identique exigé** (`determinism_lock.py`, corpus
   11/11, grille [587, 313] / [573, 327]), wasm rebuildé et commité dans
   la même PR, benchmarks régénérés.
3. **Re-mesure** : six runs T-A séquentiels à vide, `secs`, `startAt −
   createdAt`, `finishedAt − startAt`, grille. Verrou inchangé : création
   → fin ≤ 15 s. S'il est encore manqué après 1 + 2, le rapport donne la
   décomposition et le propriétaire arbitre entre accepter la valeur
   mesurée et rouvrir le budget moteur du tier standard (SAMPLE_CFG / P3),
   jamais l'implémenteur seul.

Le reste de la phase B ne change pas (P4, P5, P6 mesurés dans le
navigateur, colonne navigateur sur /benchmarks — fiche §6).

## 3bis. P9 — précision du verrou après le point d'étape `6c9283f` (07/09, 11 h)

Le sondage à 1 s est livré (re-mesure implémenteur : 14,9 à 15,7 s, prise
≈ 0,5 s) ; reste P9. L'implémenteur a raison sur le fond : `search_placement`
consomme le générateur de façon **dépendante des données** (échantillons
uniformes, puis `refine_coord_desc` dont le nombre de tirages dépend des
évaluations — `coord_descent.rs:37,55,145`). Sauter une recherche déjà
échouée ne peut donc **pas** reproduire le flux du générateur : un P9 qui
laisserait tous les résultats BPP inchangés au bit près n'existe pas. Le
verrou « bit-identique » du §3 est donc précisé, il ne visait pas cela :

- **Exigé** : déterminisme run à run ; **natif ≡ wasm** (`determinism_lock.py`,
  qui compare natif et wasm entre eux, pas à un SHA historique — la fixture
  est régénérée dans la même PR) ; **grille [587, 313] / [573, 327]
  inchangée** (elle ne passe pas par `bpp/constructive.rs` : les zones sont
  des sous-solves SPP, `structure.py:310`) ; wasm rebuildé et commité.
- **Accepté** : les résultats BPP (compaction, tôles des walks) peuvent
  changer. Ils passent alors la **porte qualité du L2-bis** : 6 runs T-A à
  0,1 et 4 à 2 sur images = HEAD, médiane de la chute de la dernière tôle
  à ± 5 mm de la référence de ce tour (0,1 : bimodal 520,7 / 602-614 ;
  2 : 479,2 / 518,8), fusion T-A@2 ≥ 4/8, corpus 11/11, harnais 4 mm
  892 ± 6 / 900 dans les deux configurations, zéro alternative écartée.

Conception fermée :

1. Mémo **par appel de `construct()`** (une itération SA = une séquence),
   jamais partagé entre itérations ni entre walks : `saturated: HashSet<(layout_key, item_class)>`.
2. Une recherche `search_layout` qui échoue pour la classe C sur la tôle L
   insère (L, C). Justification : une tôle ne fait que se remplir pendant
   `construct()` (aucune pièce n'en est retirée), donc l'échec n'est
   jamais infirmé par l'état — seulement par la chance d'un autre tirage,
   que l'on renonce à exploiter.
3. Dans la boucle first-fit (`constructive.rs:~300`), une tôle (L, C) mémo
   est **sautée sans appel au générateur** ; l'ouverture d'une nouvelle
   tôle (C5) ne consulte pas le mémo.
4. Si la porte qualité échoue (médiane hors ± 5 mm ou fusion < 4/8), une
   seule variante autorisée : ré-essayer la tôle mémo tous les N items de
   la même classe (N = 8), puis re-mesure. Pas de troisième variante sans
   retour au vérificateur.
5. Rapport : temps moteur par walk avant/après (le seul chiffre attendu de
   P9 : −15 à −20 % par itération), six runs T-A à vide création → fin
   avec la décomposition (prise, traitement, post-pass), la porte qualité
   ci-dessus, la sortie du `determinism_lock`.

### Point d'étape P9 implémenté (07/09, 12 h) — relecture du diff et suite cargo

Le diff non commité de `bpp/constructive.rs` applique les quatre points de
la conception (mémo `HashSet<(LayKey, item_id)>` local à `construct()`,
insertion sur échec de `search_layout`, `continue` sans appel au
générateur, `best_bin` hors mémo). Les « trois échecs cargo dont deux
préexistants » annoncés **ne se reproduisent pas** : chez moi, avec P9
dans l'arbre, `cargo test --release -p nest-engine` = **72 passed, 0 failed,
1 ignored** (suite complète, à vide), et les cinq tests `live_frame` passent
aussi isolément, à HEAD sans P9 comme avec P9. `progress.rs` et `spp.rs`
n'ont pas changé depuis la création de ces tests. Ils étaient donc rouges
chez l'implémenteur pour une raison locale (charge des scale-tests en
parallèle, ou build périmé), pas « préexistante ». Instruction : le rapport
P9 donne la suite cargo **complète et verte à vide** avec ses chiffres ; si
elle est rouge sur son poste, relancer à vide (`--test-threads=4` au besoin)
avant d'écrire quoi que ce soit — aucun test n'est étiqueté « préexistant »
sans reproduction à HEAD sur un arbre propre.

### Point d'étape P9, porte qualité partielle (07/09, 14 h) — deux précisions avant le rapport

1. **Les chutes citées sont celles de la grille, pas de la compaction.**
   580,4 mm à 0,1 et 544,1 mm à 2 sont les chutes de l'alternative
   *grille*, qui ne passe pas par `bpp/constructive.rs` et ne peut donc
   pas bouger avec P9. La porte qualité porte sur l'alternative
   **compaction** (`strategy: left`) : chute de la dernière tôle par run,
   médiane, et comparaison à la référence de ce tour — à 0,1 : 520,7 ×4 et
   602,6 / 608,8 / 614,0 (médiane 520,7, bimodalité connue) ; à 2 : 479,2
   (fusion) et 518,8 (fusion gardée, compaction annulée), série L2-quater
   479,2 ×majoritaire. Le rapport donne ces valeurs run par run, avec
   `compactRollbackReason` et `mergedReceivers`, comme les extractions
   `verify_l4a_bench.sh` (`docs/qa/perf-audit-2026-09-05/l4-verif/verif-fable/`).
   Les comptes de fusion à 2 (555/345, 577/323…) sont déjà les bons objets.
2. **Lecture du verrou 15 s.** La fiche dit « ≤ 15 s sur 6 runs
   séquentiels » sans préciser la statistique. Décision du vérificateur,
   révisable par le propriétaire : **médiane ≤ 15 s et aucun run > 16 s**.
   Avec 14,2 à 15,5 s (moyenne 14,77), le verrou est **tenu** sous cette
   lecture ; il ne l'aurait pas été sous « chaque run ». Le rapport écrit
   les six valeurs et cette lecture, pas seulement la moyenne.

À consigner aussi : le texte exact du `debug_assert!` de jagua-rs
(`qt_hazard`) qui a fait rouge en mode debug, avec le test déclencheur —
un invariant violé en debug est une information, même si la release
l'ignore (piège à ajouter à `AGENTS.md` : suites moteur en `--release`, et
tout `debug_assert` déclenché se documente).
### Point d'étape P9, 2 écartées sur 18 (07/09, 16 h) — diagnostic AVANT la variante v2

Le passage à la v2 est **suspendu** : « le mémo a fait perdre une pose
légitime » n'explique pas un chevauchement. Sauter une recherche ne peut
que déplacer une pièce vers une autre tôle ; ça ne produit pas deux
pièces à distance 0. Un écartage pour chevauchement signifie qu'une pose
invalide a été **fabriquée** quelque part, et la v2 ne ferait que
rebattre les cartes. L'instrumentation existe (AC1/AC2) : le rapport
lit, pour chacun des deux jobs, `discardedAlternatives[]` —
`originStage` (engine / expand / post_pass), les paires `{sheet, idxA,
idxB, itemA, itemB, areaMm2}`, `preLayouts` contre `layouts`, le
`postPass` de l'alternative, les SVG `_discarded` — et rejoue hors ligne
(`replay_residual.py`, comme au L2-ter).

Décision selon l'étage :

- **post_pass** : trou dans la ceinture ou la cascade (L2-quater v2),
  révélé par des layouts différents — correction dans le post-pass
  (Python **et** miroir JS, test à cas reproduit), P9 reste en v1, porte
  rejouée ensuite.
- **engine** : P9 a changé la sortie du constructif en poses
  chevauchantes — c'est un bug du mémo ou une hypothèse fausse (clé
  `LayKey` recyclée, `growth0`/`first_fit` posés sur une tôle sautée…) ; le
  rapport apporte la séquence et la seed fautives, correctif, puis porte.
- **expand** : indépendant de P9, à traiter comme au L2-ter.

La v2 (réessai tous les huit items) ne se justifie que par une **baisse de
qualité** mesurée à la porte (médiane hors ± 5 mm, fusion < 4/8), pas par un
écartage. Ici la porte qualité est tenue (0,1 : médiane 520,7 ; 2 : 483,4 à
4,2 mm du pôle, fusion 11/12) : sans ce diagnostic, P9 v1 est le bon
candidat. Référence : pré-P9, 0 écartée sur 8 (L2-quater v2) et 0 sur 9
(ce matin) — les deux écartages sont donc bien corrélés aux layouts P9, ce
qui rend le diagnostic d'étage indispensable.
### Diagnostic des 2 écartées : `originStage = post_pass` (07/09, 18 h) — ce que le correctif doit expliquer

Le diagnostic confirme que P9 n'a rien fabriqué ; v2 retirée, P9 v1
reste le candidat. Mais l'hypothèse « rollback front qui restaure des
rendues pendant que les relayées restent » ne suffit pas, pour une raison
structurelle relue dans `residual.py` : l'ordre de `fill_residual_bands`
est snapshot → fusion (`_merge_fill_compact_receivers`) → compaction
(`_compact_last_sheet`) → **ceinture exacte** (`_exact_overlap_area` sur
les pièces touchées **contre toutes** les pièces de la même tôle, anneaux
bruts, différentiel `dirt_after > dirt_before + 0,05`). Une relayée
(pose nouvelle → touchée) qui chevauche une restaurée (pose d'origine →
non touchée) est exactement le cas que la ceinture doit voir, et elle
aurait rendu une alternative **ceinturée** (pass restauré), pas écartée.
Deux jobs écartés = **la ceinture n'a pas tiré**. C'est le fait le plus
important de ce diagnostic, et le correctif doit le traiter avant le
reste.

Instruction fermée, dans cet ordre :

1. **Rejeu déterministe** d'un des deux jobs par `repro_pipeline.py` sur
   son payload (même seed, même config : le moteur est déterministe, le
   `preLayouts` vide n'empêche pas de rejouer). Le rejeu doit reproduire
   l'écartage ; sinon le rapport le dit et s'arrête là.
2. **Persister la ceinture** : `stats["belt"] = {touchedFinal, touchedEntry,
   dirtBeforeMm2, dirtAfterMm2, rolledBack}` — valeurs géométriques
   déterministes (seule la durée reste en log, AD5). Miroir JS identique.
3. **Rejeu pas à pas** sur le snapshot : fusion seule → `verify_layout` ;
   fusion + compaction → `verify_layout` ; puis ceinture. Le rapport donne
   l'étape qui crée les paires (`sheet, idxA, idxB, aire`) **et** la
   raison pour laquelle la ceinture les a laissées passer (pièces
   absentes de `touchedFinal` ? `dirt_before` déjà élevé ? exception
   avalée par le `except Exception` du pass, qui restaure pourtant ?
   pièce rendue avec une pose « identique » à 1e-6 près mais anneau
   différent ?). Pas de correctif avant cette réponse.
4. **Correctif à deux niveaux** : (a) l'étape fautive valide ses
   restaurations contre l'état courant de la tôle (`_validate_return`
   avec `changed_ids` = relayées, comme la cascade AE3 le fait) ; (b) la
   ceinture est corrigée pour couvrir le cas manqué — une alternative ne
   doit plus jamais atteindre `verify_layout` avec un chevauchement créé
   par le pass. Python + miroir JS, test unitaire sur le cas rejoué
   (layouts du rejeu figés en fixture), les deux niveaux testés
   séparément (désactiver (a) doit faire tirer (b)).
5. `preLayouts` vide sur BPP avec meta : corriger la prise du snapshot
   `_pre_layouts` (AC1) pour ce chemin, test.
6. Porte complète (18 jobs, 0 écartée **et** 0 ceinturée attendues —
   une ceinturée serait à expliquer), corpus, harnais, puis rapport P9.
### Rapport P9 (`1705cd8`) — les « 2 écartées sur 18 » n'existent pas (07/09, 15 h 40)

Vérification en base avant tout banc : les trois seuls jobs porteurs de
`discardedAlternatives` datent du **06/09 entre 01 h 45 et 02 h 58 UTC**
(`bench-bpp2s-20-1788659118` — le job que j'ai analysé au L2-ter pour AC1
—, `bench-corpus-a-1788662464-0`, `bench-corpus-a-1788663539-0`), soit
la fenêtre de mise au point de la ceinture L2-ter, **35 heures avant le
commit P9** (`3c92385`, 07/09 12 h 07 UTC). Les 17 jobs à 2 mm semés le
07/09 pour la porte P9 n'ont **aucune** écartée. Le « 2/18 » est un
artefact de requête (pas de filtre `createdAt ≥ SINCE`, comme le font
`verify_l2*.sh` et `verify_l4a_*.sh`) ; le « diagnostic » et le rejeu
non reproductible portaient sur des fantômes d'une image antérieure au
correctif L2-ter, ce qui explique aussi que le clone soit propre.

Conséquences : la porte P9 est intégralement verte sur le critère
« zéro écartée » ; les points 1-3 du §4 du rapport (seed et durée sur
les discards, `preLayouts` vide en BPP + méta, mesures de la ceinture en
stats) restent **utiles** comme instrumentation et passent au lot
suivant (une demi-journée, hors chemin critique), sans reprise de
diagnostic. Règle pour le rapport : toute statistique de porte se calcule
sur une fenêtre `SINCE` explicite, et le rapport donne la requête.
## 3ter. Vérification du rapport P9 (`1705cd8`) — 07/09, 16 h

Méthode : image worker reconstruite depuis l'arbre P9 (couche moteur du
07/09 13 h 56, `assert_images_head` OK), **machine à vide** pour les
bancs ; lock natif ≡ wasm rejoué ; cargo ; corpus ; harnais navigateur sur
le wasm P9 ; **chronométrage direct des deux binaires** (pré-P9 `6c9283f`
construit dans un arbre séparé, P9 = HEAD) sur la fixture BPP
déterministe du lock, cinq runs alternés. Artefacts :
`l4-verif/verif-fable/{bench_p9_*.log, corpus_p9.log, time_p9_fixture.py, e2e-p9-*}`.

### Mesures

| Verrou | Implémenteur | Vérificateur | Verdict |
|---|---|---|---|
| Lock natif ≡ wasm | SHA `0bf374f2…` | **même SHA**, 35 itérations, bit-identique | ✓ |
| cargo release à vide | 72 / 0 / 1 | **72 / 0 / 1** | ✓ |
| Zéro écartée | « 2/18 » | **0/17 aujourd'hui** ; les 2 « écartées » datent du 06/09 02 h 41-02 h 58 UTC, 35 h avant P9 (voir ci-dessus) | ✓ (rapport à corriger) |
| Porte qualité 0,1 (chute compaction, 6 runs) | médiane 520,7 | 520,7 ×5 + 581,6 (front) → **médiane 520,7**, fusion 5/6 | ✓ |
| Porte qualité 2 (6 runs) | médiane 483,4 | 487,3 / 479,2 / 355,5 / 485,5 / 485,3 / 489,9 → **médiane 485,4** (+6 mm du pôle 479,2 ; +2 de la série implémenteur), fusion 4/6 | ✓ (bruit bimodal) |
| Grille | [587, 313] / [573, 327] | **identiques ×12** ; navigateur 0,1 : 900/900, [587, 313] | ✓ |
| Corpus | 11/11 | **11/11** — mais T-F **88/90** (89/90 avant P9), répartitions BPP changées (T-B [40, 40], T-D [27, 303], T-H [92, 86, 22]) | ✓ avec réserve |
| Harnais 4 mm | 893/900 ×2 | **891/900** (config 1), gap ≥ 4 mm ✓, leviers ✓ — dans la bande 892 ± 6, mais 894 avant P9 | ✓ avec réserve |
| Job T-A création → fin, 6 runs à 0,1 | 14,2 / 14,3 / 14,4 / 14,7 / 15,5 / 15,5 | **15,0 / 14,5 / 15,6 / 14,9 / 14,5 / 15,7** → médiane **14,95**, max 15,7 ; prise 0,1-0,8 s (poll 1 s), traitement 14,2-15,3 s | ✓ de 0,05 s |
| **Gain moteur de P9** (le seul chiffre attendu, §3bis point 5) | **absent du rapport** | fixture BPP : pré-P9 4 283 ms / P9 4 255 ms (**−0,7 %**), résultats strictement identiques (le mémo n'y change rien) ; T-A : traitement 14,3-15,6 s avant → 14,2-15,3 s après (**dans le bruit**) | **✗** |

### Lecture

1. **P9 ne produit pas le gain pour lequel il a été conçu.** Les walks
   T-A s'arrêtent tous entre 30 et 34 itérations (26 walks relevés
   aujourd'hui) : c'est le **plancher P3 (30)** qui fixe le temps moteur,
   et le coût d'une itération n'a pas bougé de façon mesurable. Le gain
   « −15 à −20 % par itération » du plan perf n'est pas au rendez-vous sur
   ce moteur : les recherches sautées sont rares ou bon marché.
2. **P9 change pourtant les résultats BPP** (nouvelle base : répartitions
   du corpus, T-F −1 pièce, harnais 891 contre 894) — une érosion faible,
   dans les tolérances, mais réelle, pour aucun bénéfice.
3. Le verrou 15 s est **sur la ligne de bruit** avec ou sans P9 : médiane
   14,95 chez moi avec P9, 15,3 chez l'implémenteur sans P9 (poll seul),
   14,55 chez lui avec P9 — trois séries qui se recouvrent.
4. Le rapport s'est arrêté sur des fantômes (§ ci-dessus) : la règle
   `SINCE` est ajoutée au masterplan §8 par ce document.

### Verdict et instruction

**NO-GO P9 — à retirer**, pas à corriger : revert de `3c92385` (source
+ `public/engine/nest_wasm_bg.wasm`), lock rejoué, note dans le rapport.
**GO pour le reste de `6c9283f`** (poll à 1 s dans les deux compose,
hash déployé sur /benchmarks) : déploiement Hetzner + homelab, contrôle
overflow. Le verrou « job T-A ≤ 15 s » est **rendu au propriétaire**
avec la décomposition mesurée à vide :

| Poste | Aujourd'hui | Levier | Effet estimé |
|---|---|---|---|
| Prise par le worker | 0,1-0,8 s | fait (poll 1 s) | — |
| Post-pass Python | 1,2-1,5 s | fait (P8) | — |
| Écritures, finalisation | < 0,5 s | — | — |
| **Moteur** | **≈ 12,5-13 s** = 8 walks 4 de front × ~31 itérations × ~200 ms | **plancher P3 30 → 20** (décision propriétaire du 05/09 : k = 3, plancher 30) | **≈ −4 s** → job ≈ 11 s |

La journée de mesure P3 (`MESURE-P3-2026-09-05.md`) n'avait vu aucune
perte de tôle ni de pièce même à k = 1 ; ce qui manquait alors était la
chute de la dernière tôle, que la porte L2-bis mesure depuis. Proposition
unique : **essai plancher 20** (k inchangé) sous la porte L2-bis complète
(6 runs à 0,1, 4 à 2, médiane ± 5 mm, fusion ≥ 4/8, corpus, harnais) —
si elle tient, le verrou est tenu avec 4 s de marge ; sinon on garde 30 et
le verrou devient « ≤ 16 s », écrit comme tel. C'est le propriétaire qui
tranche ; l'implémenteur ne lance l'essai que sur son feu vert.

Instrumentation utile à conserver du rapport (lot suivant, hors chemin
critique) : seed et durée persistés sur les discards, `preLayouts` sur le
chemin BPP + méta, mesures de la ceinture en stats.

### Décision du verrou 15 s (07/09, 20 h 30 — arbitrage délégué au vérificateur par le propriétaire)

**Décision : essai du plancher P3 à 20, k = 3 inchangé**, sous la porte
qualité complète. Ce n'est pas une réouverture de la décision du 05/09
sur la qualité : la journée de mesure P3 n'avait vu aucune perte de tôle
ni de pièce même à k = 1, et la seule grandeur qu'elle ne mesurait pas —
la chute de la dernière tôle — est précisément ce que la porte L2-bis
mesure depuis. Le risque est borné par la porte, le gain attendu est de
l'ordre de 4 s sur 15.

Instruction fermée pour l'implémenteur :

1. **Un seul changement** : `sa_stop_floor` 30 → 20 (`config.rs`, valeur par
   défaut et env `NEST_SA_STOP_FLOOR` si elle existe — sinon la constante),
   `sa_stop_k` inchangé, `SAMPLE_CFG` inchangé, schéma compressé inchangé.
   Fixture du lock régénérée si elle change ; `determinism_lock.py` vert ;
   wasm rebuildé et commité dans le même commit.
2. **Porte qualité**, images = HEAD, machine à vide, fenêtre `SINCE`
   explicite : 6 runs T-A à 0,1 et 6 à 2 — chute de la dernière tôle de
   l'alternative compaction run par run, médiane à ± 5 mm des références
   (0,1 : 520,7 ; 2 : 483-485), fusion T-A@2 ≥ 4/8, grille bit-identique,
   0 écartée, 0 ceinturée ; corpus 11/11 avec **T-F ≥ 89/90** (P9 l'avait
   fait tomber à 88 : c'est le détecteur d'érosion) ; harnais 4 mm deux
   configurations 892 ± 6 ; **navigateur** : e2e 0,1 et 2, temps de calcul
   et grille.
3. **Verrou temps** : six runs création → fin à 0,1, décomposition
   (prise / traitement / post-pass), lecture « médiane ≤ 15 s et aucun run
   > 16 s » ; le rapport donne aussi les itérations par walk (attendu :
   20-24 au lieu de 30-34).
4. **Issue** : porte tenue → GO déploiement (Hetzner + homelab, contrôle
   overflow), verrou clos. Porte manquée sur un seul critère → retour à
   30 dans le même rapport, verrou écrit « ≤ 16 s » dans la fiche et le
   masterplan, sans autre essai. Pas de valeur intermédiaire (25) sans
   retour au vérificateur.

Ordre : cet essai passe **avant U1 passe 2** (une demi-journée, moteur
seul), pour que la phase B reparte sur une base de temps stable.
**Issue de l'essai (07/09, 22 h)** : porte manquée sur la chute compaction à
0,1 (médiane 606,5 mm, rollback dominant 4/6) et temps non gagné
(14,7-16,0 s à 25 itérations) → retour au plancher 30 (`6c08935`), **verrou
≤ 16 s** écrit dans la fiche (§9) et le masterplan (§5, §7). Deux faits à
garder pour le lot 5 : (a) le plancher P3 conditionne la compactabilité du
layout, une future mesure d'effort devra lire la chute compaction et pas
seulement les tôles ; (b) −20 % d'itérations n'a pas donné −20 % de temps :
le temps moteur n'est pas proportionnel aux itérations du SA, ce qui
plaide pour persister la durée moteur par walk (instrumentation déjà
demandée) avant tout nouveau levier de temps. Le compte rendu de l'essai
est en addendum du rapport U1 (`docs/qa/ui-pro-2026-09-07/RAPPORT-U1-2026-09-07.md`)
— à déplacer avec les documents perf lors du prochain rangement.

## 4. Déploiement

Procédure habituelle : images publiées, `assert_images_head.sh` sur les
bits publiés, corpus sur bits publiés, benchmarks `version` = hash
déployé (AI1), puis **homelab** : `docker compose pull && up -d
--force-recreate` et `python workers/nesting/bench/assert_overflow_head.py`
OK — sortie du contrôle dans le rapport de déploiement.
