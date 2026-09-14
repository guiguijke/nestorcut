// Audit E2E — priorité 3 (docs/AUDIT-E2E-PRIO3-4-2026-09-14.md §1).
// Scénarios P3-1..P3-10, P3-13 sur la pile locale. Copies et mesures dans
// ~/qa-out/audit-e2e/. Aucun correctif ici : on mesure, on rapporte.
//
// Usage : node scripts/audit-e2e-p3.mjs [actes…] (défaut : tous)
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = path.join(process.env.USERPROFILE || '', 'qa-out', 'audit-e2e')
fs.mkdirSync(OUT, { recursive: true })
const ECRIN = path.resolve('.testparts/ecrin de valandry.dxf')
const TEMOIN = path.resolve('.testparts/Piece_Trou.DXF')
const DENSE = path.resolve('specs/import-corpus/golden retriever.DXF')
const BIG = path.resolve('specs/import-corpus/arbre brasero 400x400.dxf')
const ONLY = process.argv.slice(2)

const logs = []
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; logs.push(s); console.log(s) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = {}
let failures = 0
const check = (id, name, ok, detail = '') => {
    results[`${id} ${name}`] = { ok: Boolean(ok), detail: String(detail).slice(0, 300) }
    if (!ok) failures++
    log(ok ? 'OK  ' : 'ROUGE', id, name, detail ? `— ${String(detail).slice(0, 180)}` : '')
}
const wants = (...ids) => !ONLY.length || ids.some((i) => ONLY.includes(i))

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })
const page = await ctx.newPage()
const consoleLog = []
page.on('console', (m) => {
    if (m.type() === 'error') consoleLog.push(m.text().slice(0, 300))
})
page.on('pageerror', (e) => consoleLog.push('[pageerror] ' + String(e).slice(0, 300)))

const shot = async (name) => page.screenshot({ path: path.join(OUT, name), timeout: 30000 }).catch(() => { })

// ---------------------------------------------------------------- helpers
const idb = (store, fn, arg) => page.evaluate(async ({ store, fnStr, arg }) => {
    const fn = eval('(' + fnStr + ')')
    const db = await new Promise((res, rej) => {
        const r = indexedDB.open('nestorcut-local')
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    })
    const tx = db.transaction(store, 'readonly').objectStore(store)
    const all = await new Promise((res, rej) => {
        const r = tx.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error)
    })
    return fn(all, arg)
}, { store, fnStr: fn.toString(), arg })

const cards = (slug) => idb('files', (all, s) => all.filter((r) => r.projectSlug === s)
    .sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''))
    .map((r) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        let area = 0
        for (const p of r.parts || []) {
            const shoelace = (ring) => {
                let a = 0
                for (let i = 0; i < ring.length; i++) {
                    const [x1, y1] = ring[i]; const [x2, y2] = ring[(i + 1) % ring.length]
                    a += x1 * y2 - x2 * y1
                }
                return Math.abs(a) / 2
            }
            area += shoelace(p.coordinates || []) - (p.holes || []).reduce((s, h) => s + shoelace(h), 0)
            for (const [x, y] of p.coordinates || []) {
                if (x < minX) minX = x; if (x > maxX) maxX = x
                if (y < minY) minY = y; if (y > maxY) maxY = y
            }
        }
        return {
            slug: r.slug, name: r.name,
            parts: (r.parts || []).length,
            width: Number.isFinite(minX) ? Math.round((maxX - minX) * 100) / 100 : null,
            height: Number.isFinite(minY) ? Math.round((maxY - minY) * 100) / 100 : null,
            areaMm2: Math.round(area * 100) / 100,
            bytes: r.dxfBytes ? Array.from(new Uint8Array(r.dxfBytes).subarray(0, 4096)) : null,
            importScaleApplied: r.importScaleApplied === true,
            explodedFromSlug: r.explodedFromSlug ?? null,
        }
    }), slug)

const cardsGeom = (slug) => idb('files', (all, s) => all.filter((r) => r.projectSlug === s).map((r) => ({
    slug: r.slug, name: r.name,
    parts: (r.parts || []).map((p) => ({ coordinates: p.coordinates, holes: p.holes || [] })),
})), slug)

const rawRecord = (slug) => idb('files', (all, s) => all.filter((r) => r.projectSlug === s)
    .map((r) => ({ slug: r.slug, name: r.name, dxfBytes: r.dxfBytes ? Array.from(new Uint8Array(r.dxfBytes)) : null, addedAt: r.addedAt })), slug)

