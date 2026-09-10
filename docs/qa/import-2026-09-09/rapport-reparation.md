# Rapport de réparation d'import — spécification (lot E, 2026-09-10)

Livrable du lot E de `../../PLAN-IMPORT-2026-09-09.md` §3 : pour chaque
cause classée au lot D (`synthese.md` §2), **la phrase utilisateur FR et
EN**, son **niveau** (info / attention / refus) et **où elle s'affiche**.

**Aucun code.** Ce document est une spécification de texte et de
placement ; il ne décide ni ne livre aucune réparation. Les clés `i18n`
proposées n'existent pas encore, à l'exception de celles marquées
« existante ».

## 1. Les trois niveaux, et la règle qui les départage

| niveau | ce que ça veut dire | l'utilisateur doit… |
| --- | --- | --- |
| **info** | l'importeur a fait un choix normal ; **rien de découpable n'est perdu, aucune dimension n'est supposée** | rien |
| **attention** | quelque chose a été **perdu**, ou une **échelle a été supposée**. Le fichier est utilisable, le résultat peut ne pas être celui attendu | relire avant de découper |
| **refus** | rien n'est livré | corriger le fichier ou changer de chemin |

> **Règle de tri, unique :** *toute perte de matière et toute supposition
> d'unité est au moins « attention ».* Jamais « info ». C'est exactement ce
> que le lot D a trouvé de plus grave : ces deux familles sont aujourd'hui
> **silencieuses** (`synthese.md` §2.1, §2.3, §2.4), et un journal de
> worker n'est pas un message à l'utilisateur.

Corollaire, qui vaut spécification : **un fichier sans aucun constat
n'affiche rien.** Pas de « 0 avertissement », pas de pastille verte. 51
des 85 fichiers mesurés sortent en `read` : une ligne de statut sur ces
fichiers-là serait du bruit, et le bruit désamorce l'ambre.

## 2. Où ça s'affiche

Trois surfaces, qui existent déjà :

| surface | fichier | ce qu'elle porte |
| --- | --- | --- |
| **carte fichier** | `app/components/FileDone.vue` | **une seule ligne**, sous `file__name` : le résumé (§4). C'est la surface d'alerte |
| **fiche fichier** | `app/components/FileModal.vue` | la **liste complète**, une ligne par constat, chacune avec son niveau. C'est la surface de détail |
| **fichier refusé** | `app/components/FileError.vue` | le message de refus, à la place de `files.importFailed` qui est aujourd'hui la seule chose affichée |

Les textes vivent dans `app/utils/i18n.js` (dictionnaire plat, EN puis FR).

**Ce qu'il manque pour les alimenter** — constat du lot D, pas une
demande :

- **navigateur** : la liste est **déjà produite et déjà stockée**
  (`app/composables/localImport.js` écrit `warnings` dans
  l'enregistrement IndexedDB) ; `localRecordToUiFile` ne la recopie pas
  dans la forme rendue à l'UI. C'est le maillon manquant.
- **serveur** : il n'y a **pas de champ du tout**, seulement des
  `logger.warning` dans `workers/fileprocessing/core/main.py`. Un champ
  `importReport` sur le document fichier serait à créer — **additif**, les
  fichiers déjà en base n'en ont pas et doivent continuer de s'afficher
  sans (même discipline que les champs de rapport de nesting).

## 3. Le catalogue

Colonne « état » : ce qui est **mesurable aujourd'hui** vs ce qui suppose
une réparation du lot D (R1 unités, R2 contours, R3 remontée du message).
Aucune phrase de ce catalogue ne doit être livrée avant que la donnée
qu'elle affiche existe : **une phrase qui affiche un compte faux est pire
que le silence.**

### 3.1 Unités — cause C1

#### `import.unitConverted` — niveau **info**

- EN : `{unit} units detected — converted to millimeters (×{factor}).`
- FR : `Unités {unit} détectées — converties en millimètres (×{factor}).`
- Où : carte fichier + fiche fichier.
- Quand : `scaleApplied ≠ 1`. Témoins : c53 (cm, ×10), c54 (ft, ×304,8),
  c55 (in, ×25,4), c56 (m, ×1000), c57 (mil, ×0,0254).
- État : **mesurable aujourd'hui** des deux côtés (`unitDetected` +
  `scaleApplied` sont dans la grille). Dépend de R3 pour l'affichage.

