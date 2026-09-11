# Plan import — phase C (diagnostic) en tête de T3 — consigne du 2026-09-09

Rédigé par le vérificateur pour l'implémenteur (masterplan §3.2, §4 ligne
T3, fiche lot 4 §3 « Phase C »). U3 est déployé (`251d182`), T3 s'ouvre.
Forme : **objectifs mesurables**, lots de travail indépendants que
l'implémenteur peut confier à des sous-agents en parallèle, puis une
synthèse séquentielle. **Aucune ligne de code produit** dans ce lot : on
mesure d'abord, on répare au lot suivant.

## 0. Pourquoi

La robustesse d'import est la première cause d'abandon d'un outil de
nesting et rien n'est mesuré aujourd'hui : deux DXF dans `.testparts/`,
un SVG et un DWG de fixture. La promesse « 100 % privé » repose sur
l'importeur wasm — c'est lui qu'on mesure en premier, ezdxf en second, et
l'écart entre les deux est un résultat en soi.

## 1. Objectif du lot

> À la fin du lot, on sait dire pour **≥ 30 DXF réels** ce que fait
> chaque importeur (wasm puis ezdxf) : lu tel quel / réparé / refusé,
> l'entité fautive, l'unité détectée ; les échecs sont classés par cause
> avec fréquence ; le texte du rapport de réparation est spécifié FR/EN.

Critère de fin : `docs/qa/import-2026-09-09/corpus.md` a une ligne par
fichier, `synthese.md` a le tableau des causes, et le propriétaire peut
choisir les trois premières réparations à coder au lot suivant.

## 2. Ce qui ne bouge pas (invariants)

- `app/`, `workers/geometry/src`, `workers/fileprocessing/core` :
  **intacts** (diff vide). Seuls `scripts/`, `docs/`, `.testparts/` et
  `specs/` (privé) changent.
- Fichiers confidentiels (entretiens, clients) : **hors dépôt public**
  (`specs/import-corpus/`, gitignoré) ; dans le dépôt, uniquement hash
  SHA-256 + provenance + licence. Fichiers publics libres : copiés dans
  `docs/qa/import-2026-09-09/corpus/` seulement si la licence le permet,
  sinon `.testparts/` (gitignoré) + hash.
- Une seule grille JSON de résultat pour les deux importeurs (§4).

## 3. Lots de travail (parallélisables)

Les lots A, B, C sont indépendants : un sous-agent chacun. D et E
attendent A+B+C.

### Lot A — corpus (objectif : ≥ 30 DXF, ≥ 6 familles)

Familles à couvrir, au moins 3 fichiers chacune : (1) exports CAO propres
(polylignes fermées, arcs bulge) ; (2) splines ; (3) contours ouverts à
refermer (gap < 0,5 mm) ; (4) blocs / INSERT imbriqués avec échelle et
rotation ; (5) textes, cotes, calques parasites ; (6) unités douteuses
(`$INSUNITS` absent ou 0, pouces déclarés, mètres) ; (7) trous imbriqués
et pièces multiples par fichier ; (8) versions DXF anciennes (R12) et
binaires. Sources admises : fichiers du propriétaire et des entretiens
(privés), échantillons libres (dépôt ezdxf `examples/`, LibreDWG
`test/test-data`, corpus open-source de découpe laser sous licence
permissive) — provenance et licence notées ligne par ligne.

Livrable : `docs/qa/import-2026-09-09/corpus.md` — colonnes : id, nom,
SHA-256, provenance, licence, famille(s), version DXF, taille.
Fait quand : ≥ 30 lignes, ≥ 6 familles couvertes avec ≥ 3 fichiers.

### Lot B — coureur wasm (objectif : un JSON par fichier, sans le navigateur)