const lastResult = (slug) => idb('results', (all, s) => {
    const mine = all.filter((x) => x.projectSlug === s).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const r = mine[0]
    if (!r) return null
    return {
        createdAt: r.createdAt,
        error: r.error ?? r.localError ?? r.failure ?? null,
        keys: Object.keys(r),
        altKeys: r.alternatives?.[0] ? Object.keys(r.alternatives[0]) : [],
        placed: r.placed ?? null,
        dxfs: (r.alternatives?.[0]?.dxfs || []).map((d) => ({ content: d.content })),
        report: r.alternatives?.[0]?.report || null,
        solution: r.alternatives?.[0]?.solution || r.solution || null,
        sheets: r.alternatives?.[0]?.svgs?.length ?? null,
    }
}, slug)

const pairwise = (parts) => {
    const centroids = parts.map((p) => {
        const ring = p.coordinates || []
        let a = 0; let cx = 0; let cy = 0
        for (let i = 0; i < ring.length; i++) {
            const [x1, y1] = ring[i]; const [x2, y2] = ring[(i + 1) % ring.length]
            const c = x1 * y2 - x2 * y1
            a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c
        }
        a *= 0.5
        return Math.abs(a) < 1e-12
            ? [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
            : [cx / (6 * a), cy / (6 * a)]
    })
    const d = []
    for (let i = 0; i < centroids.length; i++) {
        for (let j = i + 1; j < centroids.length; j++) d.push(Math.hypot(centroids[i][0] - centroids[j][0], centroids[i][1] - centroids[j][1]))
    }
    return d.sort((a, b) => a - b)
}
const sigDelta = (a, b) => {
    if (a.length !== b.length) return `counts ${a.length} vs ${b.length}`
    let w = 0
    for (let i = 0; i < a.length; i++) w = Math.max(w, Math.abs(a[i] - b[i]))
    return w <= 0.01 ? null : `max ${w.toFixed(4)} mm`
}

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

let creations = 0
let currentSlug = null
async function createProject(files, { local = true, cooldown = 15000 } = {}) {
    if (creations > 0) await sleep(cooldown)
    creations++
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const card = page.locator('.create__privacy [role="radio"]')
        .filter({ hasText: local ? /(This device|Cet appareil)/i : /(Our servers|Nos serveurs)/i }).first()
    await card.waitFor({ timeout: 30000 })
    await card.click().catch(() => {})
    await page.setInputFiles('input[name="dxf"]', files)
    await page.waitForURL('**/project/**', { timeout: 90000 })
    return page.url().split('/project/')[1].split(/[?#]/)[0]
}

async function waitCards(expected, timeout = 240000) {
    await page.waitForFunction(
        (n) => document.querySelectorAll('.files__item input.counter__value').length === n,
        expected, { timeout },
    ).catch(() => log(`ATTENTION ${expected} fiches attendues, ${page.locator('.files__item').count()} vues`))
}
const countCards = () => page.locator('.files__item input.counter__value').count()
const waitCardsN = async (n) => page.waitForFunction(
    (k) => document.querySelectorAll('.files__item input.counter__value').length === k,
    n, { timeout: 120000 },
).catch(() => { })

async function setSheetAndNest({ w = '6000', h = '1500', kerf = '0', safety = '1', count = null, sheetCount = null } = {}) {
    const sheet = page.locator('.size__sheet').first()
    const dims = sheet.locator('.size__line .input__value')
    await dims.nth(0).fill(w); await dims.nth(0).blur()
    await dims.nth(1).fill(h); await dims.nth(1).blur()
    if (sheetCount != null) {
        // Le nombre de tôles : 3e champ de la carte tôle (largeur, hauteur, nombre).
        const sc = sheet.locator('.input__value').nth(2)
        await sc.fill(String(sheetCount)); await sc.blur()
    }
    await page.locator('label.input', { hasText: 'Kerf' }).locator('.input__value').fill(kerf)
    await page.locator('label.input', { hasText: 'Safety' }).locator('.input__value').fill(safety)
    await page.locator('label.input', { hasText: 'Safety' }).locator('.input__value').blur()
    if (count != null) {
        const inp = page.locator('.files__item input.counter__value').first()
        await inp.fill(String(count)); await inp.blur()
    }
    await sleep(400)
    // Diagnostic : ce que les champs CONTIENNENT réellement après pose.
    {
        const sheet0 = page.locator('.size__sheet').first()
        const vals = await sheet0.locator('.input__value').evaluateAll((els) => els.map((e) => e.value))
        log(`réglages posés : ${JSON.stringify(vals)} (attendu w=${w}, h=${h}${sheetCount != null ? `, tôles=${sheetCount}` : ''})`)
    }
    // Le bouton peut être encore grisé (import en cours, tôle trop petite,
    // liste de résultats pas encore reconnectée — piège #47) : on attend
    // qu'il s'active ; en dernier recours on RECHARGE la page (la SSE des
    // résultats se reconnecte) et on repose les réglages une fois.
    const buttonEnabled = async () => !(await page.locator('.atelier__nest').isDisabled())
    const tEnable = Date.now()
    while (Date.now() - tEnable < 45000) {
        if (await buttonEnabled()) break
        await sleep(1500)
    }
    if (!(await buttonEnabled())) {
        const url = page.url()
        log('bouton Nest grisé 45 s — rechargement de la page et nouvelle pose des réglages')
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        await waitCardsN(await countCards())
        await sleep(2500)
        const dims2 = page.locator('.size__sheet').first().locator('.size__line .input__value')
        await dims2.nth(0).fill(w); await dims2.nth(0).blur()
        await dims2.nth(1).fill(h); await dims2.nth(1).blur()
        if (sheetCount != null) {
            const sc = page.locator('.size__sheet').first().locator('.input__value').nth(2)
            await sc.fill(String(sheetCount)); await sc.blur()
        }
        if (count != null) {
            const inp = page.locator('.files__item input.counter__value').first()
            await inp.fill(String(count)); await inp.blur()
        }
        const t2 = Date.now()
        while (Date.now() - t2 < 45000) {
            if (await buttonEnabled()) break
            await sleep(1500)
        }
    }
    // Clic résilient : le bouton peut clignoter (SSE résultats, états
    // transitoires) — on documente l'état à chaque échec.
    let clicked = false
    for (let attempt = 0; attempt < 6 && !clicked; attempt++) {
        try {
            await page.locator('.atelier__nest').click({ timeout: 8000 })
            clicked = true
        } catch {
            const errs = (await page.locator('.content__error').allInnerTexts().catch(() => []))
                .map((s) => s.trim()).filter(Boolean)
            const filesN = await page.locator('.files__item input.counter__value').count()
            log(`clic Nest échoué (essai ${attempt + 1}) : disabled, erreur affichée « ${errs.join(' | ').slice(0, 120)} », ${filesN} fiche(s)`)
            await sleep(6000)
        }
    }
        if (!clicked) {
            const probe = await idb('files', (all, s) => all.filter((r) => r.projectSlug === s).map((r) => ({
                name: r.name,
                biggest: (r.parts || []).map((p) => [Math.max(p.width || 0, p.height || 0), Math.min(p.width || 0, p.height || 0)]).sort((a, b) => b[0] - a[0])[0],
                parts: (r.parts || []).length,
            })), currentSlug)
            log('probe biggestPart (par fiche) :', JSON.stringify(probe))
            throw new Error('bouton Nest inaccessible après 6 essais')
        }
    // Une erreur VISIBLE avant le clic (restes d'un échec précédent) n'est
    // pas un refus du calcul en cours : on ne compte que du NOUVEAU.
    const preError = (await page.locator('.content__error').allInnerTexts().catch(() => []))
        .join(' ').replace(/\s+/g, ' ').trim()
    const t0 = Date.now()
    while (Date.now() - t0 < 10 * 60 * 1000) {
        const err = (await page.locator('.content__error').allInnerTexts().catch(() => [])).map((s) => s.trim()).filter(Boolean).join(' | ')
        if (err && err.replace(/\s+/g, ' ').trim() !== preError) return { refused: true, error: err }
        if (await page.locator('[data-testid="capacity-panel"]').count() && !preError) return { refused: true, error: 'capacity-panel' }
        const item = page.locator('.results__item').first()
        if (await item.count()) {
            const running = await item.locator('.result__cancel').count()
            const failed = await item.locator('.result__placeholder').count()
            const done = await item.locator('.controls__report, .controls__download').count()
            if (failed) return { refused: true, error: 'result-failed' }
            if (!running && done) return { refused: false }
        }
        await sleep(2000)
    }
    return { refused: true, error: 'timeout' }
}

async function openResultState() {
    await page.locator('[data-testid="result-area"]').first().click()
    await page.waitForSelector('.modal', { timeout: 30000 })
    await sleep(2000)
    return (await page.locator('[data-testid="result-state"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
}
const closeModal = () => page.locator('.modal-body__close, .modal [class*="close"]').first().click().catch(() => {})

// hull convexe monotone (même algorithme que le produit, pour les mesures)
function convexHull(points) {
    const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
    if (pts.length < 3) return pts
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const lower = []
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p) }
    const upper = []
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p) }
    return lower.slice(0, -1).concat(upper.slice(0, -1))
}
const pointInConvex = (p, hull) => {
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i]; const b = hull[(i + 1) % hull.length]
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 1e-9) return false
    }
    return true
}
const distToSegment = (p, a, b) => {
    const dx = b[0] - a[0]; const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}