#### `import.unitAssumed` — niveau **info**

- EN : `No unit declared in the file — millimeters assumed.`
- FR : `Aucune unité déclarée dans le fichier — millimètres supposés.`
- Où : fiche fichier **seulement** (pas la carte).
- Quand : `$INSUNITS` absent ou 0. **19 fichiers sur 85** (c04, c58,
  c60–c76, c80).
- État : mesurable aujourd'hui.
- **Arbitrage, consigné** : « info », pas « attention », alors que la règle
  du §1 pousserait à l'ambre. Raison : le cas touche **un fichier sur
  cinq** et le DXF 2D sans `$INSUNITS` est la norme d'une grande partie des
  CAO ; un ambre sur 22 % des imports banalise l'ambre et tuerait le signal
  des cas vraiment dangereux (§3.1 suivant). D'où le compromis : présent
  dans la fiche, absent de la carte. **Réversible d'une ligne** si le
  propriétaire préfère l'inverse.

#### `import.unitUnknown` — niveau **attention**

- EN : `Unknown drawing unit ($INSUNITS code {code}) — millimeters assumed. Check the dimensions before cutting.`
- FR : `Unité de dessin inconnue (code $INSUNITS {code}) — millimètres supposés. Vérifiez les dimensions avant de découper.`
- Où : carte fichier + fiche fichier.
- Quand : code `$INSUNITS` hors table de conversion (3, 7, 10 à 20).
  Témoin : **c59** — code 7 (km), facteur appliqué 1,0, soit **une erreur
  de facteur 10⁶**, statut `read` côté ezdxf, sans un mot à l'utilisateur.
- État : **la moitié existe déjà** — le wasm émet
  `unknown $INSUNITS=7 — assuming millimeters` et bascule en `repaired`.
  Côté serveur, rien : dépend de **R1**.
- C'est **la phrase la plus rentable du catalogue** : elle coûte un
  affichage et elle intercepte la seule erreur du corpus qui multiplie
  toute la géométrie par un million.

#### `import.unitUnreadable` — niveau **attention**

- EN : `Unit header unreadable — millimeters assumed. Check the dimensions before cutting.`
- FR : `En-tête d'unité illisible — millimètres supposés. Vérifiez les dimensions avant de découper.`
- Où : carte fichier + fiche fichier.
- Quand : `$INSUNITS` présent mais non exploitable. Témoins : **c08 à
  c11**, qui écrivent `4.0` / `1.0` dans un groupe 70 entier.
- État : **dépend de R1**. Et il faut le dire clairement : après R1 ces
  quatre fichiers ne déclencheront **plus rien**, parce que le parseur les
  lira. Cette phrase est un filet pour les en-têtes réellement corrompus,
  pas la réponse au bug de c08–c11 — la réponse au bug est le correctif.

### 3.2 Contours ouverts — cause C2

#### `import.contoursClosed` — niveau **info**

- EN : `{n} open contours closed (gap ≤ {threshold}).`
- FR : `{n} contours ouverts refermés (écart ≤ {threshold}).`
- Où : carte fichier + fiche fichier.
- `{threshold}` s'affiche **dans l'unité de l'utilisateur**
  (`app/utils/units.js` + `useUnit`) ; le pipeline reste en mm.
- État : **dépend de R2**, entièrement. Il n'existe aujourd'hui aucune
  étape de fermeture, d'aucun côté, et le champ `openContoursClosed` est
  `null` sur les **170** JSON du lot B/C. **Ne pas livrer cette phrase
  avant la couture** : elle annoncerait une réparation qui n'a pas lieu.

#### `import.contoursDropped` — niveau **attention**

