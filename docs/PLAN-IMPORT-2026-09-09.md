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
- **Valeurs du budget (arbitrage du vérificateur, 12/09) : 20 s au
  navigateur, 60 s côté worker**, inscrites dans le code
  (`TIME_BUDGET_S_DEFAULT = 60`) et dans `docker-compose.yml`, pas seulement
  dans une variable d'environnement. Raison : le plafond d'entités est une
  propriété du FICHIER, donc partagé ; le budget de temps est une propriété
  de l'IMPLÉMENTATION qui lit — le même fichier basculait à 20,3 s sur un
  poste et 20,6 s sur l'autre, un seuil qui suit la charge de la machine
  n'est pas un seuil de produit. Un onglet fait attendre quelqu'un ; un
  worker est asynchrone. Conséquence mesurée : **plus aucun refus de temps
  côté serveur** sur les 238 fichiers (le plus lent hors les deux cas du
  §9.5.4 est à 8,7 s), et le renvoi « essayez Nos serveurs » du message
  navigateur redevient vrai pour les trois fichiers en désaccord.
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

**Après l'arbitrage du 12/09 (option (b), 60 s côté worker), mesuré.** Le
coureur ezdxf rejoué sur les 153 réels rend **103 lus, 48 réparés, 2
refusés** — les deux pour « 0 entité », défaut préexistant sans rapport avec
les bornes — et **0 refus de temps**. Conséquences :

- le fichier de **6 144 entités est désormais lu des deux côtés** (20,5 s au
  serveur, 1,8 s au navigateur) alors qu'il était refusé des deux côtés
  avant le lot (plafond dur de 4 000 au serveur, plafond 999 au
  navigateur) ;
- le fichier à 1 648 splines **retrouve sa lecture** au serveur (56,1 s) :
  la seule régression du lot est annulée ;
- le désaccord entre importeurs **tombe de 3 fichiers à 1** : celui de
  787 entités, refusé au navigateur à 20 s et lu par le serveur en 8,7 s —
  c'est-à-dire exactement ce que son message promet à l'utilisateur ;
- **aucune dérive** de pièces ni de trous contre le passage à 20 s.

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

### Lot 2a — vérification (vérificateur, 11/09, `ae4d8cba`) — GO, avec un arbitrage à appliquer avant le déploiement

Rejoué sur le poste, image fileprocessing reconstruite à HEAD, app locale
au commit du lot (`ASSERT IMAGES=HEAD: OK`), sorties brutes hors dépôt
(`~/qa-out/verif-2a/`).

| Verrou | Résultat |
|---|---|
| cargo geometry release | 106, 0 échec |
| vitest | 526 |
| parité golden | 63 bit-identiques + 2 error-parity + 2 metrics-ok = 100 % (seuil 99 %) |
| déterminisme natif ≡ wasm | 68/68 et 17/17, tolérance 0 |
| coureur wasm, 153 réels | 140 → **150 lus** (149 + 1 réparé), 12 → **2 refusés** ; les 11 refusés à tort passent `read` en 1,5 à 11,2 s ; **0 dérive** parts/trous sur les 140 lus des deux côtés ; le seul fichier basculé `read → refused` est celui de 787 entités (67,6 s avant, 20,1 s garé) |
| coureur ezdxf, 153 réels, 20 s | 103 lus, 46 réparés, **4 refusés** : 2 à « 0 entité » (inchangés), **2 par le temps** : l'arbre de vie (6 144 entités, 20,4 s ; refusé avant par le plafond dur 4 000) et le fichier à 1 648 splines (20,6 s ; **lu avant en 56,9 s** — la régression du §9.5.4 se reproduit sur mon poste) ; 0 dérive sur 148 |
| harnais navigateur, espacement 2 | 900/900 placées, `spacingOk` vrai, 0 pose dupliquée, `verifyStatus: measured`, calcul 24 s, mur 40,8 s (bande du poste) ; les deux DXF passent par la nouvelle garde |
| lecture du code | plafond évalué sur le compte de l'expansion des INSERT, avant l'assemblage ; échéance `web_time` échantillonnée (pas 16) dans `node_segments`, `attach_handles` et les boucles Python (`build_geometry`, `_merge_near_polygons`, empreintes) ; `Limits::unlimited()` = chemin de parité inchangé ; garde de profondeur 32 côté Rust ; refus serveur en champ additif `importRefusal`, tag `1k_entity_count` conservé |

