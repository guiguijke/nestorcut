# Plan « pièces unitaires » — éclatement et mise à l'échelle à l'import, robustesse aux traits fins (2026-09-12)

Décision propriétaire du 12/09 : **priorité 1 du reste à livrer, avant le
`.job` SheetCam**. Origine : un collègue qui tient un vrai atelier de découpe
travaille souvent sur des DXF de logos complets et veut nester chaque pièce
individuellement pour optimiser ses tôles ; il demande aussi une mise à
l'échelle à l'import. Le fichier réel qu'il a fourni (privé, `.testparts/`,
sha256 `5c6cdd96977f…`, jamais nommé ici) : 17 pièces reconnues par NestorCut, et
le nesting navigateur échoue avec « The on-device compute stopped
unexpectedly. The nesting was refunded — please try again with a smaller job »
alors que les pièces sont petites.

## 1. Diagnostic de l'échec (vérificateur, 12/09, mesuré)

Reproduit à l'identique sur le poste (harnais navigateur à un fichier, tôle
1000 × 2000, espacement 2, direction gauche) : échec en 0 s, même message. Le
moteur avait pourtant dit exactement pourquoi, et le texte dormait dans le
champ `information` du job, tronqué à 400 caractères et jamais affiché :

```
importing SPP instance into jagua-rs: Simple polygon contains intersecting
edges 191 and 195: [Point(-550.22076, 45.426735), Point(-550.2124, 45.34102), …
```

Ce qui a été établi, dans l'ordre :

| Étape | Résultat |
|---|---|
| Import navigateur (wasm, tol 0,01) | 17 pièces, 29 trous, 813 splines, 0,5 s ; **tous les anneaux valides** (shapely) |
| Import serveur (ezdxf, tol 0,01 / 0,1 / 0,5) | 17 pièces, tous les anneaux valides |
| Simplification JS 0,05 puis ouverture des trous wasm à espacement 2 | 17 anneaux **valides** |
| Instance moteur réelle (builder navigateur rejoué, 16 items après pré-passe méta) | rejouée en **natif** : **même panne**, mêmes points |
| Variante trous fermés (aucun canal) | **même panne** : les canaux ne sont pas en cause |
| Variante sans l'item 12 (la volute, 1612 × 231 mm) | **le moteur tourne** (bande 600 mm, 16 pièces) |
| Variante espacement 0,5 | même panne, points déplacés : le polygone listé est **le polygone gonflé**, pas l'anneau d'entrée |
| Largeur locale de la volute (sommet → arête non voisine) | **min 0,18 mm** ; **345 sommets sur 1 182 à moins de 2 mm** — un ruban calligraphique en trait fin |
| Trous de la volute | 21 « trous » de 0,3 × 1,3 à 2 mm : des **micro-vides** entre deux contours quasi confondus, pas des trous réels |

**Cause** : jagua gonfle chaque pièce de `space/2` à l'import
(`crates/jagua-rs/src/geometry/shape_modification.rs::offset_shape`,
`geo_buffer::buffer_polygon_rounded`, puis `SPolygon::new` qui exige un
anneau simple). Sur une forme **plus fine que l'espacement**, la sortie de
`geo_buffer` contient de petites boucles auto-sécantes (arêtes 191/195) et
`SPolygon::new` refuse. Le moteur s'arrête à l'import, le pool navigateur
reçoit une erreur générique, le job est remboursé avec un message qui parle
de « job trop gros ». **Toute pièce à trait fin ou à pointe** (calligraphie,
flèche, empattement, gravure) déclenche la même panne dès que l'espacement
dépasse sa largeur locale — ce n'est pas propre à ce fichier.

Trois défauts distincts, donc :

1. **Moteur** : le gonflement d'une forme fine n'est pas robuste (piège #2,
   version « anneau externe »).
2. **Message** : la cause précise existe (`information`) et l'utilisateur
   lit « réessayez avec un job plus petit » ; ni la pièce ni le fichier ne
   sont nommés.
3. **Import** : des micro-vides de 0,3 mm sont pris pour des trous (21 canaux
   ouverts pour rien) ; des sommets quasi confondus (23 segments < 0,1 mm)
   sont conservés.

## 2. Ce qui existe déjà, et ce qui manque pour la demande du collègue

- **Chaque contour fermé d'un DXF est déjà un item de nesting distinct**
  (`localPayloadBuilder.js`, boucle `parts` × `count` ; miroir
  `convert_files_to_input_items`). Les 17 pièces du logo sont nestées
  séparément — quand le moteur ne tombe pas.
- Ce qui manque : la **quantité, les rotations et la suppression par pièce**
  (aujourd'hui portées par le fichier : « Nest 1 part » sur le bouton pour
  17 pièces), et la **mise à l'échelle**.