- EN : `{n} open paths could not be closed and will not be cut (gap larger than {threshold}). Close them in your CAD, or raise the tolerance.`
- FR : `{n} tracés ouverts n'ont pas pu être refermés et ne seront pas découpés (écart supérieur à {threshold}). Refermez-les dans votre CAO, ou augmentez la tolérance.`
- Où : carte fichier + fiche fichier.
- Quand : `openContours > 0` et au moins une pièce livrée.
- Témoins mesurés : **c73** (1 337 tracés pendants pour 6 pièces), **c75**
  (1 351 / 2), **c74** (1 334 / 2), c80 (106 / 5), et le seul témoin réel,
  **c03** (9 tracés pendants, 10 pièces de moins côté navigateur que côté
  serveur). Total corpus : **4 221 segments pendants, jamais signalés.**
- État : **dépend de R2 pour l'instrumentation.** Côté serveur la donnée
  existe déjà (les `dangles` de `polygonize_full`) et n'est pas remontée ;
  côté navigateur elle **n'est pas produite du tout** (`openContours` est
  `null` sur les 85 JSON wasm). C'est la phrase que le §7 vise quand il
  parle de « perte silencieuse de pièce » — elle est aussi celle qui
  demande le plus de travail avant de pouvoir être dite.
- **Vocabulaire** : « tracé ouvert », jamais « dangle » ; « écart », jamais
  « gap ».

#### `localImport.noParts` — niveau **refus** — *clé existante, à enrichir*

- Aujourd'hui — EN : `No closed part found in this file.` / FR :
  `Aucune pièce fermée trouvée dans ce fichier.`
- Proposé quand le compte est connu — EN :
  `No closed part found in this file — {n} open paths detected. Close the contours in your CAD.`
  FR : `Aucune pièce fermée trouvée dans ce fichier — {n} tracés ouverts détectés. Refermez les contours dans votre CAO.`
