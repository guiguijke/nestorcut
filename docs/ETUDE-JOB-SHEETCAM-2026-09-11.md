# Étude — nester directement un fichier `.job` SheetCam (Phase 0 faite à la main, 11/09)

Contexte : mission « nesting de fichiers cut-ready » (école toolpath,
terrain PlasmaSpider). Question du propriétaire : peut-on décortiquer et
réécrire un `.job` SheetCam ? Réponse : **oui, de bout en bout**, et c'est
la meilleure lane, meilleure que le DXF de toolpath. Tous les essais ont
été faits avec SheetCam TNG Development (`FileVersion=1003`) sur les
fichiers privés de `.testparts/` (gitignoré). Aucun code produit écrit.

## 1. Ce qu'est un `.job`

Fichier **texte INI** (sections `[…]`, fins de ligne CRLF) suivi d'un bloc
binaire après `[BinaryDataStart]`.

| Section | Contenu |
|---|---|
| `[Misc]` | `FileVersion`, `Count` = nombre de pièces (originaux + copies), `Optimisation` = mode d'ordre de coupe du job |
| `[OpOrder]` | ordre de coupe explicite : `Op000000=<pièce>,<opération>`, une ligne par pas |
| `[Part N]` | `DrawingFile` (chemin absolu du DXF), `XPos`, `YPos`, `Angle`, `HRef`/`VRef`, `copyOf`, `name`, `enabled`, `Locked` |
| `[Part N/OperationK]` | l'opération : type, `Contour method`, `Lead in`/`Lead out`, calque, outil, `Optimisation`, `Cutting rules` |
| `[Tool0]` | outil (`PlasmaTool`, `Kerf width`, vitesses, perçage) |
| `[Work]` / `[Table]` | tôle et table |
| `[pathRules]`, `[Work/keepout]` | règles, zones interdites |
| `[BinaryDataStart]` | géométrie en cache des dessins **originaux**, au rang des sections `[Part]` d'origine (1 770 octets pour un dessin, 2 700 pour deux) ; seuls deux octets de drapeaux par pièce y bougent quand on change des options |

## 2. Règles acquises par l'expérience (chaque ligne = un essai fait)

1. **La pose vit dans le texte.** Déplacer et tourner une pièce dans
   SheetCam ne change que `XPos`, `YPos`, `Angle` ; le bloc binaire est
   identique à l'octet près.
2. **Angle en radians, positif = sens horaire.**
3. **`XPos`, `YPos` = centre de la boîte englobante de la pièce posée.**
   Pour une pose moteur (rotation trigonométrique θ autour de l'origine du
   dessin, translation t), avec `c` le centre de boîte du dessin non
   tourné : `XPos, YPos = t + R(θ)·c` et `Angle = −θ`. Validé : le fichier
   généré par la formule est identique au moulinet posé à la main.