`scripts/qa-import-wasm.mjs` : charge le bundle wasm de
`workers/geometry` (celui du chemin navigateur, `build-wasm.sh`), appelle
l'import exactement comme le worker géométrie de l'app (mêmes symboles,
mêmes options), sur chaque fichier d'un dossier, et écrit
`docs/qa/import-2026-09-09/wasm/<id>.json` selon la grille §4. Un crash
wasm = statut `refused` avec le message, jamais un arrêt du coureur.
Fait quand : le coureur passe sur `.testparts/` et le corpus du lot A
sans interruption, et les deux DXF de `.testparts/` donnent
`status: read` avec les comptes de pièces déjà connus (Piece_Trou 1
pièce 1 trou, Piece_Fillx4 1 pièce).

### Lot C — coureur ezdxf (objectif : même grille, même corpus)

`scripts/qa-import-ezdxf.py` : appelle `read_dxf_file` de
`workers/fileprocessing` (dans l'image docker fileprocessing, pas sur le
poste) sur les mêmes fichiers, écrit
`docs/qa/import-2026-09-09/ezdxf/<id>.json` selon la grille §4.
Fait quand : mêmes conditions que B.

### Lot D — classement (séquentiel, après A+B+C)

`docs/qa/import-2026-09-09/synthese.md` :

1. tableau par fichier : statut wasm, statut ezdxf, pièces wasm / ezdxf,
   unité wasm / ezdxf, écart (oui/non) ;
2. tableau par **cause** (splines, contours ouverts, blocs, textes,
   unités, calques, trous imbriqués, version) : fréquence, exemple, quel
   importeur échoue ;
3. taux « lu sans réparation manuelle » par importeur (cible masterplan
   §4 T3 : ≥ 95 % après le lot de réparation — ici on mesure le point de
   départ) ;
4. les trois causes les plus fréquentes, avec pour chacune **une**
   proposition de réparation chiffrée (fichiers touchés, effort en jours,
   risque sur le déterminisme natif ≡ wasm) — proposée, pas décidée.

### Lot E — spécification du rapport de réparation (après D)

`docs/qa/import-2026-09-09/rapport-reparation.md` : pour chaque cause du
lot D, la phrase utilisateur FR et EN (« 2 contours ouverts refermés,
1 bloc aplati, unités mm détectées »), le niveau (info / attention /
refus), et où elle s'affiche (fiche fichier, `FileDone.vue`). Aucun code.

## 4. Grille JSON commune (un fichier par DXF et par importeur)

```json
{
  "id": "c07", "importer": "wasm|ezdxf", "version": "<commit>",
  "status": "read|repaired|refused",
  "error": null, "failingEntity": null,
  "unitDeclared": 4, "unitDetected": "mm", "scaleApplied": 1.0,
  "entities": {"LWPOLYLINE": 12, "SPLINE": 2, "INSERT": 1, "TEXT": 3},
  "parts": 4, "holes": 6, "openContours": 1, "openContoursClosed": 1,
  "blocksFlattened": 1, "splines": 2, "splinesHandled": "sampled|refused",
  "ms": 41
}
```

Champ non mesuré par un importeur = `null`, jamais omis.

## 5. Verrous et ordre

1. `assert_images_head.sh` OK avant les passages ezdxf (image
   fileprocessing = HEAD).
2. Diff produit vide : `git diff --stat <base>..HEAD -- app
   workers/geometry/src workers/fileprocessing/core` dans le rapport.
3. Rapport constat par constat (masterplan §8) : nombre de fichiers,
   nombre de familles, comptes par statut et par importeur, commandes
   exactes, non-faits énoncés.
4. Pas de décision ouverte : les propositions de réparation du lot D
   sont chiffrées une par une, le choix revient au propriétaire.

## 6. Deux corvées à faire avant, hors lot (30 min)

- **CI `app-ci` rouge depuis `2e99ddb`** : `server/tests/signupDigest.test.js`
  importe `admin/server/utils/signupDigest`, et esbuild résout
  `admin/tsconfig.json` → `extends ./.nuxt/tsconfig.json`, absent en CI.
  Correctif fermé : dans `vitest.config.js`, ajouter
  `esbuild: { tsconfigRaw: '{}' }` (plus de recherche de tsconfig pour
  les tests). Vérifier en local en renommant temporairement
  `admin/.nuxt` : `npx vitest run` 517/517, puis remettre. Fait quand :
  `app-ci` vert sur `main`.
