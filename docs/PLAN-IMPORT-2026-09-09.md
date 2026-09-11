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
