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

### Lot J1 — vérification (vérificateur, 13/09, `85678862`) — GO, J2 peut s'ouvrir

Rejoué sur le poste, hors des tests du dépôt (script à part chargeant
`shared/sheetcamJob.js`) :

| Verrou | Résultat |
|---|---|
| lire → écrire, **les 14 `.job` privés** de `.testparts/` | **14/14 octets identiques** |
| moulinet ×4 depuis `Piece_Trou+Fill.job` (cinq poses, `[OpOrder]` nichées puis hôte, `maskPaths:false`) | **identique octet pour octet** à `Piece_Trou+Fill_x4_final_TEST.job`, le fichier que le propriétaire a ouvert dans SheetCam le 11/09 (« parfait ») ; avec `maskPaths:true` le fichier diffère de 370 octets, ce sont les chemins réduits — attendu |
| lecture | version, `Count` 2, tôle 1000 × 1250, kerf 1,5, deux pièces avec leurs poses, noms de dessin réduits, une opération chacune |
| vitest | 609 |

**Décision de forme acceptée** : une pièce non posée reste dans le fichier à
`enabled=0` (le rang lie le bloc binaire, la retirer échangerait les
géométries). Non-fait maintenu : aucun fichier de ce code n'a été ouvert
DANS SheetCam ; l'égalité avec le fichier validé le 11/09 tient lieu de
preuve jusqu'à la recette du §8 sur le poste du propriétaire, à faire au
plus tard à la fin de J2 (premier fichier produit depuis un vrai nesting).


### Lot J2 — conversion de pose et ordre de coupe (implémenteur, 13/09)

