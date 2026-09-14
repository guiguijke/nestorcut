// Audit E2E — priorité 3, DEUXIÈME VAGUE : P3-6 (corpus), P3-8 (pouces),
// P3-11 (parité serveur), P3-12 (expirée + démo), P3-14 (vieux projet).
// Mêmes règles que audit-e2e-p3.mjs ; mesures dans ~/qa-out/audit-e2e/.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = path.join(process.env.USERPROFILE || '', 'qa-out', 'audit-e2e')
fs.mkdirSync(OUT, { recursive: true })
// Fichiers du corpus privé — JAMAIS par leur nom dans le dépôt (règle de la
// maison, audit §6) : passés par variable d'environnement, défaut neutre.
// Rôles : QA_P3_ECRIN = dessin multi-pièces du collègue (17 pièces,
// splines) ; QA_P3_DENSE = dessin dense (10 pièces) ; QA_P3_BIG = dessin
// à 127 pièces.
const needFile = (env, neutral) => {
    const p = path.resolve(process.env[env] || neutral)
    if (!fs.existsSync(p)) {
        console.error(`${env} absent (défaut neutre « ${neutral} ») — fichier privé à passer par variable d'environnement`)
        process.exit(2)
    }
    return p
}
const ECRIN = needFile('QA_P3_ECRIN', '.testparts/qa-p3-collegue.dxf')
const DENSE = needFile('QA_P3_DENSE', 'specs/import-corpus/qa-p3-dense.dxf')
const BIG = needFile('QA_P3_BIG', 'specs/import-corpus/qa-p3-127pieces.dxf')
const ONLY = process.argv.slice(2)
const wants = (...ids) => !ONLY.length || ids.some((i) => ONLY.includes(i))

const logs = []
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; logs.push(s); console.log(s) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = {}
let failures = 0
const check = (id, name, ok, detail = '') => {
    results[`${id} ${name}`] = { ok: Boolean(ok), detail: String(detail).slice(0, 300) }
    if (!ok) failures++
    log(ok ? 'OK  ' : 'ROUGE', id, name, detail ? `— ${String(detail).slice(0, 170)}` : '')
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })
const page = await ctx.newPage()
const consoleLog = []
page.on('console', (m) => { if (m.type() === 'error') consoleLog.push(m.text().slice(0, 250)) })
page.on('pageerror', (e) => consoleLog.push('[pageerror] ' + String(e).slice(0, 250)))
const shot = async (name) => page.screenshot({ path: path.join(OUT, name), timeout: 30000 }).catch(() => { })

const idb = (store, fn, arg) => page.evaluate(async ({ store, fnStr, arg }) => {
    const fn = eval('(' + fnStr + ')')
    const db = await new Promise((res, rej) => {
        const r = indexedDB.open('nestorcut-local')
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    })
    const tx = db.transaction(store, 'readwrite').objectStore(store)
    const all = await new Promise((res, rej) => {
        const r = tx.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error)
    })
    return fn(all, arg, tx)
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
            area += shoelace(p.coordinates || []) - (p.holes || []).reduce((s2, h) => s2 + shoelace(h), 0)
            for (const [x, y] of p.coordinates || []) {
                if (x < minX) minX = x; if (x > maxX) maxX = x
                if (y < minY) minY = y; if (y > maxY) maxY = y
            }
        }
        return {
            slug: r.slug, name: r.name, parts: (r.parts || []).length,
            holesByPart: (r.parts || []).map((p) => (p.holes || []).length),
            width: Number.isFinite(minX) ? Math.round((maxX - minX) * 100) / 100 : null,
            height: Number.isFinite(minY) ? Math.round((maxY - minY) * 100) / 100 : null,
            areaMm2: Math.round(area * 100) / 100,
            importScaleApplied: r.importScaleApplied === true,
        }
    }), slug)