**Le verrou « arbre de vie refusé dans les deux importeurs » était faux, et
c'est le mien** : je l'avais écrit en tenant ce fichier pour lourd alors
que le navigateur le lit en 1,5 s. L'objectif du §9.1 tranche, le verrou
est retiré. Le plafond d'entités (propriété du fichier) est identique des
deux côtés : c'est cela, le « même comportement ».

**Arbitrage du §9.5.4 : option (b), inscrite dans le code.** Un budget de
temps est une propriété de l'implémentation, donc il se règle par
implémentation : **navigateur 20 s** (un onglet qui attend), **serveur
60 s** (un worker asynchrone, personne ne regarde l'horloge). Raisons
chiffrées : (1) un fichier réel du propriétaire régresse à 20 s, et le
verdict est à la limite — sur mon poste le fichier à 1 648 splines passe à
20,6 s, sur celui de l'implémenteur à 20,3 s : un seuil qui bascule avec
la charge de la machine n'est pas un seuil de produit ; (2) à 60 s, plus
aucun refus de temps côté serveur sur les 238 fichiers (le plus lent hors
ces deux-là est à 8,7 s), et le message « essayez Nos serveurs » devient
vrai pour les trois fichiers en désaccord ; (3) le lot 2d supprime la cause
(`body.buffer` sorti de la boucle des empreintes) et ramènera les deux
côtés sous 10 s — 60 s est une marge, pas un objectif. La valeur vit dans
le **code** (`TIME_BUDGET_S_DEFAULT = 60` dans
`workers/fileprocessing/core/import_budget.py`) et dans `docker-compose.yml`
(`IMPORT_TIME_BUDGET_S: 60`), pas dans une seule ligne d'environnement
qu'un compose oublié ferait retomber à 20.

**Constat pour le lot 2c, hors GO** : un fichier garé par le serveur
(`worker_tag: 1k_entity_count`) n'est lu par aucun code de `app/` ni de
`server/` — l'utilisateur ne voit ni la cause ni le nombre, et un refus de
temps s'affiche comme un refus d'entités. Le champ `importRefusal` est
prêt ; le lot 2c le porte jusqu'à la fiche fichier avec le message qui
correspond à `reason`.

**GO déploiement** après le commit d'arbitrage (une valeur, un test, la
ligne de compose) : app + wasm géométrie + worker fileprocessing dans la
même fenêtre ; moteur inchangé → pas de benchmarks à régénérer ; le homelab
n'héberge pas de worker fileprocessing et l'image nesting n'a pas changé de
code → rien à y faire. Vérification après déploiement : un DXF de plus de
999 entités s'importe en navigateur sur la prod, et le refus de temps
affiche le nombre.

### Lot 2a — déploiement (implémenteur, 12/09, `cbacd63a`)

