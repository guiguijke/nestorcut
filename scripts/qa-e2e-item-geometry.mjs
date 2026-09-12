// QA E2E navigateur — lot E0 : le bandeau « géométrie de pièce refusée ».
//
// Ce que la capture prouve : quand le moteur refuse la géométrie d'UNE pièce
// à l'import, l'utilisateur lit désormais QUEL fichier et QUELLE pièce, au
// lieu de « The on-device compute stopped unexpectedly ». La chaîne mesurée
// est complète : import navigateur -> pool wasm -> message d'erreur moteur
// `item_geometry:<id>` -> itemMap -> bandeau i18n.
//
// Le fichier d'entrée est un DXF du corpus dont la pièce 1 porte un anneau
// que jagua refuse (« non-consecutive duplicate vertices ») — un défaut
// D'IMPORTEUR, distinct du gonflement réparé par E0, et c'est justement
// pourquoi il sert de témoin : le message doit marcher pour tout refus
// d'item, pas seulement pour celui qu'on vient de corriger.
//
// Deux passes, sur le MÊME fichier et la même app :
//   - QA_WASM=<nest_wasm_bg.wasm d'AVANT E0> : le moteur refuse l'item, on
//     capture le bandeau (c'est la panne de production) ;
//   - sans QA_WASM : le moteur du dépôt, qui doit MENER LE JOB AU BOUT
//     (QA_EXPECT=ok) — le contrôle positif du repli, vu du navigateur.
//
// Usage :
//   QA_FILE=<chemin dxf> QA_OUT=<dir> [QA_WASM=<wasm>] [QA_EXPECT=ok]
//   node scripts/qa-e2e-item-geometry.mjs
// Défaut QA_FILE : .qa-pw/e0/c73.dxf (copie ANONYME d'un fichier du corpus —
// le nom affiché dans la capture doit rester un identifiant, jamais un nom
// réel).
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('.qa-pw/e0')
const FILE = process.env.QA_FILE || path.join(OUT, 'c73.dxf')
// Moteur wasm substitué (pass « avant ») et attente d'un job qui aboutit.
const WASM = process.env.QA_WASM || null
const EXPECT_OK = process.env.QA_EXPECT === 'ok'
const TAG = process.env.QA_TAG || (WASM ? 'avant' : 'apres')
fs.mkdirSync(OUT, { recursive: true })