- **Diagrammes du site marketing** : `public/diagrams/*.svg`, 64
  occurrences de `#007bff` → `#0069d9`, remplacement mécanique. Fait
  quand : `grep -c 007bff public/diagrams/*.svg` = 0 partout et deux
  diagrammes relus à l'œil en ligne.

## 7. Point vérificateur (10/09) sur les lots A, B, C livrés (`eaf11ff7`)

- **Lot A** : 85 DXF, 8 familles — mais **4 seulement viennent d'un flux
  CAO réel** (propriétaire), 55 sont produits par le projet. Le lot D
  doit donc **stratifier** toutes ses statistiques en « réels » /
  « synthétiques » et le taux « lu sans réparation » ne se publie que sur
  les réels. Le propriétaire fournit les fichiers des entretiens dans
  `specs/import-corpus/` ; l'agent les intègre (hash + provenance) avant
  le lot D.
- **Lots B et C** : les deux coureurs tournent, mais n'ont été passés que
  sur `.testparts/` (2 fichiers chacun). Le critère « fait quand » exigeait
  le corpus entier : **passer les 85 fichiers dans les deux coureurs**
  (`docs/qa/import-2026-09-09/{wasm,ezdxf}/<id>.json`) avant d'ouvrir D.
- Deux constats déjà exploitables, à porter au lot D avec leur fichier
  témoin : (1) un contour à **gap 0,3 mm n'est pas refermé et disparaît
  sans message** (perte silencieuse de pièce — le pire des cas pour
  l'utilisateur) ; (2) l'import **SVG coûte ~4,3 s pour 6 entités**.
- `.testparts/` est désormais ignoré par git (il ne l'était pas ; AGENTS
  le disait). Aucun fichier du corpus n'est entré dans le dépôt (vérifié :
  0 DXF/DWG ajouté au commit).

## 8. Corpus RÉEL du propriétaire — 153 DXF passés dans les deux importeurs (vérificateur, 10/09 soir)

