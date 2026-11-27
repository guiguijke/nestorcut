/**
 * Page /benchmarks (3.9 — preuve publique de qualité) : chiffres du corpus
 * interne T-A..T-K, extraits du DERNIER run de vérification sur les images
 * Docker PUBLIÉES (commit 3254a9c1, run 2026-11-17 07:55 UTC — celui de
 * la V0.9.15). Extraction :
 * workers/nesting/bench/densities_corpus.py.
 *
 * Méthode (reproductible) : chaque cas = un job standard du produit (BPP
 * multi-tôles, 1 direction –X, fillHoles on, 4 cœurs, budget 90 s), semé
 * par workers/nesting/bench/seed_corpus.py ; densité matière MESURÉE sur
 * le rapport vérifié (aire des pièces posées / aire des tôles utilisées),
 * physique validée (aucun recouvrement, tout dans la tôle, écart minimal
 * ≥ l'espacement demandé).
 */
export const BENCHMARKS = {
    meta: {
        runDate: '2026-11-17',
        // Image Docker PUBLIÉE qui a produit les chiffres (workflow
        // « Build and publish Docker images »), régénérée à chaque
        // livraison moteur (AGENTS.md §6). Run du 2026-11-17 sur
        // ghcr.io/…/nest2d-nesting-worker:3254a9c1 (V0.9.15 : un trou
        // n'est ouvert que si son canal n'abîme pas la pièce ; le binaire
        // du moteur est celui de la V0.9.13) : corpus 11/11 OK, T-A
        // [587, 313]. **Les DIX fiches publiées sont identiques** au run
        // bf12f2ba (V0.9.13). Sur cette image T-F a été rejouée dix
        // fois : 89, 89, 89, 88, 89, 89, 88, 88, 89, 89 — le chiffre
        // publié est celui du premier passage.
        version: '3254a9c1',
        machine: {
            en: 'Docker worker on an AMD Ryzen 9 9900X (12 cores/24 threads), 4 vcores allocated per job, 90 s budget',
            fr: 'Worker Docker sur AMD Ryzen 9 9900X (12 cœurs/24 threads), 4 vcores alloués par job, budget 90 s',
            pt: 'Worker Docker em um AMD Ryzen 9 9900X (12 núcleos/24 threads), 4 vcores alocados por job, orçamento de 90 s',
            it: 'Worker Docker su un AMD Ryzen 9 9900X (12 core/24 thread), 4 vcore assegnati per job, budget di 90 s',
            de: 'Docker-Worker auf einem AMD Ryzen 9 9900X (12 Kerne/24 Threads), 4 vCores pro Job zugewiesen, Budget 90 s',
            es: 'Worker Docker en un AMD Ryzen 9 9900X (12 núcleos/24 hilos), 4 vcores asignados por job, presupuesto de 90 s',
        },
        method: {
            en: 'Every case is a standard product job (multi-sheet BPP, one –X direction, nesting-in-cutouts on). Material density is measured on the verified report: area of the placed parts over the area of the used sheets. Physical validation checks zero overlap, every part inside its sheet, and a minimal gap no smaller than the requested spacing.',
            fr: 'Chaque cas est un job standard du produit (BPP multi-tôles, un sens –X, imbrication dans les trous activée). La densité matière est mesurée sur le rapport vérifié : aire des pièces posées sur l’aire des tôles utilisées. La validation physique vérifie zéro recouvrement, toutes les pièces dans leur tôle, et un écart minimal jamais inférieur à l’espacement demandé.',
            pt: 'Cada caso é um job padrão do produto (BPP multi-chapas, uma direção –X, aninhamento nos furos ativado). O aproveitamento de material é medido no relatório verificado: área das peças posicionadas sobre a área das chapas usadas. A validação física confere zero sobreposição, todas as peças dentro da chapa e uma folga mínima nunca inferior ao espaçamento solicitado.',
            it: 'Ogni caso è un job standard del prodotto (BPP multi-lamiera, una direzione –X, annidamento nei fori attivo). L’utilizzo del materiale è misurato sul rapporto verificato: area dei pezzi posizionati sull’area delle lamiere usate. La validazione fisica controlla zero sovrapposizioni, tutti i pezzi dentro la lamiera e una distanza minima mai inferiore alla distanza richiesta.',
            de: 'Jeder Fall ist ein Standard-Job des Produkts (Mehrfachblech-BPP, eine –X-Richtung, Verschachteln in Löchern aktiviert). Die Materialausnutzung wird am verifizierten Bericht gemessen: Fläche der platzierten Teile geteilt durch die Fläche der verwendeten Bleche. Die physikalische Validierung prüft null Überlappung, alle Teile innerhalb ihres Blechs und einen Mindestabstand, der den verlangten Teileabstand nie unterschreitet.',
            es: 'Cada caso es un job estándar del producto (BPP multichapa, una dirección –X, anidado en los agujeros activado). El aprovechamiento de material se mide sobre el informe verificado: área de las piezas colocadas sobre el área de las chapas usadas. La validación física comprueba cero solapamientos, todas las piezas dentro de su chapa y una holgura mínima nunca inferior a la separación solicitada.',
        },
    },
    cases: [
        {
            id: 'A',
            geometry: {
                en: 'Ringed part (100×100 mm, Ø35 cutout) + 4-lobed fan nesting inside the cutouts — the reference corpus (100 + 800 parts)',
                fr: 'Pièce annulaire (100×100 mm, découpe Ø35) + éventail 4 lobes imbriqué dans les découpes — le corpus de référence (100 + 800 pièces)',
                pt: 'Peça anular (100×100 mm, recorte Ø35) + leque de 4 lóbulos aninhado nos recortes — o corpus de referência (100 + 800 peças)',
                it: 'Pezzo anulare (100×100 mm, ritaglio Ø35) + ventaglio a 4 lobi annidato nei ritagli — il corpus di riferimento (100 + 800 pezzi)',
                de: 'Ringförmiges Teil (100×100 mm, Ausschnitt Ø35) + Fächer mit 4 Lappen, in die Ausschnitte verschachtelt — der Referenzkorpus (100 + 800 Teile)',
                es: 'Pieza anular (100×100 mm, recorte Ø35) + abanico de 4 lóbulos anidado en los recortes — el corpus de referencia (100 + 800 piezas)',
            },
            sheets: '2 × 1000×1000',
            spaceMm: 0.1,
            placed: 900,
            requested: 900,
            layouts: 2,
            densityPct: 55.4,
            smallestGapMm: 0.1,
            verdict: 'ok',
        },
        {
            id: 'B',
            geometry: {
                en: 'Three close rectangle classes (300×200, 250×180, 120×90) — pure lattice packing',
                fr: 'Trois classes de rectangles proches (300×200, 250×180, 120×90) — pavage lattice pur',
                pt: 'Três classes de retângulos próximos (300×200, 250×180, 120×90) — empacotamento lattice puro',
                it: 'Tre classi di rettangoli simili (300×200, 250×180, 120×90) — impacchettamento lattice puro',
                de: 'Drei ähnliche Rechteckklassen (300×200, 250×180, 120×90) — reine Lattice-Packung',
                es: 'Tres clases de rectángulos parecidos (300×200, 250×180, 120×90) — empaquetado lattice puro',
            },
            sheets: '3 × 1500×1000',
            spaceMm: 2.0,
            placed: 80,
            requested: 80,
            layouts: 2,
            densityPct: 84.4,
            smallestGapMm: 2.0,
            verdict: 'ok',
        },
        {
            id: 'C',
            geometry: {
                en: 'Non-convex L (200×200) and U (240×200) parts',
                fr: 'Pièces non convexes en L (200×200) et U (240×200)',
                pt: 'Peças não convexas em L (200×200) e em U (240×200)',
                it: 'Pezzi non convessi a L (200×200) e a U (240×200)',
                de: 'Nicht konvexe Teile in L- (200×200) und U-Form (240×200)',
                es: 'Piezas no convexas en L (200×200) y en U (240×200)',
            },
            sheets: '2 × 1200×1000',
            spaceMm: 1.0,
            placed: 60,
            requested: 60,
            layouts: 2,
            densityPct: 60.0,
            smallestGapMm: 1.0,
            verdict: 'ok',
        },
        {
            id: 'D',
            geometry: {
                en: 'Long thin parts (900×40) + 300 small rectangles — one dominant orientation',
                fr: 'Pièces longues et fines (900×40) + 300 petits rectangles — une orientation dominante',
                pt: 'Peças longas e finas (900×40) + 300 retângulos pequenos — uma orientação dominante',
                it: 'Pezzi lunghi e sottili (900×40) + 300 piccoli rettangoli — un orientamento dominante',
                de: 'Lange, schmale Teile (900×40) + 300 kleine Rechtecke — eine dominante Ausrichtung',
                es: 'Piezas largas y finas (900×40) + 300 rectángulos pequeños — una orientación dominante',
            },
            sheets: '2 × 1000×1000',
            spaceMm: 1.0,
            placed: 330,
            requested: 330,
            layouts: 2,
            densityPct: 76.5,
            smallestGapMm: 1.0,
            verdict: 'ok',
        },
        {
            id: 'E',
            geometry: {
                en: 'Ringed part + fan with free rotations every 30° (12 orientations)',
                fr: 'Pièce annulaire + éventail en rotations libres tous les 30° (12 orientations)',
                pt: 'Peça anular + leque com rotações livres a cada 30° (12 orientações)',
                it: 'Pezzo anulare + ventaglio con rotazioni libere ogni 30° (12 orientamenti)',
                de: 'Ringförmiges Teil + Fächer mit freien Drehungen alle 30° (12 Ausrichtungen)',
                es: 'Pieza anular + abanico con rotaciones libres cada 30° (12 orientaciones)',
            },
            sheets: '3 × 1000×1000',
            spaceMm: 0.1,
            placed: 460,
            requested: 460,
            layouts: 1,
            densityPct: 61.5,
            smallestGapMm: 0.1,
            verdict: 'ok',
        },
        {
            id: 'F',
            geometry: {
                en: '90 rectangles 200×150 on two sheet formats (cost ∝ area) — tight stock',
                fr: '90 rectangles 200×150 sur deux formats de tôles (coût ∝ surface) — stock serré',
                pt: '90 retângulos de 200×150 em dois formatos de chapa (custo ∝ área) — estoque apertado',
                it: '90 rettangoli 200×150 su due formati di lamiera (costo ∝ superficie) — scorta ridotta',
                de: '90 Rechtecke 200×150 auf zwei Blechformaten (Kosten ∝ Fläche) — knapper Bestand',
                es: '90 rectángulos de 200×150 en dos formatos de chapa (coste ∝ superficie) — stock ajustado',
            },
            sheets: '1000×1000 + 2000×1000',
            spaceMm: 1.0,
            placed: 89,
            requested: 90,
            layouts: 2,
            densityPct: 89.0,
            smallestGapMm: 1.0,
            verdict: 'partial',
            // Stock serré : le nombre de pièces posées oscille selon le
            // tirage (87 à 90 sur 90 — mesuré 88, 89, 88 sur l'image
            // 179b126, 89 sur e51e294, 89 sur 67eef23, 90 sur d890c92, puis
            // 89, 87, 89, 90, 89, 89, 89, 89, 88, 89 sur 060867a1, puis
            // 89, 88, 89, 89, 89, 90, 89, 89, 89, 88 sur bf12f2ba, puis
            // 89, 89, 89, 88, 89, 89, 88, 88, 89, 89 sur **3254a9c1**) :
            // bruit d'affectation du BPP, pas une différence de moteur. Le
            // chiffre publié est celui du run de vérification daté
            // ci-dessus ; c'est le SEUL des dix qui a bougé depuis d890c92.
        },
        {
            id: 'G',
            geometry: {
                en: 'One near-full-sheet part (950×950) + 200 small parts around it',
                fr: 'Une pièce quasi pleine tôle (950×950) + 200 petites pièces autour',
                pt: 'Uma peça quase do tamanho da chapa (950×950) + 200 peças pequenas ao redor',
                it: 'Un pezzo quasi a tutta lamiera (950×950) + 200 pezzi piccoli attorno',
                de: 'Ein Teil fast in Blechgröße (950×950) + 200 kleine Teile drumherum',
                es: 'Una pieza casi del tamaño de la chapa (950×950) + 200 piezas pequeñas alrededor',
            },
            sheets: '2 × 1000×1000',
            spaceMm: 0.5,
            placed: 201,
            requested: 201,
            layouts: 2,
            densityPct: 60.1,
            smallestGapMm: 0.5,
            verdict: 'ok',
        },
        {
            id: 'H',
            geometry: {
                en: 'Single class of 200 identical rectangles (120×80) — annealing at steady state',
                fr: 'Classe unique de 200 rectangles identiques (120×80) — recuit à l’équilibre',
                pt: 'Classe única de 200 retângulos idênticos (120×80) — recozimento em regime estacionário',
                it: 'Classe unica di 200 rettangoli identici (120×80) — ricottura a regime',
                de: 'Einzelne Klasse aus 200 identischen Rechtecken (120×80) — Annealing im Beharrungszustand',
                es: 'Clase única de 200 rectángulos idénticos (120×80) — recocido en régimen estacionario',
            },
            sheets: '3 × 1000×1000',
            spaceMm: 1.0,
            placed: 200,
            requested: 200,
            layouts: 3,
            densityPct: 64.0,
            smallestGapMm: 1.0,
            verdict: 'ok',
        },
        {
            id: 'J',
            geometry: {
                en: 'Same as A but 1000 parts on ONE 1000×2000 sheet at 4 mm — over capacity on purpose',
                fr: 'Comme A mais 1000 pièces sur UNE tôle 1000×2000 à 4 mm — dépassement de capacité volontaire',
                pt: 'Igual ao A, mas com 1000 peças em UMA chapa de 1000×2000 a 4 mm — excesso de capacidade proposital',
                it: 'Come A ma con 1000 pezzi su UNA lamiera 1000×2000 a 4 mm — superamento di capacità voluto',
                de: 'Wie A, aber 1000 Teile auf EINEM Blech 1000×2000 bei 4 mm — Kapazität absichtlich überschritten',
                es: 'Igual que A pero con 1000 piezas en UNA chapa de 1000×2000 a 4 mm — exceso de capacidad deliberado',
            },
            sheets: '1 × 1000×2000',
            spaceMm: 4.0,
            placed: 0,
            requested: 1000,
            layouts: null,
            densityPct: null,
            smallestGapMm: null,
            verdict: 'refused',
        },
        {
            id: 'K',
            geometry: {
                en: '1000 parts at 2.4 mm on two 1000×1000 sheets — right at the measured packing limit',
                fr: '1000 pièces à 2,4 mm sur deux tôles 1000×1000 — juste à la limite d’empilement mesurée',
                pt: '1000 peças a 2,4 mm em duas chapas de 1000×1000 — exatamente no limite de empacotamento medido',
                it: '1000 pezzi a 2,4 mm su due lamiere 1000×1000 — proprio al limite di impacchettamento misurato',
                de: '1000 Teile bei 2,4 mm auf zwei Blechen 1000×1000 — genau an der gemessenen Packungsgrenze',
                es: '1000 piezas a 2,4 mm en dos chapas de 1000×1000 — justo en el límite de empaquetado medido',
            },
            sheets: '2 × 1000×1000',
            spaceMm: 2.4,
            placed: 1000,
            requested: 1000,
            layouts: 2,
            densityPct: 58.5,
            smallestGapMm: 2.4,
            verdict: 'ok',
        },
    ],
    // T-I (free-form ESICUP shapes) : l'instance vit dans ses propres
    // unités normalisées — la densité n'y est PAS comparable à des mm²
    // produit ; le cas reste dans la suite interne de robustesse.
    robustness: {
        en: 'The internal torture corpus also runs a free-form ESICUP instance (shirts, 12 orientations) and a 12-orientation variant of case A. Those live in their own normalized units, so their density is not comparable to the product cases above — they exist to prove the engine never overlaps, never drops a part, and never returns an uncuttable layout on unfamiliar geometry.',
        fr: 'Le corpus de torture interne exécute aussi une instance ESICUP à formes libres (shirts, 12 orientations) et une variante du cas A en 12 orientations. Elles vivent dans leurs propres unités normalisées : leur densité n’est pas comparable aux cas produit ci-dessus — elles prouvent que le moteur ne recouvre jamais, ne perd jamais une pièce et ne rend jamais un agencement non découpable sur une géométrie inconnue.',
        pt: 'O corpus de tortura interno também executa uma instância ESICUP de formas livres (shirts, 12 orientações) e uma variante do caso A com 12 orientações. Elas vivem em unidades normalizadas próprias, então seu aproveitamento não é comparável ao dos casos de produto acima — existem para provar que o motor nunca sobrepõe, nunca perde uma peça e nunca devolve um arranjo impossível de cortar em geometrias desconhecidas.',
        it: 'Il corpus di stress interno esegue anche un’istanza ESICUP a forme libere (shirts, 12 orientamenti) e una variante del caso A a 12 orientamenti. Vivono in unità normalizzate proprie: il loro utilizzo del materiale non è confrontabile con i casi prodotto qui sopra — servono a dimostrare che il motore non sovrappone mai, non perde mai un pezzo e non restituisce mai una disposizione non tagliabile su geometrie sconosciute.',
        de: 'Der interne Stresskorpus führt außerdem eine ESICUP-Instanz mit freien Formen (Shirts, 12 Ausrichtungen) und eine Variante von Fall A mit 12 Ausrichtungen aus. Sie leben in eigenen normierten Einheiten, ihre Materialausnutzung ist daher nicht mit den Produktfällen oben vergleichbar — sie belegen, dass die Engine auf unbekannter Geometrie nie überlappt, nie ein Teil verliert und nie ein nicht schneidbares Layout liefert.',
        es: 'El corpus de estrés interno también ejecuta una instancia ESICUP de formas libres (shirts, 12 orientaciones) y una variante del caso A con 12 orientaciones. Viven en sus propias unidades normalizadas, así que su aprovechamiento no es comparable con los casos de producto de arriba — sirven para demostrar que el motor nunca solapa, nunca pierde una pieza y nunca devuelve una disposición imposible de cortar con geometrías desconocidas.',
    },
    honesty: {
        en: 'What we do NOT claim: these densities are ours, on our corpus, at the stated budgets — not a third-party certification, and no benchmark makes one engine universally “best”. Every number above was produced by the exact Docker image deployed in production at the date shown, and re-verified after each engine release.',
        fr: 'Ce que nous ne prétendons pas : ces densités sont les nôtres, sur notre corpus, aux budgets indiqués — pas une certification tierce, et aucun benchmark ne fait d’un moteur « le meilleur » universellement. Chaque chiffre ci-dessus a été produit par l’image Docker exacte déployée en production à la date indiquée, et revérifié après chaque livraison du moteur.',
        pt: 'O que NÃO afirmamos: esses números de aproveitamento são nossos, no nosso corpus, com os orçamentos indicados — não são uma certificação de terceiros, e nenhum benchmark faz de um motor o “melhor” universalmente. Cada número acima foi produzido pela imagem Docker exata implantada em produção na data indicada e reverificado a cada versão do motor.',
        it: 'Ciò che NON affermiamo: questi valori sono i nostri, sul nostro corpus, con i budget indicati — non una certificazione di terze parti, e nessun benchmark rende un motore il «migliore» in assoluto. Ogni numero qui sopra è stato prodotto dall’immagine Docker esatta distribuita in produzione alla data indicata, e riverificato a ogni rilascio del motore.',
        de: 'Was wir NICHT behaupten: Diese Werte sind unsere eigenen, auf unserem Korpus, mit den angegebenen Budgets — keine Zertifizierung durch Dritte, und kein Benchmark macht eine Engine allgemein zur „besten“. Jede Zahl oben wurde vom exakt gleichen Docker-Image erzeugt, das zum angegebenen Datum in Produktion lief, und nach jeder Engine-Auslieferung neu geprüft.',
        es: 'Lo que NO afirmamos: estas cifras son nuestras, sobre nuestro corpus, con los presupuestos indicados — no son una certificación de terceros, y ningún benchmark hace de un motor el «mejor» de forma universal. Cada cifra de arriba fue producida por la imagen Docker exacta desplegada en producción en la fecha indicada, y se vuelve a verificar tras cada entrega del motor.',
    },
}
