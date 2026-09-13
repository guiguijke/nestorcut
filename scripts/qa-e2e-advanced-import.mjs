// QA E2E navigateur — lot E3 : l'interrupteur « Import avancé » porté par le
// PROJET, et la fenêtre de choix au dépôt
// (`docs/PLAN-ECLATEMENT-2026-09-12.md` §6.2).
//
// Sept cas : les six de la consigne, plus le cas serveur G demandé par la
// vérification du lot E3 (`docs/PLAN-ECLATEMENT-2026-09-12.md`, section
// « Lot E3 — vérification »).
//
//   A. interrupteur ÉTEINT, un DXF multi-pièces ⇒ UNE fiche, nom intact,
//      AUCUNE fenêtre, et rien n'est mis en attente de lecture ;
//   B. ALLUMÉ, le même fichier, « Import automatique » ⇒ UNE fiche, la même
//      qu'au cas A (nom et nombre de pièces comparés) ;
//   C. ALLUMÉ, « Éclater » ⇒ une fiche par pièce, l'aperçu prend la main et
//      sa poignée règle l'échelle (la seule commande d'échelle depuis que le
//      panneau replié a disparu) ;
//   D. ALLUMÉ, dépôt de TROIS fichiers ⇒ UNE seule fenêtre, qui les liste
//      tous les trois ;
//   E. ALLUMÉ, un `.job` SheetCam + ses dessins ⇒ AUCUNE fenêtre (un `.job`
//      porte déjà sa tôle et ses quantités — règle du lot J4) ;
//   F. captures FR et EN de l'interrupteur allumé et de la fenêtre ;
//   G. projet « NOS SERVEURS », interrupteur allumé, « Éclater » ⇒ les
//      fiches sont produites PAR LE WORKER, une par pièce, et mesurées sur la
//      réponse de `/api/project/<slug>` — jamais sur l'écran. C'est le pendant
//      serveur du cas C, et l'équivalent du cas G du lot E2.
//
// CE QUE CE HARNAIS NE MESURE PAS, et qu'il faut savoir : le NOMBRE D'APPELS
// WASM. Playwright ne voit pas les appels d'un module wasm chargé dans un
// worker. Le cas A vérifie donc ce qui est observable — aucune fenêtre, une
// fiche, rien en attente — et le compte d'appels est verrouillé là où il est
// mesurable, dans `app/tests/advancedImportChoice.test.js`, où le wasm est
// moqué et les appels comptés un à un.
//
// Le fichier d'entrée est passé par QA_FILE (copie anonyme d'un fichier
// d'atelier : aucun nom réel ne sort d'ici). Le nombre de pièces attendu au
// cas C n'est JAMAIS écrit en dur : il est mesuré au cas A sur le même
// fichier.
//
// Usage :
//   QA_FILE=<dxf multi-pièces> QA_OUT=<dir> [QA_LOCALE=fr|en]
//   [QA_TARGET_MM=1000] [QA_JOB=<fichier.job> QA_DXF_DIR=<dossier>]
//   node scripts/qa-e2e-advanced-import.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('.qa-pw/e3')
const FILE = process.env.QA_FILE || path.resolve('.testparts/Piece_Trou.DXF')
const LOCALE = process.env.QA_LOCALE || 'fr'
const TARGET_MM = Number(process.env.QA_TARGET_MM || 1000)
const JOB = process.env.QA_JOB || path.resolve('app/tests/fixtures/sheetcam/source.job')
const DXF_DIR = process.env.QA_DXF_DIR || path.resolve('.testparts')
fs.mkdirSync(OUT, { recursive: true })