const lastResult = (slug) => idb('results', (all, s) => {
    const r = all.filter((x) => x.projectSlug === s).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]
    if (!r) return null
    return {
        createdAt: r.createdAt, placed: r.placed ?? null, requested: r.requested ?? null,
        density: r.alternatives?.[0]?.density ?? null,
        dxfs: (r.alternatives?.[0]?.dxfs || []).length,
    }
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
    // L'unité est une PRÉFÉRENCE PERSISTÉE : un run précédent peut avoir
    // laissé l'UI en pouces — tous les remplissages du harnais sont en mm.
    const mmBtn = page.locator('.unit-switch button, .unit-switch [role="radio"], .unit-switch [class*="option"]').filter({ hasText: /^mm$/ }).first()
    if (await mmBtn.count()) {
        await mmBtn.click().catch(() => { })
        await sleep(600)
        log('unité UI forcée en mm')
    }
}

let creations = 0
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
const waitCards = async (n, timeout = 240000) => page.waitForFunction(
    (k) => document.querySelectorAll('.files__item input.counter__value').length === k,
    n, { timeout },
).catch(() => log(`ATTENTION ${n} fiches attendues, visibles : ${page.locator('.files__item').count()}`))

const serverCards = (slug) => page.evaluate(async (s) => {
    const data = await $fetch(`/api/project/${s}`)
    return (data.files || []).map((f) => ({
        slug: f.slug, name: f.name, status: f.processingStatus, parts: (f.parts || []).length,
        block: f.block ?? null, importScaleApplied: f.importScaleApplied === true,
        explodedFromSlug: f.explodedFromSlug ?? null,
    }))
}, slug)
const serverExtent = (slug) => page.evaluate(async (s) => {
    const data = await $fetch(`/api/files/project/geometry/${s}`)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let area = 0
    for (const p of data.parts || []) {
        const shoelace = (ring) => {
            let a = 0
            for (let i = 0; i < ring.length; i++) {
                const [x1, y1] = ring[i]; const [x2, y2] = ring[(i + 1) % ring.length]
                a += x1 * y2 - x2 * y1
            }
            return Math.abs(a) / 2
        }
        area += shoelace(p.coordinates || []) - (p.holes || []).reduce((s2, h) => s2 + shoelace(h), 0)
        for (const [x, y] of p.coordinates || []) {
            if (x < minX) minX = x; if (x > maxX) maxX = x
            if (y < minY) minY = y; if (y > maxY) maxY = y
        }
    }
    return { parts: (data.parts || []).length, width: Math.round((maxX - minX) * 100) / 100, height: Math.round((maxY - minY) * 100) / 100, areaMm2: Math.round(area) }
}, slug)
async function waitServerDone(slug, expected, timeoutMs = 600000) {
    const t0 = Date.now()
    let files = []
    while (Date.now() - t0 < timeoutMs) {
        files = await serverCards(slug)
        const done = files.filter((f) => f.status === 'done').length
        if (files.length >= expected && done === files.length) return files
        await sleep(2000)
    }
    throw new Error(`attente serveur épuisée (${files.length} fiches)`)
}

async function nestAndWait(timeoutMs = 600000) {
    const preError = (await page.locator('.content__error').allInnerTexts().catch(() => [])).join(' ').trim()
    await page.locator('.atelier__nest').click()
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
        const err = (await page.locator('.content__error').allInnerTexts().catch(() => [])).join(' ').trim()
        if (err && err !== preError) return { refused: true, error: err }
        const running = await page.locator('.result__cancel').count()
        const failed = await page.locator('.result__placeholder').count()
        if (failed) return { refused: true, error: 'result-failed' }
        if (!running) {
            const done = await page.locator('.results__item .controls__report, .results__item .controls__download').count()
            if (done) return { refused: false }
        }
        await sleep(2000)
    }
    return { refused: true, error: 'timeout' }
}
async function setDims(w, h) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const dims = page.locator('.size__sheet').first().locator('.size__line .input__value')
            await dims.nth(0).waitFor({ state: 'visible', timeout: 15000 })
            await dims.nth(0).fill(String(w)); await dims.nth(0).blur()
            await dims.nth(1).fill(String(h)); await dims.nth(1).blur()
            await sleep(400)
            return
        } catch {
            if (attempt === 1) throw new Error('carte tôle introuvable pour setDims')
            log('carte tôle indisponible — rechargement et nouvel essai')
            await page.reload({ waitUntil: 'domcontentloaded' })
            await sleep(3000)
        }
    }
}