Le propriétaire a déposé **153 DXF d'atelier** (18 Mio) dans
`specs/import-corpus/` (privé, ignoré par git — vérifié : `.gitignore:65`).
Les noms de fichiers portent des noms de clients : **ils ne sortent jamais
du dossier privé** ; ici, comptes et identifiants neutres seulement. Les
deux coureurs ont tourné tels quels (`qa-import-wasm.mjs` sur le poste,
`qa-import-ezdxf.py` dans l'image fileprocessing à `229222a1`) ; sorties
brutes hors dépôt (`~/qa-out/import-reel/`).

| | wasm (navigateur) | ezdxf (serveur) |
|---|---|---|
| lus | 140 | 103 |
| « réparés » | 1 | 47 (= segments pendants détectés, **rien n'est recousu**) |
| refusés | **12** | 3 |
| temps total | 281 s | 171 s |

**Ce que le corpus réel dit, par gravité :**

1. **La garde « trop d'entités » (999) refuse 11 fichiers réels que le
   serveur lit** : dessins LightBurn et gravures à splines de 1 100 à
   6 100 entités (poules, poussins, arbre de vie). Côté navigateur, le
   client voit un refus ; côté serveur, le même fichier passe. Un seul
   fichier (arbre de vie, 6 144 entités) est refusé des deux côtés.
   → à traiter avec la priorité 2 : la garde doit porter sur le **temps**
   ou sur un plafond réaliste (≥ 5 000), et être posée **avant** le
   travail (constat C9 de la synthèse).
2. **Segments pendants sur 33 fichiers réels sur 153** (ezdxf les voit,
   le wasm n'en mesure aucun) et **7 fichiers où les deux importeurs ne
   rendent pas le même nombre de pièces ou de trous**, sans aucun message
   des deux côtés : 141 contre 151 pièces, 10 contre 7, 2 contre 1, 30
   contre 34 ; jusqu'à 551 segments pendants sur un même fichier.
   → c'est la matière de la priorité 3 (couture) ; la fixture témoin
   existe maintenant, en privé.
3. **8 fichiers réels sans unité déclarée** (`$INSUNITS = 0`) → « mm
   supposés » en silence des deux côtés. → priorité 2 (unités).
4. **Deux fichiers lus par le wasm et refusés par ezdxf « 0 entité »**
   (dont un à 169 pièces) : le serveur échoue là où le navigateur réussit.
   → à classer avec la priorité 2 (écart entre importeurs).
5. **Temps d'import** : 68 s, 33 s et 19 s côté wasm pour des fichiers à
   **une** pièce riches en splines (101 fichiers sur 153 contiennent des
   splines) ; 57 s côté ezdxf sur un autre. Un import de plus d'une minute
   pour une pièce est un abandon. → à mesurer et corriger avec la
   priorité 2 (échantillonnage des splines).

**Taux « lu sans réparation manuelle » sur le réel** (ce que la synthèse
ne pouvait pas dire avec 4 fichiers) : wasm **140 / 153 = 91,5 %**, ezdxf
103 / 153 = 67 % (les 47 « réparés » sont des fichiers à segments perdus,
pas des réparations). La cible du masterplan est 95 %.

**Pour l'agent, quand la priorité 2 s'ouvre** : intégrer ces 153 fichiers
au corpus par **hash + provenance « propriétaire, privé »** (jamais de
nom de fichier ni de client dans `docs/`), relancer les deux coureurs
depuis `specs/import-corpus/`, et stratifier la synthèse « réels » sur
ces 153 au lieu de 4. Les cinq constats ci-dessus deviennent les
verrous chiffrés des priorités 2 et 3.

## 9. Priorité 2 — import : garde, unités, messages, temps (consigne fermée, prête à envoyer)

Décision propriétaire du 10/09 : les réparations d'import sont importantes ;
chercher d'abord la solution existante. Cette priorité couvre ce qui se
corrige **sans couture** ; la couture des contours est la priorité 3 (§10,
à écrire après l'inventaire GitHub). Base de mesure : les **153 DXF réels**
de `specs/import-corpus/` (§8) plus les 85 du corpus versionné.

### 9.1 Objectif

> Sur les 153 fichiers réels : plus aucun refus « trop d'entités » pour
> un fichier que le serveur lit ; aucune unité supposée en silence ;
> aucune perte de matière sans message ; aucun import de plus de 10 s pour
> une pièce. Même comportement dans les deux importeurs.

### 9.2 Périmètre fermé (quatre lots, un commit chacun)

**Lot 2a — la garde « trop d'entités »** (`app/composables/geometryClient.js`
et le worker géométrie wasm, miroir Python dans
`workers/fileprocessing/core`). Aujourd'hui : plafond 999 entités, posé
**après** le travail. Règle : la garde devient un **budget de temps**
(plafond 20 s par fichier, mesuré) et un plafond d'entités relevé à
**10 000**, posés **avant** la décomposition ; au-delà, message clair
« fichier trop lourd pour l'import navigateur (N entités) : import serveur
possible » avec le nombre. Verrou : les 11 fichiers réels aujourd'hui
refusés à tort sont lus (`status: read`), l'arbre de vie (6 144 entités)
est refusé avec son message dans les deux importeurs, et aucun fichier du
corpus ne dépasse 20 s.

**Lot 2b — unités** (`workers/fileprocessing/dxf_utils.py` `INSUNITS_TO_MM`
et son miroir wasm `nest-import`). Règle : table complète des codes
`$INSUNITS` (0 à 20) ; `$INSUNITS` **écrit en flottant** accepté ; code
absent ou 0 → « unité non déclarée, millimètres supposés » de niveau
**attention** ; codes 3, 7, 10-20 → conversion exacte au facteur du code,
jamais un repli silencieux sur le millimètre ; en pouces (code 1) ×25,4.
Verrou : les 8 fichiers réels sans unité portent l'avertissement ; c59
(kilomètres) est converti avec le bon facteur ou refusé avec message,
jamais lu à ×1 ; nos exports CAM c08-c11 (flottant) gardent leur unité ;
parité wasm ≡ ezdxf sur `unitDetected` et `scaleApplied` pour les 238
fichiers.

**Lot 2c — messages de perte** (spécification `rapport-reparation.md`,
FR/EN, clés i18n listées là). Règle : toute matière écartée (entité non
supportée, contour pendant non recousu, pièce vide) produit un constat de
niveau **attention** visible sur la fiche fichier (`FileDone.vue`), avec
le compte ; l'avertissement wasm qui meurt aujourd'hui entre IndexedDB et
la fiche est **porté** jusqu'à l'affichage. Un fichier sans constat
n'affiche rien. Verrou : les 33 fichiers réels à segments pendants et les
7 à écart de comptage affichent un constat chiffré ; capture de la fiche
pour trois d'entre eux (identifiants neutres, jamais les noms).

**Lot 2d — temps des splines** (échantillonnage dans `nest-import` et
`dxf_utils`). Mesurer d'abord : profil des trois fichiers à 68, 33 et
19 s (où passe le temps : échantillonnage, décomposition, polygonisation)
; règle de correctif : échantillonnage adaptatif par tolérance de flèche
(`flattening` existant), plafond de sommets par spline, sans changer la
géométrie livrée au-delà de la tolérance actuelle. Verrou : ces trois
fichiers sous 10 s dans les deux importeurs, `handles_canonical` et le
sweep corpus 41/41 inchangés, déterminisme géométrie
(`workers/geometry/parity`) vert.

### 9.3 Invariants

Handles canoniques (piège #33b), seed canonique du flux navigateur
inchangé pour les fichiers déjà lus correctement, parité
`workers/geometry/parity` verte, aucun nom de fichier réel dans `docs/`.

### 9.4 Ordre et verrous globaux

2a → 2b → 2c → 2d, un rapport par lot en §9.5 ; les deux coureurs
relancés sur les 238 fichiers après chaque lot (comptes avant/après) ;
vitest, pytest fileprocessing, cargo geometry ; harnais navigateur deux
configurations (l'import du corpus T-A ne doit pas changer) ; GO par lot ;
déploiement app + wasm géométrie + worker fileprocessing.
## 9.5 Rapports par lot

### Lot 2a — la garde « trop d'entités » (implémenteur, 11/09)

Commit : `7149fb56` (le lot), plus ce commit de correction du hash. **Non déployé** : le wasm géométrie, l'app et le worker
fileprocessing ont changé — déploiement après votre GO.

#### 9.5.1 Ce qui est livré

La garde n'est plus un plafond de 999 entités posé **après** le travail.
Les deux importeurs appliquent la même règle, au même endroit du flux :

| | avant | après |
|---|---|---|
| plafond d'entités | 999, comparé après l'import complet | **10 000**, évalué sur le compte que rend l'expansion des INSERT, **avant** l'assemblage |
| budget de temps | aucun | **20 s par fichier**, contrôlé DANS les boucles chaudes : le travail s'arrête au budget |
| message | « trop d'entités — essayez Nos serveurs » | le même **avec le nombre** (« … 12 345 entités, 10 000 au maximum »), et un message distinct pour le refus de temps |
| plafond dur d'expansion | 4 000 (`worker_common`, pentest H-4) | **100 000** = 10 × le plafond fonctionnel, pour que le refus annonce le nombre EXACT |

Le compte du plafond est **celui qui alimente déjà `entity_count` /
`validEntityCount`** — pas un second comptage : c'est la réserve explicite
du constat C9 de la synthèse (un comptage parallèle déplacerait le seuil
sur les fichiers limites).

- Rust : `nest-import::budget` (`Limits`, `Deadline`, `TooHeavy`) et
  `import_file_limited` / `import_dxf_limited` / `import_svg_limited`. Les
  fonctions historiques restent **sans borne** (CLI, harnais de parité,
  goldens) et `Limits::unlimited()` rend une sortie identique octet pour
  octet (verrou dédié).
- L'échéance est contrôlée **là où le temps passe, mesuré et non supposé**
  — profil natif du pire fichier réel : `node_segments` 7,4 s (O(n²) sur
  30 000 arêtes), `attach_handles` ≈ 8,6 s, tout le reste sous 10 ms.
  Contrôle échantillonné (une lecture d'horloge toutes 16 itérations des
  boucles externes) ; horloge `web_time` = `std::time` en natif et
  `performance.now()` en wasm (AGENTS #14c).
- Python : `core/import_budget.py` (mêmes noms de causes) et
  `build_geometry(..., deadline=…)`. Le tag de reroute reste
  `1k_entity_count` ; le détail chiffré part dans un champ **additif**
  `importRefusal { reason, entityCount, maxEntities, elapsedMs, timeBudgetMs }`.
- Navigateur : `geometryClient.IMPORT_MAX_ENTITIES` /
  `IMPORT_TIME_BUDGET_MS`, op worker `import_file_limited`, et les clés
  `localImport.tooManyEntities` / `tooManyEntitiesAtLeast` / `tooHeavy` /
  `blockDepth` (FR+EN), nombres formatés dans la locale (piège #24).
- Les deux bornes sont réglables sans livrer de code (`MAX_ENTITY_LIMIT`,
  `IMPORT_TIME_BUDGET_S`) : un seuil de produit doit pouvoir bouger.
- **Garde de profondeur d'INSERT (32) ajoutée côté Rust — elle manquait.**
  Un graphe de blocs cyclique faisait récurser l'expansion sans fin : pile
  saturée, worker géométrie mort, et un plafond de comptage n'y change rien
  (un cycle d'INSERT n'émet aucune entité). C'est le miroir de
  `assert_insert_depth` (pentest H-4), avec son verrou.

#### 9.5.2 Les deux coureurs sur les 238 fichiers

**153 fichiers réels** (`specs/import-corpus/`, identifiants neutres) :

| | wasm avant | wasm après | ezdxf avant | ezdxf après |
|---|---:|---:|---:|---:|
| lus | 140 | **150** | 103 | 103 |
| « réparés » | 1 | 1 | 47 | 46 |
| refusés | **12** | **2** | 3 | 4 |
| temps total | 281,0 s | 109,1 s | 170,7 s | 184,4 s |

**85 fichiers versionnés** (`.testparts/corpus/`) :

| | wasm avant | wasm après | ezdxf avant | ezdxf après |
|---|---:|---:|---:|---:|
| lus | 51 | 51 | 48 | 48 |
| « réparés » | 19 | 21 | 24 | 24 |
| refusés | **15** | **13** | 13 | 13 |
| temps total | 28,8 s | 11,4 s | 6,7 s | 16,1 s |

**Les totaux de temps ne sont pas comparables entre campagnes** (état de la
machine : les mêmes fichiers passent de 12,0 s à 3,9 s sans changement de
code). Pour attribuer, un A/B dans le MÊME conteneur, budget actif contre
budget désactivé, sur les 85 fichiers : **14,8 s contre 15,6 s** — le coût
du contrôle d'échéance n'est pas mesurable. Ce qui se compare d'une
campagne à l'autre, ce sont les **statuts**, pas les secondes.

**Géométrie livrée : aucune dérive.** Sur tous les fichiers lus avant ET
après, des deux côtés, `parts` et `holes` sont identiques (238/238). Le
harnais de parité golden est à 100 % (seuil 99 %) et le verrou de
déterminisme natif ≡ wasm à 68/68 + 17/17, tolérance 0.

#### 9.5.3 Verrous du §9.2

| Verrou | Résultat |
|---|---|
| **les 11 fichiers réels refusés à tort sont lus** | **11/11**, `status: read`, 1,3 à 12,3 s, de 1 112 à 6 144 entités — mêmes pièces et mêmes trous que le serveur |
| **aucun fichier du corpus ne dépasse 20 s** | **tenu** : maximum mesuré **20,035 s** côté navigateur et **20,5 s** côté serveur. Le dépassement est le temps d'UN appel non interruptible (35 ms en wasm, 545 ms pour un appel shapely). Avant : 67,6 s et 56,9 s |
| **le refus est instantané** (défaut C9) | plafond d'entités : refus en **7 ms** natif / **20 ms** wasm sur un fichier de 6 144 entités, contre **4,1 s** payés avant |
| **le message porte le nombre** | verrou Rust (le message contient le compte et le plafond) + verrous JS sur les quatre clés, rendu FR vérifié |
| **même règle des deux côtés** | plafond d'entités : **identique** (propriété du fichier). Budget de temps : **pas identique en verdict** sur 3 fichiers sur 238 — voir 9.5.4 |
| suites | vitest **526** (521 + 5), cargo geometry **106** (99 + 7), pytest fileprocessing **42** (35 + 7), pytest common **48** |
| parité et déterminisme | golden **100 %** (seuil 99 %), natif ≡ wasm **68/68** et **17/17**, tolérance 0 |
| **la garde vue par l'utilisateur**, vrai navigateur, vrais fichiers | fichier de **1 841 entités importé** (refusé avant le lot) ; fichier lourd **refusé après 20,2 s** avec le message **« This file is too heavy for in-browser import (787 entities, over 20 s) — try “Our servers”. »** — le nombre est là, la carte fichier n'est pas créée |
| harnais navigateur, deux configurations | **900/900 placées** aux deux espacements (0,1 et 2), `spacingOk: true`, **0 pose dupliquée**, `verifyStatus: measured` ; calcul **24 s**, mur **40,9** et **41,0 s** (bande déjà mesurée sur ce poste : 36,5-40,8 s ; ce lot ne touche ni le moteur ni le post-pass). Le harnais importe ses deux DXF **par la nouvelle garde** : c'est aussi le verrou d'intégration du chemin |

**Ce que le lot change pour un utilisateur**, en une ligne : dix fichiers
d'atelier sur onze qui revenaient « trop d'entités » s'importent ; le
onzième aussi (6 144 entités, 1,8 s) ; et l'onglet ne peut plus geler plus
de 20 s sur un import.

#### 9.5.4 Un verrou demandé qui ne peut pas tenir, et les chiffres qui le disent

Le §9.2 demande que **le fichier de 6 144 entités soit refusé avec son
message dans les deux importeurs**. Mesuré :

| | navigateur | serveur |
|---|---:|---:|
| entités | 6 144 | 6 144 |
| temps d'import | **1,8 s** | **20,5 s** (arrêté par le budget) |
| verdict sous la règle livrée | **lu** | refusé (temps) |

Il est **sous le plafond de 10 000 et sous le budget de 20 s côté
navigateur** : le refuser demanderait un plafond inférieur à 6 144, donc
qui refuserait encore 6 des 11 fichiers que le §9.1 veut voir lus. Je l'ai
donc laissé passer côté navigateur — c'est l'objectif du §9.1 (« plus aucun
refus “trop d'entités” pour un fichier que le serveur lit ») qui tranche,
pas mon goût.

**Le fond du problème est que le budget de temps n'est pas une propriété du
fichier**, mais de l'implémentation qui le lit : à budget égal, les deux
importeurs rendent des verdicts différents sur **3 fichiers sur 238** :

| fichier (id neutre) | entités | navigateur | serveur |
|---|---:|---|---|
| R044 | 787 | **refusé** à 20,0 s (lu avant en 67,6 s) | lu en 8,7 s |
| R036 | 6 144 | lu en 1,8 s | **refusé** à 20,5 s (refusé avant aussi, par le plafond de 4 000) |
| R028 | 1 784 | lu en 6,5 s | **refusé** à 20,3 s (lu avant en 56,9 s) |

Pour R044, le renvoi « import serveur possible » du message est donc
**vérifié** (le serveur le lit en 8,7 s) — la règle « ne jamais orienter
vers un chemin dont on n'a pas vérifié qu'il réussit » est respectée.

**Un seul fichier réel régresse : R028**, lu par le serveur en 56,9 s avant
ce lot, désormais garé à 20,3 s. Le navigateur le lit en 6,5 s. Deux
options chiffrées, à votre arbitrage :

- **(a) garder 20 s des deux côtés** (ce qui est livré) : 3 fichiers sur
  238 en désaccord, 1 régression serveur, et le lot 2d supprime la cause
  (voir 9.5.5) — après quoi les trois fichiers passent sous 10 s et le
  désaccord disparaît de lui-même ;
- **(b) `IMPORT_TIME_BUDGET_S=60` côté serveur** (une ligne de compose,
  aucun code) : plus aucun refus de temps côté serveur (le plus lent
  restant est à 8,7 s hors ces deux fichiers), le navigateur garde 20 s,
  et le message « essayez Nos serveurs » devient vrai pour les trois.

Je n'ai pas tranché seul parce que (b) rend les deux importeurs
volontairement asymétriques, ce que le §9.1 interdit en toutes lettres.

#### 9.5.5 Non-faits, et ce que la mesure donne au lot 2d

1. **La cause des 57 s côté serveur est trouvée, et ce n'est pas les
   splines.** cProfile sur le pire fichier : **64,7 s des 66,7 s** sont
   passées dans `body.buffer(probe_tol)` — **3 772 appels à 17 ms**, parce
   que l'attachement des handles rebuffe le corps de la pièce **à chaque
   empreinte** (`build_geometry.py`, boucle des footprints). Le sortir de
   la boucle est un calcul identique, fait une fois : c'est le lot 2d, je
   ne l'ai pas fait ici (hors périmètre du 2a).
2. **Côté navigateur**, le pire fichier se décompose en `node_segments`
   7,4 s (O(n²), 30 000 arêtes) et `attach_handles` ≈ 8,6 s en natif —
   × ~4 en wasm. Même conclusion : c'est la matière du lot 2d, pas de
   l'échantillonnage de splines seul.
3. **`canonical_dxf` n'est pas borné en profondeur de blocs.** Il n'est
   appelé qu'après un import borné (donc jamais sur un graphe cyclique),
   mais l'API wasm l'expose : à border au lot où l'on touchera ce chemin.
4. **Aucune capture d'écran du message de refus** : aucun fichier des 238
   n'atteint 10 000 entités, le témoin est donc synthétique (tests) plus
   les deux fichiers réels refusés par le temps. Les captures de fiche
   fichier sont le lot 2c.
5. **Une erreur de ma part, attrapée par la sonde navigateur et non par les
   tests** : la page projet lisait les paramètres du message via
   `filesGetters.localImportErrorParams?.value`, or ce getter est un proxy
   réactif qui déréférence DÉJÀ les refs — le message s'affichait
   « ({n} entities, over {seconds} s) », placeholders bruts, alors que les
   suites étaient vertes (elles verrouillent le composable, pas la page).
   Corrigé, re-vérifié dans le navigateur. La leçon est celle du lot
   précédent : un verrou qui ne regarde pas ce que l'utilisateur voit ne
   verrouille pas le message.
6. **Le corpus réel reste hors dépôt** ; les identifiants R0xx de ce
   rapport sont le rang du sha256 du fichier, la table de correspondance
   ne quitte pas la machine.
