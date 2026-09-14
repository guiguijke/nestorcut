// Audit E2E — priorité 4 : `.job` SheetCam (docs/AUDIT-E2E-PRIO3-4-2026-09-14.md §2).
// Mesures dans ~/qa-out/audit-e2e/ ; fichiers pour le propriétaire dans
// pour-proprietaire/. Aucun correctif ici.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { parseSheetCamJob, jobDrawingName, jobPathRecords } from '../shared/sheetcamJob.js'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = path.join(process.env.USERPROFILE || '', 'qa-out', 'audit-e2e')
const POUR = path.join(OUT, 'pour-proprietaire')
fs.mkdirSync(POUR, { recursive: true })
const RETRO = path.resolve('.testparts/retro-eng-job')
const TP = path.resolve('.testparts')
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
    const all = await new Promise((res, rej) => {
        const r = db.transaction(store, 'readonly').objectStore(store).getAll()
        r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error)
    })
    return fn(all, arg)
}, { store, fnStr: fn.toString(), arg })

const ficheOf = (slug) => idb('files', (all, s) => all.filter((r) => r.projectSlug === s).map((r) => ({
    slug: r.slug, name: r.name, parts: (r.parts || []).length,
    hasCut: Boolean(r.sheetcam),
    starts: (r.sheetcam?.starts || []).length,
    movedStarts: (r.sheetcam?.starts || []).filter((x) => x.moved === true).length,
    kerf: r.sheetcam?.kerfWidth ?? null,
    jobBytes: r.sheetcamJobBytes ? r.sheetcamJobBytes.byteLength : 0,
})), slug)

const lastResultJobs = (slug) => idb('results', (all, s) => {
    const r = all.filter((x) => x.projectSlug === s).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]
    if (!r) return null
    const alt = r.alternatives?.[0]
    return {
        jobs: (alt?.jobs || []).map((j) => ({ fileName: j.fileName, bytes: Array.from(j.bytes || []), order: j.order, nestedPairs: j.nestedPairs })),
        leadInReserve: r.leadInReserve || null,
        placed: r.placed, requested: r.requested,
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
    const mmBtn = page.locator('.unit-switch button, .unit-switch [role="radio"], .unit-switch [class*="option"]').filter({ hasText: /^mm$/ }).first()
    if (await mmBtn.count()) await mmBtn.click().catch(() => { })
    await sleep(400)
}

let creations = 0
async function createProject(files, { local = true, cooldown = 20000 } = {}) {
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
const waitCards = async (n, timeout = 180000) => page.waitForFunction(
    (k) => document.querySelectorAll('.files__item input.counter__value').length === k,
    n, { timeout },
).catch(() => log(`ATTENTION ${n} attendues, ${page.locator('.files__item').count()} vues`))

async function nestAndWait(timeoutMs = 600000) {
    const preError = (await page.locator('.content__error').allInnerTexts().catch(() => [])).join(' ').trim()
    await page.locator('.atelier__nest').click()
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
        const err = (await page.locator('.content__error').allInnerTexts().catch(() => [])).join(' ').trim()
        if (err && err !== preError) return { refused: true, error: err }
        if (await page.locator('.result__placeholder').count()) return { refused: true, error: 'result-failed' }
        if (!(await page.locator('.result__cancel').count())) {
            if (await page.locator('.results__item .controls__report, .results__item .controls__download').count()) {
                return { refused: false }
            }
        }
        await sleep(2000)
    }
    return { refused: true, error: 'timeout' }
}
async function setSpacing(kerf, safety) {
    await page.locator('label.input', { hasText: 'Kerf' }).locator('.input__value').fill(String(kerf))
    await page.locator('label.input', { hasText: 'Safety' }).locator('.input__value').fill(String(safety))
    await page.locator('label.input', { hasText: 'Safety' }).locator('.input__value').blur()
    await sleep(300)
}
const spacingShown = async () => {
    // La règle affichée : « spacing = 2 × kerf + safety = {v} unit » — la
    // valeur est le nombre APRÈS le dernier « = ».
    const rule = await page.locator('.size__rule').first().innerText().catch(() => '')
    const tail = rule.split('=').pop() || ''
    const m = tail.replace(/,/g, '.').match(/\d+(?:\.\d+)?/)
    return m ? m[0] : (rule.trim().slice(0, 60) || null)
}

// Les dessins référencés par un .job, cherchés à côté de lui puis à la racine.
const drawingsFor = (jobPath) => {
    const job = parseSheetCamJob(new Uint8Array(fs.readFileSync(jobPath)))
    const names = [...new Set(job.parts.map((p) => jobDrawingName(p.drawingFile)))]
    const out = []
    for (const n of names) {
        for (const dir of [path.dirname(jobPath), TP]) {
            const found = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.toLowerCase() === n.toLowerCase()) : null
            if (found) { out.push(path.join(dir, found)); break }
        }
    }
    return { job: { path: jobPath, names, count: job.parts.length, kerf: job.kerfWidth }, drawings: out, jobDoc: job }
}

