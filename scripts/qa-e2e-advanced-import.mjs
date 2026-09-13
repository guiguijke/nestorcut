// QA E2E navigateur — lot E1 : « Import avancé » (éclatement + échelle).
//
// Quatre verrous produit du §3.4 du plan, plus les deux ajouts de la
// vérification E0 (badge et ligne d'état comptent les PIÈCES) :
//
//   A. option ÉTEINTE : une fiche, nom intact, même temps d'import ;
//   F. aperçu sur une tôle (lot E1-bis) : hors-tôle signalé, poignée tirée
//      à 900 mm d'étendue -> facteur affiché et pièces importées à cette
//      échelle, changer de tôle ne change pas le facteur ;
//   B. éclatement : une fiche par pièce, nommée « (k/N) », quantités
//      indépendantes, puis imbrication N/N ;
//   C. échelle ×0,5 : largeur totale du dessin divisée par deux, mesurée
//      sur les pièces IMPORTÉES (lues dans IndexedDB, pas déduites) ;
//   D. largeur cible : facteur déduit, largeur obtenue = la cible.
//
// Lot E2 — les MÊMES options sur un projet SERVEUR (« nuage ») : les mêmes
// réglages du même panneau, appliqués par le worker Python et non par le
// navigateur. Mesuré sur la réponse de `/api/project/<slug>` (l'API, pas le
// DOM) :
//
//   G. éclatement serveur : une fiche par pièce, nommée « (k/N) », le dessin
//      d'origine ABSENT de la liste, la géométrie de chaque fiche = une pièce ;
//   H. échelle serveur : facteur ×0,5 et largeur cible, étendue mesurée sur
//      les pièces renvoyées + le constat `import.scaleApplied` présent.
//
// Le fichier d'entrée est passé par QA_FILE (copie anonyme d'un fichier
// d'atelier : aucun nom réel ne sort d'ici).
//
// Usage :
//   QA_FILE=<dxf> QA_OUT=<dir> [QA_CASES=A,B,C,D] [QA_SHEET=1000x2000]
//   node scripts/qa-e2e-advanced-import.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('.qa-pw/e1')
const FILE = process.env.QA_FILE || path.join(OUT, 'volute.dxf')
const CASES = (process.env.QA_CASES || 'A,B,C,D').split(',').map((s) => s.trim())
const [SHEET_W, SHEET_H] = (process.env.QA_SHEET || '1000x2000').split('x').map(Number)
// Etendue du dessin complet, en mm : le facteur d'une « largeur cible » s'en
// deduit (cible / etendue). Mesuree sur le fichier d'entree, jamais devinee :
// QA_DRAWING_W la fixe pour un autre fichier que le logo d'atelier.
const DRAWING_WIDTH_MM = Number(process.env.QA_DRAWING_W || 2834.34)
fs.mkdirSync(OUT, { recursive: true })

