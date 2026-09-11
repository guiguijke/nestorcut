# Masterplan NestorCut — 2026-09-05

> Document de pilotage : où nous en sommes, ce qui fait de NestorCut
> **la référence du nesting dans le navigateur** (DXF entrant, DXF
> sortant, rien ne quitte la machine), et dans quel ordre. **Recentré le
> 06/09** : §0 donne la boussole et la règle de tri de tout chantier. Il consolide le plan perf/UX en cours
> (`PLAN-PERF-UX-2026-09-05.md`), la réponse produit de l'auditeur sur les
> features différenciantes (§3), la stratégie `STRATEGY.md` (G-code hors
> produit, tiers 0/19/39 €) et `PLAN-coupe-commune.md`. Statuts datés —
> à mettre à jour à chaque lot livré.

## 0. Position (recentrée le 06/09)

**La référence du nesting dans le navigateur.** Un onglet, un DXF déposé,
un résultat vérifiable en quelques secondes, et le fichier ne quitte
jamais la machine. Aucun ProNest/SigmaNEST/Lantek ne le fera ; les outils
web concurrents le font à moitié (upload serveur, file d'attente, aucune
preuve publique). « Pas un CAM, le meilleur DXF-in/DXF-out » reste le
périmètre ; le navigateur est le terrain où l'on gagne. L'atelier cible
possède déjà son CAM ou son logiciel machine (LightBurn, SheetCam,
constructeur) : notre sortie doit être la meilleure entrée possible pour
ces outils.

**Règle de tri de tout chantier** (à appliquer avant d'ouvrir un lot) :

1. **Le chemin navigateur est le chemin principal, pas un mode.** Free y
   est déjà forcé, un nouveau projet est « 100 % privé » par défaut. Le
   serveur sert le débordement (DWG, gros jobs Pro, multi-appareils), il
   n'est pas la référence.
2. **Toute fonction se livre d'abord sur le chemin navigateur** (import
   wasm, solve wasm, post-pass, export Rust/wasm) ; le serveur suit ou
   partage le code. Une fonction disponible seulement côté serveur n'est
   pas considérée livrée.
3. **Un seul code partout où c'est possible.** Le moteur l'est déjà (natif
   ≡ wasm, verrou SHA-256). Le post-pass est dupliqué (Python ~4 000 lignes,
   JS ~4 000 lignes) : c'est l'obstacle n° 1 à la parité navigateur/serveur.
   Il se résorbe en **déplaçant vers le moteur** (ou en retirant), jamais en
   ajoutant une troisième copie.
4. **Preuve publique navigateur** : /benchmarks doit montrer les chiffres
   obtenus dans le navigateur (densité identique par construction, temps
   mesurés sur une machine datée).
5. Ce que le navigateur ne fait pas encore (DWG, threads wasm, gros jobs
   Pro) est un **choix documenté** avec sa raison, pas un oubli.

**État du chemin navigateur au 06/09** (ce qui est acquis / ce qui manque) :

| Étape | Acquis [prod] | Manque |
|---|---|---|
| Import | wasm DXF/SVG 100 % client, claim « never leaves your machine » vérifié | DWG = serveur seulement ; robustesse jamais mesurée sur l'importeur wasm (phase C du lot 4) |
| Solve | même recherche pour tous (8 walks, `QUALITY_WALKS`), pool de Web Workers de concurrence 1/4/8 par tier, déterministe (jamais `hardwareConcurrency`), ~36 Mo/worker, partiels livrés avec leviers | mono-tôle 300 pièces 95-145 s (P5) ; zones de grille séquentielles (P6) ; threads wasm écartés (COOP/COEP) |
| Post-pass | miroir JS de residual/structure/holefill, ceinture exacte, garde par classe | code dupliqué Python/JS ; garde calculée après mutation (AG1 → lot 4 A) |
| Finalisation | gel 5,7 s → 0,26-0,47 s (L1) | encore sur le thread principal (P4) |
| Export | écrivain Rust natif + wasm, arcs/cercles/splines natifs | calques par nature + identifiants (3.1) ; chemin ezdxf encore en double |
| Temps job T-A | **6-9 s navigateur** contre 19-29 s serveur (file + post-pass Python) | — le navigateur bat déjà le serveur sur le cas standard |
| Preuve | /benchmarks publié (chiffres images publiées) | pas de colonne navigateur |

## 1. Où nous en sommes (revue du 2026-09-09)

**En production (app `7f2d682`+, workers et homelab au moteur P5 `b0c36f3`)**
- Chemin navigateur = chemin principal : import wasm, solve wasm 8 walks
  (pool 1/4/8 par tier), post-pass JS miroir, finalisation dans un Web
  Worker (P4), plateau SPP calibré (P5), résultats IndexedDB. Cas de
  référence T-A (900 pièces, 2 tôles) : **9 s de calcul au repos** au tier
  standard, 21 s sur poste chargé ; long task après solve 70-82 ms ;
  mono-tôle 300 pièces 12,5 s (largeur 600,6 mm, hauteur −200 mm depuis P5).
- Serveur (débordement) : job T-A 15-16 s, corpus T-A..T-K 11/11 en
  continu, physique 0 chevauchement, benchmarks publics régénérés sur
  l'image déployée (version affichée = commit déployé).
- Parité navigateur ≡ serveur : **grille bit-identique** ; post-pass encore
  double (Python + JS) — objet du lot 5-moteur.