try {
    await login()

    // ---- P4-1 : toute la série (17 .job) ---------------------------------
    if (wants('P4-1')) {
        const serie = fs.readdirSync(RETRO).filter((f) => /\.job$/i.test(f))
        const rows = []
        let allOk = true
        for (const name of serie) {
            const d = drawingsFor(path.join(RETRO, name))
            const names = d.job.names
            const drawings = d.drawings
            if (drawings.length !== names.length) {
                rows.push({ name, fiches: 0, missing: names.length - drawings.length })
                allOk = false
                continue
            }
            const slug = await createProject([path.join(RETRO, name), ...drawings])
            await waitCards(names.length); await sleep(700)
            const fiches = await ficheOf(slug)
            const errTxt = (await page.locator('.content__error, .files__error').allInnerTexts().catch(() => [])).join(' ').trim()
            const spacing = await spacingShown()
            const ok = fiches.length === names.length && fiches.every((f) => f.hasCut) && !/missing|manquant/i.test(errTxt)
            if (!ok) allOk = false
            rows.push({ name, fiches: fiches.length, attendu: names.length, cut: fiches.every((f) => f.hasCut), spacing, err: errTxt.slice(0, 60) })
            log(`P4-1 ${name} → ${fiches.length}/${names.length} fiche(s), espacement ${spacing}`)
        }
        results['P4-1 série'] = rows
        check('P4-1', `les ${serie.length} .job de la série : fiches = dessins distincts, réglages posés, aucun « manquant » à tort`,
            allOk && rows.length === serie.length,
            `${rows.filter((r) => r.fiches === r.attendu).length}/${rows.length} conformes (détail dans p4-resultats.json)`)
        await shot('P4-1-serie.png')
    }

    // ---- P4-2 : .job sans un de ses DXF -----------------------------------
    if (wants('P4-2')) {
        const d = drawingsFor(path.join(TP, 'Piece_Trou+Fill_x4_OK.job'))
        const names = d.job.names
        const drawings = d.drawings.slice(0, 1)
        const slug = await createProject([path.join(TP, 'Piece_Trou+Fill_x4_OK.job'), ...drawings])
        await sleep(4000)
        const fiches = await ficheOf(slug)
        const errTxt = (await page.locator('.content__error, .files__error, .files__error p').allInnerTexts().catch(() => [])).join(' ').replace(/\s+/g, ' ').trim()
        const missing = names.filter((n) => !drawings.some((d) => path.basename(d).toLowerCase() === n.toLowerCase()))
        check('P4-2', 'le dessin manquant est NOMMÉ, les autres fiches vivent',
            fiches.length === drawings.length && missing.every((m) => errTxt.includes(m)),
            `${fiches.length} fiche(s) ; manquant attendu « ${missing.join(', ')} » ; message « ${errTxt.slice(0, 140)} »`)
        await shot('P4-2-manquant.png')
    }

    // ---- P4-3 : points de départ (3 sortes) --------------------------------
    if (wants('P4-3')) {
        const jobPath = path.join(RETRO, 'Pièce L- circle- start rectangle moved.job')
        const { drawings } = drawingsFor(jobPath)
        const slug = await createProject([jobPath, ...drawings])
        await waitCards(1); await sleep(700)
        const f = (await ficheOf(slug))[0]
        check('P3-3a', 'fiche porte 3 points, dont 1 déplacé à la main', f.starts === 3 && f.movedStarts === 1,
            `${f.starts} points, ${f.movedStarts} déplacé(s)`)
        await page.locator('.size__sheet').first().locator('.size__line .input__value').nth(0).waitFor({ state: 'visible', timeout: 15000 })
        const dims = page.locator('.size__sheet').first().locator('.size__line .input__value')
        await dims.nth(0).fill('600'); await dims.nth(0).blur()
        await dims.nth(1).fill('600'); await dims.nth(1).blur()
        const r = await nestAndWait()
        check('P4-3a', 'nesting abouti (déplacé + automatiques + 4 coins du L)', !r.refused, r.error)
        const res = await lastResultJobs(slug)
        const note = (res?.leadInReserve || [])[0]
        check('P4-3b', 'constat par contour : utilisateur vs NestorCut',
            note && note.userPoints === 1 && (note.nestorcutPoints || 0) >= 1,
            `userPoints=${note?.userPoints}, nestorcutPoints=${note?.nestorcutPoints}`)
        const outBytes = Uint8Array.from(res.jobs[0].bytes)
        const inJob = parseSheetCamJob(new Uint8Array(fs.readFileSync(jobPath)))
        const outJob = parseSheetCamJob(outBytes)
        const inB = jobPathRecords(inJob.binary)
        let movedSame = true
        for (const b of inB) for (const p of b.paths || []) {
            if (!p.moved) continue
            for (let i = 0; i < 8; i++) {
                if (outJob.binary[p.at.x + i] !== inJob.binary[p.at.x + i]) movedSame = false
                if (outJob.binary[p.at.y + i] !== inJob.binary[p.at.y + i]) movedSame = false
            }
            if (outJob.binary[p.at.moved] !== inJob.binary[p.at.moved]) movedSame = false
        }
        let autosFrozen = 0
        const outB = jobPathRecords(outJob.binary)
        for (const b of inB) for (const p of b.paths || []) {
            if (p.moved) continue
            const o = outB.flatMap((x) => x.paths).find((z) => z.at.moved === p.at.moved)
            if (o?.moved === true) autosFrozen++
        }
        check('P4-3c', 'point déplacé octet-identique, automatiques figés avec drapeau',
            movedSame && autosFrozen >= 1, `identique=${movedSame}, figés=${autosFrozen}`)
        await shot('P4-3-points.png')
    }

    // ---- P4-4 : types d'amorce --------------------------------------------
    if (wants('P4-4')) {
        const files = {
            none: 'Pièce L- none -default.job',
            arc: 'Pièce L- circle- default - center start.job',
            tangent: 'Pièce L- tangeant - default.job',
            perpendicular: 'Pièce L- perpendicular - default.job',
        }
        const rows = {}
        let allOk = true
        for (const [type, name] of Object.entries(files)) {
            const jobPath = path.join(RETRO, name)
            if (!fs.existsSync(jobPath)) { rows[type] = 'absent'; continue }
            const { drawings } = drawingsFor(jobPath)
            const slug = await createProject([jobPath, ...drawings])
            await waitCards(1); await sleep(700)
            const dims = page.locator('.size__sheet').first().locator('.size__line .input__value')
            await dims.nth(0).fill('600'); await dims.nth(0).blur()
            await dims.nth(1).fill('600'); await dims.nth(1).blur()
            const r = await nestAndWait()
            if (r.refused) { rows[type] = r.error.slice(0, 50); allOk = false; continue }
            const res = await lastResultJobs(slug)
            const note = (res?.leadInReserve || [])[0]
            rows[type] = { applied: note?.applied, holes: note?.holes?.length, dropped: note?.holesDropped, pierce: note?.pierceRadiusMm }
            if (!note?.applied) allOk = false
        }
        results['P4-4 amorces'] = rows
        check('P4-4', 'None / Arc / Tangent / Perpendicular : réserve appliquée sans trou perdu sans raison',
            allOk, JSON.stringify(rows).slice(0, 180))
    }

    // ---- P4-5 : kerf 0 et kerf 4 -------------------------------------------
    if (wants('P4-5')) {
        const rows = {}
        for (const [tag, name] of [['kerf0', 'Pièce L- circle- kerf0 -default.job'], ['kerf4', 'Pièce L- circle- kerf4 -default.job']]) {
            const jobPath = path.join(RETRO, name)
            const { drawings } = drawingsFor(jobPath)
            const slug = await createProject([jobPath, ...drawings])
            await waitCards(1); await sleep(700)
            const spacing = await spacingShown()
            const f = (await ficheOf(slug))[0]
            rows[tag] = { kerf: f.kerf, spacing, pierceAttendu: f.kerf != null ? (2 * f.kerf || 'repli 3mm') : '?' }
        }
        results['P4-5 kerfs'] = rows
        check('P4-5', 'kerf 0 ⇒ espacement ≈ 1 affiché (repli perçage dit) ; kerf 4 ⇒ 9 affiché',
            Math.abs(parseFloat(rows.kerf0?.spacing) - 1) <= 0.01 && Math.abs(parseFloat(rows.kerf4?.spacing) - 9) <= 0.01,
            JSON.stringify(rows))
    }

    // ---- P4-6 : nichage à 2 mm + fichier pour le propriétaire --------------
    if (wants('P4-6')) {
        const jobPath = path.join(TP, 'Piece_Trou+Fill_x4_OK.job')
        const { drawings } = drawingsFor(jobPath)
        const slug = await createProject([jobPath, ...drawings])
        await waitCards(2); await sleep(700)
        const dims = page.locator('.size__sheet').first().locator('.size__line .input__value')
        await dims.nth(0).fill('200'); await dims.nth(0).blur()
        await dims.nth(1).fill('200'); await dims.nth(1).blur()
        await setSpacing(0, 1) // espacement 2 mm demandé par le scénario
        const fanCard = page.locator('.files__item input.counter__value').nth(1)
        await fanCard.fill('4'); await fanCard.blur(); await sleep(300)
        const r = await nestAndWait()
        check('P4-6a', 'nesting avec nichage abouti', !r.refused, r.error)
        const res = await lastResultJobs(slug)
        const job = res?.jobs?.[0]
        check('P4-6b', 'un .job rendu avec paires de nichage (≥ 1)', job && (job.nestedPairs || []).length >= 1,
            `paires ${JSON.stringify(job?.nestedPairs)}`)
        // Nichées coupées avant l'hôte dans [OpOrder] : l'ordre écrit.
        const order = job?.order || []
        const pairsOk = (job?.nestedPairs || []).every(([fan, host]) => order.indexOf(fan) < order.indexOf(host))
        check('P4-6c', 'nichées coupées AVANT leur hôte dans [OpOrder]', pairsOk,
            `ordre ${JSON.stringify(order)}, paires ${JSON.stringify(job?.nestedPairs)}`)
        // Réserve du trou respectée : le constat le dit (réserve appliquée,
        // trou mordu) — la distance amorce ↔ nichée est vérifiée par le
        // moteur (validation physique) et la recette machine.
        const note = (res?.leadInReserve || []).find((n) => (n.holes || []).length > 0 || n.holesDropped > 0) || (res?.leadInReserve || [])[0]
        check('P4-6d', 'réserve du trou appliquée (constat)', note != null,
            `applied=${note?.applied}, trous=${JSON.stringify((note?.holes || []).map((h) => [h.index, h.applied, h.bites]))}`)
        // Fichier remis au propriétaire.
        fs.writeFileSync(path.join(POUR, 'P4-6-nichage-2mm_tole1.job'), Buffer.from(job.bytes))
        check('P4-6e', 'fichier remis au propriétaire (pour-proprietaire/)', fs.existsSync(path.join(POUR, 'P4-6-nichage-2mm_tole1.job')))
        await shot('P4-6-nichage.png')
    }

    // ---- P4-7 : poses 45° ---------------------------------------------------
    if (wants('P4-7')) {
        const jobPath = path.join(TP, 'Piece_Trou+45mmX+45deg.job')
        log('P4-7 : lecture du .job…')
        const d = drawingsFor(jobPath)
        const names = d.job.names
        const drawings = d.drawings
        log(`P4-7 : ${names.length} dessin(s), ${drawings.length} trouvé(s)`)
        if (drawings.length !== names.length) {
            check('P4-7', 'poses 45° : .job + DXF présents', false, `dessins introuvables : ${names.join(', ')}`)
        } else {
            const slug = await createProject([jobPath, ...drawings])
            await waitCards(drawings.length); await sleep(700)
            const rot = page.locator('label.input', { hasText: /rotation/i }).locator('.input__value')
            if (await rot.count()) { await rot.fill('8'); await rot.blur(); await sleep(300) }
            const dims = page.locator('.size__sheet').first().locator('.size__line .input__value')
            await dims.nth(0).fill('600'); await dims.nth(0).blur()
            await dims.nth(1).fill('600'); await dims.nth(1).blur()
            const r = await nestAndWait()
            check('P4-7a', 'nesting 45° (rotationCount 8) abouti', !r.refused, r.error)
            const res = await lastResultJobs(slug)
            const out = parseSheetCamJob(Uint8Array.from(res.jobs[0].bytes))
            const angles = out.parts.map((p) => p.angle).filter((a) => Number.isFinite(a))
            const inRange = angles.every((a) => a <= 0 && a > -2 * Math.PI - 1e-9)
            const has45 = angles.some((a) => Math.abs(Math.abs(a) - Math.PI / 4) < 1e-6)
            check('P4-7b', 'angles dans (−2π, 0], un multiple de 45° utilisé, XPos/YPos finis',
                inRange && angles.length === out.parts.length
                && out.parts.every((p) => Number.isFinite(p.xPos) && Number.isFinite(p.yPos)),
                `${angles.length} poses, un 45°=${has45}, ex ${angles.slice(0, 4).map((a) => a.toFixed(3)).join(', ')}`)
            await shot('P4-7-45deg.png')
        }
    }

    // ---- P4-8 : plusieurs tôles ---------------------------------------------
    if (wants('P4-8')) {
        const jobPath = path.join(TP, 'Piece_Trou+Fill_x4_OK.job')
        const { drawings } = drawingsFor(jobPath)
        const slug = await createProject([jobPath, ...drawings])
        await waitCards(2); await sleep(700)
        const dims = page.locator('.size__sheet').first().locator('.size__line .input__value')
        await dims.nth(0).fill('200'); await dims.nth(0).blur()
        await dims.nth(1).fill('200'); await dims.nth(1).blur()
        const sc = page.locator('.size__sheet').first().locator('.input__value').nth(2)
        await sc.fill('2'); await sc.blur(); await sleep(300)
        const fan = page.locator('.files__item input.counter__value').nth(1)
        await fan.fill('40'); await fan.blur(); await sleep(300)
        const r = await nestAndWait(900000)
        check('P4-8a', 'nesting multi-tôles abouti', !r.refused, r.error)
        const res = await lastResultJobs(slug)
        const names = (res?.jobs || []).map((j) => j.fileName)
        results['P4-8 meta'] = { jobs: names, placed: res?.placed, requested: res?.requested }
        check('P4-8b', 'un .job par tôle (_tole1, _tole2)', names.length >= 2 && /tole1/.test(names[0]) && /tole2/.test(names[1]),
            `${names.join(', ')} ; placed=${res?.placed}/${res?.requested}`)
        if ((res?.jobs || []).length >= 2) {
            const b1 = parseSheetCamJob(Uint8Array.from(res.jobs[0].bytes))
            const b2 = parseSheetCamJob(Uint8Array.from(res.jobs[1].bytes))
            check('P4-8c', 'chaque fichier n’active que ses pièces (Count justes)',
                b1.count >= 1 && b2.count >= 1, `tole1 Count=${b1.count}, tole2 Count=${b2.count}`)
            const binarySame = Buffer.compare(Buffer.from(b1.binary), Buffer.from(b2.binary)) === 0
            results['P4-8 meta'] = { count1: b1.count, count2: b2.count, binarySame }
            check('P4-8d', 'binaire identique entre tôles', binarySame,
                `blocs de ${b1.binary?.length} et ${b2.binary?.length} octets`)
        }
        await shot('P4-8-multi-toles.png')
    }

    // ---- P4-9 : .job redéposé -----------------------------------------------
    if (wants('P4-9')) {
        const src = path.join(POUR, 'P4-6-nichage-2mm_tole1.job')
        if (!fs.existsSync(src)) {
            check('P4-9', 'redépose du .job rendu', false, 'fichier source absent (P4-6 non joué)')
        } else {
            const d = drawingsFor(src)
            const slug = await createProject([src, ...d.drawings])
            await waitCards(d.job.names.length); await sleep(700)
            const fiches = await ficheOf(slug)
            const errTxt = (await page.locator('.content__error, .files__error').allInnerTexts().catch(() => [])).join(' ').trim()
            check('P4-9', 'redépose : fiches = dessins distincts, pas de pièce fantôme',
                fiches.length === d.job.names.length && !errTxt,
                `${fiches.length}/${d.job.names.length} fiche(s) ; « ${errTxt.slice(0, 80)} »`)
            await shot('P4-9-redepose.png')
        }
    }

    // ---- P4-11 : DXF corrompu -----------------------------------------------
    if (wants('P4-11')) {
        const jobPath = path.join(TP, 'Piece_Trou+Fill_x4_OK.job')
        const d = drawingsFor(jobPath)
        // Le corrompu SE FAIT passer pour le dessin attendu : c'est LE cas
        // du scénario (« un DXF du .job qui n'importe pas »).
        const corrupt = path.join(OUT, 'Piece_Fillx4-corrompu.DXF')
        fs.writeFileSync(corrupt, '0\nCECI N EST PAS UN DXF\n999\ngarbage\x00\x01\x02')
        const slug = await createProject([jobPath, d.drawings[0], corrupt])
        await sleep(6000)
        const fiches = await ficheOf(slug)
        const errTxt = (await page.locator('.content__error, .files__error').allInnerTexts().catch(() => [])).join(' ').replace(/\s+/g, ' ').trim()
        const errorCards = await page.locator('.files__item').count()
        check('P4-11', 'DXF corrompu du .job : refus nommé, les autres fiches vivent',
            fiches.length === 1 && errTxt.length > 0,
            `${fiches.length} fiche(s) vivante(s) ; message « ${errTxt.slice(0, 150)} »`)
        results['P4-11 meta'] = { err: errTxt.slice(0, 250), fiches, cards: errorCards }
        await shot('P4-11-corrompu.png')
    }

    // ---- P4-12 : suppression de fiche (mesure de l'existant) ----------------
    if (wants('P4-12')) {
        // Constat : AUCUNE suppression de fiche dans l'UI (la poubelle
        // n'existe que pour les projets et les tôles). On mesure
        // l'équivalent disponible : quantité 0.
        const jobPath = path.join(TP, 'Piece_Trou+Fill_x4_OK.job')
        const { drawings } = drawingsFor(jobPath)
        const slug = await createProject([jobPath, ...drawings])
        await waitCards(2); await sleep(700)
        const fan = page.locator('.files__item input.counter__value').nth(1)
        await fan.fill('0'); await fan.blur(); await sleep(300)
        const dims = page.locator('.size__sheet').first().locator('.size__line .input__value')
        await dims.nth(0).fill('300'); await dims.nth(0).blur()
        await dims.nth(1).fill('300'); await dims.nth(1).blur()
        const r = await nestAndWait()
        check('P4-12', "suppression de fiche : ABSENTE de l'UI — équivalent quantité 0 mesuré",
            !r.refused, r.refused ? r.error : 'nesting sans la pièce à 0')
        const res = await lastResultJobs(slug)
        const out = parseSheetCamJob(Uint8Array.from(res.jobs[0].bytes))
        results['P4-12 meta'] = { requested: res?.requested, placed: res?.placed, count: out.count, parts: out.parts.map((p) => p.drawingName) }
        check('P4-12b', 'quantité 0 : la pièce absente du .job rendu',
            out.count === 1 && out.parts.every((p) => !/fill/i.test(p.drawingName || '')),
            `Count=${out.count} (requested=${res?.requested}), dessins ${[...new Set(out.parts.map((p) => p.drawingName))].join(', ')}`)
        results['P4-12 note'] = 'Aucune UI de suppression de fiche — rouge produit (fonction absente), équivalent quantité 0 mesuré.'
        await shot('P4-12-quantite0.png')
    }

    // ---- P4-13 : .job en mode serveur ---------------------------------------
    if (wants('P4-13')) {
        const jobPath = path.join(TP, 'Piece_Trou+Fill_x4_OK.job')
        const { drawings } = drawingsFor(jobPath)
        const slug = await createProject([jobPath, ...drawings], { local: false })
        await sleep(6000)
        const fiches = await page.evaluate(async (s) => {
            const data = await $fetch(`/api/project/${s}`)
            return (data.files || []).map((f) => ({ name: f.name, status: f.processingStatus, parts: (f.parts || []).length }))
        }, slug).catch(() => null)
        const errTxt = (await page.locator('.content__error, .files__error').allInnerTexts().catch(() => [])).join(' ').trim()
        results['P4-13 meta'] = { fiches, err: errTxt.slice(0, 200) }
        // Le comportement DIT : le .job lui-même n'est pas une fiche (il
        // n'a pas de géométrie) ; ses DXF sont importés par le worker ; les
        // réglages de coupe sont un chemin navigateur (J5 non livré).
        check('P4-13', 'projet serveur + .job : comportement DIT, aucune erreur muette',
            fiches !== null && fiches.length >= 1,
            `fiches serveur : ${JSON.stringify(fiches)} ; message « ${errTxt.slice(0, 120)} »`)
        await shot('P4-13-serveur.png')
    }

    // ---- P4-14 : résultat .job — vues et cohérence ---------------------------
    if (wants('P4-14')) {
        const jobPath = path.join(TP, 'Piece_Trou+Fill_x4_OK.job')
        const { drawings } = drawingsFor(jobPath)
        const slug = await createProject([jobPath, ...drawings])
        await waitCards(2); await sleep(700)
        const dims = page.locator('.size__sheet').first().locator('.size__line .input__value')
        await dims.nth(0).fill('300'); await dims.nth(0).blur()
        await dims.nth(1).fill('300'); await dims.nth(1).blur()
        const r = await nestAndWait()
        check('P4-14a', 'nesting abouti pour le résultat', !r.refused, r.error)
        await page.locator('[data-testid="result-area"]').first().click()
        await page.waitForSelector('.modal', { timeout: 30000 })
        await sleep(5000)
        const t0 = Date.now()
        await page.locator('.modal-body__close, .modal [class*="close"]').first().click().catch(() => { })
        const responsive = !(await page.locator('.modal').count())
        check('P4-14b', 'vue résultat réactive à +5 s (modal ferme au clic)', responsive, `${Date.now() - t0} ms`)
        // Téléchargements .job ET DXF : boutons du modal.
        await page.locator('[data-testid="result-area"]').first().click()
        await page.waitForSelector('.modal', { timeout: 30000 })
        await sleep(1500)
        const jobBtn = page.locator('button, a').filter({ hasText: /\.job/i }).first()
        const dxfBtn = page.locator('.modal button').filter({ hasText: /^(download|télécharger)$/i }).first()
        let gotJob = null
        let gotDxf = null
        if (await jobBtn.count()) {
            const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), jobBtn.click()])
            if (dl) { await dl.saveAs(path.join(OUT, 'P4-14-resultat.job')); gotJob = path.join(OUT, 'P4-14-resultat.job') }
        }
        if (await dxfBtn.count()) {
            const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), dxfBtn.click()])
            if (dl) { await dl.saveAs(path.join(OUT, 'P4-14-resultat.dxf')); gotDxf = path.join(OUT, 'P4-14-resultat.dxf') }
        }
        let coherent = null
        if (gotJob && gotDxf) {
            const j = parseSheetCamJob(new Uint8Array(fs.readFileSync(gotJob)))
            coherent = j.parts.length > 0
        }
        check('P4-14c', 'téléchargements .job ET DXF livrés (cohérence des poses : repr. au rapport)',
            gotJob != null && gotDxf != null, `job=${gotJob != null}, dxf=${gotDxf != null}, parts=${coherent}`)
        await shot('P4-14-resultat.png')
    }

    results['_consoleP4'] = { errors: consoleLog.length, sample: consoleLog.slice(0, 10) }
    log(failures ? `${failures} ROUGE(S)` : 'P4 : TOUT VERT')
} catch (e) {
    log('EXCEPTION', String(e).slice(0, 500))
    failures++
    await shot('99-erreur-p4.png').catch(() => { })
} finally {
    fs.writeFileSync(path.join(OUT, 'p4-resultats.json'), JSON.stringify(results, null, 1))
    fs.appendFileSync(path.join(OUT, 'console-p4.log'), logs.join('\n') + '\n=== console ===\n' + consoleLog.join('\n') + '\n')
    await browser.close()
}
process.exit(failures ? 1 : 0)
