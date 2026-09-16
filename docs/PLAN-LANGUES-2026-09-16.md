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
- **L'implémenteur rédige, un natif relit** avant publication : le
  propriétaire trouve un relecteur par langue (client, confrère, forum) ;
  sans relecteur, la langue attend. Le vérificateur ne juge pas la langue,
  il juge la complétude, la parité des clés et les captures.
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
5. relecture native de bout en bout, corrections ;
6. vérification (parité, complétude, captures regardées, rendu serveur
   dans la langue, formats de nombres), GO, publication **app + site +
   doc ensemble**, entrée CHANGELOG « NestorCut parle portugais ».

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
