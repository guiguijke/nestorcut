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