- Interface « atelier » : U0 jetons + primitives, U1 coquille et accueil,
  U2 page projet, U2-ter (4 px partout, profil pleine largeur) — en prod.
  U3 (espace de résultat) cadré en deux passes, U4-U5 à venir.
- Compte : inscription vérifiée visible et testée, un seul e-mail
  administrateur, newsletter re-proposée tous les 90 j (lot C1, clos
  08/09 sur constat prod).
- Dépôt : re-créé le 08/09 à historique neuf, PolyForm Noncommercial sur
  les apports, notices tiers complètes, documents internes hors public ;
  ancien dépôt privé archivé.

**Ce qui n'est pas fait (et compte pour « le meilleur outil »)**
- **Robustesse d'import** (3.2) : la phase C du lot 4 (corpus ≥ 30 DXF
  réels, classement des échecs, spécification du rapport de réparation)
  **n'a pas été produite** — aucun rapport dans `docs/qa/`. C'est le
  chantier n° 1 de valeur utilisateur et il n'a pas commencé.
- **Un seul post-pass** (lot 5-moteur) : la mesure du corpus est sans
  appel — sur 11 cas, `merge` et `compact` ne déplacent rien sauf T-K
  (128 et 372 pièces) ; T-A finit en rollback de compaction. Le post-pass
  résiduel coûte 1,2-1,5 s par job pour un gain rare. La fusion
  inter-tôles appartient au constructif BPP.
- **Trous** : banc `seed_holes` à 20/40 par classe (avant et après P5) —
  la cible 40/40 d'AGENTS date d'une autre grille ; à re-cibler au lot
  5-moteur.
- **Colonne navigateur de /benchmarks** (0,5 j) : non faite.
- **Business** : chiffres du 28/08 (43 inscrits, 0 payant, rétention 7 %)
  jamais re-mesurés ; **webhook Stripe live : statut inconnu du
  vérificateur** ; jalon utilisateurs (5 entretiens + campagne) non
  démarré — l'ordre T3-T5 reste une hypothèse.

## 2. Cette semaine (revue du 09/09)

| # | Action | Type |
|---|---|---|
| 0 | **Dernière tôle multi-tôles** (priorité absolue owner, 09/09) : la direction choisie ne s'applique pas à la tôle partielle (démo : −X / −Y / équilibré rendent le même amas) — cause à trois niveaux, décision « tôle partielle = SPP de la même direction dans le moteur », compaction −X retirée des deux langues ; consigne `PLAN-DERNIERE-TOLE-2026-09-09.md`. **10/09 : tranche 1 livrée `2d61efb`, GO qualité (trois formes conformes, ancrées), NO-GO déploiement — tranche 1-bis livrée `eaf11ff7` et vérifiée le 10/09 : temps réglé (+6 à +9 s navigateur, une finition par alternative) ; tranche 1-ter `a3c4d378` vérifiée le 10/09 : contact au contour borné, finition déterministe reproductible, « pair » en trace (la carte de collision jagua n'est pas un oracle de distance : agencements légaux rejetés à 2,0001 mm). **DÉPLOYÉ le 10/09 à `f48ac8dd`** (app, worker, wasm, homelab au même digest ; corpus 11/11 sur l'image publiée, benchmarks publics régénérés, `/benchmarks` à jour, §13) — reste à faire : **tranche 2 DÉPLOYÉE le 10/09** (`b6e9082d`, §16 : corpus 11/11 sur l'image publiée, neuf densités inchangées, homelab au même digest, app-ci vert) : oracle de distance exact arête↔arête, garde qui rejette de nouveau sur mesure exacte (le 1,849 mm du §8.2.3 est attrapé dans le moteur), parité contre shapely **50 layouts, écart max 0,0001 mm** — le verrou a d'ailleurs attrapé un faux positif de mon premier oracle (centroïde d'une pièce concave). **Vérifiée le 10/09 (§15) : GO déploiement** ; borne de travail 4 conservée (L1 9,6 min acceptés). Déploiement fait (§16). Le contrôle de l'artefact déployé a LOCALISÉ l'écart du §13.3 : **1,883 mm sur la tôle DENSE**, jamais touchée par la finition (dont la mesure propre, 2,0001, est confirmée en aval) — paire hôte/pièce nichée, mécanisme non tranché, 2 occurrences sur 12 exécutions navigateur contre 0 sur 45 côté serveur ; chantier NON ouvert (consigne owner). Décision owner 10/09 : **arrêt des nouveaux chantiers, on termine l'en-cours** | Implémenteur (déploiement), vérificateur |
| 1 | **Webhook Stripe live** : **confirmé par le propriétaire le 10/09** ; reste à voir passer un premier paiement réel | Owner |
| 2 | **Jalon utilisateurs** : campagne feedback **en cours** (10/09, aucun retour encore) ; 5 entretiens d'atelier à caler (guide `JALON-UTILISATEURS-T1-2026-09-06.md`) ; re-mesurer inscrits / payants / rétention | Owner |
| 3 | Homelab : recréer **à froid** le conteneur WireGuard tiré le 08/09 (hors déploiement moteur, les trois workers derrière lui), contrôle tunnel + `assert_overflow_head.py` | Ops (agent, sur feu vert owner) |
| 4 | Retouche badge « Démo » puis **U3 passe 1** (extraction pure, GO vérificateur) puis passe 2 (espace de résultat) ; socle P6 déployé avec la passe 2 | Implémenteur |
| 5 | **Phase C import** : lots A-E **livrés le 10/09** (`1bc5eec7`, 85 DXF dont 4 réels, coureurs wasm et ezdxf, synthèse stratifiée, rapport de réparation spécifié). **153 DXF réels déposés le 10/09 soir** et passés dans les deux importeurs (`PLAN-IMPORT` §8) : wasm 91,5 % lus, 11 refus par la garde 999 que le serveur lit, 33 fichiers à segments pendants, 7 écarts de comptage silencieux, 8 sans unité, imports jusqu'à 68 s pour une pièce | Vérificateur (fait) |
| 6 | Colonne navigateur de /benchmarks : méthode figée (machine datée, au repos, `QA_OUT` hors OneDrive, temps = calcul du harnais, pas `solveDoneAt`) | Implémenteur, 0,5 j |

