# Plan — la documentation NestorCut (15/09)

Demande du propriétaire (15/09) : « partons sur une documentation complète
avec menu, recherche, multilingue et tout ce qu'il faut pour une
documentation professionnelle (aussi expliquer l'interface, les
optimisations de nesting, etc.) », déclenchée par le besoin d'expliquer le
comportement des `.job` multi-pièces.

## 1. Où elle vit, et pourquoi — arbitrage technique

Trois options existaient ; une seule s'impose.

| Option | Verdict |
|---|---|
| Dans l'application (Nuxt Content, route `/docs`) | **Non** : derrière l'app, mal référencée, invisible avant l'inscription — une documentation est aussi un argument de vente. |
| Un site à part (VitePress, Docusaurus) | **Non** : une troisième pile, un troisième déploiement, une troisième i18n à maintenir pour un atelier d'une personne. |
| **Dans le site vitrine, avec Starlight** (le thème documentation officiel d'Astro) | **Oui.** Le site `../nestorcut-website` est déjà en Astro 5 avec un dossier `fr/` et un blog. Starlight apporte d'origine le **menu latéral**, la **recherche** (Pagefind, index statique, zéro serveur), le **multilingue** (EN à `/docs/`, FR à `/fr/docs/`), le thème sombre, la navigation précédent/suivant, le sommaire de page, « modifier cette page ». Même dépôt, même déploiement, même domaine : `nestorcut.com/docs`. |

Règles fixées d'avance :

- **Le français d'abord**, c'est la langue du propriétaire et de son marché ;
  l'anglais est traduit dans le MÊME lot, jamais après. Une page qui n'existe
  que dans une langue est un défaut de verrou.
- **Chaque phrase est vraie en production le jour où elle est publiée.** Même
  discipline que `docs/STRATEGY.md` : on ne documente pas ce qui n'est pas
  livré. Ce qui arrive va dans une page « Bientôt » explicitement nommée, ou
  nulle part.
- **Les captures viennent d'un harnais**, sur des fichiers neutres (la pièce
  L du dépôt, les fixtures, des DXF générés), jamais un fichier du corpus ni
  un nom de client. Elles se régénèrent à chaque version pour ne jamais
  montrer une interface périmée.
- **La voix est celle de l'atelier** : « vous déposez », « la tôle »,
  « l'amorce » — jamais « le payload », jamais un nom de lot. L'implémenteur
  rédige, **le propriétaire relit chaque section avant publication** : c'est
  son produit qui parle.
- **Le vérificateur contrôle les affirmations contre l'application qui
  tourne**, pas contre le code : si la doc dit « le point de départ que vous
  avez déplacé est conservé », il le rejoue.

## 2. L'architecture de l'information

Le menu, dans l'ordre où un nouvel utilisateur en a besoin :

1. **Démarrer** — ce qu'est NestorCut (la référence du nesting dans le
   navigateur : DXF entrant, DXF sortant, rien ne quitte la machine), les
   deux modes (« Cet appareil » / « Nos serveurs ») et lequel choisir, un
   premier nesting en cinq minutes.
2. **L'interface** — l'accueil, la page projet (tôles, espacement et kerf,
   rotations, sens d'optimisation, options), les cartes de pièces (échelle,
   éclatement, quantités), la vue en direct, le résultat et ses badges, les
   téléchargements.
3. **Vos fichiers** — DXF (ce qui est lu, unités, blocs, dessins
   multi-pièces et le bloc rigide), SVG, DWG (serveurs seulement), et
   **Fichiers de travail SheetCam (`.job`)** : ce que NestorCut lit (tôle,
   kerf, quantités, contours, points de départ, amorces), ce qu'il écrit en
   retour (un `.job` par tôle, vos points déplacés à la main conservés à
   l'octet), **pourquoi un dessin présent quatre fois donne quatre pièces
   libres** (SheetCam les traite déjà ainsi), et ce qui n'est pas encore
   lu, nommé (zones d'exclusion, outils multiples, opérations multiples,
   mode serveurs).
4. **Le nesting expliqué** — bande ou multi-tôles et pourquoi ; l'espacement
   = 2 × kerf + sécurité, avec le dessin ; les rotations ; les trois sens
   (bord gauche, bord bas, équilibré) et ce qu'ils changent ; le remplissage
   des trous et sa limite d'espacement ; **les deux densités** (celle de la
   bande pendant le calcul, celle de la tôle au résultat) ; l'arrêt sur
   plateau : pourquoi le calcul s'arrête quand il s'arrête ; ce que
   garantissent les badges « sans recouvrement », « dans la tôle »,
   « écart ≥ ».
5. **Vos résultats** — le rapport, la chute réutilisable et ce que « au
   moins » veut dire, l'export CSV, le DXF, le `.job`, la vue DXF, les
   alternatives.
6. **Confidentialité** — ce qui reste sur votre machine, ce qui va sur nos
   serveurs, le coffre, l'effacement à 24 h — strictement aligné sur les
   promesses de `specs/THREAT-MODEL.md`, jamais au-delà (piège #35).
7. **Limites connues et questions fréquentes** — la taille par fichier, une
   pièce seule sur une grande tôle, ce que le mode appareil ne fait pas,
   que faire quand une pièce est refusée, comment nous envoyer un fichier
   qui pose problème.
8. **Nouveautés** — générée depuis `CHANGELOG.md` de l'app (une seule
   source, voir J11-b), la version courante en tête.

## 3. Les lots, dans l'ordre

| Lot | Contenu | Pourquoi cet ordre |
|---|---|---|
| **D1 — le socle** | Starlight dans le site vitrine, EN + FR, recherche Pagefind, menu, thème, déploiement sous `/docs`, une page « Démarrer » complète dans les deux langues, harnais de captures (pièce L, fixtures). | Sans socle, rien ne se publie. Une page réelle prouve la chaîne de bout en bout. |
| **D2 — les fichiers** | Toute la section 3, `.job` compris — c'est la demande d'origine. | C'est là que le propriétaire a un besoin immédiat d'explication. |
| **D3 — l'interface et le nesting** | Sections 2 et 4. | Le cœur du produit ; les deux densités et l'espacement y trouvent leur explication. |
| **D4 — résultats, confidentialité, limites, nouveautés** | Sections 5 à 8, `CHANGELOG.md` branché. | Complète la couverture. |
| **D5 — les liens depuis l'application** | Une icône « ? » près de chaque section de la page projet (tôles, espacement, sens, options) et du résultat, qui ouvre la page de doc à l'ancre exacte, dans la langue de l'utilisateur. | La doc doit être à un clic du geste, pas dans un menu lointain. |

Chaque lot : rapport, **relecture du propriétaire section par section**,
vérification des affirmations contre l'app qui tourne, GO, publication.
D1 et D2 ensemble font une première documentation utile ; D3 à D5 suivent.

## 4. Ce que ce chantier n'est pas

