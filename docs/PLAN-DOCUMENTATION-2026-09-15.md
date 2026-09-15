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
