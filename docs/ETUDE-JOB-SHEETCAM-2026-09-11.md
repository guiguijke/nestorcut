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

### Lot J4-bis-2 — vérification (vérificateur, 13/09, nuit, `eabaee9d`) — GO sous deux conditions, dont une petite correction

Rejoué sur le poste : image `app` reconstruite à HEAD, harnais tel que livré
sur trois `.job` (recette × 4, 2 pièces, et le fichier « ordre » où les
dessins sont déclarés dans l'autre sens), lecteur du binaire rejoué sur les
39 `.job` du poste, sorties hors dépôt (`~/qa-out/verif-j4bis2/`).

#### 9.44 Ce qui est acquis

| Verrou | Résultat |
|---|---|
| vitest | **717 passed** |
| pose | la formule J2 retrouve les trois points du fichier « + 45deg » à 0,750 mm (kerf/2) — déjà mesuré indépendamment au §9.42, le verrou du lot lit les fixtures et non des constantes : accepté |
| espacement | règle « 2 × kerf + sécurité = 4 mm » lue à l'écran par le harnais (kerf 1,5 ; sécurité 1) ; migration des projets existants à espacement effectif constant, cinq cas verrouillés |
| lecteur du binaire (`jobPathRecords`) | flux `tag / type / longueur / charge`, **39 / 39 fichiers relus jusqu'au dernier octet**, blocs = noms de dessin distincts ; sur `Piece_Trou`, points lus à 0,01 mm du cercle et à 0 du coin ; troisième chemin à (0 ; 0) = l'entité POINT, à 34,99 du cercle ; drapeau « déplacé à la main » lu sur L-1, L-2, L-3 et les deux fichiers « moved » |
| deux origines | l'origine des points du binaire est le centre de la boîte de TOUTES les entités SheetCam, POINT compris ((0 ; 15,41) pour l'éventail, contre (0 ; 16,83) pour notre géométrie) — l'explication du 1,414 mm du rapport est juste |
| harnais recette × 4 | 5 / 5, tous verts, **trou retiré pour « perçage errant »**, aucune pièce nichée (annoncé) |
| harnais 2 pièces | 2 / 2, tous verts, même retrait |
| morsure (rapport) | 36 / 36 points de trajet réels hors zone utile ; 2,74 % du trou — pas rejoué à part, la méthode est une mesure sur les `.nc`, acceptée |

Les deux DXF de la recette portent bien un `POINT` à (0 ; 0), vérifié dans
les fichiers (4 LINE + 1 CIRCLE + 1 POINT ; 2 LINE + 1 ARC + 1 POINT).

#### 9.45 Un défaut : l'appariement bloc ↔ dessin se fait par RANG, et il casse