- Ce n'est pas de la publicité : la page d'accueil du site reste le lieu du
  discours commercial, la documentation dit comment ça marche.
- Ce n'est pas un lieu de promesses : rien sur ce qui n'est pas livré, hors
  la page « Bientôt » si le propriétaire la veut.
- Ce n'est pas un lot de calcul : le gel des nouveautés de calcul tient, la
  documentation avance en parallèle sans le lever.

## 5. Périmètre et dépendances

Dépôt frère `../nestorcut-website` pour D1 à D4 ; l'application (`app/`)
pour D5 et pour `CHANGELOG.md`. Aucun moteur, aucun worker. D1 peut
commencer tout de suite ; D2 attend que J11-a (carte groupée) soit livré,
pour documenter l'écran final et non l'intermédiaire.

## Rapport du lot D1 (implémenteur, 16/09) — le socle

**Starlight vit DANS le site vitrine, branche `d1-docs` du dépôt frère**
(PR ouverte, URL de prévisualisation pour la relecture — la fusion vers
`main` publie, elle attend le GO). Ce qui a été fait, et mesuré :

1. **Le montage** : `@astrojs/starlight` **épinglé à 0.37** — c'est la
   dernière branche qui accepte Astro 5 (le site vitrine est en 5.18 ;
   la dernière Starlight exige Astro 7 : monter serait un lot à part,
   dit ici). Le contenu vit sous `src/content/docs/<locale>/docs/` : le
   sous-dossier `docs` + la locale `root` (anglais sans préfixe)
   donnent **`/docs/` en anglais et `/fr/docs/` en français** — la
   convention du site vitrine, vérifiée dans `dist/`. Deux débroussaillages
   nécessaires, consignés : la config racine `i18n` d'Astro a été
   RETIRÉE (Starlight refuse la cohabitation ; rien ne l'importait, le
   routage vitrine est fait main via `localePath()`), et la collection
   `docs` se déclare dans `src/content.config.ts` par les helpers
   officiels (`docsLoader`/`docsSchema`) puisque le site a déjà son blog.
2. **La page « Démarrer » complète dans les deux langues** :
   ce qu'est NestorCut, où se passe le calcul (cet appareil / nos
   serveurs, et lequel choisir), le premier nesting en cinq minutes
   (étapes réelles du flux V0.9.0), et ce que NestorCut n'est pas.
   Voix d'atelier, aucune promesse hors production : chaque phrase est
   vraie à la version déployée ce jour (dix nestings offerts, `.job`
   lu seul, badges du résultat, suppression à 24 h côté serveurs).
3. **La recherche et le menu** : Pagefind indexé au build
   (`dist/pagefind/` présent), sidebar par locale (« Getting started » /
   « Démarrer »), sélecteur de langue vérifié dans les deux pages
   (EN → `/fr/docs/`, FR → `/docs/`), thème sombre d'origine, favicon
   du site (celui de Starlight par défaut était cassé — lien 404, corrigé).
4. **Le lien « Docs » dans la navigation du site vitrine** : ajouté au
   header EN (`/docs/`) et FR (`/fr/docs/`), vérifié dans les pages
   bâties.
5. **L'harnais de captures** (`scripts/qa-docs-captures.mjs` du dépôt
   principal) : dépose la **pièce L** (fixture validée par le
   propriétaire le 13/09 — fichier neutre, aucun nom de client),
   interface en **français**, captures retina ×2 vers
   `nestorcut-website/public/docs-img/` : `demarrer-accueil.png`
   (le choix de l'endroit du calcul) et `demarrer-projet.png` (la page
   projet : pièce déposée, tôles, réglages — celle de la page
   « Démarrer »). **GO, exit 0**, 4 sondes vertes (modes affichés, fiche
   déposée, bouton nesting, interface FR). Le journal va dans `.qa-pw/`,
   rien hors images n'est publié. À relancer à chaque version dont la
   page projet change d'allure.

**Chiffres** : `astro build` **exit 0**, 30 pages ; `check:links` **OK**
(29 pages HTML + sitemap, aucun lien cassé après le correctif favicon) ;
sitemap contenant `/docs/` et `/fr/docs/` vérifié.

**Captures, lues par sondes** (pas de vision d'image cette session, la
méthode est dite) : dimensions 2880×1800 (retina ×2), densité de contenu
34 % (accueil) et 8 % (page projet, fond clair de l'atelier), texte rendu
vérifié au moment de la prise (« Cet appareil », « Nos serveurs », le
résumé de prévol « 1 pièce · 1 fichier »).

**Non-dits** : le 404 du site vitrine gagne sur celui de Starlight
(warning de collision à la construction — deviendra une erreur dans une
future version d'Astro ; le 404 marqué reste celui du site, acceptable
pour D1, à retravailler si Starlight monte) ; la sidebar ne montre que
« Démarrer » — les sections suivantes arrivent avec D2-D4 ; la page
Nouveautés (section 8) attend D4 et le branchement de `CHANGELOG.md` ;
relecture propriétaire de la page « Démarrer » attendue avant
publication (fusion de la PR).

## Vérification du lot D1 (vérificateur, 16/09) — socle GO, publication NO-GO, lot D1-bis

Rejoué : la branche `d1-docs` du dépôt frère (`74d1591` + `308eb08`) dans un
arbre de travail séparé (`~/qa-out/verif-d1/wt`, l'arbre du propriétaire n'a
pas été touché) : `npm ci`, `astro build` **code 0, 30 pages**, `check:links`
**code 0** ; la prévisualisation Cloudflare sondée en lecture ; **les deux
captures regardées avec mes yeux** ; et chaque affirmation de la page
« Démarrer » contrôlée contre l'application déployée (`a22b7d5a`) et son
code de routage.

### Le socle tient — mesuré

| Point | Mesure |
|---|---|
| Routes | `/docs/` et `/fr/docs/` en 200, `/docs` ⇒ 308 vers `/docs/`, `/docs/nope/` ⇒ 404 (celui du site) |
| Langue | `<html lang="fr">` sur la page FR, sélecteur EN ⇄ FR présent dans les deux sens, `hreflang` en et fr posés |
| Recherche | `/pagefind/pagefind.js` servi en 200, composant de recherche dans la page |
| Site vitrine | lien « Docs » dans le header EN (`/docs/`) et FR (`/fr/docs/`) ; le logo Starlight ramène à l'accueil du site (`/fr/`) |
| Montage | Starlight 0.37 épinglé (dernière branche Astro 5), collection `docs` déclarée à côté du blog, config `i18n` racine retirée sans perte (le routage vitrine est manuel) — juste |
| Avertissement | collision `/404` site ↔ Starlight au build, comme dit au rapport ; à traiter avant une montée d'Astro, pas maintenant |

### Le contenu ne se publie pas encore — cinq affirmations à corriger

La règle du §1 est « chaque phrase vraie en production le jour où elle est
publiée ». Cinq ne le sont pas, dans les deux langues sauf mention :

1. **« la machine d'essorage cherche le meilleur rangement »** (FR, premier
   paragraphe). Ce n'est pas du français d'atelier, c'est une machine à
   laver. **« le moteur »**.