- Où : `FileError.vue`.
- **La variante courte reste la phrase par défaut** quand `n` n'est pas
  mesuré (aujourd'hui : toujours, côté navigateur). On n'affiche pas un
  compte qu'on n'a pas.
- Témoins du refus : c43, c47, c49, c51, c64, c67, c77 (et c08, c11 côté
  navigateur seulement).

### 3.3 Entités écartées — causes C3 et C4

#### `import.entitiesSkipped` — niveau **attention**

- EN : `{n} unsupported entities were skipped ({types}) — the material they described will not be cut.`
- FR : `{n} entités non prises en charge ont été ignorées ({types}) — la matière qu'elles décrivaient ne sera pas découpée.`
- Où : carte fichier (au plus 3 types, puis « … ») + fiche fichier (tous
  les types, avec leur compte).
- Quand : au moins une entité **porteuse de matière** écartée : `HATCH`,
  `SOLID`, `TRACE`, `3DFACE`, `SHAPE`, `REGION`, `3DSOLID`, `MLINE`,
  `ACAD_PROXY_ENTITY`, `OLE2FRAME`, `ACAD_TABLE`, `REPEAT`/`ENDREP`.
  **14 fichiers sur 85.** Témoins : c44 et c45 (`HATCH`), c78
  (`OLE2FRAME`, `REGION`, `3DSOLID`), c80 (`ACAD_PROXY_ENTITY`, 27 fois).
- État : **la liste existe déjà côté navigateur** et meurt à la frontière
  UI. Dépend de **R3** — c'est la phrase la moins chère du catalogue.
- **Prérequis de cohérence** : le partage « matière » / « bruit » doit
  vivre dans **une seule table**, lue par les deux importeurs. Deux listes
  qui divergent, et le même fichier sera « attention » sur un chemin et
  « info » sur l'autre — exactement le genre d'écart que le lot D a
  mesuré sur 20 fichiers.

#### `import.annotationsSkipped` — niveau **info**

- EN : `Text and dimensions skipped ({n} entities) — only contours are cut.`
- FR : `Textes et cotes ignorés ({n} entités) — seuls les contours sont découpés.`
- Où : fiche fichier seulement.
- Quand : entités de **bruit** uniquement (`TEXT`, `MTEXT`, `ATTDEF`,
  `ATTRIB`, `SEQEND`, `DIMENSION`, `LEADER`, `VIEWPORT`, `IMAGE`,
  `TOLERANCE`, `XLINE`, `RAY`, `WIPEOUT`). **8 fichiers sur 85** n'ont que
  ça ; `TEXT` apparaît dans 17 fichiers, `DIMENSION` dans 11.
- État : dépend de R3. Comportement **voulu** : c'est une information, pas
  un avertissement.

### 3.4 Splines et blocs — causes C5 et C6

#### `import.splinesSampled` — niveau **info**

- EN : `{n} splines sampled to within {tolerance}.`
- FR : `{n} splines échantillonnées à {tolerance} près.`
- Où : fiche fichier.
- Quand : `splines > 0`. 7 fichiers (c41, c42, c49, c50, c74, c75, c78).
  **Aucun refus du corpus n'est imputable à une spline** : c49 est refusé
  parce que sa spline est *ouverte*, pas parce que c'est une spline.
- État : mesurable aujourd'hui (`splines`, `splinesHandled: sampled`).

#### `import.blocksFlattened` — niveau **info**

- EN : `{n} blocks flattened.`
- FR : `{n} blocs aplatis.`
- Où : fiche fichier.
- Quand : `blocksFlattened > 0`. 16 fichiers. Témoin lu proprement des
  deux côtés : c36 `blocks_nested.dxf` (3 pièces / 3 pièces).
- État : mesurable aujourd'hui.
- C'est le fragment « 1 bloc aplati » de l'exemple du plan §3 lot E.

### 3.5 Format et volume — causes C8 et C9

#### `localImport.unsupportedType` — niveau **refus** — *clé existante, à corriger*

- Aujourd'hui — FR : `Type de fichier non supporté — DXF ou SVG uniquement sur cet appareil.`
- Proposé, pour le DXF binaire — EN :
  `Binary DXF is not supported — re-save the file as ASCII DXF from your CAD.`
  FR : `DXF binaire non pris en charge — ré-enregistrez le fichier en DXF ASCII depuis votre CAO.`
- Où : `FileError.vue`.
- **Pourquoi ne pas renvoyer vers « Nos serveurs »** : le lot D a mesuré
  que **le chemin serveur ne lit pas non plus le DXF binaire** (c82 et c83
  : `DXFStructureError: Invalid group code "AutoCAD Binary DXF"`).
  Renvoyer l'utilisateur vers un chemin qui échouera aussi est une
  promesse fausse. **Règle générale : ne jamais orienter vers un chemin
  dont on n'a pas vérifié qu'il réussit.**
- La phrase actuelle reste juste pour les types réellement non DXF/SVG ; il
  faut **deux clés**, pas une.

#### `localImport.tooManyEntities` — niveau **refus** — *clé existante, à enrichir*

- Aujourd'hui — FR : `Ce fichier contient trop d'entités pour un import navigateur — essayez « Nos serveurs ».`
- Proposé — EN : `This file has too many entities for in-browser import ({n} entities, limit {max}) — try “Our servers”.`
  FR : `Ce fichier contient trop d'entités pour un import navigateur ({n} entités, {max} au maximum) — essayez « Nos serveurs ».`
- Où : `FileError.vue`.
- Les nombres portent leur libellé (« entités », « au maximum ») : un
  nombre nu est incompréhensible.
- **Ici le renvoi vers « Nos serveurs » est légitime** : c73 et c74, refusés
  par cette garde côté navigateur, sont bien lus par le chemin serveur
  (`repaired`, 6 et 2 pièces).
- **Réserve de séquencement, pas de texte** : ce refus arrive aujourd'hui
  **après** 4,9 s (c73) et 7,2 s (c74) d'import déjà payé. Aucune
  formulation ne rachète une attente de sept secondes pour un refus. C'est
  R3, pas ce document.

### 3.6 Ce qui n'a délibérément pas de phrase

- **C1b vu du produit** (`$INSUNITS` en flottant), **C9** (garde tardive)
  et **C10** (divergence de comptage entre les deux importeurs) sont des
  **défauts**, pas des états à raconter. On les corrige, on ne les
  annonce pas. En particulier C10 : l'utilisateur ne voit qu'un chemin à
  la fois ; lui dire que l'autre chemin aurait rendu 5 pièces au lieu de 1
  ne l'aide en rien et détruit la confiance dans les deux.
- **Le coût d'import** (§2.6 et §2.7 de la synthèse : 9,4 s sur c03,
  ~4,3 s pour un SVG de 6 entités) relève d'un indicateur de progression,
  pas d'un message de rapport. Hors périmètre de ce document.