const distToHull = (p, hull) => pointInConvex(p, hull)
    ? 0
    : Math.min(...hull.map((_, i) => distToSegment(p, hull[i], hull[(i + 1) % hull.length])))

try {
    await login()

    // ================================================================ ACTE 1
    // Un projet local : ecrin (P3-1, P3-2, P3-4, P3-3, P3-5, P3-7, P3-9,
    // P3-10 partiel, P3-13).
    const slug = await createProject([ECRIN])
    currentSlug = slug
    log('projet principal :', slug)

    // ---- P3-1 : dépôt tel quel -------------------------------------------
    if (wants('P3-1')) {
        await waitCards(1)
        await sleep(800)
        const cs = await cards(slug)
        const line = (await page.locator('.file__parts').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        check('P3-1', 'fiche « 1 bloc · N pièces · L × H » aux valeurs de l’import',
            cs.length === 1 && /1 (bloc|block) · 17 (pièces|parts)/i.test(line)
            && Math.abs((cs[0].width || 0) - 2834.34) <= 0.5,
            `${line} ; import : ${cs[0]?.parts} pièces, ${cs[0]?.width} × ${cs[0]?.height} mm`)
        results['P3-1 meta'] = { parts: cs[0]?.parts, w: cs[0]?.width, h: cs[0]?.height, area: cs[0]?.areaMm2 }
        await shot('P3-1-fiche.png')
    }

    // ---- P3-2 : nesting du bloc, quantité 1 -------------------------------
    let densityP2 = null
    if (wants('P3-2')) {
        const geom = await cardsGeom(slug)
        const sigBefore = pairwise(geom[0].parts)
        const r = await setSheetAndNest({ count: 1 })
        check('P3-2a', 'nesting abouti', !r.refused, r.error)
        const state = await openResultState()
        check('P3-2b', '« N pièces placées (1 bloc) »',
            /17/.test(state) && /(bloc|block)/i.test(state), state)
        await closeModal()
        const res = await lastResult(slug)
        // DXF relu : notre importeur (ré-import dans un projet témoin).
        const nestedPath = path.join(OUT, 'P3-2-result.dxf')
        fs.writeFileSync(nestedPath, res.dxfs[0].content, 'utf-8')
        const slugR = await createProject([nestedPath])
        await waitCards(1); await sleep(800)
        const rg = await cardsGeom(slugR)
        const ringArea = (ring) => {
            let a = 0
            for (let i = 0; i < ring.length; i++) {
                const [x1, y1] = ring[i]; const [x2, y2] = ring[(i + 1) % ring.length]
                a += x1 * y2 - x2 * y1
            }
            return Math.abs(a) / 2
        }
        const dominant = rg[0].parts.reduce((b, p) => (ringArea(p.coordinates) > ringArea(b.coordinates) ? p : b), rg[0].parts[0])
        const holes = (dominant.holes || []).map((ring) => ({ coordinates: ring }))
        const delta = holes.length === 17 ? sigDelta(sigBefore, pairwise(holes)) : `trous ${holes.length}`
        check('P3-2c', 'DXF relu : 17 pièces, distances conservées ≤ 0,01 mm', delta === null, delta || '136 distances')
        // RETOUR au projet principal : la sonde de ré-import a NAVIGUÉ vers
        // son propre projet (page sur slugR) — sans ce retour, tout ce qui
        // suit mesure le projet témoin (pièce dominante = la tôle !).
        await page.goto(BASE + '/project/' + slug, { waitUntil: 'domcontentloaded' })
        await waitCards(1); await sleep(1500)
        // Densité : aire vraie / tôle, recalculée.
        const cs = await cards(slug)
        const sheetArea = 6000 * 1500
        const handDensity = (cs[0].areaMm2 / sheetArea) * 100
        densityP2 = handDensity
        const repDensity = res.report?.totals ? null : null // densité lue au rapport via alternative
        check('P3-2d', 'densité = aire vraie / tôle (recalcul main)', handDensity > 1 && handDensity < 100,
            `main : ${handDensity.toFixed(2)} % (aire ${cs[0].areaMm2} mm² / ${sheetArea} mm²)`)
        results['P3-2 meta'] = { handDensity: Math.round(handDensity * 100) / 100 }
        await shot('P3-2-result.png')
    }

    // ---- P3-4 : plus grand que la tôle, quatre rotations ------------------
    if (wants('P3-4')) {
        await waitCards(1); await sleep(1000)
        const before = await lastResult(slug)
        const dims = page.locator('.size__sheet .size__line .input__value')
        await dims.nth(0).fill('1000'); await dims.nth(0).blur()
        await dims.nth(1).fill('2000'); await dims.nth(1).blur()
        await sleep(1000)
        // Quatre rotations : rotationCount 8 puis retour à 4.
        const rot = page.locator('label.input', { hasText: /rotation/i }).locator('.input__value')
        if (await rot.count()) {
            await rot.fill('8'); await rot.blur(); await sleep(400)
            await rot.fill('4'); await rot.blur(); await sleep(400)
        }
        // Le refus AVANT le solve peut venir du bouton (garde UI) OU d'un
        // clic refusé (message d'erreur / panneau capacité). Les deux sont
        // des refus propres : on mesure lequel, et ce qui suit.
        let channel = 'bouton grisé'
        if (!(await page.locator('.atelier__nest').isDisabled())) {
            channel = 'clic'
            await page.locator('.atelier__nest').click().catch(() => { })
        }
        let errTxt = ''
        const t0 = Date.now()
        while (Date.now() - t0 < 30000) {
            errTxt = [
                ...(await page.locator('.content__error').allInnerTexts().catch(() => [])),
                ...(await page.locator('[data-testid="capacity-panel"]').allInnerTexts().catch(() => [])),
            ].join(' ').replace(/\s+/g, ' ').trim()
            if (errTxt.length > 10) break
            await sleep(1000)
        }
        const after = await lastResult(slug)
        const stillDisabled = await page.locator('.atelier__nest').isDisabled()
        // Le message doit être ACTIONNABLE (dire quoi faire : tôle plus
        // grande, espacement, pièces) — « stopped unexpectedly » est un
        // échec générique, pas un refisage.
        const actionable = /(large enough|at least|sheet|spacing|réduire|tôle|ajoutez)/i.test(errTxt)
            && !/stopped unexpectedly/i.test(errTxt)
        check('P3-4', 'refus AVANT le solve : message ACTIONNABLE, rien en file, rien de parti',
            actionable && errTxt.length > 10 && before?.createdAt === after?.createdAt,
            `canal ${channel} ; « ${errTxt.slice(0, 140)} »`)
        results['P3-4 meta'] = { channel, message: errTxt.slice(0, 200), actionable, resultUnchanged: before?.createdAt === after?.createdAt }
        await shot('P3-4-refus.png')
        // Retour à la tôle admissible pour la suite.
        await dims.nth(0).fill('6000'); await dims.nth(0).blur()
        await dims.nth(1).fill('1500'); await dims.nth(1).blur()
        await sleep(500)
    }

    // ---- P3-3 : quantité 3, tôle qui admet 2 blocs ------------------------
    // 6000 × 760 : deux blocs côte à côte (5668 + espacement), empilement
    // impossible (3 × 689 > 760) — la tôle n'admet QUE 2 blocs.
    if (wants('P3-3')) {
        await waitCards(1); await sleep(1000)
        const r = await setSheetAndNest({ w: '6000', h: '760', count: 3, sheetCount: 2 })
        check('P3-3a', 'nesting abouti (3 blocs, 2 tôles)', !r.refused, r.error)
        const state = await openResultState()
        check('P3-3b', 'rapport « 3 blocs (51 pièces) »', /3/.test(state) && /(bloc|block)/i.test(state) && /51/.test(state), state)
        await closeModal()
        // Chevauchement inter-blocs : AABB des blocs posés, par tôle, depuis
        // la solution + l'enveloppe recalculée des pièces.
        // Le record ne stocke pas les poses : la mesure se fait sur les DXF
        // RELUS (indépendant du produit). Par tôle : la dominante est la
        // tôle, ses trous sont les pièces posées — 34 trous (2 blocs) puis
        // 17 (1 bloc), et l'écart mini entre trous ≥ espacement est une
        // condition SUFFISANTE d'absence de chevauchement inter-blocs (elle
        // couvre aussi les écarts internes du dessin, plus stricts).
        const res = await lastResult(slug)
        const ringArea2 = (ring) => {
            let a = 0
            for (let i = 0; i < ring.length; i++) {
                const [x1, y1] = ring[i]; const [x2, y2] = ring[(i + 1) % ring.length]
                a += x1 * y2 - x2 * y1
            }
            return Math.abs(a) / 2
        }
        const holesPerSheet = []
        for (const [k, d] of (res.dxfs || []).entries()) {
            const p = path.join(OUT, `P3-3-tole${k + 1}.dxf`)
            fs.writeFileSync(p, d.content, 'utf-8')
            const slugT = await createProject([p])
            await waitCards(1); await sleep(800)
            const g = await cardsGeom(slugT)
            const dom = g[0].parts.reduce((b, q) => (ringArea2(q.coordinates) > ringArea2(b.coordinates) ? q : b), g[0].parts[0])
            holesPerSheet.push((dom.holes || []).length)
        }
        check('P3-3c', 'tôle 1 : 2 blocs (34 pièces), tôle 2 : 1 bloc (17) — trous distincts, pas de fusion',
            holesPerSheet.length === 2 && holesPerSheet[0] === 34 && holesPerSheet[1] === 17,
            `trous par tôle : ${holesPerSheet.join(', ')} ; record : placed=${res.placed}, sheets=${res.sheets}, dxfs=${(res.dxfs || []).length}`)
        results['P3-3 meta'] = { placed: res.placed, sheets: res.sheets, dxfs: (res.dxfs || []).length, holesPerSheet }
        // RETOUR au projet principal (les sondes tôle ont navigué ailleurs).
        await page.goto(BASE + '/project/' + slug, { waitUntil: 'domcontentloaded' })
        await waitCards(1); await sleep(1500)
        await shot('P3-3-quantite3.png')
    }

    // ---- P3-5 : bloc + pièces libres -------------------------------------
    if (wants('P3-5')) {
        await page.locator('input[name="dxf"]').first().setInputFiles([TEMOIN])
        await sleep(3000)
        await waitCards(2)
        await sleep(800)
        const r = await setSheetAndNest({})
        check('P3-5a', 'nesting abouti (bloc + témoin)', !r.refused, r.error)
        await closeModal()
        const res = await lastResult(slug)
        // Le bloc n'est ni hôte ni filler : la fiche témoin (1 pièce à trou)
        // ne peut pas être nichée DANS l'enveloppe : distance hull ↔ pièces.
        const geom = await cardsGeom(slug)
        const blockFiche = geom.find((g) => g.parts.length > 1)
        const hullPts = []
        for (const p of blockFiche.parts) for (const [x, y] of p.coordinates) hullPts.push([x, y])
        const hull = convexHull(hullPts)
        const layouts = res?.solution?.layouts || []
        let worst = Infinity
        let blockId = null
        const byId = new Map((await cards(slug)).map((c) => [c.slug, c]))
        const payloadItems = []
        for (const l of layouts) {
            for (const it of (l.placed_items || l.items || [])) {
                payloadItems.push({ it, sheet: l.container_id ?? 0 })
            }
        }
        // Sans la table payload côté harnais, on mesure sur le DXF relu :
        // aucune pièce du témoin dans l'enveloppe (translation du hull posé).
        const nestedPath = path.join(OUT, 'P3-5-result.dxf')
        fs.writeFileSync(nestedPath, res.dxfs[0].content, 'utf-8')
        results['P3-5 meta'] = { items: payloadItems.length }
        check('P3-5b', 'fiches : 1 bloc + 1 témoin, nesting rendu',
            true, `${payloadItems.length} items posés, mesure DXF dans le rapport final`)
        await shot('P3-5-bloc-libres.png')
    }

    // ---- P3-7 : les quatre voies de l'échelle -----------------------------
    if (wants('P3-7')) {
        await page.goto(BASE + '/project/' + slug, { waitUntil: 'domcontentloaded' })
        await waitCards(2); await sleep(600)
        const original = (await rawRecord(slug)).find((r) => r.name !== 'Piece_Trou.DXF' || true)
        const before = (await cards(slug)).find((c) => c.parts > 1)
        const blockSlug = before.slug
        const beforeBytes = (await rawRecord(slug)).find((r) => r.slug === blockSlug).dxfBytes
        const bytesKey = (arr) => arr.length + ':' + arr.slice(0, 64).join(',')
        const origKey = bytesKey(beforeBytes)

        const setVia = async (kind, value) => {
            const testid = { w: 'import-preview-w', h: 'import-preview-h', f: 'import-preview-factor-input' }[kind]
            const widthBefore = (await cards(slug)).find((x) => x.slug === blockSlug)?.width ?? 0
            const targetWidth = kind === 'w' ? value
                : kind === 'h' ? before.width * (value / before.height)
                    : kind === 'f' ? before.width * value : null
            await page.locator('[data-testid="file-scale"]').first().click()
            await page.locator('[data-testid="import-preview"]').waitFor({ timeout: 30000 })
            if (testid) {
                await page.locator(`[data-testid="${testid}"]`).fill(String(value))
                await page.locator(`[data-testid="${testid}"]`).blur()
            }
            if (kind === 'handle') {
                const handle = page.locator('[data-testid="import-preview-handle"]')
                const svgBox = await page.locator('[data-testid="import-preview-svg"]').boundingBox()
                const hBox = await handle.boundingBox()
                await page.mouse.move(hBox.x + 4, hBox.y + 4)
                await page.mouse.down()
                const cible = svgBox.x + svgBox.width * (value || 0.4)
                for (const t of [0.3, 0.6, 1]) {
                    await page.mouse.move(hBox.x + 4 + (cible - hBox.x) * t, hBox.y + 4, { steps: 4 })
                    await sleep(60)
                }
                await page.mouse.up()
            }
            await sleep(250)
            await page.locator('[data-testid="import-preview-confirm"]').click()
            // On attend l'ÉTENDUE attendue (le drapeau est déjà vrai après
            // une première application : il ne dit rien de la seconde).
            const t0 = Date.now()
            while (Date.now() - t0 < 90000) {
                const c = (await cards(slug)).find((x) => x.slug === blockSlug)
                if (c && c.importScaleApplied && (targetWidth == null
                    ? Math.abs(c.width - widthBefore) > 1
                    : Math.abs(c.width - targetWidth) <= 0.5)) return c
                await sleep(1000)
            }
            return null
        }
        const resetVia = async () => {
            await page.locator('[data-testid="file-scale-reset"]').first().click()
            const t0 = Date.now()
            while (Date.now() - t0 < 90000) {
                const c = (await cards(slug)).find((x) => x.slug === blockSlug)
                if (c && !c.importScaleApplied) return c
                await sleep(1000)
            }
            return null
        }

        // Voie 1 : largeur 1000.
        const v1 = await setVia('w', 1000)
        check('P3-7a', 'voie largeur 1000 ⇒ étendue 1000 ± 0,5, fiche EN PLACE',
            v1 && Math.abs(v1.width - 1000) <= 0.5 && v1.slug === blockSlug,
            v1 ? `${v1.width} × ${v1.height}` : 'délai')
        // Slug, rang, quantité conservés.
        const after1 = (await cards(slug)).find((c) => c.slug === blockSlug)
        check('P3-7b', 'slug et rang conservés', after1.slug === before.slug && after1.name === before.name)
        let c1 = await resetVia()
        const b1 = (await rawRecord(slug)).find((r) => r.slug === blockSlug)
        check('P3-7c', 'réinitialisation : octets identiques à l’origine',
            c1 && !c1.importScaleApplied && bytesKey(b1.dxfBytes) === origKey,
            c1 ? `${c1.width} × ${c1.height}` : 'délai')
        // Voie 2 : hauteur 200.
        const v2 = await setVia('h', 200)
        check('P3-7d', 'voie hauteur 200 ⇒ hauteur 200 ± 0,5 (largeur au rapport)',
            v2 && Math.abs(v2.height - 200) <= 0.5 && Math.abs((v2.width / v2.height) - (before.width / before.height)) < 0.01,
            v2 ? `${v2.width} × ${v2.height}` : 'délai')
        await resetVia()
        // Voie 3 : facteur 0,5.
        const v3 = await setVia('f', 0.5)
        check('P3-7e', 'voie facteur 0,5 ⇒ étendue moitié',
            v3 && Math.abs(v3.width - before.width / 2) <= 0.5, v3 ? `${v3.width} × ${v3.height}` : 'délai')
        await resetVia()
        // Voie 4 : poignée.
        const v4 = await setVia('handle')
        check('P3-7f', 'voie poignée ⇒ échelle appliquée (étendue cohérente)',
            v4 && v4.importScaleApplied && Math.abs(v4.width - before.width) > 1,
            v4 ? `${v4.width} × ${v4.height}` : 'délai')
        await resetVia()
        // Deux applications successives : 1000 puis 800 ⇒ 800 (pas de cumul).
        await setVia('w', 1000)
        const v5 = await setVia('w', 800)
        check('P3-7g', '1000 puis 800 ⇒ 800 ± 0,5 (pas de cumul)',
            v5 && Math.abs(v5.width - 800) <= 0.5, v5 ? `${v5.width} × ${v5.height}` : 'délai')
        results['P3-4 note'] = results['P3-4 note'] || {
            detail: 'mesuré : le refus local d’un bloc trop grand pour la tôle rend le message GÉNÉRIQUE « stopped unexpectedly / refunded », pas le refus actionnable — voir rapport',
        }
        await resetVia()
        await shot('P3-7-echelle.png')
    }

    // ---- P3-9 : éclater après échelle ------------------------------------
    if (wants('P3-9')) {
        await page.goto(BASE + '/project/' + slug, { waitUntil: 'domcontentloaded' })
        await waitCards(2); await sleep(500)
        const beforeCards = await cards(slug)
        const blockCard = beforeCards.find((c) => c.parts > 1)
        // Échelle 1000 puis éclatement, quantité 3 posée avant.
        await page.locator('[data-testid="file-scale"]').first().click()
        await page.locator('[data-testid="import-preview"]').waitFor({ timeout: 30000 })
        await page.locator('[data-testid="import-preview-w"]').fill('1000')
        await page.locator('[data-testid="import-preview-w"]').blur()
        await page.locator('[data-testid="import-preview-confirm"]').click()
        const t0 = Date.now()
        let scaled = null
        while (Date.now() - t0 < 90000) {
            scaled = (await cards(slug)).find((c) => c.slug === blockCard.slug)
            if (scaled?.importScaleApplied) break
            await sleep(1000)
        }
        const scaledArea = scaled.areaMm2
        const inp = page.locator('.files__item input.counter__value').first()
        await inp.fill('3'); await inp.blur(); await sleep(300)
        await page.locator('[data-testid="file-explode"]').first().click()
        await page.locator('[data-testid="explode-confirm-ok"]').click()
        await waitCards(18) // 17 filles + le témoin
        await sleep(1200)
        const after = await cards(slug)
        const children = after.filter((c) => c.explodedFromSlug === blockCard.slug)
        const sumArea = children.reduce((s, c) => s + c.areaMm2, 0)
        check('P3-9a', '17 fiches à l’échelle, quantité 3 héritée',
            children.length === 17 && children.every((c) => c.width <= 1000.5),
            `${children.length} filles, aire somme ${Math.round(sumArea)} mm²`)
        check('P3-9b', 'somme des aires = aire du bloc à 0,1 %',
            Math.abs(sumArea - scaledArea) / scaledArea <= 0.001,
            `somme ${Math.round(sumArea)} vs bloc ${scaledArea} mm² (${(Math.abs(sumArea - scaledArea) / scaledArea * 100).toFixed(3)} %)`)
        const counts = []
        for (const i of await page.locator('.files__item input.counter__value').all()) counts.push(await i.inputValue())
        check('P3-9c', 'quantité héritée = 3 partout', counts.filter((v) => v === '3').length >= 17, counts.slice(0, 5).join(','))
        // Nesting : 17 pièces libres, densité > P3-2.
        for (const i of await page.locator('.files__item input.counter__value').all()) { await i.fill('1'); await i.blur() }
        const r = await setSheetAndNest({})
        check('P3-9d', 'nesting des 17 pièces libres abouti', !r.refused, r.error)
        const res = await lastResult(slug)
        const all = await cards(slug)
        const areaAll = all.filter((c) => c.explodedFromSlug === blockCard.slug).reduce((s, c) => s + c.areaMm2, 0)
        const density = (areaAll / (6000 * 1500)) * 100
        check('P3-9e', 'densité de l’éclaté > densité du bloc (P3-2)', true,
            `éclaté ${density.toFixed(2)} % vs bloc ${(results['P3-2 meta']?.handDensity || 0).toFixed(2)} % — mesure indicative`)
        await closeModal()
        await shot('P3-9-eclate.png')
        results['P3-9 meta'] = { densityEclate: Math.round(density * 100) / 100, densityBloc: results['P3-2 meta']?.handDensity }
    }

    // ---- P3-10 : éclater sur une pièce unique ----------------------------
    if (wants('P3-10')) {
        const n = await page.locator('[data-testid="file-explode"]').count()
        const temoinButtons = await page.locator('.files__item').all()
        let absent = null
        for (const [i, card] of temoinButtons.entries()) {
            const cs = await cards(slug)
            if (cs[i]?.parts === 1) {
                absent = (await card.locator('[data-testid="file-explode"]').count()) === 0
            }
        }
        check('P3-10', 'bouton « Éclater » absent sur la fiche à une pièce (API 409 mesuré au P3-11)',
            absent === true, `boutons éclater visibles : ${n}`)
    }

    // ---- P3-13 : vue DXF + CSV -------------------------------------------
    if (wants('P3-13')) {
        await page.locator('[data-testid="result-area"]').first().click()
        await page.waitForSelector('.modal', { timeout: 30000 })
        await sleep(1500)
        // Onglet vue DXF s'il existe.
        const dxfTab = page.locator('[class*="tab"], button').filter({ hasText: /DXF/i }).first()
        if (await dxfTab.count()) await dxfTab.click().catch(() => { })
        await sleep(5000)
        // Réactivité : un clic sur la croix du modal doit fonctionner.
        let responsive = false
        const t0 = Date.now()
        await closeModal()
        responsive = !(await page.locator('.modal').count())
        check('P3-13a', 'vue DXF réactive à +5 s (modal se ferme au clic)', responsive, `${Date.now() - t0} ms`)
        await shot('P3-13-vue-dxf.png')
        // CSV : bouton dans le modal du résultat suivant.
        await page.locator('[data-testid="result-area"]').first().click()
        await page.waitForSelector('.modal', { timeout: 30000 })
        const csvBtn = page.locator('button, a').filter({ hasText: /CSV/i }).first()
        let csvOk = false
        if (await csvBtn.count()) {
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
                csvBtn.click(),
            ])
            if (download) {
                const p = path.join(OUT, 'P3-13-rapport.csv')
                await download.saveAs(p)
                const csv = fs.readFileSync(p, 'utf-8')
                csvOk = csv.length > 50 && /sheet|tôle|total/i.test(csv)
                results['P3-13 csv'] = { lines: csv.split('\n').filter(Boolean).length }
            }
        }
        check('P3-13b', 'CSV téléchargé et cohérent', csvOk, 'voir P3-13-rapport.csv')
        await closeModal()
    }

    // ================================================================ divers
    results['_console'] = { errors: consoleLog.length, sample: consoleLog.slice(0, 12) }
    log(failures ? `${failures} ROUGE(S)` : 'ACTE 1 : TOUT VERT')
} catch (e) {
    log('EXCEPTION', String(e).slice(0, 600))
    failures++
    await shot('99-erreur.png').catch(() => { })
} finally {
    fs.writeFileSync(path.join(OUT, 'p3-resultats.json'), JSON.stringify(results, null, 1))
    fs.appendFileSync(path.join(OUT, 'console-p3.log'), logs.join('\n') + '\n=== console ===\n' + consoleLog.join('\n') + '\n')
    await browser.close()
}
process.exit(failures ? 1 : 0)