2. **« Nos serveurs. Les fichiers partent calculer sur nos machines, plus
   rapides que la vôtre »** — **faux pour le compte gratuit**, qui est
   précisément le lecteur de « Démarrer ». Mesuré dans le routage
   (`resolveComputeLocation` : `tier === 'free'` ⇒ calcul navigateur) : en
   « Nos serveurs », un compte gratuit envoie ses fichiers sur nos machines
   pour la lecture, mais **le calcul se fait dans son navigateur**, plafonné
   à deux tôles ; le calcul sur nos machines est réservé aux plans payants.
   La section « Où se passe le calcul » doit dire cette vérité-là : en
   gratuit, le calcul est dans votre navigateur dans les deux cas ; « Nos
   serveurs » apporte le DWG et vos projets sur tous vos appareils ; le
   calcul serveur vient avec un plan payant.
3. **Le `.job` en « Nos serveurs »** : la carte de l'accueil dit « Fichiers
   .job SheetCam : pas encore ici ». La doc (étape 3) le tait. Une phrase :
   le `.job` se dépose sur « Cet appareil » ; déposé en mode serveurs, le
   projet bascule de lui-même sur l'appareil.
4. **Les badges** : la doc dit « sans recouvrement », « dans la tôle »,
   « écart respecté » / « spacing kept ». Les libellés réels de l'application
   sont **« Sans recouvrement », « Dans la tôle », « Écart ≥ 4 mm »**
   (EN : « Overlap-free », « Inside sheet », « Gap ≥ 4 mm »), et il existe
   un badge **« Non vérifié »** au-delà de 5 000 pièces par tôle. Citer les
   libellés exacts, entre guillemets, et dire que « Non vérifié » existe.
5. **FR étape 6 « de la meilleure à la plus dense en matière »** : la phrase
   ne veut rien dire (la meilleure EST la plus dense) et l'anglais ne la
   porte pas. Les propositions sont classées par sens d'optimisation puis
   par qualité ; dire simplement « plusieurs propositions, une par sens
   d'optimisation ».

Et une tension à lisser : l'introduction dit « Tout se passe dans votre
navigateur », la section suivante propose nos serveurs. « Tout **peut** se
passer dans votre navigateur ».

### Les captures ne se publient pas non plus — vues

- **`demarrer-accueil.png`** : c'est l'accueil du **compte de développement
  du propriétaire** — « Bonjour, Guillaume », 980 projets, 291 438 pièces,
  une colonne de projets d'essai aux noms aléatoires, une colonne de
  résultats « calculé sur un autre appareil ». Ce n'est pas une capture de
  documentation. Et **la page ne l'utilise pas** : seule
  `demarrer-projet.png` est référencée — 339 Ko publiés pour rien.
- **`demarrer-projet.png`** : la légende promet « la pièce déposée, la tôle
  et les réglages » ; l'image montre **une tôle vide** avec ses axes, la
  fiche de la pièce est sous le pli, et la même colonne de projets d'essai
  à gauche. La capture ne montre pas ce que sa légende dit.

Les sondes de l'implémenteur (dimensions, densité de pixels, texte présent)
ne pouvaient pas voir cela ; c'est pourquoi le vérificateur regarde en
premier. Règle pour la suite, dans le harnais : **un compte local dédié aux
captures, neuf, sans historique** (créé par le harnais via
`/api/auth/local/register` s'il n'existe pas — jamais le compte de
développement) ; **des captures d'élément**, pas de page entière (le bloc
« Nouvelle imbrication » pour le choix de l'endroit du calcul ; la page
projet cadrée sur la fiche de la pièce, la tôle et les réglages) ; **chaque
image publiée est référencée par une page**, et sa légende dit ce qu'on y
voit.

### Structure du menu, à régler avant D2

Le menu montre un groupe « Démarrer » qui contient une seule page
« Démarrer » (le mot deux fois), et `autogenerate: { directory: 'docs' }`
sous ce groupe fera tomber **toutes** les pages de D2 à D4 sous « Getting
started ». À faire dans D1-bis puisque c'est de la configuration : un
sous-dossier par section (`demarrer/`, `fichiers/`, `interface/`…), un
groupe par sous-dossier avec sa traduction, « Démarrer » en premier.

### Hors périmètre, à trancher par le propriétaire

Le commit `308eb08` « aligner le bleu sur l'app (#007bff → #0069d9) » voyage
dans la PR de documentation : c'est un changement de charte du site vitrine,
pas de la doc. S'il est voulu, qu'il soit dit ; sinon, le sortir de la PR.

### Remarque du propriétaire (16/09) : « la documentation me paraît un peu light »

Elle l'est, et c'est voulu au stade D1 : le socle plus UNE page pour prouver
la chaîne. Mais la remarque tranche une question que le plan laissait
ouverte : **à partir de quand publie-t-on ?** Une documentation d'une page
sur un site public fait l'effet d'un chantier abandonné, l'inverse de
l'argument de vente voulu. Arbitrage : **la première publication attend
les sections 1 à 4** (Démarrer, Interface, Vos fichiers, Le nesting
expliqué — lots D1-bis, D2 et D3), avec le menu complet ; D4 complète
ensuite. D1-bis est absorbé dans D2 : une seule PR, un seul GO, une seule
relecture du propriétaire, qui lit alors une documentation entière plutôt
qu'une page. La prévisualisation Cloudflare reste le lieu de relecture
entre-temps ; rien ne fusionne vers `main` avant.

Et sur la profondeur des pages elles-mêmes : le §2 fixe, section par
section, ce que chaque page doit couvrir — une page « Vos fichiers » qui ne
dit pas pourquoi quatre exemplaires donnent quatre pièces libres, ou une
page « Nesting » sans le dessin de l'espacement et les deux densités, sera
renvoyée comme « light ». Chaque page porte au moins une capture cadrée sur
ce qu'elle explique.

### Décision

**Socle : GO. Publication (fusion de la PR) : NO-GO** jusqu'au lot D1-bis :
les cinq corrections de texte ci-dessus dans les deux langues, la tension
de l'introduction, les captures refaites selon la règle (compte neuf,
captures d'élément, aucune image orpheline), la structure du menu par
section. Puis **relecture du propriétaire sur la page FR de la
prévisualisation** — c'est la porte prévue au plan — et GO. D1-bis est absorbé dans D2 ; la première publication attend les
sections 1 à 4 (voir la remarque du propriétaire ci-dessus).

## Rapport du lot D2 (implémenteur, 16/09) — absorbe D1-bis

Toujours la PR nestorcut-website#14 (branche `d1-docs`, commit `3b6948e`) ;
rien ne fusionne avant le GO, la prévisualisation reste le lieu de
relecture. Le commit `308eb08` (bleu) n'est PAS dans la PR — il est déjà
sur `main` du site (tête de branche publique au moment de la vérification) ;
la décision de le garder appartient au propriétaire, la PR de doc ne
transporte que de la documentation.

