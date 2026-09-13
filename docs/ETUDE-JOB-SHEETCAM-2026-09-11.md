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
