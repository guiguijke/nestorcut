# Plan — Lot C1 « inscription » : vérification d'e-mail, un seul e-mail admin, newsletter proposée régulièrement

Demande du propriétaire (07/09) : (1) un utilisateur inscrit en local doit
valider l'adresse qu'il donne, et le formulaire doit l'annoncer ; (2) le
site n'envoie qu'**un** e-mail par inscription, il en envoie deux
aujourd'hui ; (3) proposer **régulièrement** l'inscription à la newsletter.
Rédigé par le vérificateur après audit du code (arbitrages délégués,
masterplan §5). Implémenteur : GLM 5.3 Max, forme §8 du masterplan.
Planche : après le GO d'U1 passe 2, avant U2 (1 à 1,5 j).

## 1. Constat (état du code au 07/09, `0e33513`)

### 1.1 La vérification d'e-mail existe et est déjà contraignante

- `register.post.js` crée l'utilisateur local avec `emailVerified: false`,
  envoie le lien (`emailVerification.js`, jeton 32 octets haché SHA-256,
  24 h, collection `emailVerifications`), pose le cookie de session et
  renvoie `needsVerification: true` → page `/auth/check-email` (renvoi,
  lien « plus tard »).
- Google : `server/utils/user.js` pose `emailVerified: true` à la création
  (adresse garantie par Google). Rien à faire de ce côté.