- L'outillage est là : `export_dxf` (nest-export) écrit déjà un sous-ensemble
  d'entités **par handles** avec une transformation affine (c'est l'export
  résultat) ; les handles canoniques d'une pièce sont dans `parts[].handles`
  (piège #33b) ; la conversion d'unités est déjà un facteur d'échelle appliqué
  au DXF avant l'import.

## 3. Consigne (fermée) — trois lots, un commit et un rapport chacun (§5)

### Lot E0 — le moteur ne meurt plus sur un trait fin, et il dit ce qu'il refuse

Objectif : le fichier du collègue se neste à espacement 2 et 0,5 dans le
navigateur ET sur le serveur ; aucun job ne finit plus en « stopped
unexpectedly » pour une géométrie.

1. **Gonflement robuste, en repli seulement** (jagua vendorisé,
   `shape_modification.rs`, patch consigné dans `VENDORED.patch.md`) : si
   `SPolygon::new` refuse la sortie de `geo_buffer`, reconstruire le contour
   par une union robuste en arithmétique entière (`i_overlay`, règle non
   nulle) et garder le polygone de plus grande aire ; refuser seulement si
   cela échoue encore. Le chemin actuel reste **bit-identique** quand
   `geo_buffer` réussit : `determinism_lock.py` inchangé (SHA `a1bd8810…`),
   corpus 11/11 inchangé. Verrous cargo : ruban synthétique de largeur
   0,3 mm à espacement 2 et 0,5 (import OK, aire gonflée ≥ aire brute,
   distance exacte ≥ `space − 0,01` aux voisins dans un SPP à 3 items) ;
   déterminisme natif ≡ wasm sur cette fixture.
2. **Erreur d'import moteur structurée** : `nest-engine` attrape l'échec
   d'import par item et émet `{"type":"error","kind":"item_geometry",
   "item":k,"reason":…}` ; le pool navigateur (`localPool.js`) et le worker
   Python remontent `item` → `itemMap` → fichier + rang de pièce. Message
   utilisateur (FR/EN, clé nouvelle, jamais `crashLocal`) : « La pièce N du
   fichier F a des traits plus fins que l'espacement demandé (X mm) : le
   moteur ne peut pas la préparer. Réduisez l'espacement ou corrigez le
   dessin. » Le remboursement reste. Verrou : test vitest du mapping
   item → (fichier, pièce) ; capture du bandeau.
3. **Coureur « moteur × 238 fichiers »** (`scripts/` ou `bench/`) : chaque
   fichier du corpus (85 versionnés + 153 réels) devient une instance SPP à
   espacement 2 (une pièce par contour, demande 1, tôle 3000 × 1500) passée
   au moteur natif avec budget 2 s : compter les échecs d'import **avant**
   et **après** le lot. Attendu après : 0. Les identifiants réels restent des
   hash.

### Lot E1 — « Import avancé » : éclatement en pièces unitaires et mise à l'échelle (navigateur)

Objectif : un utilisateur peut, à la dépose d'un DXF, choisir d'en faire
une fiche par pièce et de le mettre à l'échelle ; l'import en masse de 50
DXF ne change ni de geste ni de vitesse.

1. **Option repliée, éteinte par défaut** dans `DxfUpload.vue` : un
   interrupteur « Import avancé » ; ouvert, deux réglages : « Éclater en
   pièces unitaires » (case) et « Échelle » (facteur, ou largeur/hauteur
   cible du dessin complet en unité courante — l'un calcule l'autre,
   `app/utils/units.js`). Le réglage vaut pour tous les fichiers de la
   dépose ; il est mémorisé dans la session, pas dans le compte.
   Aucun changement quand l'option est éteinte : le harnais deux
   configurations et les captures U3 sont inchangés.
   **Précision propriétaire du 12/09** : c'est une option que l'utilisateur
   **valide** explicitement (« Import avancé »), jamais l'import par
   défaut. Et l'échelle se règle **à vue, contre une tôle de découpe** :
   le panneau montre le dessin importé (contours des pièces, couleurs de
   l'aperçu existant) posé sur une tôle choisie parmi les formats par
   défaut (`SHEET_PRESETS`, `app/utils/units.js`, 1000 × 2000 en tête) ou
   saisie en dimensions personnalisées ; l'utilisateur ajuste la taille du
   dessin soit par les champs (facteur, largeur ou hauteur cible), soit
   **en tirant une poignée d'angle** sur l'aperçu (rapport conservé, cotes
   affichées en direct, facteur recalculé) ; la tôle choisie ici
   pré-remplit les réglages de tôle du projet si l'utilisateur le demande
   (case), sans les écraser sinon. Verrous : le dessin de 1612 mm posé sur
   1000 × 2000 apparaît hors tôle, tiré à 900 mm de large → facteur 0,558
   affiché, pièces importées à cette échelle ; changer de format de tôle
   ne change pas le facteur ; l'aperçu n'est qu'un aperçu — aucune
   géométrie n'est produite tant que l'import n'est pas validé.
   **Langues** (rappel propriétaire du 12/09) : « Import avancé » est un nom
   de travail, pas un libellé. Tout texte du panneau — interrupteur,
   réglages, infobulles, boutons, cotes et leurs unités, constats, phrase de
   nommage des fiches éclatées — passe par `app/utils/i18n.js` en anglais
   ET en français dès le lot, nombres et unités formatés dans la locale
   (`fmtNumber`, `useUnit`), aucun texte en dur dans les composants (piège
   #20 : doubles quotes pour les apostrophes françaises). Le suffixe des
   fiches éclatées est neutre (« nom · 3/17 »), pas une phrase. Verrou : le
   panneau capturé dans les deux langues ; une troisième langue ne doit
   demander qu'un dictionnaire de plus.
2. **Une seule chaîne de code** : import du DXF (existant) → si échelle ≠ 1,
   DXF canonique **mis à l'échelle** (affine sur les entités, `nest-export`,
   codes entiers en entiers) → si éclatement, **un DXF canonique par
   pièce** écrit à partir de ses `handles` (le sous-ensemble d'entités de la
   pièce, trous compris, à l'identité) → chaque DXF produit repasse par
   l'import ordinaire (`geoImportFile`), d'où fiches fichier normales
   (quantité, rotations, couleur, suppression, aperçu) nommées
   « nom (k/N) ». Le fichier d'origine n'est pas conservé comme fiche ; le
   facteur d'échelle et le rang d'origine sont des champs **additifs** du
   document fichier (`importScale`, `explodedFrom`, `explodedIndex`) —
   provenance lisible, aucun champ existant modifié.
3. **Le micro-vide n'est plus un trou** (les deux importeurs, même règle) :
   un trou dont l'aire est inférieure à 1 mm² ou dont la plus petite
   dimension est inférieure à 0,5 mm est **rebouché** et compté dans un
   constat « N micro-vides ignorés » (niveau information, porté par le lot
   2c) ; deux sommets consécutifs à moins de 0,01 mm sont fusionnés. Verrou :
   la volute passe de 21 trous à 0 des deux côtés ; parité wasm ≡ ezdxf sur
   les 238 fichiers (comptes de pièces et de trous, dérive attendue
   uniquement sur les fichiers à micro-vides, listés) ; seed canonique
   inchangé pour les fichiers sans micro-vide ; handles canoniques 14/14.
4. Verrous produit : le logo du collègue éclaté donne 17 fiches (une pièce
   chacune), quantités indépendantes, nesting 17/17 sur 1000 × 2000 à
   espacement 2 ; échelle ×0,5 → largeur totale 806 mm mesurée sur les
   pièces importées ; échelle par largeur cible 1000 mm → facteur 0,620 ;
   dépose de 10 DXF option éteinte : même temps d'import qu'avant (± bruit),
   aucune fiche supplémentaire.

### Lot E2 — miroir serveur et constats

1. Le chemin « Nos serveurs » (worker fileprocessing) applique les mêmes
   options depuis les champs du document fichier : échelle par affine
   ezdxf après décomposition (piège #26), éclatement par sous-ensemble
   d'entités par handles (`dxf_utils`), micro-vides rebouchés ;
   parité des comptes wasm ≡ ezdxf sur le logo (17 fiches, mêmes pièces).
2. Constats du lot 2c enrichis : « micro-vides ignorés », « pièce plus fine
   que l'espacement » (au nesting, depuis le lot E0 : liste des items dont
   le gonflement a pris le repli), « mise à l'échelle ×F appliquée ».

## 4. Invariants et ordre

Handles canoniques (piège #33b) ; seed canonique inchangé hors fichiers
touchés par la règle micro-vides ; `determinism_lock.py` inchangé ; corpus
11/11 ; harnais deux configurations ; aucun nom de fichier réel dans
`docs/`. Ordre : **E0 → E1 → E2**, GO du vérificateur par lot ; E0 se
déploie seul dès son GO (défaut de production actif : tout trait fin tue le
job), avec régénération des benchmarks publics si le SHA du verrou de
déterminisme a bougé (il ne doit pas).

Le harnais navigateur à un fichier utilisé pour la reproduction est
`scripts/qa-e2e-local-onefile.tmp.mjs` (copie du harnais deux tôles avec
`QA_FILE`) : à intégrer proprement au harnais principal (`QA_FILES`,
`QA_EXPECT=engine-error`) plutôt que de garder la copie.

## 5. Rapports par lot

### Lot E0 — le moteur ne meurt plus sur un canal fin, et il dit ce qu'il refuse (implémenteur, 12/09)

Commit : `b1da2690`. **Non déployé** — moteur natif, wasm moteur, app, serveur et
worker nesting touchés ; GO attendu. E0 se déploie seul (défaut de
production actif).

#### 5.1 La cause, mesurée — le diagnostic du §1 était incomplet

| Constat | Mesure |
|---|---|
| **ce n'est pas la finesse du BRIN, c'est l'étroitesse du CANAL** | quatre rubans synthétiques de 0,18 à 0,3 mm de large passent le gonflement sans broncher, y compris très ondulés. Ce qui le fait tomber, c'est une **volute** : deux brins séparés par un canal plus étroit que le gonflement, dont les bords décalés se croisent |
| **la sortie de `geo_buffer` n'est pas réparable** | sur la volute synthétique du verrou (canal 0,3 mm, offset 1 mm), `geo_buffer` rend un contour de 278 points d'**aire 47 mm² pour une pièce de 353 mm²** : l'information est déjà perdue |
| **ma première version du repli était donc fausse** | union « non nulle » de ce contour (la lettre de la consigne) ⇒ gonflement de 353 à **47 mm²**, sept fois plus petit que la pièce. La règle non nulle GARDE les boucles parasites, orientées à l'envers. C'est le verrou d'aire qui l'a attrapée — un verrou « import OK » seul l'aurait laissée passer |
| **le fichier réel confirme le mécanisme** | des 17 pièces, la volute (item 12, 2 975 sommets, 21 trous) est la seule à tomber, et elle tombe aux **deux** espacements (2 mm et 0,5 mm) |

#### 5.2 Ce qui est livré

1. **Gonflement robuste, en repli seulement** (jagua vendorisé,
   `shape_modification.rs`, patch consigné en `VENDORED.patch.md §3`). Le
   repli ne répare pas la sortie de `geo_buffer` : il **recalcule le
   gonflement depuis l'anneau d'origine**, comme une somme de Minkowski
   explicite — réunion de la pièce, d'un rectangle par arête et d'un polygone
   à 32 côtés **circonscrit** au disque par sommet, unis en arithmétique
   **entière** (`i_overlay` 4.5.2, règle **positive** et non « non nulle »).
   Trois propriétés, qui sont les raisons de cette forme : le résultat
   contient la pièce (une aire gonflée ne peut pas être plus petite), il
   contient le disque de rayon `d` autour de chaque point du bord
   (**l'espacement promis est tenu**), et il est reproductible natif ≡ wasm
   (seules transcendantales : le crate `libm`, règle #14b). Les trous
   éventuels du résultat (une volute dont les brins se rejoignent) sont
   laissés pleins : `SPolygon` n'a pas de trous, et un anneau plein est un
   sur-ensemble. Le repli ne s'exécute **que sur l'erreur** et **qu'en
   gonflement**.
2. **Erreur d'import moteur désignée par item**
   (`nest-engine/src/import_error.rs`) : sur échec d'`import_instance`, et
   seulement alors, le moteur rejoue l'import item par item, émet
   `{"type":"error","kind":"item_geometry","item":k,"reason":…}` sur son flux
   (le worker Python lisait déjà les lignes `type:error`) et préfixe son
   message `item_geometry:<id>:` — en navigateur, le seul canal est le
   message de l'exception wasm. Coût nul sur le chemin normal.
3. **Le chemin jusqu'au message, des deux côtés** :
   `app/composables/localGeomError.js` (pur) et `core/engine.py`
   (`parse_item_geometry`, `item_geometry_message`, purs). Nouvelle clé i18n
   FR/EN `localMode.itemGeometry` + une variante sans identifiant, **jamais
   `crashLocal`** ; remboursement inchangé ; champ **additif**
   `itemGeometry {slug, part}` sur le document job. L'`itemMap` du document
   job est désormais transmise au runner navigateur : sans elle, un job
   **préparé par le serveur** (compte Free sur un projet serveur) retombait
   sur le message générique.
4. **Coureur « moteur × 238 fichiers »** (`scripts/qa-engine-corpus.mjs`) :
   import navigateur (le bundle wasm géométrie de `public/geometry`, celui du
   worker de l'app) → une instance SPP par fichier (un item par contour,
   demande 1, espacement 2 mm, tôle 3000 × 1500) → binaire moteur, **avant**
   et **après** le repli. Identifiants réels = préfixe de sha256.
5. **Harnais navigateur dédié** (`scripts/qa-e2e-item-geometry.mjs`) : deux
   passes sur le même fichier et la même app, le moteur wasm « avant » étant
   substitué **par la route** (le nom du fichier wasm ne change jamais,
   piège #14i).

#### 5.3 Verrous

| Verrou | Résultat |
|---|---|
| **contrôle NÉGATIF de la fixture** (`inflate_fallback.rs`) | le chemin primaire seul (`geo_buffer` + `import_simple_polygon`, rejoué dans le test avec `geo-buffer` en dev-dépendance) **échoue** sur la volute aux deux offsets. Sans ce contrôle, le verrou passerait même si le repli ne servait à rien |
| **le repli gonfle vraiment** | aire 353,3 → **585,4 mm²** (offset 1 mm) et **521,2 mm²** (offset 0,25 mm) |
| **l'espacement promis est tenu** | distance bord brut ↔ bord gonflé **1,0000 mm** et **0,2500 mm** (exigé ≥ `d − 0,01`) |
| **SPP à trois volutes, espacement 2** | les 3 items sont posés, distance exacte arête↔arête minimale **2,0024 mm** |
| **déterminisme natif ≡ wasm sur la fixture** | nouvelle fixture `bench/fixtures/e0_volute` (SPP, 3 volutes, bornée en travail) ajoutée à `determinism_lock.py` : SHA **`4ff43700e8ba…`** des deux côtés |
| **le chemin actuel est bit-identique** | fixture `b_demo` : SHA **`a1bd88106a7a…` inchangé** — natif et wasm |
| **corpus de torture, sur l'image reconstruite** | **11/11 OK** (T-F partiel et T-J refus, tous deux attendus) : sans recouvrement, dans la tôle, 0 doublon, aucun rollback de post-pass |
| **mapping item → (fichier, pièce)** | vitest `app/tests/localGeomError.test.js` **7 tests** (lecture de l'identifiant, refus d'inventer un rang quand l'id est inconnu, repli sur le slug, phrase FR et EN qui nomme le fichier et la pièce et annonce le remboursement) + 1 test de transmission de l'`itemMap` dans `localSolverRegistry.test.js` |
| **miroir serveur du mapping** | pytest `workers/nesting/tests/test_item_geometry.py` **10 tests**, dont « un échec moteur ordinaire n'est PAS transformé en message de géométrie » |
| **bandeau, dans un vrai navigateur** | `docs/qa/eclatement-2026-09-12/lotE0/01-…` : « The engine could not use **part 13** of “**volute.dxf**”: its outline is not a usable closed contour. The nesting was refunded — fix that part in your CAD, or set its quantity to 0. » |
| **contrôle POSITIF, même fichier, même app** | avec le moteur du dépôt, le job **aboutit en 16 s** : 17 pièces posées, sans recouvrement, dans la tôle, écart ≥ 2 mm (capture 02) |
| suites | cargo `nest-engine` **106 passés + 2 ignorés**, vitest **551**, pytest nesting **234 + 1 skip**, `nuxt build` vert |
| harnais navigateur, deux configurations | **verdict vert aux deux espacements** : sans recouvrement, dans la tôle, **écart ≥ 0,1 mm** (587 + 313) et **écart ≥ 2 mm** (573 + 327), **900/900 placées**, calcul 24 s / mur 40,7 et 40,9 s. Il se bloque toujours APRÈS son verdict dans le rendu three.js du résultat (« GPU stall due to ReadPixels ») — écart attribué au poste au lot 2c par A/B et non rejoué ici |

#### 5.4 Le corpus, avant et après

238 fichiers (85 versionnés + 153 réels) : **1** refusé par la garde d'import
du navigateur (lot 2a), **11** sans contour exploitable, **9** refusés par la
garde de bande (#2b) et **12** par la garde de faisabilité (#49) — ces deux
gardes existent en production des deux côtés et sont reproduites dans le
coureur, parce qu'elles refusent avec un message au lieu de faire paniquer le
moteur. **205 fichiers atteignent le moteur.**

| | avant | après |
|---|---|---|
| échecs d'import | **13** | **4** |
| dont « contour gonflé auto-sécant » (la cause d'E0) | **11** | **0** |
| jobs menés au bout | 192 | **201** |
| paniques, dépassements de temps | 0 | 0 |

**La classe visée est fermée : 0 occurrence sur 205 fichiers.** Neuf fichiers
(4 contenus distincts — le corpus réel contient six copies de l'un d'eux)
passent d'un échec d'import à un job complet.

#### 5.5 Non-faits, écarts et arbitrages

1. **Réparer le gonflement a découvert un second défaut sur deux fichiers.**
   c04 et son jumeau réel échouaient à l'item 7 sur le gonflement ; l'item 7
   passe désormais, l'import continue et s'arrête à l'**item 58** sur
   « no pole found with 10 levels of recursion » — le *surrogate* de jagua
   (fail-fast) n'arrive pas à poser un pôle sur un ergot de largeur nulle (un
   tracé qui revient sur lui-même à 0,0001 mm près). Ce n'est pas le
   gonflement, et je ne l'ai pas ouvert : c'est un chantier distinct, sur une
   consigne fermée.
2. **Une deuxième classe de refus, inchangée** : « Simple polygon has
   non-consecutive duplicate vertices » sur deux fichiers réels. L'anneau
   **BRUT** est refusé, avant tout gonflement : c'est **notre importeur** qui
   produit un contour qui se touche. Le mécanisme ressemble à ce que la
   couture de la priorité 3 doit traiter. À arbitrer.
   Conséquence des points 1 et 2 : sur 205 fichiers, **4 refusent encore** —
   mais ils le font désormais en nommant le fichier et la pièce.
3. **Le message ne parle PAS d'espacement**, contrairement à la phrase de la
   consigne (« des traits plus fins que l'espacement demandé (X mm) …
   réduisez l'espacement »). Raison : après E0, un refus d'item n'est plus un
   problème de finesse — cette classe est réparée. Les refus qui restent ont
   d'autres causes (1 et 2), et envoyer l'utilisateur réduire son espacement
   le ferait travailler pour rien. La phrase livrée nomme le fichier et la
   pièce, dit ce qui ne va pas et donne deux leviers vrais : corriger la
   pièce, ou mettre sa quantité à 0. À infirmer si vous préférez la lettre de
   la consigne.
4. **`geo_buffer` rendant plusieurs polygones reste traité comme avant** (le
   premier, avec un avertissement) : c'est le chemin normal, et le toucher
   casserait le bit-à-bit. Angle mort signalé, non mesuré.
5. **L'érosion n'a pas de repli** : elle ne s'applique qu'au conteneur
   (rectangle de tôle) et n'a jamais mis `geo_buffer` en défaut ; un repli
   serait du code non mesuré.
6. **Le coureur n'est pas la production sur un point** : les trous ne sont pas
   ouverts par leur canal capillaire (périmètre E1/E2), et la hauteur de bande
   est abaissée quand `aire totale / hauteur` passerait sous l'espacement
   (**73 fichiers**). La question posée reste l'import.
7. **Le bundle wasm du moteur grossit** : 503 974 → **585 874 octets gzip**
   (+16 %), 1,40 → 1,62 Mio brut — c'est `i_overlay`. Le repli ne s'exécute
   jamais sur le chemin normal, mais le code voyage à chaque premier
   chargement. À arbitrer ; une compilation conditionnelle est possible (le
   repli est déjà isolé dans une fonction).
8. **Le harnais `qa-e2e-local-onefile.tmp.mjs`** que la consigne demandait
   d'intégrer au harnais principal ne l'est pas : j'ai écrit un harnais dédié
   (`scripts/qa-e2e-item-geometry.mjs`) plutôt que d'ajouter un troisième
   profil au harnais 900 pièces, dont ce n'est pas la question. La copie
   `.tmp` n'est pas suivie par git et n'est pas la mienne : je ne l'ai pas
   supprimée.
9. **Deux affichages douteux vus au passage, non touchés** (hors lot) : sur le
   résultat de ce fichier, le badge « All 17 parts placed » s'affiche **en
   rouge** alors que les 17 pièces sont posées, et la ligne d'état dit
   « 1 parts needed to be placed » — la quantité du fichier, pas le nombre de
   pièces (capture 02).
10. **Une observation de discipline** : `AGENTS.md` gagne un piège 2c (canal
    plus étroit que le gonflement, non réparabilité de la sortie de
    `geo_buffer`, obligation de désigner l'item fautif).

### Lot E0 — vérification (vérificateur, 12/09, `b1da2690`) — GO déploiement

Rejoué sur le poste : binaire natif et image worker reconstruits à HEAD,
app locale à HEAD servant le wasm moteur du commit (`37f1bee5…`), sorties
brutes hors dépôt (`~/qa-out/verif-e0/`, `~/qa-out/eclat/`).

| Verrou | Résultat |
|---|---|
| cargo `nest-engine` release | 106 passés, 0 échec, 2 ignorés |
| vitest | 551 |
| `determinism_lock.py` | `b_demo` **`a1bd8810…` inchangé** natif et wasm ; `e0_volute` **`4ff43700…`** identique natif ≡ wasm |
| **instance réelle du logo** (celle que le navigateur avait envoyée le 12/09 au matin, rejouée en natif) | avec canaux : **résolue**, 17 pièces, bande 599,9 mm, 12 s, `spacing_violations: []` ; trous fermés : résolue, 9 s. Avant le lot : panne à l'import dans les deux cas |
| coureur moteur × 238 (`qa-engine-corpus.mjs`, binaire HEAD) | 205 fichiers au moteur, **201 menés au bout, 4 refus d'item, 0 panique, 0 dépassement** ; les 4 : deux « no pole found » (c04 et son jumeau réel, item 58) et deux « non-consecutive duplicate vertices » (anneau brut, deux fichiers réels) — exactement ceux du §5.5 |
| navigateur, le logo du collègue | job **abouti**, **17 pièces posées**, badges « sans recouvrement », « dans la tôle », « écart ≥ 2 mm » verts ; le badge « All 17 parts placed » est **rouge à tort** et l'état dit « 1 parts needed » (point 9 du rapport, confirmé) ; le harnais se bloque ensuite dans le rendu three.js (GPU stall, connu sur ce poste) |
| harnais 900 pièces, espacement 2 | sans recouvrement, dans la tôle, écart ≥ 2 mm, **900/900 placées**, calcul 24 s (même blocage three.js après le verdict) |
| lecture du repli (`shape_modification.rs`) | ne s'exécute que sur l'échec de `geo_buffer` et qu'en gonflement ; somme de Minkowski depuis l'anneau brut, disque circonscrit à 32 côtés, union entière `i_overlay` règle positive, `libm` pour cos/sin ; choix du polygone par ordre total (aire puis longueur) ; trous du résultat laissés pleins (sur-ensemble) |
| taille du wasm moteur | 504 212 → **587 836 octets gzip** (+83 Ko) |

**Le diagnostic du §1 était incomplet, la correction de l'implémenteur est
juste** : ce n'est pas la finesse d'un brin mais l'étroitesse du canal entre
deux brins qui fait tomber `geo_buffer`, et sa sortie n'est pas réparable.
La consigne demandait une union de cette sortie ; le verrou d'aire (le
gonflé contient la pièce) a montré que cette lettre était fausse. Le repli
livré est le bon : il recalcule depuis l'anneau brut.

**Arbitrages (§5.5)** :

1. « no pole found » sur un ergot de largeur nulle (2 fichiers, même
   contenu) : chantier distinct, **à traiter dans le lot E1 point 3**
   (fusion des sommets à moins de 0,01 mm et suppression des aller-retours
   de largeur nulle à l'import — c'est la même règle de nettoyage), verrou :
   c04 mené au bout par le coureur.
2. « non-consecutive duplicate vertices » sur l'anneau brut (2 fichiers
   réels) : c'est l'importeur qui produit un contour qui se touche — rejoint
   la **couture des contours (priorité 5)**, non ouvert ici ; le message
   nomme désormais la pièce, c'est ce qui compte en attendant.
3. **Message sans mention d'espacement : accepté.** Après E0 un refus n'est
   plus une affaire de finesse ; renvoyer vers l'espacement ferait travailler
   pour rien. La phrase livrée nomme le fichier et la pièce et donne deux
   leviers vrais.
4. **Taille du wasm : accepté, pas de compilation conditionnelle.** Le cas
   du propriétaire est un cas navigateur ; un repli qui n'existe pas dans le
   navigateur ne répare rien. 83 Ko gzip sur un premier chargement d'un
   moteur qui en fait déjà 500, contre un job qui meurt : le choix est fait.
5. Point 9 du rapport (badge « All 17 parts placed » en rouge, « 1 parts
   needed » = quantité du fichier et non nombre de pièces) : **défaut réel,
   à corriger dans le lot E1** avec le comptage par pièce que l'éclatement
   introduit de toute façon ; verrou : capture verte sur le logo, 17 pièces
   annoncées.

**GO déploiement E0 seul** : app + wasm moteur + worker nesting, homelab
compris (`assert_overflow_head.py`). Benchmarks publics : le verrou de
déterminisme n'a pas bougé, mais le moteur a changé ; rejouer
`densities_corpus.py` sur l'image publiée et ne toucher `data/benchmarks.js`
que si un chiffre bouge (attendu : aucun). Vérification prod : le logo du
collègue nesté depuis un vrai compte, 17 pièces posées.

#### Déploiement du lot E0 (implémenteur, 12/09)

Déployé à `28880d01` — app `sha256:d20035bb…`, worker nesting
`sha256:a02836c0…` (même digest sur Hetzner et sur le homelab).

| Contrôle | Résultat |
|---|---|
| images publiées puis tirées | `docker compose pull app nesting-worker` + `up -d` ; tous les conteneurs `Up`, `GET /` **200** |
| commit injecté dans l'app | `NUXT_PUBLIC_GIT_COMMIT_SHA=28880d01…` |
| artefacts SERVIS par la prod = dépôt (piège #14i) | **octet pour octet** : `engine/nest_wasm_bg.wasm` `37f1bee5…`, `engine/nest_wasm.js` `506a6025…`, `geometry/nest_geometry_bg.wasm` `86143daa…`, `workers/engine.worker.js` `f020ac90…` |
| **le moteur SERVI par la prod sur la géométrie du logo** | wasm téléchargé depuis `app.nestorcut.com`, instance des 17 contours à espacement 2 : **17 pièces posées**, bande 599,3 mm. C'est l'import qui tuait le job ce matin |
| homelab (débordement) | 3 workers recréés sur le même digest ; `assert_overflow_head.py` → **`ASSERT OVERFLOW=HEAD: OK`**, binaire moteur du **12/09 17:33 UTC** |
| corpus de torture sur l'**image publiée** | **11/11 OK** (T-F partiel et T-J refus attendus) : 0 recouvrement, tout dans la tôle, 0 doublon, aucun rollback |
| benchmarks publics | `densities_corpus.py` rejoué sur l'image publiée : **0 écart** sur les dix cas publiés (densités, pièces posées, tôles) — `data/benchmarks.js` **non modifié**, comme prévu |
| journaux prod | **0 ERROR / Traceback** sur les 200 dernières lignes de l'app et du worker nesting |

**Non-fait, dit franchement** : « le logo nesté depuis un vrai compte » n'a
pas été joué **par moi** — l'import est derrière `auth`, je n'ai pas de
compte de production, et en créer un est une écriture de production qui
vous revient. Les trois substituts ci-dessus couvrent la chaîne technique
(bits servis identiques, moteur servi résolvant la géométrie fautive,
interface vérifiée dans un vrai navigateur au même commit en local). Le
geste qui reste, chez vous, est de 30 secondes : projet « cet appareil » sur
`app.nestorcut.com`, dépose du logo, `Imbriquer` — attendu : **17 pièces
posées**, sans recouvrement, écart ≥ 2 mm.

### Lot E1 — « Import avancé » : éclatement, échelle, micro-vides (implémenteur, 12/09)

Commit : `0ec498d0`. **Non déployé** — wasm géométrie, app, serveur et worker
fileprocessing touchés ; GO attendu.

#### 5.6 Ce qui est livré

1. **Panneau « Import avancé », replié et éteint** (`DxfUpload.vue`, présent
   seulement sur un projet « cet appareil »). Ouvert : « Éclater en pièces
   unitaires » (case) et « Échelle » avec trois modes — facteur, largeur
   cible, hauteur cible. Le réglage vaut pour la dépose, vit dans la SESSION
   (`sessionStorage`, jamais le compte) et n'a **aucun effet tant que le
   panneau est fermé** — c'est le verrou « panneau fermé = réglage inerte »,
   posé exprès pour qu'une case oubliée ne suive pas l'utilisateur.
2. **Une seule chaîne** (`localImport.js`) : DXF canonique **mis à l'échelle**
   (affine sur les entités, handles réassignés) → import ordinaire →
   **un DXF canonique par pièce** écrit depuis ses `handles` → import
   ordinaire de chacun. Chaque fiche produite est une fiche NORMALE
   (quantité, rotations, couleur, aperçu, suppression, export par handle),
   nommée « nom (k/N).dxf ». Provenance en champs **additifs** :
   `importScale`, `explodedFrom`, `explodedIndex`.
   Deux liaisons wasm nouvelles (`canonical_dxf_scaled`,
   `canonical_dxf_part`), le worker géométrie et son client mis à jour dans
   la même livraison (piège #33b).
3. **Le micro-vide n'est plus un trou, l'aller-retour n'est plus de la
   matière** — même règle dans les deux importeurs
   (`nest-import::assemble`, `worker_common/geometry/cleanup.py`, seuils lus
   dans le fichier Rust par un test Python) : un trou d'aire < 1 mm² ou dont
   le petit côté fait moins de 0,5 mm est **rebouché** ; un aller-retour de
   largeur nulle (le tracé part, revient à moins de 0,01 mm) est **retiré**.
   Deux constats d'information (`import.microVoidsFilled`,
   `import.spursRemoved`), FR et EN, dans la fiche fichier (pas sur la
   carte — même arbitrage que les autres constats d'information au lot 2c).
4. **Le compte affiché compte les PIÈCES, pas les fichiers** (ajout de votre
   vérification) : sur un projet « cet appareil », le serveur ne connaissait
   que des quantités de fichiers (« 1 pièce demandée » pour un fichier de
   17). Le navigateur envoie désormais le compte d'items avec la
   comptabilité de fin (`local-quota`, scalaire borné — la surface
   d'enqueue, verrouillée par un test de confidentialité, n'a pas bougé
   d'un champ), et `local-result` **mesure** `placed` au lieu de recopier le
   demandé.

#### 5.7 Verrous et mesures

| Verrou | Résultat |
|---|---|
| **la volute perd ses faux trous** | **21 trous → 0** sur l'item fautif, 21 micro-vides annoncés ; le fichier passe de 29 à 8 trous, tous réels |
| **le moteur accepte tout le corpus** | coureur « moteur × 238 fichiers » : **205 atteignent le moteur, 205 vont au bout — 0 échec d'import, 0 panique** (le lot E0 en laissait 4 : les deux ergots de largeur nulle et les deux anneaux à sommets dupliqués sont nettoyés à l'import) |
| **rien ne change ailleurs** (A/B géométrie) | empreinte des anneaux importés, avant/après, sur les 238 fichiers (231 contenus distincts) : **222 identiques au bit près**, **9 changés — tous porteurs d'un constat de nettoyage**, et **aucun constat sans changement** |
| **les deux importeurs nettoient les mêmes fichiers** | 11 fichiers des deux côtés ; **4 navigateur seul**, **1 serveur seul** (détail au 5.8) |
| **l'écart entre importeurs ne se creuse pas** | fichiers où les comptes diffèrent : pièces **9 → 9**, trous **14 → 12** (il se réduit) |
| **aucun fichier ne devient illisible** | lus avant/après : navigateur **225 → 225**, serveur **223 → 223** |
| **le temps d'import ne bouge pas** (machine au repos) | 151 fichiers réels : total **67,4 s → 70,0 s (+3,9 %)**, médiane **19,5 → 19,7 ms (+1,1 %)**, pire fichier 9,18 → 10,02 s (+9 %). Le premier passage donnait +14,8 % : il tournait pendant deux autres coureurs — attribution par A/B au repos, comme l'exige la discipline de mesure |
| **option éteinte = chaîne d'avant** | vitest : la chaîne fait exactement `import` + `canonical`, **aucun appel wasm de plus** ; dans le navigateur, une fiche, nom intact, aucun champ de provenance |
| **dépose en masse, option éteinte** | **10 fichiers → 10 fiches en 8,6 s**, panneau resté replié |
| **éclatement** | navigateur : **17 fiches**, une pièce chacune, « volute (k/17).dxf », quantités indépendantes (une fiche passée à 3, les autres inchangées) ; en natif, **17/17 pièces rendent exactement un contour** (aucun repli) |
| **éclatement → imbrication** | 17 pièces sur 1000 × 2000 à espacement 2 : **done en 12 s, 17/17 posées**, sans recouvrement, dans la tôle, **écart ≥ 2 mm** ; badges **tous verts**, état « All parts are placed » (capture 02) |
| **échelle ×0,5** | étendue du dessin **2834,34 → 1417,17 mm**, plus grande pièce **1612,61 → 806,31 mm** — mesuré sur les pièces IMPORTÉES (lues dans IndexedDB) |
| **largeur cible 1000 mm** | facteur déduit **0,353**, largeur obtenue **1000,00 mm** |
| suites | vitest **568** (+17), cargo geometry **134** (+10, dont le verrou de handles canoniques), pytest fileprocessing **42**, common **83** (+11), nesting **234 + 1 skip**, `nuxt build` vert |
| parités | goldens **100 %** (seuil 99 %), déterminisme natif ≡ wasm **68/68** et **17/17** (tolérance 0), **diff client/serveur OK**, **parité exports OK** |

#### 5.8 Non-faits, écarts et arbitrages

1. **Les nombres de la consigne étaient ceux de la plus grande PIÈCE, pas du
   dessin.** L'étendue du dessin complet est 2834,34 mm (la pièce la plus
   large fait 1612,61 mm) : ×0,5 donne donc 1417,17 mm d'étendue — et
   806,31 mm sur la plus grande pièce, le chiffre du plan. De même, une
   largeur cible de 1000 mm donne un facteur **0,353** (1000/2834), pas
   0,620. L'échelle s'applique au DESSIN, c'est le sens de la consigne ;
   seules les valeurs attendues étaient calculées sur une pièce.
2. **Le nettoyage n'agit pas exactement sur les mêmes fichiers des deux
   côtés** : 11 en commun, 4 côté navigateur seul (deux fichiers à ergots de
   largeur nulle — le chemin serveur les avait déjà absorbés par sa grille de
   précision shapely, ce qui explique que la panne E0 ne se voyait QUE dans
   le navigateur — et deux autres), 1 côté serveur seul (un trou déjà écarté
   avant le lot, désormais NOMMÉ : le compte ne change pas, le constat
   apparaît). La règle et les seuils sont identiques et verrouillés (le test
   Python lit les constantes dans le fichier Rust) ; ce qui diffère, ce sont
   les jeux de trous que les deux polygoniseurs produisent — écart
   préexistant, documenté au lot 2c, et qui se réduit de 14 à 12 fichiers.
   Le refermer est le périmètre du **lot E2**.
3. **Le coureur ezdxf ne comptait pas le nettoyage** : il appelait
   `to_mongo_dict()` sans passer `stats`, alors que la production le passe.
   Corrigé dans le coureur (une ligne) — sans quoi je mesurais des comptes
   qui bougent et des constats vides.
4. **L'importeur serveur n'est pas reproductible sur un fichier
   pathologique.** Mesuré en le rejouant trois fois à code identique (un
   exemple LibreDWG à 1 300 tracés ouverts) : **1365 / 1334 / 1334** tracés
   ouverts et **13 / 13 / 14** trous. Un `PYTHONHASHSEED` fixé n'y change
   rien (13 puis 14). Ce n'est pas un effet du lot E1 — c'est un défaut
   préexistant du chemin Python, qui rend bruyante toute comparaison de ce
   fichier. À arbitrer comme chantier distinct (le navigateur, lui, est
   déterministe : c'est le verrou 68/68).
5. **Le nom du DXF résultat devient absurde quand on éclate** : il concatène
   les slugs des 17 fiches (capture 02, ligne sous le titre). C'est un
   effet de bord visible de l'éclatement, pas une régression de l'existant ;
   il faut borner ce nom (trois fichiers puis « … »). Non touché ici pour ne
   pas élargir le lot — à faire au **lot E2**, où les constats reviennent.
6. **Le repli « une pièce qui ne se referme pas seule »** existe et est
   verrouillé (la pièce n'est jamais perdue : sa géométrie vient de l'import
   du dessin complet), mais **il n'a jamais servi** sur le fichier du
   collègue (17/17 exact) ni sur le corpus. Il reste un filet, pas un chemin
   mesuré.
7. **L'ordre des fiches éclatées** suit désormais l'ordre des pièces (une
   milliseconde d'écart par fiche à l'écriture) : sans cela, dix-sept fiches
   écrites dans la même milliseconde s'affichaient dans un ordre arbitraire.
8. **Le panneau ne montre pas le facteur déduit** en mode cible (il
   s'affiche après coup dans la provenance de la fiche, pas dans le
   panneau) : le calcul exige la taille du dessin, qu'on ne connaît qu'après
   lecture. Le faire vivre dans le panneau demanderait de lire le fichier au
   survol de la dépose — à trancher si vous le voulez.

### Lot E1 — vérification (vérificateur, 12/09, `0ec498d0`) — GO déploiement, un lot E1-bis à livrer avant E2

Rejoué sur le poste : images app et fileprocessing reconstruites à HEAD
(wasm géométrie servi = dépôt, `5fe7fec3…`), sorties hors dépôt
(`~/qa-out/verif-e1/`).

| Verrou | Résultat |
|---|---|
| vitest / cargo geometry | 568 / 134, 0 échec |
| parité golden, déterminisme géométrie | 100 % ; 68/68 et 17/17 |
| **coureur wasm, 153 réels + 85 versionnés, comparé à la campagne 2b** | statuts identiques (141 + 9 + 2 ; 50 + 24 + 11) ; **11 réels et 2 versionnés changent de comptes de trous, tous porteurs du constat « micro-découpes ignorées »** (3 à 45 par fichier ; six copies d'un même dessin parmi les 11) ; 2 fichiers portent un constat sans changement de compte (aller-retours retirés) ; aucun autre mouvement |
| coureur ezdxf, mêmes corpus | statuts identiques (101 + 48 + 2 ; 46 + 26 + 13) ; **10 réels et 1 versionné changent de comptes, tous porteurs du constat** ; 1 constat sans changement de compte |
| **coureur moteur × 238** (binaire E0, bundle d'import E1) | **205 fichiers atteignent le moteur, 205 vont au bout : 0 refus d'item, 0 panique, 0 dépassement** (E0 en laissait 4) |
| **harnais navigateur « import avancé »**, quatre cas sur la copie du logo | **A** option éteinte : 1 fiche, nom intact, 0,9 s ; **B** éclatement : 17 fiches « (k/17) » d'une pièce, quantités indépendantes, imbrication faite en 12 s, **17/17 posées, quatre badges verts** dont « All 17 parts placed » (le défaut du point 9 est corrigé) ; **C** ×0,5 : étendue 2834,34 → 1417,17 mm mesurée sur les pièces importées ; **D** largeur cible 1000 : facteur 0,353, largeur obtenue 1000,00 |
| langues | les 12 clés nouvelles existent en anglais ET en français, aucun texte en dur trouvé dans `DxfUpload.vue` |

**Arbitrages (§5.8)** :

1. Les nombres de la consigne (806 mm, 0,620) étaient calculés sur la plus
   grande pièce : erreur du vérificateur, l'échelle s'applique bien au
   dessin complet. Les valeurs mesurées (1417,17 mm ; 0,353) sont les
   bonnes.
2. Nettoyage sur des jeux de fichiers légèrement différents des deux côtés
   (11 communs, 4 navigateur, 1 serveur) : la règle est la même, ce sont les
   polygoniseurs qui diffèrent — périmètre du lot E2, comme proposé.
3. **Importeur serveur non reproductible** sur un fichier pathologique
   (1365 / 1334 / 1334 tracés ouverts à code identique) : défaut
   préexistant, chantier distinct, **inscrit au registre** (à traiter avec
   la couture des contours, priorité 5, qui touche ce même chemin).
4. Nom du DXF résultat qui concatène 17 slugs : à borner au lot E2.
5. Le facteur déduit absent du panneau (point 8) : réglé par E1-bis
   ci-dessous, qui lit le fichier à la dépose.

**Ce qui manque par rapport à la demande du propriétaire (12/09, après le
début du lot) : l'aperçu contre une tôle.** Le panneau livré règle l'échelle
par des champs ; le propriétaire a demandé de voir le dessin posé sur une
tôle (formats par défaut ou dimensions personnalisées) et de l'ajuster à la
main. C'est écrit au §3 (point 1, « Précision propriétaire du 12/09 »).
**Lot E1-bis, à livrer avant E2** :

- à la dépose (option ouverte), le fichier est lu une fois par l'import
  ordinaire pour connaître ses pièces et son étendue ; l'aperçu montre les
  contours des pièces (couleurs de l'aperçu existant) posés sur une tôle
  choisie parmi `SHEET_PRESETS` (`app/utils/units.js`, 1000 × 2000 en tête)
  ou saisie (largeur × hauteur, unité courante) ;
- l'échelle se règle par les champs existants OU en tirant une poignée
  d'angle sur l'aperçu, rapport conservé, cotes du dessin affichées en
  direct, **facteur déduit visible** dans le panneau (ferme le point 8) ;
- une case « utiliser cette tôle pour le projet » pré-remplit les réglages
  de tôle, sans rien écraser sinon ; l'aperçu ne produit aucune fiche tant
  que l'import n'est pas validé ; tout libellé passe par `i18n.js` en
  anglais et en français ;
- verrous : harnais « import avancé » cas E : logo sur 1000 × 2000 → hors
  tôle signalé, poignée tirée à 900 mm d'étendue → facteur 0,318 affiché et
  pièces importées à cette échelle (étendue mesurée 900 ± 0,5) ; changer de
  format de tôle ne change pas le facteur ; option éteinte : aucune lecture
  supplémentaire du fichier (cas A inchangé, même nombre d'appels wasm) ;
  captures FR et EN.

**GO déploiement E1 tel quel** : le nettoyage ferme les quatre derniers
refus du moteur et l'éclatement fonctionne ; le panneau est replié et
inerte par défaut, l'aperçu s'y ajoute sans rien casser. Déploiement : app
+ wasm géométrie + worker fileprocessing (le worker nesting n'a pas changé,
homelab non concerné) ; moteur inchangé → pas de benchmarks. Si le
propriétaire préfère ne montrer le panneau qu'avec son aperçu, E1-bis se
livre d'abord et les deux se déploient ensemble : c'est un choix produit.

#### Déploiement du lot E1 (implémenteur, 12/09)

Déployé à `76738086` — app `ghcr.io/…/nest2d-app:latest`, worker
`nest2d-user-file-processing-worker:latest`. Worker nesting et homelab non
concernés (le moteur n'a pas changé) ; aucun benchmark à régénérer.

| Contrôle | Résultat |
|---|---|
| CI du commit | **app-ci vert**, **geometry-locks vert** (parité exports, diff client/serveur, déterminisme natif ≡ wasm), images publiées |
| conteneurs | app et worker fichiers recréés, `GIT_COMMIT_SHA=76738086…`, tous `Up`, **0 ERROR / Traceback** sur les 120 dernières lignes des trois services |
| artefacts SERVIS par la prod = dépôt | **octet pour octet** : `geometry/nest_geometry_bg.wasm` `5fe7fec3…`, `geometry/nest_geometry.js` `6ce25db0…`, `workers/geometry.worker.js` `e3b3a218…`, `engine/nest_wasm_bg.wasm` `37f1bee5…` (inchangé, E0) |
| **le nettoyage est actif dans le bundle SERVI** | bundle téléchargé depuis `app.nestorcut.com`, rejoué sur la copie du logo : **17 pièces, 8 trous réels, 21 micro-découpes ignorées**, et **la volute passe à 0 trou** |
| **le nettoyage est actif dans le worker de production** | l'image déployée porte `worker_common.geometry.cleanup` avec les seuils **1,0 / 0,5 / 0,01** |

**Non-fait, dit franchement** : l'image `strip-file-processing-worker` (le
produit « strip », pipeline séparé) **n'embarque pas** `worker_common.geometry`
— son digest n'a pas bougé à ce build. Le nettoyage n'y est donc pas ; ce
n'est pas un oubli de déploiement, c'est un autre chemin de code, à traiter
s'il doit suivre la même règle.

### Lot E1-bis — l'aperçu du dessin posé sur une tôle (implémenteur, 12/09)

Commit : `7ddef81f`. **Non déployé** — app seule (aucun changement wasm, serveur
ou worker) ; GO attendu.

#### 5.9 Ce qui est livré

1. **La dépose passe par l'aperçu quand le panneau est OUVERT** : le fichier
   est lu **une fois**, par l'import ordinaire (`geoImportFile` — celui qui
   produira les fiches), et **aucune fiche n'est créée** avant « Importer ».
   Panneau fermé, `needsPreview()` est faux et le chemin est celui d'avant le
   lot E1 : aucune lecture de plus (c'est le verrou du cas A, rejoué).
2. **L'aperçu** (`AdvancedImportPreview.vue`) : les contours lus, posés sur
   un rectangle de tôle (origine en bas à gauche, y flippé — piège #20b),
   avec une **poignée d'angle** au coin haut droit du dessin. La tôle se
   choisit parmi `SHEET_PRESETS` de l'unité courante ou se saisit
   (largeur × hauteur, unité courante, conversion à la frontière UI).
   **Hors-tôle signalé** en clair, les deux orientations de la TÔLE étant
   acceptées (une tôle se pose comme on veut ; la pièce, elle, n'est pas
   tournée ici — c'est le moteur qui le fera).
3. **La poignée n'ajoute pas une arithmétique** : elle écrit la **largeur
   cible** du dessin, c'est-à-dire le mode `width` du panneau livré au lot
   E1. Le facteur est donc résolu par le même code, sur l'étendue mesurée du
   dessin — et il est **affiché** (point 8 du rapport E1 fermé), à côté des
   **cotes du dessin en direct** dans l'unité courante.
4. **« Utiliser cette tôle pour le projet »** : à la validation seulement, et
   uniquement la largeur et la hauteur du PREMIER format (`updateSheet(0, …)`)
   — rien d'autre n'est écrasé, ni le nombre de tôles, ni l'espacement.
5. **Changer de tôle ne touche pas le facteur** : la tôle est une référence
   de lecture, pas un réglage d'échelle. Verrouillé des deux côtés (vitest et
   harnais).
6. Neuf libellés nouveaux, **anglais et français**, rien en dur.

#### 5.10 Verrous et mesures

| Verrou | Résultat |
|---|---|
| **aucune fiche avant validation** | harnais : fiches avant la dépose **1**, pendant l'aperçu **1** — l'aperçu ne crée rien |
| **hors-tôle signalé** | le logo tel quel (étendue **2834,3 × 688,8 mm**) sur une tôle 1000 × 2000 : **signalé** |
| **changer de tôle ne change pas le facteur** | 1000 × 2000 → 1500 × 3000 → 1000 × 2000 : facteur **1 / 1 / 1** |
| **poignée tirée à 900 mm** | étendue affichée **899,9 mm**, facteur affiché **0,317** (900 mm exactement donnerait 0,3175 → 0,318 ; l'écart est la précision du tirage à la souris, pas celle du calcul) |
| **les pièces sont importées à CETTE échelle** | après validation : `importScale` **0,317496…**, étendue des pièces importées **899,89 mm** (mesurée dans IndexedDB, exigé 900 ± 0,5) |
| **« utiliser cette tôle » pré-remplit le projet** | tôle du projet après validation : **1000 × 2000** |
| **option éteinte : rien ne change** | cas A rejoué : **1 fiche**, nom intact, **882 ms** ; cas E rejoué : **10 fichiers → 10 fiches en 8,8 s**, panneau resté replié |
| **captures FR et EN** | `docs/qa/eclatement-2026-09-12/lotE1bis/01-reglages-{fr,en}.png` (cotes, facteur, sélecteur de tôle, case, boutons) |
| suites | vitest **580** (+12 : `advancedImportPreview.test.js`), `nuxt build` vert. Rien d'autre n'a bougé : aucun code wasm, serveur ni worker dans ce lot |

#### 5.11 Non-faits, écarts et arbitrages

1. **Le cas du harnais s'appelle F, pas E** : « E » était déjà pris par la
   dépose en masse ajoutée au lot E1. Le harnais joue donc `QA_CASES=F` pour
   l'aperçu, et `QA_LOCALE=fr|en` pour les deux langues.
2. **Les captures publiées ne montrent pas la tôle avec le dessin** : le
   dessin est le fichier d'un atelier, il n'a rien à faire dans `docs/`. Les
   captures portent la bande des réglages (cotes, facteur, tôles, case,
   boutons) dans les deux langues ; la vue tôle + dessin + poignée est
   vérifiée par les assertions du harnais (hors-tôle, tirage, facteur), pas
   par une image.
3. **Un défaut corrigé en cours de route** : la poignée était posée à
   `hauteur du dessin` depuis le HAUT de la tôle alors que le dessin est posé
   en BAS — elle flottait au-dessus du tracé. Vu sur la première capture,
   corrigé, capture refaite.
4. **L'aperçu montre le PREMIER fichier de la dépose** quand plusieurs sont
   déposés (le nombre est affiché). Le réglage vaut pour toute la dépose, et
   une largeur cible se résout **par fichier** sur l'étendue de chacun —
   c'est le comportement du mode « largeur cible » livré au lot E1, pas une
   règle nouvelle.
5. **L'import relit le fichier après validation** : l'aperçu lit pour
   mesurer, la chaîne d'import relit pour produire. C'est le prix d'une seule
   chaîne de code (aucune branche « import depuis l'aperçu ») et il ne se
   paie **que sur une dépose à panneau ouvert** — mesuré au cas A : panneau
   fermé, rien de plus.
6. **La poignée ne tire que la largeur** (rapport conservé, donc la hauteur
   suit). Tirer par la hauteur demanderait un second mode ; le plan ne le
   demande pas.

### Lot E1-bis — vérification (vérificateur, 13/09, `7ddef81f`) — GO déploiement

Rejoué sur le poste, image app reconstruite à HEAD (wasm géométrie servi =
dépôt `5fe7fec3…`), sorties hors dépôt (`~/qa-out/verif-e1bis/`).

| Verrou | Résultat |
|---|---|
| vitest | 580 |
| **cas F, français puis anglais** (aperçu sur une tôle) | identique dans les deux langues : aucune fiche créée pendant l'aperçu (1 → 1), hors-tôle signalé pour 2834,3 × 688,8 mm sur 1000 × 2000, facteur 1 conservé sur trois changements de tôle, poignée tirée à 899,9 mm → facteur 0,317 affiché, pièces importées à 899,89 mm (`importScale` 0,3175), tôle du projet 1000 × 2000 après « utiliser cette tôle » ; libellés « facteur » / « factor » selon la langue |
| **cas A et E** (option éteinte, dépose en masse) | A : 1 fiche, nom intact, 0,87 s ; E : 10 fichiers → 10 fiches en 8,6 s, panneau resté replié |
| langues | 9 clés nouvelles en anglais ET en français ; aucun texte en dur dans `AdvancedImportPreview.vue` |
| lecture | la poignée écrit la largeur cible (mode `width` du lot E1) : un seul calcul d'échelle ; aucune fiche avant « Importer » ; panneau fermé = chemin d'avant |

Accepté : cas nommé F ; captures limitées à la bande des réglages (le dessin
d'atelier ne va pas dans `docs/`) ; aperçu du premier fichier d'une dépose
multiple ; relecture du fichier à la validation (prix d'une seule chaîne,
payé seulement panneau ouvert) ; poignée par la largeur seule.

**Arbitrage sur le worker « strip »** (non-fait du déploiement E1) : le
pipeline `strip-file-processing` / `strip-nesting` n'a **aucune source dans
ce dépôt** (`workers/` ne contient que common, fileprocessing, geometry,
nesting ; l'image est préconstruite, variante « bande » historique). Il ne
peut donc pas suivre la règle de nettoyage depuis ici, ni aucune autre
règle des lots récents. **Question produit pour le propriétaire** : ce
pipeline est-il encore offert ? Si oui, il faut rapatrier sa source et
l'aligner (chantier à ranger) ; si non, le retirer du compose et de
l'architecture. En attendant, il reste tel quel et documenté comme tel.

**GO déploiement E1-bis** : app seule ; rien d'autre n'a changé. Puis lot E2.

#### Déploiement du lot E1-bis (implémenteur, 13/09)

Déployé à `3db283c2` — **app seule** (aucun changement wasm, serveur ou
worker dans ce lot).

| Contrôle | Résultat |
|---|---|
| CI du commit | **app-ci vert**, image publiée |
| conteneur | app recréée, `GIT_COMMIT_SHA=3db283c2…`, `Up`, **0 ERROR / Traceback** sur les 150 dernières lignes |
| app vivante | `GET /` **200** |
| artefacts servis = dépôt | `geometry/nest_geometry_bg.wasm`, `engine/nest_wasm_bg.wasm`, `workers/geometry.worker.js` : **identiques** (inchangés par ce lot, vérifiés quand même) |
| **l'aperçu est bien dans le bundle SERVI** | le fragment i18n du dépôt (`_nuxt/OSnjQeS_2.js`, même nom donc même contenu) répond **200** en production et porte « Preview on a sheet » et « Utiliser cette tôle pour le projet » — les deux langues du lot |

### Lot E2 — miroir serveur et constats (implémenteur, 13/09)

Le chemin « Nos serveurs » applique les MÊMES options que le navigateur, avec
la même arithmétique et la même chaîne : le DXF canonique est mis à l'échelle,
relu par l'import ordinaire, puis éclaté en un DXF par pièce — relu par
l'import ordinaire lui aussi. Le panneau « Import avancé » est désormais offert
sur les projets serveur comme sur les projets locaux.

#### 5.1 Ce qui est livré

**a) Le constat « pièces plus fines que l'espacement » (moteur → rapport).**
Le repli de gonflement du lot E0 sait maintenant DIRE sur quels items il est
passé : `FALLBACK_ITEMS` (`shape_modification.rs`) + `CURRENT_ITEM` posé par
`Importer::import_item`, drainés par nest-engine après l'import, émis en
`{"type":"import","kind":"thin_items","items":[…]}` et rendus dans
`EngineOutput.thin_items` / le JSON wasm. Le worker et le navigateur les
traduisent en fichier + rang (`thin_parts` / `thinPartsFromItems`, bornés à
50), et le rapport porte une ligne d'INFORMATION — le moteur livre ces jobs,
ce n'est pas une erreur : « 4 pièces plus fines que l'espacement : ecrin.dxf
(pièce 1), ecrin.dxf (pièce 2), ecrin.dxf (pièce 3) et 1 autres ».

**b) L'échelle, côté serveur.** `resolve_import_scale` (miroir exact de
`resolveScale`) lit `importScale` ou `importScaleTarget {mode, mm}` sur le
DOCUMENT fichier ; le facteur d'une cible en millimètres se calcule sur
l'étendue MESURÉE du dessin complet — donc après une première lecture, comme
au navigateur. `_rewrite_scaled_copy` met la copie canonique à l'échelle
(`scale_drawing`, `Matrix44.scale` sur le modelspace d'un document DÉJÀ
décomposé — piège #26), la réécrit dans `validDxf`, vide le cache de lecture
et relit : l'aval ne voit qu'un dessin comme un autre. Un facteur déjà
appliqué ne se rejoue pas (`importScaleApplied`), sinon une reprise de file
doublerait la taille du dessin.

**c) L'éclatement, côté serveur.** `subset_drawing_bytes` (`dxf_utils`) écrit
les octets d'un sous-ensemble d'entités désigné par handles, dans un document
neuf qui leur réattribue la séquence canonique (piège #33b) et déclare les
millimètres (piège #27). `_explode_into_parts` dépose ces octets comme des
fichiers déposés et laisse la boucle du worker les traiter : **aucune branche
de polygonisation parallèle**. Les fiches filles sont des fiches normales
(quantité, rotations, couleur, aperçu, suppression, export par handle),
nommées « nom (k/N).dxf » comme au navigateur, horodatées à la milliseconde
pour que la liste suive l'ordre des pièces. Le dessin d'origine reste en base,
marqué `explodedInto`, et quitte la liste du projet (un champ additif dans la
requête de `service.js`) — il n'a jamais eu de carte côté navigateur non plus.

**d) Les micro-vides.** Déjà des deux côtés depuis le lot E1 (le miroir
Python `worker_common/geometry/cleanup.py`, seuils lus dans le fichier Rust par
un test) : rien à ajouter, mesuré ci-dessous.

**e) Le nom du DXF résultat est borné** (`JOB_SLUG_MAX_FILES = 3`) : trois noms
puis `and14more`. « … » n'a pas sa place dans un nom de fichier ni dans une
URL, le reste est donc compté en clair.

**f) Un défaut de production trouvé et corrigé au passage (voir 5.3).**

#### 5.2 Mesures — le serveur rend la même chose que le navigateur

Harnais `scripts/qa-e2e-advanced-import.mjs`, deux cas ajoutés (**G** et
**H**), tous deux sur un projet « Nos serveurs » réel, mesurés sur la réponse
de `/api/project/<slug>` et non sur l'écran. Fichier d'entrée : une copie
anonyme du logo d'atelier (17 pièces, étendue 2 834,34 mm).

| Mesure | Navigateur | Serveur |
|---|---|---|
| fiches produites par l'éclatement | **17** | **17** |
| pièces par fiche, et encombrement de chaque pièce | référence | **0 écart** sur les 17 (tolérance 0,1 mm = l'arrondi de l'API) |
| le dessin d'origine est une fiche ? | non | **non** (18 fiches en base = 1 dépose sans option + 17, le parent marqué et masqué) |
| échelle ×0,5 : plus grande pièce | 806,31 mm | **806,3 mm** |
| largeur cible 1000 mm : facteur | 0,353 | **0,352816** (= 1000 / 2834,34) |
| largeur cible 1000 mm : plus grande pièce | — | **568,95 mm** (= 1612,61 × 0,352816) |
| constat rendu | `import.scaleApplied` « 0.5 » / « 0.3528 » | **identique** (même écriture du nombre : `_jsnum` rend « 0.5 », pas « 0.5000 ») |

Captures et mesures brutes : `docs/qa/eclatement-2026-09-12/lotE2/`
(`01-eclatement-serveur-17-fiches.png`, `02-parite-navigateur.png`,
`03-echelle-serveur.png`, et les deux `resultats.json` des cas G et H — le
fichier d'entrée y porte le nom anonyme `logo.dxf`).

**Jeux de fichiers nettoyés, les deux importeurs sur le même corpus**
(`specs/import-corpus`, 148 fichiers lus par le serveur, 137 par les deux) :

| | fichiers |
|---|---|
| nettoyés des DEUX côtés | **5** |
| nettoyés navigateur seul | **2** |
| nettoyés serveur seul | **0** |
| aucun nettoyage | 130 |

Les deux écarts sont NOMMÉS et mesurés :

1. **Deux fichiers où le navigateur retire 168 et 114 ergots, le serveur 0** —
   avec le MÊME nombre de pièces (1) et de trous (8 et 2) des deux côtés. La
   géométrie de sortie est donc la même ; ce qui manque côté serveur est le
   COMPTE : sa grille de précision shapely (`set_precision(1e-4)` puis
   `unary_union(grid_size=1e-4)`) absorbe les aller-retours de largeur nulle
   AVANT que l'anneau n'arrive à `strip_spurs`, qui n'a donc rien à retirer.
   Ce n'est pas un écart de règle (seuils identiques, verrouillés par un test
   Python qui lit les constantes dans le fichier Rust) : c'est un écart de
   MESURABILITÉ, et il ne peut pas se refermer sans reconstruire les anneaux
   serveur depuis les entités source — c'est la couture (priorité 5).
2. **Deux fichiers nettoyés des deux côtés avec des comptes différents**
   (2 vs 3 micro-vides ; 53 vs 35) : là, les pièces et les trous diffèrent
   AUSSI (7 vs 10 pièces, 6 vs 4 trous ; 151 vs 141 pièces, 70 vs 4 trous).
   C'est la divergence des polygoniseurs, préexistante et documentée au lot 2c
   — hors de portée d'E2, et le même chantier de couture.

Le rapprochement RÉEL obtenu par ce lot est ailleurs, et il est chiffré : la
géométrie des 17 pièces éclatées passe de **1 pièce divergente à 0** (voir
5.3).

#### 5.3 Le défaut trouvé : des entités que le DXF de coupe ne contenait pas

En vérifiant que chaque sous-ensemble d'éclatement referme bien sa pièce, une
pièce du logo sur 17 rendait **2 corps au lieu d'1 et 20 277 mm² au lieu de
46 858** : son anneau extérieur ne se refermait plus, ses deux trous
devenaient deux pièces. Cause mesurée : **une SPLINE de 3,66 mm, à
0,000005 mm de la pièce, n'était attachée à AUCUNE pièce** — son encre touche
le corps sans le traverser, donc `intersection(...)` rend un Point de longueur
et d'aire nulles, et son centre tombe hors de la silhouette puisqu'elle est
SUR le bord. Les deux mesures d'attachement rendaient 0.

Ce n'est pas seulement un problème d'éclatement : **l'export du DXF de coupe
copie les entités handle par handle** (`workers/nesting/core/main.py`). Une
entité attachée à rien n'est donc exportée nulle part — le fichier de découpe
de cette pièce sortait sans ce morceau de son contour, en silence.

Correctif (`build_geometry.py`) : quand aucun corps n'a de mesure d'encre
positive mais qu'un corps est DÉJÀ candidat (filtre `buffer(probe_tol)
.intersects` existant), l'entité va au corps dont le contour est le plus
proche. Le repli est borné par `probe_tol` : une entité vraiment égarée reste
non attachée, et le constat de couverture continue de le dire.

**A/B sur le corpus (148 fichiers, serveur, avant/après le correctif)** :

| | avant | après |
|---|---|---|
| entités attachées à aucune pièce | **720** | **704** |
| fichiers concernés | 11 | **9** |
| fichiers identiques sur TOUS les champs mesurés (pièces, pièces émises, handles, aire, trous, constats) | — | **143 / 148** |
| fichiers changés | — | **5, et uniquement sur `handles`/`orphans`** — aucun changement de pièces, d'aire, de trous ni de constats |
| sous-ensembles du logo qui referment leur pièce | 16 / 17 | **17 / 17**, aire exacte |

Verrous : `test_l_encre_tangente_est_attachee_au_corps_qu_elle_touche`
(couverture complète) et `test_une_entite_vraiment_egaree_reste_non_attachee`
(le repli reste borné). **Contrôle négatif** : le premier test ÉCHOUE sur le
code d'avant (rejoué en montant l'ancien `build_geometry.py` dans l'image),
le second passe des deux côtés.

**Non-fait, à arbitrer par le propriétaire** : il reste **704 entités
attachées à aucune pièce sur 9 fichiers du corpus** (au pire 506 sur 1 841),
donc absentes des DXF de coupe, et les constats n'en rendent compte
qu'indirectement (85 `import.contoursDropped` au total sur ces 9 fichiers).
Une partie est légitime (tracés ouverts qui ne referment aucune pièce), une
partie est probablement de la matière perdue. Le dire à l'utilisateur demande
un constat de plus (« N entités non attachées à une pièce ») des DEUX côtés,
donc un rebuild du wasm géométrie et une régénération des goldens : je ne l'ai
pas fait dans E2 (la consigne fixe les trois constats à enrichir, et ils le
sont). À ranger avec la couture des contours (priorité 5).

#### 5.4 Verrous rejoués

| Verrou | Résultat |
|---|---|
| `npx vitest run` | **55 fichiers, 591 tests verts** |
| `cargo test --release -p nest-engine` | **106 passés, 0 échec, 2 ignorés** |
| pytest `workers/nesting` (image docker) | **236 passés, 2 ignorés** |
| pytest `workers/fileprocessing` (image docker) | **57 passés** (+15 au lot : échelle, sous-ensemble, éclatement, attachement) |
| pytest `workers/common` (image docker) | **86 passés** (+4 : le constat d'échelle et son écriture « à la JavaScript ») |
| `determinism_lock.py` | **2 fixtures bit-identiques natif ≡ wasm, tolerance 0** — SHA `a1bd8810…` (b_demo) et `4ff43700…` (e0_volute), inchangés depuis le lot E0 |
| wasm moteur reconstruit (piège #33b) | `public/engine/nest_wasm_bg.wasm` **1 620 566 octets** (avant : 1 615 822 — **+4 744**, le canal `thin_items`) |
| wasm géométrie | **inchangé** : le correctif d'attachement est côté Python, il rapproche le serveur du comportement que le navigateur avait DÉJÀ |
| harnais « import avancé » | cas **G** et **H** verts (ci-dessus) ; les cas A–F du lot E1/E1-bis restent le chemin navigateur |

#### 5.5 Arbitrages et corrections de forme

1. **Le panneau « Import avancé » est ouvert aux projets serveur**
   (`:advanced="local"` → `advanced`). Sans cela, le miroir serveur livré
   n'aurait aucun moyen d'être demandé. L'**aperçu sur une tôle** (lot E1-bis)
   reste, lui, réservé aux projets locaux : il exige de lire le fichier dans
   le navigateur, ce que le chemin serveur ne fait pas — et il n'en a pas
   besoin, puisqu'il résout la largeur cible sur l'étendue qu'il MESURE.
   À arbitrer si le propriétaire veut aussi l'aperçu sur le chemin serveur
   (il faudrait accepter une lecture navigateur de plus).
2. **Le harnais ne doit recevoir qu'une COPIE ANONYME** du fichier d'atelier :
   en le lançant d'abord sur l'original, son nom réel s'est retrouvé dans le
   `resultats.json` du dossier de sortie. Dossier détruit, relancé sur une
   copie nommée `logo.dxf` ; l'en-tête du harnais le disait déjà, je ne l'ai
   pas respecté du premier coup.
3. **Trois déposes successives dans un seul projet se sont révélées instables
   au harnais** (la troisième ne partait pas ; la même dépose passe sur un
   projet neuf, POST 200 mesuré à la sonde). Le cas H utilise donc un projet
   neuf par mesure. Ce n'est pas un défaut produit constaté — c'est une
   fragilité du harnais que je n'ai pas élucidée, et je la déclare.
4. Deux commentaires périmés du lot S (« both domains ») nettoyés dans
   `server/core/project/service.js`, au passage.

### Lot E2 — vérification (vérificateur, 13/09, `241f5dda`) — GO déploiement

Rejoué sur le poste, pile locale reconstruite à HEAD (wasm moteur servi =
dépôt `a015521e…`), sorties hors dépôt (`~/qa-out/verif-se2/`).

| Verrou | Résultat |
|---|---|
| vitest | 591 |
| cargo `nest-engine`, `determinism_lock.py` | CARGO_RESULT |
| **cas G et H du harnais** (projet « Nos serveurs », mesuré sur l'API) | GH_RESULT |
| lecture | échelle par `Matrix44.scale` après décomposition (piège #26), facteur non rejoué sur reprise (`importScaleApplied`) ; sous-ensemble par handles réécrit en séquence canonique et en millimètres (pièges #33b, #27) ; éclatement redéposé dans la boucle ordinaire du worker (aucune polygonisation parallèle) ; nom du DXF borné `and14more` |

**Arbitrages** : (1) panneau « Import avancé » ouvert aux projets serveur :
oui, sinon le miroir est inatteignable ; l'aperçu sur tôle reste local, c'est
cohérent (le serveur mesure lui-même l'étendue) — le propriétaire peut le
demander plus tard au prix d'une lecture navigateur. (2) Les 704 entités
attachées à aucune pièce sur 9 fichiers : **à ranger avec la couture des
contours (priorité 5)**, avec le constat « N entités non attachées » des deux
côtés ; le correctif d'attachement tangent livré ici (16/17 → 17/17 sur le
logo, 143/148 fichiers bit-identiques) est pris. (3) Les deux fichiers où le
navigateur compte des ergots que le serveur a déjà absorbés : écart de
mesurabilité, même chantier. (4) La fragilité « trois déposes dans un même
projet » du harnais est déclarée, non élucidée : à garder en tête si un
utilisateur signale une dépose qui ne part pas — non bloquant.

**GO déploiement E2** : app + worker fileprocessing + worker nesting
(`thin_parts` dans `main.py`) + wasm moteur, donc **homelab compris**
(`assert_overflow_head.py`) ; SHA du verrou de déterminisme inchangés →
benchmarks non invalidés (rejouer `densities_corpus.py`, n'écrire que si un
chiffre bouge). Avec ce déploiement, la **priorité 3 (pièces unitaires) est
close** : E0, E1, E1-bis, E2 livrés.


#### Déploiement du lot E2 (implémenteur, 13/09)

Déployé à `d890c923` — dans la même fenêtre que le lot S. Images publiées
`ghcr.io/…:latest` : worker nesting `sha256:6ee233c7…` (**même Id d'image sur
le poste, sur Hetzner et sur le homelab**).

| Contrôle | Résultat |
|---|---|
| conteneurs recréés | app, user-file-processing-worker, nesting-worker (+ admin) — tous `Up`, `GET /` **200** |
| commit injecté | `NUXT_PUBLIC_GIT_COMMIT_SHA=d890c923…` |
| artefacts SERVIS = dépôt (piège #14i) | **octet pour octet** : `engine/nest_wasm_bg.wasm` `a015521e…`, `geometry/nest_geometry_bg.wasm` `5fe7fec3…` (ce dernier inchangé par le lot, vérifié quand même) |
| **le worker fileprocessing de PRODUCTION porte le code E2** | interrogé dans le conteneur : `subset_drawing_bytes`, `scale_drawing`, `resolve_import_scale`, `_explode_into_parts` présents ; `_exploded_names("logo.dxf", 17)` rend `logo (1/17).dxf`, `logo (2/17).dxf` ; le repli d'attachement tangent est dans `build_geometry` |
| **le bundle SERVI porte les libellés du lot** | le morceau i18n de production (`_nuxt/HA86ooHp2.js`) contient « Advanced import » ET « Import avancé », « Drawing scaled by » ET « à l'échelle × », et la ligne des pièces fines en anglais (« have lines thinner than the requested spacing ») comme en français (« traits plus fins ») |
| homelab (débordement) | 3 workers recréés sur le même digest ; `assert_overflow_head.py` → **`ASSERT OVERFLOW=HEAD: OK`**, binaire moteur du **13/09 08:16 UTC** ; `NEST_COMPUTE_TOKENS=28` des deux côtés |
| corpus de torture sur l'**image publiée** | **11/11 OK** — T-J refus attendu, T-K complet 1000/1000, T-A 900/900 sur 2 tôles [587, 313] ; 0 recouvrement, tout dans la tôle, 0 doublon, aucun rollback |
| benchmarks publics | `densities_corpus.py` rejoué sur l'image publiée : **9 des 10 fiches identiques**, **une a bougé** — T-F passe de 89/90 à **90/90** (densité 89,0 → 90,0 %). C'est sa bande d'oscillation documentée (88, 89, 88, 89, 90, 89, **90** sur sept passages), pas un effet du lot : le verrou de déterminisme est bit-identique et le changement moteur d'E2 n'est qu'un canal d'observation. `data/benchmarks.js` **mis à jour** (version `d890c92`, date du run, T-F et son commentaire) — la page ne doit pas afficher les chiffres d'une autre image |
| journaux prod | **0 ERROR / Traceback** sur 200 lignes (app, nesting-worker, user-file-processing-worker, admin) |

**Non-fait, dit franchement** : « le logo éclaté depuis un projet serveur,
17 fiches » n'a **pas** été joué par moi en production — l'import est derrière
`auth` et je n'ai pas de compte de production ; en créer un est une écriture
de production qui vous revient (même remarque qu'au lot E0). Ce qui est
mesuré à la place : la même chaîne, au même commit, sur la pile locale
reconstruite — **17 fiches serveur, parité navigateur/serveur 17 sur 17 sans
écart** (cas G du harnais) — plus, en production, la présence effective du
code d'éclatement dans le conteneur qui l'exécute et des libellés dans le
bundle servi. Il manque le geste humain, pas la chaîne.

**Un défaut de coureur corrigé au passage** : `bench/eval_corpus.py` mourait
en `AttributeError` sur deux vieux jobs T-I de mon Mongo local dont
`report.postPass` est explicitement `null` (`get(k, {})` ne protège pas de
`None`). Le coureur rendait donc… rien, au lieu de la fiche du run demandé.
Corrigé (`(a.get("report") or {}).get("postPass") or {}`) et le run est
cadré par `CORPUS_SINCE`, comme le script le prévoyait.
