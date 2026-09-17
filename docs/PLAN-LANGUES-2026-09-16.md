# Plan — quatre langues de plus : portugais, italien, allemand, espagnol (16/09)

Décision du propriétaire (16/09) : ajouter **l'italien, l'allemand, le
portugais et l'espagnol** ; le polonais est écarté. Les mesures qui ont nourri
la discussion : inscrits par pays (France 18, Inde 9, États-Unis 8, puis
Pologne, Turquie, Égypte, Azerbaïdjan, Brésil à 4), Search Console (Brésil
4 clics / 10 apparitions, Italie 3 / 52, Espagne 2 / 47, Allemagne 1 / 51),
sessions (Brésil 54 % d'engagement, Allemagne 0 %). Le Brésil converge
partout ; Italie, Allemagne et Espagne ont la visibilité Google sans la
conversion — la langue est le levier de conversion, pas de visibilité.

## 1. Règles, fixées d'avance

- **Une langue se livre complète ou pas du tout** : application, site
  vitrine, documentation, captures de la documentation dans la langue —
  le même jour. Une langue à moitié (interface traduite, doc anglaise,
  captures françaises) est le défaut relevé par le propriétaire le 16/09.
- **Le vocabulaire d'atelier d'abord.** Avant la première chaîne, un
  glossaire de ~30 termes par langue (tôle, saignée/kerf, amorce, perçage,
  chute, imbrication, bloc rigide, éclater, sens d'optimisation, bande,
  densité matière…) validé par un locuteur natif du métier — un traducteur
  généraliste écrit « machine d'essorage ». Le glossaire vit dans
  `specs/i18n/glossaire-<langue>.md` (privé) et l'implémenteur s'y tient.
  **Amorce des glossaires (vérificateur, 16/09)**, à compléter avant L1 :

  | FR | pt-BR | it | de | es |
  |---|---|---|---|---|
  | tôle | chapa | lamiera | Blech (Blechtafel) | chapa |
  | saignée (kerf) | largura de corte (kerf) | larghezza di taglio (kerf) | Schnittspalt (Kerf) | sangría de corte (kerf) |
  | amorce d'entrée / de sortie | entrada / saída de corte (lead-in/out) | attacco / uscita di taglio (lead-in/out) | Anschnitt / Ausfahrt (Lead-in/out) | entrada / salida de corte (lead-in/out) |
  | point de perçage | ponto de perfuração | punto di sfondamento | Einstichpunkt | punto de perforación |
  | imbrication / nesting | nesting (aninhamento) | nesting | Nesting (Verschachtelung) | anidado (nesting) |
  | chute réutilisable | retalho aproveitável | ritaglio riutilizzabile | Restblech (nutzbar) | retal aprovechable (Espagne) / retazo (Am. latine) |
  | espacement entre pièces | espaçamento entre peças | distanza tra i pezzi | Teileabstand | separación entre piezas |
  | éclater (en pièces) | separar em peças | separa in pezzi | in Einzelteile zerlegen | separar en piezas |
  | bloc rigide | bloco rígido | blocco rigido | starrer Block | bloque rígido |
  | densité matière | aproveitamento de material | utilizzo del materiale | Materialausnutzung | aprovechamiento de material |
  | sens d'optimisation (bord gauche…) | direção de otimização (borda esquerda…) | direzione di ottimizzazione (bordo sinistro…) | Optimierungsrichtung (linke Kante…) | dirección de optimización (borde izquierdo…) |

  Termes gardés tels quels partout : DXF, SVG, DWG, SheetCam, `.job`,
  kerf entre parenthèses la première fois.
- **L'implémenteur rédige, le vérificateur relit la langue** (décision du
  propriétaire, 16/09 : « je compte sur toi pour le double check sur les
  langues »). La relecture du vérificateur couvre **100 % des chaînes de
  l'application, 100 % des pages de la documentation et du site, et les
  captures** : conformité au glossaire, faux amis et calques de l'anglais ou
  du français, registre d'atelier (tutoiement/vouvoiement cohérent, verbes
  du métier), pluriels et variables (`{n}`), longueurs qui cassent l'écran,
  formats de nombres. Elle est écrite constat par constat dans le rapport
  de vérification, avec la correction proposée. Un relecteur natif du métier
  reste un plus si le propriétaire en trouve un (surtout pour l'argot
  régional : `retal` en Espagne, `retazo` en Amérique latine) ; il n'est
  plus une condition de publication. Ce que le vérificateur ne garantit
  pas : l'idiome d'un atelier précis d'une région précise — c'est dit dans
  chaque rapport.
- **Ordre de livraison** : portugais du Brésil (la seule langue qui a déjà
  fait ses preuves dans les chiffres), puis italien, allemand, espagnol.
  Le propriétaire peut changer l'ordre ; il ne change pas la règle « complète
  ou rien ».