## 3. Les features « n°1 » (analyse auditeur, ordre de valeur)

Position de l'auditeur (partagée) : **CAM non, CAM-ready oui.**

### 3.1 Sortie CAM-ready (le socle export)

**Vérifié le 05/09 (vérificateur)** : les arcs, cercles et splines sont
**déjà conservés** aux deux exports — côté serveur `build_part` copie les
entités d'origine par handle et les transforme (ezdxf), côté Rust
`nest-export/dxf_writer.rs` écrit des entités ARC/CIRCLE/SPLINE natives.
Il n'y a pas de discrétisation à corriger. Reste à faire :

1. **Un calque par nature** (extérieur, trou, marquage, chute, texte) —
   aujourd'hui : calques d'origine + `BIN_BOUNDARY` + `OUT_SHAPE` ;
   identifiants de pièce (texte ou attribut) ; unités explicites dans le
   header ; contour de la chute réutilisable sur son calque.
2. **Rapport de fabrication imprimable** (tôles, liste de pièces, matière,
   chutes) — le rapport matière existe, il manque la mise en page
   imprimable (candidat Pro).
3. Test d'export « golden » par entité (arc, cercle, spline, polyligne à
   bulges) sur les deux chemins, pour que 1 ne casse pas l'acquis.

Effort : calques + identifiants ~1 semaine, rapport imprimable ~0,5-1
semaine. **Recentrage 06/09** : les calques se font dans l'écrivain Rust
(natif + wasm, c'est celui du navigateur) et le chemin ezdxf est retiré
au même chantier — un seul écrivain, testé golden par entité sur les deux
cibles.

### 3.2 Robustesse d'import DXF — la priorité n°1

« C'est la première cause d'abandon d'un outil de nesting, avant la
qualité de l'algorithme. » Splines (déjà différées par l'audit 29/08),
contours ouverts à réparer, blocs/INSERT (R·S), textes, trous imbriqués,
unités douteuses (le piège ×1000 existe déjà côté UI) — avec un
**rapport de réparation lisible** par fichier (« 2 contours ouverts
refermés, 1 bloc aplati, unités mm détectées »).

Effort : ~2-3 semaines (dette connue et documentée). Débloque la
confiance de bout en bout. **Recentrage 06/09** : la robustesse se mesure
et se corrige **d'abord sur l'importeur wasm** (c'est le seul que voit
Free et le défaut « 100 % privé ») ; ezdxf suit. Le rapport de réparation
est produit côté client.

### 3.3 Bibliothèque de chutes — l'argent direct

Sauvegarder la chute d'un job comme **nouvelle tôle** et nester dedans.
Pour un petit atelier c'est de la matière économisée à chaque job ; peu de
SaaS le font bien. En deux temps :

- **v1 : chute rectangulaire** — le produit calcule déjà la « chute
  réutilisable W × H » de chaque tôle ; un bouton « enregistrer comme
  tôle » + une bibliothèque de formats utilisateur suffisent. Aucun
  changement moteur ni post-pass. ~1 semaine.
- **v2 : contour réel (polygone)** — le moteur (jagua-rs) accepte des
  conteneurs polygonaux, mais **tout le reste suppose une tôle
  rectangulaire** : pré-contrôle de capacité `(W−s)(H−s)`, grille
  structurelle, compaction de la dernière tôle, métriques de chute,
  vue live, wasm. C'est un chantier de 3-4 semaines, à ne lancer qu'après
  retour utilisateurs sur la v1.

Différenciateur marketing fort (« your offcuts are sheets »).

### 3.4 Contraintes de tôle

Marge par bord (brides de serrage), **zones interdites** (rectangles
exclus), **sens du grain** (rotations 0/180 seulement — bois, inox
brossé), miroir autorisé ou non (matière à face). Le moteur gère déjà
les rotations par item et les rotations restreintes par classe —
extension naturelle des params + pré-contrôle.

Effort : ~1-2 semaines.

### 3.5 Réserve d'amorce + point de départ — le pont CAM

Le CAM ajoute une amorce de 3-6 mm hors contour ; si la voisine est à
2 mm, l'amorce perce dedans. Implémentation **locale** (pas d'anneau
complet qui tuerait la densité) :

- paramètre « réserve d'amorce » (longueur + règle de position par
  défaut : début de la plus longue arête droite, ou un coin) ;