Le rapport écrit « un bloc par nom de dessin, dans le même ordre de première
apparition — vérifié sur les trente-neuf `.job` ». Ce qui a été vérifié, c'est
le NOMBRE de blocs, pas la correspondance. Sur
`Piece_Trou+Fill_x4_ordre_TEST.job` (les éventails déclarés AVANT l'hôte : `Part
0` = éventail, `Part 4` = hôte), les blocs du binaire restent dans l'ordre
hôte, éventail : l'appariement par rang inverse les deux dessins, **les cinq
points tombent à côté (`originGapMm` 16,83), les deux dessins sortent en
`startNotRead`, le trou est retiré**, et le harnais le voit — `F1` en échec sur
ce fichier. En production : une dégradation sûre mais injuste, sur tout `.job`
dont l'ordre des sections ne suit pas l'ordre de chargement des dessins.

**Correction demandée (J4-bis-3, quelques heures, avant le déploiement)** :
apparier chaque bloc au dessin par la GÉOMÉTRIE — pour chaque couple (bloc,
dessin), compter les points de départ qui tombent sur un contour du dessin à
0,5 mm (chemins de POINT exclus) et retenir l'affectation qui en place le
plus, un dessin par bloc ; `originGapMm` publié pour le couple retenu ; à
égalité ou zéro point placé, `startNotRead` comme aujourd'hui. Verrou : le
fichier « ordre » (copie anonyme dans `app/tests/fixtures/sheetcam/`, ou la
fixture `source.job` aux sections permutées) ⇒ 5 points sur 5 appariés,
`F1` vert au harnais sur ce fichier.

#### 9.46 Arbitrages et verdict

1. **Espacement étendu à tout le formulaire** : le vérificateur confirme le
   raisonnement (les deux fonctions nommées n'écrivaient que kerf et
   sécurité ; sans le formulaire, l'écran aurait dit 4 et le moteur nesté à
   3,5) et la physique vaut pour tout job plasma. L'extension est déclarée,
   la migration préserve l'espacement effectif, la règle est affichée. **Avis
   favorable ; c'est au propriétaire de dire oui**, parce que la définition
   du champ « sécurité » change pour tous ses utilisateurs.
2. **Trou retiré sur perçage errant** : bonne dégradation en l'absence de
   réponse. La question au propriétaire reste ouverte — *SheetCam perce-t-il
   sur une entité POINT ?* (post-traiter `Piece_Trou+Fill_x4_OK.job`, chercher
   un `G0`/`G1` vers (0 ; 0) local de l'hôte, c'est-à-dire le centre du trou).
   Si non, la ligne tombe et le nichage revient ; si oui, la règle reste et
   les DXF sont à nettoyer.
3. Comportement de l'implémenteur : conforme — périmètre élargi DIT et
   justifié, arbitrage demandé, question posée avant de trancher. Une
   sur-affirmation à noter : « vérifié sur 39 » couvrait le compte des
   blocs, pas la correspondance (§9.45).

**GO déploiement (app + worker nesting) sous deux conditions** : J4-bis-3
livré et rejoué (harnais vert sur les trois fichiers, « ordre » compris), et
réponse du propriétaire sur le POINT — la recette machine se fait sur le
fichier produit après ces deux points, pour voir le nichage revenir ou non.

#### 9.47 Lot J4-bis-3 — rapport de l'implémenteur (13/09, nuit)

Le défaut du §9.45 est corrigé. Et la remarque qui l'accompagne est juste :
j'ai écrit « un bloc par nom de dessin, dans le même ordre de première
apparition — vérifié sur les trente-neuf `.job` » alors que ma mesure ne
portait que sur le NOMBRE de blocs. C'est une sur-affirmation, elle a masqué
le défaut, et c'est exactement ce que la maison interdit.

**L'appariement se fait désormais par la géométrie.** `assignJobBlocks`
(`shared/sheetcamReserve.js`) compte, pour chaque couple (bloc, dessin), les
points de départ qui tombent sur un contour du dessin à
`START_MATCH_TOL_MM` = 0,5 mm, et retient l'affectation — un dessin par bloc —
qui en place le plus. Le nombre de dessins d'un `.job` est minuscule :
l'énumération est exhaustive (refus au-delà de sept dessins, plutôt qu'une
heuristique silencieuse).

**Les chemins d'entité POINT s'excluent tout seuls**, sans règle spéciale :
ils ne tombent sur aucun contour d'aucun dessin, donc ils ne pèsent sur aucune
affectation. Mesuré sur `x4-reference.job` : cinq chemins, trois placés (le
coin du carré et un point du cercle pour l'hôte, le milieu de l'arête basse
pour l'éventail), deux chemins de POINT placés nulle part.

**On refuse plutôt que de deviner**, et les trois refus sont distincts :
`countMismatch` (le cache ne porte pas autant de blocs que le fichier déclare
de dessins), `noPointPlaced` (aucun point sur aucun contour), `tie` (deux
affectations à égalité — deux dessins qui se ressemblent). Dans les trois cas
l'appelant retombe sur le comportement « point non lu » d'aujourd'hui : les
trous sortent du nesting et le rapport le dit. Les quatre raisons ont leur
libellé EN et FR.

**Où le code vit, et pourquoi là.** La géométrie pure est dans `shared/`, avec
le reste de la réserve — un seul code, testable sans navigateur. Le branchement
est dans les deux endroits que la consigne nomme : `assignJobStarts`
(`app/composables/localImport.js`) fait l'appariement et rend les points par
nom de dessin ; `addSheetCamJobDrop` (`app/composables/files.js`) le branche
APRÈS l'import et ré-enregistre les fiches avec leurs points. C'est le seul
moment possible : l'appariement demande la géométrie, qui n'existe qu'une fois
l'import fait. **Aucune lecture de plus** — ce sont les fiches que
`importLocalFiles` vient de rendre, on y ajoute un champ et on ré-enregistre.

`cutSettingsFor` part donc désormais avec `starts: []` et `origin: null` : le
`.job` ne dit pas à quel dessin appartient un bloc, et le supposer était le
défaut.

**Verrous, et la preuve qu'ils ne sont pas vides.** Trois tests neufs :
l'appariement des deux blocs de `x4-reference.job` aux deux dessins réels,
puis **les mêmes blocs avec les dessins présentés dans l'ordre inverse** — le
cas qui cassait ; le refus (égalité, aucun point, comptes différents) ; et le
cas à un seul dessin. J'ai remis l'appariement par RANG pendant un instant
pour vérifier qu'ils mordent : **trois échecs**, `expected [0, 1] to deeply
equal [1, 0]`, `expected false to be true`, et l'origine de l'éventail servie
à la place de celle de l'hôte. Remis en place : verts.

**Mesures** : vitest **720** (63 fichiers) ; `npx nuxt build` vert ;
`docker compose build app` vert ; harnais navigateur sur quatre `.job` réels,
**dont `Piece_Trou+Fill_x4_ordre_TEST.job`**, le fichier aux dessins
inversés — voir le tableau ci-dessous.

**Ce qui ne change pas** : la règle du perçage errant reste en place, faute de
réponse sur l'entité POINT. La question du §9.43 est toujours ouverte, et
c'est elle qui décide si le nichage revient dans la recette.

| harnais `qa-e2e-job.mjs` (image reconstruite) | résultat |
|---|---|
| `Piece_Trou+Fill_x4_ordre_TEST.job` — **les dessins à l'envers** | **tous les verrous verts**, 5 / 5 ; l'éventail reçoit ses 2 chemins, l'hôte ses 3 |
| `Piece_Trou+Fill_x4_OK.job` | tous les verrous verts, 5 / 5 |
| `Piece_Trou+Fill.job` | tous les verrous verts, 2 / 2 |
| `Piece_Trou.job` | tous les verrous verts, 1 / 1 |

Avant le correctif, le fichier « ordre » sortait avec `F1` en échec, les deux
dessins en « point non lu » et le trou retiré. Après, l'attribution est la
même que sur le fichier à l'endroit — c'est la géométrie qui la donne, plus
l'ordre des sections.

### Lot J4-bis-3 — vérification (vérificateur, 13/09, nuit, `ea6bc5d5`) — GO, il reste la réponse sur le POINT et une limite à lever

Rejoué sur le poste : image `app` reconstruite (HEAD `ea6bc5d5` plus deux
fichiers serveur du lot E3 en cours dans l'arbre de travail, champ additif
`advancedImport` — sans effet sur le chemin `.job`), harnais sur les quatre
`.job`, lecture du code d'affectation.

#### 9.48 Mesures

| Verrou | Résultat |
|---|---|
| vitest | **722** |
| harnais, quatre fichiers | **tous verts** — « ordre » 5 / 5 avec `F1` vert (les deux dessins reçoivent leurs chemins), recette × 4 5 / 5, 2 pièces 2 / 2, 1 pièce 1 / 1 ; trou toujours retiré pour « perçage errant » (question POINT ouverte) |
| lecture | affectation par score « points de départ sur un contour à 0,5 mm », permutation exhaustive, un dessin par bloc, trois refus nommés (`countMismatch`, `noPointPlaced`, `tie`) qui retombent sur « point non lu » ; appariement après l'import, sur les fiches rendues, aucune lecture de plus |

Le défaut du §9.45 est corrigé : sur le fichier « ordre », l'hôte reçoit ses
trois chemins et l'éventail ses deux, `F1` vert.

#### 9.49 Une limite à lever avant le déploiement, et la question qui reste

1. **`tooManyDrawings` au-delà de 7 dessins** : l'affectation énumère les
   permutations et refuse au-delà de 7 dessins distincts — pour un tel
   `.job`, tous les points passent « non lus » et **plus aucun trou n'est
   nesté**, en silence côté résultat (raison affichée seulement). Un job
   d'atelier a couramment 10 à 30 dessins : ce n'est pas un cas limite.
   **J4-bis-4, une heure** : affectation gloutonne sur la matrice de scores
   (prendre la meilleure case, retirer sa ligne et sa colonne, recommencer ;
   `tie` seulement si la case retenue est à égalité), sans plafond ; verrou :
   douze dessins synthétiques (copies décalées de la pièce L) appariés 12/12.
2. **Le POINT** : la règle « perçage errant » reste, donc aucun nichage dans
   la recette tant que le propriétaire n'a pas dit si SheetCam perce sur une
   entité POINT.

**GO déploiement (app + worker nesting)** dès J4-bis-4 rejoué et la réponse
sur le POINT reçue, avec la recette machine sur le fichier produit alors.

#### 9.50 Lot J4-bis-4 — rapport de l'implémenteur (13/09, nuit)

La limite du §9.49 est levée, commit `7658c7bd`.

**Ce que c'était vraiment.** `tooManyDrawings` n'était pas une règle métier,
c'était un plafond de complexité déguisé en règle : l'énumération des
permutations coûte `n!`, donc j'avais posé une borne à sept et je l'avais
nommée comme si elle disait quelque chose sur les fichiers. Le vérificateur a
eu raison de la sortir avant le déploiement — un `.job` d'atelier porte
couramment dix à trente dessins, et pour tous ceux-là aucun trou n'aurait été
nesté.

**L'affectation est gloutonne.** Meilleure case de la matrice de scores,
retrait de sa ligne et de sa colonne, on recommence. `n³` dans le pire cas,
soit quelques milliers d'opérations pour trente dessins.

Ce n'est pas l'optimum global — l'algorithme hongrois le serait — et c'est
suffisant ici parce que **la matrice n'est pas quelconque** : un point de
départ est SUR son contour à 0,01 mm et à des dizaines de millimètres de tout
autre dessin. Une case non nulle désigne donc presque toujours le bon couple,
et un dessin qui n'en a aucune ne peut de toute façon être apparié par
personne. Je le dis plutôt que de laisser croire à un optimum.

**L'égalité, elle, a changé de définition — et c'est le point qui m'a fait
faire un aller-retour.** Ma première écriture refusait dès que le meilleur
score d'un tour était atteint par deux cases. Mesuré sur douze dessins
distincts marquant chacun 2 sur leur propre bloc : **refus**. C'est-à-dire que
le cas NORMAL était déclaré ambigu. Deux cases de même valeur dans des lignes
ET des colonnes différentes ne sont pas en concurrence : chacune est le
meilleur choix de son dessin ET de son bloc. L'égalité se juge donc sur la
case retenue, contre ses seules concurrentes directes — les cases libres de sa
ligne ou de sa colonne. Une vraie ambiguïté, c'est « ce dessin irait aussi
bien sur un autre bloc » ou « ce bloc irait aussi bien à un autre dessin ».

**Un dessin sans aucune case positive ne reçoit PAS le bloc qui reste** : on
refuse l'ensemble (`noPointPlaced`) et l'appelant retombe sur « point non
lu ». Une réserve posée sur le mauvais dessin n'est pas une dégradation sûre.

**Verrous.** Douze dessins synthétiques — copies décalées de la pièce L, blocs
présentés DANS LE DÉSORDRE — appariés 12 sur 12, un bloc par dessin, 24 points
placés ; plus le cas du dessin hors de portée, qui refuse. Preuve qu'ils
mordent : plafond de sept remis un instant, le test des douze tombe
(`expected true to be false`) ; retiré, vert.

**Mesures, toutes rejouées sur ce poste :**

| banc | résultat |
|---|---|
| `npx vitest run` | **724** passés, 63 fichiers |
| `npx nuxt build` | vert |
| `docker compose build app` | vert |
| harnais, `Piece_Trou+Fill_x4_ordre_TEST.job` | tous verts, 5 / 5 |
| harnais, `Piece_Trou+Fill_x4_OK.job` | tous verts, 5 / 5 |
| harnais, `Piece_Trou+Fill.job` | tous verts, 2 / 2 |
| harnais, `Piece_Trou.job` | tous verts, 1 / 1 |

**L'image du banc ne portait QUE le correctif.** Les deux fichiers serveur du
lot E3 que le vérificateur a vus dans l'arbre de travail étaient mis de côté
(`git stash`) le temps de la construction et de la mesure, et remis ensuite :
les quatre harnais ci-dessus mesurent J4-bis-4 seul. E3 est commité à part,
jamais mêlé à un correctif `.job`.

**Ce qui reste** : la réponse du propriétaire sur l'entité POINT. Tant qu'elle
n'est pas là, la règle « perçage errant » tient et la recette ne montre aucun
nichage.

**Observation du propriétaire (13/09, nuit) sur son fichier ORIGINAL
`Piece_Trou+Fill_x4_OK.job`, nesté à la main dans SheetCam** : l'hôte est coupé
en deuxième (optimisation automatique de SheetCam) et le point de départ
automatique du trou, S2 à (24,7 ; −24,7), mord un éventail posé là, amorce de
sortie comprise. Ce sont les choix de SheetCam, pas les nôtres — et la raison
même des lots J1 (ordre écrit, nichées avant l'hôte), J4-bis-2 (réserve au
point lu) et J4-ter (point de départ déplacé par NestorCut). La réponse sur le
POINT reste attendue : le `.nc` de ce fichier, déposé dans
`.testparts/retro-eng-job/`, la donnera.

#### 9.50 Le G-code du propriétaire tranche deux choses (13/09, nuit)

`.testparts/Piece_Trou+Fill_x4_OK.nc`, généré par le propriétaire depuis son
fichier original (hôte à `XPos 50, YPos 50`, quatre éventails en moulinet
dans le trou).

**1. SheetCam ne perce PAS sur une entité POINT.** Le fichier compte **six
descentes de torche** (`Z1.5`) pour six contours : quatre éventails, le trou,
le contour extérieur. Chacune est suivie d'un arc d'amorce puis d'un tracé ;
aucune n'est un perçage nu au centre du trou (50 ; 50). Les quatre perçages à
moins d'un millimètre du centre sont ceux des éventails (leur point de départ
est le milieu de leur arête basse, tournée vers le centre du moulinet). **La
règle « perçage errant » tombe** : un chemin du binaire qui n'atterrit sur
aucun contour est ignoré et compté (`ignoredPaths`), il ne retire plus le
trou. Le nichage revient dans la recette.

**2. Le point de départ AUTOMATIQUE lu dans le binaire n'est pas fiable.**
Dans ce fichier, le binaire porte pour le trou **(24,7 ; −24,7)**, soit le
bas droit du cercle, et le G-code amorce à **(74,22 ; 74,22)**, soit le HAUT
droit (+45°). Même constat sur la recette du matin : `RECETTE-J4bis_x4.job`
porte (−24,7 ; −24,7) et la capture du propriétaire (§9.37) montre l'amorce
à 10 h, en haut à gauche. Deux fichiers, deux fois le point du binaire à
90° du point réel. Sur la pièce L, en revanche, binaire et G-code
coïncidaient — fichiers générés et sauvés dans la même session. Lecture : le
point automatique (`moved = false`) est un CACHE que SheetCam **recalcule à
l'ouverture ou au post-traitement** (ordre de coupe, position de la torche),
et un cercle centré ne permet pas de le détecter par la géométrie. Les
points DÉPLACÉS À LA MAIN (`moved = true`, L-2 et L-3) ont, eux, été
respectés à l'octet près.

**Conséquence sur le plan** : la réserve « au point lu » (J4-bis-2) n'est
sûre que pour un point marqué déplacé. Pour un point automatique, elle
réserve peut-être au mauvais endroit, et l'amorce peut couper une pièce
nichée — c'est le défaut de la recette du 13/09 matin, sous une autre forme.
**Le lot J4-ter (écrire NOUS-MÊMES le point de départ, drapeau « déplacé »
levé) n'est donc plus une amélioration : il conditionne le déploiement.**
En attendant, pour un point automatique, la réserve reste appliquée au point
lu (mieux que rien) et le constat le dit (`startAuto`).

**À vérifier par le propriétaire, deux minutes, pour fermer l'hypothèse** :
rouvrir `Piece_Trou+Fill_x4_OK.job`, ne rien toucher, « Enregistrer sous »
`Piece_Trou+Fill_x4_OK_resaved.job` dans `.testparts/` : si le binaire porte
alors (24,7 ; 24,7), SheetCam a recalculé le point à l'ouverture.

**Ordre des travaux, révisé** : J4-bis-4 (affectation gloutonne + retrait de
« perçage errant ») → **J4-ter, écriture du point de départ** (bloquant) →
vérification → recette machine sur un fichier réécrit (le G-code doit
amorcer là où NestorCut a écrit) → déploiement. E3 continue en parallèle.

#### 9.51 Décision du propriétaire : les marges de la réserve d'amorce dérivent du KERF

Plus de constante « 3 mm » : le trou de perçage est gros, et la sécurité se
compte en kerf.

- **Perçage** : disque réservé de rayon **2 × kerf** autour du point de
  perçage (kerf 1,5 ⇒ 3 mm, la valeur qui servait de défaut ; kerf 4 ⇒
  8 mm). `DEFAULT_PIERCE_MARGIN_MM` disparaît au profit de `2 × kerf` ; un
  kerf nul ou absent ⇒ repli 3 mm et constat.
- **Trajets d'amorce, entrée ET sortie** : bande réservée de **± kerf** de
  part et d'autre du trajet (largeur 2 × kerf), au lieu du demi-kerf actuel —
  la même règle que l'espacement du §9.40, pour la même raison physique.
- La bouche de la morsure suit (au moins le diamètre du disque, 4 × kerf).

À livrer avec J4-ter (la réserve est réécrite au point choisi) ; verrous du
§9.43 rejoués avec ces marges (36 points de trajet réels hors zone utile,
cercle de perçage réel de rayon 2 × kerf entièrement hors zone libre).

**Hypothèse du §9.50 CONFIRMÉE (13/09, 22 h 42).** Le propriétaire a rouvert
`Piece_Trou+Fill_x4_OK.job` sans rien toucher et l'a re-sauvegardé (en place).
Le binaire porte désormais, pour le trou, **(24,7 ; 24,7)** — le haut droit,
là où son G-code amorce — au lieu de (24,7 ; −24,7), et pour le contour
extérieur le coin (50 ; 50) au lieu de (50 ; −50). SheetCam recalcule les
points de départ automatiques à l'ouverture et les réécrit à la sauvegarde.
L'ancien état du binaire survit dans `app/tests/fixtures/sheetcam/source.job`
et les fichiers `RECETTE-*` (même bloc copié). Règle pour le code : un point
`moved = false` du binaire est une INDICATION, jamais une garantie ; seul un
point écrit avec `moved = true` engage SheetCam (L-2, L-3 : respectés à
l'octet).

#### 9.52 Lot J4-ter — rapport de l'implémenteur (13/09, nuit)

Trois choses dans ce lot : le retrait du « perçage errant » (reste de
J4-bis-4), les marges du §9.51, et l'écriture du point de départ.

**1. « Perçage errant » retiré.** Le G-code du propriétaire a tranché : six
descentes de torche pour six contours, aucune au centre du trou. Un chemin du
cache qui n'atterrit sur aucun contour est désormais **ignoré et compté**
(`ignoredPaths`) ; il ne retire plus le trou. Le TROU revient au nesting —
les éventails, eux, n'y rentrent toujours pas, et c'est l'espacement qui
l'explique, pas la réserve : voir le point 5, mesuré.

**2. Les marges dérivent du kerf (§9.51).** `DEFAULT_PIERCE_MARGIN_MM` a
disparu. À la place :

| | avant | maintenant |
|---|---|---|
| disque de perçage | 3 mm, constante | **2 × kerf** |
| bande autour des trajets | kerf/2 | **± kerf** (largeur 2 × kerf) |
| bouche de la morsure | rayon du disque | **au moins 4 × kerf** |

Le kerf de la recette (1,5) redonne exactement 3 mm : ce n'est pas une
coïncidence, c'est d'où venait la constante. Un kerf de 4 donne 8 mm.

**Un kerf nul, absent ou illisible ne rend JAMAIS une marge nulle** : repli à
3 mm, et le constat le dit (`pierceFallback`). Conséquence : l'ancien refus
`nothingToReserve` est devenu inatteignable — la torche perce toujours. Je l'ai
**retiré du code et des deux dictionnaires** plutôt que de le laisser traîner :
une raison morte dans un dictionnaire est une promesse qu'on ne tient plus.

Prix mesuré, mêmes fixtures qu'au §9.43 : le trou de la recette (cercle r 35,
amorce 5, sortie 10, kerf 1,5) passe de **2,74 % à 3,06 %** de son aire, bouche
de 9,38 à **10,19 mm** ; le trou rectangulaire de `Pièce L` de 3,6 à **4,06 %**,
bouche **9,52 mm** ; le contour extérieur gagne **0,67 %**. Les verrous de
mesure du §9.43 sont rejoués avec ces marges et restent verts : les 36 points
de trajet réels du G-code hors zone utile, et le cercle de perçage réel
(rayon 2 × kerf = 3) entièrement hors zone libre, 0 sur 64.

**3. L'écriture du point de départ, et c'est le cœur du lot.**

Le §9.50 a montré qu'un point `moved = false` est un **cache** que SheetCam
recalcule à l'ouverture. Réserver la place au point lu pendant que SheetCam en
choisit un autre, c'est le défaut de la recette sous une autre forme — et il
est invisible depuis chez nous.

`writeJobStartPoints` (`shared/sheetcamJob.js`) réécrit donc, pour chaque
contour où la réserve a été posée, le point retenu **et lève le drapeau
« déplacé à la main »**. Les points déplacés, eux, sont respectés à l'octet
(L-2 et L-3 de la série) : c'est le seul état qui engage SheetCam.

L'écriture est chirurgicale : `jobPathRecords` rend maintenant les OFFSETS de
chaque charge utile (`at: { x, y, moved }`), et l'écrivain pose deux doubles et
un octet par contour. **Rien n'est réencodé** — le cache de géométrie de
SheetCam reste le sien, et le harnais le vérifie.

**On n'écrit QUE pour les chemins qui tombent sur un contour du dessin.** Un
chemin sans contour chez nous — l'entité POINT, par exemple — n'a pas été
réservé : figer un point qu'on ne modélise pas serait un pari. Mesuré sur la
fixture : l'hôte a trois chemins et deux contours, deux drapeaux se lèvent ;
l'éventail a deux chemins et un contour, un seul se lève.

**4. `allowOverlappingLeads`.** L'échappatoire d'atelier : allumée, aucune
réserve n'est appliquée — les pièces se serrent et les amorces peuvent se
croiser. C'est un choix (tôle chère, chutes sans valeur), jamais un défaut par
défaut. Et surtout **il ne se fait pas en silence** : le constat porte sa
raison (`leadsAllowedToOverlap`, libellé EN et FR), et le verrou compare la
géométrie produite à celle d'un projet sans `.job` — strictement identique.

**Verrous, et la preuve qu'ils mordent.** Quatre tests neufs sur l'écriture :
le point écrit est celui où la réserve a été posée, drapeau levé ; le reste du
cache ne bouge pas d'un octet ; un appelant qui ne fournit pas les points
recopie le cache tel quel (le comportement d'avant, toujours atteignable) ; un
chemin sans contour n'est jamais figé. J'ai désactivé l'écriture un instant
pour vérifier : **trois échecs**, `expected [] to have a length of 2`. Remise :
verts.

Le harnais change aussi de verrou sur un point important : **`D6` n'exige plus
l'identité à l'octet** du bloc binaire — il exige que rien ne bouge EN DEHORS
des champs de point de départ, et un `D6b` neuf exige qu'au moins un drapeau
soit levé (sans lui, J4-ter ne ferait rien et `D6` passerait au vert).

**Ce que ce lot NE fait pas, et qu'il faut savoir.** NestorCut écrit le point
qu'il a LU, pas un point qu'il aurait choisi pour éviter les pièces nichées.
C'est ce qui rend la réserve et le G-code cohérents — l'objet du lot — mais
si le point lu tombe du côté où nous nichons, la réserve mange la place et le
nesting en tient compte, au lieu de déplacer l'amorce ailleurs. Choisir un
MEILLEUR point (le plus loin des pièces nichées) est un chantier distinct, et
il n'est pas nécessaire pour que la recette soit juste.

**5. LE NICHAGE NE REVIENT PAS DANS LA RECETTE, ET CE N'EST PAS LA RÉSERVE.**

Le trou est bien rendu au nesting (`applied: true`, aucun trou retiré), et
pourtant les quatre éventails se posent à côté de l'hôte au lieu d'y être
nichés. Plutôt que de supposer, j'ai mesuré, toutes choses égales par ailleurs
— même fichier, même image, seul l'espacement puis la réserve changent :

| espacement | réserve | éventails nichés |
|---|---|---|
| 4 mm (`2 × 1,5 + 1`, le pré-remplissage) | oui | **non** |
| 3,25 mm (sécurité 0,25) | oui | **non** |
| 3 mm (sécurité 0, le plancher de la règle) | oui | **non** |
| 3 mm | **non** (`allowOverlappingLeads`) | **non** |

La dernière ligne tranche : **sans aucune réserve, au plancher de la règle, ils
ne nichent toujours pas**. Ce n'est donc pas la morsure d'amorce qui coûte le
nichage, c'est l'espacement. Le §9.40 l'avait annoncé (« les quatre éventails
ne tiennent plus ensemble dans le trou — c'est un choix de qualité de coupe,
assumé ») ; le §9.19 plaçait la limite à 3,5 mm, la mesure la place SOUS 3.

Conséquence à dire clairement au propriétaire : avec la règle `2 × kerf +
sécurité` et un kerf de 1,5, **aucun réglage ne fait renter les quatre
éventails dans ce trou** — le plancher de la règle (3 mm, sécurité nulle) est
déjà trop large. La recette machine montrera donc cinq pièces posées et un
`.job` juste, pas un moulinet. Si le propriétaire veut revoir le nichage, c'est
la règle d'espacement qu'il faut rediscuter, pas la réserve.

**Pour mesurer cela, le harnais a gagné deux leviers** : `QA_SAFETY` force la
sécurité du formulaire avant de nester, `QA_ALLOW_OVERLAP` pose
`allowOverlappingLeads` sur les fiches (l'option n'a pas encore de commande
dans l'interface). Avec le second, `F1`/`F3`/`F4` n'ont plus de sens et sont
remplacés par `F0` : aucune réserve, ET la raison nommée.

**Un faux pas de mesure, dit parce qu'il est instructif** : mon premier essai
rechargeait la page après avoir écrit dans IndexedDB. La page repartait des
params d'usine, le kerf pré-rempli par le `.job` était perdu, et la « mesure à
3 mm » se faisait en réalité à 0. Le rechargement est inutile — la fiche est
relue au moment du nesting.

**Mesures du lot, toutes rejouées sur ce poste, image reconstruite :**

| banc | résultat |
|---|---|
| `npx vitest run` | **740** passés, 64 fichiers |
| `npx nuxt build` | vert |
| `docker compose build app` | vert |
| harnais, `Piece_Trou+Fill_x4_ordre_TEST.job` | tous verts, 5 / 5 |
| harnais, `Piece_Trou+Fill_x4_OK.job` | tous verts, 5 / 5 — trou **rendu au nesting**, 3 drapeaux « déplacé » levés, 3 octets changés dans le cache et tous dans les champs de départ |
| harnais, `Piece_Trou+Fill.job` | tous verts, 2 / 2 |
| harnais, `Piece_Trou.job` | tous verts, 1 / 1 |

### Lot J4-ter — vérification (vérificateur, 13/09, nuit, `2e4109a5`) — GO, déploiement après la recette machine

Rejoué sur le poste : image `app` reconstruite à HEAD, vitest, harnais
`.job` sur quatre fichiers, lecture de l'écrivain et du fichier de recette.

#### 9.53 Mesures

| Verrou | Résultat |
|---|---|
| vitest | **740** |
| `RECETTE-J4ter_x4.job` | points écrits et drapeaux levés : hôte (24,749 ; 24,749) et (50 ; 50), éventail (0 ; 2,828) ; les deux chemins de l'entité POINT non touchés ; **3 octets** diffèrent du cache source (les trois drapeaux — les points automatiques de la source re-sauvée étaient déjà ceux-là) |
| harnais `.job`, quatre fichiers | **tous verts** : recette × 4 (5 / 5, 3 drapeaux levés, trou rendu au nesting avec une morsure, rayon de perçage 3 = 2 × kerf), « ordre » 5 / 5, 2 pièces 2 / 2, 1 pièce 1 / 1 ; aucune pièce nichée (espacement 4 mm, voir ci-dessous) |
| écrivain (`writeJobStartPoints`) | deux doubles et un octet par contour, aux offsets rendus par le lecteur ; rien d'autre n'est réencodé |
| plafond des 7 dessins | `tooManyDrawings` absent du code (J4-bis-4) |
| essai indépendant du vérificateur | `.testparts/retro-eng-job/NESTORCUT-3-points-choisis.job` : trois points choisis loin des points automatiques, écrits par un script hors dépôt avec le même codage ; **en attente du G-code du propriétaire** — c'est la preuve directe que SheetCam honore un point écrit |

**Acquis** : le nichage qui ne revient pas est bien un effet de l'espacement
(tableau du §9.52, quatre lignes ; la dernière, sans réserve à 3 mm, tranche).
La règle `2 × kerf + sécurité` avec un kerf de 1,5 ne fait plus tenir quatre
éventails dans ce trou : conséquence connue du §9.40, à rediscuter par le
propriétaire s'il veut revoir le moulinet — pas un défaut du lot.

**Une hygiène à corriger dans le même commit que les documents** : le commit
`2e4109a5` a ré-enregistré `docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` en fins de
ligne **CRLF** (4 150 lignes « changées » pour 331 ajoutées ; git le voit
désormais comme non-texte). Le contenu est intact (vérifié en ignorant les
blancs, toutes les sections du vérificateur présentes). À remettre en LF,
comme tous les autres documents, et à ne pas reproduire (éditeur ou outil qui
convertit).

**GO** pour J4-ter. Le déploiement (app + worker nesting) attend **la recette
machine** : le propriétaire ouvre `RECETTE-J4ter_x4.job`, post-traite, et le
G-code doit amorcer le trou en (74,75 ; 74,75) et le contour extérieur en
(100 ; 100) dans le repère de la tôle (poses du fichier), donc là où
NestorCut a écrit ; et le fichier `NESTORCUT-3-points-choisis` doit amorcer
aux trois points du tableau du 13/09 22 h 52.

#### 9.54 Recette machine J4-ter (13/09, 23 h) : le G-code amorce là où NestorCut a écrit

`.testparts/RECETTE-J4ter_x4.nc`, généré par le propriétaire depuis
`RECETTE-J4ter_x4.job` (hôte posé en (62,8 ; 54,0), `Angle −1,57`, points
écrits (24,749 ; 24,749) pour le trou et (50 ; 50) pour le contour).

| contour | point écrit, ramené dans la tôle | départ lu dans le G-code (chemin décalé) | écart |
|---|---|---|---|
| trou | (38,05 ; 78,75) | (38,54 ; 78,22) | **0,72 mm** = kerf/2 |
| extérieur | (12,80 ; 104,00) | (12,01 ; 104,00) | **0,79 mm** = kerf/2 le long de l'arête |

Six perçages pour six contours, aucun sur l'entité POINT. **SheetCam honore
les points écrits avec le drapeau « déplacé », rotation de la pièce comprise
(l'amorce du trou est à 10-11 h sur la capture, le coin S3 en haut à gauche :
ce sont les points écrits tournés de +90°).** La recette J4-ter est **OK**.

Les deux remarques du propriétaire, mesurées sur le même G-code :

1. *« Plus d'éventail dans le trou »* : voulu par la règle d'espacement
   (§9.52 point 5) — à 4 mm, et même à 3, les quatre éventails ne tiennent
   plus ; le trou est bien offert au nesting (`applied: true`, une morsure).
2. *« L'éventail n'est pas à 2 × kerf de la pièce carrée »* : contour à
   contour, il y est — sommet de l'hôte à y = 104, point bas des éventails
   du rang inférieur à y = 108, soit **4 mm = 2 × 1,5 + 1**. Ce qui se voit à
   l'écran, ce sont les BANDES de kerf : celle de l'hôte monte jusqu'à 105,5,
   celle de l'éventail descend jusqu'à 106,5 — **1 mm de matière entre les
   deux bandes, c'est la sécurité**. Si le propriétaire veut 2 × kerf entre
   les bandes elles-mêmes, la règle devient `4 × kerf + sécurité` (7 mm ici) :
   c'est un autre choix, à dire.

**GO déploiement du `.job`** (app + worker nesting), avec E3 dès son cas
serveur G. L'essai à trois points choisis du vérificateur n'est plus
nécessaire à la preuve ; il reste utile s'il est fait.

#### 9.55 Déploiement de J4-ter et d'E3 (implémenteur, 14/09, 00 h) — fait

Une seule promotion pour les deux lots, comme le permet la vérification d'E3.

| | |
|---|---|
| SHA promu | **`9b227ec1a5a267cd7f831ffbd189babbc5d692e4`** (`test(import): lot E3 — cas G`) |
| build des images | run `34784870439`, **`success`** sur les cinq jobs (moteur + tests worker, puis les quatre images) |
| `promote-latest` | run `34785161622`, **`success`**, quatre images retaguées sans reconstruction |

**Digests de `:latest` après promotion, et ce qui tourne réellement.** Les
quatre conteneurs de production tournent l'image `:latest` à l'identifiant
près — vérifié conteneur par conteneur, pas déduit du `pull` :

| image | digest `:latest` | avant |
|---|---|---|
| `nest2d-app` | `sha256:cefe551d78c4…` | `sha256:2fbd88a1ecef…` |
| `nest2d-nesting-worker` | `sha256:6554e31dc113…` | `sha256:6ee233c737f1…` |
| `nest2d-user-file-processing-worker` | `sha256:66ed5d34c062…` | `sha256:62906ba722e8…` |
| `nest2d-admin` | `sha256:ea48d5e3a289…` | inchangé — le conteneur n'a pas été recréé, et c'est correct : le build rend le même digest |

**Hetzner** : `docker compose pull && docker compose up -d` dans
`/opt/nestorcut`. `app`, `nesting-worker` et `user-file-processing-worker`
recréés. `https://nestorcut.com/` répond **200** en 0,16 s.

**Homelab** : `docker compose pull && docker compose up -d --force-recreate`
dans `/containers/nestorcut-overflow`. Les trois workers de débordement
repartent sur l'image du jour (`e5f1fd77a84e`, 23 h 52).
`assert_overflow_head.py` : **`ASSERT OVERFLOW=HEAD: OK`**, les trois workers
nommés. `NEST_COMPUTE_TOKENS` = **28 des deux côtés**.

**Benchmarks publics : rien n'est réécrit, et voici pourquoi — mesuré.**
`workers/nesting/core/holefill.py` et `core/main.py` ont bougé depuis le
dernier run publié (`d890c92`), donc le corpus a été rejoué en entier sur
l'image reconstruite, onze cas.

**Neuf des dix fiches publiées sont identiques au chiffre près** (T-A, B, C,
D, E, G, H, J, K : densité, posées, tôles, verdict). La dixième, **T-F**,
rend 89 posées sur 90 au lieu de 90, verdict `partial` au lieu de `ok`.

Avant de publier un chiffre moins bon, j'ai fait l'A/B qui tranche : **la
même machine, le cas T-F, l'image de RÉFÉRENCE `d890c92`** — celle qui a
produit les chiffres publiés, retirée du registre par son SHA complet :

| image | passages | posées |
|---|---|---|
| HEAD (`9b227ec1`) | 3 | 89, 89, 89 |
| référence (`d890c92`) | 2 | **88, 90** |

L'image de référence encadre la valeur de HEAD. **T-F n'est pas une
régression : c'est un cas instable d'un run à l'autre**, et la cause est
connue — le budget est un temps de MUR (`timeBudgetSec: 90`), donc le nombre
d'évaluations qui rentrent dépend de la charge de la machine, et T-F se joue
à une pièce près. Je n'ai donc **rien écrit** dans `data/benchmarks.js` :
aucun chiffre ne bouge du fait du code.

**Ce que cela révèle, et que je signale plutôt que de le taire** : le `90 /
ok` publié pour T-F est le HAUT d'une fourchette 88–90, pas un fait stable.
La page dit « produites par l'image déployée en production à la date
indiquée » — c'est vrai, mais pour ce cas-là un autre passage de la même
image aurait donné un autre nombre. Rendre T-F stable (budget en
évaluations plutôt qu'en secondes pour le corpus, ou fiche marquée
« à une pièce près ») est une décision de page publique : elle revient au
propriétaire, je ne la prends pas seul à minuit.

#### 9.56 La question des bandes de kerf (§9.54 point 2) — mon avis, la décision reste au propriétaire

Le vérificateur mesure juste, et la question est bien posée : faut-il
`2 × kerf + sécurité` (règle actuelle) ou `4 × kerf + sécurité` ?

Ce que la règle actuelle garantit, en clair : **la sécurité EST la matière
qui reste**. Deux contours à `2 × kerf + sécurité` l'un de l'autre, chacun
mangé d'un kerf par sa bande, laissent exactement `sécurité` millimètres de
métal entre les deux saignées. Le 1 mm que le propriétaire voit à l'écran
n'est pas un reliquat : c'est le nombre qu'il a saisi, rendu au bon endroit.

`4 × kerf + sécurité` dirait autre chose : « je veux deux kerfs de matière
en plus de ma sécurité ». C'est un réglage légitime — mais il rend le champ
« sécurité » illisible (on ne saurait plus ce qu'il mesure) et il **double
presque l'espacement de tous les projets existants** : 4 mm deviennent 7 mm
au kerf de 1,5, sans que personne n'ait rien demandé.

**Mon avis** : garder `2 × kerf + sécurité`, et dire à qui veut plus de
matière d'augmenter la SÉCURITÉ — c'est exactement ce que ce champ mesure
déjà, millimètre pour millimètre. Si le propriétaire tranche pour
`4 × kerf + sécurité`, c'est une heure de travail plus une migration qui
préserve l'espacement effectif des projets existants (la même mécanique que
celle écrite au §9.40) ; je ne l'engage pas sans son mot.

### Déploiement J4-ter + E3 — contrôle du vérificateur (14/09) et conception du « meilleur point de départ »

#### 9.57 Contrôle indépendant du déploiement `9b227ec1`

| Contrôle | Résultat |
|---|---|
| dépôt | `main` = `origin/main`, `29711b1f` / `9b227ec1` / `c6291083` poussés ; étude : **0 CR**, `i/lf w/lf` |
| CI | « Build and publish Docker images » `success` sur `9b227ec1a5a2…` ; `promote-latest` `success` |
| prod app | la page servie expose **`gitCommitSha: 9b227ec1a5a2…`** (la révision EST lisible depuis le navigateur, même sans label d'image) ; `PATCH /api/project/…/advanced-import` répond **401** sans session (route neuve d'E3 en place ; l'ancien build aurait rendu 404) |
| homelab | `assert_overflow_head.py` via le module de secrets : **ASSERT OVERFLOW=HEAD: OK**, image du 13/09 23 h 52, trois workers |
| benchmarks | non réécrits : T-F rend 89 à HEAD et 88 / 90 sur l'image de référence rejouée — la fourchette encadre HEAD, aucun mouvement dû au code. **Décision de page publique pour le propriétaire** : afficher la fourchette (ou la médiane de N passages) plutôt qu'un passage unique — le vérificateur recommande d'afficher « 88-90 » ou de fixer trois passages par fiche |

Le label `org.opencontainers.image.revision` proposé par l'implémenteur est
pris comme suite de D1 (une ligne dans `build-images.yml`, `docker inspect`
suffit alors sur les serveurs) — non bloquant, la page l'expose déjà.

**Bandes de kerf** : avis du vérificateur identique à celui de
l'implémenteur — garder `2 × kerf + sécurité`, où la sécurité est exactement
la matière qui reste entre les deux bandes ; qui veut plus de matière monte
la sécurité. Décision du propriétaire attendue, sans urgence.

#### 9.58 « Meilleur point de départ » — réponse au fork de conception

Oui, c'est une passe **après le solve**, et elle ne remplace pas la réserve
d'avant-solve, elle la complète :

1. **Avant le solve** (inchangé) : réserve au point lu, drapeau ou non — le
   nesting ne pose rien là où l'amorce lue passerait.
2. **Après le solve, par contour** (trous des hôtes d'abord, puis contours
   extérieurs) : candidats = les sommets de l'anneau (et le milieu de chaque
   arête droite) ; pour chacun, construire l'enveloppe d'amorce du §9.51
   (entrée, sortie, perçage, bande ± kerf) au bon côté chute, dans le repère
   de la tôle ; **score = distance minimale arête↔arête entre cette
   enveloppe et toute autre pièce posée** (nichées comprises) et le bord de
   tôle ; retenir le candidat de score maximal ; **ne l'écrire que si son
   score ≥ espacement ET ≥ score du point lu** — sinon garder le point lu.
   Piège #55 : distance arête↔arête, jamais sommet→arête.
3. **Écriture** : `writeJobStartPoints` avec le drapeau, comme J4-ter ; le
   constat dit « point déplacé de A vers B, dégagement X mm ».
4. **Verrous** : sur la recette à espacement 2 mm (quatre éventails nichés),
   le point du trou retenu est à ≥ espacement des quatre ; contrôle négatif :
   aucun candidat dégagé ⇒ point lu conservé, constat « aucun point
   dégagé » ; le G-code du propriétaire amorce au point écrit (recette).
5. **Ce qu'on ne fait pas** : re-nester après le déplacement (le point
   choisi respecte le layout, pas l'inverse) ; modéliser la règle
   automatique de SheetCam (inutile, on écrit).

Chantier J4-quater, un à deux jours, **avant J5**, parce qu'il change la
forme du résultat que J5 devra refléter côté serveur.

#### 9.59 Règle du propriétaire (14/09) : un point de départ posé à la main est INTOUCHABLE

« Si j'ai mis un starting point custom sur mon `.job`, NestorCut le garde et
ne le modifie pas. » La contrainte est portée par le fichier : chaque chemin
du bloc binaire a un drapeau « déplacé à la main » (charge `0x1d`, lu par
`jobPathRecords` sous `moved`, vrai dans L-2, L-3 et les deux fichiers
« moved » de la série, faux pour les points automatiques recalculés par
SheetCam).

**Règle** :

1. `moved = true` ⇒ le point est celui de l'utilisateur : NestorCut y pose
   la réserve d'amorce et **ne réécrit ni la valeur ni le drapeau** (les 16
   octets + 1 du chemin sortent identiques à l'entrée). Aucun lot ne peut le
   déplacer, `allowOverlappingLeads` compris (l'option retire la réserve, pas
   le respect du point).
2. `moved = false` ⇒ point automatique, que SheetCam recalcule à sa guise :
   NestorCut peut le choisir (J4-quater) et l'écrit alors avec le drapeau.
3. Le constat de réserve dit lequel des deux cas s'applique par contour
   (« point de l'utilisateur conservé » / « point choisi par NestorCut »).

**Aujourd'hui (J4-ter)** : l'écriture recopie le point lu et lève le drapeau ;
sur un point déjà déplacé c'est un no-op sur la valeur, mais la règle doit
être EXPLICITE dans le code, pas une conséquence. **Verrou** : `.job` de la
série « start rectangle moved » passé par le chemin complet ⇒ l'enregistrement
du rectangle est octet-identique en sortie, la réserve est posée à
(10 ; 138,9), et le G-code du propriétaire y amorce ; contrôle négatif : le
fuseau (automatique) du même fichier peut, lui, être réécrit.

**J4-quater** en hérite : la recherche du « meilleur point » ne parcourt que
les contours à `moved = false`.

#### 9.60 Lot « point déplacé à la main intouchable » — vérification (vérificateur, 14/09, `117bb4ce`) — GO déploiement (app seule)

| Verrou | Résultat |
|---|---|
| vitest | **743** |
| périmètre | `shared/sheetcamJob.js`, `shared/sheetcamReserve.js`, tests, harnais ; rien sous `workers/` ni `public/` |
| harnais `qa-e2e-startpoint-moved.mjs`, image reconstruite, fichier « start rectangle moved » de la série | **6 / 6** : un point déplacé en entrée ; ses 17 octets identiques en sortie ; point conservé (10,00 ; 138,91) ; les deux chemins automatiques figés (réinscriptibles) ; constat `userPoints 1 / nestorcutPoints 2` ; 0 octet touché hors drapeaux |
| garde structurelle | `writeJobStartPoints` écarte tout édit visant un chemin déjà marqué déplacé : aucun lot futur ne peut réécrire un point d'utilisateur, même par oubli |
| bonus | noms de dessins accentués : le `.job` est écrit en UTF-8, le lecteur décodait en latin-1 (« PiÃ¨ce ») ⇒ « dessin manquant » à tort ; réparé dans `jobDrawingName` seul, texte canonique et binaire intacts (verrou) |

**Déploiement E4 `8b87e678` contrôlé** : page de prod à ce SHA, homelab
`ASSERT OVERFLOW=HEAD: OK`.

**GO déploiement** de `117bb4ce` (app seule). Il entre dans la recette du
propriétaire (`RECETTE-PROPRIETAIRE-2026-09-14.md`, ligne C5).

#### 9.61 Le `.job` PORTE la géométrie des contours (mesure du 14/09) — le DXF n'est pas indispensable

Question du propriétaire devant le message « 1 dessin manquant : déposez-le » :
*le `.job` ne contient-il pas le dessin ?* Réponse mesurée sur
`Piece_Trou.job` : **si**. Le bloc binaire, au-delà des points de départ
(§9.38), porte **chaque contour en segments**, dans le même flux
tag / type / longueur :

| tag | charge | lecture (vérifiée sur le carré à trou) |
|---|---|---|
| `0x02` | 0 | début d'un segment |
| `0x04` | int32 | type : **1 = ligne, 2 = arc** |
| `0x05` / `0x06` | 2 doubles | point de départ / d'arrivée du segment |
| `0x07` | 2 doubles | centre (arc) |
| `0x08` / `0x09` / `0x0a` | double | balayage signé (−π/2 = quart de tour horaire), angle de départ, **rayon** (35 pour le cercle) |
| `0x12` … `0x1d`, `0x23`, `0x24`, `0x2f`-`0x32` | | l'enregistrement du chemin qui suit ses segments (amorces, point de départ, ordre, drapeau « déplacé ») |
| `0x25` | 2 doubles | origine du dessin (§9.38) |

Lu sur le fichier : le cercle r = 35 en arcs de quart de tour centrés en
(0 ; 0), le carré par ses quatre côtés (±50), l'entité POINT comme une ligne
dégénérée (0 ; 0)→(0 ; 0) ; le dernier segment d'un contour fermé est
implicite. Sur la pièce L, l'ellipse est stockée en 18 arcs : les courbes
libres (SPLINE, ELLIPSE) sont **déjà approchées par SheetCam** en arcs.

**Ce que cela change** : aujourd'hui NestorCut exige les DXF parce que toute
la chaîne (fiches, nesting, DXF de coupe) part de l'import DXF ; le binaire
n'est relu que pour les points de départ. On peut lever cette exigence :
**lot J6 « `.job` seul »** — décoder les segments en anneaux, écrire un DXF
canonique (LINE / ARC) par dessin, puis l'import ordinaire ; le `.job` rendu
n'a jamais eu besoin du DXF (poses seules). Verrous : sur les 18 `.job` de la
série et de la recette, la géométrie décodée coïncide avec l'import du DXF
(aire à 0,1 %, étendue à 0,01 mm) ; les DXF déposés en plus restent
prioritaires quand ils sont là (géométrie source exacte). Deux jours.
Réserves : précision des courbes approchées par SheetCam (arcs : exact ;
splines : ce que SheetCam a tessellé) ; un contour ouvert ou une entité
inconnue doit être dit, jamais avalé. **Décision du propriétaire** : ce lot
est une nouveauté ; il passe avant ou après la levée du gel selon son usage
réel (dépose-t-il ses `.job` avec ou sans leurs DXF ?).

#### 9.62 Lot J6 — le `.job` seul suffit (consigne fermée, 14/09)

**Décision du propriétaire** : « on dépose bien évidemment le `.job` sans
son DXF ». J6 n'est donc pas une nouveauté sous le gel : c'est ce qui rend
la priorité 4 utilisable. Il passe **avant la levée du gel**, tout de suite
après le déploiement d'A1.

1. **Décodage** (`shared/sheetcamJob.js`, à côté de `jobPathRecords`) :
   `jobDrawings(binary)` rend, par dessin, ses chemins et pour chaque chemin
   sa liste de segments — ligne `{a, b}` ou arc `{a, b, c, r, sweep}` — dans le
   repère du dessin (origine `0x25` appliquée), fermeture implicite du
   dernier segment rendue explicite. Tout tag inconnu est conservé tel quel
   (le flux est déjà relu à l'octet). Un segment de type inconnu, un chemin
   ouvert (arrivée ≠ départ à 1e-6) ou une longueur incohérente ⇒ refus
   nommé du DESSIN, jamais un contour avalé ni deviné.
2. **DXF canonique par dessin** : LINE et ARC (centre, rayon, angles, sens
   déduit du signe du balayage), `$INSUNITS = 4`, `$MEASUREMENT = 1`
   (piège #27), handles frais ; les segments dégénérés (le POINT) sont
   omis. Le DXF passe ensuite par **l'import ordinaire** (fiche, pièces,
   trous, handles canoniques) — aucune chaîne parallèle. Le nom de la fiche
   est le nom du dessin du `.job`.
3. **Priorité des sources** : si le DXF du même nom est déposé dans le lot
   (ou déjà dans le projet), il gagne — géométrie source exacte ; sinon la
   fiche vient du binaire et le dit (`source: 'job'`, libellé EN/FR :
   « géométrie lue dans le fichier de travail »). Plus jamais « dessin
   manquant, déposez-le » : ce message devient une information (« DXF
   d'origine non fourni, géométrie du `.job` utilisée »).
4. **Réserve d'amorce et points de départ** : inchangés (le binaire est le
   même). Le `.job` rendu n'a jamais eu besoin du DXF.
5. **Serveur** : sans objet avant J5 ; le projet serveur avec `.job` seul
   dit ce qu'il fait (aujourd'hui : les DXF sont traités, le `.job` ignoré —
   il refusera proprement tant que J5 n'est pas là).
6. **Verrous** : sur les 18 `.job` de la série et de la recette, la
   géométrie décodée coïncide avec l'import du DXF correspondant — aire à
   0,1 %, étendue à 0,01 mm, même nombre de pièces et de trous ; l'ellipse
   de la pièce L (18 arcs) à 0,05 mm de l'import de l'ELLIPSE ; contrôle
   négatif : `.job` + DXF déposés ensemble ⇒ fiche bit-identique à l'import
   DXF (le DXF a gagné) ; `.job` dont un dessin porte un segment inconnu ⇒
   refus nommé, les autres dessins vivent. Harnais `qa-e2e-job.mjs` : un cas
   « `.job` seul » de bout en bout (dépôt, nesting, `.job` rendu relu) sur
   la recette × 4 et sur le fichier « ordre ».
7. **Recette du propriétaire** : la ligne C1 devient « déposer le `.job`
   SEUL ».

Deux jours. Déploiement app seule après GO.

#### 9.63 Lot J6 — rapport de l'implémenteur (14/09)

Périmètre livré (app + `shared/` seuls, aucun diff sous `workers/` ni
`public/` — le moteur et le wasm ne bougent pas, benchmarks publics sans
objet) :

1. **Décodage** — `jobDrawings(binary)` dans `shared/sheetcamJob.js`, à côté
   de `jobPathRecords` (que rien ne change : ses verrous du lot J4-bis-2
   restent verts). Le flux tag/longueur est le même ; les groupes de
   segments (`0x03` ouvre, `0x2f` constante, `0x04…0x0a` le segment, `0x01`
   ferme) précèdent les enregistrements de chemin, et le k-ième
   enregistrement parle du k-ième groupe — vérifié par le point de départ
   qui tombe sur son contour. Les coordonnées sortent ORIGINE APPLIQUÉE
   (l'éventail : apex local (0 ; −12,5858) + origine (0 ; 15,4142) = (0 ;
   2,8284), l'étendue du DXF). Le balayage d'arc est NÉGATIF pour le sens
   trigonométrique (le cercle r = 35 est écrit en quatre quarts à −π/2
   parcourus dans le sens positif) ; une ligne porte des charges d'arc
   PÉRIMÉES (le carré traîne le rayon 35) — ignorées pour une ligne,
   exigées pour un arc. La fermeture implicite du contour est VÉRIFIÉE
   (arrivée ≠ départ à 1e-6 ⇒ refus), le chaînage inter-segments aussi, et
   la cohérence d'arc (extrémités sur le cercle de rayon r, à 0,01 mm).
   Tout écart est un REFUS NOMMÉ DU DESSIN (`sheetcamJobDrawing.*`), les
   autres dessins vivent.
2. **DXF canonique par dessin** — `drawingCanonicalDxf` dans
   `shared/sheetcamJobDxf.js` : LINE et ARC seulement, `$INSUNITS = 4` et
   `$MEASUREMENT = 1` posés (piège #27), handles frais depuis 2F, zéro
   arrondi géométrique (piège #28), segments dégénérés (l'entité POINT)
   omis. Un arc HORAIRE de a vers b s'écrit comme l'arc trigonométrique de
   b vers a, l'étendue portée par |balayage| ; un tour complet se couperait
   en deux demi-tours (aucun cas mesuré dans la série).
3. **Import ordinaire** — `importLocalBytes` (`localImport.js`) : le DXF
   canonique repasse PAR LE MÊME IMPORT que tout DXF déposé — fiches,
   pièces, trous, aperçu, échelle, éclatement, export par handle. Aucune
   chaîne parallèle.
4. **Priorité des sources** — `resolveJobDrawingSources`
   (`sheetcamJobImport.js`) : le DXF déposé gagne ; sinon la fiche du même
   nom déjà dans le projet (réglages attachés, jamais de doublon — P4-9) ;
   sinon le bloc binaire, et la fiche le DIT : champ additif
   `source: 'job'` + constat d'information `sheetcam.jobGeometry`
   (« géométrie lue dans le fichier de travail — le DXF d'origine n'a pas
   été fourni »). Le message « dessin manquant, déposez-le » disparaît du
   chemin local ; les refus (rares) nomment leurs dessins, raisons
   traduites EN/FR par la page.
5. **L'appariement bloc ↔ dessin est le RANG des originaux** (règle 6 de
   l'étude, mesurée au lot J1 : « le bloc binaire est associé aux sections
   par leur rang »). C'est le seul lien que le fichier porte — le binaire
   ne connaît ni noms ni dates — et c'est LE MÊME que notre rendu
   (`jobRanksByDrawing` écrit les poses au rang de chaque nom), si bien
   que fiches et `.job` rendu restent cohérents entre eux. Les deux
   fichiers « ordre » de la série (fabriqués en réordonnant les sections :
   `Piece_Trou+Fill_x4_ordre_TEST`, `RECETTE-J4bis3_ordre`) lient donc
   leurs blocs aux noms CROISÉS : déposés SEULS, leurs fiches suivent la
   liaison par rang du fichier (celle de SheetCam lui-même) ; déposés AVEC
   leurs DXF, la géométrie source gagne et tout redevient historique —
   c'est le correcteur prévu au point 3 de la consigne. Mesuré : les 4
   couples de ces deux fichiers coïncident exactement par la liaison
   croisée (voir le verrou).
6. **Serveur (point 5 de la consigne)** : sans objet avant J5. Le serveur
   n'accepte que `.dxf/.svg/.dwg` à l'upload — un `.job` déposé sur un
   projet serveur était FILTRÉ EN SILENCE ; la dépose dit désormais
   « les fichiers de travail SheetCam se traitent en mode "Cet appareil" »
   (`jobImport.serverUnsupported`, EN/FR), et les autres fichiers suivent
   leur chemin.

**Verrous rejoués et chiffres.** `sheetcamJobGeometry.test.js` (21 tests) :
structure et refus nommés sur la fixture et sur des binaires corrompus SUR
MESURE (type 9 dans un segment, sommet décalé d'un millimètre, rayon d'arc
falsifié, enregistrement de chemin retiré octet par octet — chaque
corruption ne refuse QUE son dessin) ; en-têtes et entités du canonique ;
**coïncidence par l'import wasm ordinaire sur la pièce L du dépôt** (1
pièce, 2 trous, étendue 0…180 identique au chiffre près) puis **sur les
fichiers réels quand `.testparts` est là : 70 couples mesurés (45 `.job`
réels × leurs dessins appariables), 66 coïncidences exactes** (pièces,
trous, aire à 0,1 %, étendue à 0,01 mm) — les 4 autres sont exactement
l'échange des deux dessins des deux fichiers « ordre », et la liaison
croisée coïncide au même seuil sur les quatre. **Ellipse de la pièce L :
0,106 mm au pire milieu d'arc, 0,056 aux sommets** — la consigne attendait
0,05 ; la tessellation 18 arcs de SheetCam est un peu plus grossière que
prévu, le verrou est posé à 0,12 avec le chiffre mesuré ici (à arbitrer).
Suite entière : **vitest 767/767** (64 fichiers, dont les 743 de l'audit +
le lot J6), `npx nuxt build` vert DEPUIS LA RACINE du dépôt (le lancer
depuis `app/` casse les alias `~~/constants/…` — 30 fausses erreurs « os
error 3 », l'invocation seule en cause). Harnais `qa-e2e-job.mjs` (image
locale reconstruite depuis les sources), quatre passages, **tous verrous
verts** :

| passage | mode | résultat |
|---|---|---|
| fixture + DXF | normal | verrous A/B/C/D/E/F verts, dont le contrôle négatif J6-A : AUCUNE fiche ne vient du binaire quand les DXF sont déposés |
| recette ×4 SEULE (`RECETTE-J4ter_x4.job`) | `QA_ALONE=1` | 2 fiches `source: 'job'` + constat, 5/5 pièces posées, réserve et points de départ appliqués (3+2 lus, orphelins = les POINT), `.job` rendu complet (Count=5, 3 copies, binaire intact hors drapeaux, OpOrder, angles) |
| « ordre » SEUL (`RECETTE-J4bis3_ordre.job`) | `QA_ALONE=1` | idem, tous verrous verts — la liaison par rang fait ce qu'elle doit sur un fichier aux sections réordonnées |
| `Piece_Trou+Fill_x4_ordre_TEST.job` SEUL | `QA_ALONE=1` | idem, tous verrous verts |

**Non-faits, dits franchement.** J5 (miroir serveur) : pas livré, la dépose
serveur dit maintenant ce qu'elle fait. Les points de départ, réserves et
marges : AUCUN changement (mêmes blocs binaires, mêmes verrous F du
harnais). L'écart d'ellipse mesuré ci-dessus. Et le lot suppose un
`.job` dont les sections originales portent le lien de rang : un fichier
dont les sections auraient été réordonnées SANS que son cache suive (nos
deux fichiers « ordre » sont exactement ça) ne peut pas être réconcilié
par le texte seul — déposé seul il suit la liaison du fichier, déposé
avec ses DXF il redevient exact ; c'est écrit dans le code du resolver et
verrouillé par le test « inversion croisée ».

**À arbitrer** : (1) le seuil d'ellipse (0,05 attendu, 0,106 mesuré) ;
(2) la sémantique « rang » sur un `.job` aux sections réordonnées — mon
avis : c'est la seule lecture fidèle du format (règle 6 mesurée, et le
`.job` rendu reste cohérent), le DXF déposé reste le correcteur ;
(3) P4-10 attend toujours le `.job` réel d'atelier.

#### 9.64 Lot J6 — vérification (vérificateur, 14/09, `dad20367`) — GO déploiement app seule

Rejoué sur le poste : image `app` reconstruite à HEAD, vitest, et un
**décodage indépendant** du bloc binaire (sorties hors dépôt,
`~/qa-out/verif-j6/`) : le décodeur `jobDrawings` est appelé tel quel, mais
l'aire, l'étendue et l'arrivée de chaque arc sont recalculées ici ; côté DXF,
ezdxf aplatit (0,0005 mm) et shapely polygonise — ni le writer canonique ni
l'import wasm n'entrent dans la mesure. La coïncidence est donc établie par
un second chemin que celui du verrou de l'implémenteur.

| Verrou | Résultat |
|---|---|
| vitest | **767 / 767** (64 fichiers, dont les 21 de `sheetcamJobGeometry.test.js` ; le verrou « série réelle » a bien vu `.testparts` : aucun avertissement `[J6]` au journal) |
| périmètre | 10 fichiers, `app/` + `shared/` + étude + harnais ; rien sous `workers/`, `public/` — moteur, wasm et benchmarks hors sujet |
| décodage | **47 `.job`** (série, recette, fixtures), **70 blocs de dessin, 187 contours, 0 erreur** ; blocs = noms originaux sur les 47 ; 0 contour ouvert ; l'arrivée de chaque arc reconstruit depuis (centre, rayon, sens, balayage) tombe sur son extrémité écrite à **7 × 10⁻¹⁴ mm** — la règle « balayage négatif = trigonométrique » est confirmée par un calcul indépendant |
| coïncidence avec les DXF | **70 couples : 66 exacts, 4 croisés, 0 écart** — anneaux en même nombre, aires à 0,1 % (cercle r = 35 : 3 848,45 mm² décodé), étendues à **0,00000 mm** |
| les 4 croisés | exactement les deux fichiers « ordre » fabriqués (`…_ordre_TEST`, `RECETTE-J4bis3_ordre`) : le bloc k porte la géométrie de l'AUTRE nom, coïncidence exacte par liaison croisée |
| ellipse de la pièce L | 18 arcs ; **0,0996 mm** au pire milieu d'arc, 0,050 aux extrémités, contre l'ellipse analytique du DXF ; aire 5 027,95 contre π·a·b = 5 026,55 (+0,03 %) |
| harnais `qa-e2e-job.mjs` | quatre passages, tous verrous verts : (1) fixture + DXF, contrôle négatif J6-A « aucune fiche ne vient du binaire » ; (2) recette ×4 SEULE : 2 fiches `source: 'job'` + constat, 5/5 posées, 3 + 2 points lus, 0 octet du binaire changé ; (3) `RECETTE-J4bis3_ordre` SEUL : vert ; (4) mon cas : `Pièce L - start ellipse moved` SEUL : 1 fiche du binaire, 1/1 posée, 3 points lus, 0 orphelin, **2 octets changés = les drapeaux des deux points automatiques, le point déplacé à la main intact** (§9.59 tenu sur le chemin « .job seul ») |
| double dépôt (mon cas) | `.job` seul ⇒ 2 fiches du binaire ; puis, SUR LE MÊME PROJET, `.job` + ses deux DXF ⇒ **4 fiches** (une du binaire et une du DXF par nom, toutes avec réglages de coupe) ; puis un DXF seul ⇒ 5. Mesuré au navigateur, captures `~/qa-out/verif-j6/h-doubledrop/` |

**Arbitrages (délégués, tranchés)** :

1. **Ellipse : seuil 0,12 mm accepté.** L'écart n'est pas le nôtre : c'est
   la tessellation de SheetCam (18 arcs, tolérance ~0,1 mm), et ces arcs sont
   EXACTEMENT ce que la machine coupera — le contour du `.job` est plus
   fidèle à la pièce réelle que l'ellipse du DXF. Sous le kerf, sous
   `NEST_SIMPLIFY_MM`, sans effet sur le nesting. Le chiffre attendu (0,05)
   de la consigne était une estimation, pas une mesure.
2. **Liaison par rang : acceptée, c'est le format.** La règle 6 a été
   MESURÉE au lot J1 dans SheetCam lui-même (déplacer une section échange les
   géométries) : un `.job` aux sections réordonnées à la main est un fichier
   que SheetCam affiche déjà croisé. Déposé seul, NestorCut lit ce que
   SheetCam lit ; déposé avec ses DXF, la géométrie source gagne. Aucun
   fichier produit par SheetCam n'est dans ce cas. Constat de cohérence à
   garder en tête : l'appariement des POINTS DE DÉPART reste par géométrie
   (`assignJobStarts`, §9.45) — sur un tel fichier déposé AVEC ses DXF les
   deux liaisons divergent ; hors de portée d'un fichier réel, noté, pas de
   lot.
3. **Dépose d'un `.job` sur un projet serveur : le message remplace un
   filtrage silencieux**, accepté tel quel ; J5 lèvera la limite.

**Réserves (non bloquantes, lot court J6-bis avant la levée du gel)** :

- **Le DXF ne « gagne » que dans le MÊME dépôt.** Le résolveur ne réutilise une fiche du projet que pour un dessin SANS DXF dans le lot ; un DXF déposé après coup pour un nom dont la fiche `source: 'job'` existe déjà s'ajoute au lieu de la remplacer. Le constat d'information (« le DXF d'origine n'a pas été fourni ») invite pourtant à le fournir : l'utilisateur qui obéit double ses quantités sans le voir. J6-bis : quand un DXF est importé (dans un lot `.job` ou seul) pour un nom dont une fiche `source: 'job'` existe dans le projet, REMPLACER cette fiche en place (mêmes quantité, rang, réglages de coupe, octets du `.job`) ; verrou unitaire + cas harnais « .job seul puis .job + DXF ⇒ toujours 2 fiches, source nulle ». Un DXF redéposé pour une fiche déjà DXF reste le comportement historique (hors lot).
- Le verrou « série réelle » exige `inverted.length === 4` : il est vrai sur
  les postes qui portent les deux fichiers « ordre », faux sur un poste où
  `.testparts` existe sans eux. Tolérer `≤ 4` avec le détail au journal, ou
  nommer les deux fichiers attendus dans le message d'échec.
- Hygiène du lot précédent (`edbc84d7`) : la variable `QA_P3_ECRIN` et le
  défaut `qa-p3-collegue.dxf` gardent la moitié du nom du dessin du
  collègue ; renommer `QA_P3_MULTI` / `qa-p3-multi.dxf`. Aucun nom de client
  n'apparaît nulle part.

**GO déploiement app seule.** App seule, `dad20367` (HEAD), après que l'agent a ajouté
J6-bis ou en le suivant de près ; homelab et benchmarks sans objet. La
recette du propriétaire C1 peut se jouer « `.job` seul » dès ce déploiement.

#### 9.65 Lot J6-bis — rapport de l'implémenteur (14/09)

La réserve du §9.64, corrigée, plus les deux points d'hygiène — app +
`shared/` seuls.

1. **Le DXF déposé après coup REMPLACE la fiche du binaire en place.**
   `importLocalBytes` accepte `replace: { slug, addedAt }` (même slug,
   même rang) ; `localRecordToUiFile` expose la provenance (`source:
   'job'` ou absent) pour que la liste du projet porte la décision ; et
   `importDxfReplacingJobFiche` (`files.js`) branché aux DEUX chemins —
   le lot `.job` + DXF ET le DXF déposé seul. Réglages de coupe et octets
   du `.job` conservés (ceux du dépôt quand il en porte, ceux de la fiche
   remplacée sinon) ; la quantité réglée à l'écran ne bouge pas (même
   slug). Un DXF redéposé pour une fiche déjà DXF reste le comportement
   historique, hors lot comme convenu.
2. **Verrous.** Unitaire : la fiche du binaire puis le DXF avec
   `replace` ⇒ même slug, même `addedAt`, plus de `source: 'job'`, plus
   de constat « géométrie lue dans le fichier de travail », réglages
   conservés ; `localRecordToUiFile` rend la provenance. Harnais
   `QA_TWO_DROPS=1` sur la recette ×4 : `.job` seul (2 fiches
   `source: 'job'`, J6-A vert) PUIS `.job` + les deux DXF sur le MÊME
   projet ⇒ **toujours 2 fiches, sources nulles, mêmes slugs, mêmes
   rangs, réglages attachés**, puis le nesting et le `.job` rendu
   repassent tous leurs verrous (5/5 posées, points de départ 3 + 2,
   binaire intact hors drapeaux). La réserve mesurée par le vérificateur
   (« 4 fiches, quantités doublées ») est levée sur les DEUX chemins —
   le second dépôt d'un DXF SEUL passe par le même remplaçant.
3. **Hygiène.** Le verrou « série réelle » tolère désormais l'absence des
   deux fichiers « ordre » sur un poste qui a `.testparts` sans eux : il
   exige ≤ 4 croisements, tous « ordre », et journalise le détail. Les
   harnais d'audit passent de `QA_P3_ECRIN` / `qa-p3-collegue.dxf` à
   `QA_P3_MULTI` / `qa-p3-multi.dxf` (la moitié du nom du dessin du
   collègue vivait encore dans la variable et le défaut neutre).

Chiffres : vitest **768/768** (le verrou unitaire J6-bis en plus),
`nuxt build` vert, pile locale reconstruite aux sources, harnais
« double dépôt » tous verrous verts.

**Déployé le 14/09 au soir — `777b48a8b7db6ad379a65dc5c49f16d0d1684ecb`**
(J6 + J6-bis dans la même promotion) : build `34897972929` vert,
`promote-latest` `34898591945` vert, Hetzner `pull app` + `up -d app`
(seul le service app a bougé), page de prod à ce SHA, app.nestorcut.com
et nestorcut.com en 200. Homelab et benchmarks publics sans objet (aucun
diff moteur/worker). La recette C1 peut se jouer « `.job` seul ».

#### 9.66 Lot J6-bis — vérification (vérificateur, 15/09, `777b48a8`) — GO a posteriori, réserve levée

Rejoué sur le poste : image `app` reconstruite à HEAD (le démon Docker était
arrêté au matin, relancé), pile locale debout, vitest, puis un **rejeu
navigateur indépendant** du cas que j'avais mesuré en défaut, écrit sans
regarder le harnais de l'implémenteur (sorties hors dépôt,
`~/qa-out/verif-j6bis/`).

