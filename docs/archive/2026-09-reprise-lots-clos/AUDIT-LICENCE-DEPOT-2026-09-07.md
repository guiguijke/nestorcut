# Audit — ce que le dépôt public expose, ce qui est la propriété du propriétaire, licence non commerciale

Demande du propriétaire (07/09) : « regarder ce qu'on peut laisser public
sur le repo et ce qu'on pourrait considérer comme ma propriété et y mettre
une licence interdisant l'usage commercial ». Audit du vérificateur sur
l'arbre `0e33513`. **La décision est au propriétaire** (produit et
patrimoine) ; ce document donne les faits, une recommandation unique et
l'instruction fermée correspondante. Je ne suis pas juriste : les textes
retenus sont des licences standard, un avis d'avocat sur le montage final
reste prudent (une heure suffit).

## 1. Faits

### 1.1 État du dépôt

| Fait | Valeur |
|---|---|
| Dépôt | `github.com/guiguijke/nestorcut`, **PUBLIC**, 2 étoiles, 0 fork, 1 223 commits |
| Licence actuelle | **MIT** (racine `LICENSE`, double copyright : Volodymyr Stelmashchuk 2025 pour nest2d, Guillaume Jke 2026 pour les modifications) ; README : « published under the MIT license… not a self-hosting kit » |
| `package.json` | `"private": false`, pas de champ `license` ; `admin/package.json` `private: true` |
| `nest-engine/Cargo.toml` | `license = "MIT"` |
| Historique | remonte à 2018 (Nest4J → nest2d) ; **base du fork = `cc1a459` (13/06/2026, dernier commit amont)** ; premier commit propriétaire `0e27ec4` (27/07/2026) |
| Auteurs après le fork | **un seul** : Guillaume (415 commits ; l'implémenteur commet sous ce nom) — aucun consentement tiers à obtenir pour re-licencier les apports |

### 1.2 Part héritée de nest2d (MIT, à conserver sous MIT avec sa notice)

| Mesure | Valeur |
|---|---|
| Fichiers de l'arbre amont | 272 ; **144 encore présents, 49 octet-identiques** |
| Identiques : nature | 18 icônes/polices/SVG `public/`, 4 `constants/*.js`, 13 petits fichiers serveur (`logger.js`, `avatar.js`, `currency.ts`, `health.get.ts`, plugins `1_avatarSync`/`2_nest-notify`/`3_status-control`, `support/const.js`, `tracking/const.ts`, `payment/subscription/check.post.js`, `support/messages/index.get.js`), `shared/types/track_body.ts`, `geometry_debug.py`, 5 fichiers des workers legacy `stripnesting`/`stripfileprocessing` |
| Lignes de code | amont **≈ 17 200** (js/ts/vue/py/rs/scss) ; aujourd'hui **≈ 104 100** hors code vendorisé (+ 10 900 vendorisées sparrow/jagua) |

Lecture : l'ossature Nuxt (pages, store, API projets/fichiers/paiement,
workers Python d'origine) vient de nest2d et a été largement réécrite ;
**tout le moteur Rust (`nest-engine`, `nest-wasm`), le workspace
`workers/geometry` (import/export wasm), le post-pass Python
(`residual.py`, `structure.py`, `capacity.py`, `holed_polygons.py`…),
les miroirs JS du chemin navigateur (`localPool`, `localBridge`,
`residualClient`, `structureClient`, `localPayloadBuilder`), le coffre
ZK, la purge, les quotas/promo, l'admin, les benchmarks, la doc
(`docs/`, `AGENTS.md`) et la charte** sont postérieurs au fork.

### 1.3 Code tiers embarqué (licences à respecter quel que soit le choix)

| Composant | Licence | Où | Obligation | État |
|---|---|---|---|---|
| sparrow (Gardeyn, KU Leuven) | MIT | `crates/sparrow` vendorisé, adapté | notice conservée | ✓ `LICENSE` + `NOTICE` |
| **jagua-rs 0.7.2** | **MPL-2.0** | `crates/jagua-rs` vendorisé **et modifié** (4 fichiers : `import.rs` ×3, `transformation.rs`, cf. `VENDORED.patch.md`) | les fichiers MPL modifiés restent MPL et leur **source doit être fournie à qui reçoit le binaire** (le wasm servi à chaque navigateur en contient) | **✗ `LICENSE` absent du crate vendorisé** (Cargo.toml.orig le déclare, le fichier n'a pas été copié) — à ajouter ; le dépôt public satisfait aujourd'hui la mise à disposition |
| dxf-viewer | MPL-2.0 | npm, non modifié | rien de plus | ✓ |
| LibreDWG `dwgread` | GPL v3 | sous-processus, jamais lié | `docs/dwg-license.md` | ✓ |
| spyrrow | MIT | worker legacy `stripnesting` (non déployé) | notice | ✓ page /licences |
| nest2d | MIT | ossature | notice de copyright conservée dans toute copie | ✓ `LICENSE` |

### 1.4 Ce qui est public et ne devrait pas l'être (indépendant de la licence)

| Fichier | Pourquoi | Quoi faire |
|---|---|---|
| `docs/THREAT-MODEL.md` | s'annonce « interne, ne pas publier » | déplacer dans `specs/` (gitignoré) |
| `docs/CYBERSECURITY.md` | « Interne. Ne pas republier tel quel (chemins, défauts, backlog) » — posture pentest et backlog sécurité lisibles par tous depuis le 22/08 | déplacer dans `specs/` ; les règles techniques encore utiles aux agents restent dans `AGENTS.md` |
| `docs/stripe-go-live.md` | checklist de bascule live (le SIREN est public, la procédure et les réglages ne le sont pas) | déplacer dans `specs/infra/` |
| Adresse LAN du homelab en dur dans `assert_overflow_head.py` et `AGENTS.md` §6 | adresse privée exposée (risque faible, mais inutile) | `OVERFLOW_HOST` obligatoire par env, AGENTS renvoie au runbook privé |
| `PACKING-X-100-TROU.md` (racine) | mémo de debug périmé | `docs/archive/2026-08-audits/` |
| `workers/stripnesting`, `workers/stripfileprocessing` | workers legacy amont non déployés | supprimer (ou laisser : code MIT amont, sans enjeu) |

**Limite à connaître** : le dépôt n'accepte pas de réécriture d'historique
(règle AGENTS §7, deux builds concurrents vers `:latest`). Retirer un
fichier ne le retire pas des commits passés. Si l'exposition passée de
`CYBERSECURITY.md` compte, la seule vraie coupure est un **nouveau dépôt
public à historique neuf** (ou le passage en privé) — voir §2 option C.

### 1.5 Ce que change et ne change pas un changement de licence

- Tout ce qui a été publié sous MIT jusqu'au commit du changement **reste
  MIT pour quiconque en a pris copie** (licence irrévocable sur ces
  copies). À 2 étoiles et 0 fork, l'exposition réelle est faible, mais elle
  n'est pas nulle : le changement protège l'avenir, pas le passé.
- Le propriétaire peut placer **ses apports** sous la licence de son choix
  (seul auteur post-fork). Les parties héritées restent MIT (notice
  conservée), les parties vendorisées restent sous leur licence. Le
  résultat est un dépôt **multi-licences**, ce qui est courant et sain
  tant que chaque périmètre est nommé.
- Une licence « non commerciale » **n'est pas open source** au sens OSI.
  GitHub affichera « Other ». C'est compatible avec la position du
  masterplan §0 (la preuve publique = benchmarks reproductibles + code
  lisible pour vérifier « rien ne quitte la machine »), pas avec un
  discours « open source ».

## 2. Options

| Option | Contenu | Pour | Contre |
|---|---|---|---|
| **A. Public, PolyForm Noncommercial 1.0.0 sur les apports** (recommandée) | Code lisible et exécutable pour usage personnel, recherche, associatif, évaluation ; **tout usage commercial interdit** (y compris SaaS concurrent) ; MIT/MPL conservés sur leurs périmètres | texte standard court et lisible ; répond exactement à la demande ; garde la vérifiabilité de la promesse privacy et des benchmarks ; aucune contrainte d'exploitation pour NestorCut | pas « open source » ; ne protège pas ce qui a déjà été copié |
| B. Public, Elastic License 2.0 | interdit d'offrir le logiciel en service hébergé et de contourner les limites de licence ; **autorise l'usage commercial interne** | plus accepté par les entreprises | ne répond pas à « interdire l'usage commercial » : un atelier pourrait l'auto-héberger et s'en servir sans payer |
| C. Dépôt privé + vitrine publique minimale | dépôt privé ; publication à part de `workers/geometry` + sources modifiées de jagua (obligation MPL) + page benchmarks | coupe l'exposition passée et future ; simple | perd la lecture publique du chemin navigateur (argument privacy §0) ; il faut maintenir une seconde publication ; l'obligation MPL subsiste |
| D. Business Source License 1.1 | non commercial pendant N années puis bascule open source à date fixe | signal « ouvert à terme » | mécanique plus lourde (date de changement, grant additionnel) ; sans intérêt tant qu'aucune communauté n'existe |

**Recommandation : A**, complétée par le nettoyage §1.4 dans le même
commit, et par une **mention de marque** (le nom NestorCut, la brandLine
« NestorCut by APlasma » et les logos `public/brand/` ne sont couverts par
aucune licence de code — usage réservé). Documents et images (`docs/`,
captures, `data/benchmarks.js`) : même licence PolyForm pour ne pas
multiplier les textes (une CC BY-NC-ND n'apporte rien ici).

Si le propriétaire tient à couper l'exposition passée de la doc sécurité,
C peut se combiner à A : dépôt privé pour l'historique, **nouveau dépôt
public** créé par un export de l'arbre courant (un seul commit initial),
sous les mêmes licences. Coût : réécrire les liens (README, site, page
/benchmarks, CI images ghcr — les workflows suivent le dépôt).

## 3. Instruction fermée (lot L1 « licence », 0,5 j, à lancer sur le OUI du propriétaire à l'option A)

Fichiers : `LICENSE`, nouveau `LICENSE-MIT-nest2d`, nouveau
`THIRD-PARTY-NOTICES.md`, nouveau `TRADEMARK.md`,
`workers/nesting/engine/crates/jagua-rs/LICENSE` (nouveau, texte MPL-2.0),
`README.md` §License, `package.json`, `workers/nesting/engine/crates/nest-engine/Cargo.toml`,
`workers/nesting/engine/crates/nest-wasm/Cargo.toml`, `workers/geometry/*/Cargo.toml`,
`data/licences.js` (+ i18n de la page /licences), `docs/README.md`,
`AGENTS.md` §6-§7, `workers/nesting/bench/assert_overflow_head.py`, et les
déplacements du §1.4.

1. **`LICENSE`** = texte intégral **PolyForm Noncommercial 1.0.0**
   (https://polyformproject.org/licenses/noncommercial/1.0.0/), précédé du
   bloc :
   ```
   NestorCut — Copyright (c) 2026 Guillaume Jerke (APlasma)
   Licensed under the PolyForm Noncommercial License 1.0.0 (below).
   Required Notice: Copyright Guillaume Jerke (APlasma), https://nestorcut.com

   This repository also contains code under other licenses, which keep
   their own terms — see THIRD-PARTY-NOTICES.md and LICENSE-MIT-nest2d.
   ```
2. **`LICENSE-MIT-nest2d`** = texte MIT actuel avec le copyright de
   Volodymyr Stelmashchuk (nest2d) ; couvre « les parties du code héritées
   du projet nest2d au commit `cc1a459` ». Le copyright « Guillaume Jke
   2026 (modifications) » sort de ce fichier (les modifications sont sous
   PolyForm).
3. **`THIRD-PARTY-NOTICES.md`** : tableau du §1.3 (nest2d MIT, sparrow MIT,
   jagua-rs MPL-2.0 avec la liste des fichiers modifiés et le lien vers
   `VENDORED.patch.md`, dxf-viewer MPL-2.0, LibreDWG GPL v3 par
   sous-processus → `docs/dwg-license.md`, spyrrow MIT), plus la phrase
   « les sources des fichiers MPL modifiés sont dans ce dépôt, chemin
   `workers/nesting/engine/crates/jagua-rs/src/…` ».
4. **`crates/jagua-rs/LICENSE`** : texte MPL-2.0 intégral (celui du dépôt
   amont). `NOTICE` du workspace moteur : ajouter la ligne jagua vendorisé.
5. **`TRADEMARK.md`** : « NestorCut », « NestorCut by APlasma », le N-mark et
   les logos de `public/brand/` ne sont pas licenciés ; usage descriptif
   seulement (« compatible avec… »), aucun usage dans un nom de produit,
   domaine ou logo dérivé. Pointé depuis `LICENSE` et le README.
6. **`README.md`** §License : trois phrases — apports NestorCut sous
   PolyForm Noncommercial (pas d'usage commercial, pas de SaaS dérivé ;
   contact pour licence commerciale : adresse du site), parties nest2d sous
   MIT, tiers dans THIRD-PARTY-NOTICES ; retirer « published under the MIT
   license ». Ajouter au premier paragraphe : « Source visible pour que la
   promesse "rien ne quitte votre machine" soit vérifiable. »
7. **Métadonnées** : `package.json` → `"private": true`, `"license":
   "PolyForm-Noncommercial-1.0.0"` ; `Cargo.toml` de `nest-engine`,
   `nest-wasm` et des crates de `workers/geometry` → `license =
   "PolyForm-Noncommercial-1.0.0"` (les crates `sparrow`/`jagua-rs`
   vendorisés gardent MIT / MPL-2.0) ; vérifier que `cargo build` ne se
   plaint pas d'un SPDX inconnu (avertissement toléré, échec non).
8. **Page /licences** (`data/licences.js` + clés i18n) : une section en tête
   « Licence de NestorCut » avec les trois phrases du point 6 (FR/EN) ; la
   liste des tiers existante inchangée.
9. **Nettoyage §1.4** : `git mv` de `THREAT-MODEL.md`, `CYBERSECURITY.md`
   vers `specs/` et de `stripe-go-live.md` vers `specs/infra/` **puis**
   `git rm --cached` (specs/ est gitignoré) ; `docs/README.md` et
   `AGENTS.md` mettent à jour les liens (« runbook privé ») ;
   `assert_overflow_head.py` : `OVERFLOW_HOST` sans défaut, erreur claire
   s'il manque ; `AGENTS.md` §6 : « adresse dans le runbook privé
   `specs/infra/` » ; `PACKING-X-100-TROU.md` → `docs/archive/2026-08-audits/`.
   Aucune réécriture d'historique.
10. **Commit unique** `chore(licence): PolyForm Noncommercial 1.0.0 sur les
    apports NestorCut, notices tiers, marque, documents internes retirés
    du public`.

**Ne change pas** : aucun fichier de code hors métadonnées ; la CI
(`build-images.yml`) ; le contenu de `crates/sparrow` et
`crates/jagua-rs/src` ; les images publiées.

Verrous du rapport : `git ls-files | grep -c -i "THREAT-MODEL\|CYBERSECURITY\|stripe-go-live"` = 0 ;
`test -f workers/nesting/engine/crates/jagua-rs/LICENSE` ; `grep -c "PolyForm" LICENSE README.md package.json` ≥ 1 chacun ;
`git grep -n "192\.168\." -- ':!*.test.js' ':!*.json' ':!*.png'` = 0 ;
`npx vitest run` et `cargo build --release -p nest-engine` verts ; capture de
la page /licences FR et EN ; l'onglet « License » de GitHub après push
(affichera « Other » — attendu).