- la pièce nestée = contour réel **+ petit appendice d'exclusion** au
  point de départ (polygone quelconque → l'algorithme ne change pas) ;
- l'export garde le contour réel et **marque le point de départ sur un
  calque dédié** (déterministe — bonus : le CAM peut le reprendre) ;
- pour les trous nichés : la capacité pinwheel réserve la zone.

Effort (auditeur) : géométrie simple, plomberie moyenne (miroirs
Python/Rust/JS + pré-contrôle capacité) — **1-2 semaines**.

### 3.6 Pièces de remplissage

Quantité minimale + **« autant que possible »** pour des pièces d'appoint
qui comblent les vides. Le moteur (BPP/SPP) ne connaît pas les pièces
optionnelles : les traiter dans le solve serait un changement d'objectif
(sac à dos), 2-3 semaines. Voie courte : nester les pièces obligatoires,
puis **remplir les bandes résiduelles avec les pièces d'appoint via la
passe résiduelle existante** (`fill_residual_bands` place déjà des
lattices) — ~1 semaine, résultat borné par la qualité de cette passe.

### 3.7 Coupe commune en grappes

Cadrée dans `PLAN-coupe-commune.md` : clusters de pièces identiques à
arêtes communes, nester la grappe comme super-pièce, exporter la
géométrie **fusionnée** sur calque distinct. Conditions : coller à la
distance exacte du kerf, fusionner les arêtes partagées à l'export (sinon
le CAM coupe deux fois), CAM acceptant les lignes partagées.
**Après 3.2 et 3.3**, pas avant. Prérequis transverse : le chantier B du
plan (sac `exportParams`, espacement vs kerf explicites) est déjà rédigé.

### 3.8 API & traitement par lot

Devenir **le moteur appelé par d'autres outils** plutôt que de se battre
contre les CAM : clé API, endpoints nest + résultats, webhooks, tarification
à l'usage. Ouvre un canal B2B (intégrateurs, ERP d'atelier). ~2-3 semaines
+ opérations (quota, abuse). Après la stabilisation perf (lots 2-4) —
une API lente ou gelée serait un échec public. C'est le seul chantier
purement serveur du plan : il vient **après** la référence navigateur
établie (parité post-pass, benchmarks navigateur), pas avant.

### 3.9 Preuve publique de qualité

Publier les **densités sur des instances de référence connues** (ESICUP,
corpus propres versionnés) avec méthode reproductible. Le corpus T-A..T-K
et les bancs existent déjà en interne — il s'agit de publier une page
« benchmarks » honnête (mêmes chiffres que le corpus, machine et
conditions datées). ~3-4 jours. Effet confiance majeur, coût dérisoire.
**Livré au lot 3** (chiffres serveur). Reste, recentrage 06/09 : la
**colonne navigateur** (même densité par déterminisme, temps mesurés par
le harnais navigateur sur une machine datée, aux tiers Free et standard)
— 0,5 j, au lot 4 phase B.

### 3.10 Transverse : espacement ≠ kerf

Aujourd'hui « espacement » porte seul la sécurité. Rendre **kerf et
sécurité explicites** dans les réglages, avec la règle affichée
« espacement = kerf + 2 × tolérance » (clarifie l'usage, prépare l'amorce
et la coupe commune). C'est le chantier B.4 déjà rédigé du plan
coupe-commune. ~2-3 jours.

### 3.11 Piste à explorer : réglage d'effort du moteur (idée propriétaire, 07/09)

Trois positions déterministes exprimées en **itérations** (jamais en
secondes : le résultat doit rester identique entre appareils et entre
natif et wasm) — Rapide / Défaut / Qualité, par exemple plancher 10 / 20-30
/ 100 — avec le temps affiché comme **estimation** calibrée sur l'appareil
(coût par itération du dernier calcul). Compatible avec « même qualité
pour tous » : l'utilisateur choisit son compromis par tâche, le plan ne
change que la vitesse. Prérequis avant toute UI : mesurer sur le corpus
ce que la patience rapporte réellement par position (chute de la dernière
tôle, densité) à partir des données de `MESURE-P3` — si « Qualité » ne
rapporte que quelques millimètres, la position n'existe pas. Le mono-tôle
(plateau en temps) attend P5. **Non planifié** ; à rouvrir après le jalon
utilisateurs si la demande apparaît.

### 3.12 Compte : inscription vérifiée, un seul e-mail admin, newsletter régulière (demande propriétaire 07/09 — lot C1)

Audit du vérificateur (`PLAN-COMPTE-INSCRIPTION-2026-09-07.md`) : la
vérification d'e-mail des comptes locaux **existe et ferme déjà le
nesting** (`assertCanNest` → `403 email_not_verified`, Google vérifié
d'office) mais le formulaire ne l'annonce pas, la page « vérifiez votre
boîte » n'affiche pas l'adresse, l'e-mail est anglais seul et le chemin
heureux n'a aucun test. Les **deux e-mails par inscription** sont ceux de
l'administrateur : notification immédiate (app) + digest 5 min (admin)
sans marqueur « déjà signalé ». La newsletter n'est proposée qu'une fois
(modale, Google seulement). Décisions déléguées prises : mécanisme de
vérification inchangé mais visible et testé (aide sous le champ, adresse
affichée, e-mail bilingue, TTL des jetons) ; marqueur `adminNotifiedAt` +
filtre du digest ; re-demande newsletter par **carte discrète tous les
90 jours** (`shouldAskNewsletter` partagée, `newsletterAskedAt`), modale
inchangée pour la première fois ; message de bienvenue sorti du handler
(−3 s). Planche : 1 à 1,5 j, après le GO d'U1 passe 2, avant U2 ;
déploiement app + admin, aucun worker.

## 4. Séquenciation proposée

Principe : **finir la perf d'abord, mesurée dans le navigateur** (lots
2-4 : un produit lent contredit toute la promesse), en parallèle les
**vérifications business critiques** (Stripe, feedback), puis la vague
« référence navigateur » par valeur : parité post-pass (un seul code),
import wasm robuste, export Rust unique, benchmarks navigateur.