4. **Les copies se font par `copyOf`** (`[Part N]` avec `copyOf = rang de
   l'original`, une seule section, pas d'opération propre) : SheetCam les
   affiche « Duplicate n », leur applique opérations et amorces de
   l'original, ajoute lui-même `[Part N/GroupSources]`. `Count` doit suivre.
5. **Pas de pièce inventée** hors de SheetCam (« Layer 0 not found ») : sa
   géométrie n'est pas dans le bloc binaire. Écrire le binaire = hors
   périmètre.
6. **Les originaux ne se réordonnent pas** : le bloc binaire est associé
   aux sections par **rang**. Les déplacer échange les géométries.
7. **Renommer une copie ne tient pas** (SheetCam réécrit « Duplicate n »).
   Renommer un original tient.
8. **L'ordre de coupe ne suit ni la liste ni la géométrie** : l'optimiseur
   de trajet a coupé un éventail, le contour extérieur de l'hôte, le trou,
   puis les trois autres éventails. Il s'impose par **`[Misc]
   Optimisation=3`** (« Manual optimisation, keep parts together ») et la
   section **`[OpOrder]`** listant `pièce,opération` dans l'ordre voulu :
   pièces nichées d'abord, hôte en dernier. Vérifié par le propriétaire :
   l'ordre est respecté.
9. Un `.job` déposé chez nous contient un **chemin absolu** vers le disque
   de l'utilisateur : à masquer côté produit.

## 3. Flux produit (proposition)

1. L'utilisateur prépare son job dans SheetCam comme d'habitude : une pièce
   de chaque dessin, ses opérations, ses amorces, son outil, sa tôle.
2. Il dépose le `.job` et les quantités. On lit tôle (`[Work]`), kerf
   (`Tool0`), dessins référencés (géométrie prise dans les DXF importés chez
   nous, ou dans `DrawingFile` s'il est joint), poses actuelles.
3. Notre moteur neste ; les poses sont converties par la règle 3.
4. On réécrit le `.job` : originaux à leur rang avec leur nouvelle pose, un
   `[Part N]` `copyOf` par exemplaire supplémentaire, `Count`,
   `Optimisation=3` et `[OpOrder]` (pièces nichées puis hôtes, tôle par
   tôle), bloc binaire recopié tel quel, chemins masqués.
5. SheetCam rouvre le fichier et génère le G-code avec **ses** amorces et
   **son** kerf : aucun double offset, rien de perdu, ordre de coupe garanti.

Démonstration complète faite : quatre éventails nestés dans le trou d'une
autre pièce, générés par la formule, relus par SheetCam avec ses amorces et
coupés dans le bon ordre. **Confirmé par le propriétaire le 11/09 soir** sur
le fichier entièrement généré (`Piece_Trou+Fill_x4_final_TEST.job`, privé) :
poses, copies, `Optimisation=3`, `[OpOrder]` — « parfait ».

## 4. Reste à vérifier (non bloquant pour ouvrir la Phase 1)

- Miroir `HRef`/`VRef` sur une pièce non symétrique ; angle quelconque
  (30°) ; plusieurs opérations par pièce (trou intérieur + contour) dans
  `[OpOrder]` ; `DrawingFile` absent au chemin indiqué ; un `.job` d'une
  version **stable** de SheetCam (mêmes clés que TNG ?) ; multi-tôles
  (un job par tôle, ou `[Work]` multiple ?).

## 5. Décision sur la mission « cut-ready »

- Lane recommandée : **réécriture du `.job`** (règles 1-9). Le DXF de
  toolpath devient secondaire : double offset au ré-import, amorces en
  lignes ouvertes que notre importeur jette aujourd'hui (priorité 3).
- Décodage du bloc binaire : hors périmètre.
- Place dans les priorités : **décision propriétaire du 11/09 soir : juste
  après le sujet en cours**, donc priorité 3, après les réparations
  d'import et avant la couture des contours.

## 6. Consigne de Phase 1 (fermée, prête à envoyer)

**Objectif** : un utilisateur SheetCam dépose son `.job` (une pièce de
chaque dessin, opérations faites) et ses quantités, et récupère un `.job`
nesté qu'il ouvre tel quel dans SheetCam, avec ses amorces, son kerf et
l'ordre de coupe garanti.

**Périmètre** (un seul code, côté navigateur d'abord, serveur ensuite si
utile) :

1. `shared/sheetcamJob.js` : lecteur/écrivain du texte INI (CRLF, sections,
   ordre préservé, bloc binaire recopié en octets) ; lit `[Work]`,
   `[Tool0].Kerf width`, `[Part N]` (dessin, pose, `copyOf`, miroirs) ;
   écrit poses, copies `copyOf`, `Count`, `Optimisation=3`, `[OpOrder]`.
   Refuse tout `.job` dont `FileVersion` est inconnu (liste blanche : 1003
   + les versions mesurées au §4) avec un message clair.
2. Conversion de pose (règle 3) avec le centre de boîte calculé sur les
   anneaux importés chez nous ; miroirs après vérification §4.
3. Import : le `.job` seul ne suffit pas (géométrie dans le binaire) →
   l'utilisateur dépose le `.job` **et ses DXF**, appariés par nom de
   fichier ; un DXF manquant est dit, jamais deviné.
4. Ordre de coupe : `[OpOrder]` = pour chaque tôle, pièces nichées (par
   profondeur décroissante) puis hôtes ; les pièces d'un même hôte
   groupées.
5. UI : sur la page projet, dépôt d'un `.job` = pré-remplissage de la tôle,
   de l'espacement (kerf de l'outil + sécurité) et des quantités ; bouton
   « Télécharger le .job nesté » à côté des DXF. Chemins absolus masqués
   (`DrawingFile` réécrit en nom de fichier seul).
6. Hors périmètre : écriture du bloc binaire, DXF de toolpath, `.job`
   multi-tôles (un `.job` par tôle en v1).

**Verrous** : fixture `Piece_Trou+Fill` (privée, copie anonymisée dans les
tests) : le `.job` écrit par le code est **identique** au fichier généré
par la formule du 11/09 hors horodatage ; ouverture SheetCam sur trois
jobs réels du propriétaire (captures + ordre de coupe numéroté) ; test de
lecture/écriture sans perte (lire → écrire = octets identiques hors
sections modifiées) ; vitest ; harnais inchangé (aucun effet sur le
nesting).

**Effort** : lecteur/écrivain 2 j, conversion et copies 1 j, UI 2 j,
verrous et jobs réels 1 j — 6 à 8 jours.

## 7. Réponses aux questions du propriétaire (11/09 soir) et ce qu'elles ajoutent à la Phase 1

| Question | Ce que le `.job` donne | Ce qu'on fait |
|---|---|---|
| Kerf et distance entre pièces | `Kerf width` de l'outil, par opération | pré-remplir nos deux champs : espacement = kerf + 2 × sécurité (règle 3.10 déjà en prod) |
| Détecter les amorces | **longueur et type** (`Lead in`, `Lead in type`, idem out) par opération, et le coin de départ (`Start position`) ; **pas la géométrie**, dessinée par SheetCam au G-code | **prédire** : point de départ probable selon `Start position`, amorce de la longueur lue ; réserver la place dans la géométrie nestée (chantier 3.5 « réserve d'amorce », ici sur son vrai terrain) |
| Cercle de perçage paramétrable | rien (le trou de perçage n'est pas modélisé par SheetCam) | disque de rayon `pierceMarginMm` (réglage utilisateur, défaut à caler plasma) au point de perçage = début de l'amorce prédite, soudé à la géométrie nestée ; le moteur neste un polygone un peu plus grand, il ne change pas |
| Dessiner tout ça dans l'aperçu couleur | contour + kerf + amorces prédites + disque | rendu SVG : contour brut, trajet offset kerf/2, amorce prédite, disque de perçage, avec la mention « prédiction, SheetCam pose l'amorce » |
| Coupe commune | **non** par le `.job` seul : une grappe est une nouvelle géométrie, donc un bloc binaire | détour : NestorCut exporte le **DXF de la grappe** (contour fusionné, arêtes partagées sur un calque dédié), l'utilisateur l'importe dans SheetCam et assigne au calque partagé une opération **sans offset** ; la grappe se neste ensuite comme une pièce. C'est le chantier 3.7 avec SheetCam pour les opérations |

**Ajouts à la consigne de Phase 1 (§6)** : point 2 bis, réserve d'amorce +
disque de perçage soudés à la géométrie nestée pour les jobs `.job`
(paramètres lus dans le `.job`, `pierceMarginMm` réglable, défaut 3 mm à
confirmer par le propriétaire sur sa machine) ; point 5 bis, aperçu
couleur enrichi (trajet kerf/2, amorce prédite, disque). Effort +2 à 3 j,
soit **8 à 11 jours** au total. La coupe commune reste le chantier 3.7,
non inclus.

## 8. Prompt de mission pour l'implémenteur (forme §8 du masterplan) — à envoyer tel quel

> **Mission : « Nester un fichier .job SheetCam » (priorité 3, après les réparations d'import de `PLAN-IMPORT` §9).**
>
> **Lis d'abord** `docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` en entier : les neuf règles du §2 sont des faits mesurés, pas des hypothèses ; le flux du §3 est la cible ; le §7 fixe le kerf, les amorces, le disque de perçage et l'aperçu.
>
> **Objectif** : un utilisateur SheetCam dépose son `.job` (une pièce de chaque dessin, opérations faites) et les DXF correspondants, donne ses quantités, lance le nesting, et télécharge un `.job` nesté qu'il ouvre tel quel dans SheetCam : mêmes opérations, mêmes amorces, kerf de l'outil, ordre de coupe garanti (pièces nichées avant leur hôte), aucun double offset.
>
> **Périmètre fermé, un commit par lot, un rapport par lot en §9 de l'étude.**
>
> Lot J1 — lecteur/écrivain. `shared/sheetcamJob.js` (un seul code, utilisé par le navigateur et par le serveur) : parse le texte INI (CRLF, sections dans l'ordre, valeurs en chaînes), conserve le bloc `[BinaryDataStart]` en octets sans le décoder ; expose tôle (`[Work]` X1/X2/Y1/Y2), kerf (`[Tool0].Kerf width`), pièces (`[Part N]` : `DrawingFile`, `XPos`, `YPos`, `Angle`, `HRef`, `VRef`, `copyOf`, `name`), opérations (`Lead in`, `Lead out`, types, `Start position`) ; écrit poses, copies `copyOf`, `Count`, `[Misc] Optimisation=3`, `[OpOrder]`, `DrawingFile` réduit au nom de fichier. Refus avec message si `FileVersion` n'est pas dans la liste blanche (1003). Verrou : lire puis écrire sans modification = octets identiques ; sur la fixture anonymisée (copie de `Piece_Trou+Fill`), le fichier produit pour le moulinet ×4 est identique au fichier de référence du 11/09 hors valeurs flottantes à 1e−9.
>
> Lot J2 — conversion de pose et ordre. Règle 3 : `XPos, YPos = t + R(θ)·c`, `Angle = −θ` (radians, horaire), `c` = centre de boîte du dessin non tourné, calculé sur les anneaux importés chez nous. Copies : une section `[Part N]` `copyOf` par exemplaire au-delà du premier, originaux jamais déplacés de rang. `[OpOrder]` : par tôle, pièces nichées par profondeur décroissante, puis hôtes ; les pièces d'un même hôte groupées. Miroir : `HRef`/`VRef` seulement après un essai SheetCam sur une pièce non symétrique (résultat au rapport) ; sinon, pas de miroir en v1 (rotations seules). Verrous : test unitaire de la conversion sur les quatre poses du moulinet ; un `.job` à deux tôles = deux fichiers `.job` en v1.
>
> Lot J3 — géométrie nestée « cut-ready ». Pour un job issu d'un `.job` : espacement pré-rempli = kerf de l'outil + 2 × sécurité (champs existants) ; **réserve d'amorce** = amorce prédite (longueur et type lus, départ selon `Start position`) + **disque de perçage** de rayon `pierceMarginMm` (réglage utilisateur, défaut 3 mm, à confirmer par le propriétaire) soudés au polygone nesté, comme le prévoit 3.5 du masterplan ; le moteur ne change pas. Verrous : aucune paire sous l'espacement entre la réserve d'une pièce et ses voisines sur la démo ; déterminisme natif ≡ wasm intact ; harnais deux configurations inchangé pour les jobs sans `.job`.
>
> Lot J4 — interface. Page projet : dépôt d'un `.job` avec ses DXF appariés par nom (DXF manquant = message, jamais deviné), quantités, tôle et espacement pré-remplis ; aperçu couleur enrichi : contour, trajet à kerf/2, amorce prédite, disque de perçage, mention « prédiction, SheetCam pose l'amorce » ; bouton « Télécharger le .job nesté » à côté des DXF ; chemins absolus jamais affichés ni conservés. Captures FR/EN, deux thèmes ; axe 0 violation.
>
> **Invariants** : `sa.rs`, `constructive.rs`, `spp.rs` intacts ; aucun décodage du bloc binaire ; aucune pièce créée hors de SheetCam ; aucun nom de fichier réel du propriétaire dans `docs/` ; le seed canonique des jobs sans `.job` ne change pas.
>
> **Recette** : trois `.job` réels du propriétaire (SheetCam TNG et, si disponible, une version stable), ouverts dans SheetCam après nesting, captures et ordre de coupe numéroté ; vitest ; harnais ; rapport constat par constat, non-faits énoncés, hashes réels. GO du vérificateur avant déploiement (app + wasm, worker si le serveur est touché).
>
> **Pas de décision ouverte** : toute question (miroir, multi-tôles, valeur du disque, version SheetCam) = une option chiffrée proposée, puis attente.

## 9. Rapports par lot

### Lot J1 — lecteur / écrivain de `.job` (implémenteur, 13/09)

Livré : `shared/sheetcamJob.js` (un seul code, navigateur et serveur — aucune
dépendance Node, entrée et sortie en `Uint8Array`), deux fixtures anonymisées
(`app/tests/fixtures/sheetcam/{source,x4-reference}.job`) et
`app/tests/sheetcamJob.test.js` (**18 verrous**). Un commit. Aucun octet du
bloc binaire n'est décodé, aucune pièce n'est inventée, le moteur n'est pas
touché.

#### 9.1 Ce que le format impose, mesuré avant d'écrire une ligne

Cinq faits pris sur les quatorze `.job` réels — chacun casserait le fichier
s'il était deviné de travers :

| Fait mesuré | Conséquence dans le code |
|---|---|
| le fichier commence par une entrée **hors section** (`Config=`) | un parseur qui exige une section en tête perd la ligne ; le modèle accepte les entrées de tête |
| `[BinaryDataStart]` **n'est PAS suivi d'un CRLF** : les octets commencent après le crochet | le sérialiseur colle le bloc au marqueur ; un saut de ligne ici décale tout le cache géométrique de SheetCam |
| l'ordre des sections n'est **ni alphabétique sensible, ni insensible** à la casse (`[pathRules]` vient après `[Part 4]` et avant `[Table]`) | on ne recalcule JAMAIS l'ordre : on préserve celui lu, et une section `[Part N]` neuve s'insère après la dernière section `Part …` — ce qui reproduit la référence à l'octet près |
| les nombres sont au format **`%.15g`** (`-1.5707963267949` pour −π/2, `66.828` sans zéros de queue) | `formatJobNumber` implémente `%.15g`, bascule exponentielle comprise |
| la référence porte **`Angle=-0`** | `String(-0)` rend « 0 » en JavaScript : sans traitement explicite du zéro négatif, le fichier rendu diffère d'un octet et le verrou du ×4 tombe. C'est le contrôle négatif du §9.3 |

Le texte est traité en **latin-1** (un octet = un point de code). Ce n'est pas
une hypothèse sur l'encodage de SheetCam : c'est le seul moyen de garantir que
« lire puis écrire » rende les mêmes octets quel que soit l'encodage réel des
noms. Un appelant qui veut AFFICHER un nom le décode à sa frontière (même
discipline que les unités, AGENTS #25).

#### 9.2 Ce que le module expose

- **lecture** : `parseSheetCamJob(bytes)` → version, `Count`,
  `Optimisation`, tôle (`[Work]` X1/X2/Y1/Y2 + épaisseur), kerf
  (`[Tool0].Kerf width`) et nom d'outil, pièces (`DrawingFile` + nom de
  fichier seul, `XPos`, `YPos`, `Angle`, `HRef`, `VRef`, `copyOf`, `name`,
  `enabled`, `Locked`, `DrawingDate`) et, par pièce, ses opérations avec
  **longueur et type d'amorce** (`Lead in`/`out` + types) et `Start
  position` — ce que le lot J3 utilisera pour PRÉDIRE la réserve d'amorce
  (la géométrie de l'amorce n'est pas dans le fichier, §7) ;
  `jobSheet(job)` rend largeur et hauteur ; `jobDrawingName` réduit un
  chemin au nom de fichier (règle 9).
- **écriture** : `writeNestedSheetCamJob(job, { placements, order,
  maskPaths })`. Le PREMIER exemplaire d'un original réécrit sa section — le
  rang, donc le lien vers le bloc binaire, est conservé (règle 6) ; les
  exemplaires suivants deviennent des sections `copyOf` (règle 4), avec les
  mêmes clés dans le même ordre que SheetCam ; `Count` suit ;
  `[Misc] Optimisation=3` et `[OpOrder]` sont posés dès qu'un ordre est
  donné (règle 8) ; `DrawingFile` est réduit au nom de fichier par défaut
  (règle 9).
- **refus** plutôt que devinette : pas d'octets (`notBytes`), pas de bloc
  binaire (`noBinaryBlock`), version hors liste blanche
  (`unsupportedVersion`, avec la version lue et la liste), aucune pièce
  (`noParts`), aucune pose (`noPlacements`), pose visant une pièce absente
  (`unknownPart`). Chaque erreur porte un **code i18n** et ses paramètres —
  le libellé sera posé au lot J4, pas un message technique à l'écran.

**Décision de forme, à valider** : une pièce que le nesting n'a pas posée
n'est **pas supprimée** — sa section porte le rang qui lie le bloc binaire, la
retirer échangerait les géométries (règle 6). Elle est mise à `enabled=0`.
C'est le choix le plus sûr ; si le propriétaire préfère qu'un job partiel
refuse d'être écrit, c'est une ligne à changer.

#### 9.3 Verrous

| Verrou | Résultat |
|---|---|
| lire → écrire = **octets identiques**, fixtures anonymisées | **2/2** |
| lire → écrire = **octets identiques**, `.job` RÉELS du propriétaire | **14/14** (le test le dit s'il ne trouve pas le dossier privé : il ne passe pas pour vert sans avoir mesuré) |
| **moulinet ×4** : fichier produit = référence du 11/09 | **identique** — texte, bloc binaire, et donc le fichier entier ; aucune tolérance nécessaire, pas même 1e−9 |
| `Count`, `copyOf`, `Optimisation=3`, `[OpOrder]` | 5, `[-1, -1, 1, 1, 1]`, 3, `Op000000=1,0 … Op000004=0,0` (nichées puis hôte) |
| rangs des originaux inchangés | `Piece_Trou`, `Piece_Fillx4` toujours aux rangs 0 et 1 |
| chemins masqués quand demandé | les cinq `DrawingFile` deviennent `Piece_Trou.DXF` / `Piece_Fillx4.DXF`, plus aucun `C:\…` dans le texte |
| **contrôle négatif** | une seule pose fausse (angle `0` au lieu de `-0`) et le verrou tombe, avec pour UNIQUE écart la ligne `Angle=0` — le verrou est donc sensible, et le zéro négatif est un vrai fait du format |
| `%.15g` | −π/2, −π, −3π/2, `66.828`, `50.41421356235`, bascule `1e-05` / `1e+16`, refus de l'infini et du non-nombre |
| `npx vitest run` | ****56 fichiers, 609 tests verts** (18 de plus, tous du lot J1)** |

#### 9.4 Non-faits, dits franchement

1. **Aucun fichier produit par ce code n'a encore été ouvert dans
   SheetCam.** Le verrou est l'égalité avec un fichier que le propriétaire a
   déjà ouvert et validé le 11/09 (« parfait ») — c'est fort, mais ce n'est
   pas un essai machine. La recette du §8 (trois `.job` réels ouverts dans
   SheetCam, ordre de coupe numéroté) reste à faire, et elle demande le
   poste du propriétaire.
2. **Rien n'est branché au produit** : ni dépôt de `.job`, ni conversion de
   pose, ni bouton de téléchargement. C'est le périmètre des lots J2 à J4 ;
   J1 ne change aucun comportement existant (le module n'a encore aucun
   appelant).
3. Les fixtures sont **anonymisées par le chemin seulement** : le préfixe
   absolu du disque du propriétaire est remplacé par `C:\jobs\`. Les noms
   de dessin (`Piece_Trou.DXF`, `Piece_Fillx4.DXF`) sont des fixtures
   historiques du dépôt, déjà nommées dans cette étude — sans eux la fixture
   ne veut plus rien dire.
4. Les questions ouvertes du §4 (miroir `HRef`/`VRef` sur une pièce non
   symétrique, version stable de SheetCam, multi-tôles) restent ouvertes :
   J1 LIT et ÉCRIT ces champs, il ne décide pas de leur sémantique.