- **Le nesting est refusé tant que l'adresse n'est pas vérifiée**, quel que
  soit le mode (local compris : l'enqueue est serveur) : `assertCanNest` et
  `assertCanNestDemo` (`entitlement.js`) jettent `403 email_not_verified`,
  le client (`files.js`) renvoie vers la page de vérification, bannière
  `VerifyEmailBanner` sur /home et /profile. Le coffre l'exige aussi.
- Ce qui manque : **rien n'annonce la vérification sur le formulaire**
  (le seul texte est « Inscrivez-vous pour commencer à imbriquer ») ; la
  page check-email **n'affiche pas l'adresse** (une faute de frappe est
  invisible jusqu'à la bannière) ; l'e-mail de vérification est **anglais
  seul** ; la collection `emailVerifications` n'a **pas d'index TTL**
  (jetons expirés conservés jusqu'à la suppression du compte) ; **aucun
  test du chemin heureux** de `register` (les 4 tests de
  `authErrorCodes.test.js` ne couvrent que les erreurs) ni du refus
  `assertCanNest` pour un local non vérifié (seul le coffre est testé).

### 1.2 Les deux e-mails : l'inscrit en reçoit un, l'administrateur deux

Le nouvel inscrit reçoit **un** e-mail (vérification). Le message de
bienvenue (`welcomemessage.js`) n'est pas un e-mail : deux documents
`supportMessages`, avec une attente de **3 s** `await`-ée DANS le handler
d'inscription (latence inutile de la réponse).

Les deux e-mails sont ceux de l'**administrateur** (`NUXT_ADMIN_NOTIFY_EMAIL`,
injecté dans les services app ET admin, `docker-compose.yml` l. 64 et 99) :

| # | Émetteur | Quand | Sujet |
|---|---|---|---|
| 1 | app, `adminNotify.js` (appelé par `register.post.js` et `user.js` Google) | immédiat | « Nouvelle inscription — nom (e-mail) » |
| 2 | admin, `admin/server/plugins/1_signupDigest.ts` | toutes les 5 min | « NestorCut — N nouvelle(s) inscription(s) » |

Le digest se dit « filet pour les inscriptions NON déjà signalées » (son
commentaire l. 3-5) mais sa requête est `createdAt > curseur` **sans aucun
marqueur « déjà signalé »** : chaque inscription est envoyée deux fois au
même destinataire. Cause unique, correction locale.

### 1.3 La newsletter : proposée une fois, puis plus jamais

- Case à cocher au formulaire local (jamais pré-cochée) → `newsletterOptIn`
  true/false, `newsletterOptInAt` ; Google : champ absent (null).
- `NewsletterPrompt.vue` (modale sur /home) ne s'ouvre que si
  `newsletterOptIn == null` : donc **Google seulement**, une fois ; « Non
  merci » écrit false pour toujours ; un local qui n'a pas coché n'est
  **jamais** re-sollicité. La croix ferme pour la session seulement.
- Bascule dans le profil (`NewsletterSettings.vue`), listmonk préconfirmé
  côté app (la case est le consentement), double opt-in côté site vitrine.
  Événements `newsletter_prompt_shown/accept/dismiss` déjà en liste blanche
  du tracking.

## 2. Décisions (vérificateur, arbitrage délégué)

| # | Décision | Raison |
|---|---|---|
| D1 | On **ne change pas le mécanisme** de vérification (jeton, 24 h, refus au nesting) ; on le rend **visible et testé** | il est correct et déjà contraignant ; le propriétaire ne le voyait pas parce que le formulaire ne l'annonce pas |
| D2 | Connexion **toujours permise** non vérifié (comme aujourd'hui) ; c'est le nesting qui est fermé | l'utilisateur doit pouvoir atteindre le bouton « renvoyer » et son profil |
| D3 | E-mail de vérification **bilingue** (FR puis EN dans le même corps, sujet « Confirmez votre adresse · Verify your email — NestorCut ») | pas de plomberie de langue à l'inscription ; déterministe |
| D4 | Doublon admin : la notification immédiate pose `adminNotifiedAt` sur l'utilisateur **après envoi réussi** ; le digest filtre `adminNotifiedAt: { $exists: false }` | le digest redevient ce qu'il prétend être (filet en cas de panne Resend), aucun envoi perdu |
| D5 | Newsletter : **première demande = modale existante** (inchangée) ; **re-demandes = carte discrète sur /home**, jamais modale, **tous les 90 jours**, aux comptes dont `newsletterOptIn !== true` | « régulièrement » sans harceler ; une modale répétée serait une nuisance et un risque a11y |
| D6 | Horloge de la re-demande : `dernièreDemande = newsletterAskedAt ?? newsletterOptInAt ?? createdAt` ; la carte s'affiche si `now − dernièreDemande ≥ 90 j` ; toute réponse ou fermeture écrit `newsletterAskedAt = now` (serveur) | la case non cochée à l'inscription compte comme une réponse ; un « non » n'est jamais redemandé avant 90 j |
| D7 | Le message de bienvenue **sort du handler** : `sendWelcomeMessage(userId)` en fire-and-forget (le `setTimeout` de 3 s reste dans la fonction) | −3 s sur la réponse d'inscription, aucun changement fonctionnel |
| D8 | Pas de CAPTCHA, pas de liste de domaines jetables dans ce lot | hors demande ; la limite 5 inscriptions/IP/h existe |

## 3. Périmètre fermé

### C1-a Vérification d'e-mail visible et testée

Fichiers : `app/pages/auth/local.vue`, `app/pages/auth/check-email.vue`,
`app/utils/i18n.js`, `server/api/auth/local/register.post.js`,
`server/features/notification/sendEmail.js`,
`server/features/notification/emailVerification.js`,
`server/tests/authErrorCodes.test.js` (ou nouveau `register.test.js`).

1. **Aide sous le champ e-mail, mode inscription seulement** : `<p id="local-auth-email-hint" class="local-auth__hint">` juste après l'`InputField` e-mail, ajouté à `aria-describedby` (« local-auth-email-hint local-auth-email-error »). Clés `auth.emailHint` :
   - FR : « Nous enverrons un lien de confirmation à cette adresse. L'imbrication s'ouvre après le clic. »
   - EN : « We'll send a confirmation link to this address. Nesting unlocks once you click it. »
   Style : jeton `--fs-12` / `--label-tertiary` comme `&__legal` ; en cas d'erreur sur le champ, l'aide reste affichée au-dessus de l'erreur.
2. **La page check-email affiche l'adresse** : `register` renvoie `{ ok, needsVerification, email }` ; la page lit d'abord `useNuxtData('user')` (déjà connecté) et affiche « …envoyé à **{email}** » (clé `auth.checkEmail.textWithEmail`, `{email}` interpolé, FR/EN ; l'ancienne clé reste pour le repli sans adresse).
3. **E-mail bilingue** (`sendVerificationEmail`) : sujet et corps FR puis EN, lien unique, mention 24 h, mention « si vous n'êtes pas à l'origine… ». Aucun autre e-mail modifié.
4. **Index TTL** sur `emailVerifications.expiresAt` (`expireAfterSeconds: 0`), créé au démarrage par le même mécanisme que les index existants (nommer l'endroit dans le rapport) ; `consumeVerificationToken` garde son contrôle d'expiration à la lecture (le TTL Mongo passe toutes les 60 s).
5. **Tests** (vitest, mocks mailer + Mongo comme `authErrorCodes.test.js`) :
   - chemin heureux `register` : document inséré avec `emailVerified: false`, `newsletterOptIn` false quand non coché, **un seul** appel `sendEmailVerification`, réponse `{ ok: true, needsVerification: true, email }` ;
   - `assertCanNest` refuse un local `emailVerified: false` par `403 email_not_verified` et accepte un Google sans champ ;
   - `register` répond en < 500 ms avec `sendWelcomeMessage` moqué lent (verrou de D7).

**Ne change pas** : durée 24 h, hachage, refus au nesting, bannière, le
flux Google, les codes d'erreur existants.

### C1-b Un seul e-mail administrateur

Fichiers : `server/features/notification/adminNotify.js`,
`admin/server/plugins/1_signupDigest.ts`, `server/api/auth/local/register.post.js`
(D7), `.env.example` (commentaire l. 165-168 corrigé : « immédiate ; le
digest ne reprend que les inscriptions non signalées »).

1. `notifyAdminNewUser` : après `$fetch` Resend réussi, `updateOne({ id }, { $set: { adminNotifiedAt: new Date() } })`. Échec Resend → pas de marqueur (le digest reprendra).
2. Digest : requête `{ createdAt: { $gt: cursor }, adminNotifiedAt: { $exists: false } }` ; curseur inchangé (il avance sur `createdAt` du dernier **examiné**, pas du dernier envoyé : préciser dans le rapport comment le curseur avance quand tout est filtré — il doit avancer quand même, sinon la requête relit les mêmes documents à chaque cycle).
3. D7 : `sendWelcomeMessage(userId).catch(log)` sans `await`.
4. Tests : (a) `adminNotify` pose le marqueur sur succès et pas sur échec (fetch moqué) ; (b) un test du filtre du digest (fonction de requête extraite, ou test du plugin avec Mongo moqué) : deux utilisateurs après curseur, un marqué → un seul dans l'envoi.

**Ne change pas** : le contenu des deux e-mails, l'intervalle 5 min, la
collection `app_meta`.

### C1-c Newsletter proposée tous les 90 jours

Fichiers : `app/components/NewsletterPrompt.vue` (inchangé sauf la
condition, voir 2), nouveau `app/components/NewsletterCard.vue`,
`app/pages/home.vue`, `app/utils/i18n.js`, `server/api/user/preferences.patch.js`,
`server/api/user/index.get.js`, nouveau `shared/newsletterAsk.js` (fonction
pure) + `app/tests/newsletterAsk.test.js`, `server/tests/preferences.test.js`.

1. **Fonction pure** `shouldAskNewsletter(user, now)` dans `shared/` (importable des deux côtés) : `false` si `newsletterOptIn === true` ; `lastAsk = newsletterAskedAt ?? newsletterOptInAt ?? createdAt` ; `true` si `now − lastAsk ≥ 90 j`. La **modale** garde sa règle actuelle (`newsletterOptIn == null`) ET ne s'ouvre pas si la carte s'affiche (une seule sollicitation à l'écran).
2. `/api/user` expose `newsletterAskedAt`, `newsletterOptInAt`, `createdAt` (ajout de champs, rien retiré).
3. PATCH `preferences` : accepte `newsletterAsked: true` → `$set.newsletterAskedAt = new Date()` ; un `newsletterOptIn` booléen pose aussi `newsletterAskedAt` (une réponse vaut demande). Rien d'autre.
4. **Carte** `NewsletterCard.vue` sur /home, sous la bannière de vérification : une ligne de titre (`newsletter.cardTitle` : « Les nouveautés NestorCut par e-mail ? »), une phrase (`newsletter.cardText`, réutilise le fond de `newsletter.promptText`), deux boutons `MainButton` : « Oui, me tenir informé » (`newsletterOptIn: true`) et « Pas maintenant » (`newsletterAsked: true`), plus la croix (même effet que « Pas maintenant »). Primitives U0 (`UiBadge`/`UiStat` non requis) ; jetons seulement, 0 hex. Tracking : réutiliser `newsletter_prompt_shown/accept/dismiss` (liste blanche inchangée).
5. Après une réponse : `refreshNuxtData('user')` puis `setUser()` (même séquence que la modale, sinon la carte reste affichée).
6. Tests : `shouldAskNewsletter` — 6 cas (optIn true ; Google null créé hier ; local false créé il y a 100 j ; askedAt il y a 89 j ; askedAt il y a 91 j ; askedAt absent mais optInAt il y a 100 j) ; PATCH `newsletterAsked` pose la date et ne touche pas `newsletterOptIn` ; PATCH `newsletterOptIn: false` pose les deux dates.

**Ne change pas** : la case du formulaire, la bascule du profil, l'appel
listmonk (préconfirmé), le formulaire du site vitrine.

## 4. Verrous et commandes

| Verrou | Commande | Cible |
|---|---|---|
| Suites | `npx vitest run` | vert, +≥ 10 tests (les tests ci-dessus nommés dans le rapport) |
| Chemin heureux inscription | test C1-a 5 | 1 appel mailer, doc `emailVerified: false`, réponse avec `email` |
| Un seul e-mail admin | test C1-b 4 ; **puis en prod après déploiement** : une inscription de test par le propriétaire, boîte `NUXT_ADMIN_NOTIFY_EMAIL` relevée à +10 min | test vert ; **1** e-mail reçu (horodatage dans le rapport) |
| Latence inscription | test C1-a 5 (mailer/bienvenue moqués lents) | réponse < 500 ms |
| Page check-email | e2e `docs/qa/perf-audit-2026-09-05/l3-verif/qa-l3-verify-banner.mjs` rejoué, + capture de la page montrant l'adresse | vert ; adresse visible |
| Aide du formulaire | captures `docs/qa/compte-c1/formulaire-{fr,en}-{clair,sombre}.png` | aide sous le champ, lisible (contraste ≥ 4,5 : script contraste d'U0) |
| Carte newsletter | compte local seedé `newsletterOptIn: false, createdAt: now − 100 j` en Mongo dev : capture `docs/qa/compte-c1/carte-90j.png` ; compte Google-like `newsletterOptIn: null` : la modale s'ouvre, pas la carte ; après « Pas maintenant » : rechargement → carte absente, `newsletterAskedAt` posé (extrait Mongo) | 3 constats |
| E-mail bilingue | corps HTML dans le rapport (ou capture Resend) | FR puis EN, un lien |
| Harnais et QA UI | `scripts/qa-e2e-local-2sheets.mjs` deux configurations ; scripts QA d'U1 | inchangés verts (la carte ne doit pas décaler les sélecteurs de /home : `data-testid="newsletter-card"`) |

Ordre imposé : tests → captures → rapport → GO du vérificateur → déploiement
Hetzner (app + admin ; aucun worker touché, pas d'étape homelab) → constat
prod « 1 e-mail » par le propriétaire.

## 5. Rapport attendu (constat par constat)

Pour chaque ligne du §4 : la valeur, la commande, le hash de commit. Trois
faits à énoncer en plus : (a) existe-t-il aujourd'hui une modification
d'adresse e-mail dans le profil (oui/non, fichier) — si non, la page
check-email ne propose rien et le rapport le dit ; (b) comment le curseur
du digest avance quand tous les inscrits sont filtrés ; (c) le nombre
d'utilisateurs en base concernés par la carte au jour du déploiement
(`newsletterOptIn !== true` et dernière demande ≥ 90 j) — à titre
d'information, pas une porte.

Non-décisions laissées à l'implémenteur : aucune. Toute question → une
option chiffrée, et attente.

## 6. Vérification (08/09, commit `0c44248`) — GO sous une retouche

Rejoué par le vérificateur : diff complet relu, `npx vitest run` vert au compte du rapport (507), captures formulaire FR clair et carte 90 j conformes, écart de contraste accepté (le verrou ≥ 4,5 prime sur le jeton nommé). Les trois faits du §5 sont répondus.

**Retouche C1-b-bis, avant déploiement** : fenêtre de course entre la notification immédiate et le digest. Le digest examine `createdAt > curseur` jusqu'à l'instant présent ; un inscrit créé quelques secondes avant un tick, dont l'envoi Resend est encore en vol (marqueur pas encore posé), est envoyé deux fois. Correction : borne haute de grâce dans `digestScanQuery(cursor, now)` → `{ createdAt: { $gt: cursor, $lte: new Date(now − 120 000) } }` (2 min, l'envoi immédiat prend ~1 s), le curseur n'avance jamais au-delà de cette borne ; un test dans `server/tests/signupDigest.test.js` (inscrit à now − 30 s : hors lot ; à now − 3 min : dans le lot). Rapport : ajouter la ligne au tableau des verrous, hash, `npx vitest run`. Puis déploiement app + admin, constat prod « 1 e-mail » par le propriétaire à +10 min.