| Horizon | Contenu | Livrable mesurable |
|---|---|---|
| **T0 (semaine en cours)** | ~~décision k + SAMPLE_CFG~~ **FAIT 05/09** (k=3/plancher 30/sans plancher temps ; SAMPLE_CFG inchangé) ; ~~lot 2 (P3 + P7)~~ LIVRÉ, corrigé L2-bis et **DÉPLOYÉ prod 06/09 ~04h30 UTC** (743aa1d — GO du vérificateur ; images publiées assert OK, corpus 11/11 sur bits publiés, md5 moteur prod=publié ; job standard 19-29 s, navigateur 6-9 s, gel < 0,3 s). **L2-ter LIVRÉ 06/09 (non déployé)** : cause = pass résiduel (l'expansion pinwheel est ÉCARTÉE par l'attribution à étages AC1 ; snapshots moteur/expansion propres) — correctif = ceinture exacte différentielle intra-tôle dans fill_residual_bands (Python+JS) : **30 bancs → 0 écartée, 1 ceinturée** (récidive convertie en alternative valide). Puis L2-quater v2 (cascade + re-relay batch) **validé et DÉPLOYÉ prod 06/09 11h35 UTC** (fb5e184 — FUSION 5/8→6/8 chez le vérificateur, 0 écartée 0 ceinturée, gel 339-372 ms ; résidus diag → P8) (`RAPPORT-PERF-UX-L2-QUATER-2026-09-06.md`). **Prochaine étape : lot 3 en T1** (UX 2.1.4-2.1.9, compte 3.1.3-3.1.6, kerf explicite, benchmarks publics) — jalon utilisateurs (user gate) à la fin de T1 ; webhook Stripe **TOUJOURS À VÉRIFIER** ; campagne feedback à envoyer | Job standard ≤ 25 s ✓ ; paiements vivants ⏳ |
| **T1 (TERMINÉ 06/09)** | ~~Lot 3 + L3-bis~~ **LIVRÉS ET DÉPLOYÉS prod 06/09** (c47b2d2 puis 87b8bae — GO du vérificateur à chaque étape ; vitest 480/480, corpus 11/11 bits publiés, grilles bit-identiques, partiels navigateur livrés avec leviers) : UX 2.1.4-2.1.9 (refus capacité panneau unique ancré sous Nest + levier masqué < 0,5 mm + zéro carte fantôme ; « pièces · fichiers » ; glossaire tôle/vouvoiement + Intl.NumberFormat + test d'unicité i18n — doublons réels corrigés ; état « autre appareil » ; ligne d'état de calcul complète + cœurs locaux corrigés ; sens par bord + défaut 2 mm ; vue live ≡ option 1 avec poussée stage final), compte 3.1.3-3.1.6 (codes d'erreur stables + validation client + œil + CGU ; DialogWrapper a11y role/focus trap/restitution ; bannière e-mail non vérifié + badge ; middleware auth-optional /plans+changelog ; auth_error Google), **3.10 kerf explicite** (deux champs kerf/sécurité, règle affichée, migration sans changement, défaut usine 2 mm, zéro diff runtime), **3.9 benchmarks publics** (/benchmarks, chiffres du run images publiées fb5e184, méthode + honnêteté). Vitest 476/476, pytest 224+2 (3 errors préexistantes image publiée), e2e 7/7 (`RAPPORT-PERF-UX-L3-2026-09-06.md` + captures l3-verif). Verif L3 : GO avec L3-bis obligatoire → **L3-bis livré puis DÉPLOYÉ 87b8bae** (partiels navigateur 892/900 + leviers, message de refus unique, harnais bit-identique ; résidu garde-avant-post-pass → lot 4 — `RAPPORT-PERF-UX-L3-BIS-2026-09-06.md`). **Prochaine étape : JALON UTILISATEURS fin T1** (5 entretiens d'atelier + dépouillement campagne — livrable propriétaire) ; webhook Stripe **TOUJOURS À VÉRIFIER** ; campagne feedback à envoyer | Parcours nesting sans bloquant ✓ ; page /benchmarks ✓ ; jalon utilisateurs ⏳ |
| **Porte utilisateurs (fin T1)** | Campagne feedback dépouillée + 5 entretiens d'atelier (import, export, chutes, amorce) — **avant d'engager T3-T5** : l'ordre 3.2 → 3.7 est une hypothèse de l'auditeur, pas une donnée | Liste des 3 irritants réels ; ordre T3-T5 confirmé ou corrigé |
| **T2 / lot 4 — CLOS le 09/09 sauf phase C** | Phase A (dette : P8, gardes, orphelins) **déployée** ; phase B **déployée** : P4 worker de finalisation (après-solve 70-82 ms au repos), P5 plateau SPP calibré (mono 300 : largeur identique 600,6 mm, hauteur −200 mm, 12,5 s ; corpus 11/11 ×2 ; benchmarks régénérés), P6 **clos sur le socle** (plus aucun sous-solve moteur dans le pass grille depuis la compression analytique — rien à paralléliser ; socle bit-identique par pool, part avec U3). Lots UI U0-U2-ter et C1 déployés dans la même fenêtre. **Phase C (diagnostic import) NON FAITE** → reportée en tête de T3 avec 3.2. Leçons gravées : mesures de temps au repos seulement, `QA_OUT` hors OneDrive, répartitions BPP du corpus = bruit run-to-run (deux passages avant de conclure) | Navigateur T-A 9 s ✓, long task < 100 ms ✓, mono 300 ≤ 40 s ✓ ; serveur T-A ≤ 16 s ✓ ; import : ✗ non mesuré |
| **Lot UI « atelier » (démarre à la clôture de P9, en parallèle de la phase B — plan `PLAN-UI-PRO-2026-09-07.md`)** | Six lots : U0 jetons + primitives (0 hex en dur, 1 bouton, 1 champ), U1 coquille et accueil, U2 page projet (carte pré-vol par le pré-contrôle navigateur, canvas héros, réglages en sections), U3 espace de résultat deux volets (après P4), U4 états et a11y, U5 pages secondaires + `DESIGN-SYSTEM.md`. Charte du site (marine / bleu réservé / 4 px), Inter tabulaire pour les chiffres, icônes SVG inline, aucune dépendance. GO visuel du vérificateur par lot sur planche de captures — **U0, U1, U2 : GO (08/09)** ; **U2 déployé prod 08/09** (`c6c7a43`, app seule, aucun worker) ; C1 inscription livré, déployé et **clos** 08/09 (constat prod propriétaire : 1 e-mail admin) ; U3 après P4 | 12 écrans × 2 thèmes × 2 largeurs ; axe 0 sérieuse ; harnais et scripts QA verts sur `data-testid` |
| **Lot C1 « inscription » (après GO U1 passe 2, avant U2 — plan `PLAN-COMPTE-INSCRIPTION-2026-09-07.md`)** | Vérification d'e-mail rendue visible et testée (aide sous le champ, adresse sur check-email, e-mail bilingue, TTL jetons, tests chemin heureux + refus `assertCanNest`) ; un seul e-mail administrateur par inscription (`adminNotifiedAt` + filtre du digest) ; carte newsletter tous les 90 j (fonction pure partagée, PATCH `newsletterAsked`) ; bienvenue hors handler | vitest +≥ 10 ; 1 e-mail admin reçu en prod (constat propriétaire) ; captures formulaire FR/EN × 2 thèmes, check-email avec adresse, carte 90 j ; harnais inchangé |
| **T3 (ouvert le 09/09 — U3 déployé `251d182` ; ~4-6 sem.)** | **0. Lot 5-moteur tranche 1 « dernière tôle »** (`docs/PLAN-DERNIERE-TOLE-2026-09-09.md`, priorité absolue owner 09/09 : tôle partielle finie en SPP de la même direction dans le moteur, compaction −X retirée) ; **1. Phase C + 3.2 robustesse import** (`docs/PLAN-IMPORT-2026-09-09.md`, en parallèle : aucun code produit) (corpus 30 DXF réels, classement sur l'importeur wasm, rapport de réparation côté client, ezdxf en second) — c'est la première cause d'abandon, rien n'est mesuré aujourd'hui ; **2. Lot 5-moteur « un seul post-pass »** : retirer `merge`/`compact` du post-pass des deux langues (mesure corpus : 0 pièce déplacée sur 10 cas sur 11), porter la fusion inter-tôles et la compaction de la dernière tôle dans le constructif BPP (natif ≡ wasm), re-cibler le banc trous (20/40 aujourd'hui) — critère : navigateur ≡ serveur **bit-identique** sur le corpus × 3 espacements ; **3. 3.3 bibliothèque de chutes v1** (rectangulaire) ; **4. U4-U5** (états, a11y, pages secondaires, `DESIGN-SYSTEM.md`) ; rapport imprimable ; AF3 tôle portrait. Ordre 1-2-3 confirmé ou corrigé par le jalon utilisateurs | Import sans réparation manuelle ≥ 95 % sur le corpus ; parité post-pass bit-identique ; « your offcuts are sheets » |
| **T4 (+7-9 sem.)** | Lot 6 (profil cible, transverse, ~~P9~~ — **P9 avancé en phase B du lot 4 sur instruction du vérificateur** : cache de tôle saturée du constructif, bit-identique, wasm rebuildé) ; **3.4 contraintes tôle** ; **3.5 réserve d'amorce** | Grain/zones interdites ; lead-in marqué à l'export |
| **T5 (+10-12 sem.)** | **3.6 remplissage** ; **3.7 coupe commune** (selon son plan) ; décision **API/batch 3.8** (nouveau chantier + pricing) | Clusters à arêtes communes ; GO/NO-GO API |
| Continu | Infra : **homelab overflow = même image que Hetzner à chaque déploiement worker** (contrôle `assert_overflow_head.py`) ; décision split workers homelab (avant T4 — la perf P3 réduit la pression) ; re-mesure business mensuelle (inscrits → payants, rétention) | — |