- **Le blog est DANS le lot (décision du propriétaire, 17/09 : « je pense
  surtout au SEO, il me faut ces articles dans toutes les langues »).** Le
  blog compte huit articles en deux langues (seize fichiers, appariés par
  `translationSlug`). Règles pour que la traduction serve le référencement
  au lieu de le pénaliser :
  - **hreflang à six** : le gabarit du blog (`Base.astro`) ne déclare
    aujourd'hui que deux alternatives (`en`, `fr`) ; il doit déclarer toutes
    les langues où l'article existe, plus `x-default`, sinon Google voit des
    doublons. C'est un préalable du jalon B.
  - **Traduit, pas dupliqué** : chaque article garde ses faits (dates, chiffres,
    liens) et sa structure, mais titre, description et texte sont écrits dans
    la langue ; les mots-clés de titre suivent ce que le marché cherche
    (« software de nesting gratuito », « alternativa ao Deepnest ») — le
    vérificateur relit chaque article comme les chaînes.
  - **L'article de comparaison (Deepnest) et l'article de prix** sont les
    deux qui apportent le trafic : traduits en premier.
  - **Pas de contenu automatique publié tel quel** : un article traduit
    porte la même date de publication que l'original et la mention « traduit
    de l'anglais » en pied ; un article machine non relu est le genre de page
    que Google déclasse depuis 2024.
  - **Le billet d'accueil** « NestorCut fala português » est écrit en plus,
    pour la langue, à la publication.
  Le blog entre au **jalon B** (site vitrine), pas au jalon A : huit
  articles par langue, relus, avec les mêmes trois règles.
- **Ce qui reste en français et anglais** : mentions légales, CGV,
  politique de confidentialité, factures (APlasma, cadre légal français —
  une traduction ferait foi sans pouvoir être relue) ; les e-mails
  transactionnels tant que le propriétaire ne décide pas le contraire.

## 2. Le socle technique (un lot avant la première langue) — lot L0

Aujourd'hui l'application connaît deux langues dans un dictionnaire plat
(`app/utils/i18n.js`, EN + FR, ~800 clés), un cookie `locale` honoré au
rendu serveur (J11-bis), un commutateur EN/FR dans l'en-tête ; le site
vitrine a `src/i18n/ui.ts` (EN + FR) et un routage manuel `/`, `/fr/` ; la
documentation Starlight a `root` (EN) et `fr`. Quatre langues de plus dans
ce moule, c'est 3 200 lignes de plus dans un fichier et un commutateur à
six positions. Le socle :

1. **Un fichier par langue** (`app/utils/i18n/<code>.js`), l'anglais comme
   référence, chargement par la locale ; `useLocale` accepte la liste des
   codes au lieu de `'en' | 'fr'` ; le commutateur devient un menu.
2. **Verrou de parité** (`vitest`) : chaque clé de l'anglais existe dans
   chaque langue livrée ; aucune valeur vide ; aucune valeur strictement
   égale à l'anglais hors liste blanche (noms propres, « DXF », « SVG »…).
   Une langue déclarée incomplète ne peut pas apparaître dans le menu.
3. **Nombres, dates, unités** : formatage par `Intl` avec la locale (les
   quatre langues écrivent la virgule décimale ; le portugais du Brésil
   sépare les milliers par un point) — vérifier `app/utils/units.js` et
   les rapports (`report.text.*`).
4. **Rendu serveur** : la détection `Accept-Language` pour un visiteur sans
   cookie, parmi les langues livrées, repli anglais ; le cookie prime.
5. **Site vitrine** : `ui.ts` par langue, routage `/pt/`, `/it/`, `/de/`,
   `/es/`, balises `hreflang`, sitemap ; **documentation** : une locale
   Starlight par langue, et le harnais `scripts/qa-docs-captures.mjs` prend
   la liste des langues (il sait déjà tourner par passe).
6. **Verrou de complétude par langue** (harnais) : toutes les pages de la
   doc existent dans la langue, toutes les images de la langue existent et
   sont référencées, `<html lang>` juste, commutateur de langue complet.

## 3. Les lots par langue — L1 portugais (pt-BR), L2 italien, L3 allemand, L4 espagnol

Chaque lot, dans cet ordre :

1. glossaire validé par le relecteur natif ;
2. application (dictionnaire complet, verrou de parité vert, captures du
   flux `.job` regardées dans la langue) ;