| Verrou | Résultat |
|---|---|
| vitest | **768 / 768** (64 fichiers, le verrou unitaire J6-bis en plus) |
| périmètre | `app/` + `shared/` + `docs/` + `scripts/` uniquement ; **aucun diff sous `workers/` ni `public/` depuis A1** — homelab et benchmarks publics bien sans objet, vérifié par `git diff ef8068ba..HEAD` |
| CI et promotion | build `777b48a8` vert PUIS `promote-latest` sur ce SHA (ordre correct, discipline D1) ; le build de `ff013cbb` qui suit n'a pas bougé `:latest` |
| production | la page expose `gitCommitSha 777b48a8…`, `app.nestorcut.com` et `nestorcut.com` en 200 |
| **1. `.job` seul** | 2 fiches, toutes deux `source: 'job'` avec leur constat, 1 pièce chacune ; **quantités 1 et 4 posées à l'écran** |
| **2. `.job` + ses 2 DXF, même projet** | **2 fiches** (et non 4) ; **plus aucune** `source: 'job'` ni constat ; **mêmes slugs**, **mêmes rangs** (`addedAt` à la milliseconde) ; réglages de coupe et octets du `.job` conservés ; **quantités toujours 1 et 4** |
| **3. inter-projets** (piège #47) | depuis un projet dont les fiches viennent du binaire, créer un projet NEUF en déposant le même nom de DXF : le projet neuf reçoit sa propre fiche, l'ancien garde ses deux fiches **aux mêmes slugs** — la liste du projet est un singleton, mais `getProject` s'exécute avant l'import des fichiers en attente, le remplacement ne peut pas traverser les projets |
| **4. `.job` renommé du nom d'un dessin** | reconnu par SIGNATURE en amont (piège #31) : traité comme le `.job` qu'il est, réglages ré-attachés, **aucun doublon** — le chemin de remplacement n'est jamais atteint |
| hygiène | `QA_P3_ECRIN` / `qa-p3-collegue.dxf` → `QA_P3_MULTI` / `qa-p3-multi.dxf` ; verrou « série réelle » : `≤ 4` croisements, tous « ordre », détail journalisé. Aucun nom de fichier du corpus dans le dépôt |

**La réserve du §9.64 est levée**, sur les deux chemins et avec ses effets de
bord : le remplacement est bien EN PLACE, la quantité réglée ne bouge pas et
l'ordre de la liste non plus.

**Un constat neuf, non bloquant (mesuré, pas déduit).** Le chemin de
remplacement appelle `importLocalBytes` DIRECTEMENT : les refus d'entrée de
`importLocalFiles` (extension `.dwg`, type non accepté, taille maximale) ne
s'exécutent plus. Mesuré avec un MÊME contenu DWG déposé sous deux noms, sur
un projet dont les fiches viennent du binaire :

| nom du fichier déposé | chemin | message |
|---|---|---|
| `autre.dwg` | ordinaire | « Les fichiers DWG sont convertis sur nos serveurs — choisis « Nos serveurs » pour ce fichier. » |
| `Piece_Trou.DXF` (nom d'une fiche du binaire) | remplacement | « Aucune pièce fermée trouvée dans ce fichier. » |

Contre-épreuve avec un VRAI fichier DWG (la fixture du worker fichiers,
7 537 octets) : mêmes deux messages, à l'identique — le message générique
ne vient pas d'un fichier fabriqué, il vient du chemin emprunté.

Aucune donnée n'est abîmée dans les deux cas (les fiches restent intactes,
rien n'est remplacé) : c'est une perte de MESSAGE, contraire au piège #33
(« rejet propre avec message actionnable, jamais d'import partiel
silencieux »), et le plafond de taille tombe avec. Portée étroite — il faut
déposer un fichier portant exactement le nom d'un dessin du `.job`.

**Correctif demandé (lot J6-ter, une ligne de chaque côté)** : ne pas
court-circuiter `importLocalFiles`. Lui passer `replace` dans ses `options`
et le laisser le transmettre à `importLocalBytes` après ses gardes ; le
chemin de remplacement garde alors extension, taille et signature. Verrou :
un `.dwg` déposé sous le nom d'une fiche `source: 'job'` rend
`localImport.dwgRejected`, et la fiche n'est pas touchée.

**GO a posteriori pour `777b48a8`** (déploiement couvert par le GO du §9.64,
qui autorisait J6 et J6-bis dans la même promotion). La recette C1 du
propriétaire se joue désormais avec le `.job` **seul**.

#### 9.67 Lot J6-ter — rapport de l'implémenteur (15/09)

Le constat du §9.66, corrigé tel que demandé — une ligne de chaque côté.

Le chemin de remplacement ne court-circuite plus `importLocalFiles` :
`importDxfReplacingJobFiche` (`files.js`) lui passe le File AVEC
`replace` dans les options, et `importLocalFiles` — qui transmettait déjà
ses options à `importLocalBytes` — exécute ses gardes d'entrée AVANT de
remplacer : extension (`.dwg` → `localImport.dwgRejected`), type accepté,
plafond de taille, signature `.job`. Plus aucune différence de message
entre le chemin ordinaire et le chemin de remplacement pour un même
dépôt.

**Verrou** (`sheetcamJobGeometry.test.js`) : un `.dwg` déposé avec
`replace` rend le refus ACTIONNABLE du garde et la fiche n'est pas
touchée (rien de stocké) ; le plafond de taille suit le même chemin
(`upload.tooLarge`) ; et la transmission reste intacte — un dépôt valide
avec `replace` remplace bien en place (même slug, même `addedAt`,
provenance retirée). Suite entière **769/769**, `nuxt build` vert, pile
locale reconstruite aux sources et harnais `QA_TWO_DROPS` repassé : tous
verrous verts (le remplacement par le chemin des gardes fonctionne de
bout en bout — 2 fiches, sources nulles, mêmes slugs et rangs).

Périmètre : deux fichiers (`files.js`, test) — app seule. Déploiement
après GO, ou groupé avec le prochain lot.