App + wasm géométrie (embarqué dans l'image app) + worker fileprocessing
dans la même fenêtre. Moteur inchangé : aucun benchmark public à régénérer
(`git diff` sur `workers/nesting` et `public/engine` vide sur ce lot), et le
homelab n'héberge que des workers nesting — rien à y faire.

| Contrôle | Résultat |
|---|---|
| images publiées | « Build and publish Docker images » **vert** sur `cbacd63a` ; app-ci **vert** ; geometry-locks **vert** sur `ae4d8cba` (dernier commit touchant `workers/geometry`) |
| compose de prod | sauvegardé (`docker-compose.yml.bak-lot2a-*`) puis aligné sur le dépôt — le seul écart mesuré était le bloc du lot (8 lignes) ; `docker compose config` valide |
| digests déployés | app `sha256:688d4fdd…`, worker fileprocessing `sha256:92ca2725…` |
| bornes actives dans le worker | `MAX_ENTITY_LIMIT=10000`, `IMPORT_TIME_BUDGET_S=60`, et les logs de démarrage les impriment : « Max entity limit set 10000 », « Import time budget set 60.0 » |
| wasm servi par la prod = dépôt (piège 14i) | `nest_geometry_bg.wasm` **`71a6272f…` identique**, `geometry.worker.js` **`057f5056…` identique** |
| le bundle SERVI PAR LA PROD, appelé comme le worker géométrie l'appelle | fichier réel de **1 841 entités : lu**, 133 pièces, 2,8 s (refusé avant le lot) ; fichier de **6 144 entités : lu**, 1,5 s ; fichier lourd : **refusé à 20,3 s** avec « 787 entities » dans le message |
| app vivante | `GET /` **200**, conteneurs `Up`, **0 ERROR/Traceback** dans les 200 dernières lignes du worker |

**Non-fait, dit franchement** : la vérification demandée « dans un
navigateur sur la prod » n'a pas été faite comme telle — l'import est
derrière `auth` et je n'ai pas de compte de production (en créer un est une
écriture de production, elle vous revient). À la place : (1) les fichiers
servis sont **octet pour octet** ceux du dépôt, (2) le bundle servi par la
prod rend les trois verdicts ci-dessus, et (3) le même code d'interface a
été vérifié **dans un vrai navigateur** sur l'image locale bâtie au même
commit — message affiché : « This file is too heavy for in-browser import
(787 entities, over 20 s) — try “Our servers”. ». Il reste à voir le
message sur la prod avec votre compte, si vous le voulez tracé.
### Lot 2b — les unités (implémenteur, 12/09)

Commit : `52871f48`. **Non déployé** — wasm géométrie et worker fileprocessing
touchés ; GO attendu.

#### 9.5.6 Ce qui était faux, mesuré avant d'écrire une ligne de correctif

| Défaut | Mesure |
|---|---|
| **table d'unités à sept codes** sur vingt-et-un | codes 3, 7, 10 à 20 absents des DEUX tables : un dessin déclaré en kilomètres, en yards ou en microns était lu **×1**, en silence — c'est-à-dire au millimètre |
| **`$INSUNITS` écrit en flottant** | notre propre exporteur DXF écrit `70` puis `4.0` ; le parse strict du Rust rendait `0` = « sans unité ». Conséquence : **notre export CAM en POUCES se relisait ×1 au lieu de ×25,4 dans notre propre navigateur** (c11 : code 0 côté wasm, code 1 côté ezdxf, qui tolère) |
| **le même flottant sur les autres codes entiers** | l'exporteur écrit aussi `70` (drapeau « fermée ») et `90` (nombre de sommets) en flottant : le drapeau tombait à faux et **nos exports CAM se relisaient à 0 pièce** (c08 : 0 contre 2 côté ezdxf ; c11 : 0 contre 3) |
| **deux vocabulaires pour la même mesure** | le coureur wasm disait `in` / `assumed-mm`, le coureur ezdxf `inch` / `unitless` : **38 lignes de « divergence » sur 238** dont 33 n'étaient que du vocabulaire — le bruit cachait les 5 vraies |

#### 9.5.7 Ce qui est livré

1. **Table complète 0-20, facteurs EXACTS**, identique des deux côtés
   (`nest-import::units`, `worker_common.geometry.units`). Exacts par
   définition (le pouce VAUT 25,4 mm), **pas** ceux de
   `ezdxf.units.METER_FACTOR` qui sont arrondis (1000/39,37007874 =
   25,400000000101603) — et ezdxf n'a de facteur ni pour le code 8
   (microinch) ni pour le 9 (mil).
2. **Entiers écrits en flottant acceptés** par les deux lecteurs :
   `$INSUNITS` et, côté Rust, les codes d'entité 62/70/71/72/73.
3. **Aucune unité supposée en silence** — trois constats, **mêmes textes des
   deux côtés** : `$INSUNITS missing or 0 — assuming millimeters`,
   `unknown $INSUNITS=N — assuming millimeters`, et
   `$INSUNITS=N (nom) — geometry scaled xF to mm` quand le facteur dépasse
   10 m par unité (km, hm, Mm, année-lumière…). La conversion reste exacte :
   une pièce de 80 mètres sort, mais plus sans explication.