const logs = []
const log = (...a) => {
    const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`
    logs.push(s)
    console.log(s)
}
const flush = () => fs.writeFileSync(path.join(OUT, 'run.log'), logs.join('\n') + '\n')

if (!fs.existsSync(FILE)) {
    console.error(`fichier absent : ${FILE}`)
    process.exit(2)
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1680, height: 1000 } })
const page = await ctx.newPage()
if (WASM) {
    // Le nom de fichier du wasm ne change JAMAIS (piège AGENTS 14i) : on le
    // substitue par la route, pas par le cache.
    const bytes = fs.readFileSync(WASM)
    await page.route('**/engine/nest_wasm_bg.wasm', (route) =>
        route.fulfill({ status: 200, contentType: 'application/wasm', body: bytes }))
    log('moteur wasm substitué :', WASM, bytes.length, 'octets')
}
page.on('console', (m) => {
    const t = m.type()
    if (t === 'error' || t === 'warning') log(`[console:${t}]`, m.text().slice(0, 400))
})
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 400)))

const shot = async (name) => {
    try {
        await page.screenshot({ path: path.join(OUT, name), timeout: 60000 })
        log('capture:', name)
    } catch (e) { log('capture ÉCHOUÉE (non fatale):', name, String(e).slice(0, 120)) }
}

let failed = null
try {
    log('connexion')
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', 'guillaume@local.dev')
    await page.fill('.local-auth__form input[type="password"]', 'nestorcut-local-2026')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })

    log('projet « cet appareil » +', path.basename(FILE))
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const devCard = page
        .locator('.create__privacy [class*="option"], .create__privacy button, .create__privacy label')
        .filter({ hasText: /(This device|Cet appareil)/i })
        .first()
    if (await devCard.count()) await devCard.click().catch(() => {})
    await page.setInputFiles('input[name="dxf"]', [FILE])
    await page.waitForURL('**/project/**', { timeout: 60000 })
    log('projet ->', page.url())

    await page.waitForFunction(
        () => document.querySelectorAll('.files__item input.counter__value').length === 1,
        null, { timeout: 180000 },
    )
    const cardName = (await page.locator('.file__name').first().innerText()).trim()
    log('fichier importé :', cardName)
    const qty = page.locator('.files__item input.counter__value').first()
    await qty.click()
    await qty.fill('1')
    await qty.blur()
    await page.waitForTimeout(400)
    await shot(`01-${TAG}-avant-imbrication.png`)

    log('imbrication')
    await page.locator('.atelier__nest').click()

    if (EXPECT_OK) {
        // Contrôle positif : le job doit ABOUTIR. Même détection que le
        // harnais de référence (scripts/qa-e2e-local-2sheets.mjs) : l'item
        // de résultat porte ses boutons et la scène ne tourne plus.
        const t0 = Date.now()
        let outcome = 'timeout'
        while (Date.now() - t0 < 6 * 60 * 1000) {
            const err = (await page.locator('.content__error').allInnerTexts().catch(() => []))
                .map((x) => x.trim()).filter(Boolean).join(' | ')
            if (err) { outcome = 'erreur: ' + err; break }
            const item = page.locator('.results__item').first()
            if (await item.count()) {
                const running = await item.locator('.result__cancel').count()
                const failed = await item.locator('.result__placeholder').count()
                const doneBtn = await item.locator('.controls__report, .controls__download').count()
                const stageRunning = await page.locator('.stage__status').count()
                if (failed) { outcome = 'résultat en échec'; break }
                if (!running && doneBtn && !stageRunning) { outcome = 'done'; break }
            }
            await page.waitForTimeout(3000)
        }
        log('issue :', outcome, `(${((Date.now() - t0) / 1000).toFixed(0)} s)`)
        await shot(`02-${TAG}-scene-finale.png`)
        if (outcome === 'done') {
            await page.locator('[data-testid="result-area"]').first().click().catch(() => {})
            await page.waitForSelector('.modal', { timeout: 30000 }).catch(() => {})
            await page.waitForTimeout(1500)
            await shot(`03-${TAG}-modal.png`)
            const state = await page.locator('[data-testid="result-state"]').allInnerTexts().catch(() => [])
            log('état du résultat :', JSON.stringify(state))
            fs.writeFileSync(path.join(OUT, `resultat-${TAG}.json`),
                JSON.stringify({ outcome, state }, null, 1))
        }
        if (outcome !== 'done') throw new Error(`job non abouti : ${outcome}`)
        log('VERDICT : le job aboutit avec le moteur du dépôt')
        flush()
        await browser.close()
        process.exit(0)
    }

    // Le bandeau d'erreur de la scène (.content__error) est le seul message
    // de refus affiché (AF1).
    await page.waitForSelector('.content__error', { timeout: 300000 })
    const banner = (await page.locator('.content__error').first().innerText()).trim()
    log('bandeau :', banner)
    await shot(`02-${TAG}-bandeau-piece-refusee.png`)

    // Ce que le bandeau DOIT dire, et ce qu'il ne doit plus dire.
    const checks = {
        nommeLeFichier: banner.includes(path.basename(FILE)) || banner.includes(cardName),
        nommeLaPiece: /pièce\s+\d+|part\s+\d+/i.test(banner),
        annonceLeRemboursement: /rembours|refund/i.test(banner),
        plusDeMessageGenerique: !/inattendue|unexpectedly/i.test(banner),
        pasDeGabaritNonSubstitue: !/\{file\}|\{part\}/.test(banner),
    }
    log('vérifications :', JSON.stringify(checks))
    fs.writeFileSync(
        path.join(OUT, 'banner.json'),
        JSON.stringify({ file: path.basename(FILE), cardName, wasm: WASM, banner, checks }, null, 1),
    )
    const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k)
    if (bad.length) throw new Error(`bandeau incomplet : ${bad.join(', ')}`)
    log('VERDICT : le bandeau nomme le fichier et la pièce, remboursement annoncé')
} catch (e) {
    failed = e
    log('ÉCHEC :', String(e).slice(0, 500))
    await shot(`99-${TAG}-echec.png`)
} finally {
    flush()
    await browser.close()
    if (failed) process.exit(1)
}