Dépendances clés : 3.7 après 3.2+3.3 (position de l'auditeur) ; 3.8 après
les lots 2-4 ; 3.5 après 3.1 (le point de départ n'a de sens qu'avec des
calques propres) ; la coupe commune et l'amorce héritent du chantier B
(kerf explicite) ; 3.3 v2 (polygonale) après retour utilisateurs sur la v1 ;
**toute nouvelle passe géométrique (3.5 amorce, 3.6 remplissage, 3.7 coupe
commune) s'écrit dans le moteur, pas dans le post-pass** — le lot 5-moteur
précède donc T4-T5.
Charge : T0-T5 représentent ~12 semaines d'implémentation pour un seul
agent + vérification ; toute semaine passée sur le business (Stripe,
entretiens, premier payant) décale d'autant — c'est voulu, le jalon
utilisateurs prime.

## 5. Registre des décisions owner (ouvertes)

| Décision | Reco | Statut |
|---|---|---|
| Arbitrages techniques du lot 4 et du plan UI | — | **Délégués au vérificateur** (propriétaire, 07/09) : il tranche et informe |
| Webhook Stripe live | — | **Confirmé fonctionnel par le propriétaire le 10/09** ; reste à voir passer un premier paiement réel |
| Infra homelab | Il y a DEUX WireGuard : (1) le VPN personnel du propriétaire vers l'interface admin (LXC maison, pair `10.8.0.3`) — pas concerné ; (2) le conteneur `linuxserver/wireguard` du dossier `/containers/nestorcut-overflow` du homelab (pair `10.8.0.6`), qui relie les trois workers de débordement au Mongo de Hetzner. Le `pull` du 08/09 a téléchargé une nouvelle image de (2) sans recréer le conteneur : le recréer = quelques secondes de coupure pour les workers, rien pour l'admin. Split workers reporté | Ouverte (op à froid, feu vert owner à donner) |
| **Verrou job T-A** (phase B) | Essai plancher P3 20 **manqué** (chute compaction 0,1 : 606,5 contre 520,7 ; temps inchangé) → plancher 30 gardé, **verrou écrit ≤ 16 s** | **Clos 07/09** (vérificateur, arbitrage délégué) |
| **Lot C1 inscription** (vérification visible, doublon admin, newsletter 90 j) | Décisions D1-D8 du plan (mécanisme inchangé ; carte, jamais modale répétée ; 90 j ; `adminNotifiedAt`) | **Tranché 07/09** (vérificateur, arbitrage délégué) — à implémenter après U1 passe 2 |
| **Licence du dépôt public** (`AUDIT-LICENCE-DEPOT-2026-09-07.md`) | Option A + dépôt neuf à historique unique, ancien dépôt privé archivé | **Clos 08/09** ; relecture juridique : le propriétaire fait confiance au montage (10/09), aucune relecture externe engagée — l'objectif est de protéger le travail, la licence non commerciale + les secrets hors dépôt public le font |
| **P6 zones grille en parallèle** | Clos sur le socle (graines par index, spéculation, bit-identique par pool) : sur le corpus le pass grille ne fait plus aucun sous-solve moteur depuis la compression analytique du 29/08 — rien à paralléliser ; sonde `__zoneDiag` conservée, réouverture si `calls > 0` apparaît | **Clos 08/09** (vérificateur) — budget versé au lot 5-moteur ; ordre U3 → colonne navigateur /benchmarks → lot 5-moteur. **Mesure au repos faite (fiche §12.5 bis)** : après-solve 75 / 82 / 70 ms (verrou P4 < 100 ms tenu ×3), aucun timeout sur six passages, solve P6 28-33 s contre P5 32-38 s — socle **déployable avec U3** |
| **Direction sur la tôle partielle (multi-tôles)** | Tôle partielle = résultat SPP des mêmes pièces avec la même direction, calculé dans le moteur à la fin de chaque walk BPP (natif ≡ wasm) ; compaction −X du post-pass retirée (Python + JS) ; recuit et constructif inchangés dans la tranche 1 | **Tranché 09/09** (vérificateur, arbitrage délégué, priorité absolue owner) — `PLAN-DERNIERE-TOLE-2026-09-09.md` |
| **Borne de travail de la finition déterministe** | 4 conservée (dernier palier sans perte de géométrie) ; objectif « L1 < 5 min » abandonné, 9,6 min acceptés, aucun effet en production | **Tranché 10/09** (vérificateur, arbitrage délégué) |
| **Garde de faisabilité de la finition** | Rejet sur le contour seul (borné à space − 0,05), paires en trace ; oracle exact en tranche 2 ; l'écart sous espacement sans recouvrement reste mesuré et affiché en aval (même exposition que tout job mono-tôle) | **Tranché 10/09** (vérificateur, arbitrage délégué) — **clos le 10/09 par la tranche 2** : la garde mesure elle-même, arête↔arête, et rejette sous `space − 0,01` (la tolérance du rapport aval) |
| **Borne de travail de la finition déterministe** | 4 échecs consécutifs — dernier palier sans perte de géométrie ; L1 passe de ~25 min à 9,6 min. L'objectif de 5 min demanderait la borne 2 (`balanced` −1,2 %) ou de ne vérifier la reproductibilité que sur un biais | **À trancher par l'owner** (§14.4) — reco : garder 4 |
| **Écart sous l'espacement de la tôle DENSE (1,883 mm)** | **Deux défauts distincts (11/09, §18)** : (1) le hole-fill navigateur validait avec une distance sommet→segment (4,25 mm là où shapely mesure 0) → recouvrements réels et un job sur douze remboursé : **corrigé, miroir exact des deux langues, GO déploiement (§19)** ; (2) un résiduel 1 sur 24 à 1,8867 mm que le moteur livre tel quel : cause candidate = **embouchure du canal capillaire** (fenêtre 1,70-2,0 mm devant l'embouchure, §19.2), à vérifier sur le dump puis garde d'embouchure dans le moteur (§19.3) | **Priorité 1 en cours** — correctif (1) à déployer, (2) consigne §19 |
| **Réparations d'import (phase C, `docs/qa/import-2026-09-09/synthese.md` §4)** | R1 unités + R3 messages d'abord ; R2 couture des contours précédée d'un **inventaire GitHub** (½ j) : pistes connues `ezdxf.edgeminer` / `ezdxf.edgesmith` (≥ 1.4 : chaînage d'arêtes libres avec tolérance de gap, côté Python) et équivalents Rust pour le chemin wasm | **Tranché par l'owner le 10/09 : important, chercher la solution existante avant de coder** — priorité 2 |
| **Phase C import non produite au lot 4** | En tête de T3 avec 3.2 ; corpus alimenté par les entretiens du jalon | **Décision vérificateur 09/09** — à confirmer par l'owner si le jalon dit autre chose |
| API/batch (3.8) | GO après lots 2-4, pricing à l'usage | Non tranchée |
| Turbo hybride Pro | Reporté (Phase 3 STRATEGY) | Dormante |

