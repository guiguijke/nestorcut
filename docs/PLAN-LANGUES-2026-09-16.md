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
- **Ce qui reste en français et anglais** : mentions légales, CGV,
  politique de confidentialité, factures (APlasma, cadre légal français) ;
  le blog du site vitrine ; les e-mails transactionnels tant que le
  propriétaire ne décide pas le contraire.

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
3. site vitrine (accueil, tarifs, FAQ, en-tête, pied ; pas le blog) ;
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
