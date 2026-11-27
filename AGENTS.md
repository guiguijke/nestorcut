# AGENTS.md — NestorCut (Nest2D)

Guide de l'architecture et **liste des pièges** rencontrés (avec leur règle).
Objectif : ne jamais refaire ces erreurs. Lis la section Pièges avant de
toucher au moteur, au worker Python ou au visualizer.

> **Mémoire des décisions : le coffre Obsidian privé du propriétaire fait foi
> pour le QUOI et le POURQUOI.** Décisions, spécifications produit, plans,
> procédures et audits ne sont plus dans ce dépôt. Les commentaires du code
> qui citent `specs/…` ou `docs/…` désignent des notes de ce coffre (mêmes
> noms de fichier, conservés comme alias). **Avant de modifier un
> comportement tranché, demande au propriétaire ou lis la note du coffre** ;
> ne recrée jamais de plan, de rapport ou d'audit sous `docs/` ou `specs/`.
> Ce fichier reste la référence des pièges techniques.
>
> **Boussole produit** : la référence du nesting dans le navigateur (pas un
> CAM : ni G-code ni parcours d'outil ; DXF entrant, DXF sortant, rien ne
> quitte la machine) ; tout chantier passe d'abord par le chemin navigateur ;
> un seul code pour tous les chemins. Le dépôt ne garde que
> `docs/dwg-license.md` et `docs/encryption-premium.spec.md` (voir
> `docs/README.md`).

## 1. Architecture

Cartographie complète (topologie, flux, frontières, CI/CD) : la note
`ARCHITECTURE.md` (coffre privé), dont ce chapitre est le résumé tenu à jour.

```
app/ (Nuxt 4, UI)  ──► server/ (API Nuxt, entitlement, SSE)  ──► MongoDB
workers/fileprocessing (DXF → polygonParts)
workers/nesting        (orchestrateur Python → nest-engine (Rust) → DXF/SVG)
workers/common         (worker_common: mongo, crypto, worker_loop, tokens)
workers/nesting/engine (Rust workspace: nest-engine + sparrow vendorisé,
                        jagua-rs = dep crates.io 0.7.2)
workers/geometry       (workspace Rust dual-target: import/export/métriques
                        wasm = chemin navigateur, parité : note PIPELINE-MAP.md, coffre privé)
admin/                 (back-office Nuxt)

DÉPLOIEMENT (schéma : ARCHITECTURE.md §1, coffre privé) :
- Hetzner CX23 (front + workers + Mongo + Caddy)
- HOMELAB (serveur maison) : 3 workers nesting « overflow » (tunnel
  WireGuard 100 % Docker, pair dédié, Mongo prod via un proxy WG-only)
  qui consomment la même file — débordement, aucune donnée locale
  (adresses & procédures : runbook privé, coffre Obsidian)
- Navigateur : mode THIS DEVICE (moteur wasm, résultats IndexedDB)
```

- **Deux modes moteur** : SPP (sparrow = strip packing, minimise la
  largeur utilisée) si **un seul format** de tôle, aire pièces ≤ 80 %
  d'une tôle, ET (`stock === 1` OU directions = `['left']` seulement) —
  un stock déclaré 100 + –X coché doit rester SPP (sinon BPP « rangées »,
  pas une bande). Sinon BPP (recuit simulé maison sur la séquence +
  constructif `HoleFillEvaluator`, minimise le nombre de tôles). Une tôle
  importée d'un DXF (piège 66) force toujours BPP : la tôle n'y est plus un
  rectangle (`localPayloadBuilder.js:1105`).
- **Qualité = 8 walks partout (D-PAY-12)** : `n_workers` BPP = `QUALITY_WALKS`
  ; `RAYON_NUM_THREADS` = vcores du tier (1 / 4 / 8). Le navigateur fait
  la même chose (`walks=8`, `concurrency` = tier).
- **Le worker daemon traite UN job à la fois par processus**
  (`worker_common/worker_loop.py`). Le parallélisme inter-jobs = réplicas
  docker + pool de jetons.
- **Compute par tier** : free 1 / standard 4 / privacy 8 vcores, écrit
  côté serveur dans `params.vcores` (jamais le client). Pool Mongo
  `compute_pool` (`NEST_COMPUTE_TOKENS` = **28, identique Hetzner et
  homelab** — le total est réécrit au démarrage des workers), acquire
  atomique (`$expr used+cost ≤ total`, coût clampé au total), leases avec
  heartbeat, reaper > 60 s, jobs local-prep = 1 jeton.
  Noms code ↔ marketing : `free`/`standard`/`privacy` = Free/Unlimited/
  **Pro** (le tier code `privacy` est le Pro « budget moteur max » — le
  vault ZK n'est plus son exclusivité : opt-in tous plans en Phase 1, voir
  STRATEGY.md, coffre privé).
- **Même qualité pour tous** : arrêt sur plateau partout (BPP : patience
  par walk ; SPP : `PlateauTerminator` sparrow). Le tier ne change que la
  vitesse de délivrance.

## 2. Pièges (règles à respecter)

### Géométrie
1. **Bulge DXF : rayon signé.** `r = d/(2·sin(θ/2))` est signé — il place le
   centre (apotheme signée) mais l'échantillonnage doit utiliser `|r|`,
   sinon l'arc est miré → anneaux auto-intersectants (TopologyException).
2. **jagua n'a pas de pièces à trous** : les trous sont ouverts par un canal
   capillaire (`core/holed_polygons.py`) ; `narrow_concavity_cutoff: null`
   obligatoire sinon le canal est refermé et les trous deviennent
   inaccessibles. Le canal doit être > `space` (inflation) mais ≤ 2.5 mm.
   **Au-delà de ~2.4 mm d'espacement le canal est scellé par l'inflation** :
   ouvrir quand même écrase l'anneau et casse l'import moteur
   (« non-consecutive duplicate vertices » / « Offset resulted in an empty
   polygon ») — ce n'est PAS une dégradation sûre automatique. Toujours
   passer par `channels_usable(space)` : si scellé, laisser les trous
   fermés (outer plein) — trous inutilisés mais job vivant.
2b. **Une largeur de bande n'existe que si son conteneur se construit** : le
   conteneur est DEFLATÉ de space/2, et juste au-dessus de `space` il n'a plus
   de pôle sur une fenêtre qui grandit avec la hauteur, donc jamais de seuil :
   `Strip::try_container` décide (`panic = "abort"`, VENDORED.patch.md point 5).
   `From<Strip>` et `change_strip_width` (qui fait `try_change_strip_width(..)
   .unwrap()`) ne valent que pour une largeur dont le conteneur a DÉJÀ été
   construit. **Deux chemins ne tiennent pas cette promesse, panique restante, connue
   et non corrigée**. Le premier : `nest-engine/src/spp.rs::map_back_solution` (retour de repère
   des directions left, balanced et bottom : les trois font travailler le moteur
   transposé) appelle `import_solution` (jagua-rs `import.rs`), qui fait
   `change_strip_width(corridor)` avec un couloir jamais construit à la hauteur
   d'origine. Sans conteneur : `problem.rs:35` (« no pole found »), abort. Elle ne
   touche que des tôles absurdes. Mesures (natif, direction left, sans espacement,
   une pièce carrée qui tient dans la tôle, réglages du banc), avec le rapport
   H / (W - espacement) : W = 2, H = 6e7 livre (3e7), H = 7e7 panique (3,5e7) ;
   W = 0,2, H = 8e6 livre (4e7), H = 1e7 panique (5e7) ; W = 20, H = 1e9 livre (5e7),
   H = 2e9 panique (1e8) ; W = 2, H = 1e8 panique (5e7). Le rapport ne fait pas un
   seuil : il ne dépend pas que de lui, et aucune valeur n'est à coder. En bottom, le
   retour de repère est un repli (`DirBias::BottomFirst`) : il est pris en une phase
   (`two_phase = false` : W = 2, H = 6e7 livre, H = 7e7 panique) et, en deux phases,
   seulement si la phase 2 échoue ou dépasse la tôle. Des pièces de 1 x 1 n'ont pas
   paniqué (W = 2, H jusqu'à 1e9, jusqu'à 40 exemplaires, 8 graines), 20 pièces de
   1,9 x 0,7 si : W = 2, H = 1e8, payload de `buildLocalPayload`, 7 graines sur 8. Avec
   espacement 2 (W = 10) le job passe par le chemin BPP : refus propre « no pole
   found » à H = 1e9, pas de panique. Elle touche aussi le mode sans `biases`
   (`spp.rs:914` : W = 2, H = 6e7 livre, H = 1e8 panique) et des tôles plates en balanced
   (W = 1000 ou 3000, H = 1e-5, deux phases). Le second chemin : `merge.rs:547` appelle
   aussi `import_solution`, dans le repli sans `used_height`, avec la même panique ; le
   pool ne l'atteint pas, ses runs portent `used_height` (lu dans le code). Le formulaire
   ne bloque pas ces tôles (`isValidNumber`, `files.js` : chiffres seulement ; le
   serveur : > 0 et fini) : 2 x 1e8 mm part au calcul navigateur, et l'issue y est une
   COURSE, pas une affaire de nombre de directions (`localPool.js`, mesuré dans le
   navigateur à W = 2, H = 1e8, sans espacement) :
   - **Le chrono champion part d'abord** (`settleFromChampion`, une direction seulement ;
     `championIdleMs` se réarme à chaque progrès) : le meilleur frame live est livré et
     les workers coupés. Left ou balanced, pièce de 1 x 1 : aucun walk ne répond ni ne
     panique, job livré (1 walk en Free, 8 en payant). Bottom, 20 pièces de 1,9 x 0,7, en
     Free, où les walks tournent un par un : un walk panique (`unreachable`,
     `problem.rs:35` en console), job livré 20/20 quand même.
   - **Tous les walks meurent d'abord** (`checkAllSettled` clôt quand chacun a une issue) :
     rien n'est livré, `engine_error`, 0 pièce posée. Les mêmes 20 pièces en bottom seule,
     Standard ou Pro : 8 walks en parallèle, 8 paniques en 4 s environ, avant le chrono.
     Left + balanced, pièce de 1 x 1 (`multiBias`, pas de chrono, piège 7b : un seul
     survivant aurait suffi à la fusion) : 8 paniques. Message `localMode.crashLocal`
     (`crashError` hors projet local). Rien n'est consommé sur un compte payant
     (`charge.refunded`) ; une charge Free est remboursée (vu sur un crash simulé).