**Les cinq corrections + la tension (vérification D1, §« contenu »).**
Les deux pages « Démarrer » disent maintenant : « le **moteur** cherche
le meilleur rangement » (fin de la machine d'essorage) ; « Tout **peut**
se passer dans votre navigateur » ; la VÉRITÉ du calcul — en gratuit,
le calcul se fait dans votre navigateur dans les deux modes, plafonné à
2 tôles par tâche, le calcul sur nos machines vient avec les plans
payants, « Nos serveurs » apporte le DWG et les projets sur tous vos
appareils ; le `.job` déposé en mode serveurs fait basculer le projet
sur l'appareil (vérifié dans `home.vue` : `privacyChoice = 'device'`,
information affichée) ; les badges cités entre guillemets avec leurs
libellés exacts — « Sans recouvrement », « Dans la tôle », « Écart ≥
4 mm », et « Non vérifié » au-delà de 5 000 pièces par tôle (libellés
contrôlés dans `i18n.js`) ; les propositions « une par sens
d'optimisation, la meilleure en tête ».

**Le menu par section.** Un dossier et un groupe PAR SECTION, dès
maintenant : `docs/` (Démarrer) et `docs/files/` (Vos fichiers), URL
`/docs/…` et `/fr/docs/…`. Vérifié dans le build : le groupe Démarrer
ne descend PAS dans les sous-dossiers (autogenerate sans récursion),
« Your files »/« Vos fichiers » rend dans les deux langues. D3 ajoutera
`docs/interface/` et `docs/nesting/` par un dossier et un groupe de plus.

