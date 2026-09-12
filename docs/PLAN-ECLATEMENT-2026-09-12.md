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

Commit : `HASH`. **Non déployé** — moteur natif, wasm moteur, app, serveur et
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