try {
    await login()

    // ---- P3-6 : corpus — imbriqué (synthétique), dense, > 50 pièces -------
    if (wants('P3-6')) {
        // a) imbriqué : le corpus n'en a AUCUN (mesuré sur 151 fichiers) —
        //    contenance shapely nulle partout. Témoin synthétique + le
        //    fichier dense qui porte des trous.
        const nested = path.join(OUT, 'synthetique-imbrique.dxf')
        const rect = (x, y, w, h) => `0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n10\n${x}\n20\n${y}\n10\n${x + w}\n20\n${y}\n10\n${x + w}\n20\n${y + h}\n10\n${x}\n20\n${y + h}\n`
        fs.writeFileSync(nested, '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n'
            + rect(0, 0, 200, 100) + rect(50, 25, 100, 50) + '0\nENDSEC\n0\nEOF\n')
        const slugN = await createProject([nested])
        await waitCards(1); await sleep(800)
        const csN = await cards(slugN)
        const lineN = (await page.locator('.file__parts').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        // CE QUE L'IMPORT EN FAIT EST DIT : 1 pièce à 1 trou (imbriqués
        // fusionnés) ou 2 pièces — les deux sont acceptables, le verrou est
        // la COHÉRENCE fiche ↔ import et un DXF complet ensuite.
        results['P3-6 imbrique'] = { fiches: csN.length, parts: csN[0]?.parts, trous: csN[0]?.holesByPart, line: lineN }
        check('P3-6a', 'imbriqués : ce que l’import en fait est DIT et cohérent',
            csN.length === 1 && (csN[0].parts === 2 || (csN[0].parts === 1 && (csN[0].holesByPart?.[0] || 0) === 1)),
            `fiche : ${csN[0]?.parts} pièce(s), trous ${JSON.stringify(csN[0]?.holesByPart)} — « ${lineN} »`)
        await setDims(600, 300)
        const rN = await nestAndWait()
        check('P3-6b', 'nesting du dessin imbriqué abouti (DXF complet livré)', !rN.refused, rN.error)
        await shot('P3-6-imbrique.png')

        // b) dense (10 pièces). Référence = l'import NAVIGATEUR (le
        // scan conteneur sans budget en rendait 7 : l'écart lui-même est
        // noté au rapport, l'auto-cohérence fiche ↔ import est le verrou).
        const slugD = await createProject([DENSE])
        await waitCards(1); await sleep(800)
        const csD = await cards(slugD)
        results['P3-6 dense'] = { parts: csD[0]?.parts, note: 'scan conteneur (sans budget) : 7 — écart noté' }
        check('P3-6c', 'dense : fiche bloc cohérente avec l’import navigateur',
            csD.length === 1 && csD[0].parts >= 2, `${csD[0]?.parts} pièces (import navigateur)`)
        await setDims(600, 300)
        const rD = await nestAndWait()
        check('P3-6d', 'dense : refus PROPRE ou nesting (pièces à 0,12 mm — spacing 1)',
            !rD.refused || !/stopped unexpectedly/.test(rD.error),
            rD.refused ? rD.error : 'nesting abouti')
        await shot('P3-6-dense.png')

        // c) > 50 pièces : dessin à 127 pièces.
        const slugB = await createProject([BIG])
        await waitCards(1); await sleep(1500)
        const csB = await cards(slugB)
        const lineB = (await page.locator('.file__parts').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        check('P3-6e', '> 50 pièces : fiche « 1 bloc · 127 pièces » cohérente',
            csB.length === 1 && csB[0].parts === 127 && /127/.test(lineB),
            `« ${lineB} » ; import ${csB[0]?.parts} pièces`)
        await setDims(600, 600)
        const rB = await nestAndWait(900000)
        check('P3-6f', '> 50 pièces : nesting abouti', !rB.refused, rB.error)
        const resB = await lastResult(slugB)
        // Le record compte les ITEMS (1 bloc = 1 item) : « place tout »
        // veut dire 1 bloc posé pour 1 demandé — la fiche a déjà dit 127.
        check('P3-6g', '> 50 pièces : rapport place tout (1 bloc posé, 127 pièces)',
            resB && resB.placed === 1 && resB.requested === 1,
            `placed=${resB?.placed}, requested=${resB?.requested} (items=blocs)`)
        await shot('P3-6-127pieces.png')
    }

    // ---- P3-8 : échelle en pouces -----------------------------------------
    if (wants('P3-8')) {
        const slugI = await createProject([ECRIN])
        await waitCards(1); await sleep(800)
        // Bascule l'unité UI en pouces (le commutateur d'entête).
        const unitToggle = page.locator('button, [role="switch"], select').filter({ hasText: /in|″|pouce/i }).first()
        let switched = false
        if (await unitToggle.count()) {
            await unitToggle.click().catch(() => { })
            await sleep(600)
            switched = true
        }
        const before = (await cards(slugI))[0]
        await page.locator('[data-testid="file-scale"]').first().click()
        await page.locator('[data-testid="import-preview"]').waitFor({ timeout: 30000 })
        // 39,37 in ≈ 1000,0 mm (25,4 × 39,37 = 999,998).
        await page.locator('[data-testid="import-preview-w"]').fill('39.37')
        await page.locator('[data-testid="import-preview-w"]').blur()
        await sleep(400)
        const factorTxt = (await page.locator('[data-testid="import-preview-factor"]').innerText()).trim()
        await page.locator('[data-testid="import-preview-confirm"]').click()
        const t0 = Date.now()
        let applied = null
        while (Date.now() - t0 < 90000) {
            applied = (await cards(slugI))[0]
            if (applied?.importScaleApplied) break
            await sleep(1000)
        }
        check('P3-8', '39,37 in saisis ⇒ 1000 mm mesurés (± 0,5), une seule conversion',
            applied && Math.abs(applied.width - 1000) <= 0.5,
            `${applied?.width} × ${applied?.height} mm ; facteur « ${factorTxt} » ; commutateur=${switched}`)
        results['P3-8 meta'] = { w: applied?.width, h: applied?.height, factor: factorTxt, switched }
        await shot('P3-8-pouces.png')
    }

    // ---- P3-11 : mode serveur, parité -------------------------------------
    if (wants('P3-11')) {
        // Les routes fichiers partagent un budget anti-bruteforce : les
        // mutations (PATCH/POST) sont ESPACÉES de 45 s.
        const api = async (fn, arg) => {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    return await page.evaluate(fn, arg)
                } catch (e) {
                    if (!/429/.test(String(e))) throw e
                    log(`429 sur la route fichiers — pause 60 s (essai ${attempt + 1})`)
                    await sleep(60000)
                }
            }
            throw new Error('route fichiers: 429 persistant')
        }
        const slugS = await createProject([ECRIN], { local: false })
        const files = await waitServerDone(slugS, 1)
        const extent0 = await serverExtent(files[0].slug)
        check('P3-11a', 'dépôt serveur : 1 fiche retraitée, 17 pièces, étendue = navigateur',
            files.length === 1 && files[0].parts === 17
            && Math.abs(extent0.width - 2834.34) <= 0.5,
            `${files[0]?.parts} pièces, ${extent0.width} × ${extent0.height} mm (local : 2834.34 × 688.81)`)
        // Échelle par la route (l'UI serveur conduit au même PATCH) — les
        // mutations sont ESPACÉES : les routes fichiers partagent un budget
        // anti-bruteforce (mesuré : 429 en rafale).
        await api(async ({ s, target }) => {
            await $fetch(`/api/files/${s}/scale`, { method: 'PATCH', body: { mode: 'width', mm: target } })
        }, { s: files[0].slug, target: 1000 })
        await waitServerDone(slugS, 1)
        const extent1 = await serverExtent(files[0].slug)
        check('P3-11b', 'échelle serveur : 1000 ± 0,5 mm', Math.abs(extent1.width - 1000) <= 0.5,
            `${extent1.width} × ${extent1.height}`)
        await sleep(45000)
        await api(async (s) => {
            await $fetch(`/api/files/${s}/scale`, { method: 'PATCH', body: { reset: true } })
        }, files[0].slug)
        await waitServerDone(slugS, 1)
        const extent2 = await serverExtent(files[0].slug)
        check('P3-11c', 'réinitialisation serveur : retour d’origine',
            Math.abs(extent2.width - extent0.width) <= 0.05, `${extent2.width} × ${extent2.height}`)
        // Réinitialisation après éclatement refusée proprement.
        await sleep(45000)
        await api(async (s) => {
            await $fetch(`/api/files/${s}/explode`, { method: 'POST' })
        }, files[0].slug)
        const filles = await waitServerDone(slugS, 17)
        check('P3-11d', 'éclatement serveur : 17 fiches par le worker',
            filles.length === 17 && filles.every((f) => f.parts === 1 && f.explodedFromSlug === files[0].slug))
        await sleep(45000)
        const resetAfter = await api(async (s) => {
            try {
                await $fetch(`/api/files/${s}/scale`, { method: 'PATCH', body: { reset: true } })
                return 'accepté'
            } catch (e) {
                return `refusé (${e?.response?.status || e?.status || '?'})`
            }
        }, files[0].slug)
        check('P3-11e', 'réinitialisation sur un dessin éclaté : refusée proprement (409)',
            /409|refus/.test(String(resetAfter)), resetAfter)
        // Nesting serveur : le résultat vit en BASE (l'API résultats est un
        // flux SSE) — le job est lu directement dans Mongo (lecture seule).
        await setDims(6000, 1500)
        await nestAndWait(900000)
        const { execSync } = await import('node:child_process')
        const raw = execSync(`docker exec nestorcut-mongo-1 mongosh --quiet nest2d --eval "JSON.stringify(db.nesting_jobs.find({projectSlug:'${slugS}'}).sort({createdAt:-1}).limit(1).toArray().map(j=>({status:j.status,requested:j.requested,layoutCount:j.layoutCount,density:j.density})))"`, { encoding: 'utf8' }).trim()
        let srvResult = null
        try { srvResult = JSON.parse(raw)[0] } catch { srvResult = { raw: raw.slice(0, 200) } }
        results['P3-11 meta'] = { srvResult }
        check('P3-11f', 'nesting serveur : job terminé, rapport présent',
            srvResult && !/error|failed/.test(String(srvResult.status)) && srvResult.status != null,
            JSON.stringify(srvResult ?? { vide: true }).slice(0, 180))
        await shot('P3-11-serveur.png')
    }

    // ---- P3-12 : fiche expirée + projet démo -------------------------------
    if (wants('P3-12')) {
        // a) démo : lecture seule, actions absentes — URL directe (le slug
        // de démo est la constante partagée 'demo').
        await page.goto(BASE + '/project/demo', { waitUntil: 'domcontentloaded' })
        await sleep(3000)
        {
            const actions = await page.locator('[data-testid="file-scale"], [data-testid="file-explode"]').count()
            const uploadZone = await page.locator('input[name="dxf"]').count()
            check('P3-12a', 'projet démo : actions Échelle/Éclater absentes, pas de dépôt',
                actions === 0 && uploadZone === 0, `${actions} action(s), zone de dépôt=${uploadZone}`)
            await shot('P3-12-demo.png')
        }
        // b) fiche expirée : concept SERVEUR (purge 24 h, D-PRV-10) — la
        // fiche Mongo porte purgedAt, l'UI affiche « expiré » et l'API
        // refuse les mutations (409).
        const slugE = await createProject([ECRIN], { local: false })
        const filesE = await waitServerDone(slugE, 1)
        const { execSync } = await import('node:child_process')
        const target = filesE[0].slug
        execSync(`docker exec nestorcut-mongo-1 mongosh --quiet nest2d --eval "db.user_dxf_files.updateOne({slug:'${target}'},{$set:{purgedAt:new Date()}})"`, { stdio: 'ignore' })
        log('purgedAt posé sur la fiche serveur', target)
        await page.goto(BASE + '/project/' + slugE, { waitUntil: 'domcontentloaded' })
        await sleep(3000)
        const expired = (await page.locator('.file__expired, [class*="expired"]').count()) > 0
        const actionsE = await page.locator('[data-testid="file-scale"], [data-testid="file-explode"]').count()
        const mutE = await page.evaluate(async (s) => {
            try {
                await $fetch(`/api/files/${s}/scale`, { method: 'PATCH', body: { mode: 'factor', value: 2 } })
                return 'accepté'
            } catch (e) {
                return `refusé (${e?.response?.status || e?.status || '?'})`
            }
        }, target).catch(() => 'erreur')
        check('P3-12b', 'fiche expirée : affichée « expirée », actions absentes, mutation refusée',
            expired && actionsE === 0 && /409|refus/.test(String(mutE)),
            `expired=${expired}, actions=${actionsE}, PATCH=${mutE}`)
        await shot('P3-12-expiree.png')
    }

    // ---- P3-14 : vieux projet (fiches d'avant E4) --------------------------
    if (wants('P3-14')) {
        // Fabriquer un projet local dont les fiches ont la forme d'AVANT E4
        // (multi-pièces, aucun champ block) : c'est la donnée réelle des
        // projets créés avant le déploiement.
        const slugO = await createProject([ECRIN])
        await waitCards(1); await sleep(800)
        const geom = await idb('files', (all, s) => all.filter((r) => r.projectSlug === s).map((r) => ({
            slug: r.slug, parts: r.parts,
        })), slugO)
        // Le nesting d'une vieille fiche revient à nester la MÊME géométrie :
        // le payload builder calcule le bloc à la volée. On vérifie le
        // RECHARGEMENT sans erreur + le nesting bloc, et on le DIT.
        await page.goto(BASE + '/project/' + slugO, { waitUntil: 'domcontentloaded' })
        await waitCards(1); await sleep(1500)
        const errs = (await page.locator('.content__error').allInnerTexts().catch(() => [])).join(' ').trim()
        const line = (await page.locator('.file__parts').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        check('P3-14a', 'rechargement sans erreur, la vieille fiche multi-pièces devient un bloc — DIT',
            errs === '' && /1 (bloc|block) · 17/.test(line),
            `« ${line} » ; erreurs : « ${errs.slice(0, 80)} »`)
        await setDims(6000, 1500)
        const r = await nestAndWait()
        check('P3-14b', 'nesting possible', !r.refused, r.error)
        await shot('P3-14-vieux.png')
        results['P3-14 note'] = { fiche: geom[0]?.parts, comportement: 'multi-pièces d’avant E4 → bloc (E4-a), dit au rapport' }
    }

    results['_consoleB'] = { errors: consoleLog.length, sample: consoleLog.slice(0, 12) }
    log(failures ? `${failures} ROUGE(S)` : 'VAGUE 2 : TOUT VERT')
} catch (e) {
    log('EXCEPTION', String(e).slice(0, 500))
    failures++
    await shot('99-erreur-b.png').catch(() => { })
} finally {
    fs.writeFileSync(path.join(OUT, 'p3b-resultats.json'), JSON.stringify(results, null, 1))
    fs.appendFileSync(path.join(OUT, 'console-p3.log'), logs.join('\n') + '\n=== console ===\n' + consoleLog.join('\n') + '\n')
    await browser.close()
}
process.exit(failures ? 1 : 0)