## 6. Non-goals (inchangés)

- **Pas de G-code** jusqu'à preuve de marché (surveiller Nestpact).
- **Pas de CAM** : pas de post-processeurs, pas de responsabilité machine.
  Nous rendons la sortie parfaite pour LES outils du client.
- Pas de dégradation moteur en Free (le luxe Pro est le temps, pas la
  qualité — règle gravée §5 STRATEGY).
- DXF simplifié/anonymisé : écarté (casserait le produit).

## 7. Métriques de succès (revue du 09/09)

- **Navigateur (référence)** : T-A (900 pièces, 2 tôles) **9 s de calcul**
  au tier standard au repos (mesuré 08/09, 21 s sur poste chargé — toute
  mesure se fait au repos, `QA_OUT` hors OneDrive, temps = calcul du
  harnais et non `solveDoneAt`) ; mono-tôle 300 pièces **12,5 s** ; long
  task après solve **70-82 ms** (< 100) ; CLS < 0,03 ; grille bit-identique
  navigateur ≡ serveur ✓ ; post-pass bit-identique **après le lot
  5-moteur** ; import wasm sans réparation manuelle ≥ 95 % **(non mesuré,
  phase C)** ; /benchmarks avec colonne navigateur **(à faire)**.
- **Serveur (débordement)** : job T-A ≤ 16 s ✓ ; corpus 11/11 en continu
  ✓ ; physique 0 chevauchement ✓ ; homelab = image Hetzner ✓ (contrôlé à
  chaque déploiement).
