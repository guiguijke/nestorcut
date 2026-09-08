# Rapport C1 « inscription » — 2026-09-08

Implémenteur : relais (l'agent précédent a posé le code et les captures
puis s'est arrêté au contraste). Destinataire : vérificateur (GO avant
déploiement app + admin). Plan : `docs/PLAN-COMPTE-INSCRIPTION-2026-09-07.md`
§3–§5.

Hash de livraison : **`0c44248`** (`feat(compte): lot C1`). Les verrous
ci-dessous ont été mesurés sur cet arbre, `npx vitest run` **507/507**.

## Livré

### C1-a Vérification visible et testée
- Aide sous le champ e-mail, mode inscription seulement
  (`#local-auth-email-hint`, `aria-describedby`).
- `register` renvoie `{ ok, needsVerification, email }` ; check-email
  affiche l'adresse (`auth.checkEmail.textWithEmail`).
- E-mail de vérification bilingue FR puis EN, un lien, 24 h.
- Index TTL `emailVerifications.ttl.expiresAt` (`expireAfterSeconds: 0`)
  dans `scripts/mongo-indexes.mjs` et `scripts/mongo-indexes.mongo.js`
  (même mécanisme que les autres index : service `mongo-init` au
  `docker compose up`). Posé sur le Mongo de dev ce jour.
- Tests chemin heureux + latence D7 + `assertCanNest`.

### C1-b Un seul e-mail administrateur
- `notifyAdminNewUser` pose `adminNotifiedAt` **après** un `$fetch`
  Resend réussi ; échec → pas de marqueur.
- Digest : scan `{ createdAt: { $gt: cursor } }` puis filtre JS
  `adminNotifiedAt` absent (helpers purs `admin/server/utils/signupDigest.ts`).
- `sendWelcomeMessage` en fire-and-forget (D7).
- Commentaire `.env.example` l. 165-168 corrigé.

### C1-c Newsletter tous les 90 jours
- `shared/newsletterAsk.js` : `shouldAskNewsletter` (6 cas + intervalle).
- `/api/user` expose `newsletterAskedAt`, `newsletterOptInAt`, `createdAt`.
- PATCH `newsletterAsked: true` et `newsletterOptIn` booléen posent
  `newsletterAskedAt`.
- `NewsletterCard.vue` sous la bannière de vérification, `data-testid="newsletter-card"`.
- Modale inchangée pour `newsletterOptIn == null`, muette si la carte s'affiche.

### Résidu
- `spyrrow` retiré de `data/licences.js` (worker strip supprimé à la bascule).

## Verrous (§4)

| Verrou | Commande | Mesuré | Hash |
|---|---|---|---|
| Suites | `npx vitest run` | **507/507** (était 485 ; **+22** tests C1) | `0c44248` |
| Chemin heureux inscription | `npx vitest run server/tests/register.test.js` | 4/4 : doc `emailVerified: false`, `newsletterOptIn` false, **1** `sendEmailVerification`, réponse `{ ok, needsVerification, email }` | `0c44248` |
| Un seul e-mail admin | `npx vitest run server/tests/adminNotify.test.js server/tests/signupDigest.test.js` | 3+5 verts : marqueur posé sur succès, absent sur échec Resend ; 2 inscrits dont 1 marqué → 1 envoi | `0c44248` |
| Latence inscription | `register.test.js` « répond en < 500 ms » | vert (bienvenue moquée 2 s, handler non await) | `0c44248` |
| Page check-email | `node docs/qa/perf-audit-2026-09-05/l3-verif/qa-l3-verify-banner.mjs` + `docs/qa/compte-c1/check-email.png` | **VERIFY BANNER OK** ; adresse `qa-l3-…@local.dev` dans la bannière ; capture check-email : `c1check@local.dev` interpolé | `0c44248` |
| Aide du formulaire | captures `docs/qa/compte-c1/formulaire-{fr,en}-{clair,sombre}.png` + `contraste-aide.json` | aide sous le champ, FR/EN × 2 thèmes. Contraste **7,41** (clair) / **8,61** (sombre) — verrou ≥ 4,5 | `0c44248` |
| Carte newsletter | compte `c1carte@local.dev` vieilli J-100 ; `carte-90j.png` / `carte-90j-apres.png` / `modale.png` | 3 constats : carte visible ; Google-like (`optIn` null) → **modale**, pas la carte ; après « Pas maintenant » : carte absente, `newsletterAskedAt` = 2026-09-08T09:30:03Z, `newsletterOptIn` resté false | `0c44248` |
| E-mail bilingue | corps dans `sendEmail.js` `sendVerificationEmail` (ci-dessous) | sujet `Confirmez votre adresse · Verify your email — NestorCut` ; FR puis `<hr>` puis EN ; un lien | `0c44248` |
| Harnais | `QA_SPACE=0.1 QA_OUT=.qa-pw/e2e-local-c1-01` et `QA_SPACE=2 QA_OUT=.qa-pw/e2e-local-c1-02` `node scripts/qa-e2e-local-2sheets.mjs` | **verts**, inchangés : @0,1 **[587,313]** 900/900 overlap-free gap ≥ 0,1 ; @2 **[573,327]** 900/900 overlap-free gap ≥ 2. `data-testid="newsletter-card"` n'a pas décalé les sélecteurs | `0c44248` |