4. **Noms d'unité canoniques partagés** (`inch`, `foot`, `km`, `yard`…) ; le
   coureur ezdxf tire désormais le nom de la PRODUCTION (`unit_name`) au lieu
   d'une table locale — un coureur qui redéfinit le vocabulaire ne mesure
   plus le produit.
5. **Notre exporteur DXF écrit les codes entiers en entiers**
   (`nest-export/dxf_writer.rs`) : la cause disparaît pour les fichiers que
   nous produisons désormais. **Rectification du 12/09** (écart relevé à la
   vérification) : la première version ne corrigeait que l'**en-tête**
   (`$INSUNITS`, `$MEASUREMENT`) ; toutes les entités et la table des calques
   passaient encore par le formateur flottant. Corrigé partout — LWPOLYLINE
   (90, 70), POLYLINE et VERTEX (70, 66), SPLINE (70, 71, 72, 73), les
   LWPOLYLINE synthétisés (BIN_BOUNDARY, OUT_SHAPE) et la table LAYER
   (70, 62) — avec un verrou qui lit la SORTIE et refuse tout point décimal
   après un code entier (`nest-export/tests/integer_group_codes.rs`, témoin
   négatif vérifié : remettre un seul `num(70, …)` le fait échouer en nommant
   la paire fautive). Ce que ça change : notre lecteur tolère le flottant
   depuis ce lot, mais un DXF exporté par NestorCut est lu par des CAM
   tiers — la spec fait de 62/70/90 des entiers.
6. Le golden de parité `units_unknown.dxf` (code 7) est **régénéré** avec le
   Python corrigé : l'ancien figeait le ×1 silencieux.

#### 9.5.8 Verrous du §9.2

| Verrou | Résultat |
|---|---|
| **parité wasm ≡ ezdxf sur `unitDetected` et `scaleApplied`, 238 fichiers** | **0 divergence** (38 avant le lot) |
| **les 8 fichiers réels sans unité portent l'avertissement** | **8/8** — et 28/28 sur les 238, des deux côtés, **au mot près le même texte** |
| **c59 (kilomètres) converti au bon facteur, jamais ×1** | **×1 000 000** des deux côtés (×1 avant), avec le constat « geometry scaled x1000000 to mm » |
| **nos exports CAM c08-c11 gardent leur unité** | c08/c09/c10 **mm**, c11 **inch ×25,4** (les quatre étaient « sans unité » côté navigateur). En prime, ils sont enfin **LUS** : **2, 2, 4, 3 pièces** — exactement les comptes d'ezdxf (0, 2, 1, 0 avant) |
| accord des deux importeurs (pièces ET trous) sur le corpus versionné | **62/70 → 66/72** ; sur les 153 réels, inchangé à 139/149 (aucun de ces fichiers ne vient de notre exporteur) |
| **seed canonique du flux navigateur inchangé** (§9.3) | `6825704941837900974` **identique** avant et après le lot sur les deux DXF du harnais |
| handles canoniques (§9.3) | `handles_canonical` **14/14**, sweep corpus inchangé |
| parité golden | **100 %** (63 bit-identiques + 2 error-parity + 2 metrics-ok ; seuil 99 %) |
| déterminisme natif ≡ wasm | **68/68** et **17/17**, tolérance 0 |
| suites | cargo geometry **109** (106 + 3), vitest **526**, pytest fileprocessing **42**, pytest common **64** (48 + 16) |
| harnais navigateur, deux configurations | **900/900** placées aux deux espacements, `spacingOk`, 0 doublon, calcul 24 s, mur 39,5 s |

**Comptes des deux coureurs, 153 réels** : wasm 150 lus → **142 lus + 9
« réparés »** (les constats d'unité font passer un fichier de « lu sans rien
supposer » à « lu avec un constat » — c'est le but), refusés **inchangés à
2** ; ezdxf 103/48/2 → **101/50/2**. Sur les 85 versionnés : wasm refusés
**13 → 11** (c08 et c11 deviennent lisibles).

#### 9.5.9 Non-faits et écarts

1. **`exports_check.py` et `client-server-diff` n'ont pas tourné sur mon
   poste** : ils veulent ezdxf/shapely côté hôte et des CLI natifs Linux. Ils
   tournent en CI (`geometry-locks`) sur ce commit — c'est le verdict à
   retenir pour le changement d'exporteur (le DXF y est comparé
   sémantiquement, entité par entité, pas octet à octet).
