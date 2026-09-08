# Rapport P9 (lot 4, phase B) — 2026-09-07

Implémenteur : ZCode. Destinataire : vérificateur. Conception fermée
§3bis de la vérification phase A ; instructions du diagnostic des deux
écartages appliquées DANS L'ORDRE. **Résultat principal : le rejeu
déterministe ne reproduit PAS l'écartage — le rapport le dit et
s'arrête** (instruction 1). Aucun correctif, aucune v2.

## 1. P9 v1 (implémentation)

Mémo « tôle saturée par classe » dans `construct()` :
`HashSet<(LayKey, item_id)>` créé PAR APPEL du constructif ; un échec
de `search_layout` mémorise ; la boucle first-fit saute la tôle
mémorisée SANS toucher au générateur ; l'ouverture d'une nouvelle tôle
ne consulte pas le mémo. Vérifié par votre relecture du diff.

## 2. Vérifications (toutes vertes)

| Verrou | Mesure |
|---|---|
| cargo à vide (conteneur Linux rust:1.88, release) | **72 passed / 0 failed / 1 ignored** |
| debug_assert déclenchée en debug host | `qt_hazard.rs:111` : `constricted_hazards.iter().filter(|h| h.is_some()).count() > 0` — tests `progress::tests::live_frame_phase2_metrics_in_original_frame`, `live_frame_map_back_matches_phase2_export`, `bpp::live_frame_tests::bpp_live_frame_matches_final_export_off_center` ; verts en release partout ; règle inscrite au guide (suites moteur en release, toute debug_assert documentée) |
| determinism_lock | **natif ≡ wasm bit-identique** (SHA `0bf374f2…`, tolérance 0) ; wasm rebuildé + commité |
| Porte qualité — chutes de l'alternative COMPACTION | @0,1 ×6 : médiane **520,7 = référence exacte** (455,8 / 520,7×3 / 582,8 / 585,2 ; rollback 'front' sur les deux hautes) ; @2 ×12 : médiane **483,4** (435,9-479,2 sans rollback ×4 ; 487,6-499,6 rollback ×7 ; 305,9 ×1) — à 4,2 mm du pôle 479,2 |
| Fusion à 2 mm | **11/12** (comptes de référence : 555/345, 577/323, 541/359, 523/377, 524/376) |
| Verrou 15 s (lecture : médiane ≤ 15 ET aucun run > 16) | six runs création→fin @0,1 : **14,2 / 14,3 / 14,4 / 14,7 / 15,5 / 15,5** — médiane 14,55, max 15,5 : **TENU** (avant : 17,3 pré-poll, 15,75 post-poll) |
| Corpus complet | **11/11** (T-A [587,313], T-J REFUS, T-F PARTIEL 88/90 attendu, physique propre, 0 erreur post-pass, ventilation par alternative) |
| Harnais 4 mm ×2 configs (app rebuildée wasm P9) | **893/900** les deux + 3 leviers + physique propre |
| Zéro écartée | **2/18** — objet du diagnostic ci-dessous |

## 3. Diagnostic des deux écartages — ARRÊT conformément à l'instruction 1

**Constat initial** (instrumentation L2-ter) : les deux jobs
(`bench-corpus-a-1788663539`, `…2464`, @2 mm) ont leur alternative
moteur `left` écartée avec **`originStage: post_pass`**. Paires : toutes
sur la tôle 1 (receveuse), fans, idxA 95-98 (relay lattice, bande haute
y≈923-942) × idxB 263-342 (rendues), aires 19-311 mm², gaps 0 ;
`mergedReceivers=1`, `compactRollback=true/'front'`, `recvCascade=null`
(voie fusion simple). SVG `_discarded` en GridFS.

