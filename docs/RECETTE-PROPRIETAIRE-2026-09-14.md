# Recette du propriétaire — priorités 3 et 4 en production (14/09)

Décision du propriétaire : « m'assurer que mes deux priorités, éclatement /
redimensionnement DXF et `.job`, fonctionnent avant de me lancer dans de
nouvelles features ». Cette page est la liste des gestes à faire **sur
`app.nestorcut.com`**, avec ce que chacun doit montrer. Tant qu'une ligne
n'est pas verte, l'agent ne livre que des correctifs.

Prod attendue : `gitCommitSha 8b87e678` (E4 complet, J4-ter, H1). Le lot
« point déplacé intouchable » (`117bb4ce`) s'y ajoutera après son GO.

## A. Priorité 3 — dessin multi-pièces, échelle, éclatement (mode « Cet appareil »)

| # | Geste | Attendu | Verdict |
|---|---|---|---|
| A1 | Nouveau projet « Cet appareil », déposer le DXF du logo (17 pièces) tel quel | **une** fiche « 1 bloc · 17 pièces · 2834 × 689 mm », aucune fenêtre, deux actions sur la fiche : « Échelle », « Éclater en pièces » | |
| A2 | Tôle 3000 × 1500, nester | « 17 pièces placées (1 bloc) », les 17 pièces à leurs positions relatives d'origine ; densité ≈ 8 % (aire vraie) | |
| A3 | Télécharger le DXF, l'ouvrir dans SheetCam ou ton CAO | les 17 pièces, le dessin entier posé d'un bloc | |
| A4 | Vue DXF du résultat | la page reste réactive, le dessin s'affiche (correctif H1) | |
| A5 | Sur la fiche, « Échelle » : saisir **largeur 1000** | hauteur 243,0 et facteur 0,353 se recalculent ; poignée cohérente ; « Appliquer » ⇒ fiche « 1000 × 243 mm », en place | |
| A6 | « Réinitialiser l'échelle » | fiche à 2834 × 689 mm, comme importée | |
| A7 | « Échelle » 1000 puis « Éclater en pièces » (confirmation en une ligne) | 17 fiches « logo (k/17) », une pièce chacune, à l'échelle 1000 | |
| A8 | Tôle 1000 × 2000, nester | 17 pièces libres placées, densité bien plus haute que A2, aucun bloc au rapport | |
| A9 | Déposer un DXF ordinaire à une pièce | comportement inchangé : une fiche, une pièce, nesting comme avant | |

## B. Priorité 3 — même chose en « Nos serveurs » (compte payant ou granté)

| # | Geste | Attendu | Verdict |
|---|---|---|---|
| B1 | Projet « Nos serveurs », déposer le logo | une fiche 17 pièces, bloc | |
| B2 | « Échelle » 1000 ⇒ appliquer ; puis réinitialiser | fiche retraitée par le worker à 1000 × 243 ; retour à l'origine | |
| B3 | « Éclater en pièces » | 17 fiches produites par le worker, la fiche d'origine disparaît | |
| B4 | Nester | 17 pièces placées, DXF téléchargé complet | |

## C. Priorité 4 — `.job` SheetCam (mode « Cet appareil »)

| # | Geste | Attendu | Verdict |
|---|---|---|---|
| C1 | Déposer `Piece_Trou+Fill_x4_OK.job` **seul** (J6 + J6-bis en production depuis le 14/09 au soir, page à `777b48a8`) | deux fiches (hôte ×1, éventail ×4), tôle 1000 × 1250 pré-remplie, kerf 1,5 et sécurité 1 ⇒ « espacement = 2 × kerf + sécurité = 4 mm » | |
| C2 | Nester | 5 pièces placées ; le rapport dit, par pièce, la réserve d'amorce et le point de départ (lu / utilisateur) | |
| C3 | Télécharger le `.job`, l'ouvrir dans SheetCam | 5 pièces aux poses de NestorCut, ordre de coupe manuel (nichées avant l'hôte s'il y en a), aucune pièce fantôme | |
| C4 | Post-traiter dans SheetCam | le G-code amorce là où NestorCut a écrit (trou et contour) ; aucune amorce ne coupe une pièce voisine | |
| C5 | Refaire C1-C4 avec ton `.job` où le point de départ du trou est **déplacé à la main** (après déploiement de `117bb4ce`) | ton point est conservé à l'octet, la réserve est posée dessus, le G-code y amorce | |
| C6 | Un `.job` réel d'atelier (plus de 7 dessins, noms accentués) | toutes les fiches créées, aucun « dessin manquant » à tort, nesting et `.job` rendu | |

## C-bis. Priorité 4 — la série « points de départ » (après le déploiement de J7)

| # | Geste | Attendu | Verdict |
|---|---|---|---|
| C7 | Déposer seul chacun des six `.job` de `job-tests-new` | une fiche par fichier, « géométrie lue dans le fichier de travail », nesting abouti — **y compris les deux petites pièces**, qui refusaient avant J7 | |
| C8 | Le fichier aux trois points déplacés à la main, et son jumeau aux points par défaut | sur le premier, tes trois points sont conservés à l'octet ; sur le second, NestorCut pose les siens | |
| C9 | Post-traiter l'un des deux dans SheetCam | le G-code amorce là où la capture d'écran le montre | |

## D. Ce qui n'est PAS dans la recette

- La densité d'un bloc clairsemé (E4-e, étude en cours) : le bloc convexe
  est le comportement livré.
- Le choix automatique d'un meilleur point de départ (J4-quater) : après.
- Le `.job` en mode « Nos serveurs » (J5) : après.

## E. Règle jusqu'au verdict

L'agent ne livre que des **correctifs** issus de cette recette (chaque ligne
rouge devient un lot court : constat, cause, correctif, verrou, GO,
déploiement). Aucune nouvelle fonctionnalité — E4-e, J4-quater, J5, couture
— tant que les tableaux A à C ne sont pas verts.