const logs = []
const log = (...a) => {
    const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`
    logs.push(s)
    console.log(s)
}
const results = {}
let failures = 0
const check = (name, ok, detail = '') => {
    results[name] = { ok: Boolean(ok), detail: String(detail) }
    if (!ok) failures++
    log(ok ? 'OK  ' : 'ÉCHEC', name, detail ? `— ${detail}` : '')
}
const flush = () => {
    fs.writeFileSync(path.join(OUT, 'run.log'), logs.join('\n') + '\n')
    fs.writeFileSync(path.join(OUT, 'resultats.json'), JSON.stringify(results, null, 1))
}

if (!fs.existsSync(FILE)) {
    console.error(`fichier absent : ${FILE}`)
    process.exit(2)
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
    locale: LOCALE === 'fr' ? 'fr-FR' : 'en-US',
    viewport: { width: 1680, height: 1000 },
})
await ctx.addCookies([{
    name: 'locale', value: LOCALE, domain: new URL(BASE).hostname, path: '/',
}])
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') log('[console:error]', m.text().slice(0, 300)) })
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))

const shot = async (name) => {
    try { await page.screenshot({ path: path.join(OUT, name), timeout: 60000 }); log('capture:', name) }
    catch (e) { log('capture échouée (non fatale):', name, String(e).slice(0, 100)) }
}

/**
 * Les fiches DU PROJET, lues dans IndexedDB — jamais déduites de l'écran.
 *
 * LE FILTRE PAR PROJET N'EST PAS UN DÉTAIL : la base est partagée par tous
 * les projets de l'appareil, et sans lui les comptes de chaque cas
 * s'additionnent à ceux des cas précédents. Premier passage du harnais :
 * 19 fiches « pour 17 pièces », 2 fiches au cas B, « Annuler » accusé d'en
 * avoir créé 19. Cinq échecs, tous imaginaires.
 */
const cards = (slug) => page.evaluate(async (only) => {
    const db = await new Promise((res, rej) => {
        const r = indexedDB.open('nestorcut-local')
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    })
    const recs = await new Promise((res, rej) => {
        const tx = db.transaction('files', 'readonly').objectStore('files').getAll()
        tx.onsuccess = () => res(tx.result || []); tx.onerror = () => rej(tx.error)
    })
    return recs.filter((r) => !only || r.projectSlug === only).map((r) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const p of r.parts || []) {
            for (const [x, y] of p.coordinates || []) {
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
        }
        return {
            name: r.name,
            parts: (r.parts || []).length,
            width: Number.isFinite(minX) ? Math.round((maxX - minX) * 100) / 100 : null,
            height: Number.isFinite(minY) ? Math.round((maxY - minY) * 100) / 100 : null,
            explodedFrom: r.explodedFrom ?? null,
            hasCut: Boolean(r.sheetcam),
        }
    })
}, slug)

async function login() {
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', 'guillaume@local.dev')
    await page.fill('.local-auth__form input[type="password"]', 'nestorcut-local-2026')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
}

/**
 * Crée un projet avec l'interrupteur dans l'état demandé, en déposant `files`.
 * L'interrupteur est celui de la PAGE D'ACCUEIL : son état part avec la
 * création et devient une propriété du projet.
 *
 * `local: false` crée un projet « nos serveurs ». Les cartes de mode sont des
 * `role=radio` (PrivacyModePicker) : viser le bouton ferait tomber le clic sur
 * « Activer le coffre ».
 */
async function createProject(files, { advanced = false, local = true } = {}) {
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const card = page
        .locator('.create__privacy [role="radio"]')
        .filter({ hasText: local ? /(This device|Cet appareil)/i : /(Our servers|Nos serveurs)/i })
        .first()
    await card.waitFor({ timeout: 30000 })
    await card.click().catch(() => {})
    if (!local && (await card.getAttribute('aria-checked')) !== 'true') {
        throw new Error('le projet « nos serveurs » n’est pas sélectionné (aria-checked)')
    }

    const sw = page.locator('[data-testid="advanced-import-switch-btn"]')
    await sw.waitFor({ timeout: 30000 })
    const on = (await sw.getAttribute('aria-checked')) === 'true'
    if (on !== advanced) await sw.click()
    if (((await sw.getAttribute('aria-checked')) === 'true') !== advanced) {
        throw new Error('interrupteur non positionné')
    }

    await page.setInputFiles('input[name="dxf"]', files)
    await page.waitForURL('**/project/**', { timeout: 90000 })
    return page.url().split('/project/')[1].split(/[?#]/)[0]
}

/**
 * La fenêtre de choix est-elle ouverte ET a-t-elle fini de LIRE ?
 *
 * La fenêtre s'affiche d'abord en « lecture du dessin… » : la liste des
 * fichiers n'existe qu'une fois la lecture finie. Attendre la fenêtre sans
 * attendre sa liste mesure un écran de chargement — le harnais a commencé par
 * faire cette erreur (0 ligne au cas B) et c'est le harnais qui était faux,
 * pas la fenêtre.
 */
/**
 * Fiches d'un projet SERVEUR, lues dans la réponse de l'API — jamais déduites
 * de l'écran (cas G). Reprises du harnais du lot E2.
 */
const serverCards = (slug) => page.evaluate(async (s) => {
    const data = await $fetch(`/api/project/${s}`)
    return (data.files || []).map((f) => {
        const ws = (f.parts || []).map((p) => p.width)
        const hs = (f.parts || []).map((p) => p.height)
        return {
            name: f.name,
            status: f.processingStatus,
            parts: (f.parts || []).length,
            maxWidth: ws.length ? Math.max(...ws) : null,
            maxHeight: hs.length ? Math.max(...hs) : null,
        }
    })
}, slug)

/**
 * Attend que TOUTES les fiches du projet serveur soient traitées.
 *
 * Boucle côté Node, PAS `waitForFunction` : un prédicat `async` y rend une
 * Promesse, que le polling injecté juge VRAIE tout de suite — l'attente
 * réussit alors sans rien attendre (mesure du lot E2 : 1 fiche
 * « in-progress » acceptée pour 18 attendues).
 */
async function waitServerDone(slug, expected, timeoutMs = 300000) {
    const t0 = Date.now()
    let files = []
    while (Date.now() - t0 < timeoutMs) {
        files = await serverCards(slug)
        const done = files.filter((f) => f.status === 'done').length
        if (files.length >= expected && done === files.length) return files
        if (files.some((f) => f.status === 'error')) {
            throw new Error(`fiche en erreur côté serveur (${done}/${files.length} prêtes)`)
        }
        await page.waitForTimeout(2000)
    }
    throw new Error(`attente serveur épuisée : ${files.length} fiche(s), `
        + `${files.filter((f) => f.status === 'done').length} prêtes, ${expected} attendues`)
}

async function choiceOpen(timeout = 8000, expectFiles = 0) {
    try {
        await page.locator('[data-testid="import-choice"]').waitFor({ timeout })
    } catch { return false }
    if (expectFiles > 0) {
        await page.waitForFunction(
            (n) => document.querySelectorAll('[data-testid="import-choice-list"] li').length >= n,
            expectFiles,
            { timeout: 120000 },
        ).catch(() => {})
    }
    return true
}

try {
    await login()

    // ---------- A. interrupteur ÉTEINT ----------
    const slugA = await createProject([FILE], { advanced: false })
    check('A1 aucune fenêtre quand l’interrupteur est éteint', !(await choiceOpen(6000)))
    await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="file-card"], .file').length >= 1,
        null, { timeout: 120000 },
    ).catch(() => {})
    const aCards = await cards(slugA)
    log('cas A, fiches :', JSON.stringify(aCards))
    check('A2 une seule fiche, nom intact', aCards.length === 1
        && aCards[0].name === path.basename(FILE),
        `${aCards.length} fiche(s) : ${aCards.map((c) => c.name).join(', ')}`)
    const PARTS = aCards[0]?.parts || 0
    const WIDTH = aCards[0]?.width || 0
    check('A3 le dessin multi-pièces est resté ENTIER', PARTS >= 1,
        `${PARTS} pièces, ${WIDTH} mm de large`)
    await shot('A-eteint.png')

    // ---------- B. ALLUMÉ + « Import automatique » ----------
    const slugB = await createProject([FILE], { advanced: true })
    check('B1 la fenêtre s’ouvre quand l’interrupteur est allumé', await choiceOpen(30000, 1))
    const listed = await page.locator('[data-testid="import-choice-list"] li').count()
    check('B2 la fenêtre liste le fichier déposé', listed === 1, `${listed} ligne(s)`)
    await shot('B-fenetre.png')
    await page.locator('[data-testid="import-choice-auto"]').click()
    await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="file-card"], .file').length >= 1,
        null, { timeout: 120000 },
    ).catch(() => {})
    const bCards = await cards(slugB)
    log('cas B, fiches :', JSON.stringify(bCards))
    check('B3 « Import automatique » rend LA MÊME fiche que le cas A',
        bCards.length === 1 && bCards[0].name === aCards[0]?.name
        && bCards[0].parts === PARTS && bCards[0].width === WIDTH,
        `${bCards.length} fiche(s), ${bCards[0]?.parts} pièces, ${bCards[0]?.width} mm`)

    // ---------- C. ALLUMÉ + « Éclater » + largeur cible ----------
    const slugC = await createProject([FILE], { advanced: true })
    check('C1 la fenêtre s’ouvre', await choiceOpen(30000, 1))
    await page.locator('[data-testid="import-choice-explode"]').click()
    await page.locator('[data-testid="import-preview"]').waitFor({ timeout: 30000 })
    await shot('C-apercu.png')
    // L'ÉCHELLE se règle à la poignée de l'aperçu : on la TIRE, et le facteur
    // annoncé doit CHANGER. Exiger seulement qu'un facteur s'affiche serait un
    // verrou creux — le premier passage de ce harnais est passé au vert sur
    // « facteur 1 », c'est-à-dire sur une poignée qui n'avait pas bougé.
    const avant = (await page.locator('[data-testid="import-preview-factor"]')
        .innerText().catch(() => '')).trim()
    const handle = page.locator('[data-testid="import-preview-handle"]')
    await handle.scrollIntoViewIfNeeded().catch(() => {})
    const svgBox = await page.locator('[data-testid="import-preview-svg"]').boundingBox()
    const hBox = await handle.boundingBox()
    if (hBox && svgBox) {
        await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2)
        await page.mouse.down()
        // Un glissement FRANC et par pas, vers l'intérieur du cadre : la
        // poignée suit les `pointermove`, un saut d'un seul mouvement ne la
        // fait pas bouger.
        const cible = svgBox.x + svgBox.width * 0.35
        for (const t of [0.25, 0.5, 0.75, 1]) {
            const x = hBox.x + hBox.width / 2 + (cible - (hBox.x + hBox.width / 2)) * t
            await page.mouse.move(x, hBox.y + hBox.height / 2, { steps: 4 })
            await page.waitForTimeout(80)
        }
        await page.mouse.up()
    }
    const apres = (await page.locator('[data-testid="import-preview-factor"]')
        .innerText().catch(() => '')).trim()
    log('facteur avant / après la poignée :', avant, '/', apres)
    check('C4 la poignée CHANGE l’échelle, et l’aperçu l’annonce',
        Boolean(hBox) && apres !== '' && apres !== avant,
        `avant « ${avant} », après « ${apres} »`)
    await page.locator('[data-testid="import-preview-confirm"]').click()
    await page.waitForFunction(
        (n) => document.querySelectorAll('[data-testid="file-card"], .file').length >= n,
        PARTS, { timeout: 180000 },
    ).catch(() => log('ATTENTION : le compte de fiches éclatées n’est pas atteint'))
    const cCards = await cards(slugC)
    log('cas C, fiches :', cCards.length, JSON.stringify(cCards.slice(0, 3)))
    check('C2 une fiche par pièce', cCards.length === PARTS,
        `${cCards.length} fiches pour ${PARTS} pièces`)
    check('C3 chaque fiche vient du dessin éclaté et porte UNE pièce',
        cCards.every((c) => c.explodedFrom === path.basename(FILE) && c.parts === 1),
        JSON.stringify(cCards.map((c) => [c.explodedFrom, c.parts]).slice(0, 3)))

    // ---------- D. dépôt MULTIPLE ----------
    const trio = [FILE, FILE, FILE]
    const slugD = await createProject(trio, { advanced: true })
    check('D1 UNE seule fenêtre pour le lot déposé', await choiceOpen(30000, 3))
    const dialogs = await page.locator('[data-testid="import-choice"]').count()
    const dListed = await page.locator('[data-testid="import-choice-list"] li').count()
    check('D2 la fenêtre est unique et liste les trois fichiers',
        dialogs === 1 && dListed === 3, `${dialogs} fenêtre(s), ${dListed} ligne(s)`)
    await shot('D-depot-multiple.png')
    await page.locator('[data-testid="import-choice-cancel"]').click()
    const dAfter = await cards(slugD)
    check('D3 « Annuler » ne crée aucune fiche', dAfter.length === 0,
        `${dAfter.length} fiche(s)`)

    // ---------- E. un `.job` SheetCam ne passe JAMAIS par la fenêtre ------
    if (fs.existsSync(JOB)) {
        const { parseSheetCamJob, jobDrawingName } = await import('../shared/sheetcamJob.js')
        const job = parseSheetCamJob(new Uint8Array(fs.readFileSync(JOB)))
        const names = [...new Set(job.parts.map((p) => jobDrawingName(p.drawingFile)))]
        const drawings = []
        for (const n of names) {
            const found = fs.existsSync(DXF_DIR)
                ? fs.readdirSync(DXF_DIR).find((f) => f.toLowerCase() === n.toLowerCase())
                : null
            if (found) drawings.push(path.join(DXF_DIR, found))
        }
        if (drawings.length === names.length) {
            const slugE = await createProject([JOB, ...drawings], { advanced: true })
            check('E1 un `.job` ne déclenche AUCUNE fenêtre', !(await choiceOpen(8000)))
            await page.waitForFunction(
                (n) => document.querySelectorAll('[data-testid="file-card"], .file').length >= n,
                names.length, { timeout: 120000 },
            ).catch(() => {})
            const eCards = await cards(slugE)
            log('cas E, fiches :', JSON.stringify(eCards))
            check('E2 les fiches du `.job` sont créées avec leurs réglages de coupe',
                eCards.length === names.length && eCards.every((c) => c.hasCut),
                `${eCards.length} fiche(s) pour ${names.length} dessin(s)`)
        } else {
            log('cas E NON MESURÉ : dessins du `.job` absents de', DXF_DIR)
            check('E1 un `.job` ne déclenche AUCUNE fenêtre', false,
                `dessins introuvables : ${names.join(', ')}`)
        }
    } else {
        log('cas E NON MESURÉ : aucun `.job` fourni (QA_JOB)')
        check('E1 un `.job` ne déclenche AUCUNE fenêtre', false, 'QA_JOB absent')
    }

    // ---------- F. captures des RÉGLAGES, dans la langue demandée --------
    // Jamais un dessin d'atelier dans `docs/` : ces captures ne montrent que
    // l'interrupteur et la fenêtre, réglages seuls.
    await createProject([FILE], { advanced: true })
    await choiceOpen(30000, 1)
    await shot(`F-fenetre-${LOCALE}.png`)
    await page.locator('[data-testid="import-choice-cancel"]').click()
    const swBox = page.locator('[data-testid="advanced-import-switch"]').first()
    if (await swBox.count()) {
        try {
            await swBox.screenshot({ path: path.join(OUT, `F-interrupteur-${LOCALE}.png`) })
            log('capture:', `F-interrupteur-${LOCALE}.png`)
        } catch (e) { log('capture échouée (non fatale):', String(e).slice(0, 100)) }
    }
    check('F1 captures produites', fs.existsSync(path.join(OUT, `F-fenetre-${LOCALE}.png`)))

    // ---------- G. projet « NOS SERVEURS » : la même fenêtre, l'éclatement
    // fait par le WORKER -------------------------------------------------
    //
    // Pourquoi DEUX dépôts. Sur le chemin « nos serveurs », la création
    // emporte les octets avec elle (`home.vue` : le multipart part avec le
    // POST du projet). L'interrupteur ne gouverne donc PAS cette première
    // dépose — il est posé juste après, par le même PATCH que la page projet,
    // et il gouverne les suivantes. La séquence de l'utilisateur est celle-ci,
    // et c'est elle qu'on mesure : une fiche ordinaire, puis une dépose qui
    // passe par la fenêtre.
    //
    // Tout est mesuré sur la réponse de l'API, jamais sur l'écran.
    const slugG = await createProject([FILE], { advanced: true, local: false })
    log('cas G, projet serveur :', slugG)
    const g0 = await waitServerDone(slugG, 1)
    check('G1 la création « nos serveurs » donne la fiche ordinaire',
        g0.length === 1 && g0[0].parts === PARTS,
        `${g0.length} fiche(s), ${g0[0]?.parts} pièces`)

    await page.setInputFiles('input[name="dxf"]', [FILE])
    check('G2 la fenêtre s’ouvre AUSSI sur un projet « nos serveurs »',
        await choiceOpen(30000, 1))
    await page.locator('[data-testid="import-choice-explode"]').click()
    await page.locator('[data-testid="import-preview"]').waitFor({ timeout: 30000 })
    await shot('G-apercu-serveur.png')
    await page.locator('[data-testid="import-preview-confirm"]').click()

    // L'éclatement serveur redépose une fiche par pièce dans la boucle
    // ordinaire du worker : 1 (première dépose) + PARTS. Le dessin éclaté,
    // lui, est marqué et masqué — il ne compte pas.
    const gFiles = await waitServerDone(slugG, 1 + PARTS, 600000)
    const gExploded = gFiles.filter((f) => /\(\d+\/\d+\)/.test(f.name))
    log('cas G, fiches serveur :', gFiles.length, 'dont éclatées', gExploded.length,
        JSON.stringify(gExploded.slice(0, 3).map((f) => `${f.name} [${f.parts}p]`)))
    check('G3 une fiche serveur par pièce, produite par le worker',
        gExploded.length === PARTS,
        `${gExploded.length} fiches éclatées pour ${PARTS} pièces`)
    check('G4 chaque fiche éclatée porte UNE pièce, rangs 1..N sans trou',
        gExploded.length === PARTS
        && gExploded.every((f) => f.parts === 1)
        && new Set(gExploded.map((f) => Number(f.name.match(/\((\d+)\/\d+\)/)?.[1]))).size === PARTS,
        JSON.stringify(gExploded.map((f) => f.parts).slice(0, 5)))
    check('G5 le dessin éclaté n’est plus une fiche (1 dépose ordinaire + N)',
        gFiles.length === 1 + PARTS, `${gFiles.length} fiches pour ${1 + PARTS} attendues`)
    await shot('G-eclatement-serveur.png')

    log(failures ? `${failures} VERROU(S) EN ÉCHEC` : 'TOUS LES VERROUS SONT VERTS')
} catch (e) {
    log('EXCEPTION', String(e).slice(0, 500))
    failures++
} finally {
    flush()
    await browser.close()
}
process.exit(failures ? 1 : 0)
