# Correctif — la vue DXF d'un résultat local fige la page (14/09)

Constat du propriétaire, 14/09, en production (`9b227ec1`) : « la vue DXF
après le nesting est buggée, ça fait planter la page web ». Priorité 1,
réparer la prod avant tout le reste.

## 1. Reproduction (vérificateur, 14/09)

Image locale reconstruite au commit de prod, harnais Playwright sans écran,
journal par étape et sonde de réactivité (`page.evaluate(() => 1 + 1)` avec
délai de 10 s).

| Essai | Résultat |
|---|---|
| dessin du collègue (17 pièces), import ordinaire, nesting 15 s, résultat ouvert, **vue couleur** | page réactive (1 ms) |
| même chose, bascule **« Vue DXF »** | **page figée 3 s après le clic**, et toujours figée à +10, +30, +60 s ; capture impossible |
| **pièce simple** (`Piece_Trou`, 4 lignes + 1 cercle), même parcours | **figée aussi** — ce n'est pas le dessin |
| dessin du collègue, visionneuse DXF de la **fiche d'origine** (même composant, même dxf-viewer, même WebGL) | réactive à +3, +10, +25 s — ce n'est pas WebGL ni la machine |
| DXF nesté extrait d'IndexedDB (277 830 caractères, 945 entités, 0 handle dupliqué, 0 SPLINE suspecte) **réimporté comme fichier** et vu dans la visionneuse de fiche | réactive — ce n'est pas le contenu exporté |
| **pause du débogueur pendant le gel** (CDP `Debugger.pause`) | pile : `parseTableRecords` (table LAYER) ← `_parse` ← `parseSync` ← `Fetch` de dxf-viewer, **même position à deux pauses successives** : boucle `while (!groupIs(0, 'ENDTAB'))` |
| analyseur de dxf-viewer rejoué en Node sur le texte extrait | **brut : 8 ms** ; **après `uniquifyDxfHandles` : boucle infinie** ; une seule ligne remise en place : 8 ms |

## 2. Cause

`app/composables/localHydrate.js`, `uniquifyDxfHandles`, appelé par
`dxfToBlobUrl` pour TOUT DXF de résultat local avant de le donner à la
visionneuse. La fonction parcourt le texte **ligne par ligne** et, dès qu'une
ligne vaut `5`, réécrit la ligne suivante comme un handle hexadécimal. Elle
ne distingue pas une ligne de CODE de groupe d'une ligne de VALEUR.

Le DXF exporté porte, dans la table des calques, le calque `BIN_BOUNDARY`
avec la couleur `62` / `5`. La ligne de valeur `5` est prise pour un code
de handle : la ligne suivante, qui est le code `0` du `ENDTAB`, devient `1`.
La table des calques n'a plus de fin ; l'analyseur de dxf-viewer, sur un
code `0` dont la valeur n'est pas `LAYER`, n'avance pas — boucle infinie sur
le fil principal, page figée.

**Depuis quand** : le lot 2b (`c84b0842`, déployé le 12/09 à 08 h 39) écrit
les codes de groupe entiers en entiers — `5` au lieu de `5.0`. Avant, la
valeur `5.0` ne collisionnait pas avec le test `=== '5'`. **Tous les
résultats calculés sur l'appareil depuis le 12/09 sont concernés** (leur
calque `BIN_BOUNDARY` est toujours de couleur 5) ; les résultats « Nos
serveurs » sont servis par URL sans passer par cette fonction, et la
visionneuse de fiche non plus. Aucun harnais n'ouvrait la vue DXF d'un
résultat : deux jours de vérifications ne pouvaient pas le voir.

Le même défaut peut corrompre une entité : toute VALEUR entière `5` (degré ou
compte d'une SPLINE, drapeau `70`, couleur `62`) décale la paire suivante.

## 3. Correctif (lot H1, une heure, app seule)

1. `uniquifyDxfHandles` parcourt le texte **par paires (code, valeur)** :
   indices pairs = codes, impairs = valeurs ; seule une ligne de CODE `5`
   déclenche la réécriture de sa valeur. Mesuré sur le fichier extrait :
   l'analyseur passe en 8 ms avec cette version.
2. Verrous unitaires (`app/tests/localBridge.test.js`, bloc existant) : un
   DXF avec calque de couleur `62`/`5`, une SPLINE de degré `71`/`5` et un
   drapeau `70`/`5` — après passage, `0`/`ENDTAB` intact, entiers intacts,
   handles réécrits ; et l'analyseur de dxf-viewer (`node_modules/dxf-viewer/
   src/parser/DxfParser.js`, importable en test) termine sur le texte
   produit, comme témoin de non-boucle.
3. **Verrou navigateur** : le harnais `scripts/qa-e2e-local-2sheets.mjs` (ou
   un cas dédié) ouvre la **vue DXF** d'un résultat et exige la page
   réactive à +5 s, dans ses deux configurations — c'est le trou qui a laissé
   passer le défaut deux jours.
4. Déploiement app seule, par SHA approuvé et `promote-latest`, après GO ;
   aucun moteur, aucun worker, pas de benchmarks.
5. AGENTS.md §2, piège neuf : *toute manipulation textuelle d'un DXF se fait
   par paires (code, valeur), jamais ligne à ligne ; et un exporteur qui
   change le FORMAT d'une valeur (flottant → entier) doit rejouer les
   consommateurs textuels de sa sortie.*

## 4. Ce que ce correctif ne change pas

L'exporteur (lot 2b) est juste : les entiers en entiers sont la forme
attendue par ezdxf et par SheetCam. Le DXF téléchargé par l'utilisateur est
le texte BRUT (sans `uniquifyDxfHandles`), il n'a jamais été corrompu.