const logs = []
const log = (...a) => {
    const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`
    logs.push(s)
    console.log(s)
}
const results = {}
const flush = () => {
    fs.writeFileSync(path.join(OUT, 'run.log'), logs.join('\n') + '\n')
    fs.writeFileSync(path.join(OUT, 'resultats.json'), JSON.stringify(results, null, 1))
}

if (!fs.existsSync(FILE)) {
    console.error(`fichier absent : ${FILE}`)
    process.exit(2)
}

const browser = await chromium.launch({ headless: true })
// QA_LOCALE : les captures doivent exister dans les deux langues (la langue
// vient du cookie `locale`, pas seulement de l'en-tête du navigateur).
const LOCALE = process.env.QA_LOCALE || 'fr'
const ctx = await browser.newContext({
    locale: LOCALE === 'fr' ? 'fr-FR' : 'en-US',
    viewport: { width: 1680, height: 1000 },
})
await ctx.addCookies([{
    name: 'locale', value: LOCALE, domain: new URL(BASE).hostname, path: '/',
}])
const page = await ctx.newPage()
page.on('console', (m) => {
    const t = m.type()
    if (t === 'error') log(`[console:error]`, m.text().slice(0, 300))
})
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))

const shot = async (name) => {
    try {
        await page.screenshot({ path: path.join(OUT, name), timeout: 60000 })
        log('capture:', name)
    } catch (e) { log('capture ÉCHOUÉE (non fatale):', name, String(e).slice(0, 100)) }
}

/** Étendue du dessin importé, LUE dans IndexedDB (pas déduite de l'écran). */
const measureStore = () => page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
        const r = indexedDB.open('nestorcut-local')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
    })
    const recs = await new Promise((res, rej) => {
        const tx = db.transaction('files', 'readonly').objectStore('files').getAll()
        tx.onsuccess = () => res(tx.result || [])
        tx.onerror = () => rej(tx.error)
    })
    return recs.map((r) => {
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
            importScale: r.importScale ?? null,
            explodedFrom: r.explodedFrom ?? null,
            explodedIndex: r.explodedIndex ?? null,
            findings: (r.findings || []).map((f) => `${f.code}:${f.count}`),
        }
    })
})

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

/** Nouveau projet « cet appareil » vide (aucun fichier déposé). */
async function newProject() {
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const devCard = page
        .locator('.create__privacy [class*="option"], .create__privacy button, .create__privacy label')
        .filter({ hasText: /(This device|Cet appareil)/i })
        .first()
    if (await devCard.count()) await devCard.click().catch(() => {})
}

/** Nouveau projet SERVEUR (« nuage ») vide — le chemin d'avant J-090, celui
 *  dont le lot E2 fait le miroir. Le choix par défaut n'est pas garanti :
 *  on clique explicitement la carte « nuage ». */
async function newCloudProject() {
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    // Les cartes sont des `role=radio` (PrivacyModePicker) — pas des boutons :
    // viser le bouton ferait tomber le clic sur « Activer le coffre ».
    const cloudCard = page
        .locator('.create__privacy [role="radio"]')
        .filter({ hasText: /(Our servers|Nos serveurs)/i })
        .first()
    await cloudCard.waitFor({ timeout: 30000 })
    await cloudCard.click()
    if ((await cloudCard.getAttribute('aria-checked')) !== 'true') {
        throw new Error('le projet serveur n’est pas selectionne (aria-checked)')
    }
}

/** Fiches du projet SERVEUR, lues dans la réponse de l'API (jamais déduites
 *  de l'écran) : nom, nombre de pièces, étendue et constats d'import. */
const measureServer = (slug) => page.evaluate(async (s) => {
    const data = await $fetch(`/api/project/${s}`)
    return (data.files || []).map((f) => {
        const ws = (f.parts || []).map((p) => p.width)
        const hs = (f.parts || []).map((p) => p.height)
        return {
            name: f.name,
            status: f.processingStatus,
            parts: (f.parts || []).length,
            // L'API rend la bbox de CHAQUE pièce (arrondie au dixième) : pour
            // une fiche éclatée il n'y en a qu'une, c'est la mesure voulue.
            maxWidth: ws.length ? Math.max(...ws) : null,
            maxHeight: hs.length ? Math.max(...hs) : null,
            findings: (f.findings || []).map((x) => `${x.code}:${x.value ?? x.count}`),
        }
    })
}, slug)

/** Attend que TOUTES les fiches du projet serveur soient traitées.
 *
 *  Boucle cote Node, PAS `waitForFunction` : un predicat `async` y rend une
 *  Promesse, que le polling injecte juge VRAIE tout de suite — l'attente
 *  reussit alors sans rien attendre (mesure : 1 fiche « in-progress »
 *  acceptee pour 18 attendues). */
async function waitServerDone(slug, expected, timeoutMs = 300000) {
    const t0 = Date.now()
    let last = null
    while (Date.now() - t0 < timeoutMs) {
        last = await page.evaluate((s) => $fetch(`/api/project/${s}`), slug)
        const files = last.files || []
        const done = files.filter((f) => f.processingStatus === 'done').length
        if (files.length >= expected && done === files.length) return files
        if (files.some((f) => f.processingStatus === 'error')) {
            throw new Error(`fiche en erreur cote serveur (${done}/${files.length} pretes)`)
        }
        await page.waitForTimeout(2000)
    }
    const files = last?.files || []
    throw new Error(
        `attente serveur epuisee : ${files.length} fiche(s), `
        + `${files.filter((f) => f.processingStatus === 'done').length} pretes, ${expected} attendues`)
}

/** Règle le panneau « Import avancé » de la page projet. */
async function setAdvanced({ explode = false, mode = null, value = null }) {
    const toggle = page.locator('[data-testid="advanced-import-toggle"]')
    await toggle.waitFor({ timeout: 30000 })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    const box = page.locator('[data-testid="advanced-import-explode"]')
    if ((await box.isChecked()) !== explode) await box.setChecked(explode)
    if (mode) {
        await page.locator(`[data-testid="advanced-import-mode-${mode}"]`).click()
        const field = page.locator('[data-testid="advanced-import-value"]')
        await field.fill(String(value))
        await field.dispatchEvent('change')
    }
}

/** Eclate le fichier par le chemin NAVIGATEUR et rend les fiches mesurees.
 *
 *  Meme sequence que le cas B : le panneau vit sur la page projet, donc une
 *  premiere depose cree le projet, on regle, on redepose. Depuis le lot
 *  E1-bis, panneau OUVERT = la depose passe par l'apercu : on valide. */
async function localExplode() {
    await newProject()
    await page.setInputFiles('input[name="dxf"]', [FILE])
    await page.waitForURL('**/project/**', { timeout: 60000 })
    // L'etat du panneau est PARTAGE par la session : s'il etait reste ouvert
    // (cas precedent), la premiere depose part dans l'apercu et aucune fiche
    // n'est creee. On l'annule pour repartir d'un etat connu.
    const cancel = page.locator('[data-testid="import-preview-cancel"]')
    try {
        await cancel.waitFor({ timeout: 8000 })
        await cancel.click()
    } catch { /* pas d'apercu : la depose a suivi le chemin direct */ }
    await setAdvanced({ explode: true })
    const before = await page.locator('.files__item').count()
    await page.setInputFiles('input[name="dxf"]', [FILE])
    const confirm = page
        .locator('[data-testid="import-preview-confirm"] button, [data-testid="import-preview-confirm"]')
        .first()
    try {
        await confirm.waitFor({ timeout: 20000 })
        await confirm.click()
    } catch {
        // Pas d'apercu (panneau ferme, ou chemin direct) : rien a valider.
    }
    await page.waitForFunction(
        (n) => document.querySelectorAll('.files__item input.counter__value').length > n,
        before, { timeout: 300000 },
    )
    let stable = 0
    let last = -1
    while (stable < 3) {
        const n = await page.locator('.files__item').count()
        if (n === last) stable++
        else { stable = 0; last = n }
        await page.waitForTimeout(1000)
    }
    return (await measureStore()).filter((r) => r.explodedFrom)
}

let failed = null
try {
    await login()

    // ---------------- A. option éteinte : rien ne change ----------------
    if (CASES.includes('A')) {
        await newProject()
        const t0 = Date.now()
        await page.setInputFiles('input[name="dxf"]', [FILE])
        await page.waitForURL('**/project/**', { timeout: 60000 })
        await page.waitForFunction(
            () => document.querySelectorAll('.files__item input.counter__value').length >= 1,
            null, { timeout: 180000 },
        )
        const ms = Date.now() - t0
        const cards = await page.locator('.files__item').count()
        const store = await measureStore()
        results.A = { cards, ms, store }
        log('A — option éteinte :', JSON.stringify({ cards, ms, noms: store.map((s) => s.name) }))
        if (cards !== 1) throw new Error(`A : ${cards} fiches au lieu d'une`)
        if (store[0].importScale !== null) throw new Error('A : importScale posé alors que rien n’est demandé')
        await shot('01-A-option-eteinte.png')
    }

    // ---------------- B. éclatement + imbrication ----------------
    if (CASES.includes('B')) {
        await newProject()
        await page.setInputFiles('input[name="dxf"]', [FILE])
        await page.waitForURL('**/project/**', { timeout: 60000 })
        await page.waitForFunction(
            () => document.querySelectorAll('.files__item input.counter__value').length >= 1,
            null, { timeout: 180000 },
        )
        // Le panneau vit sur la page projet : on règle, puis on re-dépose.
        await setAdvanced({ explode: true })
        const before = await page.locator('.files__item').count()
        const t0 = Date.now()
        await page.setInputFiles('input[name="dxf"]', [FILE])
        await page.waitForFunction(
            (n) => document.querySelectorAll('.files__item input.counter__value').length > n,
            before, { timeout: 300000 },
        )
        // Laisser la liste se stabiliser (une fiche par pièce).
        let stable = 0
        let last = -1
        while (stable < 3) {
            const n = await page.locator('.files__item').count()
            if (n === last) stable++
            else { stable = 0; last = n }
            await page.waitForTimeout(1000)
        }
        const ms = Date.now() - t0
        const store = (await measureStore()).filter((s) => s.explodedFrom)
        const cards = await page.locator('.files__item').count()
        results.B = {
            cards, ms, exploded: store.length,
            parts: store.map((s) => s.parts),
            index: store.map((s) => s.explodedIndex),
            noms: store.map((s) => s.name).slice(0, 3),
        }
        log('B — éclatement :', JSON.stringify(results.B))
        await shot('02-B-fiches-eclatees.png')
        if (!store.length) throw new Error('B : aucune fiche éclatée')
        if (store.some((s) => s.parts !== 1)) throw new Error('B : une fiche porte plusieurs pièces')

        // Quantités indépendantes : la 2e fiche éclatée passe à 3.
        const qty = page.locator('.files__item input.counter__value')
        const n = await qty.count()
        await qty.nth(n - 1).fill('3')
        await qty.nth(n - 1).blur()
        await page.waitForTimeout(500)
        const values = await qty.evaluateAll((els) => els.map((e) => e.value))
        results.B.quantites = values
        log('B — quantités :', values.join(','))
        if (values.filter((v) => v === '3').length !== 1) {
            throw new Error(`B : la quantité n'est pas indépendante (${values.join(',')})`)
        }
        await qty.nth(n - 1).fill('1')
        await qty.nth(n - 1).blur()

        // La fiche NON éclatée (déposée au début) passe à la quantité 0 : on
        // ne neste QUE les pièces unitaires, sans dépendre d'un bouton de
        // suppression ni d'une boîte de confirmation.
        const first = page.locator('.files__item input.counter__value').first()
        await first.fill('0')
        await first.blur()
        await page.waitForTimeout(800)
        const qtys = await page.locator('.files__item input.counter__value').evaluateAll(
            (els) => els.map((e) => e.value),
        )
        log('quantités avant imbrication :', qtys.join(','))

        // Tôle et espacement, puis imbrication.
        const sheet = page.locator('.size__sheet').first()
        const dims = sheet.locator('.size__line .input__value')
        await dims.nth(0).fill(String(SHEET_W))
        await dims.nth(0).blur()
        await dims.nth(1).fill(String(SHEET_H))
        await dims.nth(1).blur()
        const kerf = page.locator('label.input', { hasText: /Kerf|Saignée/i }).locator('.input__value')
        if (await kerf.count()) { await kerf.first().fill('0'); await kerf.first().blur() }
        const safety = page.locator('label.input', { hasText: /Safety|Sécurité/i }).locator('.input__value')
        if (await safety.count()) { await safety.first().fill('1'); await safety.first().blur() }
        await page.waitForTimeout(500)
        await shot('03-B-avant-imbrication.png')
        await page.locator('.atelier__nest').click()
        log('imbrication lancée')
        const t1 = Date.now()
        let outcome = 'timeout'
        while (Date.now() - t1 < 8 * 60 * 1000) {
            const err = (await page.locator('.content__error').allInnerTexts().catch(() => []))
                .map((x) => x.trim()).filter(Boolean).join(' | ')
            if (err) { outcome = 'erreur: ' + err; break }
            const item = page.locator('.results__item').first()
            if (await item.count()) {
                const running = await item.locator('.result__cancel').count()
                const done = await item.locator('.controls__report, .controls__download').count()
                const stageRunning = await page.locator('.stage__status').count()
                if (!running && done && !stageRunning) { outcome = 'done'; break }
            }
            await page.waitForTimeout(3000)
        }
        results.B.imbrication = outcome
        log('B — imbrication :', outcome, `(${((Date.now() - t1) / 1000).toFixed(0)} s)`)
        if (outcome !== 'done') throw new Error(`B : imbrication ${outcome}`)
        await page.locator('[data-testid="result-area"]').first().click().catch(() => {})
        await page.waitForSelector('.modal', { timeout: 30000 }).catch(() => {})
        await page.waitForTimeout(1500)
        const state = (await page.locator('[data-testid="result-state"]').allInnerTexts().catch(() => [])).join(' ')
        const badges = await page.locator('[data-testid="report-badge"]').evaluateAll(
            (els) => els.map((e) => ({ text: e.textContent.trim(), ok: e.dataset.ok !== 'false' })),
        )
        results.B.etat = state.replace(/\s+/g, ' ')
        results.B.badges = badges
        log('B — état :', results.B.etat)
        log('B — badges :', JSON.stringify(badges))
        await shot('04-B-resultat.png')
        // Ajouts de la vérification E0 : le badge et la ligne d'état comptent
        // les PIÈCES, donc un résultat complet est VERT.
        const ko = badges.filter((b) => !b.ok)
        if (ko.length) throw new Error(`B : badge rouge sur un résultat complet : ${JSON.stringify(ko)}`)
        if (/needed to be placed|à placer/i.test(state)) {
            throw new Error(`B : ligne « pièces à placer » sur un résultat complet : ${state}`)
        }
    }

    // ---------------- C. échelle ×0,5 ----------------
    if (CASES.includes('C')) {
        await newProject()
        await page.setInputFiles('input[name="dxf"]', [FILE])
        await page.waitForURL('**/project/**', { timeout: 60000 })
        await page.waitForFunction(
            () => document.querySelectorAll('.files__item input.counter__value').length >= 1,
            null, { timeout: 180000 },
        )
        const ref = (await measureStore())[0]
        await setAdvanced({ explode: false, mode: 'factor', value: 0.5 })
        await page.setInputFiles('input[name="dxf"]', [FILE])
        await page.waitForFunction(
            () => document.querySelectorAll('.files__item input.counter__value').length >= 2,
            null, { timeout: 300000 },
        )
        await page.waitForTimeout(2000)
        const scaled = (await measureStore()).find((s) => s.importScale === 0.5)
        results.C = { reference: ref, scaled }
        log('C — échelle ×0,5 :', JSON.stringify({ avant: ref?.width, apres: scaled?.width }))
        if (!scaled) throw new Error('C : aucune fiche à l’échelle 0,5')
        const expected = Math.round(ref.width * 0.5 * 100) / 100
        if (Math.abs(scaled.width - expected) > 0.05) {
            throw new Error(`C : largeur ${scaled.width} au lieu de ${expected}`)
        }
        await shot('05-C-echelle.png')
    }

    // ---------------- D. largeur cible ----------------
    if (CASES.includes('D')) {
        await newProject()
        await page.setInputFiles('input[name="dxf"]', [FILE])
        await page.waitForURL('**/project/**', { timeout: 60000 })
        await page.waitForFunction(
            () => document.querySelectorAll('.files__item input.counter__value').length >= 1,
            null, { timeout: 180000 },
        )
        const ref = (await measureStore())[0]
        const target = Number(process.env.QA_TARGET_W || 1000)
        await setAdvanced({ explode: false, mode: 'width', value: target })
        await page.setInputFiles('input[name="dxf"]', [FILE])
        await page.waitForFunction(
            () => document.querySelectorAll('.files__item input.counter__value').length >= 2,
            null, { timeout: 300000 },
        )
        await page.waitForTimeout(2000)
        const out = (await measureStore()).find((s) => s.importScale !== null)
        results.D = { reference: ref, cible: target, obtenu: out }
        log('D — largeur cible :', JSON.stringify({
            avant: ref?.width, cible: target, apres: out?.width,
            facteur: out?.importScale ? Math.round(out.importScale * 1000) / 1000 : null,
        }))
        if (!out) throw new Error('D : aucune fiche mise à l’échelle')
        if (Math.abs(out.width - target) > 0.5) {
            throw new Error(`D : largeur obtenue ${out.width} au lieu de ${target}`)
        }
        await shot('06-D-largeur-cible.png')
    }

    // ---------------- E. dépose en masse, option éteinte ----------------
    if (CASES.includes('E')) {
        // Dix copies du MÊME fichier : une dépose en masse de dix DXF dont
        // on sait qu'ils s'importent (pas de tri arbitraire dans le corpus),
        // et le plus lourd du lot — c'est le pire cas pour le temps.
        const many = []
        for (let k = 1; k <= Number(process.env.QA_N || 10); k++) {
            const dst = path.join(OUT, `masse-${k}.dxf`)
            fs.copyFileSync(FILE, dst)
            many.push(dst)
        }
        await newProject()
        const t0 = Date.now()
        await page.setInputFiles('input[name="dxf"]', many)
        await page.waitForURL('**/project/**', { timeout: 120000 })
        // Attendre la PREMIÈRE fiche, puis la stabilisation (import séquentiel).
        await page.waitForFunction(
            () => document.querySelectorAll('.files__item').length >= 1,
            null, { timeout: 300000 },
        )
        let stable = 0
        let last = -1
        while (stable < 6) {
            const n = await page.locator('.files__item').count()
            if (n === last) stable++
            else { stable = 0; last = n }
            await page.waitForTimeout(500)
        }
        const ms = Date.now() - t0
        const cards = await page.locator('.files__item').count()
        const open = await page.locator('[data-testid="advanced-import-toggle"]').getAttribute('aria-expanded')
        results.E = { fichiers: many.length, cards, ms, panneauOuvert: open }
        log('E — dépose en masse :', JSON.stringify(results.E))
        await shot('07-E-depose-en-masse.png')
        if (cards !== many.length) throw new Error(`E : ${cards} fiches pour ${many.length} fichiers`)
        if (open === 'true') throw new Error('E : le panneau est ouvert alors qu’il doit rester replié')
    }

    // ------------- F. aperçu sur une tôle (lot E1-bis) -------------
    if (CASES.includes('F')) {
        await newProject()
        // Panneau OUVERT : la dépose passe par l'aperçu, aucune fiche.
        // Il faut d'abord un projet — on dépose une première fois panneau
        // fermé pour l'obtenir, puis on règle et on re-dépose.
        await page.setInputFiles('input[name="dxf"]', [FILE])
        await page.waitForURL('**/project/**', { timeout: 60000 })
        await page.waitForFunction(
            () => document.querySelectorAll('.files__item input.counter__value').length >= 1,
            null, { timeout: 180000 },
        )
        const cardsBefore = await page.locator('.files__item').count()
        await setAdvanced({ explode: false })
        await page.setInputFiles('input[name="dxf"]', [FILE])

        // 1) L'aperçu apparaît et AUCUNE fiche n'est créée.
        await page.waitForSelector('[data-testid="import-preview-svg"]', { timeout: 300000 })
        await page.waitForTimeout(500)
        const cardsDuring = await page.locator('.files__item').count()
        const outside = await page.locator('[data-testid="import-preview-outside"]').count()
        const dims0 = (await page.locator('[data-testid="import-preview-dims"]').innerText()).trim()
        const factor0 = (await page.locator('[data-testid="import-preview-factor"]').innerText()).trim()
        log('F — aperçu :', JSON.stringify({ cardsBefore, cardsDuring, outside, dims0, factor0 }))
        await shot('08-F-apercu-sur-tole.png')
        if (cardsDuring !== cardsBefore) throw new Error('F : une fiche est apparue avant validation')
        if (!outside) throw new Error('F : le hors-tôle n’est pas signalé sur 1000 × 2000')

        // 2) Changer de format de tôle ne change pas le facteur.
        const readMm = async () => {
            const txt = (await page.locator('[data-testid="import-preview-dims"]').innerText()).trim()
            return Number(String(txt).split('×')[0].replace(',', '.').trim())
        }
        const readFactor = async () =>
            (await page.locator('[data-testid="import-preview-factor"]').innerText()).trim()
        const f0 = await readFactor()
        await page.locator('[data-testid="import-preview-preset-2"]').click()
        await page.waitForTimeout(300)
        const f1 = await readFactor()
        await page.locator('[data-testid="import-preview-preset-0"]').click()
        await page.waitForTimeout(300)
        const f2 = await readFactor()
        log('F — facteur après changements de tôle :', f0, '|', f1, '|', f2)
        if (f0 !== f1 || f1 !== f2) throw new Error(`F : la tôle change le facteur (${f0}/${f1}/${f2})`)

        // 3) Tirer la poignée jusqu'à 900 mm d'étendue (recherche linéaire :
        //    le harnais ne connaît pas la géométrie interne de l'aperçu).
        const svg = page.locator('[data-testid="import-preview-svg"]')
        const handle = page.locator('[data-testid="import-preview-handle"]')
        const box = await svg.boundingBox()
        let frac = 0.25
        let mm = null
        for (let k = 0; k < 10; k++) {
            // La poignée BOUGE à chaque tirage : relire sa position, sinon le
            // clic suivant tombe à côté (et ne tire rien).
            const hbox = await handle.boundingBox()
            await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2)
            await page.mouse.down()
            await page.mouse.move(box.x + frac * box.width, box.y + box.height * 0.5, { steps: 4 })
            await page.mouse.up()
            await page.waitForTimeout(150)
            mm = await readMm()
            if (Math.abs(mm - 900) <= 0.4) break
            frac = Math.min(0.95, Math.max(0.03, frac * (900 / mm)))
        }
        const factorTxt = await readFactor()
        log('F — poignée :', JSON.stringify({ etendueAffichee: mm, facteur: factorTxt }))
        await shot('09-F-poignee-900.png')
        if (!(Math.abs(mm - 900) <= 0.5)) throw new Error(`F : étendue affichée ${mm} au lieu de 900`)
        if (!/0[.,]3(1|2)/.test(factorTxt)) throw new Error(`F : facteur affiché « ${factorTxt} »`)

        // 4) Valider : les pièces sont importées À CETTE ÉCHELLE.
        await page.locator('[data-testid="import-preview-use-sheet"]').check()
        await page.locator('[data-testid="import-preview-confirm"] button, [data-testid="import-preview-confirm"]')
            .first().click()
        await page.waitForFunction(
            (n) => document.querySelectorAll('.files__item input.counter__value').length > n,
            cardsBefore, { timeout: 300000 },
        )
        await page.waitForTimeout(1500)
        const store = await measureStore()
        const scaled = store.filter((r) => r.importScale !== null)
        results.F = {
            cardsBefore, cardsDuring, outside, dims0, factor0,
            etendueAffichee: mm, facteur: factorTxt,
            importees: scaled.map((r) => ({ w: r.width, f: r.importScale })),
        }
        log('F — importées :', JSON.stringify(results.F.importees))
        await shot('10-F-apres-import.png')
        if (!scaled.length) throw new Error('F : aucune fiche mise à l’échelle')
        const got = scaled[scaled.length - 1]
        if (Math.abs(got.width - 900) > 0.5) {
            throw new Error(`F : étendue importée ${got.width} au lieu de 900`)
        }
        // 5) « utiliser cette tôle » a pré-rempli le format du projet.
        const dims = page.locator('.size__sheet').first().locator('.size__line .input__value')
        const sheetNow = [await dims.nth(0).inputValue(), await dims.nth(1).inputValue()]
        results.F.toleProjet = sheetNow
        log('F — tôle du projet :', sheetNow.join(' × '))
        if (Number(sheetNow[0]) !== 1000 || Number(sheetNow[1]) !== 2000) {
            throw new Error(`F : tôle du projet ${sheetNow.join('×')} au lieu de 1000×2000`)
        }
    }

    // ---------------- G. éclatement SERVEUR ----------------
    if (CASES.includes('G')) {
        await newCloudProject()
        await page.setInputFiles('input[name="dxf"]', [FILE])
        await page.waitForURL('**/project/**', { timeout: 60000 })
        const slug = page.url().split('/project/')[1].split(/[?#]/)[0]
        // La première dépose crée le projet : l'option n'était pas encore
        // réglée. On règle le panneau, puis on dépose de nouveau — c'est la
        // séquence de l'utilisateur (le panneau vit sur la page projet).
        await setAdvanced({ explode: true })
        await page.setInputFiles('input[name="dxf"]', [FILE])
        await waitServerDone(slug, 18)
        const files = await measureServer(slug)
        const exploded = files.filter((f) => /\(\d+\/\d+\)/.test(f.name))
        results.G = { slug, total: files.length, eclatees: exploded.length, fiches: files }
        log('G — éclatement serveur :', JSON.stringify({
            total: files.length, eclatees: exploded.length,
            premiers: exploded.slice(0, 3).map((f) => `${f.name} [${f.parts}p]`),
        }))
        await shot('10-G-eclatement-serveur.png')
        if (exploded.length !== 17) {
            throw new Error(`G : ${exploded.length} fiches éclatées au lieu de 17`)
        }
        // Le dessin d'origine ne doit PLUS être une fiche (il l'était le temps
        // de sa polygonisation) : 1 fiche de la première dépose + 17.
        if (files.length !== 18) {
            throw new Error(`G : ${files.length} fiches dans la liste au lieu de 18 (1 + 17)`)
        }
        // Chaque fiche éclatée porte UNE pièce, et le rang est unique.
        const ranks = exploded.map((f) => Number(f.name.match(/\((\d+)\/(\d+)\)/)[1]))
        if (new Set(ranks).size !== 17 || Math.min(...ranks) !== 1 || Math.max(...ranks) !== 17) {
            throw new Error(`G : rangs ${ranks.join(',')} au lieu de 1..17`)
        }

        // --- PARITÉ avec le navigateur, sur le MÊME fichier -------------
        // Le miroir serveur n'a de sens que s'il rend la MÊME chose : on
        // éclate le même dessin par le chemin navigateur et on compare rang
        // par rang (nombre de pièces, puis bbox de la plus grande).
        // Les deux polygoniseurs n'ordonnent pas les pièces de la même
        // façon (rien ne l'exige) : on compare les JEUX, triés par
        // encombrement, et non rang à rang.
        const byBox = (a, b) => (b.w - a.w) || (b.h - a.h)
        const local = (await localExplode())
            .map((r) => ({ w: r.width ?? 0, h: r.height ?? 0, parts: r.parts, nom: r.name }))
            .sort(byBox)
        const srv = exploded
            .map((r) => ({ w: r.maxWidth ?? 0, h: r.maxHeight ?? 0, parts: r.parts, nom: r.name }))
            .sort(byBox)
        const diff = []
        for (let k = 0; k < Math.max(local.length, srv.length); k++) {
            const l = local[k]
            const r = srv[k]
            if (!l || !r) { diff.push({ i: k + 1, manque: !l ? 'navigateur' : 'serveur' }); continue }
            // L'API serveur arrondit au dixième de mm : la tolérance couvre
            // l'arrondi, pas un écart de géométrie.
            if (l.parts !== r.parts || Math.abs(l.w - r.w) > 0.1 || Math.abs(l.h - r.h) > 0.1) {
                diff.push({
                    i: k + 1, navigateur: [l.parts, l.w, l.h],
                    serveur: [r.parts, r.w, r.h],
                })
            }
        }
        results.G.parite = { navigateur: local.length, serveur: srv.length, ecarts: diff }
        log('G — parité navigateur/serveur :', JSON.stringify({
            fiches: [local.length, srv.length], ecarts: diff.length, detail: diff,
        }))
        await shot('10b-G-parite-navigateur.png')
        if (local.length !== srv.length) {
            throw new Error(`G : ${local.length} fiches navigateur contre ${srv.length} serveur`)
        }
        if (diff.length) {
            throw new Error(`G : ${diff.length} piece(s) divergente(s) — ${JSON.stringify(diff)}`)
        }
    }

    // ---------------- H. échelle SERVEUR ----------------
    if (CASES.includes('H')) {
        // Un projet NEUF par mesure : le même dessin est déposé deux fois,
        // sans échelle puis avec, et le rapport se lit entre les deux fiches
        // du même projet. (Trois déposes dans un seul projet se sont révélées
        // instables au harnais — la troisième ne partait pas.)
        const scaleRun = async (mode, value) => {
            await newCloudProject()
            await page.setInputFiles('input[name="dxf"]', [FILE])
            await page.waitForURL('**/project/**', { timeout: 60000 })
            const slug = page.url().split('/project/')[1].split(/[?#]/)[0]
            await waitServerDone(slug, 1)
            await setAdvanced({ explode: false, mode, value })
            await page.setInputFiles('input[name="dxf"]', [FILE])
            await waitServerDone(slug, 2)
            const files = await measureServer(slug)
            return { slug, base: files[0], scaled: files[1] }
        }

        // H1 — facteur ×0,5 : l'étendue de la plus grande pièce est divisée
        // par deux, et le constat porte le facteur.
        const h1 = await scaleRun('factor', 0.5)
        // H2 — largeur cible 1000 mm sur le DESSIN COMPLET.
        const h2 = await scaleRun('width', 1000)
        results.H = { h1, h2 }
        log('H — échelle serveur :', JSON.stringify({
            facteur: {
                base: [h1.base.maxWidth, h1.base.maxHeight],
                mise: [h1.scaled.maxWidth, h1.scaled.maxHeight, h1.scaled.findings],
            },
            cible: {
                base: [h2.base.maxWidth, h2.base.maxHeight],
                mise: [h2.scaled.maxWidth, h2.scaled.maxHeight, h2.scaled.findings],
            },
        }))
        await shot('11-H-echelle-serveur.png')

        const ratio = h1.scaled.maxWidth / h1.base.maxWidth
        if (Math.abs(ratio - 0.5) > 0.005) {
            throw new Error(`H1 : rapport de largeur ${ratio.toFixed(4)} au lieu de 0,5`)
        }
        if (!h1.scaled.findings.includes('import.scaleApplied:0.5')) {
            throw new Error(`H1 : le constat ne porte pas « 0.5 » (${h1.scaled.findings})`)
        }
        // La cible porte sur le DESSIN COMPLET : le facteur est
        // 1000 / étendue, et la plus grande pièce suit ce facteur.
        const factor = 1000 / DRAWING_WIDTH_MM
        const expected = h2.base.maxWidth * factor
        if (Math.abs(h2.scaled.maxWidth - expected) > 0.2) {
            throw new Error(
                `H2 : plus grande pièce ${h2.scaled.maxWidth} au lieu de ${expected.toFixed(2)}`)
        }
        const shown = h2.scaled.findings.find((f) => f.startsWith('import.scaleApplied'))
        if (!shown) throw new Error(`H2 : constat import.scaleApplied absent (${h2.scaled.findings})`)
        const shownValue = Number(shown.split(':')[1])
        if (Math.abs(shownValue - factor) > 0.0002) {
            throw new Error(`H2 : facteur affiché ${shownValue} au lieu de ${factor.toFixed(4)}`)
        }
    }

    log('VERDICT : tous les cas demandés passent')
} catch (e) {
    failed = e
    log('ÉCHEC :', String(e).slice(0, 400))
    await shot('99-echec.png')
} finally {
    flush()
    await browser.close()
    if (failed) process.exit(1)
}