2c. **`geo_buffer` s'effondre sur un canal plus étroit que le gonflement.**
   L'inflation d'import (`space/2`) décale les deux bords d'un canal étroit
   l'un à travers l'autre : le contour rendu se recoupe, `SPolygon::new` le
   refuse, et le moteur MEURT à l'import — « importing SPP instance into
   jagua-rs: Simple polygon contains intersecting edges » ⇒ job en « stopped
   unexpectedly » + remboursement (panne de production sur une volute
   d'atelier, 17 pièces, 2 975 sommets). Et la sortie de `geo_buffer` n'est
   pas réparable : mesuré sur une volute synthétique à canal de 0,3 mm, elle
   rend un contour d'aire 47 mm² pour une pièce de 353 mm² — l'information
   est déjà perdue, aucune union ne la rend. Le **repli** de
   `offset_shape` (patch vendorisé §3, lot E0) RECALCULE donc le gonflement
   depuis l'anneau d'origine : union en arithmétique entière (`i_overlay`,
   règle positive) de la pièce, d'un rectangle par arête et d'un polygone
   32-gone CIRCONSCRIT par sommet — un sur-ensemble de la somme de Minkowski
   exacte (jamais moins d'espacement que promis). Il ne tourne QUE sur
   l'erreur : le chemin normal reste bit-identique (verrou
   `determinism_lock.py`, SHA `b_demo` inchangé). Corollaire : un échec
   d'import moteur doit DÉSIGNER son item
   (`nest-engine/src/import_error.rs` : évènement
   `{"type":"error","kind":"item_geometry","item":k}` + message préfixé
   `item_geometry:<id>:`) — sinon ni le worker ni le navigateur ne peuvent
   nommer le fichier et la pièce, et l'utilisateur lit « arrêté de façon
   inattendue » pour un contour précis.
2d. **Un anneau SIMPLE de `geo_buffer` peut être faux : il se contrôle, il ne se
   croit pas.** Le piège 2c ne couvrait que l'anneau refusé à l'import. Or
   `buffer_polygon_rounded` rend aussi, sans erreur, un anneau simple et
   importable qui est FAUX : plus petit que la pièce, ou qui la traverse
   (volutes : 23 cas sur 252, deux volutes posées à 0,0000 mm réel pour 2
   demandés, `thin_items` vide), ou seulement trop près d'elle. Mesuré sur
   1 915 vraies pièces (230 DXF), à espacement 2 : 351 pièces (18,3 %, 19
   fichiers) avaient un anneau à moins de 0,99 d de la pièce, et la prod
   livrait des paires sous l'espacement sur 2 fichiers de 197 (1,95 mm pour 2).
   Un bon anneau est à 0,9987 d (erreur de corde). `offset_shape` contrôle
   donc chaque gonflement (`inflate_verdict`, lecture seule, une passe sur
   grille), à deux niveaux :
   - **BON** : l'anneau de `geo_buffer` repart tel quel, bit pour bit.
   - **PROCHE** (bord à moins de `0,99 d − 0,001 mm`) : repli
     `robust_inflate_ring`, SANS avertissement (l'anneau de repli est exact).
   - **GROSSIER** (0 ou plusieurs polygones, non importable, aire sous celle
     de la pièce, pièce non contenue, bord à moins de 0,1 d, croisement) :
     repli ET pièce nommée (`note_fallback` → `thin_items` →
     `nest.thinParts`).
   Règles à tenir :
   - **Le contrôle ne casse jamais un job qui marchait** : si le repli échoue
     (ou rend un anneau non importable), on rend ce que l'ancien code rendait
     et on NOMME la pièce — pour les deux niveaux.
   - **Le repli PROCHE est borné en travail** (`inflate_fallback_work`,
     `INFLATE_FALLBACK_MAX_WORK = 3e7`) : 500 sommets dans un rayon de 0,5 mm à
     d = 5 coûtent 255 s. Au-dessus de la borne, l'anneau de `geo_buffer` reste
     et la pièce est nommée. Plus grande vraie pièce du corpus : 76 727
     (390 fois sous la borne) ; aucune vraie pièce refusée sur 7 660 appels.
   - **La grille du contrôle bascule en force brute** au-delà de
     `max(4096, paires/8)` cellules : une spirale carrée tournée de 45° la
     dégénérait (1 311 ms contre 147 ms à 4 002 sommets). Le verdict ne dépend
     pas de la taille des cellules.
   - Rien que de l'arithmétique f64, `sqrt` IEEE et `powi(2)` : pas de
     fonction transcendante (piège 14b), natif ≡ wasm.
   - **Le SHA de `b_demo` passe de `a1bd8810…` à `4ae9473b…`** : ses pièces
     n° 11 et 12 prennent la voie PROCHE. Même résultat visible (304/304,
     2 tôles, densité 0,3753). Les trois autres fixtures du verrou sont
     inchangées.
   - Coût mesuré sur les vrais fichiers (espacement 2) : 12 fichiers sur 197
     changent de voie, largeur de bande médiane 0,00 %, pire +0,30 % ; temps
     médian +7 %, pire +17 % ; les 185 autres sont identiques. Aucune pièce
     posée en moins.
   - Tout changement de seuil rejoue `tests/inflate_invariant.rs`,
     `tests/inflate_fallback_failure.rs` et, sur le corpus privé,
     `tests/inflate_corpus.rs` (`--ignored`, `NEST_C6_CORPUS=<fichier local>`).
   - Dans un test, jamais d'anneau de plus de 4 000 sommets dans `geo_buffer`
     (20 000 sommets : 5,6 Go et plus de dix minutes).
   - L'érosion (`Deflate`) n'est pas contrôlée : comportement d'origine.
3. **`min_item_separation` = inflation jagua** (exacte, ±space/2 de chaque
   côté → séparation totale `space`). Toute validation d'ajustement (filler
   dans trou) doit garantir **distance ≥ `space` à la paroi** : candidat NON
   inflaté ⇒ éroder le trou de `space` en entier (adjonction dilation/
   érosion : filler ⊕ space/2 ⊆ trou ⊖ space/2 ⟺ filler ⊆ trou ⊖ space) ;
   candidat inflaté de space/2 ⇒ éroder de space/2. Sinon promesses non
   tenables (spacingOk=False au rapport).
3b. **jagua droppe les items à demande 0 puis exige des ids consécutifs** :
   l'importeur SPP fait `retain(demand > 0)` PUIS `ensure!(id == index)` —
   une instance réduite (pre-pass meta-pièces J-085) doit être **réindexée
   0..n-1** après suppression d'un item, et `meta["idMap"]` re-mappe
   solutions et live frames vers les ids d'origine. Sinon « importing SPP
   instance … consecutive IDs » → job en échec, serveur ET navigateur
   (panne prod 2026-08-09, filler uploadé avant l'hôte). Corollaire J-085 :
   l'hôte de l'instance réduite est résolu **trous fermés** (anneau externe
   propre) — ouverts, le moteur y placerait les fillers restants que
   l'expansion y rattache ensuite (double-remplissage = overlaps réels).
4. **Polygones placés = anneau externe MOINS les trous.** Avec l'anneau
   externe seul, un filler niché « intersecte » le matériau fantôme du hôte
   (faux badges overlap/gap 0). `_placed_polygon` inclut les trous.
5. **Géométrie libre du trou ≠ géométrie collision** : le trou n'existe que
   côté Python (`item['holes']`), jamais côté moteur.
5b. **Une entité attachée à AUCUNE pièce n'est exportée nulle part.** Le DXF
   de coupe est construit handle par handle
   (`workers/nesting/core/main.py` : `entities_by_handle`), donc un handle
   absent de `part['handles']` est de l'encre perdue EN SILENCE. Le piège :
   l'attachement mesure l'encre par `body.intersection(ink)` et une entité
   qui TOUCHE le corps sans le traverser rend un Point — longueur et aire
   nulles, donc « pas de hit » ; et son centre tombe hors de la silhouette
   puisqu'elle est SUR le bord. Mesuré sur un logo d'atelier : une SPLINE de
   3,66 mm à 0,000005 mm de sa pièce, qui FERMAIT son contour extérieur, était
   orpheline — la pièce éclatée rendait 2 corps et 20 277 mm² au lieu de
   46 858, et son fichier de découpe sortait incomplet. Règle : quand aucun
   corps n'a de mesure positive mais qu'un corps est candidat (déjà borné par
   `probe_tol`), attacher au corps dont le contour est le plus PROCHE ; jamais
   de repli sans borne (une entité vraiment égarée ne doit pas être aspirée
   dans son voisin, elle ajouterait de l'encre étrangère au fichier de coupe).
   Verrous : `test_advanced_import.py` (encre tangente attachée + entité
   égarée laissée) ; A/B corpus : 143/148 fichiers identiques, les 5 autres
   changent SEULEMENT en handles. Lot E2. **Reste 704 entités orphelines sur
   9 fichiers du corpus** (au-delà de `probe_tol`) : annoncées à l'import
   depuis la V0.9.12 (`import.entitiesUncut`), toujours pas découpées, à
   traiter avec la couture des contours.

5c. **Un anneau OUVERT fait mentir la validation physique (constat J4,
   13/09).** `nest-report` balaie ses arêtes par `for i in 0..ring.len() - 1` :
   l'arête de fermeture n'existe pour lui QUE si l'anneau porte son point de
   fermeture dupliqué. Sur un anneau ouvert, `point_in_ring` (lancer de rayon)
   devient FAUX — il déclare des contenances, donc des chevauchements, qui
   n'existent pas, et `finalizeLocal` écarte toutes les alternatives
   (« chevauchements mesurés », remboursement). Tout le pipeline produit des
   anneaux FERMÉS ; un module de géométrie qui travaille en interne sur des
   anneaux ouverts (`openRing`) doit rendre la convention de son ENTRÉE.
   Mesuré : la réserve d'amorce rendait 27 et 41 sommets `fermé = false` là
   où le chemin ordinaire donne `true`, et le job 1 hôte + 4 éventails partait
   en refus alors que la mesure arête↔arête des mêmes poses donnait 3,501 mm
   pour 3,500 exigés. A/B : `Lead in=0` ⇒ aboutit ; réserve sur l'hôte seul ⇒
   aboutit ; réserve sur les quatre éventails ⇒ refusé. Verrou :
   `sheetcamReserve.test.js` « même convention de fermeture ».

5d. **Un point de départ SheetCam tombe le plus souvent À L'INTÉRIEUR d'une
   arête, pas sur un sommet** (mesure du 15/09, étude `.job` §9.69 : 9
   contours sur 11, points AUTOMATIQUES comme manuels, y compris sur un
   arc — un départ à 49 % d'une hypoténuse, à 62,8 mm du sommet le plus
   proche). Toute passe « meilleur point de départ » (§9.58, gelée) doit
   candidater le MILIEU des arêtes et des arcs, pas seulement les sommets ;
   et un point posé à la main reste INTOUCHABLE (§9.59), où qu'il tombe.

### Moteur (Rust / sparrow)
6. **sparrow n'a PAS de borne dure** : une solution « feasible »
   (sans collision) peut dépasser `max_strip_width`. Tout affichage doit
   vérifier `fitsSheet` (largeur ≤ tôle) — sinon layouts hors-tôle à
   l'écran avec badge vert.
7. **Champion lock monotone** : n'afficher qu'un layout s'il est
   *strictement meilleur* que l'incumbent ET `fitsSheet`, avec throttle
   (150 ms). Sans ça, la vue flip-flope entre walks et « les pièces
   tournent ». Un frame hole-fill (plus de pièces dans les trous) bat
   un incumbent de même largeur/densité — sinon la vue live ignore le
   post-pass et le modal « n'a rien à voir ». **Le merge wasm n'est pas
   le champion lock** : il peut rendre un layout plus large que le live.
   `preferChampion` préfixe l'incumbent live s'il bat le rang 0 ; le
   pool s'arrête dès que le champion faisable ne s'améliore plus
   (`championIdleMs`, pas un mur 2 s).
7b. **Arrêt idle champion = f(n), jamais 2 s fixes** : un grand n baisse
    la fréquence des frames live (une eval plus lente). Formule :
    plancher 2 s + 20 ms/pièce, au moins 2× l'écart live observé,
    plafond = `plateau_patience_sec` (J-083). 20 pièces ≈ 2,4 s ;
    500 pièces ≈ 12 s. Un 2 s fixe sur 100 hôtes + 400 fillers coupe
    après 0–1 eval. Mesuré 2026-08-17 : 100 carrés 100 mm / 1000×2000 /
    space 2 / –X = bande 614,03 mm (plancher géométrique 610 + 2+2 mm
    de marge tôle) — 6 rangées à 2,00 mm, déjà compact ; un post-pass
    de plus ne gagne rien. **Settle idle champion = mono-classe
    seulement** (mode local, `localPool.js`) : en multi-classes, les
    `strip_width` ne sont PAS comparables (largeur 'left' vs hauteur
    transposée 'bottom') → `liveBetter` ne réarme jamais le chrono et le
    settle tuait le pool pendant que les walks des autres classes
    tournaient (1 seule alternative au lieu d'une par direction, panne
    prod 100+800 pièces / ['left','bottom']). En multi-classes :
    complétion naturelle des walks (budget + plateau chacun) puis le
    merge par classe doit aller au bout ; `preferChampion` reste
    inoffensif (un champion d'unité non comparable ne bat jamais le
    rang 0 du merge).
8. **Two-phase = la machine à remplir les trous** : phase 1 (min largeur)
   puis phase 2 transposée (min hauteur dans un corridor) — le corridor
   serré force les pièces dans les trous. Toute classe directionnelle doit
   avoir SA phase 2 orientée selon son axe, sinon trous sous-remplis.
9. **Séquence initiale ≠ warm-start gratuit** : à ~50 itérations SA/run,
   l'ordre initial domine la trajectoire. Un warm-start intercalé
   hôtes/fillers PERD (fillers ratés cassent le packing des hôtes —
   mesuré, voir `warm_start_160_ab` #[ignore]).
10. **Compteur d'évaluations = cumul du RUN.** Les `sep_stats` repartent de
    zéro à chaque round `separate()` — reporter leur valeur directe fait
    osciller le compteur. Cumuler dans explore/compress (+ base explore
    pour compress).
11. **serde ignore les champs inconnus** : un vieux binaire moteur ignore
    silencieusement les nouvelles clés de config (`biases`, `n_workers`,
    `plateau_patience_sec`) → comportement legacy sans erreur. Après un
    changement de config, vérifier la version du binaire en premier réflexe
    (`NEST_ENGINE_BIN` / rebuild image).
12. **export alternatives : grouper par classe de biais** (ordre canonique
    left/bottom/balanced) PUIS fallback qualité ; le tri Python final doit
    respecter cet ordre quand les tags existent (pas de re-tri global par
    densité).
13. **`import_solution` BPP = `unimplemented!()`** dans jagua 0.7.2 : pas
    de warm-start par placements en BPP. SPP OK.
14. **Plateau = vraies améliorations globales seulement** (nouveau best
    width / compression réussie). Les états de travail (ExplImproving /
    ExplInfeas pendant la séparation) ne doivent PAS réarmer l'horloge,
    sinon le plateau ne déclenche jamais.
14b. **Reproductibilité cross-device ⇒ libm contrôlée** : les
    transcendantales (`sin_cos`/`atan2`/`ln`/`exp`/`powf`) appellent la libm
    plateforme — msvcrt ≠ glibc ≠ Rust libm (wasm32) à l'ulp près, et la
    recherche est chaotique → trajectoires divergentes (mesuré : 7,9 M vs
    4,9 M évals à seed égal). Toute transcendantale du chemin moteur passe
    par le crate `libm` DES DEUX CÔTÉS (jagua `transformation.rs`,
    Box-Muller explicite dans sparrow `explore.rs`, pow/exp du SA BPP).
    `sqrt`/div/mul/add/round sont IEEE-exacts partout, ne pas y toucher.
    Verrou : `workers/nesting/bench/determinism_lock.py` (SHA-256 natif vs
    wasm, tolérance 0) — à rejouer après tout changement de ce périmètre.
14c. **wasm32 : horloge et threads** — `web_time::Instant`
    (jagua l'expose) sur `performance.now`, et **jamais** de soustraction
    naïve `Instant::now() - d` (l'horloge démarre à 0 au chargement →
    underflow/panic : `checked_sub` saturant, voir `progress.rs`). rayon =
    panic au spawn : chemin séquentiel partagé natif-1T/wasm (jagua vendored
    en import mono-thread, pool sparrow off si `n_workers<=1`, `map_workers`
    dans nest-engine). La forme navigateur = **mono-walk**
    (`n_workers=1`, `separator_workers=1`, 1 direction) — identique au
    profil démo produit.
14d. **Verrou latéral sub-mm sur grille serrée** : à space 2 mm, les gaps
    réels du solve tombent à ~1,998 mm → les shapes inflatées (±1 mm) se
    chevauchent de ~0,002 mm et TOUTE sonde verticale à x fixe collisionne
    (tighten/gravité no-op sur un trou interne de grille) ; pire, les
    fenêtres x valides ligne à ligne peuvent être disjointes (chicane).
    Les moves post-pass sont des téléportations : sonder la cible exacte
    via la fenêtre latérale calculée sur le span de destination
    (`settle_with_lateral_window` dans `column_fill.rs`), jamais un settle
    à x unique. Et gardes **granulaires par sous-passe** : une garde
    globale multi-passes jette le travail d'une passe réussie pour la
    régression d'une autre (restore pixel-identical — la cause réelle des
    « même DXF après plusieurs déploiments » de PACKING-X-100-TROU.md (coffre privé)).
    Un restack accepté sans exiger des colonnes compactes commit des
    layouts troués (métriques de sommets aveugles aux trous internes).
14e. **La forme des couloirs est un post-pass, pas une métrique solveur** :
    à largeur égale, le SPP ne distingue pas [19×5+5] de [17×4,16×2] — le
    moignon survit au champion lock. `balance_lane_tops` (column_fill.rs)
    équilibre UNIQUEMENT sur grille uniforme détectée (lanes équidistantes
    ±0,1 mm, cellules identiques, colonnes compactes) et seulement si
    l'écart de comptage > 1 cellule (sinon no-op — [1,2] est déjà
    équilibré). Append au sommet des couloirs courts, jamais d'insertion,
    jamais d'élargissement ; cible canonique = comptages base/base+1 avec
    les cellules en plus à gauche. Piles J-085 déplacées COMPLÈTES (hôte +
    nichés, même delta — holesFilled intact). Corollaire shape : jagua
    CENTRE SUR LE CENTROÏDE, pas la bbox — placer un hôte non symétrique
    via translation = centre bbox le décale (le filler logé « à vue » dans
    la cavité finit dans la paroi → infaisable) : relire la bbox posée.
14f. **Snap des lanes = DERNIER recours, jamais par défaut** : un snap
    systématique retouche (churn µm) des layouts que tighten fermait déjà
    (panne no-op constatée sur 40/50 seeds). Ne le déclencher que si un
    défaut persiste après tighten+consolidate (`has_column_defect`), puis
    re-tasser. La respiration (+ε par gap) n'est engagée que si le pitch
    moyen est quasi au contact (≤ 0,5 µm de marge) ; sinon step = pitch,
    zéro élargissement.
14g. **Frames live = convention EXTERNE (source), jamais interne jagua** :
    `emit_layout` (progress.rs) sérialise `int_to_ext_transformation`
    comme `export_layout_snapshot` — une frame interne (ancrage centroïde)
    décale toute pièce non centrée à l'origine de R(θ)·(−centroïde) dès
    qu'un consommateur reconstruit un résultat depuis la frame (panne prod
    100+800 en mode local : Piece_Fillx4, centroïde +17,66 mm, amas de
    fillers hors tôle ; les hôtes centrés étaient immunisés). Le map-back
    phase 2 `(x,y)->(H−y,x)`, rotation inchangée, s'applique à la transform
    EXTERNE (world = R(+90°)∘world' ⇒ θ conservé même asymétrique). Règle :
    jamais de placed_items live vers l'export sans int_to_ext. Verrous :
    `live_frame_matches_final_export_asymmetric` et
    `live_frame_map_back_matches_phase2_export` (progress.rs) — frame ≡
    export final à l'arrondi d'impression près, pièce asymétrique.
14h. **Frames live BPP : le heartbeat (1 Hz) embarque le snapshot** — en
    BPP une frame `layout` émise seulement sur amélioration de l'incumbent
    gèle la vue pendant tout le plateau du recuit (« 1 maj et c'est tout »,
    démo 2026-08-29) ; le callback `on_heartbeat` reçoit
    `(iterations, &Cost, &BPSolution)` et émet `layout_event()`. Et le
    SÉLECTEUR côté vue doit comparer le `remnant` (seul champ qui progresse
    à bins égaux) sous peine d'ignorer toutes les améliorations du plateau.
14i. **Le wasm garde le même nom de fichier** (`nest_wasm_bg.wasm`) : après
    un rebuild, le navigateur sert l'ANCIEN depuis son cache HTTP — vider
    (fetch `cache:'reload'` ou Ctrl+Shift+R) et vérifier par hash SHA-256
    servi vs local avant de conclure « le fix ne marche pas » (constat
    2026-08-29 : deux sessions de debug sur un wasm périmé).
14j. **Une pièce retirée par la garde d'embouchure se COMPTE, et la fusion
    classe d'abord au nombre de pièces posées.** `guard_layout` peut retirer
    une pièce juste avant `merge_bp_runs` / `merge_sp_runs`. Avant le 11/11 le
    coût du run n'était pas mis à jour : un run amputé gardait son ancien coût
    et pouvait sortir en tête devant un run complet. Désormais
    `guard_bp_runs` ajoute les pièces retirées à `run.cost.unplaced`, et
    `merge_sp_runs` classe au nombre de pièces posées AVANT la qualité, en mode
    plat comme en mode Directions (les champions de classe ne viennent que des
    runs au maximum de pièces posées ; une classe sans run complet ne donne
    pas de champion, ses runs passent dans le reste). À pièces égales, l'ordre
    canonique du piège 12 est inchangé. Tests :
    `tests/guard_merge_cases.rs`.
14k. **Le constat « pièces à traits fins » passe par sept maillons, et chacun
    peut le perdre sans qu'aucun test moteur ne le voie.** Constat du 14/11 :
    la ligne `nest.thinParts` n'était visible sur AUCUN chemin depuis le 25/10
    (`RESULT_FIELDS` ne portait plus `thinParts`) ; sur l'appareil elle se
    perdait en plus à la fusion des walks et au règlement idle du champion, et
    sous réduction J-085 elle nommait le mauvais fichier. La chaîne :
    - moteur : `note_fallback` → évènement `{"type":"import","kind":"thin_items"}`
      ET `out.thin_items` (la fusion wasm rend une liste vide : « rempli par
      l'appelant ») ;
    - `public/workers/engine.worker.js` relaie l'évènement en `{jobSlug, thin}`
      (un règlement idle du champion n'a jamais le résultat final d'un walk) ;
    - `localPool.js` : `pool.thinRelayed` + `walkThinItems`, posés par
      `withThinItems` sur TOUT règlement `ok:true` (champion idle, mono-walk,
      fusion, livraison dégradée). Un nouveau règlement passe par là ;
    - `localJobPrivate.js` : `thinPartsSummary(items, itemMap, meta.idMap)` —
      le moteur nomme des ids RÉDUITS (J-085), l'itemMap porte les ids
      d'origine ; un id hors de l'idMap est écarté, jamais deviné. Côté worker
      Python : `thin_items_original` dans `_on_engine_event`, même règle ;
    - liste TRIÉE (pièces nommées d'abord) puis bornée à 50, et le vrai nombre
      part à côté (`thinCount`) : `local-quota` et `main.py` l'écrivent sur le
      job, jamais sous la longueur de la liste ;
    - `resultcontroller.js` : `thinParts` et `thinCount` dans `RESULT_FIELDS`
      ET dans le mapping, coupés à ce que la ligne affiche (3 noms + compte) —
      ce flux part à chaque changement ;
    - `ResultModal.vue` → `composeThinPartsLine(liste, fichiers, t, total)`.
    Un changement sur un maillon se vérifie À L'ÉCRAN, sur l'appareil et sur
    le serveur, avec les 67 volutes à espacement 6 (39 pièces nommées) : les
    tests unitaires de chaque maillon étaient verts pendant que la ligne
    n'apparaissait nulle part. Un résultat ouvert sur un autre appareil n'a
    pas de rapport, donc pas de ligne (voulu).

### Métriques & pipeline Python
15. **largest_empty_rectangle : compter les sommets DES TROUS** dans le
    budget exact (anneaux 64-gons → le scan explose, worker bloqué des
    heures). Budget : 60 pièces / 600 sommets (outer+holes), garde-fou
    grille 40 000 → repli band offcut (exact pour les chutes en bande).
16. **Seed Mongo = BSON Int64** : sérialiser en `toString()` côté API,
    sinon `{low, high, unsigned}` à l'écran.
16b. **Seeds 63 bits côté JS : BigInt ou string, JAMAIS de JSON.parse nu** :
    `JSON.parse` arrondit tout entier > 2^53 (un seed `…84961` devient
    `…84900`) — tie-breaks et replay dérivent silencieusement. Pool
    J-093 : seeds calculées en BigInt (`localPool.deriveSeed`), réécrites
    en string sur les runs du merge (le JSON.parse du worker les mangle) ET
    re-patchées depuis la string brute de sortie du merge ; `prng_seed` du
    merge est un placeholder 0 (le parse EngineConfig exige u64 — la string
    63 bits serait manglée en number). Tout nouveau passage de seed par du
    JSON JS doit garder la forme string.
17. **Le seed déterministe exclut la config** (instance+space+budget) :
    modifier `config.json` ne change PAS le seed → A/B à seed égal
    gratuits.
18. **Le worker `$unset` doit couvrir tout champ éphémère** (progress,
    liveLayout, itemMap, compute) à la fin du job.
19. **`docker rm -f` = SIGKILL** : le handler SIGTERM du worker_loop ne
    s'exécute pas → job orphelin « processing » + lease de jetons bloquée
    (reaper après 60 s). Préférer `docker stop`.
19b. **Densité du rapport = aire vraie des pièces placées / aire tôle,
    MESURÉE** (`per_sheet_metrics`, polygones placés trous soustraits) —
    jamais la density déclarée par le moteur, jamais un bbox. Les champs de
    rapport sont ADDITIFS (`report.sheets[]`, `report.totals{}`,
    `report.offcut` enrichi) : aucun champ existant renommé/supprimé, les
    anciens jobs gardent l'affichage legacy. Chute « réutilisable » si
    min(w,h) ≥ `OFFCUT_REUSABLE_MIN_MM` (100 mm) — conservateur (« au
    moins »), l'offcut est le plus grand rectangle vide GARANTI.

### Frontend
20. **Apostrophes françaises dans `app/utils/i18n/fr.js`** : utiliser des doubles quotes
    pour les chaînes contenant `'` (sinon PARSE_ERROR au build).
20b. **SVG y-down vs moteur y-up : le flip est OBLIGATOIRE** — tout rendu de
    placements (live view, SVG résultat coloré) doit dessiner avec
    `translate(x, H-y) scale(1,-1) rotate(θ)` (les coords jagua/DXF sont
    y-up). Sans le scale, la feuille entière est MIRÉE verticalement par
    rapport à la vue DXF (rotate SVG horaire = rotation moteur anti-horaire
    une fois flippée — la formule est exacte, verrou :
    `test_svg_colored.py::test_transform_matches_the_production_dxf`).
21. **`var(--background-secondary)` est sombre** dans ce thème : ne jamais
    compter sur les vars de thème pour un canvas lisible — palette
    explicite (fond clair, pièces accent, texte foncé).
22. **Ids SVG uniques par instance** (clipPath) : plusieurs visualizers sur
    la même page.
23. **`$fetch` en auto-import Nuxt, jamais via `useNuxtApp()`** : 
    `nuxtApp.$fetch` peut être undefined → le fetch échoue dans le
    try/catch, le cache géométrie reste vide et **aucune pièce ne se
    dessine** (bug muet, vu en prod).
24. **Toute stat affichée porte un libellé visible** (« 144 M combinaisons »,
    « ×4 cœurs ») — un nombre nu (« 37.6 M », « ×4 ») est
    incompréhensible. Et le texte sur fond foncé utilise des couleurs
    explicites (#eef2f7 / #b8c2d0 / #6ea8ff), jamais les vars de thème
    (bleu sur bleu marine ici).
24b. **Stats live en Mode Local = forwarding explicite** : engine.worker.js
    ne poste au thread principal QUE les types d'événements explicitement
    routés (layout, evals/heartbeat) — un nouveau type d'événement moteur
    est droppé silencieusement et la stat correspondante ne s'affiche
    jamais en local (le chemin serveur, lui, lit tout : l'écart passe
    inaperçu tant que le local n'est pas le défaut). L'agrégation pool =
    **banque anti-reset PAR SLOT** dans localPool.js (le compteur wasm
    repart à zéro entre phases — miroir navigateur du #10). Et la page
    doit fournir des `compute`/`progress` synthétiques à LiveNestingView :
    ils étaient `null` en local → compteur de combinaisons et ×N cœurs
    jamais visibles (constat 2026-08-12, la vue SSE avait tout).
24c. **CSP `connect-src` doit inclure `blob:`** : dxf-viewer `Load({url})`
    fait un `fetch` sur l'URL. Les jobs locaux hydratent le DXF via
    `createObjectURL` (`localHydrate.dxfToBlobUrl`). `img-src blob:` ne
    couvre pas le fetch — sans `blob:` dans `connect-src`, Firefox
    affiche « NetworkError when attempting to fetch resource » (l'aperçu
    SVG data: continue de marcher). Constat prod 2026-08-22.

24d. **`app/assets/scss/global.scss` N'EST PAS une feuille globale** :
    vite l'injecte (`additionalData`, nuxt.config) en tête de CHAQUE bloc
    `<style lang="scss" scoped>`, et le compilateur SFC suffixe le dernier
    sélecteur de chaque règle avec l'attribut de portée. `.main` y survit
    (l'élément porte l'attribut — 94 `.main[data-v-…]` dans le CSS bâti),
    `body`/`html` non : la règle devient `body[data-v-…]`, morte. La
    conséquence a vécu en prod jusqu'au 2026-09-09 : la police du corps
    n'était posée que sur `.main`, or `DialogWrapper` téléporte vers
    `<body>` — TOUS les dialogues (résultat, newsletter, suppression)
    s'affichaient en **serif par défaut**. Toute règle qui doit porter sur
    `body`/`html` va dans `app/assets/css/main.css` (seule feuille
    réellement globale). Verrou : `font-family` calculée sur `.modal-body`.
24e. **« Désactivé » par une CLASSE n'est pas désactivé** : `MainButton`
    ne posait que `button--disabled` (`pointer-events: none`) — la souris
    était bloquée mais le bouton restait tabulable, activable au clavier et
    annoncé actif par un lecteur d'écran. L'attribut `disabled` (ou
    `aria-disabled` + `tabindex="-1"` sur un `<a>`) est obligatoire. Effet
    de bord typique : Playwright `isDisabled()` rend `false`, chaque clic
    part en timeout d'actionnabilité (30 s) et le harnais capture des états
    fantômes.

### Unités (mm canonique + inches)
25. **mm canonique interne, conversion aux 3 frontières seulement** :
    import DXF (`$INSUNITS` → mm dans `dxf_utils.read_dxf_file`), UI
    (display/saisie via `app/utils/units.js` + `useUnit`), export DXF
    (`params.outputUnit` écrit serveur). Jamais d'unité dans le pipeline,
    le moteur ou Mongo.
26. **Import = decompose PUIS scale** : `recursive_decompose` d'abord (les
    INSERT de blocs sont résolus en primitives), `Matrix44.scale(f,f,1)`
    ensuite — scaler le modelspace avant decompose laisserait les
    définitions de blocs non scalées (verrou : `test_dxf_units.py`).
27. **`ezdxf.new()` déclare des MÈTRES** (`$INSUNITS=6`) : tout doc reconstruit
    doit poser `$INSUNITS=4` + `$MEASUREMENT=1` explicitement. Les copies
    pipeline (bucket validDxf) sont déjà en mm — les relire avec
    `normalize_units=False` (les copies pré-feature déclarent 6 avec du
    contenu mm : re-normaliser = ×1000).
28. **Export = pleine précision + en-têtes cohérents** : ×1/25,4 exact,
    `$INSUNITS=1` + `$MEASUREMENT=0` pour les pouces. Zéro arrondi
    géométrique ; le 0.001" est une affaire d'UI uniquement.
29. **Env nitro : `NUXT_PUBLIC_FOO_BAR` → `public.fooBar`** — la clé config
    doit matcher le nom camelCase COMPLET de la variable
    (`NUXT_PUBLIC_UNIT_SWITCH_ENABLED` → `unitSwitchEnabled`, pas
    `unitsEnabled`). Et l'override runtime arrive en **string** (`'true'`),
    jamais en booléen : tester `=== true || === 'true'`.
29b. **Une clé partagée serveur+client exige DEUX mappings ou une vérité
    serveur** : `NUXT_ADMIN_LAN_OPEN` ne mappait que la clé PRIVÉE — le
    garde client (clé publique restée false) croyait le mode sécurisé et
    bouclait /setup ↔ / à l'infini (needsSetup + admin virtuel `lan`),
    page jamais hydratée, clics morts (panne prod 2026-08-12, fiches users
    inaccessibles). Règle : le garde côté client doit trancher sur la
    **réponse du serveur** (`/api/auth/me` renvoie l'admin `lan`) et/ou
    miroir `NUXT_PUBLIC_*` explicite dans compose. Corollaire :
    `runtimeConfig.public` est **figé** en Nitro récent — un plugin qui
    assigne `config.public.x = …` crash le boot (Cannot assign to read
    only).
29c. **Alias `~~/shared` sur Windows hôte** : Nitro réécrit trop de `../`
    et résout `C:\Users\…\shared\…` (module introuvable, boot mort).
    Imports serveur = chemins relatifs ; `nuxt.config.js` déclare
    `#shared` / `~~/shared` + `nitro.externals.inline` pour
    `shared/constants`. Les SFC Vue gardent `~~/shared` (le build
    Docker Linux casse si on les convertit en relatifs trop profonds).
    **Corollaire mesuré au lot J4 : un `app/composables/*.js` atteint par un
    import DYNAMIQUE devient son propre chunk, et le bundle serveur réécrit
    alors ses imports relatifs depuis l'emplacement du CHUNK, pas de la
    source** — `../../shared/x.js` devient `../../../../../shared/x.js` et ne
    résout plus (« RollupError: Could not resolve »). `npx nuxt build` sur le
    poste passe, `docker compose build app` REFUSE : c'est le gate qui
    l'attrape, d'où la règle « images à HEAD avant tout banc ». Depuis
    `app/`, on importe `shared/` par l'ALIAS, jamais en relatif. Élargir
    `nitro.externals.inline` à tout `shared/` ne corrige PAS ce cas (essayé,
    mesuré, annulé) : l'échec est au bundling, pas à l'externalisation.
30. **`watch` dans un composable singleton = scope du 1er appelant** : il
    meurt au démontage du composant (changement de layout à la navigation)
    et un garde `initialized` empêche toute réinscription → enregistrer le
    watch dans un **plugin** (scope app, immortel, `app/plugins/*.client.js`)
    et sourcer `useNuxtData('user')` (cache hydraté, réactif) plutôt qu'un
    store alimenté par middleware. **La persistance aussi** : le PATCH de
    préférence doit se conditionner à `useNuxtData('user').value?.id`, pas à
    `authStore.userIsSet` — sur un chargement SSR frais le store client
    démarre à `false` tant que le middleware n'a pas rejoué `setUser`, un
    switch rapide perdait le PATCH et le watch DB ramenait l'unité à
    l'ancienne valeur (flip-flop pouces→mm quelques secondes plus tard).

### Formats d'import (DXF + SVG + DWG)
31. **Détection par signature de contenu, JAMAIS par extension** : les slugs
    d'upload finissaient historiquement tous en `.dxf` quel que soit le
    format réel — `core/format_detect.py` lit les magic bytes (`<svg`,
    `AC10xx`), point d'injection unique `_make_dxf_copy`. La copie
    `validDxf` est TOUJOURS un DXF mm : tout l'aval est format-agnostique.
32. **SVG = px CSS 96 dpi → mm (formule unique)** : svgelements normalise
    unités/viewBox/transforms en px ; `mm = px × 25,4/96` couvre mm/in/px et
    viewBox mismatch (verrou : `test_svg_import.py`). y SVG inversé → y DXF.
    Segments droits = 2 points (sinon un rectangle = 1500 sommets, piège #15).
33. **DWG via `dwgread` (GNU LibreDWG, GPL v3) en subprocess** — jamais de
    linkage, jamais de binaire modifié (mere aggregation, voir
    `docs/dwg-license.md`). R2013+ expérimental → rejet propre avec message
    actionnable, jamais d'import partiel silencieux.
33b. **Import 100 % client (J-090) — deux verrous contre-intuitifs** :
    (a) les **handles canoniques = séquence ezdxf FRAÎCHE** (`2F, 30, 31…`) :
    `read_dxf_file` REBUILD le doc (`entity.copy()` jette le handle source,
    `EntityDB.add` réassigne en séquence hex uppercase) — la « préservation »
    des handles est une coïncidence des copies déjà pipeline ; les entités de
    blocs décomposés prennent les handles frais dans l'ordre d'explosion
    (verrou : `nest-import/tests/handles_canonical.rs`, sweep corpus 41/41) ;
    (b) le **seed canonique JS ≠ Python** : un float intégral s'écrit `1000`
    en JS vs `1000.0` en Python → le seed du flux navigateur est déterministe
    EN LUI-MÊME (le seul pertinent — un projet local ne croise jamais le
    pipeline serveur), mais ne reproduit pas le seed worker à géométrie
    identique. Et : le worker géométrie importe des symboles NOMMÉS du
    bundle wasm — ajouter une op = rebuild `build-wasm.sh` DANS LA MÊME PR,
    sinon worker mort au chargement.

33c. **Profondeur pair-impair : la sonde doit être DANS LA FACE, pas seulement
    dans l'anneau** (défaut de prod du 14/11, import navigateur seulement).
    `interior_probe` avance jusqu'à 1 mm sur la bissectrice d'un coin. Sur un
    cadre à paroi sous 0,7 mm elle tombait dans l'ouverture : le cadre était
    compté vide, ses deux contours partaient par le repli au centroïde
    d'`attach.rs` avec la petite pièce du milieu, et le DXF d'un dessin éclaté
    portait des tracés sur les voisines et hors tôle, rapport vert (les
    contrôles ne mesurent que les contours des pièces). Une pièce dont un trou
    longe le coin sondé disparaissait en entier. Sur une face étroite
    (`open_holes_difference`) la sonde sortait de la face.
    - Tout compte de profondeur passe par `ga::face_probes(_until)` : la sonde
      historique est GARDÉE si elle est dans l'anneau et hors de tout anneau
      plus petit (sortie identique au bit : 293 dessins sur 310), sinon
      balayage horizontal sur la face (anneau moins anneaux plus petits) en
      deux passes : bandes entre les ordonnées de l'anneau seul, puis, si
      aucune ne convient (il faut des anneaux qui se croisent), avec celles
      des anneaux imbriqués. `ring_depths_until` fait le même compte avec un
      rejet par boîte (le plus gros dessin du corpus : environ 90 s → 33 s en
      natif, deux mesures).
    - `dissolve_boundary` passe aussi par la seconde passe pour UN SEUL corps
      dès que deux boucles DIFFÉRENTES partagent une arête (une grille
      dessinée dans une ouverture) : les cases fusionnent en un trou, comme
      elles le faisaient déjà dès que le dessin avait deux pièces. Sans cela
      la sonde corrigée livrait 205 trous jointifs au lieu de 13 sur deux
      dessins réels (anneau ouvert invalide, 2,6 % de matière non couverte).
      Une boucle qui repasse sur sa propre arête (ergot) ne déclenche pas la
      passe : elle ne ferait que réordonner les anneaux.
    - Python n'a pas le défaut (`representative_point` d'une face polygonisée
      AVEC ses trous) : la correction rapproche le navigateur du serveur.
    - Verrous : `nest-import/tests/thin_frames.rs`, tests `face_probe*` et
      `thin_frame*` d'`assemble.rs`, corpus `thin_frame_island`,
      `hole_near_corner`, `frame_in_frame` (goldens Python).
    - NON corrigé, mesuré le 14/11, antérieur au lot : (a) un anneau qui en
      touche un autre en UN sommet (trou rebouché, îlot devenu trou) ; (b) un
      composant de plusieurs faces imbriqué dans une face (écarts avec Python
      dans les deux sens, Python a ses propres erreurs) ; (c) le repli au
      centroïde rattache encore une encre qui ne touche aucune matière à la
      plus petite silhouette contenant son centroïde, même si l'encre en
      dépasse (Python fait pareil) ; (d) `open_holes_difference` sur parois
      fines : « Imbriquer dans les trous » échoue (« chevauchements mesurés »)
      ou livre avec « ✗ Écart » (corrigé le 16/11, piège 33d) ; (e) `pinwheel.rs::interior_probes` garde le
      pas de bissectrice (une rotation perdue au pire, jamais un fichier
      faux) ; (f) le lecteur Python (`recover.readfile`) vide un DXF R12 à
      handles en double ; (g) une encre OUVERTE qui touche une pièce part
      avec elle même si elle en dépasse (étape 2 d'`attach.rs`) : 8 tracés
      sur 6 dessins à plusieurs pièces du corpus, dont un nouveau sur un
      dessin où le lot reconnaît 24 pièces de plus. Aucun contrôle de l'app
      ne mesure les tracés portés par une pièce, seulement son contour.

33d. **« Imbriquer dans les trous » : un trou n'est ouvert que si son canal
    est inoffensif** (règle H, 16/11 ; `holed_polygons.py::plan_channels` et
    son jumeau `nest-preprocess::plan_channels`). Avant, TOUS les trous
    étaient ouverts : sur 246 pièces à trous du corpus, 36 à 46 sortaient
    coupées en morceaux (un canal traverse un autre trou qui a son canal ; le
    plus gros morceau seul était gardé), 56 à 68 laissaient poser une pièce
    sur de la vraie matière, et un cadre à paroi de 0,3 mm perdait une paroi
    entière (« chevauchements mesurés » et remboursement, ou « ✗ Écart »).
    - Décision par trou, dans l'ORDRE DU DESSIN (pas de tri : l'ordre par
      longueur ouvrait 14 % de trous en moins à sûreté égale) : `small` (trou
      pas plus large que 2 largeurs de canal, ou dégénéré), `flush` (touche
      l'extérieur), `conflict` (à 0,01 mm ou moins d'un trou ou d'un canal
      déjà ouvert ; canal contre canal : 0,55 largeur), `deep` (ouvert seul,
      le canal efface de la matière à plus de 0,55 largeur de ce qui reste).
      Un trou fermé reste PLEIN pour le moteur ; la passe finale hole-fill,
      qui travaille sur la vraie géométrie, peut encore le remplir.
    - `deep` échantillonne une grille dans le canal ET les contours coupés au
      canal : la grille seule enjambe une paroi plus fine que largeur/8.
    - Le canal-contre-canal à 0,55 largeur n'est pas un confort : `deep`
      regarde un trou SEUL, deux canaux voisins pouvaient chacun s'appuyer
      sur la matière que l'autre efface.
    - La construction d'UN canal ne change pas. Verrou à tenir : la pièce
      hôte des benchmarks publics (`seed_corpus.py::host_ring`) rend un
      anneau identique à l'octet ; sinon les chiffres publics bougent.
    - Écarts connus serveur/navigateur : égalités de distance du point le
      plus proche (12 trous dans 9 pièces du corpus, une décision) ; contacts
      à 1 ulp, où le Rust ferme par prudence. Le wasm lit ses nombres avec le
      parseur par défaut de serde_json, qui peut se tromper d'un ulp : tout
      contrôle externe d'un anneau du navigateur compare avec une tolérance
      (une comparaison exacte a produit une fausse alerte « trou recouvert »).
    - Côté Rust, pas d'arrangement de toute la pièce par trou (le coût
      croissait en trous x sommets) : voisinage du canal, arrangement
      contrôlé, index par tranches plafonné.
    - Restes connus : la matière abandonnée sous 0,05 mm² n'est pas dans
      l'anneau (deux pièces du corpus à 2 mm, canal jusqu'à 0,81 largeur de
      profondeur, aucune pose possible dedans) ; quand tous les trous d'une
      pièce restent fermés, les appelants la traitent encore comme « à
      trous » (travail perdu seulement).

33e. **Marche des faces : la borne de longueur est 2 x arêtes, pas « sommets
    + 2 »** (`assemble.rs::polygonize_until`, 16/11). Une face qui repasse
    par ses sommets (contour touché par un trait ouvert de 4 segments ou
    plus, parcouru aller et retour) dépassait l'ancienne borne dans un petit
    dessin et était abandonnée EN SILENCE : carré + ligne de pliage sur son
    bord = 0 pièce à l'import navigateur. Verrou :
    `nest-import/tests/open_line_on_outline.rs` (le cas du corpus de parité
    ne discrimine pas : sa seconde pièce ajoute des sommets). Ne pas
    remettre une borne en nombre de sommets : une face n'est pas un cycle
    simple.

33f. **Règle W : un corps plus fin que 0,1 mm dans N'IMPORTE QUELLE direction
    n'est pas une pièce** (18/11 ; `assemble.rs::ring_too_thin` et son miroir
    `worker_common/geometry/cleanup.py::ring_too_thin`, seuil
    `MIN_PART_WIDTH_MM`). Avant, seul le rectangle englobant était regardé
    (largeur ou hauteur sous 0,1 mm) : une lame en biais passait. Une
    polyligne fermée (40,30)-(50,40)-(40.004,30.003) était émise ou écartée
    selon son sommet de départ, pas le même côté serveur et côté appareil, et
    le moteur refusait alors TOUT le travail (« no pole found with 10 levels
    of recursion »). Ce refus du moteur est erratique (il dépend de
    l'alignement, pas d'un seuil net), mais rien d'au moins 0,1 mm d'épaisseur
    n'a échoué.
    - La règle : largeur minimale de l'enveloppe convexe de l'anneau extérieur
      NETTOYÉ (plus petit écart entre deux parallèles qui l'enserrent) sous
      0,1 mm => corps écarté et compté (`import.partsDropped`), juste après le
      test du rectangle englobant. Pas de règle W sur les trous
      (`is_micro_void` s'en charge).
    - Même arithmétique, même ordre d'opérations en Rust et en Python (ni
      `hypot`, ni `sqrt`, ni `mul_add`, comparaisons `<` / `>` écrites, pas de
      `min`/`max`) : même anneau, même décision. Un test relit la constante
      DANS le fichier Rust.
    - **Les calibres tournants ne sont qu'un FILTRE.** En flottant,
      l'enveloppe garde des sommets colinéaires à l'arrondi près, la boucle
      s'arrête sur un faux plateau et rend une largeur fausse et minuscule :
      un carré de 141 mm tourné de 45°, deux sommets en trop sur un bord,
      était écarté. Avant d'écarter, on recalcule l'étendue de TOUS les
      sommets de l'enveloppe par rapport au côté. Ne pas retirer ce balayage.
      Verrous : `nest-import/tests/thin_parts.rs`,
      `TestRingTooThinCollinear`, `corpus_extra/rotated_plates.dxf`. Un test
      par tirage de points quelconques ne voit PAS ce défaut : il faut des
      familles colinéaires / 45° / sur grille, jugées en arithmétique exacte.
    - L'émission Python (`build_geometry.py::to_mongo_dict`) suit maintenant
      l'ordre de `assemble.rs` : anneau extérieur nettoyé SANS son sommet de
      fermeture (shapely répète le premier point ; nettoyer l'anneau fermé
      était le défaut d'origine du serveur), moins de 3 sommets => écarté,
      sommet de fermeture remis, rectangle englobant de l'anneau NETTOYÉ,
      règle W, trous. `width`/`height` sont ceux de l'anneau nettoyé.
      `reduce_ring` n'est PAS changé (cela déplacerait des sommets dans 9
      dessins réels).
    - Serveur : s'il ne reste aucune pièce, `importErrorCode: no_closed_part`
      => la fiche en erreur dit « Aucune pièce fermée trouvée » (clé
      `localImport.noParts`) ; « Éclater » ne fait une fiche que pour les
      corps ÉMIS.
    - Limites connues : (a) une forme concave fine partout (un V aux bras de
      0,05 mm) a une enveloppe épaisse, elle est émise ; le moteur seul l'a
      refusée, l'application l'a imbriquée : erratique, et le message de refus
      nomme le fichier et la pièce. (b) Sur un anneau NON arrondi, des points
      quasi confondus (1e-12 mm) laissent dans l'enveloppe flottante un point
      intérieur : 6 lames de 0,098 à 0,09999 mm gardées sur 500 000 ; hors
      d'atteinte après l'arrondi à 1e-4 des importeurs.
    - Cas de parité avec des pièces TOURNÉES : `compare.py` compare les
      pièces par rang, le Rust les range par (y-min, x-min), GEOS non. Dans
      `rotated_plates.dxf` le carré est placé sous les plaques pour que les
      deux rangs coïncident.
    - Les tests de `workers/fileprocessing` et de `workers/common` tournent
      dans la CI depuis le 18/11 (job `tests` de `build-images.yml`, qui
      conditionne la construction des images). Avant, seuls ceux de
      `workers/nesting` y tournaient. Les deux essais DWG aller-retour y sont
      sautés (`dwgread` n'existe que dans l'image du worker) : pour ceux-là,
      lancer la suite dans l'image, avec tout `workers/` monté (ces tests
      lisent aussi `workers/geometry`, que l'image n'embarque pas).

### Server (quotas & promo)

34. **Toute limite user-specific passe par un resolver dans
    `entitlement.js`** — jamais de lecture directe de `FREE_NESTING_LIMIT`
    hors resolver. `effectiveFreeLimit(user)` = snapshot `user.promo` si
    `isPromoActive(promo)` (limite entière > 0 ET campagne non expirée),
    sinon défaut ; les projections Mongo doivent inclure `promo` en entier
    (limit + expiresAt — sinon la majoration est silencieusement ignorée).
    Le snapshot suit la **fin de campagne du code** : la reconduire côté
    admin propage la nouvelle date à tous les bénéficiaires ; promo expiré
    → retour à 10/mois et re-redeem d'un autre code possible. L'ordre de
    charge (grant → abonnement → quota free) prime toujours. Verrous :
    `server/tests/entitlement.test.js`, `server/tests/promo.test.js`
    (`npx vitest run`).
34b. **`crypto.createECDH('secp256r1')` peut jeter `ERR_CRYPTO_INVALID_CURVE`**
    (alias absent de certains builds OpenSSL 3.5, vu sur Node 24 Windows) →
    toujours fallback `prime256v1` (même courbe NIST P-256, format wire
    identique) — helper `createP256Ecdh` (`job-dek.post.js`,
    `verify_jobdek.mjs`). Et **QA curl d'un nesting SERVEUR = tier payant
    obligatoire** : un compte Free est routé `awaiting_local` (calcul
    navigateur), aucun worker ne produit de résultat — granter
    `grantedUntil` en base avant le scénario (verrou D-PRV-7 :
    `scripts/validate_vault_dprv7_e2e.sh`).
35. **Stratégie & tiers : STRATEGY.md (coffre privé) fait foi** (marqueurs
    `[prod]`/`[spéc]`/`[conditionnel]` — ne jamais marquer `[prod]` du
    non-livré). La privacy n'est **jamais une feature payante** : le vault
    ZK est opt-in sur TOUS les plans — le gate `hasPrivacyTier`
    (tier `privacy` requis) est legacy, son retrait est un chantier Phase 1.
    Pro 39 € = budget moteur max + file prioritaire ; le moteur n'est
    dégradé pour personne (le budget temps est le luxe Pro, pas la qualité
    de base). Toute revendication publique = feature flag vérifié en prod
    avant publication ; les promesses privacy exactes par mode (Local /
    Serveur / Vault ZK) sont dans THREAT-MODEL.md (coffre privé) — ne jamais
    promettre « nous ne pouvons pas vous lire » en mode serveur.
36. **Purge GridFS = delete par bucket, jamais un TTL seul** : un index TTL
    sur `<bucket>.files` supprime le doc mais laisse les `.chunks`
    orphelins. Le sweeper 24 h (`server/features/purge/sweep.js`, plugin
    `server/plugins/purge.js`, D-PRV-10) passe par `bucket.delete(_id)` et
    marque `purgedAt` les docs job/fichier (l'UI affiche « expiré » et
    masque les téléchargements ; les scalaires du rapport persistent).
    Exemptions : vault = `metadata.enc` (blob) / `encPolygonParts` (doc),
    démo = `ownerId 'demo'`. Verrous : `server/tests/purge.test.js`.
36b. **Plugins Nitro de démarrage (dev hôte Windows)** : pas d'alias `~~/`
    dans le code chargé par un plugin au boot (imports relatifs, pattern
    `4_demoProjectSeed.js` — sinon « Cannot find module 'C:\shared\…' » en
    dev), et **jamais de timer `unref`** (la boucle d'événements du worker
    dev se vide → « worker exited with code 0 »). Le flow docker/prod ne
    montre aucun des deux — seul le dev hôte les révèle. Et cargo :
    `panic = "abort"` en profile.release est redondant pour wasm32 (défaut)
    et casse `cargo test --release` natif dès qu'un test d'intégration
    (tests/) existe — ne pas le remettre (workers/geometry).
37. **Grant admin à tier variable (D-PAY-11)** : `grantedUntil` +
    `grantedTier` ('standard'|'privacy', absent = 'standard' — les grants
    historiques sont inchangés). Un abonnement Stripe actif prime TOUJOURS
    sur le grant (ordre de charge, #34). `free-month` écrase `grantedTier`
    à 'standard' pour ne pas laisser survivre un Pro de test. Résolution
    unique dans `getComputeTier` (projection Mongo incluant `grantedTier`).
    Verrous : `server/tests/entitlement.test.js` (5 cas grant tier).
38. **Chaîne « email fin de nesting » — RÉSOLUE PAR RETRAIT** (décision
    du propriétaire 24/09, lot M2) : `emailNotify: 'need_notify'` n'était
    produit QUE par `nest/[slug]/notify.post.js` (zéro appelant) → le
    plugin `2_nest-notify` ne déclenchait jamais, alors que pricing/
    STRATEGY annonçaient les notifications email en paid. Le propriétaire
    a tranché : **retirer le claim + les 3 maillons** — fait au lot M2
    (promesse retirée du site ×6 langues, clé morte supprimée ×6 dicts,
    `notify.post.js` + `2_nest-notify.js` + champ `emailNotify` supprimés,
    balayage résiduel propre).

39. **Le test SPP « tout tient sur une tôle » mesure l'aire ENVELOPPE** :
    l'aire nette (trous déduits) passe à tort sur les pièces à
    découpes — le mode bande est forcé avec des pièces qui ne tiennent
    pas (démo 2026-08-29 : ratio net 0,75 vs enveloppe 0,93 → 3 tôles
    écrasées en 1, chevauchements). `total_outer_area` pour `is_spp`
    (main.py + localPayloadBuilder.js), l'aire nette reste pour la
    densité.
40. **Le champion live (préférence d'une frame convergée sur le merge)
    est SPP-ONLY** : en BPP une frame en cours d'optimisation n'est pas
    une solution (pièces en vol, hors tôle) — `preferChampion`/
    `settleFromChampion` gardés par `pool.isSpp` (localPool.js). Symptôme
    signature : layoutCount 1 + share ~1,0 sur un job multi-tôles.
41. **Alternative structurelle = vue ORIGINALE + auto-suffisante** : la
    pré-passe « trous d'abord » peut vider l'instance de sa classe petite
    (demande exacte) — le pass grille consomme les quantités COMPLÈTES
    (parts), ordre A→C→trous→B, remplit ses trous lui-même, et la
    finalisation SAUTE pour CETTE alt le remap idMap + l'expansion meta +
    applyHoleFill (sinon : ids corrompus, fillers doublés, fans des zones
    téléportées). `structure.py`/`structureClient.js`/
    `localBridge.js`/`main.py` (2026-08-29).
42. **Lattice analytique = TOUT-OU-RIEN par zone** : un sous-solve moteur
    lancé dans une zone déjà pavée écrase le lattice (il ne voit pas les
    pièces posées) ; et sa validation doit exigér `space +
    2×NEST_SIMPLIFY_MM` — le DXF exporté copie les courbes BRUTES alors
    que le layout se calcule sur les anneaux simplifiés (0,08 mm mesuré
    vs 0,1 exigé avec la validation naive).
43. **Un endpoint consommé EN MASSE par la page ne peut pas partager le
    budget anti-brute-force** : /api/files/project/geometry/ = un appel
    PAR FICHIER par chargement (24 pour la démo) vs 30 req/min/user →
    429 en cascade sur tout /api/files (constat 2026-08-29). Budget
    séparé (180/min, clé suffixée) dans 5_files_ratelimit.js.
44. **SVG d'alternative : `alt.svg_files[0]` ne correspond PAS au rang
    affiché** — la grille structurelle est APPENDUE en dernier rang
    moteur puis triée en tête à l'affichage : les fichiers portent
    `_alt3_` pour la stratégie grid d'un job à 3 alts moteur. Vérifier
    par `strategy` du doc, jamais par l'index du nom de fichier.
45. **Le garde anti-perte côté client aussi** : une alternative
    structurelle incomplète ne doit jamais remplacer le résultat moteur —
    `placed_items.length !== totalRequested → null` dans
    buildGridAlternative (bug réel : placements de zone B non poussés,
    689/900 livérés).
46. **14g s'applique au BPP AUSSI** : `layout_event` (bpp/mod.rs) doit
    composer `int_to_ext_transformation(d_transf, pre_transform)` comme
    `emit_layout` SPP — jagua centre chaque pièce au centroïde à l'import,
    une frame `d_transf` nue décale la pièce de son centroïde à l'écran
    (défaut préexistant, devenu très visible au 1 Hz du heartbeat B.4 ;
    l'export final, lui, compose toujours — une vérif physique de l'exporté
    ne peut pas l'attraper, il faut un verrou frame-live ≈ export BPP).
47. **Job local : `projectSlug` immuable, live filtré par projet.**
    `ensureJob` ne réécrit JAMAIS le `projectSlug` d'un job déjà
    queued/running/done — un `watch` immediate sur la page B (liste SSE
    encore celle de A le temps que UserResults reconnecte) volait le job
    et peignait le live de A sur B (`progressFor('A')` vide = « reset »).
    Pickers (`pickLiveJob` / `pickAwaitingLocal` / `pickRunningJob`)
    exigent `item.projectSlug === page` (les items SSE portent le champ,
    additif). `progressFor` null ⇒ vider les refs live de l'instance page
    (le composant `[slug].vue` EST réutilisé entre A et B).
    Verrous : `app/tests/localSolverRegistry.test.js`, `liveJob.test.js`.
    Corollaire : `[slug].vue` est réutilisé — un fetch `data` de setup (démo)
    ne doit JAMAIS alimenter `isDemo` / `projectFiles` après navigation.
    `watch(pageSlug, getProject, { immediate: true })` est la source de
    vérité ; `isDemo` = slug === `DEMO_PROJECT_SLUG` uniquement.
48. **`rotatedBbox` 90° = `(-y, x)`, comme `rotateRing` / le moteur.**
    Un `(y, −x)` (sens horaire) sur une pièce non centrée (Fillx4 :
    y ∈ [2,8 ; 30,8]) produit une bbox **autre** que le polygone tourné.
    Conséquences : clip du zigzag R90 (144 → 72 cellules dans le L),
    `layoutUsedExtent` faux dès qu'un filler est à 90°. Verrou :
    `app/tests/structureClient.test.js` « R(90)=(−y,x) ». Python
    `_rotated_bbox` est le miroir. Corollaire grille : le zigzag calibré
    0/180 se **tourne** (R90 du pavage, distances conservées) — on ne
    recalcule pas px/py sur la bbox 90°. Score d'une zone : max N
    (jusqu'à `want`) puis bord min sur l'axe objectif.

49. **Garde faisabilité = w + 2·space, pas w + space.** jagua offset
    space/2 sur l'item ET le conteneur (import.rs). `w + space <= sw`
    laisse passer 8×8 / tôle 10 / space 2 → panic SPP lbf.rs
    « strip-width is running away » (panic=abort). BPP dégrade.
    Verrou : test_feasibility_guard + localPayloadBuilder.test.js.
50. **Pass structurel : légalité, pas seulement le compte.** Le lattice
    ne pose que des angles ∈ rotations demandées (rotationCount=1 →
    pas de 180/90). plan_lattice return None si la grille rect sort
    de la tôle. Filet final : alt structural avec insideSheet=false
    → repli moteur (verify_layout déjà le savait, ce n'était qu'un
    badge). Ne PAS jeter les alts moteur hors tôle (piège #6).
    transposedBbox = R(-90)=(y,−x), distinct de rotatedBbox(90)=(-y,x).

51. **BPP multi-tôles : le constructif ne backfill pas les bandes.**
    [2026-09-03 : cause racine CORRIGÉE — décision de tôle PAR TÔLE dans
    le constructif (growth==0 puis first-fit, steer marginal). Le
    post-pass résiduel reste en FILET de sécurité (banc : moved tombe de
    694 à ~517), ce paragraphe décrit l'ancien comportement.]
    Perte = croissance de bbox ; séquence gros-d'abord → les petites
    pièces libres s'empilent sur la DERNIÈRE tôle (bbox encore petite)
    et laissent 80 mm vides sur les précédentes. Le SA permute une
    séquence, il ne pose pas — changer le coût remnant ne suffit pas.
    Post-pass `fill_residual_bands` (après hole-fill) : lattice dans
    5 rectangles (4 côtés clipés à l'AABB + coin), inset space.
    Identité tôle = index de `layouts[]`, pas `container_id` (stock
    N du même format = N layouts, même id). Hôtes et pièces dans un
    trou : immobiles. Validation = BATCH SEULEMENT (les paires
    préexistantes ne sont pas re-jugées : les jumeaux expand_meta à
    distance 0 paralysaient la validation whole-sheet). Échec →
    rollback batch, alt intacte.
    Verrou : test_residual.py / residualClient.test.js + banc
    seed_bpp_2sheets.py.

52. **BPP : les tôles partagent le repère de coordonnées — tout
    post-pass POOLÉ à travers les layouts est faux.** Constat
    2026-09-01 (2×1000×1000, trous coïncidants par grille canonique) :
    `apply_hole_fill` poolé classait les fans nichés d'une tôle comme
    occupants du trou coïncidant d'une AUTRE → le repli pinwheel posait
    un second pinwheel PAR-DESSUS (paires « jumeaux » à pose identique,
    71 paires/tôle) et téléportait des fans aux coordonnées d'une autre
    tôle. Fix : `_fill_one_sheet_holes` — trous/libres/membres scopés
    PAR TÔLE (miroir JS `_fillOneSheetHoles`). Verrous :
    test_holefill_bpp.py / localBridge.test.js (cas distinguant : trous
    de la tôle 2 vides + libres sur la tôle 1 → RIEN ne bouge).

53. **layoutAabb JS — coquille tx/ty (constat 2026-09-01).** Le miroir
    écrivait `maxy = tx + bb[3]` : après un fill de la bande droite
    (fans à tx≈996), maxy dépassait la tôle → la bande haut redevenait
    dégénérée et n'était JAMAIS remplie (coin TR vide + arrêt « en
    escalier » côté navigateur ; le Python, correct, remplissait tout).
    Toute évolution d'AABB tournée se verrouille par T9 (coin couvert)
    des DEUX côtés — parité chiffrée moved/AABB JS == Python.

54. **La direction d'un job BPP est un objectif de SOLVEUR, jamais de
    post-pass (constat 2026-09-09, plan PLAN-DERNIERE-TOLE-2026-09-09.md, coffre privé).**
    Trois niveaux se cumulaient : (a) le coût du recuit n'a AUCUNE
    direction — `sa.rs::layout_remnant` est la plus grande bande ou L
    libre autour de l'AABB, donc il minimise l'AIRE de l'AABB de la tôle
    partielle, jamais son étendue sur un axe : un bloc carré gagne
    toujours contre une bande ; (b) le biais du constructif est un
    multiplicateur faible (`loss = growth × 10 × (1 + 1,5 × Δextent /
    dimension_tôle)`, soit +5 à +10 %) et le tie-break `BL_X = 10` pousse
    TOUT vers −X, « balanced » compris ; (c) le post-pass de compaction
    était **câblé −X** dans les deux langues, ce qui contredisait
    « bottom » et « balanced » et n'ancrait même pas au coin.
    Correctif : la tôle la moins remplie de chaque walk est REFAITE dans
    le moteur, en SPP de la même direction
    (`bpp/mod.rs::finish_partial_sheet`, natif ≡ wasm), et la compaction
    −X est retirée de `residual.py` / `residualClient.js`. Garde piège #6
    (sparrow n'a pas de borne dure) : si la bande SPP dépasse la tôle, le
    layout BPP est CONSERVÉ (`finish.kept == "bpp"` + raison). Verrous :
    `bench/lock_last_sheet.py` (natif, trois directions),
    `bench/seed_demo_dirs.py BENCH_ASSERT=1` (serveur), `determinism_lock.py`.
54b. **« balanced » de sparrow équilibre les BRAS DE CHUTE, pas le bloc de
    coin.** `spp.rs::balanced_width` (J-088) résout `uw² + (H−W)·uw − A = 0`
    pour que chute droite ≈ chute haut SUR TOUTE LA TÔLE : sur une tôle
    quasi vide (2 à 3 % de matière) cette égalité impose une région LARGE
    ET PLATE (mesuré : x_max 1755 sur une tôle de 3000, le pire des trois
    au critère « min de max(x/W, y/H) »). Et un solveur SPP minimise
    toujours la largeur : on ne peut pas lui DEMANDER un bloc large. Le
    bloc de coin s'obtient en contraignant l'AUTRE axe — bande de hauteur
    cible `y = sqrt(aire_utilisée · H / W)` puis minimisation de la
    largeur dedans (le flux « left »). C'est ce que fait
    `finish_partial_sheet` pour la classe balanced.
54c. **Compaction −X (historique, conservée pour l'alternative GRILLE).**
    `_compact_last_sheet` / `_regrid_helices` restent utilisées par
    `core/structure_multi.py` et `structureMultiClient.js` : détacher les
    libres, RE-GRILLER les hélices en colonnes depuis le bord gauche
    (unités rigides hôte + fans nichées — une fan nichée vit dans le
    polygone externe de son hôte, donc distance aux autres unités =
    celle des hôtes, lattice-validée) PUIS les libres derrière.
    Tout-ou-rien par phase ; hôtes des tôles receveuses JAMAIS déplacés.
    Piège associé : la couverture tôle se teste en BORNES ±ε sur anneau
    BRUT — `covers` strict refuse le simplify (sommet plongé de ~0,05
    sous un bord touché) ET le bruit flottant du lattice calé au bord
    (ty=-2.8000000000000007).

55. **JS : une distance d'anneaux doit être ARÊTE↔ARÊTE (constat
    2026-09-02 « les pièces se chevauchent »).** L'ancien ringDist
    (sommet→arête) ne voyait pas deux arêtes se croisant en leur
    milieu : une paire à 33 mm² de chevauchement rendait 0,11 —
    acceptée. Fix : segSegDist (0 si croisement) ; shapely côté serveur
    a toujours été exact. EN COMPLÉMENT, l'acceptation d'un pas de
    pavage smallLattice se fait sur l'anneau COMPLET et le couple
    (py,px) CONJOINTEMENT (la dichotomie court sur un décimé pour la
    perf, et l'ancien code ne revalidait jamais py×px ensemble — même
    un anneau convexe s'y faisait piéger). Verrous :
    latticeScallop.test.js + dump→shapely (0 chevauchement, min-dist
    1,36 ; l'ancien : 95 paires à 33 mm²).

56. **Un seuil de validation calculé doit être PLANCHÉ À > 0 (constat
    2026-09-02 soir « ça overlappe » navigateur, space 0,1).**
    `validateBatch` JS : `lim = space − 2×SIMPLIFY − EPS` devient
    NÉGATIF à space 0,1 → `dist < lim` ne rejetait plus JAMAIS rien.
    Innocent tant que les zones remplies étaient des bandes extérieures
    (libres par construction), DÈS L'INSTANT où une zone INTÉRIEURE
    (poche du re-grid) est remplie en plusieurs itérations, des poses
    dupliquées à distance 0 passaient — 477 paires à 0 sur le fixture de
    régression, piles de fans visibles chez l'user alors que le serveur
    (seuil `space − ε`) restait exact. Règle : tout seuil dérivé d'une
    soustraction reçoit un plancher strictement positif
    (`Math.max(1e-9, …)`), et toute évolution du pass se verrouille par
    un test qui compte les paires à distance ≈ 0 SUR le chemin
    multi-itérations (pas seulement les comptes de pièces).

56b. **NEST_ALLOW_INVALID_ALTS=1 (debug)** : la finalisation ÉCARTE
    toute alternative mesurée en chevauchement/doublons (A4) ; si TOUTES
    sont écartées, le job finit en erreur avec un message DISTINCT
    (« post-pass validation rejected… », V8) et le navigateur passe en
    local-fail (refund) — jamais un done à 0 pièce. L'échappatoire debug
    livre quand même ces alternatives pour inspection.

57. **Seuil de validation post-pass : space > 0 vs space 0 (A1/D5 puis
    V4, vérif 2026-09-04).** À space > 0 : TOUTE paire à d < space − ε
    est une violation, Y COMPRIS le contact bord à bord à distance 0
    sans aire (une première implémentation ne rejetait que l'aire). À
    space 0 (≤ ε) : le contact est PERMIS, seul le chevauchement d'aire
    est rejeté (Python : intersection shapely > 0,01 mm² ; JS :
    ringsOverlap = croisements propres + centroïde/sommets/milieux
    d'arêtes strictement intérieurs + containment V9 — PAS la
    collinéarité seule). Les DEUX côtés doivent appliquer la MÊME
    politique (V5 : un plancher 1e-9 résiduel côté JS rejetait le
    contact à space 0 — chute navigateur 371 contre 562 serveur).
    Verrous : TestSpace0Validation, TestV4ContactRejectedAtPositiveSpace,
    residualClient « pairViolates ».
58. **Snapshot AVANT toute mutation d'un post-pass multi-phases (constat
    2026-09-03, A2).** Le rollback de compaction restaurait un état
    PRIS APRÈS le re-grid : les hôtes re-grillés recouvraient les libres
    d'origine (47-62 chevauchements livrés). Règle : le snapshot complet
    précède la PREMIÈRE mutation ; sur échec, restauration complète,
    `moved = 0`, `postPass.compactRollback = true` — JAMAIS `moved > 0`
    après un rollback. Miroir exact JS (sentinelle COMPACT_ROLLBACK, un
    catch n'avale qu'elle — D6 : une TypeError doit se propager).
59. **Remnant : PLUS GRAND = MIEUX, partout (constat 2026-09-03, D1).**
    Le moteur maximise le remnant (chute concentrée, Cost.cmp_key le
    négatif) ; le champion live JS le comparait à l'ENVERS, verrouillé
    par un test faux — la vue vivait la frame la MOINS compacte et la
    frame finale post-passée (sans remnant) perdait TOUJOURS contre le
    champion moteur. `ar > br` ; Infinity (frame finale) bat tout.
60. **La vérification ne doit JAMAIS être « skipped » en silence (constat
    2026-09-03, A3/D12).** Le plafond 250 pièces/tôle rendait le cas
    100+800 invisible : overlapFree/spacingOk null, aucun badge — la
    tôle à 3 136 chevauchements passait. STRtree/sweep + plafond 5000 +
    `verifyStatus: measured|skipped` + badge « non vérifié » explicite +
    `duplicatePoses` (la garde par TOTAL était aveugle aux doublons).
61. **Rotations non quart de tour : garde OBLIGATOIRE en JS (constat
    2026-09-03, D3).** `rotateRing`/`rotatedBbox` traitent tout angle
    non multiple de 90 comme 270° — l'UI autorise pourtant
    rotationCount 1..360 (45°, 30°…) : la validation comparait des
    anneaux FAUX et acceptait des poses chevauchantes (navigateur
    seulement, le serveur shapely est exact). Garde en tête de
    fillResidualBands/applyHoleFill/buildGridAlternative + Python
    `_has_non_quarter_rotation` : no-op + postPass.errors, on ne
    « valide » jamais une géométrie qu'on ne sait pas calculer. Et D4 :
    les rotations vivent sur `payload.parts[].rotations` (l'instance
    réduite a des ids réindexés — piège #3b).
62. **Toute manipulation textuelle d'un DXF se fait par PAIRES (code,
    valeur), jamais ligne à ligne (constat 2026-09-14, vue DXF figée).**
    Un DXF est une suite alternée stricte : indice pair = code de groupe,
    impair = valeur — le `DxfArrayScanner` de dxf-viewer lit exactement
    ainsi, toute réécriture doit parcourir `i += 2` et ne retoucher que
    la VALEUR d'un CODE désigné. `uniquifyDxfHandles` testait chaque
    LIGNE contre `'5'` : la VALEUR `5` de la couleur (`62`) du calque
    `BIN_BOUNDARY` était prise pour un code de handle, le `0` de
    l'`ENDTAB` devenait `1`, et `parseLayers` de dxf-viewer bouclait à
    l'infini (un code `0` dont la valeur n'est pas `LAYER` n'avance
    JAMAIS le scanner) — fil principal figé, page morte au clic « Vue
    DXF », deux jours en prod. Corollaire : un exporteur qui change le
    FORMAT d'une valeur (flottant `5.0` → entier `5` depuis le lot 2b du
    12/09) doit rejouer les consommateurs TEXTUELS de sa sortie — avant
    le lot 2b, la collision `'5' === '5.0'` était impossible. Verrous :
    `localBridge.test.js` (couleur 62/5, SPLINE 71/5, drapeau 70/5,
    témoin de non-boucle = le VRAI DxfParser rejoué en worker tué au
    délai, + contrôle négatif sur le texte corrompu) ; harnais
    `scripts/qa-e2e-result-dxfview.mjs` qui OUVRE la vue DXF d'un
    résultat local et exige la page réactive à +5 s — aucun harnais ne
    l'ouvrait, c'est le trou qui a laissé passer le défaut.

63. **Téléchargement Free = les 2 premières tôles, lues dans le NOM du
    fichier, jamais dans l'index d'un tableau (lot V1, 02/11 ; spec
    LOT-V1-TELECHARGEMENT-FREE-2026-11.md, coffre privé).** Le calcul Free n'a plus
    de plafond (O1) : seules bornes, démo comprise, `MAX_SHEETS_PER_JOB` (1000,
    400 `too_many_sheets`) et `MAX_SHEET_FORMATS` (10 types de tôle, 400
    `too_many_formats`, jamais une troncature muette). Le verrou porte sur le TÉLÉCHARGEMENT :
    - **Identité de tôle** : `_part_N.dxf` / `_toleN.job`, parseur unique
      `shared/constants/sheetDownload.constants.js`, plafond
      `FREE_DOWNLOAD_SHEET_CAP` (≥ 2, `payment.constants.js`). Côté
      navigateur `dxfs[]` SAUTE les tôles dont le DXF n'a pas été construit
      (`finalizeLocal.js`) : un index mentirait. Un nom illisible n'est
      jamais verrouillé. Le rang `_altN_` du nom n'est pas le rang affiché
      (#44).
    - **Deux verrous, pour deux lieux de calcul.** Navigateur = verrou
      d'INTERFACE au point d'étranglement `app/composables/localDownloads.js`
      (option `maxSheet`, ouverte par défaut : un appelant oublié livrerait
      tout, d'où le test statique des appelants dans `localDownloads.test.js`)
      — contournable (DevTools, IndexedDB), assumé comme J-057. Serveur =
      verrou RÉEL : route DXF 403 `sheet_download_locked`, route ZIP tronquée
      (`nesting-<slug>-sheets-1-2.zip`), SVG ouvert, Vue DXF masquée sur une
      tôle verrouillée.
    - **Plafond serveur** = `downloadSheetCapForUser` (`entitlement.js`, #34,
      seul lecteur serveur de la constante). Il reprend chez Stripe un
      abonnement stocké actif mais à période échue (comme `assertCanNest`) :
      sans cela un payant dont le webhook est en retard reçoit un ZIP tronqué
      EN SILENCE. Le job est retrouvé par le slug lu dans le nom (index
      `slug`), jamais par un `$or` sur `dxf_files` (aucun index, déclenchable
      à 180/min).
    - **Exception : tôle importée d'un DXF (décision du 20/11, V0.9.17).**
      Pour un compte verrouillé (plafond fini), un résultat qui porte une
      tôle importée a un plafond de 0 : `effectiveSheetCap`
      (`shared/constants/sheetDownload.constants.js`), et `isSheetFileAllowed`
      refuse tout à plafond ≤ 0, même un nom illisible (sinon la règle D2
      le laisserait passer). La décision est prise DANS le point
      d'étranglement `app/composables/localDownloads.js` (`capFor`), pour
      qu'un appelant ne puisse pas l'oublier. Le signal se lit dans le
      résultat STOCKÉ, jamais dans les réglages du projet ni dans la fiche de
      la tôle (une tôle supprimée ou un projet rouvert restent verrouillés) :
      champs du rapport (`report.totals.shapedSheetCount > 0`, une ligne
      `shaped: true`, ou `shapedSheets` / `shapeVerified`, seuls présents
      quand le rapport a échoué : `alternativesHoldImportedSheet`,
      `app/utils/sheetDownloadGate.js`) OU format de la dernière frame
      (`liveLayout.binFormats`, `recordHoldsImportedSheet`, écrit seulement
      pour un job à tôle importée). Sans le second signal, un rapport en
      échec rouvrait les 2 premières tôles. Verrou d'INTERFACE, projets locaux
      seulement, contournable comme J-057. Verrou :
      `app/tests/importedSheetLock.test.js`.

    - **Client** : `sheetDownloadState(user, { paidPlansDisabled, projectSlug })`
      — l'appelant passe TOUJOURS les deux (les défauts verrouillent la démo
      et K en silence). Les `.job` sont jugés sur LEURS noms (`jobGate`), pas
      sur ceux des DXF : l'alternative k d'un `.job` ne suit pas l'ordre des
      DXF (`localJobPrivate.js`, désalignement préexistant).
    - **`filesStore.getters.projectSlug` porte le CHEMIN d'API**
      (`/api/project/<slug>`, `files.js`), jamais le slug nu : « suis-je sur
      le projet du job ? » se teste par `isOnJobProject`
      (`app/utils/resultNav.js`), jamais `=== slug` (toujours faux : le bouton
      « Ajouter k tôles » de la fenêtre de résultat est resté inopérant ainsi).
    - **Suivi** : la liste blanche est `shared/constants/trackActions.js`
      (serveur ET test de parité `app/tests/trackParity.test.js` : un nom émis
      mais absent est rejeté 400 en silence, 38 l'étaient) ; toute valeur
      `data` passe en chaîne (`toTrackData`, `app/utils/track.ts`) — un
      booléen ou un nombre est refusé par l'API. Aucun slug de job dans un
      événement ni dans une URL Stripe.
    Verrous : `sheetIdentity`, `sheetDownloadState`, `sheetDownloadGate`,
    `localDownloads`, `resultNav`, `checkoutReturn`, `capacityPanel`,
    `trackParity` (`app/tests/`) ; `sheetCap`, `downloadSheetCap`,
    `resultZip`, `resultDxfGate`, `billing`, `trackAllowlist`
    (`server/tests/`) ; harnais navigateur `scripts/qa-e2e-free-lock.mjs` (huit
    scénarios ; la base locale doit contenir un document `subscription_plan`,
    recette en tête du script).

64. **Un chunk JS perdu au démarrage laisse une page affichée mais morte
    (constat prod 04/11, `/auth/local`).** Le HTML vient du serveur, donc la page
    a l'air prête ; sans hydratation, aucun bouton ne répond. Une 522 Cloudflare
    arrive après ~15 s : l'import partage alors le préchargement encore en vol et
    échoue avec lui, sans nouvelle requête (une 522 IMMÉDIATE, elle, se rattrape
    seule : l'import refait la requête, et c'est ce qu'un test naïf mesure). Mesuré
    sur `/auth/local` : 27 chunks sur 56 tuaient la page, et rien ne la rattrapait :
    `chunk-reload` de Nuxt n'agit qu'aux navigations et aux changements de
    manifeste, `chunk-reload-crawler` que pour les robots. Correctif : script en
    ligne `app/utils/bootChunkRetry.js`, qui recharge une fois au plus toutes les
    10 s tant que l'hydratation n'est pas finie. Tant qu'une panne échoue plus
    lentement que cette garde, la page réessaie sans plafond, ce qui est voulu : elle
    revient seule à la fin de la panne. Sur un chunk de la page, `reloadNuxtApp` de
    Nuxt peut ajouter un rechargement sous sa propre garde de 10 s (`nuxt:reload`) :
    une panne à échec rapide fait donc 3 chargements, puis s'arrête sur la page 500
    (tracé en prod). Pas de plugin Nuxt : si la perte
    touche le graphe de l'entrée, aucun plugin ne tourne jamais. Filtrer sur
    `/_nuxt/` est obligatoire : la balise Cloudflare, refusée par la CSP à chaque
    chargement, est aussi un `<script type="module">` en erreur, et sans le filtre
    chaque page de prod se rechargerait. S'arrêter à la fin de l'hydratation aussi :
    `automatic-immediate` de Nuxt rechargerait en plein calcul navigateur sur un
    chunk paresseux. Verrous : `app/tests/bootChunkRetry.test.js`, harnais
    `scripts/qa-e2e-chunk-failure.mjs` (`QA_FAIL_DELAY_MS=15000` pour la forme réelle).

65. **Un helper qui rend un opérateur Mongo s'emploie tel quel :
    `$push: pushSessionUpdate(s)`, jamais dans un second `sessions:` (constat prod
    07/11).** Écrit `$push: { sessions: pushSessionUpdate(s) }` au lot M4, Mongo ne
    voit pas de `$each` de premier niveau et stocke l'objet tel quel. La session ne
    se relit jamais, la route répond 200, le cookie est posé, l'utilisateur reste
    anonyme et aucun journal ne le dit ; les sessions plus anciennes masquaient la
    panne des connexions Google. Les faux Mongo des tests ignoraient `$push` : un
    test de connexion doit RELIRE la session (`getUserBySessionId`) sur un faux qui
    garde la sémantique réelle de `$push`. Verrou :
    `server/tests/googleLoginSession.test.js`.

65b. **Le palier affiché dans un onglet ouvert se relit par `/api/user/plan`
    (champs de palier seuls), jamais par `/api/user`, jamais en remplaçant
    l'utilisateur entier.** `/api/user` appelle `getVaultStatus`, qui prolonge la
    session du coffre (2 h) : relire à chaque retour d'onglet garderait la clé en
    mémoire serveur indéfiniment ; et remplacer l'objet ferait basculer l'unité
    d'un projet ouvert (`preferredUnit`) ou ouvrir le voile du coffre
    (`encryption.locked`). Règles : seuls les champs de `PLAN_KEYS`
    (`app/utils/userRefresh.js`) sont écrits, et seulement si l'onglet tient
    encore le même `id` (une réponse tardive après déconnexion ou changement de
    compte n'écrit rien, `applyUser` refuse aussi, et une réponse partie avant le
    paiement ne rétrograde personne : `writeFreshPlan`) ; un compte qui paie déjà n'est
    jamais relu automatiquement (au renouvellement la réponse peut dire `free` un
    moment) ; un clic sur un cadenas attend la relecture 2 s au plus. Les champs
    de palier se construisent à UN endroit (`server/utils/planFields.js`), qui ne
    doit jamais importer le coffre. Verrous : `app/tests/userRefresh.test.js`,
    `server/tests/userPlan.test.js`.

66. **Tôle importée d'un DXF : la tôle n'est plus un rectangle, et chaque
    étage qui la supposait rectangulaire doit le savoir (livré
    en V0.9.17, 20/11/2026).** Projet « Cet appareil »
    seulement : contour + zones interdites, calcul, rapport, affichage et DXF
    livré suivent le vrai contour. Règles, avec la raison :
    - **Lecteur de tôle ≠ import de pièces** (`nest-import/src/sheet.rs`) :
      tous les contours fermés avec leur profondeur, sans nettoyage. Une
      polyligne à bulges est lue en VRAIS arcs pour une tôle (`sheet.rs:12-19` :
      la corde de l'import de pièces, D-IMP-8, ferait un disque d'aire nulle et
      un arc rentrant plus grand que le métal) ; une SPLINE fermée périodique
      est ramenée à son domaine de nœuds valides ICI seulement
      (`spline_on_valid_domain`, `sheet.rs:417` : le code partagé aplatit tout
      l'intervalle et plante une pointe à l'origine) ; une SPLINE à points
      d'ajustement seuls est COMPTÉE écartée (`sheet.rs:620`), jamais lue.
    - **Le contour ne quitte jamais le navigateur.** Seul un `shapeId` opaque
      part au serveur (`files.js:234`), refusé hors projet local et pour la
      démo (`nest.post.js:206-221`, `imported_sheet_not_local`, format
      `SHEET_SHAPE_ID` ligne 19). Les tôles vivent dans leur PROPRE base
      IndexedDB `nestorcut-sheets` (`localSheetsStore.js:7-12`) : monter la
      version de `nestorcut-local` serait bloqué tant qu'un ancien onglet la
      tient ouverte. Dossier absent = job arrêté AVANT calcul
      (`sheet_shape_missing`, `localPayloadBuilder.js:725`), jamais un repli sur
      la boîte (poser des pièces sur du vide).
    - **Calcul** : toujours le chemin multi-tôles BPP (`localPayloadBuilder.js:
      1105`). `finish_partial_sheet` éteint partout : builder (ligne 1297),
      walks (`workerEngineConfig`) et fusion (`postMerge`, `localPool.js`),
      mono-walk (`runInWorker`, `localCompute.js`) — il refait la dernière tôle dans son rectangle
      englobant. Passes faites pour un rectangle SAUTÉES pour tout le job :
      alternative grille (`finalizeLocal.js:73`), bandes résiduelles et le
      hole-fill qui les suit (`localBridge.js:1763`). Le hole-fill de la fin est,
      lui, conscient des zones (`localBridge.js:1078-1093` : hors contour ou à
      moins de l'espacement d'une zone = pose refusée, contact à espacement 0
      compris). Dans une frame LIVE, `bin` est un RANG de tôle, pas un format
      (`localBridge.js:1505-1517`) : pas de hole-fill live avec plusieurs
      formats, densité live sans chiffre plutôt que fausse (ligne 1549).
    - **Rapport** (`nest-report/src/lib.rs`) : contour réel avec arêtes, aire
      UTILE (contour − zones) pour la densité, `offcut` null (`lib.rs:68-90`),
      recouvrement et distance aux zones (la distance entre dans l'écart minimal
      jugé par `applySpacingMargin`, `lib.rs:421-428`), forme illisible = « non
      vérifié » jamais vert (`lib.rs:586-596`, piège 60). Une alternative hors
      contour ou sur une zone est ÉCARTÉE comme un recouvrement mesuré
      (`finalizeLocal.js:205-225`, piège 56b).
    - **Affichage** : le SVG du résultat reçoit la forme en JS APRÈS le wasm
      (`withSheetShapeSvg`, `sheetDraw.js:110`, appelé `localBridge.js:1823` ;
      le SVG du wasm reste inchangé octet pour octet) et la garde avec le
      résultat. Vue live : un clip par panneau (`LiveNestingView.vue`), la boîte
      de chaque tôle dans la frame finale (`finalizeLocal.js:44-57`).
    - **DXF livré** (`nest-export/src/dxf_writer.rs:380-440`) : `BIN_BOUNDARY`
      toujours écrit ; pour une tôle importée TOUJOURS le vrai contour (option
      cochée ou non), zones toujours sur `FORBIDDEN_ZONE`, jamais `OUT_SHAPE`
      (cadre rectangulaire : il pourrait être découpé hors du métal). Les
      anneaux partent au wasm en TEXTE (`binShapeSpec`, `localBridge.js:2065` :
      le lecteur de nombres JSON se trompe d'un ULP, le DXF doit porter les
      anneaux du payload au bit près ; sauf tôle concave ou à défauts, ce sont
      aussi ceux du moteur, voir plus bas).
    - **Téléchargement Free d'un job à tôle importée** : voir piège 63 et le
      lot de la sortie. Décision du propriétaire du 20/11 : en Free on
      importe, on imbrique et on voit ; les fichiers de découpe d'un job à
      tôle importée (DXF, ZIP, .job) demandent Unlimited (piège 63).
    - **Défauts dessinés à la main (V0.9.19).** Deux descriptions de la même
      tôle, rendues ensemble par `cut_sheet` (`nest-import/src/sheet_cut.rs`,
      `geoCutSheet`) : le MOTEUR reçoit le contour d'ORIGINE (son enveloppe
      convexe et ses poches s'il est concave, voir plus bas) et les `hazards`
      (zones, défauts, morceaux perdus, limités à la tôle) en trous, parce
      qu'il réduit un contour à encoches sans contrôle ni repli (1 à 2 % de
      contours faux, `shape_modification.rs`, érosion) ; le rapport, les aires,
      le DXF et tous les dessins portent la tôle COUPÉE (`deliver` de
      `engineBinShape`, `payload.shapedSheets[].shape`), dans le repère de la
      boîte du contour d'origine : le zéro ne bouge jamais. Pour ces tôles le
      DXF ne porte donc PAS les anneaux du moteur. Le rapport est calculé deux
      fois et `mergeShapeVerify` prend le pire. Une coupe est liée à son dessin
      (`bindCut`, `forKey`) : celle d'un autre état est refusée à
      l'enregistrement et au calcul.
      Enregistrement : `contours: []` + `contoursV2`, `outlineIndex: -1` +
      `outlineIndexV2`, pour qu'une version plus ancienne refuse la tôle au lieu
      d'ignorer ses défauts ou de la réécrire. Toujours lire par `contoursOf` et
      `outlineIndexOf`.
      Un contour libre qui se recoupe est rempli à la règle NON NULLE : ne jamais
      dessiner un défaut en `evenodd`. Un défaut sans aire (trait, points
      alignés) est épaissi, jamais perdu. Sans défaut dessiné, rien ne change :
      verrous d'identité dans `sheetDefects` et `shapedDefects`.
    **Contenant du moteur d'une tôle CONCAVE (V0.9.20) : plus le contour livré.**
    Le moteur reçoit enveloppe convexe + poches en trous (`app/utils/sheetHull.js`,
    `engineInstanceOf`), et `narrow_concavity_cutoff: null` ; la substitution est
    faite au seul envoi (`localPool.js` walks et fusion, `localCompute.js`).
    Ne JAMAIS la mettre dans `payload.instance.bins` : le rapport et le badge
    compteraient les poches comme des zones interdites. Une poche se ferme HORS
    de l'enveloppe (lèvre et drapeau), selon l'arête de l'enveloppe : fermée sur
    sa bouche, une poche mince fait refuser tout le job. Convexe à 0,005 mm près :
    payload inchangé, même référence (verrou).
    **Avant le calcul (V0.9.20)** : `itemFitsSheets` (`localPayloadBuilder.js`,
    `partFit.js`) refuse une pièce qui ne peut PAS tenir dans l'enveloppe de la
    forme, avant la capacité, jamais la page (elle n'a que des boîtes). Lecture
    refusée = `sheet_shape_unreadable`, absente = `sheet_shape_missing`.
    L'estimation de la page lit l'aire utile (`preflightModel.js`) ; importer une
    tôle remplace la tôle d'usine intacte d'un projet sans résultat.
    Verrous : `sheetShape`, `sheetImportModel`, `localSheetsStore`,
    `filesSheetShapeId`, `localShapedSheet`, `localShapedPasses`,
    `localShapedHoleFill`, `shapedReport`, `sheetDraw` (`app/tests/`) ;
    `sheetDefects`, `shapedDefects`, `sheetCut`, `defectDrawing`, `sheetHull`,
    `localPoolHull` (`app/tests/`) ;
    `shapedSheetServer` (`server/tests/`) ; `nest-import/tests/sheet_contours.rs`,
    `nest-import/tests/sheet_cut.rs`,
    `nest-export/tests/bin_shape.rs`, `nest-report/src/shaped_tests.rs`.

67. **Zéro des fichiers et positions des pièces (V0.9.19).** Le DXF stocké
    n'est JAMAIS modifié : « Centre de la tôle » le translate au téléchargement
    (`dxfOrigin.js`), par paires code/valeur, pour les seules entités que notre
    écrivain sait produire. Toute autre entité, section ou coordonnée est une
    erreur (`dxf_origin_unsupported`) et rien n'est livré, jamais un fichier au
    coin quand le centre est demandé. Une entité ajoutée à `dxf_writer.rs` doit
    l'être aussi à `AXIS`. Le centre d'un disque importé est celui du CERCLE :
    la boîte d'un polygone à nombre impair de côtés n'y est pas (`sheetCentre`).
    Les positions (CSV) partent de l'enveloppe de l'anneau ORIGINAL importé
    (`ringHull`), affinée par les entités du dessin (`dxfEntities.partShape`).
    Ni les anneaux du payload (simplifiés, cordés pour une polyligne à arcs,
    ÉLARGIS par la réserve d'amorce d'un `.job`), ni la boîte de toutes les
    poignées (l'importeur rattache à une pièce ses axes, ses cotes, l'arête
    d'une voisine) : les deux ont donné des centres faux de plusieurs
    millimètres en relecture. Forme ambiguë ou illisible : pas de CSV, jamais un
    nombre deviné. Positions seulement pour un job construit dans le navigateur,
    gardées dans le record, jamais envoyées ; même verrou que les fichiers de
    coupe (piège 63). Verrous : `dxfOrigin`, `dxfOriginHardening`,
    `partEntities`, `partPositions`, `positionsFinalize`, `positionsJob`,
    `localDownloadsOrigin`, `sheetAxesOrigin`.

68. **Distance au bord : deux repères, UN seul passage de l'un à l'autre.** Le
    moteur ne connaît que l'espacement `s` (entre pièces ET au bord). Pour tenir
    les pièces à `e` du bord, le constructeur lui donne une tôle décalée de
    `d = e − s` (`edgeShiftMm`, valeurs DEMANDÉES : la marge de courbes s'ajoute
    aux deux et s'annule) : rectangle (W − 2d) × (H − 2d), bande H − 2d / W − 2d
    (longueurs arrondies PAR DÉFAUT au f32, `f32AtOrBelow` : le moteur les lit en
    f32 et ne doit jamais avoir plus de place que la vraie limite), contour
    importé décalé de −d (`offset_ring`, zones et défauts NON décalés : ils
    gardent `s`) puis tout translaté de (−d, −d). Une pose moteur (x, y) vaut
    (x + d, y + d) sur la vraie tôle. Règles :
    - **d = 0 ⇒ rien** : aucune clé de payload, `engineSheets === sheets`, même
      chemin au bit près. Verrou : `edgeDistanceEndToEnd` (empreinte du chemin par
      défaut mesurée au commit d'avant le lot, vrai moteur et vrai bundle). La
      page traite un bord égal à l'espacement comme un champ vide.
    - **Les passes d'après calcul restent dans le repère MOTEUR** (`sheetDims`,
      grille, bandes, hole-fill, finition, fusion, frames décorées) ; le retour au
      repère réel se fait en UN point, `layoutsToRealFrame` dans
      `buildAlternativeArtifacts`, avant containers, SVG, rapport, DXF, CSV,
      `.job` et record (`realSheetDims`, `sheetFrames`). Les frames live passent
      par `liveFrameToReal` ; une frame ou un layout déjà passé porte `edgeReal` :
      ne jamais décaler deux fois. Le champion du pool (`preferChampion`) lit les
      frames BRUTES du moteur, jamais celles de l'écran. La trace « dernière
      tôle » (`finish.before/after`) passe au repère réel par `finishToReal`
      (copie, rectangles seulement : la finition est coupée sur tôle importée).
    - **`.job` SheetCam** (vrai à tout bord, défaut d'avant corrigé ici) : la
      finalisation remet `result.alternatives` dans l'ORDRE AFFICHÉ et rend
      `jobSheets`, les tôles de chaque rang tirées des containers de CETTE
      alternative (`jobSheetsOfContainers`, repère réel) ; `attachSheetcamJobs`
      les lit. Avant, la grille BPP ajoutée en dernier et triée en tête portait
      le `.job` de l'option moteur. Verrou : `edgeDistanceJobOrder` (aller-retour
      du worker cloné, vrai relais, repli thread principal).
    - Bande : longueur réelle = largeur moteur + d ; `stripMaxWidth` (moteur + d)
      remplace la largeur de tôle dans `frameFitsSheet`.
    - Rapport : `edge` (convention interne, comme `space`) seulement si d ≠ 0 ;
      `applySpacingMargin` ôte la marge de `edgeGapMm` SANS plancher (négatif =
      dépassement permis jusqu'à |e|). Bord réglé (même e ≥ 0) : `insideSheet`
      tolère `OUTLINE_TOL_MM + max(0, −e)` sur un rectangle comme sur un contour
      importé (même tolérance qu'`edgeOk`) ; bord non réglé : `INSIDE_EPS`, au
      bit près.
    - **Pièce presque hors tôle (bord négatif)** : une pièce dont moins de 1 % de
      la matière est SUR la tôle compte dehors même si sa boîte respecte le
      dépassement (`ON_SHEET_MIN_FRACTION`, zones ignorées) : `insideSheet` faux
      sur un rectangle (alternative livrée mais signalée : verdict `unfit`,
      téléchargements bloqués), `partsOutsideOutline` sur une tôle importée
      (alternative écartée). Une équerre fine se pose sinon entière dans la
      bande de dépassement.
    - **Plafond du dépassement** : moitié du plus petit côté de la boîte de
      chaque PIÈCE PHYSIQUE (chaque pièce d'un bloc, jamais la boîte du bloc), au
      plus petit sur ses rotations permises (les deux sens) — `overhangCapOf`
      au constructeur, `maxOverhangMm` à la page (boîtes seulement : borne haute
      hors quart de tour, jamais plus stricte que le constructeur).
    - **Maximum annoncé = maximum retapable** : le constructeur arrondit par
      défaut au centième (`floorCenti`), l'écran par défaut à sa précision
      (`fmtLengthMax`, plafond de la page par `floorLengthMm`), jamais au plus
      proche. Tôle importée : `maxEdgeMm` cherché par bissection avec le VRAI
      décalage (`maxEdgeBySearch`, ≤ 14 pas, chemin d'erreur seulement), vérifié
      constructible ; introuvable : refus sans chiffre (`edgeTooLargePlain`).
    - Phase 1 : projets « Cet appareil » seulement ; le serveur refuse le réglage
      ailleurs (`edge_distance_local_only`), le worker Python ne le lit pas.
    - **d < 0 sur tôle importée, vides** : le décalage vers l'extérieur comble
      les encoches. Les vides qu'il enferme partent au moteur comme zones
      interdites (translatées de (−d, −d), tenues à `s` : prudent) : ceux du
      décalage moteur (−d) ET, bord négatif, ceux du décalage du bord demandé
      |e| (`keepVoids` ; appel sauté pour un contour convexe). Plus de refus
      `offset_enclosed_void`, une tôle en C se calcule baie interdite. Le
      rapport ne suit que les BORDS des pièces : une pièce qui avale une cavité
      à bouche étroite y resterait verte, ces zones sont la seule défense
      (verrou `edgeDistanceShapedVoids`, `edgeDistanceEndToEnd`). Sous
      |e| ≈ 0,1 mm, `offset_ring` rend le contour tel quel, sans vide. Une
      encoche OUVERTE comblée (sans vide) peut recevoir une pièce : son bord y
      entre et le rapport le voit (`edgeOk` faux, ou alternative écartée).
    - **Décalage vers l'extérieur raccourci** (≤ 0,1 mm jamais appliqué, jusqu'à
      1 mm sur un contour fin) : le job tourne (prudent), payload et record
      portent `edgeAppliedMm` = s − distance appliquée (bord vraiment tenu, mm)
      seulement si l'écart dépasse 1e-6 mm ; la fenêtre de résultat le dit en
      une ligne à côté du badge du bord.
    - Toute op ajoutée au worker géométrie : rebuild `build-wasm.sh` DANS LA MÊME
      PR (piège 33b), avec `wasm-opt` (binaryen) sur le PATH : sans lui le script
      installe un binaire non optimisé.

## 3. Banc d'essai (workers/nesting/bench/)

Boucle de test de bout en bout, sans UI :

```bash
docker build -t nest2d-nesting-worker:dev -f workers/nesting/Dockerfile workers
docker compose up -d mongo
docker run -d --name bench-worker --network nest2d_nest2d \
    -e MONGO_URI=mongodb://mongo:27017/nest2d nest2d-nesting-worker:dev
docker run --rm -i --network nest2d_nest2d \
    -e MONGO_URI=mongodb://mongo:27017/nest2d \
    nest2d-nesting-worker:dev python - < workers/nesting/bench/seed_job.py
```

- `seed_job.py` : cas croix (3+3+50, tôle 1500×1000), asserte 3 alternatives
- `seed_holes.py` : cas trous (10 hôtes r=35 + 41 secteurs, 1000×2000),
  imprime `holesFilled` par classe (mesuré 08/09 : 20/40 par classe,
  identique avant et après P5 — la cible 40/40 date d'une autre grille ;
  re-ciblage au lot 5-moteur)
- `seed_nestforge.py` : rejoue les pièces démo du concurrent depuis son DXF
- `repro_pipeline.py` : exécute `nesting_process` in-process avec espion
  (dump instance/config moteur pour replay manuel)

Règle d'or : **tout changement moteur/pipeline se valide au banc avant
push**, avec les métriques objectives (holesFilled, offcut, usedSheetShare,
badges, itérations).

## 4. Dev local (docker)

`docker-compose.override.yml` (gitignoré) build app + workers depuis les
sources. Cycle : `docker compose build && docker compose up -d`.
Compte de test : `guillaume@local.dev` / `nestorcut-local-2026`
(tier standard granté 30 j, créé via `/api/auth/local/register` +
`grantedUntil` en base).

## 5. Avant de pousser

```bash
npx vitest run                                             # app+server (2 783 au 27/11)
cd workers/nesting/engine && cargo test --release -p nest-engine   # 75 + 1 ignore (dont le verrou bpp_live_frame)
cd workers/nesting && python -m pytest tests/ -q --ignore=tests/test_integration_holes.py   # 241 + 1 skip (mesure du 13/09 en conteneur ; l'image RUNTIME `nest2d-nesting-worker:dev` n'embarque ni pytest ni `tests/` — lancer dans un conteneur de build ou une image dev, pas sur le poste : deps absentes)
cd workers/common && python -m pytest tests/ -q            # 101 au 18/11 (aussi dans la CI ; lit workers/geometry)
cd workers/fileprocessing && python -m pytest tests/ -q    # 127 dans l'image du worker, 125 + 2 sautés (DWG) ailleurs et dans la CI (18/11 ; lit workers/geometry)
python workers/nesting/bench/determinism_lock.py           # natif ≡ wasm, SHA identiques
npx nuxt build                                             # app
cd ../nestorcut-website && npm run build                   # site marketing (dépôt frère)
```
Les comptes sont datés : un écart de quelques tests est normal, un écart
de dizaines signale une suite qui ne tourne plus.

Après tout changement moteur : rebuild le wasm dans la MÊME PR (piège
#33b) ET vider le cache navigateur (piège 14i). Référence complète des
correctifs 2026-08-28/29 : AUDIT-2026-08-29.md (coffre privé).

**Harnais navigateur (`scripts/qa-*.mjs`, dont `qa-a11y.mjs`)** : ils
importent `playwright`, qui n'est **PAS** déclaré dans `package.json` —
l'étape de build de l'image (`npm install`, devDeps comprises)
téléchargerait les navigateurs à chaque build. Installation hors verrou,
une fois par poste : `npm i --no-save playwright && npx playwright install
chromium`. Un `npm i` ultérieur l'élague : le refaire alors. Seul
`@axe-core/playwright` (léger, aucun navigateur) est en devDependencies.

**`scripts/qa-preload-auth-local.mjs` (poids du JS préchargé par `/auth/local`)** :
harnais MANUEL, sans CI et sans test vitest. À lancer à la main après
`npx nuxt build`, serveur du build démarré (`node scripts/qa-preload-auth-local.mjs
--base http://127.0.0.1:3000`) ; rien ne le fait à votre place. Codes de
sortie : 0 OK, 1 seuil dépassé ou three dans un chunk préchargé, 2 fichier
préchargé absent du disque. Il n'appelle pas `process.exit` (assertion libuv
sous Windows quand `fetch` garde une connexion ouverte).

**`scripts/qa-e2e-failure-scroll.mjs` (bandeau et défilement de la page projet quand
un job échoue, local ou serveur ; note de la carte quand la fusion meurt)** : harnais MANUEL, sans CI. Le comportement est verrouillé en vitest
(`app/tests/useJobScroll.test.js`, vrai composable sur le vrai registre) ; ce harnais
est le seul à exécuter le fil entre la page et `useJobScroll`, donc à relancer quand
ce fil ou le gabarit de l'atelier change. Build servi plus base Mongo JETABLE
(`QA_BASE_URL`, `QA_MONGO_URI` obligatoires, serveur local exigé, `nest2d` refusé).
Codes de sortie : 0 OK, 1 scénario rouge.

Benchmarks ESICUP (lents) : `pytest benchmarks/test_benchmarks.py -m slow`.
Harnais A/B warm-start : `cargo test --release warm_start_160_ab -- --ignored --nocapture`.

## 6. Checklist de déploiement

### `:latest` = ce qui a reçu un GO (lot D1, 2026-09-13)

Constat du 13/09 : la CI publiait une image à chaque poussée sur `main` et
déplaçait `:latest` avec elle — après un déploiement épinglé par SHA,
`:latest` désignait déjà des lots SANS GO (J1 et le lot 2d, alors que la prod
tournait un SHA antérieur approuvé). Un `docker compose pull` nu sur la prod
ou le homelab devenait un déploiement surprise.

**Depuis le lot D1** : `build-images.yml` publie `:<sha>` (immuable) et
`:main` (le dernier build, *jamais* tiré par un serveur). **`:latest` ne
bouge que par le workflow manuel `promote-latest`** (Actions → Run workflow
→ SHA complet du commit qui a le GO), qui RETAGUE sans reconstruire
(`docker buildx imagetools create`, donc même digest que le `:<sha>`
vérifié). Le déploiement se fait par **services nommés**, jamais un
`docker compose pull` nu (il recréerait tout ce que l'amont a bougé, base
comprise, constat du 15/09), après avoir posé l'étiquette de retour arrière :

```bash
cd /opt/nestorcut && docker compose pull <services> && docker compose up -d <services>
# services : app, admin, user-file-processing-worker, nesting-worker
cd /containers/nestorcut-overflow && docker compose pull <workers> && docker compose up -d --force-recreate <workers>
```

Corollaires : `:main` n'a rien à faire dans un `docker-compose.yml` de
serveur ; attendre que « Build and publish Docker images » soit `completed`
sur le commit visé AVANT de promouvoir (le tag `:<sha>` doit exister) ; et un
déploiement partiel d'urgence reste possible par SHA
(`docker pull …:<sha>` + `docker tag …:<sha> …:latest` + `up -d <service>`),
en le DISANT au rapport, puisque `:latest` du registre ne bougera pas.

### Homelab (débordement, constat 2026-09-06)

Les trois workers
`nestorcut-overflow-worker-{1,2,3}` du homelab (adresse dans le runbook privé, coffre Obsidian,
`/containers/nestorcut-overflow`, image `ghcr.io/…/nest2d-nesting-worker:latest`)
consomment la MÊME file que la prod. **Tout déploiement qui touche
`workers/nesting` ou le moteur se termine sur le homelab** :
`docker compose pull` puis `up -d --force-recreate` des trois workers (pas du
conteneur WireGuard) dans `/containers/nestorcut-overflow`, puis
`python workers/nesting/bench/assert_overflow_head.py` (md5 des fichiers
clés = HEAD, date du binaire moteur), et `NEST_COMPUTE_TOKENS` aligné avec
le `.env` Hetzner. Sans cela, une partie des jobs de production est
calculée avec l'ancien moteur et l'ancien post-pass (constaté : image du
31/08 pendant que six lots étaient déployés sur Hetzner).

### Page « Nouveautés » de la documentation (étape systématique, L0-bis)

La page Nouveautés de la documentation est PRODUITE depuis le
`CHANGELOG.md` de l'application (une seule source, lot D4). Après
CHAQUE promotion de l'application, la régénérer sinon le site reste à
la version précédente :

```bash
cd ../nestorcut-website && node scripts/sync-changelog.mjs
```

La sortie (les deux pages whats-new EN+FR) est commitée avec le site
vitrine et poussée — Cloudflare publie. Vérifier que la page servie
porte la nouvelle entrée avant de rendre le rapport.

### Benchmarks publics (AF4, L3-bis)

Après un GO de vérification, AVANT le déploiement d'une livraison qui
touche le MOTEUR (`workers/nesting/engine`, `public/engine`) :

- **Régénérer la page des benchmarks publics** : rejouer le corpus sur les
  images publiées puis extraire les densités et mettre à jour
  `data/benchmarks.js` (version affichée = commit déployé) :
  ```
  docker run --rm -i --network nestorcut_nest2d       -e MONGO_URI=mongodb://mongo:27017/nest2d       nest2d-nesting-worker:dev python - < workers/nesting/bench/densities_corpus.py
  ```
  La page affiche « produites par l'image déployée en production à la date
  indiquée » — des chiffres périmés y sont un mensonge public.
- Une livraison UI seule (aucun diff runtime moteur/worker) n'invalide pas
  les chiffres : le vérifier par `git diff <dernier run>..HEAD -- workers/
  public/engine` comme au lot 3.

Procédure complète : runbook privé DEPLOY-HETZNER.md (coffre privé).

### Règle suites moteur (vérif phase A / P9)

Les suites cargo du moteur se lancent **en release** (le mode de
livraison et de vérification). En debug, les `debug_assert!` de jagua-rs
peuvent se déclencher sur des états limites du quadtree sans impact en
release (constat P9 : `qt_hazard.rs:111`,
`constricted_hazards.iter().filter(|h| h.is_some()).count() > 0`, tests
`progress::tests::live_frame_phase2_metrics_in_original_frame`,
`live_frame_map_back_matches_phase2_export` et
`bpp::live_frame_tests::bpp_live_frame_matches_final_export_off_center`
sur un poste, verts partout en release). **Toute assertion de débogage
déclenchée se documente** (texte exact + test déclencheur) ; aucun test
n'est étiqueté « préexistant » sans reproduction à HEAD sur un arbre
propre.

## 7. Conventions

- **Branding : NestorCut = produit, APlasma = entité légale** (Guillaume
  Jerke EI — encaissements Stripe, mentions légales, factures, fiscalité).
  APlasma ne disparaît JAMAIS des contextes légaux/paiement ; la brandLine
  officielle est « NestorCut by APlasma » (`data/siteConfig.js`). Le nom de
  produit seul (NestorCut) s'emploie partout ailleurs.
- Commits en français, conventional commits (`feat(nesting): …`), petits et
  par phase. Ne jamais committer le travail non sollicité des autres
  (vérifier `git status` avant `git add -A`; préférer des adds ciblés).
- **Code mort déclaré par un agent ⇒ sweep résiduel avant suppression** :
  le grep de vérification doit couvrir `scripts/`, les tests et `workers/`
  — pas seulement le périmètre confié à l'agent (`fingerprint_key` marqué
  mort alors que `scripts/crypto-interop/verify_vector.py` l'importe,
  audit du 2026-08-12).
- `main` direct (petit projet), merge requests pour les grosses branches.
- **Pas de force-push sur `main`** (vérif phase A/P9) : un commit fautif
  (fichiers avalés, secret) se corrige par un COMMIT DE CORRECTION
  (`git rm --cached` + revert), jamais par réécriture d'historique — le
  force-push fait courir deux builds vers l'image `:latest` et le hash
  injecté au build peut référencer un commit orphelin (constaté :
  `1972f84`).
- **Un lot d'interface se rapporte AVEC ses captures, et l'implémenteur les a regardées avant d'écrire « vérifié »** : « N tests verts » ne dit rien d'une carte tronquée, d'un badge absent ou d'une page en deux langues — le rapport liste chaque capture avec une ligne disant ce qu'on y voit (constat J11-bis, 15/09).
- i18n : `app/utils/i18n/<langue>.js` (six langues, dict plat) ; site marketing :
  `src/i18n/ui.ts` dans le dépôt frère `../nestorcut-website`.
- Documents : plans, rapports, audits et décisions vivent dans le coffre
  Obsidian privé du propriétaire, jamais sous `docs/` ni `specs/` ; le dépôt
  ne garde que `docs/dwg-license.md` et `docs/encryption-premium.spec.md`.