- **Produit** : import ≥ 95 % (post-3.2) ; jobs utilisant une chute
  sauvegardée (post-3.3) ; export golden par entité sur les deux chemins ;
  calques par nature (post-3.1).
- **Business** : premier payant (webhook vivant = prérequis) ; rétention
  S1 > 25 % à 3 mois ; conversions Free→Unlimited après le 10e nesting
  réussi — **aucun de ces chiffres n'a été re-mesuré depuis le 28/08**.
- **Confiance** : /benchmarks publiée et régénérée à chaque moteur ✓ ;
  dépôt lisible sous licence non commerciale ✓ ; thread communauté (à
  ouvrir après le jalon).

## 8. Forme des instructions à l'implémenteur (GLM 5.3 Max)

Le vérificateur rédige, l'implémenteur exécute ; le modèle implémenteur
travaille bien sur des consignes fermées et mal sur des questions
ouvertes. Chaque chantier lui est donc remis sous cette forme, sans
exception :

1. **Périmètre fermé** : fichiers et fonctions nommés, ce qui change et
   ce qui **ne doit pas changer** (invariants : déterminisme natif ≡ wasm,
   pool par tier, `space` clé API, comptes par classe, physique).
2. **Verrou chiffré + commande** : la cible, la commande exacte qui la
   mesure (harnais navigateur d'abord, banc serveur ensuite), la
   configuration (deux champs kerf/sécurité, deux configurations du
   harnais), et le nombre de runs.
3. **Ordre imposé** : `assert_images_head.sh` OK avant toute mesure ;
   tests (cargo, vitest, pytest, `determinism_lock.py`) ; mesures ; rapport ;
   déploiement seulement après GO ; déploiement worker terminé sur le
   homelab avec `assert_overflow_head.py` OK.
3bis. **Fenêtre de mesure explicite** : toute statistique de porte
   (écartées, fusion, médianes) se calcule sur les jobs d'une fenêtre
   `createdAt ≥ SINCE` posée au début de la série, et le rapport donne la
   requête — jamais « tout ce qu'il y a en base » (P9 : deux écartées de
   la veille prises pour des écartées du jour).
3ter. **Mesures de temps navigateur** : poste au repos (aucun build,
   aucun autre harnais, agent à l'arrêt), `QA_OUT` hors OneDrive, valeur
   = durée de calcul du harnais (« done (N s) »), jamais `solveDoneAt`
   (qui inclut chargement et import) ; trois passages, les trois valeurs
   dans le rapport. Les répartitions BPP du corpus serveur varient d'un
   passage à l'autre (recuit à température sur le temps) : deux passages
   avant de parler de régression.
4. **Rapport constat par constat** : pour chaque verrou, la valeur mesurée
   et la commande ; les non-faits énoncés ; hashes de commits réels ;
   aucune interprétation (« variance », « tolérance ») à la place d'une
   mesure.
5. **Pas de décision ouverte** : quand un choix se présente, l'implémenteur
   propose **une** option chiffrée et attend ; il n'arbitre pas lui-même
   entre variantes, ne crée pas de troisième copie du post-pass et
   n'ajoute pas de chantier au lot.