Tests C1 nommés (les +22) :
- `app/tests/newsletterAsk.test.js` (7)
- `server/tests/register.test.js` (4)
- `server/tests/adminNotify.test.js` (3)
- `server/tests/signupDigest.test.js` (5)
- `server/tests/preferences.test.js` (3)

### Écart au plan (contraste de l'aide)

Le plan §3 C1-a demandait le jeton `--label-tertiary` « comme `&__legal` ».
Mesure réelle sur le fond de `/auth/local` : **3,87:1** — le verrou du
même plan (≥ 4,5) échoue. Le verrou l'emporte : l'aide est en
`--label-secondary` (7,41 clair / 8,61 sombre). `&__legal` reste
tertiaire (hors verrou C1).

## Trois faits demandés (§5)

**(a) Modification d'adresse e-mail dans le profil : non.** Aucun
endpoint `change-email` / `update-email`, aucun champ d'édition dans
`app/pages/profile.vue` ni les composants compte. L'e-mail n'apparaît
que dans la bannière de vérification et dans la confirmation de
suppression de compte (`DeleteAccount.vue`). La page check-email ne
propose donc rien d'autre que « renvoyer » et « plus tard ».

**(b) Curseur du digest quand tout est filtré.** Le lot **examiné**
ignore le marqueur (`digestScanQuery` = `{ createdAt: { $gt: cursor } }`,
plafond 200, tri `createdAt` croissant). Le filtre
`adminNotifiedAt` s'applique **après** (`filterUnreported`). Le curseur
avance sur le `createdAt` du **dernier examiné** (`advanceCursor`),
envoyé ou non. Si les 200 sont déjà marqués : aucun e-mail, le curseur
avance quand même, le cycle suivant ne relit pas la même plage. (Un
filtre Mongo `{ adminNotifiedAt: { $exists: false } }` dès la requête
aurait bloqué le curseur sur les marqués — c'est pour ça que le scan
et le filtre sont séparés.)

**(c) Utilisateurs concernés par la carte au jour du rapport (dev local).**
Mongo dev : **11** users, **0** éligible (`newsletterOptIn !== true` ET
dernière demande ≥ 90 j). Le compte de capture `c1carte@local.dev` l'était
(créé simulé au 31/05, optIn false) ; « Pas maintenant » a posé
`newsletterAskedAt` aujourd'hui → plus éligible. Chiffre prod : à
relever le jour du déploiement (pas une porte).

## Corps de l'e-mail bilingue (C1-a 3)

Sujet : `Confirmez votre adresse · Verify your email — NestorCut`

```
Bonjour,
Merci de créer votre compte NestorCut. Confirmez votre adresse e-mail
pour commencer à imbriquer :
[Confirmer mon adresse e-mail]  ← lien unique
Ce lien est valable 24 heures. Si vous n'êtes pas à l'origine de cette
inscription, vous pouvez ignorer cet e-mail.
Cordialement, NestorCut
——
Hello,
Thanks for creating your NestorCut account. Please confirm your email
address to start nesting:
[Verify my email address]  ← le même lien
This link is valid for 24 hours. If you did not create an account, you
can safely ignore this email.
Best regards, NestorCut
```

## Non-faits / hors lot

- Constat prod « 1 e-mail admin » : **après GO + déploiement**, par le
  propriétaire (boîte `NUXT_ADMIN_NOTIFY_EMAIL` à +10 min).
- Déploiement : app + admin seulement, aucun worker, pas d'homelab.
- Pas de CAPTCHA, pas de domaines jetables (D8).
- Case du formulaire, bascule profil, listmonk, site vitrine : inchangés.

## Captures

`docs/qa/compte-c1/`
- `formulaire-fr-clair.png` `formulaire-fr-sombre.png`
- `formulaire-en-clair.png` `formulaire-en-sombre.png`
- `check-email.png`
- `carte-90j.png` `carte-90j-apres.png` `modale.png`
- `contraste-aide.json`