2. **Le fichier en kilomètres produit maintenant une pièce de 80 m × 40 m**,
   que le nesting refusera (aucune tôle). C'est voulu : le fichier le déclare.
   Ce qui manque, c'est que l'utilisateur LISE le constat — le porter jusqu'à
   la fiche fichier est le lot 2c, et le champ est déjà là.
3. **Le seuil « unité invraisemblable » (10 m par unité) est une décision de
   ma part.** Il ne change aucune conversion : il décide seulement quand un
   constat est émis. En dessous (pouce, pied, cm, m, dm, yard, micron), rien
   n'est dit — l'unité est déclarée et la conversion exacte.
4. **Les codes 21 à 24** (unités « US survey ») restent hors table, comme
   chez ezdxf : facteur 1 + constat « code inconnu ». Le §9.2 demandait 0 à 20.
5. Mon erreur du lot : j'ai mesuré les 238 fichiers avec un **bundle wasm
   d'avant le correctif des codes entiers** (rebuild oublié après la dernière
   modification Rust). Les chiffres de c08/c10/c11 étaient inchangés, ce qui
   ne collait pas avec le CLI natif — c'est cet écart qui a révélé l'oubli.
   Bundle reconstruit, corpus rejoué, chiffres ci-dessus.

### Lot 2b — vérification (vérificateur, 12/09, `53a17eb8`) — GO, un écart à corriger avant le déploiement

Rejoué sur le poste : image fileprocessing reconstruite à HEAD, bundle wasm
servi par l'app locale bit-identique à celui du commit (`1aca2874…`),
sorties brutes hors dépôt (`~/qa-out/verif-2b/`, deux coureurs × deux
corpus, harnais).