Livré : `shared/sheetcamNest.js` (un seul code, aucune dépendance — il prend
des poses MOTEUR et rend des poses `.job`, puis appelle l'écrivain du lot J1)
et `app/tests/sheetcamNest.test.js` (**15 verrous**). Un commit. Le moteur
n'est pas touché ; le module n'a encore aucun appelant produit (c'est J4).

#### 9.5 La règle 3, et ce qu'elle a coûté à mesurer

Notre moteur pose une pièce par une rotation θ autour de l'origine DU DESSIN
puis une translation t : un point p arrive en `R(θ)·p + t` — c'est
exactement ce que fait l'export DXF (`z_rotate(angle) * translate(x, y)`).
SheetCam, lui, ne stocke pas de translation : `XPos`/`YPos` sont la position
du **centre de boîte de la pièce posée**, et `Angle` tourne dans l'autre
sens. D'où `XPos, YPos = t + R(θ)·c` et `Angle = −θ`, avec `c` le centre de
boîte du dessin non tourné.

Le fait qui rend la règle NON facultative, mesuré sur nos anneaux importés :

| dessin | boîte | centre `c` |
|---|---|---|
| `Piece_Trou` (l'hôte) | 100 × 100 | **(0 ; 0)** — centré sur l'origine |
| `Piece_Fillx4` (l'éventail) | 39,598 × 28 | **(0 ; 16,8284)** — PAS centré |

Sur l'éventail, ignorer `c` décale la pièce de `R(θ)·c − c`, soit **16,83 mm
à 180°** (et jusqu'à 33,7 mm d'écart entre deux exemplaires opposés). Un
verrou le mesure explicitement : la pose sans centre tombe à plus de 16 mm de
la référence, contre 0,4 µm pour la pose correcte.

#### 9.6 Le verrou central n'est pas une tautologie

On entre un jeu de poses **moteur** propre — `t = (50 ; 50)` pour les quatre
éventails, `θ = 0, π/2, π, 3π/2`, c'est-à-dire le pinwheel dans le trou de
l'hôte — plus les centres de boîte mesurés sur nos anneaux. Il doit en
sortir les quatre lignes du fichier que le propriétaire a ouvert dans
SheetCam le 11/09. C'est le cas :

| exemplaire | référence 11/09 | calculé depuis la pose moteur |
|---|---|---|
| éventail 1 | `XPos=50`, `YPos=66.828`, `Angle=-0` | 50 ; 66,8284 ; −0 |
| éventail 2 | `33.172` ; `50` ; `-1.5707963267949` | 33,1716 ; 50 ; −π/2 |
| éventail 3 | `50` ; `33.172` ; `-3.14159265358979` | 50 ; 33,1716 ; −π |
| éventail 4 | `66.828` ; `50` ; `-4.71238898038469` | 66,8284 ; 50 ; −3π/2 |
| hôte | `50` ; `50` ; `0` | 50 ; 50 ; −0 |

**L'écart est de 0,4 µm, et il vient de la RÉFÉRENCE, pas de notre calcul** :
le fichier du 11/09 a été généré avec un centre de boîte au millième
(16,828), alors que nos anneaux donnent 16,8284. La tolérance du verrou est
donc 0,0005 mm — celle de la référence — et les angles, eux, sont comparés à
1e−12. Je le dis parce qu'un « identique à 1e−9 » aurait été faux : c'est un
écart de précision de la référence, pas du code. Le fichier du lot J1 reste,
lui, identique à l'octet près, puisque J1 écrit les poses qu'on lui donne.

#### 9.7 Le reste du lot

- **Ordre de coupe** (`cutOrder`) : pièces nichées d'abord, **par
  profondeur décroissante** (une pièce dans le trou d'une pièce nichée sort
  avant), puis les hôtes ; les pièces d'un même hôte **groupées**, pour que
  la torche ne fasse pas l'aller-retour. Sur le moulinet, la sortie est
  exactement l'`[OpOrder]` de la référence : `1,0  2,0  3,0  4,0  0,0`.
  `nestingDepths` refuse une chaîne d'imbrication circulaire plutôt que de
  boucler.
- **Rangs écrits** (`writtenRanks`) : miroir exact de l'écrivain J1 — le
  premier exemplaire d'un dessin garde le rang de son original (règle 6, le
  bloc binaire est lié aux rangs), les copies prennent les rangs libres à la
  suite, dessin par dessin. C'est ce qui permet à `[OpOrder]` de désigner les
  bons rangs sans que J2 ait à réécrire le fichier lui-même.
- **Un `.job` par tôle** (v1, point 6 de la consigne §6) : `[Work]` ne porte
  qu'une tôle. Chaque fichier ne contient que les pièces de SA tôle, les
  autres étant mises à `enabled=0` — jamais supprimées, leur rang porte le
  binaire. Verrou : deux tôles → deux fichiers, et dans chacun la pièce de
  l'autre tôle est désactivée.
- **Miroirs `HRef`/`VRef` : pas en v1**, comme le prévoit la consigne —
  aucun essai SheetCam sur une pièce non symétrique n'a été fait, donc rien
  n'est écrit dessus (le lecteur les lit, l'écrivain les recopie). Les
  rotations seules.

#### 9.8 Verrous

| Verrou | Résultat |
|---|---|
| les quatre poses du moulinet | **4/4**, écart ≤ 0,4 µm (précision de la référence), angles à 1e−12 |
| l'hôte | `50 ; 50 ; -0` exactement |
| le centre de boîte compte | pose sans `c` : **> 16 mm** d'écart — le verrou le mesure au lieu de l'affirmer |
| zéro négatif | conservé à l'écriture ET à la lecture (`Number('-0')` est −0) |
| `[OpOrder]` du moulinet | identique à la référence |
| profondeur et groupage | 3 cas mesurés, dont une pièce dans une pièce nichée |
| chaîne circulaire | refusée (`nestingCycle`) |
| deux tôles | deux fichiers, pièces de l'autre tôle désactivées |
| refus sans devinette | `noSheets`, `emptySheet`, `missingCentre` |
| `npx vitest run` | **57 fichiers, 624 tests verts** (15 de plus) |

#### 9.9 Non-faits

1. **La recette SheetCam reste à faire** : aucun fichier produit par ce code
   n'a été ouvert dans SheetCam. J2 produit maintenant un `.job` depuis des
   poses moteur — c'est le moment prévu par le propriétaire pour les trente
   secondes d'essai sur son poste. Il manque encore le branchement (J4) pour
   qu'un vrai nesting fournisse ces poses : je peux fabriquer un fichier de
   démonstration à la main depuis un résultat existant si le propriétaire
   veut faire l'essai avant J4 — à sa demande, pas de moi-même.
2. **`nestedIn` (l'imbrication) est une ENTRÉE**, pas une déduction : c'est
   l'appelant qui dit quelle pièce est dans le trou de laquelle. Nos
   post-pass le savent (`holesFilled`, membres par trou) ; le câblage est
   dans J4. J2 ne devine pas une imbrication depuis la géométrie.
3. **Les miroirs et le multi-tôles dans un seul fichier** restent hors v1
   (questions ouvertes du §4).

### Lot J2 — vérification (vérificateur, 13/09, `a4712b93`) — GO, J3 peut s'ouvrir

Rejoué hors des tests du dépôt : centres de boîte mesurés par le module sur
nos anneaux importés (`Piece_Trou` (0 ; 0), `Piece_Fillx4` (0 ; 16,8284)),
puis `nestedJobsPerSheet` sur cinq poses moteur (hôte t = 50;50 θ = 0, quatre
éventails t = 50;50 θ = 0, π/2, π, 3π/2, `nestedIn` = hôte) contre
`Piece_Trou+Fill_x4_final_TEST.job` :

| Verrou | Résultat |
|---|---|
| poses écrites | `50;66,8284;−0`, `33,1716;50;−π/2`, `50;33,1716;−π`, `66,8284;50;−3π/2`, hôte `50;50;−0` |
| `[OpOrder]` | `1,0 2,0 3,0 4,0 0,0`, identique |
| bloc binaire | identique |
| texte | **5 lignes diffèrent** : quatre coordonnées à **0,4 µm** (la référence porte 16,828, nos anneaux 16,8284 — c'est la référence qui est arrondie) et l'hôte écrit `Angle=-0` là où la référence porte `Angle=0` (θ = 0 négatif par construction ; le fichier du 11/09 avait −0 sur l'éventail et 0 sur l'hôte, SheetCam lit les deux) |
| vitest | 624 |

**Un défaut de portabilité à corriger dans J3** : `shared/sheetcamNest.js`
importe `'./sheetcamJob'` sans extension. Vite et Nitro le résolvent, Node
nu non (`ERR_MODULE_NOT_FOUND`) — mon rejeu a dû passer par vitest. Un
module « un seul code navigateur/serveur » doit se charger tel quel :
écrire `'./sheetcamJob.js'` (une ligne), et un verrou `node --input-type=module -e "import('./shared/sheetcamNest.js')"` dans la CI app.

**Recette SheetCam** : J2 produit un `.job` depuis des poses moteur ; la
recette du §8 (ouvrir dans SheetCam, ordre de coupe) est maintenant possible
avec un fichier fabriqué depuis un résultat existant — à la demande du
propriétaire, avant J4.


### Recette SheetCam — un `.job` produit depuis un VRAI nesting (implémenteur, 13/09)

Demandée par le propriétaire après le GO de J2. Le fichier lui a été remis
(`.testparts/RECETTE_nestorcut_x4.job`, privé — jamais dans `docs/`).

**Comment il a été fabriqué**, sans rien inventer :

1. les deux dessins du moulinet déposés dans un projet SERVEUR du produit
   (le chemin normal, pas un script) ; l'importeur rend l'hôte 100 × 100 avec
   **un trou de 70 × 70** et l'éventail 39,598 × 28 ;
2. un nesting RÉEL lancé par l'API : 1 hôte + 4 éventails, tôle
   **1000 × 1250** (celle du `.job`), espacement **2 mm** (= kerf 1,5 +
   2 × 0,25), 4 rotations, imbrication dans les trous ;
3. résultat mesuré : **5 pièces posées, holesFilled 4 / 1** — les quatre
   éventails sont dans le trou de l'hôte —, écart minimal **2,000 mm**,
   `overlapFree: true` ;
4. les poses finales (après post-pass) relevées sur les `Transform` que
   l'export DXF utilise, puis converties par `shared/sheetcamNest.js` avec
   les centres de boîte **mesurés sur nos anneaux** : (0 ; 0) pour l'hôte,
   (0 ; 16,8284) pour l'éventail.

**Ce que porte le fichier** : `Count=5`, `Optimisation=3`, `[OpOrder]` =
`1,0  2,0  3,0  4,0  0,0` (les quatre éventails puis l'hôte), les quatre
copies en `copyOf=1`, les chemins réduits au nom de fichier, et le **bloc
binaire recopié à l'octet** (2 700 octets). Aller-retour lecture → écriture
vérifié identique. Les poses forment le pinwheel autour de (52 ; 52,5) :
35,17 / 52,0 / 68,83 en X et 35,68 / 52,51 / 69,34 en Y.

**Une chose à regarder à l'ouverture**, dite avant l'essai : le quatrième
éventail porte `Angle=-6.283185` (−2π, un tour complet) parce que le moteur a
émis θ = 2π plutôt que 0. C'est la même pose au radian près, mais si SheetCam
l'affiche de travers, la normalisation de l'angle dans [0 ; 2π) est une ligne.

**Verdict du propriétaire : à consigner ici** (le fichier est remis, l'essai
sur sa machine reste à faire — c'est le seul maillon que je ne peux pas
jouer).

### Lot J3 — réserve d'amorce et disque de perçage (implémenteur, 13/09)

Livré : `shared/sheetcamReserve.js` et `app/tests/sheetcamReserve.test.js`
(**21 verrous**), plus le correctif de portabilité signalé par le
vérificateur au lot J2. Un commit. Le moteur n'est pas touché, et **aucun
module ne consomme encore ces fonctions** (c'est J4).

#### 9.10 Le correctif de portabilité, d'abord

`shared/sheetcamNest.js` importait `'./sheetcamJob'` **sans extension** :
Vite la devine, Node nu non (`ERR_MODULE_NOT_FOUND`). Reproduit, corrigé, et
**verrouillé** : le test lance un `node --input-type=module -e "import(...)"`
dans un processus fils, sans loader ni drapeau expérimental. Sans le verrou,
la même faute reviendrait au premier module `shared/` suivant.

#### 9.11 La forme du correctif de réserve

C'est celle qu'impose le masterplan §3.5, et elle n'est pas un détail :
**pas d'anneau d'inflation complet** (il tuerait la densité), mais un
**appendice d'exclusion LOCAL** au point de départ, soudé au contour.
L'algorithme de nesting ne change pas — il reçoit un polygone quelconque,
comme toujours. Et l'appendice ne sort que pour le nesting : le `.job` rendu
garde le contour réel, puisque c'est SheetCam qui trace l'amorce.

L'appendice est **l'enveloppe convexe du sommet de départ et du disque de
perçage** : une forme en trou de serrure qui couvre le couloir d'amorce ET le
perçage sans jamais rentrer dans la pièce. Le disque est un 32-gone
**circonscrit** (comme le repli du lot E0) : on ne promet jamais moins de
marge que demandé.

| Réglage | Valeur | D'où elle vient |
|---|---|---|
| espacement pré-rempli | **kerf + 2 × sécurité** = 2 mm sur le `.job` du propriétaire | `[Tool0].Kerf width` = 1,5 mm, règle 3.10 déjà en production |
| longueur d'amorce | lue par opération | `Lead in` du `.job` (lot J1) |
| point de départ | coin de `Start position`, sinon **début de la plus longue arête droite** | table `START_CORNERS` **à confirmer en SheetCam** ; le repli, lui, ne dépend d'aucune convention (masterplan §3.5) |
| rayon de perçage | **`pierceMarginMm`, défaut 3 mm** | §7 de l'étude — **à confirmer sur la machine** |

#### 9.12 Mesures

| Mesure | Résultat |
|---|---|
| le perçage est DEHORS | à exactement `leadIn` du contour, hors de la pièce d'origine, et la **marge promise de 3 mm est entièrement couverte** par l'anneau rendu |
| la réserve est LOCALE | sur un carré de 100 mm, amorce 5 + perçage 3 : **+238,2 mm²**, soit **2,4 % de la pièce** — contre ~3 200 mm² pour un anneau d'inflation de 8 mm, **13 fois moins** |
| l'anneau rendu est SIMPLE | aucune paire d'arêtes ne se croise (test exhaustif sur l'anneau produit) |
| le prix payé par la voisine | l'amorce + le perçage, **pas plus** : 8,0 mm ≤ coût < 8,1 mm |
| l'amorce ne perce plus dans la voisine | **avant** : voisine à l'espacement du contour réel, le perçage prédit est DANS sa matière (il mord 6 mm) ; **après** : voisine à l'espacement de la pièce réservée, distance du disque à la voisine **≥ 2 mm**, perçage hors de la voisine |
| pièces concaves | réserve appliquée sur un L, perçage dehors, aire ajoutée < 120 mm² ; la bissectrice est **orientée par un test d'appartenance**, sinon un sommet réflexe la retourne vers l'intérieur |
| `npx vitest run` | **58 fichiers, 646 tests verts** |

**Un défaut trouvé par son propre verrou** : la garde anti-traversée sautait
une arête de trop (`j <= newTo` au lieu de `j < newTo`) — précisément la
PREMIÈRE arête d'origine après l'appendice, c'est-à-dire celle qu'un
appendice qui s'échappe traverse. Mesuré sur un C dont la gorge est
traversée par une amorce de 60 mm : le lot rendait `applied: true` avec un
anneau auto-intersectant, ce que l'import moteur refuse (piège #2c, le défaut
qui a tué un job de production). Corrigé, et le cas est un verrou.

#### 9.13 Refus plutôt que géométrie fausse

Trois cas rendent l'anneau **intact** avec leur raison, au lieu de livrer
une forme douteuse : `vertexInsideDisc` (amorce plus courte que la marge : il
n'y a plus de sommet à épingler), `reserveCrossesContour` (l'appendice
ressortirait à travers la pièce), `nothingToReserve` / `ringTooSmall`. La
raison voyage dans `part.reserve`, prête pour un constat d'UI au lot J4.

#### 9.14 Non-faits

1. **Aucun appelant** : `git grep` le confirme, rien hors des tests n'importe
   ces modules. Donc **rien ne change pour les jobs sans `.job`** — le
   verrou « harnais deux configurations inchangé » est tenu par construction,
   et le déterminisme natif ≡ wasm n'est pas concerné (aucun code Rust,
   aucun wasm dans ce lot).
2. **Pas de miroir Python** : le chemin serveur n'a pas encore le flux
   `.job` (masterplan §0 : le navigateur d'abord). Le miroir viendra avec le
   lot qui branche le serveur, et le plomberie sera la même qu'au lot E2.
3. **Deux valeurs à confirmer sur la machine du propriétaire** : la table
   `Start position` → coin, et le rayon de perçage de 3 mm. Les deux sont des
   entrées de fonction, pas des constantes enfouies.
4. **L'amorce d'un TROU n'est pas réservée** : SheetCam perce aussi pour un
   trou intérieur, mais la place y est prise par la matière de la pièce
   elle-même. Le jour où le contraire sera mesuré, ce sera un lot à part.

### Lot J3 — vérification (vérificateur, 13/09, `d9ab6e1f` + `f95582d7`) — GO sous conditions

| Verrou | Résultat |
|---|---|
| vitest | 646 (dont le chargement en Node nu de `sheetcamNest.js`, correctif de portabilité du lot J2) |
| aucun appelant produit | confirmé : `shared/sheetcamReserve.js` n'est importé que par ses tests ; la production ne change pas |
| lecture | espacement = kerf + 2 × 0,25 ; appendice = enveloppe convexe du sommet de départ et d'un 32-gone circonscrit ; refus nommés (`vertexInsideDisc`, `reserveCrossesContour`, `nothingToReserve`, `ringTooSmall`) ; garde anti-traversée corrigée et verrouillée |
| déploiement 2e | wasm géométrie servi par la prod = dépôt (`32df2941…`), vérifié |
| recette | `.testparts/RECETTE_nestorcut_x4.job` : `Count=5`, `Optimisation=3`, `[OpOrder]` nichées puis hôte, quatre `copyOf=1`, angles `−π/2, −π/2, −π, −3π/2, −2π` |

**Conditions** :

1. **Le commit de correction `f95582d7` a retiré du suivi 86 fichiers qui
   étaient versionnés AVANT le lot J3** (`docs/qa/atelier-ui/` 69,
   `docs/qa/pr5-acceptation/` 12, `docs/qa/audit-multitoles-2026-09-03/` 5 —
   dont `RAPPORT-P4/P5/U2.md` et des mesures référencées par
   `FICHE-LOT4-T2-2026-09-06.md`). À **restaurer en un commit** (commande dans
   `docs/REPRISE-2026-09-13.md` §4) avant tout autre travail.
2. **Normaliser l'angle écrit dans (−π, π]** : la recette porte
   `Angle=-6.283` pour un θ = 2π émis par le moteur ; SheetCam le lira
   probablement, mais un fichier propre ne porte pas −2π. Une ligne, au
   lot J4.
3. Les deux valeurs « à confirmer sur la machine » (rayon de perçage 3 mm,
   table `Start position → coin`) restent des entrées de fonction : le
   propriétaire répond, J4 les pose.

Le verdict de la recette SheetCam (propriétaire) est attendu ici avant tout
déploiement du flux `.job`.

### Recette SheetCam — verdict du propriétaire (13/09, `RECETTE_nestorcut_x4.job`)

**OK** : les pièces (poses des quatre éventails dans le trou de l'hôte, hôte)
et l'**ordre de découpe** (éventails d'abord, hôte en dernier) sont
corrects dans SheetCam.

**NOT OK — défaut constaté (capture du propriétaire)** : **l'amorce de la
dernière opération, le contour du TROU de l'hôte, part de l'intérieur du
trou et vient couper les éventails qui y sont nichés.** SheetCam trace
l'amorce d'un contour intérieur **vers l'intérieur du trou**, c'est-à-dire
du côté chute — précisément là où NestorCut a posé des pièces. Sur la
capture, l'arc d'amorce (départ S2, sur le cercle du trou) traverse deux
éventails, marqués en rouge.

Conséquence pour la suite (à traiter par le prochain agent, **non résolu
ici**, consigne du propriétaire) :

1. Le non-fait 4 du lot J3 (« l'amorce d'un trou n'est pas réservée, la
   place y est prise par la matière de la pièce ») est **infirmé par la
   machine** : pour un trou, amorce et perçage tombent DANS le trou, donc
   dans la zone où le remplissage de trous pose des pièces. Il faut une
   **réserve d'amorce côté trou** : au point de départ de chaque contour
   intérieur, un appendice d'exclusion **vers l'intérieur** (longueur
   d'amorce lue par opération + disque de perçage), soustrait de la zone
   libre que voit le remplissage de trous (`holeFill` / `pinwheel`), et
   uniquement là — pas un anneau complet, sinon plus rien ne rentre.
2. Le point de départ de l'amorce d'un trou dépend de `Start position`
   (opération du trou) : soit on **prédit** ce point avec la même table
   `START_CORNERS` (à confirmer, §9.14) et on réserve là ; soit on
   **choisit** nous-mêmes le point de départ du trou après nesting, là où il
   reste de la place, si SheetCam accepte un point de départ imposé par
   contour (à vérifier dans le format : `Start position`, `Start point`
   par opération) — c'est la voie la plus économe en matière.
3. Verrous à prévoir : sur la recette, la distance entre l'amorce prédite du
   trou (et son perçage) et tout éventail ≥ espacement ; et une recette
   SheetCam **rejouée sur le poste du propriétaire** avec le fichier
   corrigé, capture à l'appui.
4. Le même raisonnement vaut pour toute pièce nichée dans une pièce nichée
   (profondeur 2) : la réserve se calcule trou par trou.

### Lot J4 — rapport de l'implémenteur (13/09)

Branchement produit du `.job` : dépôt, réglages pré-remplis, réserve
d'amorce appliquée au nesting, un `.job` téléchargé par tôle. Deux commits.

#### 9.15 Le défaut de la recette est traité — et la voie 2 est fermée par le format

Le verdict du propriétaire infirmait le non-fait 4 du lot J3 : l'amorce du
contour d'un TROU part vers l'intérieur du trou, côté chute, et coupe les
éventails nichés. Deux voies étaient posées, aucune choisie.

**La voie 2 (« imposer nous-mêmes le point de départ du trou après nesting »)
est impossible, et c'est mesuré** : le relevé de TOUTES les clés des onze
`.job` d'essai ne donne, par OPÉRATION, qu'un `Start position` entier — il
n'existe aucune clé « point de départ » par contour. Et `[OpOrder]` s'arrête
à la granularité `pièce,opération` : la recette porte cinq lignes pour cinq
pièces, alors qu'une seule opération « Outside Offset » coupe le contour
extérieur ET le trou. On ne peut donc que PRÉDIRE le point de départ.

**Voie 1 retenue, mais pas sous la forme de l'appendice du lot J3.** Retourner
simplement sa direction vers l'intérieur ne produit pas une encoche : mesuré
sur le trou de la recette (cercle r = 35, amorce 5, perçage 3), l'aire du trou
MONTE de 3 842 à 3 868 mm² et 21 des 32 sommets du disque de perçage restent
dans la zone libre — le tour ré-enferme la zone au lieu de la retrancher. Et
l'encoche épinglée sur un seul sommet pince l'anneau en un point (sommet
dupliqué, goulot d'épaisseur nulle), c'est-à-dire exactement la famille de
géométries qui tue l'import moteur (pièges AGENTS #2c et #5b).

La forme livrée est une **morsure de bord à mâchoire large** : on retire de la
zone libre un lobe ACCROCHÉ au bord du trou, de bouche égale au diamètre du
disque de perçage, en remplaçant l'arc du contour entre deux points par le
tour de l'enveloppe convexe qui contourne le disque. Ni goulot, ni pincement,
ni sommet dupliqué — ni dans la zone libre, ni dans la matière de l'hôte, qui
gagne ce même lobe (piège #4 : le polygone posé est l'anneau externe MOINS les
trous, donc rétrécir le trou épaissit l'hôte là où il faut).

#### 9.16 Mesures de la réserve d'amorce des trous

| Mesure | Résultat |
|---|---|
| disque de perçage strictement dans la zone libre | **0 / 32** (les 32 sommets, sur chacune des morsures) |
| couloir d'amorce (bord du trou → perçage) dans la zone libre | **0 / 101** points échantillonnés |
| anneau rendu SIMPLE | **0 croisement** propre entre arêtes non adjacentes |
| prix, une morsure | **1,14 %** de l'aire du trou |
| prix, quatre morsures (ce qui est livré) | **4,56 %** |
| prix d'une couronne intérieure complète (la solution paresseuse) | **40 %** (rayon libre 27 au lieu de 35) |
| trou trop petit pour l'amorce | réserve REFUSÉE, anneau rendu INTACT, trou retiré du nesting |

**Pourquoi quatre morsures et pas une.** La table `Start position` → coin
n'est pas confirmée sur la machine (non-fait 3 du lot J3, question 2 du §9).
Réserver le seul coin prédit reviendrait à parier sur une table non mesurée,
et le prix d'un mauvais pari est exactement le défaut que ce lot corrige : la
pièce coupée par l'amorce. Réserver les QUATRE coins candidats est juste QUEL
QUE SOIT le sens de la table, pour dix fois moins cher qu'un repli
conservateur. Le drapeau `startPositionConfirmed` fera tomber la réserve au
seul coin lu le jour où le propriétaire répondra — et un verrou existe pour
que ce passage soit un choix, pas un oubli.

**Dégradation sûre.** Un trou dont la réserve est refusée est RETIRÉ de la
liste des trous du nesting : plus rien ne s'y niche, et la raison voyage dans
`reserve.holes[]` jusqu'à la fiche. Nicher dans un trou dont on ignore où
passe l'amorce, c'est livrer le défaut de la recette. Le contour réel, lui,
n'est jamais touché : le `.job` rendu porte le trou entier, c'est SheetCam
qui le coupe.

#### 9.17 L'angle normalisé — l'intervalle demandé n'était pas le bon

La consigne demandait « normaliser l'angle écrit dans (−π, π] ». **C'est le
mauvais intervalle, et le fichier de référence le prouve** : posé À LA MAIN
dans SheetCam, `x4-reference.job` porte, pour les quatre quarts de tour,
`Angle = −0, −1.5707963267949, −3.14159265358979, −4.71238898038469`.
SheetCam garde donc un tour négatif complet — son intervalle est **(−2π, 0]**.
Normaliser dans (−π, π] récrirait −4,712 en +1,571 et ferait diverger notre
écriture du fichier de référence, que le verrou du lot J2 compare à 1e−12 près.

`normalizeJobAngle` réduit dans (−2π, 0] : le `Angle=-6.283` de la recette
devient `−0`, et sur tout θ ∈ [0, 2π) — tout ce que le moteur produit — la
fonction est l'IDENTITÉ, signe du zéro compris (vérifié sur 360 valeurs).

#### 9.18 Deux défauts trouvés en branchant, et corrigés

1. **`XPos`/`YPos` était faux hors quarts de tour — jusqu'à 21 mm.** La règle 3
   dit « centre de la boîte englobante de la pièce POSÉE », donc tournée. Le
   lot J2 l'a implémentée par `t + R(θ)·c` avec `c` mesuré sur le dessin
   DROIT, et l'a validée contre la référence. Cette validation ne POUVAIT PAS
   voir le défaut : la référence ne porte que des quarts de tour, et `R(θ)`
   envoie alors la boîte sur la boîte. Mesuré sur un L de 100 × 100 : écart
   0,000 mm à 0°, 90°, 180°, 270° — puis **8,8 mm à 17°, 15,0 mm à 30°,
   21,2 mm à 45°**. Sur un triangle, 14,6 mm à 45°. Or l'UI autorise
   `rotationCount` de 1 à 360 (piège AGENTS #61). Corrigé par
   `placedBoxCentre` / `jobPlacementFromRings`, que `nestedJobsPerSheet`
   préfère dès qu'on lui passe les anneaux. Le verrou utilise un L : une
   pièce centralement symétrique (rectangle, cercle) ne révèle JAMAIS ce
   défaut, son centre de boîte étant son centre de symétrie.
2. **Le repli du point de départ était mort.** `Number(null)` valant 0, un
   `Start position` ABSENT désignait le coin 0 (bas gauche) au lieu de
   retomber sur la règle par défaut du masterplan §3.5 (début de la plus
   longue arête droite). Son verrou passait par coïncidence : sur le
   rectangle 10 × 5 qu'il utilisait, les deux règles donnent l'index 0.
   Corrigé, et le verrou est maintenant DISCRIMINANT (rectangle 3 × 50 :
   coin 0, arête 1).

#### 9.19 Ce qui est branché

| Point de la consigne | État |
|---|---|
| 1 — dépôt d'un `.job` par SIGNATURE | livré. `isSheetCamJob` : **15/15** `.job` réels reconnus, zéro faux positif sur DXF, SVG, fichier vide et leurre commençant par `Config=`. La garde est en JS, avant le wasm : le détecteur de l'importeur wasm est à deux branches (`<` ⇒ SVG, tout le reste ⇒ DXF), un `.job` y serait parti dans l'importeur DXF et serait ressorti en « erreur d'analyse » — un message faux pour un fichier valide. Le détecteur Rust n'est PAS touché (l'étendre imposerait un rebuild du wasm, piège #33b) |
| 1 — une fiche par dessin, quantité = exemplaires | livré. Appariement par NOM de fichier, casse ignorée (un `.job` Windows écrit `Piece_Trou.DXF`) ; les dessins manquants sont NOMMÉS, jamais avalés |
| 2 — réglages pré-remplis | livré. Tôle depuis `[Work]`, espacement depuis le kerf de `[Tool0]` par `kerf + 2 × sécurité` — et par `updateKerfSafety`, jamais par `updateParams({ space })`, seul chemin qui garde les trois champs cohérents. Un `.job` sans kerf exploitable ne pré-remplit PAS l'espacement : on ne remplit pas un champ avec une valeur inventée. Rien n'est imposé, tout reste modifiable |
| 3 — réserve appliquée au nesting | livré. Appliquée dans la boucle commune du constructeur de payload, **APRÈS** la simplification : le disque de perçage est un 32-gone dont la flèche vaut 0,0144 mm à r = 3, soit MOINS que la tolérance Douglas-Peucker (0,05 mm) — simplifier après la réserve aplatirait le disque et rognerait la marge promise |
| 3 — `nestedIn` du post-pass | livré. Déduit des layouts LIVRÉS et non collecté dans la passe : trois chemins nichent sans passer par `applyHoleFill` (expansion meta, alternative structurelle auto-suffisante du piège #41, ceinture par tôle qui peut annuler la passe), une information collectée dans la passe mentirait. Index PAR TÔLE (piège #52) ; profondeur 2 chaînée |
| 4 — un `.job` par tôle, angle normalisé | livré. `<nom>_tole{k}.job`, bouton dans le modal de résultat. Le `.job` est BINAIRE : il part en `Uint8Array` au `Blob`, jamais par le helper texte qui corromprait le bloc de géométrie en cache |
| 4 — constats des réserves refusées dans la fiche | **partiel** : les constats voyagent jusqu'au payload (`leadInReserve`) et les libellés existent en EN et FR, mais aucun composant ne les AFFICHE encore. Non-fait, dit franchement |
| 5 — libellés FR et EN | livré. 26 clés neuves, parité EN/FR verrouillée, chaque code d'erreur levé par le code `.job` a son libellé |
| 6 — harnais navigateur dédié | livré : `scripts/qa-e2e-job.mjs`, rejoué sur l'image locale reconstruite depuis les sources. Voir 9.20 et 9.21 |

#### 9.20 Verrous

| Verrou | Résultat |
|---|---|
| `npx vitest run` | **63 fichiers, 708 tests verts** (58 fichiers / 646 tests avant le lot) |
| `npx nuxt build` | **vert** |
| `docker compose build app` | **vert** — et c'est CE gate qui a trouvé le défaut 1 du §9.21, invisible au build du poste |
| harnais navigateur `scripts/qa-e2e-job.mjs` | **tous les verrous verts**, deux configurations (2 pièces ; 1 hôte + 4 éventails avec nichage) |
| structure du `.job` rendu | `Count`, `Optimisation=3`, `copyOf` par exemplaire, `[OpOrder]` nichées puis hôte, chemins absolus masqués, **bloc binaire identique à l'octet près** |
| poses calculées sur les anneaux RÉELS | contrôle chiffré : passer les anneaux RÉSERVÉS déplacerait les éventails de plus de 2 mm |
| contrôle négatif du lot | un projet SANS `.job` rend un payload rigoureusement identique, et le champ de constats est ABSENT (pas vide : absent) |
| fixtures de parité Python du payload | inchangées et vertes — la réserve ne fuit pas dans le chemin ordinaire |
| déterminisme natif ≡ wasm | non concerné : aucun code Rust, aucun wasm dans ce lot |

#### 9.21 Le harnais navigateur, et les six défauts qu'il a trouvés

`scripts/qa-e2e-job.mjs` rejoue le parcours réel — dépôt d'un `.job` avec ses
DXF, nesting, `.job` téléchargé puis relu par notre propre lecteur — sur
**l'image locale reconstruite depuis les sources** (règle de la maison :
images à HEAD avant tout banc). Le lot était verrouillé de bout en bout en
Node et **ne marchait pas dans un navigateur**. Six défauts, du plus grave au
moins grave, aucun visible en test unitaire :

1. **Le build de l'IMAGE refusait le lot.** Un module de `app/composables/`
   atteint par un import dynamique devient son propre chunk ; le bundle
   serveur réécrit alors ses imports relatifs depuis l'emplacement du CHUNK
   et non de la source — `../../shared/sheetcamJob.js` devient
   `../../../../../shared/…` et ne résout plus. C'est le piège AGENTS #29c,
   et **le build sur le poste ne le voit pas**. Corrigé par l'alias
   `~~/shared/…`. Élargir `nitro.externals.inline` ne corrigeait rien :
   essayé, mesuré, annulé.
2. **La validation physique rejetait TOUT, pour des chevauchements qui
   n'existaient pas.** Le calcul de la réserve travaille sur des anneaux
   OUVERTS, le pipeline les attend FERMÉS. `nest-report` balaie ses arêtes
   par `for i in 0..ring.len() - 1` : sur un anneau ouvert l'arête de
   fermeture n'existe pas pour lui, et son test d'appartenance en devient
   faux — il déclare des contenances, donc des chevauchements, qui n'existent
   pas. Le défaut **dormait depuis le lot J3**, qui n'avait aucun appelant.
3. **Un `.job` déjà nesté ressortait avec des pièces fantômes** : 5 pièces
   demandées, 8 sections écrites, les 3 copies d'origine restant ACTIVES à
   leur ANCIENNE pose. SheetCam aurait coupé trois pièces en trop.
4. **Le `.job` était rejeté à la dépose sur l'accueil** — la page d'accueil
   porte sa PROPRE liste d'extensions, et c'est elle qui filtre la première
   dépose, celle qui crée le projet. Les DXF partaient seuls, sans aucune
   réserve, en silence.
5. **Aucun `.job` n'était produit, sans erreur** : `normalizeLayouts` prend
   la SOLUTION, pas l'alternative — lui passer l'alternative rendait une
   liste vide, et rien ne le disait.
6. **Le bouton n'apparaissait pas** alors que les fichiers étaient produits
   et persistés : `hydrateLocalItem` reconstruit chaque alternative par
   LISTE BLANCHE de champs, et `jobs` n'y était pas.

L'A/B qui a isolé le défaut 2 mérite d'être gardé : même `.job`, `Lead in=0`
⇒ le job aboutit ; réserve sur l'hôte seul ⇒ aboutit ; réserve sur les quatre
éventails ⇒ refusé — alors que la mesure arête↔arête des mêmes poses donne
**3,501 mm pour 3,500 exigés**.

**Résultat final du harnais, deux configurations : TOUS LES VERROUS VERTS.**
Structure du fichier rendu (`Count`, `Optimisation=3`, `copyOf`, chemins
masqués, bloc binaire **identique à l'octet près**), `[OpOrder]` une ligne
par pièce ACTIVE et ne désignant que des pièces actives, tous les angles dans
(−2π, 0], et **les pièces nichées coupées AVANT leur hôte** (l'hôte en 2ᵉ
position sur 4). Le verrou de nichage se DÉCLARE non mesuré quand la solution
n'en contient pas, au lieu de passer à vide.

#### 9.22 Un défaut OUVERT, et il faut le dire

Avec la réserve, le cas **1 hôte + 1 éventail pose 1 pièce sur 2**, là où le
même `.job` sans amorce en pose 2 sur 2 — sur une tôle de 1000 × 1250 mm, pour
deux pièces de 100 × 100 et 40 × 28. Ce n'est pas un coût de densité, c'est
une pièce qui ne trouve pas sa place.

Ce que la mesure EXCLUT : la pré-passe de remplissage de trous. Rejouée en
isolation, avec réserve elle ne planifie **aucun** remplissage et **garde les
deux pièces** dans l'instance moteur (`packs: []`, `idMap: [0, 1]`) — elle ne
retire donc rien. La perte est plus profonde dans le pipeline. Elle n'est pas
silencieuse : l'écran affiche « 1 sur 2 » avec ses leviers.

**À traiter avant tout déploiement.**

#### 9.23 Non-faits restants

1. **Les constats de réserve ne sont pas affichés.** Ils voyagent jusqu'au
   payload (`leadInReserve`), ils sont traduits en EN et FR, aucun composant
   ne les rend.
2. **Aucun miroir serveur** : c'est le lot J5, et le masterplan §0 veut le
   navigateur d'abord.
3. **La recette machine n'a pas été rejouée par le propriétaire.** Rien ne
   doit être déployé avant qu'il ait ouvert dans SheetCam un fichier produit
   par ce lot et confirmé que l'amorce du trou ne coupe plus les éventails.
4. **La réserve n'est pas mesurée sur un trou CONCAVE** (en L, en C). La
   garde anti-traversée refuse proprement, mais personne n'a vérifié qu'elle
   ne refuse pas trop souvent sur des fichiers réels.
5. **Deux valeurs restent à confirmer sur la machine** : le rayon du disque
   de perçage (3 mm) et la table `Start position` → coin. Tant que la seconde
   n'est pas confirmée, la réserve d'un trou coûte 4,6 % au lieu de 1,1 %.
6. **Le harnais crée un projet par exécution** : enchaîner les lancements
   déclenche la limite anti-force brute (429, piège #43) et le refus qu'on
   lit alors n'a rien de géométrique. Laisser retomber le budget entre deux
   séries.

### Lot J4 — vérification (vérificateur, 13/09, `50ee6f19`) — NO-GO déploiement, un correctif à livrer d'abord

Rejoué sur le poste : image `app` **reconstruite à HEAD** (17:21, l'image de
l'implémenteur datait d'une minute AVANT le commit `c3b13b33`), harnais
`scripts/qa-e2e-job.mjs` tel quel puis dans une variante sans le cas A4,
constructeur de payload et modules `shared/` rejoués en Node (alias `~~/`
résolu par un hook de chargement), sorties hors dépôt (`~/qa-out/verif-j4/`).

#### 9.24 Ce qui est acquis

| Verrou | Résultat |
|---|---|
| dépôt | `b96813fb` restaure les 86 fichiers (86 ajoutés, tous suivis) ; `docs/REPRISE` et les documents de passation commités |
| vitest | **708** |
| harnais tel quel, `.job` à 2 pièces | tous verts ; **4 posées / 4** — mais 4 parce que le cas A4 redépose les deux dessins avant le nesting (2 hôtes + 2 éventails) |
| harnais tel quel, `.job` × 4 (recette) | tous verts ; 10 / 10 (2 hôtes + 8 éventails, même raison), 2 éventails nichés, hôte en 3ᵉ position de l'ordre de coupe |
| **harnais SANS le cas A4, `.job` × 4** (1 hôte + 4 éventails, la recette exacte) | **4 posées sur 5, et le harnais reste VERT** — c'est le défaut du §9.22, général et invisible au verrou |
| morsure du trou, mesurée à part (cercle r = 35, 64 sommets, amorce 5, perçage 3) | 4 morsures, 137 sommets, **−4,56 %** d'aire ; disque de perçage dans la zone libre **0 / 128** ; couloir d'amorce **0 / 396** ; **0 croisement** ; convention de fermeture rendue ; `startPositionConfirmed` ⇒ 1 morsure, −1,14 % ; trou r = 4 ⇒ refus, anneau intact |
| angle | tous les angles écrits dans (−2π, 0] sur les deux fichiers ; le `−0` de la référence conservé |
| écriture | `Count` = sections, `copyOf` par exemplaire, chemins masqués, **bloc binaire identique à l'octet près** sur les deux fichiers |
| lecture | signature `Config=` + `[Misc]`/`FileVersion=` en JS avant le wasm ; `Number(null)` du repli corrigé ; centre de boîte sur le dessin TOURNÉ (`placedBoxCentre`) ; copies d'un `.job` déjà nesté réutilisées puis désactivées |

Deux `.job` produits par ce rejeu ont été remis au propriétaire pour la
recette machine (`.testparts/VERIF-J4_*`, hors dépôt) : le fichier 1 hôte +
4 éventails (4 sur 5) et le fichier 2 hôtes + 8 éventails (complet).

#### 9.25 Le défaut du §9.22 : cause trouvée, et la pré-passe N'EST PAS hors de cause

Le rapport écartait la pré-passe de remplissage de trous (« `packs: []`,
`idMap: [0, 1]` »). Mesuré sur le vrai constructeur (`buildLocalPayload`,
mêmes deux DXF, tôle 1000 × 1250, espacement 2), c'est l'inverse :

| cas | `packs` du planificateur | `meta` produit par `reduceForSolve` | `expandMeta` rattache |
|---|---|---|---|
| sans réserve, 1 + 1 | 1 pose, `rot 0 @ (0, 0)` | `slots [1]`, `ringRotations [[0,90,180,270]]` | 1 éventail |
| sans réserve, 1 + 4 | 4 poses au centre | `slots [4]`, `ringRotations [[0,90,180,270]]` | 4 |
| **avec réserve, 1 + 1** | 1 pose, **`rot 0 @ (−4,4 ; −21,9)`** (hors centre) | `slots [1]`, **`ringRotations [[]]`** | **0** → 1 posée sur 2 |
| **avec réserve, 1 + 4** | 1 pose hors centre | `slots [1]`, `ringRotations [[]]`, `idMap [0, 1]` | **0** → 4 sur 5 |
| avec réserve, 2 + 2 (deux quantités, un fichier chacun) | 1 + 1 | `slots [1, 1]`, `ringRotations [[]]` | **0** → 2 sur 4 |

La mécanique : le planificateur générique (`packHole`) trouve UNE pose
d'éventail dans le trou mordu, hors centre — le trou n'est plus symétrique,
le moulinet à quatre ne tient plus, mais une pièce oui. Puis
`reduceForSolve` (`app/composables/localBridge.js`), dès qu'il n'y a qu'UN
hôte et UN éventail, **jette ces poses** et retombe sur la forme J-085
`{host, fill, slots, ringRotations}` : il recalcule les rotations par le
test de moulinet AU CENTROÏDE (`_jsPinwheelCapacity`), qui rend `[]` sur le
trou mordu. `expandMeta` distribue alors `slots` sur des listes de rotations
vides et ne rattache rien. La demande de l'éventail avait été RÉDUITE dans
l'instance moteur : la pièce n'est nulle part, sans erreur — « 1 sur 2 avec
ses leviers ». Le couplage est ancien ; la réserve est la première chose qui
fait diverger le planificateur générique du moulinet centré. Avec deux
FICHIERS hôtes (le cas A4 du harnais), `hostIds.size === 2` ⇒ forme
`{packs}` ⇒ `expandPacks` rejoue les vraies poses ⇒ 10 / 10 : c'est pourquoi
le harnais ne voyait rien.

Le miroir Python `workers/nesting/core/holefill.py::reduce_for_solve` a la
même structure (même repli 1 + 1, mêmes `ring_rotations` recalculées) : le lot
J5 hériterait du défaut, et il est **latent en production dès aujourd'hui**
pour un trou non circulaire (un L, un C) avec un seul fichier hôte et un seul
fichier de remplissage — à verrouiller des deux côtés.

#### 9.26 Ce que le harnais ne mesure pas (et doit mesurer)

1. Le cas C ne compare **jamais** `placed` à `requested` — il lit le record
   et le journalise, sans verrou. Le 4 / 5 est passé vert.
2. Le cas A4 redépose les dessins AVANT le nesting : le projet nesté n'est
   plus celui du `.job` (deux fichiers hôtes), et c'est précisément la forme
   qui contourne le défaut. À rejouer après le nesting ou dans un projet à
   part.
3. D10 est tautologique (`check(…, true, …)` dès que l'hôte n'est pas
   premier) : il faut lire `nestedIn` du record et vérifier qu'une nichée
   précède SON hôte.

#### 9.27 Deux constats de second rang

1. **Amorce 0 avec perçage 3** (opération sans amorce, `Lead in type = 0`) :
   la morsure refuse (`mouthInsideDisc`, la bouche de 3 mm tombe dans le
   disque centré sur le bord) et `partWithReserve` **retire le trou du
   nesting** — plus rien ne s'y niche, en silence puisque les constats ne
   sont pas affichés (non-fait 1 du §9.23). Dégradation sûre, prix élevé :
   la bouche doit s'élargir quand l'amorce est plus courte que la marge
   (bouche ≥ marge + (marge − amorce)), et le constat doit se voir.
2. Deux erreurs console « 400 Bad request » à l'ouverture du modal de
   résultat sur un projet local (harnais vert, ressource non nommée par le
   navigateur) : à identifier, non bloquant.

#### 9.28 Verdict et consigne du correctif (lot J4-bis)

**NO-GO déploiement** tant que le point 1 n'est pas livré et rejoué. Tout le
reste du lot est pris tel quel.

1. **`reduceForSolve` (`app/composables/localBridge.js`) ne prend la forme
   `{host, fill, slots, ringRotations}` que si elle peut porter le plan** :
   pour chaque hôte, `slots[h] ≤ Σ ringRotations[r].length` ET les poses du
   plan sont celles du moulinet centré ; sinon la forme `{packs, idMap}` est
   conservée et `expandPacks` rejoue les poses réelles. Même règle dans
   `workers/nesting/core/holefill.py::reduce_for_solve`.
2. **Garde anti-perte** à la finalisation (`finalizeLocal` et `main.py`) : le
   nombre de pièces rattachées par l'expansion = le nombre retiré de
   l'instance ; sinon **erreur explicite** (jamais un « terminé » à N − k),
   dans l'esprit des pièges #45 et #56b.
3. Verrous : `app/tests/localBridge.test.js` — 1 hôte + 1 éventail avec un
   trou MORDU (4 morsures, poses hors centre) ⇒ 2 / 2 rattachées ; 1 + 4 ⇒
   5 / 5 ; trou en L sans réserve (le cas latent) ⇒ aucune perte ; miroir
   `workers/nesting/tests/test_holefill.py`.
4. Harnais : C vérifie `placed === requested` ET `requested` = somme des
   quantités du `.job` ; A4 déplacé après le nesting ou dans un second
   projet ; D10 mesuré sur `nestedIn`.
5. Bouche de la morsure élargie quand amorce < marge (§9.27) ; les constats
   de réserve affichés dans la fiche (non-fait 1).
6. Rejeu, image reconstruite : `.job` à 2 pièces ⇒ 2 / 2, `.job` × 4 ⇒ 5 / 5,
   les deux SANS double dépose ; puis vérification, puis recette du
   propriétaire sur le fichier × 4, puis déploiement (app seule pour J4 ;
   le miroir Python part avec J5, homelab compris).

### Lot J4-bis — rapport de l'implémenteur (13/09)

Correctif du NO-GO. Un commit, `ddaa7b0d`.

#### 9.29 Le défaut, et ce qu'il n'était pas

Le vérificateur a raison sur les deux points qui me sont imputables, et je
les reprends à mon compte.

**Ma mesure « la pré-passe est hors de cause » ne valait rien.** Je l'avais
faite sur un cercle synthétique, en appelant `planHoleFills` directement, et
non à travers `buildLocalPayload`. Elle ne mesurait donc pas le cas réel. La
pré-passe est bien en cause, exactement comme le §9.25 le décrit.

**Mon harnais avait trois trous**, et le premier est le plus grave : le cas C
ne comparait JAMAIS `placed` à `requested`. Un verrou qui passe pendant que
le produit perd une pièce est un verrou vide — c'est la règle de la maison, et
je l'ai enfreinte.

Le défaut, lui, est plus large que le `.job` : il est **latent en production
dès aujourd'hui** pour tout trou non circulaire avec un seul fichier hôte et
un seul fichier de remplissage. La réserve d'amorce n'a été que le premier
révélateur.

#### 9.30 Le correctif

| Point | Ce qui est livré |
|---|---|
| forme compressée | `reduceForSolve` ne la prend que si elle PORTE le plan. Le critère se vérifie tout seul : on rejoue ce qu'`expandMeta` produirait (centroïde du trou, rotations dans l'ordre, budget `slots`) et on le compare aux poses réelles. Égalité ⇒ forme compressée, comportement d'hier, bit-identique ; sinon ⇒ forme `{packs}`, que `expandPacks` rejoue telle quelle. Couvre au passage `slots` > Σ rotations disponibles |
| miroir Python | même critère dans `holefill.py` (`_meta_carries_plan`, `_meta_replay_poses`) |
| garde anti-perte | des deux côtés : rattachées = promises, sinon l'alternative est ÉCARTÉE. **On ne compte que les hôtes RÉELLEMENT POSÉS** — subtilité vue côté Python et reportée en JS : le moteur peut n'en avoir placé qu'une partie, et les pièces destinées aux trous d'un hôte absent ne sont légitimement pas rattachées ; les compter ferait refuser une alternative saine |
| morsure du trou | tient pour TOUTE longueur d'amorce, zéro compris (§9.31) |
| constats de réserve | voyagent jusqu'à la fiche : un trou laissé vide ne disparaît plus en silence |
| harnais | C2/C3, A4 retiré, D10 refait (§9.32) |

#### 9.31 La morsure à amorce nulle : deux fois fausse

Mes verrous d'origine n'essayaient QUE `amorce = 5`. À `amorce = 0` — une
opération sans amorce, cas réel — la morsure était fausse deux fois :

1. elle **refusait** (`mouthInsideDisc`, les deux lèvres de la bouche tombant
   dans le disque centré sur le bord) et le trou entier sortait du nesting ;
2. bouche élargie, elle **s'appliquait en n'excluant RIEN** : l'aire du trou
   MONTAIT de 2,1 % et les 32 sommets du disque restaient dans la zone libre.
   S'appliquer sans exclure est pire qu'un refus.

Deux corrections : la bouche s'écarte de ce que le disque déborde quand
`amorce < marge` ; et le centre du disque est poussé à la marge au minimum —
le disque rendu couvre alors `0 … 2 × marge` vers l'intérieur, ce qui CONTIENT
la moitié intérieure du disque réel. On réserve un peu plus que ce que la
torche prend, jamais moins (la règle du 32-gone circonscrit du lot E0).

Balayage `amorce ∈ {0 ; 0,5 ; 1 ; 2 ; 3 ; 5 ; 8}` à perçage 3, trou r = 35 :
l'aire BAISSE toujours (2,1 % à 6,4 %), 0 croisement, et la moitié intérieure
du disque RÉEL de la torche est hors zone libre dans tous les cas.

#### 9.32 Le harnais, refait

- **C2** : posées = demandées. **C3** : demandées = somme des quantités du
  `.job`. Sans eux, le 4 sur 5 passait vert.
- **A4 retiré** : il redéposait les dessins AVANT le nesting, si bien que le
  projet nesté portait deux fichiers hôtes — précisément la forme qui
  contourne le défaut. (Le point qu'il mesurait — un `.job` n'est pas
  détourné par le panneau « Import avancé » — avait été vérifié vert avant
  retrait ; à remettre APRÈS le nesting ou dans un second projet.)
- **D10** n'est plus tautologique : il lit les paires `[nichée, hôte]`
  établies par le post-pass et les compare à l'ordre de coupe ÉCRIT DANS LE
  MÊME FICHIER. Un résultat porte plusieurs alternatives : comparer les paires
  de l'une à l'ordre de l'autre ne mesurait rien.
- Au passage, D10 a trouvé une confusion dans mon instrumentation :
  `placements[i].part` est le rang du DESSIN d'origine (0 ou 1), pas celui de
  la section écrite (0 à 4). `nestedJobsPerSheet` expose désormais `ranks`, et
  un verrou fige la distinction.

#### 9.33 Verrous

| Verrou | Résultat |
|---|---|
| `npx vitest run` | **715** (708 avant le lot) |
| `python -m pytest` worker nesting | **241 passés, 1 ignoré**, lancés DANS UN CONTENEUR (l'image runtime n'embarque ni pytest ni `tests/`). Base **MESURÉE** sur le commit d'avant le correctif, même conteneur : **237 passés, 1 ignoré** — donc +4 verrous. Mon premier jet publiait « ≈233 avant », chiffre repris de la note datée d'`AGENTS.md` §5 et non mesuré : un compte de tests se mesure, il ne se cite pas |
| `npx nuxt build` | vert |
| `docker compose build app` | vert |
| harnais, `.job` à 2 pièces, SANS double dépose | **2 sur 2** (c'était 1 sur 2), tous verrous verts |
| harnais, `.job` × 4 (la recette), SANS double dépose | **5 sur 5** (c'était 4 sur 5), tous verrous verts |
| les verrous du correctif ne sont pas vides | comportement d'avant remis temporairement : **trois tombent**, « expected +0 to be 1 » et « expected +0 to be 4 » — exactement la pièce qui disparaît |
| contrôle négatif | trou circulaire ⇒ la forme compressée est TOUJOURS prise, sortie inchangée : le chemin de production d'aujourd'hui reste celui d'hier |

#### 9.34 Non-faits

1. **La recette machine n'a pas été rejouée par le propriétaire.** Les deux
   `.job` du vérificateur (`.testparts/VERIF-J4_*`) l'attendent, et les
   fichiers produits par le correctif sont désormais complets (5 sur 5) :
   c'est sur ceux-là qu'il faut juger l'amorce du trou.
2. **Le rayon de perçage (3 mm) et la table `Start position` → coin** restent
   à confirmer sur la machine. Tant que la seconde ne l'est pas, la réserve
   d'un trou coûte 4,6 % au lieu de 1,1 %.
3. **Le cas A4 est à remettre** dans le harnais, après le nesting.
4. **Les deux « 400 Bad request » à l'ouverture du modal** (§9.27 point 2) ne
   sont pas identifiés.
5. **Le miroir Python n'est pas déployé** : il part avec le lot J5, homelab
   compris. Le correctif JS seul suffit au chemin navigateur.
6. **Une hygiène de collecte pytest** relevée en passant : `core` est un
   package NAMESPACE, et un test existant insère `workers/fileprocessing` en
   tête de `sys.path` — `core.main` peut alors se résoudre sur l'homonyme
   selon l'ordre de collecte. Contourné dans les nouveaux tests ; la cause
   reste là.

#### 9.35 Décision du propriétaire (13/09 soir) : reconstruire les amorces depuis le `.job`, calées sur le G-code

**Ce que le fichier permet, mesuré sur 17 `.job` d'essai** : le parcours
d'outil n'est PAS dans le `.job` — le bloc binaire est un cache des dessins
et des opérations (mêmes octets pour toutes les poses, tous les ordres, tous
les pivots ; il ne change qu'avec une opération). En revanche le texte porte
tout ce qu'il faut pour RECONSTRUIRE l'enveloppe de coupe : contour, kerf,
longueur et type d'amorce d'entrée ET de sortie, coin de départ. La seule
inconnue est la règle interne de SheetCam (point de départ exact, sens et
forme de l'arc, côté du kerf) — elle se mesure sur le G-code.

**Décision** : la réserve prédictive (disque de perçage aux quatre coins)
est une étape ; la cible est l'**enveloppe réelle** — contour décalé de
kerf/2, amorce d'entrée et de sortie à leur vraie forme, au vrai point —
reconstruite depuis le `.job` et **calée sur une série de G-codes fournis
par le propriétaire** : plusieurs `.job` du même DXF, tous les types
d'amorce, chacun avec son `.tap`.

**Protocole de la série** (une variable par fichier, tout le reste figé,
nom du `.job` = nom du `.tap`) :

1. **Le dessin** : une pièce ASYMÉTRIQUE (un rectangle non carré avec un
   coin coupé, ou un L), un trou RECTANGULAIRE et un trou ROND, en segments
   et arcs simples — sur un carré à trou rond, les quatre coins sont
   indiscernables et la table `Start position` reste indécidable.
2. **Référence** : amorces à 0, kerf tel quel, `Start position` par défaut —
   c'est le contour offset seul, il donne le côté et la valeur du kerf.
3. **Types d'amorce** : pour l'entrée, chaque `Lead in type` (aucune, ligne,
   arc, et tout autre type que la liste de SheetCam propose), longueur 5 ;
   puis la même série à longueur 10 (sépare la longueur de la forme) ; puis
   la sortie seule (`Lead out` 5, entrée 0), par type.
4. **Coin de départ** : la référence (arc 5 / arc 5) rejouée pour CHAQUE
   valeur de `Start position` — c'est la table des coins, extérieur ET trous.
5. **Pose** : la même pièce à 45° (`Angle`) et une fois miroir (`HRef`) —
   dit si le point de départ suit la pièce ou la tôle.
6. **Kerf** : une variante à kerf 0 et une à kerf 4 sur la référence — isole
   l'offset du reste.
7. Avec la série : le post-processeur utilisé (nom du fichier `.scpost`) et
   les unités machine — les I/J des arcs G2/G3 se lisent différemment selon
   le post.

Une quinzaine de fichiers suffisent. **Ce que l'agent en fait** (lot
J4-ter, après J4-bis) : un lecteur de `.tap` minimal (G0/G1/G2/G3, I/J
incrémentaux) qui reconstruit le parcours ; un module
`shared/sheetcamLeads.js` qui, depuis les clés du `.job`, dessine l'enveloppe
prédite ; un verrou par fichier de la série : **distance de Hausdorff
enveloppe prédite ↔ parcours G-code ≤ 0,1 mm**. La réserve de nesting
devient cette enveloppe (extérieur : bosse ; trou : morsure), et
`startPositionConfirmed` disparaît — la table est mesurée. Le disque de
perçage reste un paramètre (rayon lu sur la série : diamètre de la zone
affectée au perçage, ou 3 mm si rien ne le contredit).

Alternative écartée pour l'instant : un plugin SheetCam (Lua) qui exporterait
le parcours par dessin — plus exact, mais une pièce logicielle de plus à
installer chez chaque utilisateur ; à rouvrir si la reconstruction ne suit
pas SheetCam sur un type d'amorce.

### Lot J4-bis — vérification (vérificateur, 13/09 soir, `f0821245`) — GO déploiement, après le verdict machine

Rejoué sur le poste : image `app` reconstruite à HEAD (18:24), harnais
`scripts/qa-e2e-job.mjs` tel que livré (sans double dépose), constructeur
de payload rejoué en Node, suite Python DANS le conteneur
`nest2d-nesting-worker:dev` (arbre de travail monté, pytest installé à la
volée), sorties hors dépôt (`~/qa-out/verif-j4bis/`).

| Verrou | Résultat |
|---|---|
| vitest | **715** |
| pytest worker nesting, en conteneur | **241 passés, 1 ignoré** |
| réduction/expansion rejouées (`buildLocalPayload` réel, tôle 1000 × 1250, espacement 2) | sans réserve : forme compressée, sortie inchangée (1 + 1 ⇒ 1 rattachée ; 1 + 4 ⇒ 4 ; 2 + 2 ⇒ 2). **Avec réserve : forme `{packs}`** et `expandPacks` rattache la pose hors centre — 1 + 1 ⇒ **1** (était 0), 1 + 4 ⇒ 1 nichée + 3 dans l'instance, 2 + 2 ⇒ **2** (était 0) |
| harnais, `.job` × 4 (la recette, 1 hôte + 4 éventails) | **5 posées sur 5**, C2/C3 verts, une nichée coupée avant son hôte (D10 mesuré sur les paires), bloc binaire à l'octet près, angles dans (−2π, 0] |
| harnais, `.job` à 2 pièces | **2 sur 2**, une nichée, tous verts (deux 429 en console au second lancement rapproché, sans effet — piège #43, comme annoncé) |
| lecture du correctif | critère « la forme compressée porte le plan » écrit par rejeu de l'expansion, des deux côtés ; garde anti-perte comptée sur les hôtes réellement posés (juste : un hôte non posé n'a rien à rattacher) ; message d'erreur distinct côté serveur ; morsure à amorce nulle : centre poussé à la marge, bouche élargie |

**Ce que le propriétaire verra dans SheetCam, et qu'il faut dire** : avec la
réserve aux quatre coins, **un seul éventail se niche dans le trou de la
recette au lieu de quatre** (les trois autres sont posés à côté). Ce n'est
pas un défaut du correctif : le planificateur ne trouve qu'une pose dans un
trou mordu quatre fois. C'est le prix, mesuré, de la table `Start position`
non confirmée — la confirmer ramène à une morsure (§9.16), et l'enveloppe
reconstruite du lot J4-ter (§9.35) le réduira encore.

**Arbitrage** : le miroir Python (`holefill.py`, `main.py`) corrige un
défaut **latent en production** (trou non circulaire, un fichier hôte, un
fichier de remplissage), indépendant du `.job` : il se déploie **avec ce
lot**, pas avec J5 — worker nesting, homelab compris
(`assert_overflow_head.py`), et `densities_corpus.py` rejoué (n'écrire que
si un chiffre bouge ; le moteur n'a pas changé, `determinism_lock.py` sans
objet).

**GO déploiement** (app + worker nesting), **conditionné au verdict machine
du propriétaire** sur `.testparts/RECETTE-J4bis_x4.job` (produit par
l'implémenteur) ou `.testparts/VERIF-J4bis_x4_5sur5_tole1.job` (produit par
cette vérification, même version) : l'amorce du trou ne doit plus toucher
l'éventail niché. Si le verdict est NOT OK, le worker peut partir seul, l'app
attend.

### Recette J4-bis et série de rétro-ingénierie — verdict et mesures (13/09 soir)

#### 9.37 Verdict machine sur `RECETTE-J4bis_x4.job`

Capture SheetCam du propriétaire : 5 pièces, **un** éventail dans le trou,
**l'amorce du trou ne le touche pas** (elle part à 10 h sur le cercle, vers
l'intérieur, côté opposé à l'éventail). Sur ce point la recette est **OK**.
Les trois autres éventails sont posés au-dessus de l'hôte, et le propriétaire
les voit « grignotés par le kerf de la coupe précédente ».

Lecture du vérificateur : (a) les trois éventails ne sont pas dehors à cause
d'un conflit d'amorces mais parce que **les quatre morsures** (table des
coins non confirmée) ne laissent au planificateur qu'une pose dans le trou —
c'est le prix mesuré au §9.36, et la série ci-dessous permet de le
supprimer ; (b) le « grignotage » est la marge de sécurité de la règle 3.10
(espacement = kerf + 2 × 0,25 mm, soit 0,25 mm de matière entre la bande de
kerf et la pièce voisine) : c'est un paramètre, pas un défaut — relever la
sécurité à 0,5 mm si l'atelier le préfère.

**Décision du propriétaire** : une option **« autoriser le chevauchement des
amorces » (`allowOverlappingLeads`, défaut : non)**. Non cochée : la réserve
d'amorce s'applique (comportement du lot J4). Cochée : aucune réserve, le
nesting est plus dense, l'utilisateur assume que des amorces puissent
traverser une zone déjà coupée. Libellé EN + FR, dans les réglages du
projet quand un `.job` est déposé ; à livrer avec J4-ter.

#### 9.38 Série `retro-eng-job` : ce que trois fichiers établissent déjà

Trois `.job` du même DXF (un L de 180 × 200, un trou rectangulaire, un trou
en forme de fuseau), même texte à l'octet près (`Lead in = 5`, type 1 ;
`Lead out = 10`, type 1 ; `Start position = 0` ; kerf 1,5), **points de
départ déplacés à la main** entre les trois ; chacun avec son `.nc`.

**Règles de SheetCam mesurées sur le G-code (amorce type 1 = arc)** :

| Règle | Mesure |
|---|---|
| chemin | contour décalé de **kerf/2** (0,75), coins convexes **arrondis** au rayon kerf/2 (`G3 … I0 J0.75`), coins concaves vifs ; contour extérieur parcouru anti-horaire, trous horaires |
| amorce d'entrée | **quart de cercle** de rayon **0,64 × longueur** (5 → 3,2 ; le `Lead in` est la longueur d'arc), tangent au chemin au point de départ `P`, du côté CHUTE (extérieur pour le contour, intérieur du trou pour un trou) ; **point de perçage = P − r·t + r·n** (`t` direction de coupe en `P`, `n` normale vers la chute) |
| amorce de sortie | quart de cercle de rayon **0,64 × longueur** (10 → 6,4), du même côté, se terminant en **P + r·t + r·n** — plus grande que l'entrée ici : ne réserver que l'entrée était insuffisant par construction |
| perçage | `Pierce height 3,8`, descente à `Z1,5` sur le point de perçage ; aucune clé de rayon de perçage dans le texte — le 3 mm reste une marge à confirmer |

**Le point de départ de chaque contour est dans le bloc binaire**, et il est
lisible : entre les trois fichiers, seuls **six plages de 7 à 8 octets**
changent, soit **trois couples de doubles little-endian** (x à l'offset k,
y à k + 14 ; un enregistrement par contour, **pas de 179 octets**), exprimés
**par rapport au centre de la pièce** (`XPos`, `YPos`). Vérifié sur les neuf
valeurs : L-1 (−65,47 ; −10) → (24,53 ; 90) = départ du trou rectangulaire
dans le G-code ; (−90 ; −100) → (0 ; 0) = coin bas gauche du contour ;
(−76,32 ; −74,71) → départ du fuseau ; idem L-2 et L-3 au centième. Aucun
autre octet ne bouge : ni somme de contrôle, ni drapeau visible.

**Conséquence : la voie 2 du verdict du 13/09 (« imposer nous-mêmes le
point de départ ») ROUVRE.** Le §9.15 la fermait sur le texte seul ; le
binaire la porte. NestorCut peut choisir, après nesting, le point de départ
de chaque trou là où il reste de la place, et l'écrire — sous réserve de
savoir apparier un enregistrement à son contour (ordre des enregistrements
à établir), et de vérifier dans SheetCam qu'un fichier réécrit s'ouvre avec
le point déplacé.

**Ce que la série ne dit pas encore** : la règle PAR DÉFAUT du point de
départ (les trois fichiers ont des points déplacés à la main ; le
`Start position = 0` ne les gouverne plus), les amorces de type ligne et
« aucune », le comportement en pose tournée ou miroir, l'ordre des
enregistrements du binaire.

#### 9.39 Suite de la série — ce que le propriétaire fournit, dans l'ordre d'utilité

1. **Un fichier où RIEN n'est déplacé à la main**, par valeur de
   `Start position` (0, 1, 2, …, toutes celles que le menu propose), même
   pièce, arc 5 / arc 10 — c'est la règle par défaut, et la table des coins,
   pour le contour ET pour les deux trous.
2. **Les autres types d'amorce**, points non déplacés : type ligne, type
   « aucune », et tout type restant du menu ; entrée seule puis sortie seule.
3. **Pose** : la référence à `Angle` 45° et une fois en miroir (`HRef`).
4. **Un fichier de plus à points déplacés**, où UN SEUL contour est déplacé
   (le rectangulaire), puis un autre où seul le fuseau l'est : cela fixe
   l'ordre des enregistrements du binaire.
5. Kerf 0 et kerf 4 sur la référence (le décalage kerf/2 est déjà lisible,
   c'est une confirmation).

Les trois fichiers existants restent : ils ont livré le codage des points de
départ et les règles d'arc. Une dizaine de fichiers de plus suffisent.

**Lot J4-ter, périmètre mis à jour** : (a) module `shared/sheetcamLeads.js`
qui dessine l'enveloppe réelle depuis les clés du `.job` (chemin kerf/2,
arcs d'entrée et de sortie à 0,64 × L, point de perçage), verrou Hausdorff
≤ 0,1 mm contre chaque `.nc` de la série ; (b) lecture des points de départ
dans le binaire (`shared/sheetcamJob.js`, couples de doubles au pas de 179,
appariement par proximité au contour) et **écriture** d'un point choisi
après nesting, avec verrou de relecture octet à octet hors ces 16 octets par
contour ; (c) la réserve devient l'enveloppe au point choisi — ou rien si
`allowOverlappingLeads` ; (d) recette machine sur un fichier réécrit. Le
`.job` seul suffit en production ; les `.nc` restent des fixtures de test.

#### 9.40 Décisions du propriétaire (13/09, fin de soirée) et ce que L-1 apprend

**1. Espacement d'un nesting `.job` : la règle 3.10 est REMPLACÉE.** Le
propriétaire refuse `kerf + 2 × 0,25` pour un `.job` : la bande de kerf
est centrée sur le chemin d'outil, lui-même à kerf/2 du contour, donc elle
s'étend jusqu'à **un kerf entier** hors de chaque pièce. Deux pièces à moins
de **2 × kerf** ont des bandes qui se recouvrent : la seconde coupe traverse
de l'air déjà coupé (perte d'arc, bord rongé — le « grignotage » de la
capture était donc réel, la lecture « marge de 0,25 » du §9.37 était
fausse). **Règle** : `espacement = 2 × kerf + sécurité`, la sécurité étant
LE paramètre, **1 mm par défaut**, modifiable. Sur la recette (kerf 1,5) :
4 mm au lieu de 2. Conséquence attendue : les quatre éventails ne tiennent
plus ensemble dans le trou (mesuré au §9.19 dès 3,5 mm) — c'est un choix
de qualité de coupe, assumé.

**À livrer AVANT le déploiement de J4-bis** (l'ancienne règle n'a pas à
partir en production) : `spacingFromKerf` (`shared/sheetcamReserve.js`)
et `prefillFromJob` (`app/composables/sheetcamJobImport.js`) passent à
`2 × kerf + sécurité`, sécurité par défaut 1 mm ; le champ « sécurité »
pré-rempli à 1 ; tests et cas B du harnais alignés ; libellé d'aide EN + FR
« espacement = 2 × kerf + sécurité ». Lot **J4-bis-2**, une demi-journée,
puis rejeu des deux `.job` du harnais et déploiement.

**2. `Pièce L-1.job` est le fichier aux points de départ PAR DÉFAUT** (L-2 et
L-3 déplacés à la main). Ce que ses points disent, `Start position = 0` :

| contour | point de départ par défaut | remarque |
|---|---|---|
| extérieur (L) | **(0 ; 0), coin bas gauche** | cohérent avec `START_CORNERS[0]` = bas gauche |
| trou rectangulaire (10…40 × 90…190) | **(24,53 ; 90)**, sur l'arête du bas | ni un coin, ni un milieu (25), ni une extrémité d'entité DXF (les LINE vont de coin à coin) |
| trou en fuseau (ELLIPSE) | **(13,68 ; 25,3)**, pointe gauche | extrémité de l'ellipse, pas la première entité du DXF |

**Capture de la boîte d'opération (onglet « Cut path »)** : `Start position`
n'est pas une liste mais **cinq boutons** — les quatre coins d'un carré et
un bouton CENTRAL, coché dans tous les fichiers du propriétaire. **La valeur
0 est donc le bouton central = choix automatique de SheetCam**, pas un coin :
c'est pourquoi les points par défaut de L-1 ne sont pas aux coins (le
(0 ; 0) du contour extérieur est une coïncidence à vérifier). Les quatre
autres valeurs sont les coins, dans un ordre à mesurer : **quatre fichiers
« rien déplacé », un par bouton de coin**, avec leur `.nc`, suffisent pour
la table. L'onglet « Basic » donne aussi l'ordre des types d'amorce — None,
Arc, Tangent, Perpendicular = codes 0 à 3 — et un réglage « Start at the
centre of circles smaller than … » (perçage au centre des petits trous, à
mettre à 0 dans la série, à lire un jour dans le `.job`).

La règle AUTOMATIQUE des trous n'est pas élucidée par un fichier : les fichiers « rien déplacé » par valeur de
`Start position` (§9.39 point 1) restent nécessaires, et **les libellés du
menu `Start position` de SheetCam, dans l'ordre**, sont l'information la
moins chère — le propriétaire les relève.

**3. Priorité de J4-ter, tranchée par ces mesures** : puisque le point de
départ se LIT et s'ÉCRIT dans le binaire (§9.38), NestorCut impose le sien
après nesting — la règle par défaut ne gouverne plus que le cas
`allowOverlappingLeads` et le repli si l'écriture échoue. L'ordre des
travaux : lecture du binaire et appariement aux contours → enveloppe des
amorces (arcs 0,64 × L, entrée et sortie) → écriture du point de départ
choisi → recette machine sur un fichier réécrit.

#### 9.41 Série `retro-eng-job`, état du 13/09 à 19 h — inventaire et règles lues

**Douze `.job`** dans `.testparts/retro-eng-job/` (même DXF, `Start
position` toujours au bouton central) : L-1 (défaut, ancienne session), L-2
et L-3 (points déplacés), puis « none », « tangeant », « perpendicular »
(types 0, 2, 3, entrée 5 et sortie 10 du même type), « kerf0 » (0,0001) et
« kerf4 », « + 45deg », « mirror » (`HRef = 1`), « start rectangle moved »
et « start ellipse moved » (un seul contour déplacé). **Dix `.nc`** : il
manque ceux de **« + 45deg »** et **« mirror »**.

**Ce que le binaire confirme** (comparé octet à octet au fichier « none
default », référence) :

| Fichier | Octets qui changent | Lecture |
|---|---|---|
| kerf 4, + 45°, miroir | **aucun** | le point de départ stocké est en coordonnées LOCALES du dessin, indépendant du kerf, de la pose et du miroir ; les types d'amorce ne le touchent pas non plus |
| « start rectangle moved » | 3640–3656 (couple 1) + **un octet à 3722** | l'enregistrement 1 (offset 3635/3649) EST le trou rectangulaire ; l'octet à +87 de l'enregistrement passe probablement à « déplacé à la main » |
| « start ellipse moved » | 3993–4013 (couple 3) + **un octet à 4080** | l'enregistrement 3 EST le fuseau ; même octet de drapeau à +87 |
| L-1 | couples 1 et 3, plus une dizaine d'octets isolés | ancienne session : ses points « par défaut » (24,53 ; 90) et (13,68 ; 25,29) diffèrent du défaut actuel (25 ; 90) et (14,21 ; 27,44) — le défaut est recalculé, L-1 n'est pas la référence, « none default » l'est |

Donc l'enregistrement 2 (3814/3828) est le contour extérieur, et l'ordre
des enregistrements est **rectangle, extérieur, fuseau** — ni l'ordre des
entités du DXF (rectangle, extérieur, ellipse en dernier… cohérent) : à
vérifier sur un second dessin avant d'en faire une règle ; l'appariement
par proximité au contour reste la méthode sûre. **Points par défaut au
bouton central** : rectangle **(25 ; 90) = milieu de l'arête du bas**,
extérieur (0 ; 0), fuseau (14,21 ; 27,44) près de la pointe gauche — la
règle automatique n'est toujours pas une formule, mais elle n'a plus à
l'être.

**Règles d'amorce lues sur les `.nc`** (P = point de départ sur le chemin
décalé, t = direction de coupe en P, n = normale vers la chute, L =
longueur) :

| Type | Entrée | Sortie |
|---|---|---|
| 0 None | perçage EN P, aucun segment | aucun |
| 1 Arc | quart de cercle r = 0,64 L, du perçage P − r·t + r·n à P | quart de cercle r = 0,64 L, de P à P + r·t + r·n |
| 2 Tangent | segment droit de longueur L arrivant en P ; **dans le prolongement de l'arête** quand P est un coin (extérieur : de (−5 ; −0,75) à (0 ; −0,75)), **incliné de 22,5° vers la chute** quand P est au milieu d'une arête (rectangle : de (29,62 ; 92,66) à (25 ; 90,75)) — sinon le segment serait sur le trait | symétrique, à mesurer sur les `.nc` |
| 3 Perpendicular | segment droit de longueur L le long de n, du côté chute (rectangle : de (25 ; 95,75) à (25 ; 90,75)) | symétrique |
| kerf | chemin = contour décalé de **kerf/2** (0 → 0 ; 1,5 → 0,75 ; 4 → 2), coins convexes arrondis à ce rayon ; **la géométrie des amorces ne dépend pas du kerf** | |

**Ce qui manque pour clore la série** : les `.nc` de « + 45deg » et
« mirror » (post-traiter les deux fichiers existants) ; **quatre fichiers
« rien déplacé », un par bouton de COIN** de `Start position`, avec leur
`.nc` — c'est la table des coins, la seule inconnue qui reste avec une
valeur produit (le repli quand NestorCut n'écrit pas le point). Les
variantes « entrée seule / sortie seule » ne sont plus nécessaires : entrée
et sortie se lisent séparément dans le G-code.

#### 9.42 Série complète (13/09, 19 h 30) : trois faits qui changent le lot — dont un NO-GO

Dix-sept `.job`, dix-sept `.nc`. Les quatre fichiers de coin et les deux
`.nc` manquants sont là. Trois mesures, du plus grave au moins grave.

**1. La formule de pose du lot J4 (§9.18 point 1) est FAUSSE, celle du lot
J2 était juste.** Le fichier « + 45deg » (Angle = +0,785, XPos 90, YPos 100)
tranche : SheetCam **tourne le dessin autour de (XPos, YPos), qui est la
position monde du centre de la boîte NON tournée** (`c0`), sens horaire pour
un `Angle` positif. Testé sur les trois points de départ du G-code :

| contour | G-code (chemin décalé) | pivot `c0` (formule J2 : `XPos = t + R·c0`) | centre de la boîte TOURNÉE (J4, `placedBoxCentre`) |
|---|---|---|---|
| rectangle | (37,50 ; 139,42) | (37,0 ; 138,9), **écart 0,75 = kerf/2** | (82,9 ; 138,9), **écart 45,4 mm** |
| extérieur | (−44,88 ; 92,40) | (−44,4 ; 92,9), écart 0,75 | (1,6 ; 92,9), écart 46,5 |
| fuseau | (−14,65 ; 101,58) | (−14,9 ; 102,3), écart 0,75 | (31,1 ; 102,3), écart 45,7 |

Le lot J4 a remplacé `t + R(θ)·c` par le centre de la boîte tournée « pour
corriger 21 mm d'erreur à 45° » — c'est ce remplacement qui crée l'erreur,
de 45 mm ici. Les deux formules coïncident aux quarts de tour (la boîte
tournée est la boîte de la boîte), ce qui explique que la référence du
11/09, le harnais et tous les verrous soient restés verts. **Toute pose non
quart de tour d'un `.job` écrit par J4 est fausse** ; l'UI autorise 1 à 360
rotations. **NO-GO déploiement tant que ce n'est pas revenu à la formule
J2**, avec un verrou sur ce fichier (les trois points à ≤ 1 mm).
**Miroir** (`HRef = 1`) : `x' = 2·XPos − x`, `y` inchangé, vérifié sur les
trois contours à 0,75 près.

**2. `Start position` n'est PAS le coin de départ des contours.** Codes :
**centre = 0, haut gauche = 1, haut droit = 2, bas droit = 3, bas
gauche = 4**. Mais entre centre, haut gauche et haut droit, les trois points
de départ du G-code sont **identiques** (rectangle au MILIEU de l'arête du
bas, extérieur en (0 ; 0), fuseau à la pointe gauche) ; bas droit et bas
gauche ne changent que le fuseau (pointe droite) et l'ORDRE de coupe (fuseau
d'abord). Le réglage vit dans le cadre « Cut ordering » : c'est le **coin
d'où part la séquence de coupe**, pas le départ de chaque contour. Le point
de départ d'un contour est choisi par SheetCam (règle non formulée : milieu
d'arête pour le rectangle, sommet pour le L) et **il est écrit dans le bloc
binaire, à jour dans tous les cas mesurés** (le fuseau passé à la pointe
droite y est aussi passé). Conséquences : la prémisse `START_CORNERS` des
lots J3 et J4 tombe ; **la réserve aux quatre coins ne couvre pas le vrai
départ d'un trou rectangulaire** (milieu d'arête) — elle n'a protégé la
recette que parce que le trou est rond ; la seule réserve juste est celle
posée **au point lu dans le binaire**.

**3. Le reste est confirmé** : ordre des enregistrements (rectangle,
extérieur, fuseau), drapeau à +87 quand le point est déplacé, binaire
insensible au kerf, à la pose, au miroir et au type d'amorce ; règles
d'amorce du §9.41.

**Lot J4-bis-2, périmètre RÉVISÉ (bloquant avant déploiement)** :

1. Pose : revenir à `jobPlacement` (`t + R(θ)·c0`, lot J2) pour toutes les
   rotations ; retirer `placedBoxCentre` / `jobPlacementFromRings` du chemin
   (ou les garder inertes) ; verrou = les trois points de départ du fichier
   « + 45deg » reconstruits à ≤ 1 mm, et le miroir `x' = 2·XPos − x`.
2. Espacement `.job` = 2 × kerf + sécurité (1 mm par défaut), §9.40.
3. Réserve d'amorce **au point de départ lu dans le binaire** : lecture des
   enregistrements (couples de doubles relatifs au centre, pas de 179,
   appariement par proximité au contour — sur les 17 fichiers, chaque point
   lu est SUR son contour à 0,01 près) ; enveloppe = arc/segment selon le
   type et la longueur (§9.41), entrée ET sortie, plus le kerf ; si un point
   ne se lit pas ou n'est sur aucun contour, le trou sort du nesting (repli
   déjà codé) et le constat s'affiche. `START_CORNERS`,
   `startPositionConfirmed` et les quatre morsures disparaissent.
4. Fixture : la pièce L et sa série sont un dessin de test créé pour cela —
   **accord du propriétaire donné le 13/09** : copie de `Pièce L.DXF`, de deux
   `.job` (« none default », « + 45deg ») et de leurs `.nc` dans
   `app/tests/fixtures/sheetcam/`, pour que ces verrous vivent dans le dépôt.
5. Rejeu des deux `.job` du harnais, vérification, recette du propriétaire
   sur le fichier × 4 (espacement 4 mm, réserve au vrai point), déploiement.

**J4-ter, réduit** : écriture du point de départ choisi par NestorCut
(drapeau à +87 compris), option `allowOverlappingLeads`, recette machine sur
un fichier réécrit. Le mode automatique de SheetCam n'a plus à être compris.

#### 9.43 Lot J4-bis-2 — rapport de l'implémenteur (13/09, nuit)

Les cinq points du périmètre révisé du §9.42 sont livrés, commit `49beecfa`.
Ce rapport dit ce qui a été mesuré, avec quels chiffres, et ce qui ne l'a pas
été.

**1. La pose revient à la formule du lot J2.** `placedBoxCentre` et
`jobPlacementFromRings` ont disparu de `shared/sheetcamNest.js` ;
`nestedJobsPerSheet` n'a plus qu'un chemin, `t + R(θ)·c0`, et accepte encore
`rings` uniquement pour en MESURER `c0` (`boxCentreOfRings`).

Le verrou est une reconstruction, pas une tautologie. Il lit dans les
fixtures, et nulle part ailleurs : les extensions du dessin (`$EXTMIN` /
`$EXTMAX` du DXF, qui donnent c0 = (90 ; 100)), la pose du `.job`
(`XPos` 90, `YPos` 100, `Angle` +0,785398), les trois points de départ du bloc
binaire, et les trois points de départ du G-code que SheetCam a produit pour
ce fichier. Il retrouve la pose moteur par l'inverse de `jobPlacement`, puis
replace les trois points.

| contour | écart au G-code, formule J2 | écart, formule J4 |
|---|---|---|
| rectangle | **0,750 mm** | 45,4 mm |
| fuseau | **0,750 mm** | 45,7 mm |
| extérieur | **0,750 mm** | 46,5 mm |

Les 0,750 sont le décalage du chemin d'outil (kerf 1,5 ⇒ kerf/2), pas une
erreur : le point du binaire est sur le contour, le G-code coupe sur le
contour décalé. La consigne demandait ≤ 1 mm ; le verrou fige la mesure,
0,750 à trois décimales. La formule du lot J4 est reproduite DANS le test
comme contrôle négatif (elle n'existe plus dans `shared/`), et le test vérifie
aussi que les deux coïncident aux quarts de tour — c'est cela qui explique que
tous les verrous du lot J4 soient restés verts.

**Un détail d'appariement qui a failli me faire publier un faux chiffre** :
les enregistrements du binaire sont dans l'ordre du DESSIN (rectangle,
extérieur, fuseau), le G-code sort dans l'ORDRE DE COUPE. Apparier par index
donnait 30,9 mm d'écart — un chiffre qui aurait pu passer pour une erreur de
formule. C'est le champ `order` (0, 2, 1) qui les remet en face.

**2. L'espacement : `2 × kerf + sécurité`, sécurité 1 mm.**

**J'ai élargi le périmètre, et il faut que ce soit dit.** Le §9.40 nomme
`spacingFromKerf` et `prefillFromJob`. Ne toucher qu'eux n'aurait rien changé
à l'espacement réellement calculé : `prefillFromJob` n'écrit que `kerf` et
`sécurité` dans le projet, et c'est `app/utils/spacingParams.js` qui en dérive
le `space` envoyé au moteur, avec l'ancienne règle. Un `.job` à kerf 1,5 aurait
continué de nester à 3,5 mm pendant que le champ affichait 4. J'ai donc changé
la règle **pour tout le formulaire**, ce qui est aussi ce que dit la physique
de l'argument du propriétaire (la bande de kerf déborde d'un kerf entier, que
le job vienne d'un `.job` ou non).

Deux conséquences traitées :

- **Aucun projet existant ne change d'espacement.** Les deux champs sont en
  production depuis le chantier B.4. `withKerfDefaults` reconnaît un params
  écrit sous l'ancienne règle et recalcule la SÉCURITÉ pour que l'espacement
  effectif soit identique. Cas limite : quand deux kerfs dépassent déjà
  l'espacement du projet (kerf 1,5 pour 2 mm), on ne peut pas garder les deux —
  c'est l'ESPACEMENT qu'on préserve, il gouverne la géométrie livrée, et le
  kerf retombe à 0. Verrous : cinq cas dans `spacingParams.test.js`, dont
  l'idempotence et le refus de réécrire un params qui ne suit aucune des deux
  règles.
- **Le défaut d'usine reste 2 mm** : c'est la sécurité qui le porte (0 + 2 au
  lieu de 0 + 2 × 1).

Libellés EN et FR mis à jour (`settings.spacingRule`,
`jobImport.spacingFromJob`), avec leur verrou de parité.

**3. La réserve d'amorce est posée au point de départ LU.**

`jobPathRecords` (`shared/sheetcamJob.js`) lit le bloc binaire comme un flux
`tag | type | longueur | charge`. Il rend `null` plutôt qu'une liste partielle
si le flux ne retombe pas exactement sur la fin du fichier. **Mesure : les 39
`.job` disponibles sur ce poste se relisent tous jusqu'au dernier octet**, et
le nombre de blocs de dessin égale toujours le nombre de noms de dessin
distincts (39 sur 39) — c'est ce qui autorise l'appariement bloc ↔ dessin.

Ce que le lot retire : `START_CORNERS`, `predictedStartIndex`,
`cornerStartIndices`, `startPositionConfirmed`, `withLeadInReserve`,
`holeBite` et les quatre morsures. Ce qu'il met à la place : une seule
fonction, `biteAtStart`, paramétrée par le côté « chute ».

**L'enveloppe couvre ce que la torche brûle**, et chaque morceau est mesuré
sur les `.nc` de la série :

| type | entrée | sortie |
|---|---|---|
| 0 None | perçage AU point | rien |
| 1 Arc | quart de cercle r = 0,64 L | quart de cercle r = 0,64 L |
| 2 Tangent | segment L, incliné de 0 à 22,5° vers la chute | idem |
| 3 Perpendicular | segment L selon la normale | idem |

S'y ajoutent le décalage kerf/2 du chemin et le demi-kerf de part et d'autre
du trajet. Pour la tangente, l'angle exact n'est pas une formule connue (0°
sur un coin, 22,5° à l'entrée au milieu d'une arête, 11,25° à la sortie) : on
réserve l'ÉVENTAIL complet plutôt que de parier.

**Deux repères de coupe, et non un.** Un contour fermé part du point de départ
par une arête et y revient par une autre. Au milieu d'une arête c'est la même
— tous les trous mesurés. Sur un COIN elles diffèrent, et l'amorce de sortie
suit l'arête d'ARRIVÉE : sur le contour extérieur de `Pièce L`, départ au coin
(0 ; 0), amorce perpendiculaire de 10 mm, la sortie va de (−0,75 ; 0) à
(−10,75 ; 0) — selon la normale de l'arête GAUCHE, pas de l'arête basse par
laquelle la coupe a commencé. Avec un seul repère, **4 points de trajet sur 36
sortaient de la réserve**, tous des sorties de contour extérieur.

**Un second défaut trouvé en route** : le lot J4 choisissait, des deux tours
de l'enveloppe, « le plus long ». Cela marchait tant que l'enveloppe était
franchement décalée vers la chute. Avec une amorce de type « None », le disque
de perçage est à CHEVAL sur le contour, les deux tours ont presque la même
longueur, et le mauvais est choisi : **5 des 32 sommets du disque restaient
dans la zone libre**. Le critère est maintenant le CÔTÉ (la projection moyenne
sur la normale de chute), pas la longueur.

**LE VERROU CENTRAL, et c'est une mesure.** On échantillonne les trajets
d'amorce RÉELS des `.nc` (arcs redéveloppés depuis leur centre `I`/`J`, pas
leur corde), on les ramène dans le repère du dessin par l'inverse de la pose
quand le fichier est tourné, et on exige qu'aucun point ne reste dans la zone
où NestorCut poserait une pièce :

- **36 points sur 36 réservés**, quatre types d'amorce, trou et contour
  extérieur ;
- contrôle négatif : sans réserve, ces mêmes points SONT dans la zone utile ;
- second contrôle négatif : amorce 0 + perçage 3, le cercle de perçage réel
  (rayon 3, 64 points) est entièrement hors de la zone libre après morsure, et
  à moitié dedans avant.

**Le prix.** Sur le trou de la recette (cercle r 35, amorce 5, sortie 10,
kerf 1,5, perçage 3) : **2,74 %** de l'aire du trou, bouche de 9,38 mm. Sur la
pièce hôte, le contour grossit de **1,08 %**. À comparer aux **40 %** qu'aurait
coûté la couronne intérieure complète du §9.19. La réserve du lot J4 coûtait
4,6 % pour quatre morsures aux mauvais endroits.

**Ce qui se passe quand on ne sait pas.** Un trou dont le point de départ ne
se lit pas, ou n'est sur aucun contour à 0,5 mm, SORT du nesting — il
disparaît de `holes`, plus rien ne s'y niche, et le constat s'affiche dans le
rapport (`sheetcamReserve.startNotRead`, libellé EN + FR). Le contour
extérieur, lui, reste tel quel avec sa raison : le gonfler au hasard
promettrait une place que l'amorce ne prendra pas là.

**4. Les fixtures entrent dans le dépôt.** `piece-l.dxf`,
`piece-l-none-default.job` / `.nc`, `piece-l-45deg.job` / `.nc` dans
`app/tests/fixtures/sheetcam/` (accord du propriétaire du 13/09). Les verrous
de pose ET de réserve lisent ces fichiers, pas des constantes recopiées.

**5. Contrôle croisé ajouté.** Le bloc binaire porte, par dessin, le centre de
boîte que SheetCam a mémorisé. Les points de départ y sont relatifs. Nous
mesurons ce centre sur NOTRE géométrie importée ; un écart entre les deux
ferait tomber tous les points à côté des contours. L'écart est donc calculé et
publié dans le constat (`originGapMm`), et le harnais le vérifie.

**6. CE QUE LE BANC A TROUVÉ, ET QUE PERSONNE N'AVAIT VU.**

Les trois verrous neufs du harnais (`F1` à `F4`, qui lisent les constats de
réserve dans la fiche IndexedDB) ont échoué au premier passage. Deux causes,
toutes deux réelles.

**(a) Il y a DEUX origines, et ce n'est pas une erreur.** Les points de départ
du bloc binaire sont relatifs à l'origine que SheetCam mémorise pour le dessin
(le premier enregistrement de son bloc). L'origine de la POSE, elle, est le
centre de la boîte de la géométrie de COUPE. Sur `Pièce L` les deux valent
(90 ; 100) et rien ne les distingue — c'est pourquoi le §9.42 n'a pas eu à
trancher. Sur `Piece_Fillx4` elles diffèrent de **1,414 mm**.

Les deux sont vérifiées, chacune contre un fichier écrit par SheetCam :

- l'origine de POSE, par résolution EXACTE du fichier de référence posé à la
  main. Les quatre exemplaires du moulinet donnent quatre équations
  `XPos_k = t + R(θ_k)·(0, c)` ; leur solution est `c = 16,828` sur les deux
  axes avec `t = (50 ; 50)` sur les quatre. Aucune hypothèse : c'est le
  fichier qui donne `c`, pas moi ;
- l'origine des POINTS, par le fait qu'ils ATTERRISSENT sur les contours.
  (0 ; 2,8284) est le milieu de l'arête basse de l'éventail ; avec l'autre
  origine on obtient (0 ; 4,24), qui n'est sur rien.

J'avais d'abord codé la première pour les deux, et ajouté un « contrôle »
qui exigeait qu'elles soient égales. Le contrôle a sonné : c'était sa
prémisse qui était fausse, pas le fichier. Les points tombaient 1,414 mm à
côté des contours, hors de la tolérance de 0,5 mm, et TOUS les trous du
dessin sortaient du nesting. Le harnais l'a dit avant le propriétaire.

**(b) Une entité POINT, dans les deux DXF de la recette.** `Piece_Trou.DXF` et
`Piece_Fillx4.DXF` portent chacune un `POINT` à (0 ; 0) — vérifié dans le DXF,
et c'est exactement l'enregistrement de chemin surnuméraire du bloc binaire
(3 chemins pour 2 contours, 2 chemins pour 1 contour). Notre import ne retient
pas les POINT (pas d'aire), donc ce chemin n'a **aucun contour chez nous**.

Sur `Piece_Fillx4` le point est sous la pièce : sans conséquence.
Sur `Piece_Trou`, il est **au CENTRE DU TROU** — exactement là où nous
nichons les quatre éventails.

**QUESTION AU PROPRIÉTAIRE, et elle est bloquante pour la recette.**
*SheetCam amorce-t-il vraiment sur une entité POINT ?* La série
`retro-eng-job` n'en contient aucune, aucun `.nc` ne tranche, et je ne peux
pas l'inventer. Post-traiter `Piece_Trou+Fill_x4_OK.job` et regarder si le
G-code contient un perçage au centre du trou répond en deux minutes.

En attendant, j'applique la règle du §9.42 point 3 à l'endroit exact du
danger : **le trou qui contient un perçage errant sort du nesting**, avec sa
raison en clair (`sheetcamReserve.strayPierce`, EN + FR). Le prix est visible
et il est lourd : sur la recette, les quatre éventails ne se nichent plus dans
le trou, ils se posent à côté. Les cinq pièces sont bien placées (5 / 5), le
`.job` rendu est correct, mais **la recette ne montre plus le nichage**.

Si la réponse est « SheetCam ignore les POINT », une ligne tombe et le nichage
revient. Si c'est « il perce », alors nous venons d'éviter un éventail troué,
et il faudra dire au propriétaire de nettoyer ses DXF.

**Non-faits, dits franchement :**

- **Le rayon de perçage reste à 3 mm par défaut, non confirmé sur la
  machine.** Il gouverne directement la taille de la morsure.
- **Le miroir Python n'est pas fait** : la réserve, la lecture du binaire et
  la pose `.job` vivent dans le chemin navigateur seulement. C'est le lot J5
  (miroir serveur), inchangé.
- **L'angle exact d'une amorce tangente n'est pas une formule connue** : on
  réserve l'éventail 0 … 22,5°, ce qui coûte un peu plus que la vérité.
- **Le harnais ne mesure plus D10** (ordre de coupe des pièces nichées) sur ce
  fichier, puisqu'il n'y a plus de pièce nichée. Ce n'est pas une régression
  du code, c'est la conséquence de (b) ; le verrou revient dès que la question
  est tranchée.

**Mesures du lot (toutes rejouées sur ce poste, images à HEAD) :**

| banc | résultat |
|---|---|
| `npx vitest run` | **717** passés, 63 fichiers |
| `npx nuxt build` | vert |
| `docker compose build app` | vert |
| harnais `qa-e2e-job.mjs`, `Piece_Trou+Fill_x4_OK.job` | **tous les verrous verts**, 5 / 5 pièces |
| harnais, `Piece_Trou.job` | **tous les verrous verts**, 1 / 1 |
| harnais, `Piece_Trou+Fill.job` | **tous les verrous verts**, 2 / 2 |

Le harnais porte cinq verrous neufs : `B1b` et `B1c` (kerf, sécurité et règle
affichée — c'est là que les 4 mm se lisent à l'écran), et `F1` à `F4` (la
réserve d'amorce telle que la fiche la persiste). `F2` et `F4` sont des
verrous de SÛRETÉ et non des verrous de « rien ne s'est passé » : ils exigent
qu'aucun trou ne sorte du nesting sans raison nommée, et que tout perçage
tombant dans une zone nichable ait bien fait sortir cette zone.