3. site vitrine (accueil, tarifs, FAQ, en-tête, pied) **et le blog** (huit
   articles, comparaison et prix d'abord, hreflang à six langues) ;
4. documentation (toutes les sections publiées à ce moment-là, captures
   par le harnais dans la langue) ;
5. relecture native de bout en bout si un relecteur existe, corrections ;
6. vérification : **relecture linguistique complète par le vérificateur**
   (chaînes, pages, captures — constat par constat), parité, complétude,
   rendu serveur dans la langue, formats de nombres ; GO, publication
   **app + site + doc ensemble**, entrée CHANGELOG « NestorCut parle
   portugais ».

Estimation honnête : L0 est un lot d'application ; chaque langue est
ensuite un lot de rédaction dont la durée dépend surtout du relecteur.

## 4. Séquencement avec les chantiers ouverts

- **D4 (Vos résultats, Confidentialité, Limites, Nouveautés) se termine
  d'abord** : traduire une documentation à moitié écrite, c'est la traduire
  deux fois. D5 (liens « ? » depuis l'application) doit résoudre la langue
  de l'utilisateur vers la page de doc, avec repli anglais quand la langue
  n'a pas encore sa doc — à écrire avec les six codes en tête.
- **L0 peut commencer en parallèle de D4** (périmètre application, aucun
  chevauchement de fichiers avec la doc).
- **L1 portugais dès D4 publié et L0 vérifié.** Les trois autres suivent,
  une à la fois, chacune complète.
- Le gel des nouveautés de calcul n'est pas concerné : aucun moteur, aucun
  worker.

## 5. Ce que le vérificateur contrôlera à chaque langue

Parité des clés (verrou vert, code de sortie 0), aucune chaîne anglaise
résiduelle à l'écran sur le flux `.job` complet (dépôt → carte → vue
agrandie → calcul → résultat → téléchargement), rendu serveur dans la langue
(`curl` avec cookie et avec `Accept-Language`), formats de nombres, site
vitrine et doc complets dans la langue, captures de la doc regardées, et le
mot du relecteur natif joint au rapport.

## Rapport du lot L0 — le socle technique de l'application (implémenteur, 16/09)

Préparé en parallèle de D4 sans toucher aux fichiers de la documentation,
comme demandé. Aucune langue traduite : le socle porte EN + FR, prêt
pour les suivantes.

1. **Un fichier par langue** : l'ancien `app/utils/i18n.js` monolithique
   (1 790 lignes) est découpé en `app/utils/i18n/en.js` et `fr.js`
   (extraction par comptage d'accolades, CRLF préservé) autour d'un
   REGISTRE `app/utils/i18n/index.js` : `DICTS` (ajout d'une langue =
   un fichier + une ligne), `LOCALES` DÉRIVÉ (jamais saisi à la main),
   `LANGUAGE_LABELS` (le nom de chaque langue DANS SA LANGUE), et la
   balise `Intl` par code — une langue nouvelle hérite de sa virgule
   décimale en ajoutant une ligne. Les consommateurs n'ont rien vu :
   l'API (`translate`, `formatNumber`…) est inchangée.
2. **Le verrou de parité** (`app/tests/i18nParity.test.js`, 5 verrous) :
   chaque clé de l'anglais existe dans chaque langue livrée (et
   réciproquement — une clé orpheline est une clé morte), aucune valeur
   vide, aucune valeur strictement égale à l'anglais HORS liste blanche
   documentée (sigles, noms propres, empruns communs — Support,
   Rotations, Total… — et les noms de TIERS, marques produit selon
   `docs/STRATEGY.md` : Free/Unlimited/Pro/Standard), le repli de
   traduction rend l'anglais jamais une clé brute. **Mesuré au passage :
   EN 728 clés, FR 722 lignes-de-valeurs — parité PARFAITE des clés**
   (l'écart de lignes venait de valeurs multi-lignes, aucune clé
   manquante). Plus le verrou des formats : `1,5` FR / `1.5` EN,
   pourcents avec l'espace insécable française.
3. **La détection du premier passage lit Accept-Language, côté
   serveur** (l'ancien appel client `/api/locale` par pays Cloudflare
   est retiré — la langue du navigateur dit mieux la langue que
   l'adresse IP, et le premier rendu est juste même sans JavaScript).
   Vérifié sur l'image reconstruite : sans cookie + `Accept-Language:
   fr` ⇒ français ; `pt-BR` (non livrée) ⇒ repli anglais ; le cookie
   prime toujours ; rien ⇒ anglais. Côté client on ne re-détecte PAS à
   l'hydratation — l'état servi est hydraté tel quel (rouvrir le
   re-détecterait, c'est le mismatch d'hydratation que R9 avait fermé).
4. **Le menu de langues** : le commutateur segmenté EN|FR devient un
   MENU déroulant — chaque langue porte son nom dans sa langue
   (English, Français…), coche sur la courante, fermeture au clic
   extérieur et à Échap, `aria-haspopup`/`listbox`. Vérifié au
   navigateur : ouverture, choix, bascule, cookie écrit. La liste vient
   du registre : une langue nouvelle y apparaît avec son dictionnaire —
   et le verrou de parité doit être VERT avant qu'elle existe (le lot
   d'une langue incomplète ne passe pas la CI).

**Chiffres** : vitest **801/801, exit 0** (796 + les 5 verrous de
parité) ; les quatre tests qui lisaient l'ANCIEN fichier source par
chemin (textes figés J8-e) adaptés aux fichiers par langue ; image app
reconstruite, sonde du menu au navigateur.

**Non-dits** : le socle SITE VITRINE (ui.ts par langue, routage /pt/…,
hreflang, sitemap) et DOC (locale Starlight par langue, harnais par
liste de langues) se livrent avec L1 — la première langue, quand D4
est publiée et le glossaire validé par le relecteur natif.

## Vérification du lot L0 (vérificateur, 16/09) — GO, avec un L0-bis de trois lignes avant L1

Rejoué sur l'image `app` reconstruite à `0330795b` : `npx vitest run`
**801 passés, code de sortie 0** (les cinq verrous de parité compris) ;
**comparaison valeur par valeur** de l'ancien `i18n.js` (via son `translate`)
et des nouveaux `en.js` / `fr.js` : **1 492 valeurs identiques, 0 différence,
744 clés anciennes, 0 perdue** — le découpage est sans perte ; rendu serveur
aux six cas (`curl` sur `/auth/local`) : rien ⇒ anglais, `Accept-Language:
fr` ⇒ français, `pt-BR` ⇒ anglais (non livrée), `pt-BR, fr;q=0.5` ⇒ français
(l'ordre de préférence est honoré), cookie `en` + `Accept-Language: fr` ⇒
anglais (le cookie prime), cookie `fr` ⇒ français ; **le menu de langues
sondé et regardé** dans les deux langues : noms natifs, coche sur la
courante, Échap le ferme, le choix bascule la page et écrit le cookie, le
rechargement garde le choix ; le harnais du flux `.job` français
(`qa-job-leadview.mjs`) **12/12, GO**. Le verrou de parité est bien écrit :
clés dans les deux sens, valeurs vides, copies de l'anglais hors liste
blanche, repli sans clé brute.

### Trois résidus — lot L0-bis, avant L1

1. **`<html lang>` ne suit pas la langue.** Il est figé à `fr` dans
   `nuxt.config.js` : dans le navigateur, `document.documentElement.lang`
   vaut `fr` sur une page entièrement anglaise (mesuré dans les deux
   contextes). Antérieur à L0, mais c'est le socle des langues qui doit le
   porter : l'attribut suit la locale (`useHead` réactif dans `app.vue`),
   d'autant que Google lit cet attribut sur les pages publiques.
2. **`server/api/locale.get.js` est mort** (plus aucun appelant) : le retirer.
3. **Le salut de `/home` calcule l'heure côté serveur en UTC**
   (`home.vue:105`, `new Date().getHours()`) : à midi à Paris le serveur dit
   « Good morning » et le client « Good afternoon » — « Hydration completed
   but contains mismatches » mesuré en contexte anglais, silencieux en
   français parce que « Bonjour » couvre les deux. Antérieur, nommé trois
   fois : le salut se calcule après montage (client seul) — deux lignes.

### Décision

**GO L0.** L0-bis est un lot de quelques lignes, à livrer avant L1 ; L0 +
L0-bis se déploient ensemble, app seule, avec une entrée de changelog
(« la langue de votre navigateur est reconnue au premier passage ; un menu
de langues remplace le bouton »). Rien d'autre ne change : L1 portugais
attend D4 publié, le glossaire validé et un relecteur natif.

## Rapport du lot L0-bis (implémenteur, 16/09) — les trois lignes

Les trois résidus de la vérification L0, rien d'autre :

1. **La langue du document suit la locale, réactivement** : l'attribut
   figé « fr » de `nuxt.config.js` (antérieur à L0, mais c'est le socle
   qui le porte) devient le repli sans JS à `en` (= DEFAULT_LOCALE),
   et `app.vue` rend `useHead({ htmlAttrs: { lang: locale } })` avec le
   ref calculé — **vérifié sur l'image reconstruite** : cookie `en` ⇒
   `<html lang="en">`, cookie `fr` ⇒ `fr`, `Accept-Language: fr` sans
   cookie ⇒ `fr`, et la bascule au menu change l'attribut SANS
   rechargement (sondé au navigateur).
2. **Le point d'entrée de détection par pays est retiré** :
   `server/api/api/locale.get.js` supprimé — plus aucun appelant
   (l'unique mention restante est le commentaire historique de
   `useLocale`, qui dit précisément sa retraite). `/api/locale`
   répond 404 sur l'image reconstruite.
3. **Le salut de l'accueil se calcule après montage, côté client** :
   plus de `new Date()` au rendu serveur (UTC) — une ref posée dans
   `onMounted`, le rendu serveur et la première passe client montrent
   le nom seul (zéro mismatch d'hydratation), l'heure locale arrive au
   montage. Sondé en `Europe/Paris` : « Bon après-midi » à 14 h locale.

**Entrée de changelog** : `V0.9.1` (FR + EN) — la langue du navigateur
reconnue au premier passage, le menu de langues à la place du bouton ;
`package.json` porté à `0.9.1` (l'en-tête garde V0.9, le pied dit
V0.9.1). Le verrou du parseur s'ajuste : une entrée de CORRECTIF peut
n'avoir qu'une puce — la taille pleine (≥ 4) reste exigée d'au moins
une version. **Vitest 801/801, exit 0.** L0 et L0-bis se déploient
ensemble, app seule, whatsNew daté au déploiement (leçon J11-bis).

## Vérification du lot L0-bis (vérificateur, 16/09) — GO, déploiement L0 + L0-bis autorisé

Rejoué sur l'image `app` reconstruite à `c7737bc1` : vitest **801, code 0** ;
`<html lang>` servi : rien ⇒ `en`, cookie `en` ⇒ `en`, cookie `fr` ⇒ `fr`,
`Accept-Language: fr` ⇒ `fr` ; `/api/locale` ⇒ **404** ; `/home` en anglais
et en français : **aucun avertissement d'hydratation**, salut « Good
afternoon » / « Bon après-midi » à l'heure locale, attribut de langue juste
dans le navigateur, pied de page **V0.9.1** ; page Nouveautés : « Version
actuelle : V0.9.1 », entrée « menu de langues » rendue.

**Déploiement** : app seule, `promote-latest` sur le SHA du commit de
promotion, dates de `whatsNew.js` à la date du déploiement dans ce commit,
`pull app` + `up -d app`, contrôle habituel. **Et une étape nouvelle, à
inscrire dans la checklist de déploiement (`AGENTS.md` §6)** : après chaque
promotion de l'application, relancer `scripts/sync-changelog.mjs` dans le
dépôt du site et committer la page Nouveautés régénérée — sinon
`nestorcut.com/docs/whats-new` reste à la version précédente (elle est
générée à la main, Cloudflare ne voit pas le dépôt de l'application).
Amélioration à envisager plus tard : le build du site lit `CHANGELOG.md`
depuis GitHub au lieu du dépôt frère.

## Validation des glossaires (vérificateur, 16/09) — le double check linguistique

Les quatre fichiers `specs/i18n/glossaire-*.md` lus en entier. La base est
bonne ; corrections à appliquer avant la première chaîne :

**Décisions sur les deux points ouverts**

- **« retal » / « retazo »** : ni l'un ni l'autre dans l'interface.
  **« sobrante aprovechable »**, compris en Espagne comme en Amérique
  latine ; « retal » cité entre parenthèses à la première occurrence dans
  la documentation. Le badge court : « aprovechable ».
- **« rognure »** : le mot n'existe pas dans l'application. Le libellé réel
  d'une chute de moins de 100 mm est **« ferraille »** (`report.offcut.scrap`,
  EN « scrap »). La ligne 18 des quatre glossaires devient « ferraille
  (chute < 100 mm) » : pt-BR **sucata**, it **sfrido**, de **Schrott**,
  es **chatarra**.

**Corrections terme par terme**

| Langue | Ligne | Proposé | Retenu | Pourquoi |
|---|---|---|---|---|
| pt-BR | 21 | passo de ângulo | **passo angular** | tournure du métier |
| pt-BR, it, es | 27 | observação / osservazione / observación | **aviso / avviso / aviso** | un constat d'import est un avertissement, pas une remarque |
| it | 3 | attacco / uscita di taglio | **entrata / uscita di taglio** | paire symétrique, celle des CAM italiennes |
| it | 14 | foro / intaglio interno | **foro / ritaglio interno** | « intaglio » est la gravure |
| it | 16, 29 | nastro | **striscia** (modalità striscia, densità della striscia) | « nastro » est un ruban |
| de | 3 | Anschnitt / Ausfahrt | **Einfahrt / Ausfahrt** | paire symétrique ; à confirmer par un natif si disponible |
| de | 20 | Rotationen | **Drehungen** | mot courant ; « Winkelschritt » reste |
| de | 33 | Schneidbrenner | **Brenner (Plasmabrenner)** | le mot d'atelier |
| es | 21 | paso de ángulo | **paso angular** | |
| es | 25 | carga (de archivos) | **subida (de archivos)** / verbe « subir » | Espagne d'abord, compris partout |

Tout le reste est validé tel quel. Réserve dite : l'idiome d'un atelier
précis d'une région précise n'est pas garanti ; les glossaires restent
ouverts aux retours des premiers utilisateurs de chaque langue.

## Contrôle du déploiement L0 + L0-bis (`949f4f5e`, V0.9.1) — vérificateur, 16/09 — conforme

Lecture seule : le commit de promotion ne porte que l'étape nouvelle
d'`AGENTS.md` §6 (page Nouveautés régénérée après chaque promotion), les
dates de `whatsNew.js` sont au 2026-09-16, aucun diff sous `workers/` ni
`public/engine` depuis `a22b7d5a` ; registre : `:latest` et `:949f4f5e…`
portent le **même digest** `sha256:82d7be71…6073c`, celui rapporté pour le
conteneur ; production : la page sert le SHA complet, en-tête « V0.9 », pied
« V0.9.1 », page Nouveautés « Version actuelle : V0.9.1 » avec l'entrée du
menu de langues, `/api/locale` en 404, et **la langue du document suit la
requête** : rien ⇒ `en`, `Accept-Language: fr` ⇒ `fr`, cookie `en` ⇒ `en`,
cookie `fr` ⇒ `fr`. **Prod = V0.9.1.**

## Ouverture du lot L1 — portugais du Brésil (implémenteur, 16/09 soir)

**Signal reçu** (vérificateur, contrôle V0.9.2 conforme). Le lot suit
l'ordre du §3, rien ne se publie à moitié.

**Fait à l'ouverture** :
- les trois documents du vérificateur partis au commit `4dfdae62` ;
- branche `l1-portugues` ouverte sur le dépôt principal ;
- le glossaire validé-corrigé (`specs/i18n/glossaire-pt.md`, 34 termes)
  fait foi pour TOUTE chaîne — tôle/chapa, saignée/largura de corte
  (kerf), amorce/entrada-saída de corte, perçage/ponto de perfuração,
  nesting (aninhamento), chute/retalho aproveitável, espacemento entre
  peças, separar em peças, bloco rígido, aproveitamento de material,
  direção de otimização, passo angular, aviso (constat), sucata
  (ferraille), ficha da peça, envio, recusa, relatório, densidade da
  faixa, visualização ao vivo, visualização ampliada, ponto de
  partida, tocha, aninhar nos furos ;
- les 747 clés du dictionnaire anglais extraites en fichier de
  travail (`.omo/en-keys.json`) pour la traduction par lots — la
  référence est l'ANGLAIS (verrou de parité), les valeurs EN servent
  de source, le glossaire gouverne les termes du métier.

**Reste à faire, dans l'ordre du §3** :
1. `app/utils/i18n/pt.js` — les 747 clés, traduction atelier pt-BR,
   glossaire respecté ;
2. registre `index.js` : `pt` à DICTS, `LANGUAGE_LABELS.pt =
   'Português'`, `INTL_TAGS.pt = 'pt-BR'` (virgule décimale, point de
   millier), `pluralSelect` pt (0/1 = one) ; verrou de parité VERT ;
3. site vitrine sous `/pt/` (ui.ts + pages) ;
4. documentation Starlight en locale pt, harnais en trois passes
   (cookie pt, compte dédié, langue sondée) ; `pt` ajouté à
   `DOCS_LANGS` le jour de la publication de la doc, PAS AVANT ;
5. tout fusionné le même jour, changelog V0.10.

## Jalons de relecture d'une langue (vérificateur, 16/09) — la règle « complète ou rien » vaut pour la PUBLICATION, pas pour la relecture

Une langue est un lot de plusieurs sessions (747 clés, une vingtaine de
pages, le site, le harnais). La relire d'un bloc à la fin serait le pire
moment pour découvrir un contresens du glossaire répété 300 fois. Trois
jalons, chacun relu par le vérificateur avant le suivant, sur la branche de
la langue, sans rien publier :

1. **Jalon A — l'application** : `pt.js` complet, `pt` au registre, verrou de
   parité vert, image reconstruite, captures du flux `.job` complet en
   portugais (accueil, dépôt, carte, vue agrandie, calcul, résultat,
   téléchargement) jointes au rapport. Le vérificateur relit les 747 chaînes
   et les captures ; les corrections rentrent avant le jalon B. Tant que le
   jalon A n'est pas relu, `pt` peut rester HORS de `DICTS` sur la branche
   (le verrou ne juge que les langues enregistrées) — on n'y met la langue
   que quand le fichier est complet.
2. **Jalon B — le site vitrine et le blog** : `ui.ts` portugais, `/pt/`,
   `hreflang` étendu à toutes les langues publiées, sitemap, les huit
   articles traduits (comparaison et prix d'abord) ; relecture des pages du
   site et de chaque article.
3. **Jalon C — la documentation** : locale Starlight `pt`, toutes les pages,
   captures par le harnais en trois passes, verrou de complétude ;
   relecture page à page. Puis `pt` dans `DOCS_LANGS`, et publication des
   trois ensemble : GO unique, app + site + doc le même jour.

**Pluriels — correction avant la première ligne de code** : en portugais,
italien, allemand et espagnol, **zéro est pluriel** (« 0 peças », « 0 pezzi »,
« 0 Teile », « 0 piezas ») ; seul 1 est singulier. La règle « 0 ou 1 =
singulier » est **française** uniquement. `pluralSelect` : `fr` ⇒ `n === 0 ||
n === 1`, toutes les autres ⇒ `n === 1`.

**Nombres pt-BR** : virgule décimale et point de millier (« 1.250,5 mm »),
`Intl.NumberFormat('pt-BR')` le fait seul — ne rien coder à la main.

## Jalon A — état de la traduction (implémenteur, 16/09 nuit)

**Lot 1/3 traduit** : 253 clés pt-BR (les 250 premières + 3 anticipées),
vérifiées complètes par script (`node .omo/check-batch.cjs` → « LOT 1/3
COMPLET ✓ »). Fichier : `.omo/pt-250.js`. Le glossaire est respecté :
chapa, espaçamento, kerf (largura de corte), aninhar nos furos, borda
esquerda/inferior/equilibrado, margem de segurança, retalho (chute),
sucata (ferraille), etc.

**Reste pour le jalon A** : les clés 250-747 (lots 2/3 et 3/3), puis
l'assemblage du `pt.js` final, le registre, le verrou de parité, et les
captures du flux .job en portugais. Les lots suivants se traduisent
depuis `.omo/en-keys.json` (index 250 à 747) avec le même contrôle.

**Reprise** : `node .omo/check-batch.cjs` pour valider chaque lot ;
le fichier final `app/utils/i18n/pt.js` s'assemble depuis les trois
lots une fois les 747 clés couvertes.

## Relecture linguistique du lot 1/3 de L1 (vérificateur, 16/09) — 253 chaînes lues, bonne base, quinze corrections dont trois systématiques

Lu en entier `.omo/pt-250.js`. Le portugais est naturel, le « você » est
tenu, l'impératif d'atelier (« Envie », « Aninhar ») est juste, les
pluriels suivent la règle corrigée. Trois écarts au glossaire, à corriger
d'abord parce qu'ils se répéteraient dans les lots 2 et 3 :

**Systématiques (glossaire)**

| Clé(s) | Lu | Retenu | Pourquoi |
|---|---|---|---|
| `settings.directions`, `plans.unlimited.f2`, `plans.compare.altLayouts`, `settings.directions.paidHint` | direções de layout | **direção de otimização** | glossaire ligne 11 ; « layout » n'y est pas |
| `settings.safety`, `settings.spacingRule` | margem de segurança / margem | **folga de segurança** / folga | glossaire ligne 19 ; « folga » est le mot d'atelier (jeu, tolérance) |
| `privacy.cloud.body` | armazenados em claro | **armazenados sem criptografia** | « em claro » est un calque du français |

**Ponctuelles**

| Clé | Lu | Retenu |
|---|---|---|
| `nav.workspace`, `nav.openWorkspace` | Workspace | **Meu espaço** / **Abrir meu espaço de trabalho** (le français dit « Espace ») |
| `nav.menu` | alternador de menu | **Abrir/fechar o menu** |
| `home.jobSwitched` | mudado para | **o projeto passou para** |
| `home.jobPlusDwg` | — separe-os. | **— envie-os em dois projetos separados.** (l'anglais dit deux projets) |
| `sub.grantActive`, `sub.grantDesc` | Unlimited (teste) / Um grant de administrador | **Unlimited (acesso de teste concedido)** / **Um acesso de teste concedido pelo administrador** — l'anglais dit « test grant » ; « grant » seul n'existe pas en portugais |
| `sub.freeLeft` | {n} operação(ões)… gratuita(s) restante(s) | **Nestings gratuitos restantes este mês: {n}** (pas de pluriels entre parenthèses) |
| `plans.pro.f2` | entrega mais rápida ainda | **entrega ainda mais rápida** |
| `plans.compare.heterogeneous` | Tipos de chapa heterogêneos | **Chapas de formatos diferentes** |
| `settings.spacingKerf` | micro-sobrepôr | **micro-sobrepor** (infinitif, sans accent) |
| `demo.projectName` | Chapa marítima | **Caldeiraria naval** (la tôlerie marine, le métier) |
| `privacy.device.body` | Nenhum outro computador | **Sem outro dispositivo** |
| `privacy.cloud.body` | ainda não aqui | **ainda não disponíveis aqui** |
| `localImport.missingGeometry` | no outro navegador | **em outro navegador** |
| `import.spursRemoved` | vaivéns de largura zero limpos | **traços de ida e volta de largura zero removidos** |
| `import.scaleApplied` | Desenho escalado por ×{value} | **Desenho redimensionado ×{value} na importação** (« escalado » est un calque) |

Validé tel quel : tout le reste, dont « Boa madrugada » (familier, mais
brésilien et juste), « falar por si mesma », « Excluir », « Salvar ».
Réserve habituelle : l'idiome d'un atelier précis n'est pas garanti.

## Lot 1/3 corrigé (implémenteur, 16/09 nuit)

Les 15 corrections de la relecture appliquées à `.omo/pt-250.js` —
24 substitutions exactes, contrôle repassé vert (« LOT 1/3 COMPLET ✓ »).
Les **trois règles systématiques** sont encodées pour les lots 2 et 3 :
1. **direção de otimização** (jamais « direções de layout ») ;
2. **folga de segurança** (jamais « margem de segurança ») ;
3. **sem criptografia** (jamais « em claro » — calque du français).

Et les trois principes de la relecture : le glossaire prime sur
l'anglais pour les termes du métier ; aucun mot anglais ne reste là où
le français a un mot (Workspace → espaço de trabalho) ; aucun calque
du français (escalado → redimensionado, em claro → sem criptografia).

## État du jalon A (implémenteur, 16/09 fin de nuit) — 51 % traduit

- **Lot 1/3** : 253 clés, relu et corrigé (section Relecture ci-dessus).
- **Lot 2/3 en cours** : 131 clés traduites (`.omo/pt-350.js`) — les
  sections jobImport, sheetcamJob, sheetcamReserve, sheetcamNest,
  vaultMenu, turbo, localCompute, localMode, importPreview, files,
  import — soit les sections critiques SheetCam complètes et les
  promesses du coffre. **Reste 116 clés dans le lot 2** (report,
  settings, time, upload, project restants, live, alts, banner, sub).
- **Lot 3/3 pas commencé** : 250 clés (result, results, progress,
  vault, account, auth, verify, footer, licences, parts, changelog).

**Total : 378/747 (51 %), 369 restantes.**

**Reprise** : continuer la traduction depuis `.omo/en-keys.json`
index 350-497 (fin du lot 2), puis 497-747 (lot 3). Contrôle par
`.omo/check-batch2.cjs`. Les trois règles et le glossaire restent
ouverts à côté. Les lots 2 et 3 se livrent ENSEMBLE pour relecture
avant tout assemblage.

## Relecture linguistique du lot 2/3 partiel de L1 (vérificateur, 17/09) — 131 chaînes lues, les sections critiques tiennent, sept corrections

Lu en entier `.omo/pt-350.js`. **Les trois sections critiques sont
justes** : le vocabulaire SheetCam suit le glossaire mot pour mot (entrada /
saída de corte, ponto de perfuração, ponto de partida, folga) ; le coffre dit
exactement ce que disent le français et l'anglais (« ilegíveis sem sua
chave », « nada fica sem criptografia depois », la clé perdue, l'exemption de
la purge) — ni plus ni moins ; les messages d'erreur du mode local gardent
la structure « cause — action — remboursé ». Les trois règles systématiques
sont tenues sur les 131 chaînes.

| Clé | Lu | Retenu | Pourquoi |
|---|---|---|---|
| `sheetcamReserve.ringTooSmall` | o contorno tem pontos demais poucos | **o contorno tem pontos de menos** | « demais poucos » n'est pas du portugais |
| `nest.thinParts` | {n} peça(s) com linhas… | **{n} peça(s) com traços mais finos que o espaçamento…** | un trait de dessin est un « traço », « linha » est une ligne géométrique — le français dit « traits » |
| `sheetcamReserve.mouthInsideEnvelope` | avança mais ao longo do contorno do que o recorte permite | **a entrada de corte se estende ao longo do contorno além do que o recorte permite** | plus lisible |
| `jobImport.startCorner` | Canto de início de corte | **Canto inicial do corte** | tournure naturelle |
| `jobImport.pierceMargin` | Espaço de perfuração mantido ao redor de cada entrada de corte | **Espaço reservado para a perfuração ao redor de cada entrada de corte** | « reservado » comme le français, « mantido » est un calque de l'anglais « kept » |
| `localMode.local` | Na minha máquina | **Neste dispositivo** | le libellé des cartes est « Este dispositivo » : même mot partout |
| `sheetcamJob.unsupportedVersion` | não é suportada … versão suportada | **não é compatível … versão compatível** | « suportado » au sens de « pris en charge » est un anglicisme courant mais évitable ; idem `localImport.unsupportedType` ⇒ **não compatível**, `localMode.dwgServer` ⇒ **não os aceita** |

Validé tel quel : le reste, dont « blocos desagrupados », « Redefinir
escala », « Separar em peças », « A cota é renovada em {date} ».

## Lot 2/3 partiel corrigé (implémenteur, 17/09)

Les 7 corrections appliquées (9 substitutions, la dernière touchant 3
clés réparties entre les deux lots — la clé `localImport.unsupportedType`
était dans le lot 1). **Quatrième règle encodée** pour les lots
suivants : le même objet porte le même mot partout — « Este dispositivo
» / « Nossos servidores » / « compatível » pour pris en charge.

## Consigne complète du lot L1 (vérificateur, 17/09) — délégation du propriétaire

Décision du propriétaire (17/09) : « je ne lis pas le portugais, je te fais
confiance, tant pis si ce n'est pas 100 % OK ». Conséquences : **la relecture
du propriétaire n'est plus une porte pour les langues qu'il ne lit pas** ; le
vérificateur relit tout et donne seul le GO de publication ; le propriétaire
n'intervient que pour ce qui engage (prix, promesses, légal) et pour le
déploiement. Les langues ne visent pas la perfection : elles visent une
interface qu'un atelier brésilien comprend sans sourire, et qui s'améliore
aux retours. La même délégation vaut pour l'italien, l'allemand et
l'espagnol.

### L1 de bout en bout, sans attendre de signal entre les étapes

**Jalon A — application** (en cours, 378/747)
1. Passer les sept corrections de la relecture du lot 2 partiel dans
   `.omo/pt-350.js`.
2. Traduire les 116 clés restantes du lot 2 et les 250 du lot 3 avec les
   quatre règles (glossaire prime, aucun mot anglais là où le français a un
   mot, aucun calque, même objet même mot) ; badges de `report` courts.
3. Livrer les lots 2 et 3 pour relecture ; appliquer les corrections.
4. Assembler `app/utils/i18n/pt.js`, `pt` dans `DICTS`, « Português » dans
   `LANGUAGE_LABELS`, `pt-BR` dans `INTL_TAGS`, `pluralSelect` : seul 1 est
   singulier ; verrou de parité vert ; vitest code 0 ; image reconstruite.
5. Captures du flux `.job` complet en portugais, cookie `pt`, regardées par
   le vérificateur : accueil, dépôt, carte groupée, vue agrandie, calcul,
   résultat, téléchargement, page Nouveautés, menu de langues à trois.
6. Rapport ⇒ relecture des captures et GO du jalon A. **Le jalon A ne se
   déploie pas seul** : `pt` reste sur la branche jusqu'au GO final.

**Jalon B — site vitrine et blog**
7. `hreflang` de `Base.astro` étendu à toutes les langues publiées +
   `x-default` (préalable) ; `ui.ts` portugais ; routage `/pt/` ; sitemap.
8. Les huit articles en portugais, Deepnest et prix d'abord : mêmes faits,
   titre et texte écrits pour le marché, date d'origine, « traduzido do
   inglês » en pied, `translationSlug` apparié.
9. Le billet d'accueil « NestorCut fala português » (court : ce que fait
   le produit, le mode appareil, dix nestings gratuits, la doc en portugais).
10. Rapport ⇒ relecture des pages du site et des neuf articles, corrections,
    GO du jalon B.

**Jalon C — documentation**
11. Locale Starlight `pt` ; toutes les pages des huit sections ; libellés de
    la barre latérale ; le harnais de captures en trois passes (`pt` ajouté à
    la liste) ; verrou de complétude ; page Nouveautés portugaise ajoutée à
    `sync-changelog.mjs` (le CHANGELOG reçoit un bloc *PT* par version, à
    partir de la version qui publie la langue ; les versions antérieures
    restent FR/EN dans la page portugaise, dit en tête de page).
12. Rapport ⇒ relecture page à page, corrections, GO du jalon C.

**Publication, le même jour**
13. `pt` dans `DOCS_LANGS` ; entrée CHANGELOG « NestorCut fala português »
    (FR, EN et PT) ; version 0.9.3 ; fusion des deux PR (site, app) ;
    promotion, déploiement app seule, régénération de la page Nouveautés ;
    contrôle en ligne par le vérificateur : les trois surfaces répondent en
    portugais, `Accept-Language: pt-BR` ⇒ portugais, menu de langues à
    trois, `hreflang` à trois sur une page du site, un article portugais
    indexable.

Le propriétaire est informé à trois moments : GO du jalon A (avec une
capture), GO final, contrôle du déploiement. Entre les deux, rien à décider.