## 4. Composer plusieurs constats en une ligne

`FileDone.vue` n'a la place que d'**une ligne**. Règle :

1. Ordre : **refus > attention > info**, puis à niveau égal par nombre
   décroissant.
2. Au plus **trois** fragments, séparés par « , ».
3. Au-delà : `… et {n} autres` (EN `… and {n} more`), qui ouvre la fiche
   fichier.
4. La **fiche fichier** montre tout, une ligne par constat, avec son
   niveau. Elle ne résume jamais.
5. Rien à dire ⇒ **rien affiché**.

L'exemple du plan §3 lot E se rend exactement ainsi :

> **FR** — « 2 contours ouverts refermés, 1 bloc aplati, unités mm détectées »
> **EN** — “2 open contours closed, 1 block flattened, mm units detected”

*(Trois `info`, donc aucune couleur d'alerte : la ligne est grise. La même
ligne avec un `import.contoursDropped` en tête passerait en ambre et
commencerait par lui.)*

## 5. Contraintes de rédaction (à ne pas redécouvrir)

- **`app/utils/i18n.js`, dictionnaire plat, EN puis FR.** Toute chaîne FR
  contenant une apostrophe s'écrit **entre doubles quotes** — sinon
  `PARSE_ERROR` au build (`AGENTS.md` §2 piège #20). Presque toutes les
  phrases ci-dessus sont concernées (`n'ont`, `d'entités`, `l'utilisateur`).
- **Tout nombre affiché porte un libellé visible** (piège #24) : « 1 337
  tracés ouverts », jamais « 1 337 ».
- **Les longueurs s'affichent dans l'unité de l'utilisateur**
  (`app/utils/units.js` + `useUnit`) ; le pipeline et les messages internes
  restent en mm canoniques (piège #25). Les seuils `{threshold}` et
  `{tolerance}` sont donc formatés, pas concaténés.
- **Vocabulaire métier, pas vocabulaire DXF** : « tracé ouvert » (pas
  *dangle*), « bloc » (pas *INSERT*), « cote » (pas *DIMENSION* dans la
  phrase de la carte — le type technique n'apparaît que dans la fiche).
- **Ne jamais orienter vers un chemin non vérifié** (§3.5). Et ne jamais
  annoncer une réparation non livrée : une phrase reste au tiroir tant que
  la donnée qu'elle affiche n'existe pas.

## 6. Non-faits de ce document

1. **Rien n'est décidé.** Les niveaux, les clés et les placements sont des
   propositions ; l'arbitrage de `import.unitAssumed` (info vs attention,
   §3.1) est consigné comme tel et réversible.
2. **Aucune phrase n'a été testée sur un utilisateur.** Elles sont écrites
   depuis les constats du lot D, pas depuis une session d'observation.
3. **La moitié du catalogue n'est pas alimentable aujourd'hui** :
   `import.contoursClosed` et `import.contoursDropped` supposent R2,
   `import.unitUnknown` côté serveur suppose R1, et **tout** l'affichage
   suppose R3. L'état est indiqué phrase par phrase ; livrer une phrase
   avant sa donnée afficherait un compte faux.
4. **Le SVG n'est pas couvert.** Le corpus est composé de 85 DXF et de zéro
   SVG (`synthese.md` §2.7) : aucune des causes ci-dessus n'a été observée
   sur un SVG, et le constat SVG du lot C n'a pas de fichier témoin
   conservé. Les phrases d'unité (`$INSUNITS`) n'ont d'ailleurs pas de sens
   pour un SVG — svgelements et le crate normalisent en px CSS 96 dpi, la
   grille §4 met `unitDeclared: null`. Un catalogue SVG est un travail
   distinct.
5. **Le DWG n'est pas couvert** non plus : hors périmètre du lot A.
6. **Aucune maquette.** Le placement est décrit par fichier de composant et
   par position (« sous `file__name` ») ; la forme visuelle — couleur de
   l'ambre, icône, troncature — reste à la charge du lot UI, avec la règle
   maison du rayon 4 px et sans pastille.