| Verrou | Résultat |
|---|---|
| cargo geometry release | 109, 0 échec |
| vitest | 526 |
| parité golden | 100 % (63 + 2 + 2, seuil 99 %) |
| déterminisme natif ≡ wasm | 68/68 et 17/17, tolérance 0 |
| **parité des unités wasm ≡ ezdxf** (`unitDetected`, `scaleApplied`) | **0 divergence** sur tous les fichiers lus des deux côtés (151 réels + 85 versionnés) ; les trois seules lignes différentes sont des fichiers refusés d'un côté (champs nuls), pas des unités |
| **8 fichiers réels sans unité** | **8/8** portent `$INSUNITS missing or 0 — assuming millimeters`, **au mot près le même texte** des deux côtés ; corpus versionné : 19/19 lus des deux côtés, même texte |
| **c59 (kilomètres)** | **×1 000 000** des deux côtés, constat `$INSUNITS=7 (km) — geometry scaled x1000000 to mm` |
| **exports CAM c08-c11** | mm, mm, mm, pouce ×25,4 ; **2, 2, 4, 3 pièces**, identiques à ezdxf |
| autres codes | c53 cm ×10, c54 pied ×304,8, c57 mil ×0,0254 — identiques des deux côtés |
| statuts, 153 réels | wasm 141 lus + 9 réparés + 2 refusés (8 fichiers passés « lu → réparé » = le constat d'unité, voulu) ; ezdxf 101 / 50 / 2, **0 refus de temps** à 60 s ; **0 dérive** pièces/trous sur les 150 lus des deux campagnes |
| statuts, 85 versionnés | wasm refusés 13 → **11** (c08 et c11 lisibles) ; ezdxf 46 / 26 / 13 |
| **seed canonique du navigateur** | `6825704941837900974` identique au lot 2a (harnais espacement 2) |
| harnais navigateur, espacement 2 | 900/900, `spacingOk` vrai, 0 doublon, `verifyStatus: measured`, calcul 15 s |
| lecture du code | tables 0-20 identiques aux facteurs exacts (`nest-import::units`, `worker_common.geometry.units`), `dxf_utils.read_dxf_file` passe bien par la table partagée ; lecteur Rust tolérant au flottant sur 62/70/71/72/73 |

**Un écart entre le rapport et le code, à corriger avant le déploiement.**
Le §9.5.7 (point 5) et le commentaire de `entities.rs` disent que
« l'exporteur écrit ses entiers en entiers ». Ce n'est vrai que pour
l'en-tête (`$INSUNITS`, `$MEASUREMENT`, deux appels `int_grp`). Toutes les
entités passent encore par `num(…)`, donc par `py_str`, qui écrit `1.0` :
`dxf_writer.rs` lignes 67-68 (LWPOLYLINE 90 et 70), 82, 89, 146, 270-271,
295-296 et 327 (table LAYER 70 et 62). Le lecteur wasm ne le voit plus
parce qu'il tolère désormais le flottant — mais un DXF exporté par
NestorCut est lu par des CAM tiers (SheetCam chez le propriétaire), et la
spécification DXF fait de 62/70/90 des entiers : un `70\n1.0` est un
fichier hors norme que nous produisons encore. Correctif : `int_grp` sur
tous les codes entiers de l'exporteur, un verrou cargo qui refuse tout
point décimal après un code 62/70/71/72/73/90 dans la sortie, `exports-parity`
en CI (la géométrie ne change pas) ; corriger la phrase du rapport et le
commentaire.

**Accepté tel quel** : les codes 21-24 hors table (le §9.2 demandait 0-20)
; le seuil « unité invraisemblable » à 10 m par unité (il ne change aucune
conversion, seulement l'émission d'un constat) ; le fichier en kilomètres
qui devient une pièce de 80 m (c'est ce que le fichier déclare ; le lot 2c
porte le constat jusqu'à la fiche).

**GO déploiement** après ce commit : app + wasm géométrie + worker
fileprocessing (et worker nesting si `worker_common` embarqué y change —
`units.py` est dans `worker_common`, donc oui : les deux images worker,
homelab compris pour l'image nesting) ; moteur inchangé → pas de
benchmarks à régénérer.

### Lot 2b — déploiement (implémenteur, 12/09, `c84b0842`)

App + wasm géométrie + **les deux images worker** — `worker_common/geometry/
units.py` est embarqué par le worker fileprocessing ET par le worker nesting
(vérifié dans l'image : l'ancienne table à 7 codes y était bien présente) —
donc **homelab compris**. Moteur inchangé : aucun benchmark public à
régénérer.

| Contrôle | Résultat |
|---|---|
| CI sur le commit | `geometry-locks` **vert** : **exports-parity ✓** (le DXF exporté est comparé entité par entité au Python — les codes entiers ne changent pas la géométrie), client-server-diff ✓, parity ✓, determinism ✓, cargo-tests ✓. Images publiées ✓ |
| Hetzner | `app`, `user-file-processing-worker` et `nesting-worker` tirés et recréés **dans la même fenêtre** ; digests `47f4dfca…`, `77a43274…`, `1836199b…` |
| **table d'unités active en production** | les DEUX workers répondent **20 codes, km = 1 000 000** (7 codes, km absent avant) |
| bornes d'import toujours actives (lot 2a) | logs du worker : `max_entity_limit 10000`, `import_time_budget_s 60.0` |
| wasm servi par la prod = dépôt (piège 14i) | `1aca2874…` **identique** ; `GET /` **200** |
| **le bundle SERVI PAR LA PROD, sur les témoins d'unité** | notre export CAM en pouces : **code 1, 3 pièces** (« sans unité », 0 pièce avant le lot) ; export mm : **2 pièces** (0 avant) ; kilomètres : converti avec le constat `$INSUNITS=7 (km) — geometry scaled x1000000 to mm` ; sans unité : constat `$INSUNITS missing or 0 — assuming millimeters` |
| homelab | 3 workers overflow tirés et recréés ; **`ASSERT OVERFLOW=HEAD: OK`** (md5 des fichiers clés = HEAD, binaire moteur du 12/09) |

**Non-fait, le même qu'au lot 2a** : pas de capture dans un navigateur sur
la prod (l'import est derrière `auth`, et je n'ai pas de compte de
production — en créer un est une écriture de production, elle vous revient).
Ce qui est vérifié à la place : les fichiers servis sont octet pour octet
ceux du dépôt, et le bundle servi rend les verdicts ci-dessus sur les
témoins d'unité.