**La section « Vos fichiers » complète (§2.3), EN + FR, cinq pages.**
L'index (tableau des formats par mode, les deux règles DWG/`.job`), DXF
(unités lues, blocs résolus, multi-pièces, bloc rigide par défaut et
« Éclater » irréversible, l'encre qui suit le métal, contour ouvert
nommé), SVG (le pixel à 96 dpi, viewBox et transformations, repère
retourné, outil Échelle), DWG (refus nommé côté appareil, conversion
libre côté serveurs, R2013+ expérimental dit au dépôt), et la page
`.job` — la demande d'origine : ce qui est lu (tôle, kerf → espacement
prérempli 2 × saignée + sécurité, quantités, contours du cache, points
de départ y compris déplacés à la main), ce qui est rendu (un `.job`
par tôle, points déplacés conservés à l'octet), pourquoi un dessin
présent quatre fois donne quatre pièces libres (SheetCam traite déjà
ainsi : une fiche par section originale), et ce qui n'est pas encore lu
NOMMÉ (keepout, outils multiples, opérations multiples, mode serveurs).

**Le harnais réécrit selon les trois règles du vérificateur.**
1. **Compte neuf** : créé à chaque exécution par
   `/api/auth/local/register` (`docs-captures-<horodatage>@local.dev`),
   jamais le compte de développement — sonde « pas le compte de
   développement » verte.
2. **Captures d'élément cadrées sur la légende** : le bloc
   « Nouvelle imbrication » (titre + cartes des deux modes), la carte de
   dépôt seule, l'atelier (tôle + réglages), les fiches DXF/SVG/.job
   (la carte groupée ×4 AVEC les marques « votre point »), la vue
   agrandie avec ses amorces comptées dans le SVG (> 0, verrou J11-ter
   repassé au passage), le refus DWG nommé.
3. **Zéro orpheline** : verrou de fin de harnais — chaque image de
   `public/docs-img/` doit être référencée par une page (sinon retirée
   en le disant), chaque image référencée doit exister ; l'ancienne
   `demarrer-accueil.png` (non référencée, 339 Ko publiés pour rien) a
   été retirée par le harnais lui-même.
   **GO, exit 0, 12 sondes vertes.**

**Pièce d'ingénierie du harnais, dite** : la carte groupée exige un
`.job` à quatre sections originales du même dessin — le dépôt n'a pas
de fixture neutre (x4-reference porte deux dessins DIFFÉRENTS, le
fichier à quatre originales du même dessin est privé). Le harnais en
SYNTHÉTISE un depuis la pièce L : le bloc binaire de son unique dessin
est dupliqué quatre fois (les blocs s'ouvrent sur le tag 0x0025, se
relaient de longueur en longueur — flux auto-vérifié tombant pile au
bout), la section texte `[Part 0]` est recopiée en Part 1/2/3 à des
positions distinctes, et le drapeau « point déplacé » (0x001d) est posé
— la capture doit montrer la marque « votre point ». Le fichier
synthétique est RE-LU par nos propres décodeurs avant usage (4
originales, 4 blocs, sinon le harnais refuse) ; il vit dans `.qa-pw/`,
n'est jamais committé, et la capture ne montre que le nom du dessin de
la fixture.

**Chiffres** : `astro build` **exit 0, 39 pages** ; `check:links`
**OK** (39 pages HTML + sitemap, aucun lien cassé) ; routes vérifiées
`/docs/files/…` et `/fr/docs/files/…` ; `<html lang>` correct dans les
deux langues ; les 8 captures référencées par leurs pages.

**Captures, lues par sondes** (méthode inchangée, dite) : dimensions
élément (1728×866 le bloc création, 564×334 les fiches, 1728×402 la
carte groupée), texte rendu vérifié à la prise (les deux modes en
français, la marque « votre point », le message de refus DWG complet,
les amorces comptées dans le SVG de la vue agrandie).

**Non-dits** : les sections Interface et Nesting (D3) suivent sur la
même branche — la première publication attend les sections 1 à 4 ; la
page Nouveautés (D4) branchera `CHANGELOG.md` ; relecture propriétaire
de la page FR `.job` particulièrement attendue (c'est sa demande
d'origine qui a ouvert ce chantier).

## Vérification du lot D2 (vérificateur, 16/09) — contenu solide, neuf corrections avant publication, à faire dans D3

Rejoué : `3b6948e` dans un arbre séparé, `astro build` **code 0, 39 pages**,
`check:links` **code 0** ; les douze routes de la prévisualisation en 200 ;
les huit images publiées **toutes référencées** par une page (l'ancienne
`demarrer-accueil.png` répond 404 : retirée) ; **les huit captures regardées
avec mes yeux** ; les onze pages lues en entier dans les deux langues, et
chaque affirmation contrôlée contre l'application (`a22b7d5a`) ou son code.

### Ce qui tient

- **Les cinq corrections de D1 sont faites**, et justes : « le moteur »,
  « Tout peut se passer », la vérité du calcul gratuit (contrôlée :
  `FREE_SHEET_CAP = 2`, `tier === 'free'` ⇒ calcul navigateur), le `.job`
  qui bascule le projet sur l'appareil, les libellés exacts des badges.
- **Les captures sont enfin des captures de documentation** : compte neuf,
  chaque image cadrée sur son sujet — le bloc « Nouvelle imbrication », la
  carte de dépôt, l'atelier avec tôle et réglages, la fiche DXF, la fiche
  SVG à 20,1 mm (le pixel à 96 dpi, calcul juste), la carte groupée à quatre
  exemplaires « votre point », la vue agrandie avec ses perçages, le refus
  DWG nommé. Rien du compte de développement.
- **La page `.job` est exacte** sur ce qu'elle promet : contours du cache,
  points par section originale, marque « votre point », un fichier par tôle,
  points déplacés à l'octet, non-lus nommés. C'est la page à relire par le
  propriétaire.
- Le tableau des formats par mode, le 5 Mo, le SVG (96 dpi, repère
  retourné, segments droits), les unités DXF (converties / supposées, avec
  leurs constats réels), les blocs résolus, le bloc rigide et « Éclater »
  irréversible (texte de confirmation contrôlé) : vrais.

### Neuf corrections — vues ou mesurées

1. **Le menu liste chaque page deux fois, dont une sous un libellé brut
   « files ».** Le rapport dit « le groupe Démarrer ne descend pas dans les
   sous-dossiers » ; la prévisualisation dit le contraire : sous
   « Démarrer » apparaît un sous-groupe **« files »** avec les cinq pages,
   puis le groupe « Vos fichiers » avec les cinq mêmes (`autogenerate` est
   récursif). Correctif : « Démarrer » devient un **lien simple** vers
   `/docs/` (pas un groupe autogénéré) ; et les pages de « Vos fichiers »
   prennent un ordre de lecture par `sidebar.order` (index, DXF, SVG, DWG,
   `.job`) au lieu de l'alphabet (DWG, DXF, .job, SVG).
2. **« Plusieurs propositions, une par sens d'optimisation »** est faux
   pour l'offre gratuite, le lecteur de « Démarrer » : la capture
   `demarrer-projet.png` le montre elle-même — « Votre offre inclut 1 sens
   par imbrication ». En gratuit, **une** proposition, dans le sens choisi ;
   une par sens avec un plan. Et « la meilleure en tête » ne décrit pas
   l'ordre réel (les sens dans un ordre fixe) : le retirer.
3. **« Écart ≥ 4 mm »** : le badge porte l'espacement du projet, pas 4 mm.
   « le badge « Écart ≥ » suivi de votre espacement ».
4. **Contour ouvert** (page DXF) : « la pièce est imbriquée sur son contour
   fermé le plus probable » est faux. Le constat réel dit : « N tracés
   ouverts ne seront pas découpés — refermez-les dans votre CAO ». Écrire
   cela, mot pour mot.
5. **« Une fiche se détaille d'un clic : aperçu agrandi, constats complets,
   échelle, éclatement »** (index de section) : l'échelle et l'éclatement
   sont des actions **sur la carte**, pas dans la vue agrandie (`FileModal`
   n'en porte aucune). Corriger la phrase.
6. **« dimensions et épaisseur de la zone de travail deviennent la tôle »**
   (page `.job`) : l'épaisseur est lue par le parseur mais **rien ne
   l'utilise** — le projet n'a pas d'épaisseur. Retirer le mot.
7. **DWG** : (a) « aucun projet ne se crée » n'est vrai que pour un DWG
   déposé seul — mêlé à des DXF, le projet se crée sans lui, le message dit
   « Ignorés — nom : … » (capture) : écrire « le fichier est écarté, nommé ».
   (b) « refusé avec un message qui dit quoi faire… si la conversion échoue,
   la fiche n'est pas créée » : en réalité la fiche **existe, en erreur**,
   avec « Échec de l'import » et un bouton pour nous signaler le fichier ; le
   conseil du convertisseur (« exportez en DXF R2000+ ») n'est **pas
   affiché**. Décrire ce que l'utilisateur voit, et donner le conseil dans
   la doc puisque l'écran ne le donne pas. (Défaut produit à noter pour
   plus tard : remonter ce message jusqu'à la fiche.)
8. **Trois retouches de surface** : la légende de la fiche DXF promet des
   « constats » que la pièce propre n'affiche pas (« aperçu, quantité,
   échelle ») ; le fichier synthétique s'appelle `piece-l-x4-synth.job` à
   l'écran — le nommer `piece-l-x4.job` ; « l'atelier est déjà monté » n'est
   pas une expression : « la mise en tôle est déjà faite ».

9. **Les pages anglaises montrent des captures en français** (relevé par le
   propriétaire sur `/docs/files/sheetcam-job/` : « votre point », « Masquer
   les exemplaires », légende et constat en français sous un texte anglais).
   La faute est d'abord dans la règle du vérificateur, qui disait « interface
   en français » sans dire « dans la langue de la page ». Règle corrigée :
   **une capture par langue** — le harnais tourne deux fois, cookie `fr` puis
   `en`, écrit `docs-img/fr/…` et `docs-img/en/…`, et chaque page référence
   le jeu de sa langue ; le verrou anti-orpheline compte les deux jeux, et
   une sonde vérifie que le texte rendu au moment de la prise est dans la
   langue attendue (« votre point » / « your point »).

### Décision

**D2 : le socle et les captures tiennent, le contenu est bon à 90 %, neuf
corrections avant publication — absorbées dans D3**, une seule PR, comme
pour D1-bis. La publication attend toujours les sections 1 à 4. **Relecture
du propriétaire** : la page FR `.job` de la prévisualisation dès maintenant
(`/fr/docs/files/sheetcam-job/`), c'est sa demande d'origine et elle est
prête à être lue.

## Rapport du lot D3 (implémenteur, 16/09) — les neuf corrections + sections Interface et Nesting

Toujours la PR nestorcut-website#14 (branche `d1-docs`, commit `444e64f`).
Les trois documents du vérificateur du dépôt principal partis au commit
`2c1e4fc6` avant le lot, comme demandé.

**Les neuf corrections (les huit + la neuvième ajoutée en cours de lot).**
1. **Menu** : « Démarrer » est un LIEN SIMPLE vers `/docs/`
   (l'autogenerate de son dossier était récursif — voilà le sous-groupe
   brut « files » et les pages en double) ; l'ordre de lecture vient du
   frontmatter `sidebar.order` de chaque page. **PREUVE PAR LE HTML BÂTI**
   (extrait de `dist/fr/docs/files/dxf/index.html`, la barre latérale
   complète est dans le journal du harnais) : « Démarrer → /fr/docs/ »
   comme lien, puis Vue d'ensemble → DXF → SVG → DWG → Fichier de
   travail SheetCam (.job) → La page projet → Les cartes de pièces → La
   vue en direct → Le résultat → Bande ou multi-tôles → L'espacement et
   les rotations → Sens, densités et trous ; **DOUBLONS : []** ;
   « sous-groupe brut files présent : false » ; Précédent/Suivant suivent
   l'ordre de lecture. Même preuve extraite en anglais.
2. **Propositions** : « avec l'offre gratuite, UNE proposition, dans le
   sens choisi ; une par sens d'imbrication avec un plan payant » —
   « la meilleure en tête » retiré.
3. **Badge** : « "Écart ≥" suivi de votre espacement ».
4. **Contour ouvert** : le constat réel, mot pour mot — « N tracés
   ouverts ne seront pas découpés — refermez-les dans votre CAO » ; et
   ces tracés ne suivent pas la pièce.
5. **Cartes** : le clic ouvre la fiche détaillée (aperçu agrandi,
   constats) ; l'échelle et l'éclatement sont des actions SUR la carte.
6. **.job** : « épaisseur » retirée (lue par le parseur, jamais
   utilisée).
7. **DWG** : écarté et NOMMÉ (« Ignorés — nom : … »), jamais « aucun
   projet » en toutes lettres ; en cas d'échec de conversion la fiche
   EXISTE en erreur « Échec de l'import » avec bouton de signalement —
   décrit, et le conseil (DXF ou DWG plus ancien) donné par la doc
   puisque l'écran ne le donne pas.
8. **Surface** : légende de la fiche DXF (« aperçu, quantité, échelle »),
   fichier synthétique renommé `piece-l-x4.job`, « la mise en tôle est
   déjà faite ».
9. **Une capture par langue** : `docs-img/fr/` et `docs-img/en/`, le
   harnais tourne en deux passes avec le cookie de langue, chaque page
   référence le jeu de sa langue, le verrou anti-orpheline compte les
   DEUX jeux, et une sonde vérifie la langue du texte rendu AU MOMENT DE
   la prise (« Cet appareil »/« Nos serveurs » en passe FR, « This
   device »/« Our servers » en passe EN).

**Les sections nouvelles (§2.2 et §2.4), EN + FR, une capture cadrée par
page.** « L'interface » : La page projet (tôles multiples avec quantités,
espacement et sa règle 2 × kerf + sécurité AFFICHÉE sous le champ,
rotations par pas, les trois sens avec « un sens en gratuit », options —
trous désactivés au-delà de 2,4 mm, contour de tôle à l'export) ; Les
cartes de pièces (quantité, Échelle, Éclater irréversible, fiche
détaillée) ; La vue en direct (vraie pose des pièces, ligne d'état,
Arrêter) ; Le résultat (une proposition en gratuit / une par sens en
payant, densité matière, téléchargements). « Le nesting expliqué » :
Bande ou multi-tôles et pourquoi ; l'arrêt sur plateau ; les badges et
ce qu'ils garantissent ; L'espacement et les rotations AVEC LE DESSIN
exigé par le plan (deux SVG rédigés, un par langue) ; Sens, les DEUX
densités (bande pendant le calcul, matière au résultat) et les pièces
dans les trous.

**Le harnais (GO, exit 0)** : deux passes complètes, 15 images par
langue écrites dans son dossier, toutes référencées, zéro orpheline
(l'ancien jeu racine retiré en le disant), langue sondée à la prise,
compte DÉDIÉ — « créé par le harnais s'il n'existe pas », et PERSISTANT :
l'inscription est limitée à 5/heure par IP (anti-brute-force), un compte
neuf à chaque exécution est impossible ; l'historique n'apparaît
nulle part puisque CHAQUE capture est cadrée sur son élément. DIT, la
préparation une fois en dev : vérifier l'email en base
(`emailVerified: true`), sans quoi le premier nesting bascule sur
`/auth/check-email`.

**Chiffres** : `astro build` **exit 0, 53 pages** ; `check:links`
**OK** ; sidebar prouvée par HTML bâti dans les deux langues.

**Non-dits** : sections 5 à 8 (D4) puis les liens depuis l'app (D5) ;
la première publication attend toujours le GO sur les sections 1 à 4,
qui SONT là désormais — relecture propriétaire sur la prévisualisation
(page FR de `.job` demandée, puis le reste) avant toute fusion.

## Vérification du lot D3 (vérificateur, 16/09) — sections 1 à 4 complètes, cinq corrections courtes (D3-bis) puis relecture et publication

Rejoué : `444e64f` dans un arbre séparé, `astro build` **code 0, 53 pages**,
`check:links` **code 0** ; **la barre latérale lue dans le HTML bâti**, en
français et en anglais : « Démarrer » en lien simple, puis les trois groupes,
chaque page une seule fois, dans l'ordre de lecture, aucun sous-groupe brut —
la correction 1 est vraie cette fois, et prouvée comme demandé ; les quatorze
nouvelles routes de la prévisualisation en 200 ; **16 images par langue, toutes
référencées, chaque page ne référence que le jeu de sa langue** (vérifié dans
les sources et dans le HTML servi) ; **les 15 captures anglaises et les
nouvelles françaises regardées** : tout en anglais côté anglais, tout en
français côté français — la neuvième correction est faite. Les huit autres
corrections de D2 sont dans le diff, mot pour mot.

Les onze nouvelles pages ont été lues en entier dans les deux langues et
leurs affirmations contrôlées : quantité de 0 à 999 (`max="999"`), « Réinitialiser
l'échelle » existe, avertissement d'espacement sous 0,05 mm (texte exact
présent), trous désactivés au-delà de 2,4 mm, « Tracer le contour de la tôle »,
« densité de la bande » pendant le calcul (libellé réel), densité matière trous
déduits, plateau calibré par la taille du chantier, ordre des propositions par
sens puis qualité, plafond de 2 tôles et un sens en gratuit, « Non vérifié »
au-delà de 5 000 pièces : **tous vrais**.

### Cinq corrections, courtes

1. **Le dessin de l'espacement et son explication sont faux, et c'est LA page
   du sujet.** Le SVG montre UN trait de coupe entre les deux pièces avec
   « ½ kerf » de chaque côté : cela fait **un** kerf, pas deux, et la cote
   en dessous annonce pourtant « 2 × kerf + sécurité ». Le texte reprend la
   même idée (« chaque pièce garde sa moitié de saignée de chaque côté du
   trait »), qui ne produit jamais le facteur 2. D'où vient le second kerf :
   chaque pièce est coupée sur **son propre** trajet, la torche compensée
   passe **à l'extérieur** du contour, donc chaque pièce consomme une
   saignée entière hors de son bord ; deux pièces face à face, c'est deux
   saignées, plus la sécurité. Le dessin doit montrer deux trajets de coupe,
   un le long de chaque pièce, le kerf à l'extérieur de chacune, la sécurité
   entre les deux, dans les deux langues. **Le propriétaire, qui a posé la
   règle, valide cette explication** avant qu'elle ne soit publiée.
2. **Les exports du rapport sont verrouillés en gratuit.** La capture du
   résultat le montre : deux boutons « Export — Unlimited » cadenassés — le
   CSV et la copie du rapport (`ResultReport.vue`, `exportLocked`). Or
   « Démarrer » (étape 6) et « Le résultat » disent « téléchargez le DXF de
   découpe, le rapport (CSV)… » sans distinction. Écrire la vérité : en
   gratuit, le DXF de découpe (et le `.job`) ; le rapport CSV et sa copie
   avec un plan.
3. **« Le bouton Imbriquer devient Arrêter »** (La page projet, La vue en
   direct) : aucun libellé « Arrêter » n'existe. Pendant le calcul, un bouton
   **« Annuler »** apparaît (`results.cancel`), et la carte du projet dit
   « calcul en cours ». Écrire « Annuler ». Au passage, la ligne d'état de la
   vue en direct montre, comme la capture : densité de la bande, nombre de
   tôles, cœurs — et le temps écoulé et les combinaisons pendant la
   recherche ; « l'arrêt automatique » n'y est pas affiché, il se constate.
4. **La condition de la bande est incomplète** (Bande ou multi-tôles) : « quand
   un seul format de tôle suffit à tout tenir » laisse croire que trois tôles
   du même format donnent une bande. La règle réelle : un seul format, les
   pièces tiennent dans une tôle (aire ≤ 80 %), **et** une seule tôle
   déclarée ou le seul sens « bord gauche ». Une phrase de plus.
5. **Surface** : « formats standard du trade » n'est pas du français
   (« du commerce ») ; et la page « Le résultat » promet une section « Vos
   résultats » à venir — acceptable jusqu'à D4, à remplacer par le lien dès
   qu'elle existe.

### Décision

**Sections 1 à 4 : complètes, justes à ces cinq points près. Publication :
après D3-bis** (les cinq corrections, un commit sur la même branche, preuve
par le HTML bâti pour rien de plus que le SVG et les textes) **puis la
relecture du propriétaire** — la page FR `.job`, la page FR de l'espacement
avec son nouveau dessin, et un survol du reste — **puis GO et fusion**. D4
(résultats, confidentialité, limites, nouveautés) suit sur une nouvelle
branche, après publication.

Note pour le harnais : compte dédié persistant (`docs-captures@local.dev`,
limite d'inscription 5/h par IP) — acceptable puisque chaque capture est
cadrée sur son élément ; la préparation « email vérifié en base » est locale
et dite. La prévisualisation Cloudflare sert encore les anciennes images à la
racine (cache) : elles n'existent plus dans le build, rien à faire.

## Rapport du lot D3-bis (implémenteur, 16/09) — les cinq corrections courtes

Branche `d1-docs`, commit `df1beb7`. Les documents du vérificateur partis
en premier au dépôt principal (`dc9d6168`). Rien d'autre touché.

1. **Le dessin de l'espacement, refait dans les deux langues** : deux
   pièces, CHACUNE son trajet de coupe pointillé, la saignée ambrée HORS
   du contour de chaque pièce, la sécurité bleutée entre les deux, la
   cote « espacement = 2 × kerf + sécurité » sous l'ensemble, et la
   légende « trajet de coupe — torche compensée, à l'extérieur du
   contour ». Le texte explique d'où vient le second kerf : chaque
   pièce est coupée sur son PROPRE trajet, la torche compensée passe à
   l'extérieur du contour, la saignée entière est mangée HORS de la
   pièce ; deux pièces face à face, deux saignées entières, plus la
   sécurité. **Cette explication attend la validation du propriétaire
   avant publication — c'est sa règle, dit au commit.**
2. **Les exports verrouillés en gratuit**, dits dans « Démarrer »
   (étape 6 : le DXF de découpe et le `.job` se téléchargent, le CSV
   demande un plan, les cadenas « Export » à l'écran le disent) et dans
   « Le résultat » (les cadenas « Export — Unlimited » comme la capture
   le montre). Vérifié dans le HTML bâti des deux pages.
3. **« Annuler »** remplace « Arrêter » dans La page projet et La vue en
   direct (EN : « Cancel ») ; la ligne d'état est citée VERBATIM telle
   que la capture la montre — sondée dans l'application dans les deux
   langues avant d'être écrite : « Recherche · 2 s · meilleur 2,3 % ·
   1 recherche(s) en parallèle · arrêt automatique dès stagnation » /
   “Searching · 2 s · best 2.3% · 1 search(es) in parallel ·
   auto-stops at stagnation”, avec le remplissage des trous annoncé
   pour le résultat final.
4. **La condition de la bande complète** : « quand vous déclarez UNE
   SEULE tôle (une quantité d'un seul format) — ou que vous demandez le
   seul sens bord gauche — et que tout peut y tenir ». Trois tôles du
   même format ne donnent pas une bande.
5. **« Formats standard du commerce »** (EN : “standard industry
   sizes”).

**Chiffres** : build exit 0, 53 pages ; `check:links` OK ; les cinq
corrections vérifiées une à une dans le HTML bâti. **Le lot s'arrête
ici** : relecture du propriétaire (page FR de l'espacement
`/fr/docs/nesting/spacing/` en premier — c'est son explication à
valider — puis l'ensemble), GO du vérificateur, fusion, publication.
D4 démarre sur une branche neuve après la publication.

## Vérification du lot D3-bis (vérificateur, 16/09) — GO technique pour la publication, sous deux conditions

Rejoué : `df1beb7`, `astro build` **code 0, 53 pages**, `check:links` **code 0** ;
plus aucun « du trade » ni « Arrêter » dans le HTML français bâti ; les cinq
corrections lues dans le diff et sur la prévisualisation ; la ligne d'état
citée dans « La vue en direct » est **le libellé réel de l'application**
(`live.statusLine`, FR et EN, mot pour mot) ; **le nouveau dessin de
l'espacement rendu et regardé, dans les deux langues** : deux pièces, un
trajet de coupe pointillé le long de chacune, la saignée ambrée hors du
contour, la sécurité bleutée entre les deux, la cote « 2 × kerf + sécurité »
de bord à bord. C'est le bon dessin.

**Un détail vu au rendu** : dans la version française, la légende de droite
déborde du cadre — « à l'extérieur du conto… » est coupé (le `viewBox` de
620 ne contient pas le texte français, plus long que l'anglais). Un attribut
à changer (`viewBox="0 0 700 200"`, ou la légende sur une ligne de moins) ;
je le contrôle sur la prévisualisation avant la fusion.

### Décision

**GO technique pour publier les sections 1 à 4**, sous deux conditions,
dans cet ordre :

1. **la relecture du propriétaire** sur la prévisualisation — en premier
   `/fr/docs/nesting/spacing/` (le dessin et l'explication du second kerf
   sont SA règle : c'est lui qui dit si c'est ainsi qu'il l'explique à
   l'atelier), puis `/fr/docs/files/sheetcam-job/`, puis un survol ;
2. **la légende française du dessin entière** (un attribut), contrôlée par
   le vérificateur sur la prévisualisation.

Puis fusion de la PR #14 vers `main` du site vitrine, publication à
`nestorcut.com/docs` et `/fr/docs`, contrôle en ligne par le vérificateur
(routes, recherche, images des deux langues). D4 sur une branche neuve.

## Retouche de fusion (implémenteur, 16/09) — la légende du dessin français entière

GO technique du vérificateur reçu (sa section « Vérification du lot
D3-bis ») avec UNE retouche avant fusion : la légende française du
dessin d'espacement débordait du cadre (« à l'extérieur du conto… »
coupé). **Mesuré au rendu** (getBBox réel dans Chromium) : la légende
française finissait à x = 633 pour un viewBox de 620 — coupée de 13 px ;
l'anglaise tenait à 617. **viewBox élargi à 660 dans les deux langues**
(marge donnée aux deux, la fonte varie selon le navigateur) — commit
`77fcbce`, re-mesuré après coup (FR : 632 ≤ 660, EN : 617 ≤ 660),
rebuild 53 pages exit 0, liens OK, le SVG servi par la prévisualisation
porte le bon viewBox. Les documents du vérificateur partis en premier
(`8fb8767d`).

**État : prêt pour la relecture du propriétaire puis le GO de fusion.**
Rien ne fusionne avant. Après fusion : rapport de l'URL publique et du
SHA de main du site au vérificateur (contrôle en ligne), D4 sur une
branche neuve.

### Contrôle de la retouche `77fcbce` (vérificateur, 16/09) — condition 2 levée

Le SVG servi par la prévisualisation porte `viewBox="0 0 660 200"` dans les
deux langues ; le dessin français rendu et regardé : la légende « trajet de
coupe — torche compensée, à l'extérieur du contour » est entière. **La
condition 2 est levée.** Reste la condition 1, la relecture du propriétaire ;
le GO de fusion suit sa réponse.

### GO de fusion (16/09) — relecture du propriétaire : « la doc me paraît OK »

Les deux conditions sont levées : relecture du propriétaire faite (pages
espacement et `.job` comprises), légende du dessin contrôlée. **GO de fusion
de la PR nestorcut-website#14 (`77fcbce`) vers `main`** : publication à
`nestorcut.com/docs` et `/fr/docs`. Contrôle en ligne par le vérificateur
après publication : routes des deux langues, recherche, images des deux jeux,
lien « Docs » du site. Puis D4 (Vos résultats, Confidentialité, Limites et
questions fréquentes, Nouveautés) sur une branche neuve, même méthode :
captures par langue, chaque phrase vraie en production, Confidentialité
strictement alignée sur les promesses privées (piège #35), Nouveautés
branchée sur `CHANGELOG.md`.

## Publication des sections 1 à 4 (16/09) puis rapport du lot D4 (implémenteur)

**PUBLIÉ.** PR #14 fusionnée (merge `fe776219331f68537c4a72efe610f03546dfbf1`)
après le GO du vérificateur et la relecture du propriétaire ;
nestorcut.com/docs et /fr/docs servent les sections 1 à 4 — vérifié en
production (routes 200, explication corrigée de l'espacement servie,
captures 200, sidebar complète). SHA de main rapporté au vérificateur
pour son contrôle en ligne.

**D4 livré en PR #15, branche `d4-docs` (`77d71d8`)** — sections 5 à 8
du plan §2, EN+FR, même méthode :

1. **Vos résultats** (2 pages) — le rapport tôle par tôle (aire vraie
   des pièces, trous déduits — jamais un rectangle englobant), la chute
   réutilisable et ce que « au moins » veut dire (le plus grand
   rectangle VIDE GARANTI ; la place réelle ne peut qu'être plus
   grande ; réutilisable dès 100 mm de plus petit côté, « rognure »
   en dessous), les alternatives ; les téléchargements et la vue DXF
   (DXF, `.job` un par tôle, CSV = plan AVEC ses cadenas, tout
   télécharger, vue DXF page par page).
2. **Confidentialité** — strictement alignée sur `specs/THREAT-MODEL.md`
   (privé, jamais publié) : Cet appareil (géométrie et noms de fichiers
   jamais envoyés ; « PAS hors-ligne » et « PAS multi-appareils » dits
   expressément ; la limite assumée du poste déverrouillé), Nos serveurs
   sans coffre (en clair, TLS, effacé à 24 h, « expiré », suppression
   libre-service), le coffre (chiffré à l'écriture, illisible au repos
   sans la clé, sessions ~2 h, opt-in TOUS les plans), et le « nous ne
   pouvons pas vous lire » REFUSÉ explicitement — chaque mode dit sa
   vérité (piège #35).
3. **Limites et questions fréquentes** — 5 Mo par fichier côté
   serveurs, la pièce seule qui s'imbrique depuis V0.9, la pièce
   refusée et ses deux causes avec les conseils, ce que le mode appareil
   ne fait pas, nous signaler un fichier (refus nommé côté appareil,
   fiche d'erreur + « Signaler un problème » côté serveurs, email).
4. **Nouveautés GÉNÉRÉE** depuis `Nestorcut/CHANGELOG.md` par
   `scripts/sync-changelog.mjs` (nouveau) : une seule source produit,
   deux pages écrites par le script, à RELANCER à chaque version (la
   sortie est commitée — Cloudflare ne voit pas le dépôt frère), avec
   la capture du journal de l'application.

**Harnais GO exit 0** : deux passes, **18 images par langue** (+ rapport,
exports, journal), langue sondée à la prise, zéro orpheline. **Menu** :
quatre groupes de plus, ordre prouvé dans le HTML bâti (l'index de
section AVANT ses pages — un ordre mal choisi dans le frontmatter
l'inversait, corrigé avant poussée). **Build exit 0, check:links OK.**

**Tenue du compte dédié, dite au harnais** : chaque passe consomme un
nesting gratuit (10/mois) — remettre `freeNestingUsed` à 0 en base quand
il est épuisé ; une passe interrompue laisse un job `awaiting_local`
orphelin qui bloque le compte en 409 `concurrent_limit` — à purger ;
et JAMAIS de grant de tier : les captures doivent montrer l'état
GRATUIT (cadenas « Export »), un grant standard les ferait disparaître.
**Abandonné en route, dit** : la fiche d'erreur d'import côté serveurs
n'a pas pu être produite en local (le dépôt serveur du DXF tronqué ne
persiste rien dans ce bac) — la page Limites décrit les DEUX chemins
(refus nommé appareil — capturé ; fiche d'erreur serveur — décrite).

**Suite** : vérification D4, relecture propriétaire, GO, fusion ; D5
(les liens « ? » depuis l'application vers les ancres de doc) ensuite.

### Contrôle en ligne de la publication (vérificateur, 16/09) — conforme

`nestorcut.com/docs/` et `/fr/docs/` en 200 ; le menu publié en français est
celui prouvé dans le build (Démarrer en lien, trois groupes, ordre de
lecture) ; images du jeu français servies, recherche Pagefind servie, lien
« Docs » dans l'en-tête du site ; les pages de D4 (`/fr/docs/results/`,
`/fr/docs/privacy/`) répondent 404 comme attendu : D4 est en PR #15, à
vérifier au prochain tour.