**Le point manquant que vous avez relevé** : la ceinture exacte
(AC3/AD5) mesure les pièces touchées contre toute la tôle, en
différentiel sur anneaux bruts — une relayée (pose nouvelle) contre une
restaurée (pose d'origine) est précisément son cas. **Elle aurait dû
tirer et rendre une alternative ceinturée, pas écartée.** Pourquoi elle
s'est tue n'a pas pu être établi — voir l'arrêt.

### Instruction 1 : rejeu déterministe — NON REPRODUIT

Clone exact du job `…3539` en base (même owner, mêmes files, mêmes
params — space 2, tôles, budget 90 s, vcores 4, directions left —
payload canonique identique, donc `deterministic_seed` identique),
résolu par le même worker P9 : **job `done`, grille [573,327] +
alternative `left` valide (fusion 1), ZÉRO écartée.**

Deux impossibilités de trancher a posteriori :
- le seed moteur du run fautif n'est **pas persisté** sur le discard
  (`seed: null`) — impossible de vérifier l'égalité des seeds autrement
  que par le canon du payload ;
- `elapsed_ms` du walk n'est **pas persisté** sur les alternatives ni
  les discards — l'hypothèse restante est l'arrêt par **plafond temps**
  (la seule horloge du chemin moteur) : les 12 jobs @2 avaient été semés
  en rafale de 8 s sur deux workers, le run fautif a pu vivre son budget
  horloge différemment du clone seul. Non tranchable en l'état.

**Conformément à l'instruction, le rapport s'arrête ici.** Aucun
correctif (voie simple, ceinture), pas de v2 — P9 v1 reste le candidat,
lavé côté moteur par l'attribution à étages.

## 4. Ce que l'arrêt laisse ouvert (pour arbitrage du vérificateur)

1. **Persister seed et elapsed_ms sur les discards** (deux champs
   additifs) : sans eux, un écartage non reproductible ne peut pas être
   distingué d'un run horloge. Prérequis de tout pas-à-pas futur.
2. **preLayouts vide sur le chemin BPP+méta** (les deux discards) : le
   snapshot pré-expansion manque là où le rejeu hors ligne en a besoin —
   trou d'instrumentation à corriger avec un test (votre point 5).
3. **Persister les mesures de la ceinture** (pièces touchées, saleté
   avant/après, restauration — déterministes ; durée en journal) :
   votre instruction 2, à livrer avec la reprise du diagnostic.
4. Le pas-à-pas (fusion seule → fusion+compaction → ceinture) requiert
   une reproduction reproductible : d'abord 1 (et idéalement re-semer
   la série @2 dans les mêmes conditions de charge).

## ERRATUM (vérification §3ter du vérificateur) — P9 RETIRÉ

**Les « deux écartées » n'existaient pas.** Ma requête d'extraction ne
portait PAS de fenêtre de temps : elle a compté et lu des jobs écartés
de la nuit du 6 septembre (1 h 45 - 2 h 58 UTC, dont celui du L2-ter),
35 heures AVANT le commit P9. Les 17 jobs à 2 mm du jour P9 n'en
comptaient AUCUN — la porte « zéro écartée » était en réalité TENUE,
et tout le diagnostic qui a suivi a cherché à reproduire des fantômes.
Règle (ajoutée au masterplan par le vérificateur) : toute statistique
de porte se calcule sur une fenêtre explicite et le rapport donne la
requête.

**P9 ne produit pas le gain pour lequel il existe** (chronométrage du
vérificateur, binaires avant/avec P9 sur fixture déterministe) : moteur
4 283 → 4 255 ms (bruit), T-A 14,3-15,6 → 14,2-15,3 s, itérations 30-34
inchangées — le temps moteur est fixé par le plancher P3, pas par le
coût d'une itération. P9 érode en revanche la qualité (T-F −1 pièce,
harnais 894 → 891). **Verdict : NO-GO — revert du commit P9 et de son
wasm, exécuté (ec86abe), determinism_lock natif ≡ wasm rejoué VERT
(SHA f820cb5b…, tolérance 0).** Le verrou de 15 s remonte au
propriétaire ; proposition unique du vérificateur en attente de feu
vert : plancher P3 à 20 (k inchangé) sous porte qualité complète.
