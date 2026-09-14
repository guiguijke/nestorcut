// QA E2E — §9.59 : un point de départ DÉPLACÉ À LA MAIN est INTOUCHABLE
// (`docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` §9.59, consigne du 14/09).
//
// Le `.job` « Pièce L- circle- start rectangle moved » (série privée du
// propriétaire, .testparts/retro-eng-job) est déposé AVEC son dessin, nesté,
// et le `.job` de résultat est comparé OCTET PAR OCTET au binaire d'entrée :
//
//   1. le chemin du RECTANGLE (moved = true) sort IDENTIQUE — 16 octets de
//      point + drapeau — et son point absolu est bien (10 ; 138,9), celui où
//      la réserve d'amorce est posée ;
//   2. les chemins AUTOMATIQUES du même fichier, eux, SONT figés (drapeau
//      levé par J4-ter) — contrôle négatif : NestorCut peut les réécrire ;
//   3. le constat de réserve dit le cas par pièce (userPoints /
//      nestorcutPoints) ;
//   4. AUCUN autre octet du binaire ne bouge.
//
// Ce que ce harnais ne mesure pas : le G-code Machine (l'amorce y descend au
// point conservé) — c'est la recette du propriétaire, sur sa table.
//
// Usage :
//   QA_JOB=<fichier .job « moved »> QA_DXF=<dessin du .job>
//   node scripts/qa-e2e-startpoint-moved.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { jobPathRecords, parseSheetCamJob, jobDrawingName } from '../shared/sheetcamJob.js'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('.qa-pw/s959')
const JOB = process.env.QA_JOB
    || path.resolve('.testparts/retro-eng-job/Pièce L- circle- start rectangle moved.job')
fs.mkdirSync(OUT, { recursive: true })

const logs = []
const log = (...a) => {
    const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`
    logs.push(s)
    console.log(s)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = {}
let failures = 0
const check = (name, ok, detail = '') => {
    results[name] = { ok: Boolean(ok), detail: String(detail) }
    if (!ok) failures++
    log(ok ? 'OK  ' : 'ÉCHEC', name, detail ? `— ${detail}` : '')
}

if (!fs.existsSync(JOB)) {
    console.error(`fichier absent : ${JOB}`)
    process.exit(2)
}
// Le dessin référencé par le .job, CHERCHÉ À CÔTÉ de lui (règle 9).
const drawingName = jobDrawingName(
    parseSheetCamJob(new Uint8Array(fs.readFileSync(JOB))).parts[0].drawingFile,
)
const DXF = process.env.QA_DXF || path.join(path.dirname(JOB), drawingName)
if (!fs.existsSync(DXF)) {
    console.error(`dessin du .job introuvable : ${DXF}`)
    process.exit(2)
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') log('[console:error]', m.text().slice(0, 200)) })
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))

const shot = async (name) => {
    try { await page.screenshot({ path: path.join(OUT, name), timeout: 30000 }); log('capture:', name) }
    catch { log('capture échouée (non fatale):', name) }
}

let failed = null
try {
    // ---------- dépôt : le `.job` + son dessin (le chemin complet) --------
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', 'guillaume@local.dev')
    await page.fill('.local-auth__form input[type="password"]', 'nestorcut-local-2026')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const devCard = page.locator('.create__privacy [class*="option"], .create__privacy button, .create__privacy label').filter({ hasText: /This device/i }).first()
    if (await devCard.count()) await devCard.click().catch(() => {})
    await page.setInputFiles('input[name="dxf"]', [JOB, DXF])
    await page.waitForURL('**/project/**', { timeout: 90000 })
    const slug = page.url().split('/project/')[1].split(/[?#]/)[0]
    await page.waitForFunction(
        () => document.querySelectorAll('.files__item input.counter__value').length === 1,
        null, { timeout: 240000 },
    )
    await sleep(800)
    log('projet créé :', slug)

    // ---------- la fiche : ses points, lus dans IndexedDB ---------------
    const fiche = await page.evaluate(async (proj) => {
        const db = await new Promise((res, rej) => {
            const r = indexedDB.open('nestorcut-local')
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
        })
        const recs = await new Promise((res, rej) => {
            const r = db.transaction('files', 'readonly').objectStore('files').getAll()
            r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error)
        })
        const rec = recs.filter((x) => x.projectSlug === proj)[0]
        return rec ? {
            name: rec.name,
            hasCut: Boolean(rec.sheetcam),
            starts: (rec.sheetcam?.starts || []).map((s) => ({
                pathIndex: s.pathIndex, offset: s.offset, moved: s.moved === true,
            })),
            origin: rec.sheetcam?.origin || null,
        } : null
    }, slug)
    if (!fiche?.hasCut || !fiche.starts.length) throw new Error(`fiche sans réglages de coupe : ${JSON.stringify(fiche)}`)
    log('fiche :', fiche.name, '—', fiche.starts.length, 'points, dont',
        fiche.starts.filter((s) => s.moved).length, 'déplacés à la main')

    // ---------- nesting (une pièce, tôle confortable) --------------------
    const sheet = page.locator('.size__sheet').first()
    const dims = sheet.locator('.size__line .input__value')
    await dims.nth(0).fill('6000'); await dims.nth(0).blur()
    await dims.nth(1).fill('1500'); await dims.nth(1).blur()
    const kerfF = page.locator('label.input', { hasText: 'Kerf' }).locator('.input__value')
    await kerfF.fill('0'); await kerfF.blur()
    const safetyF = page.locator('label.input', { hasText: 'Safety' }).locator('.input__value')
    await safetyF.fill('1'); await safetyF.blur()
    await page.locator('.atelier__nest').click()
    const t0 = Date.now()
    let outcome = 'timeout'
    while (Date.now() - t0 < 5 * 60 * 1000) {
        const err = await page.locator('.content__error').allInnerTexts().catch(() => [])
        if (err.map((s) => s.trim()).filter(Boolean).length) { outcome = 'page-error'; break }
        const item = page.locator('.results__item').first()
        if (await item.count()) {
            const running = await item.locator('.result__cancel').count()
            const failedPh = await item.locator('.result__placeholder').count()
            const doneBtn = await item.locator('.controls__report, .controls__download').count()
            if (failedPh) { outcome = 'result-failed'; break }
            if (!running && doneBtn) { outcome = 'done'; break }
        }
        await sleep(2000)
    }
    if (outcome !== 'done') throw new Error('nesting incomplet : ' + outcome)
    await sleep(1500)
    log('nesting terminé')

    // ---------- le .job rendu + les constats, lus dans IndexedDB ---------
    const payload = await page.evaluate(async (proj) => {
        const db = await new Promise((res, rej) => {
            const r = indexedDB.open('nestorcut-local')
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
        })
        const recs = await new Promise((res, rej) => {
            const r = db.transaction('results', 'readonly').objectStore('results').getAll()
            r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error)
        })
        const rec = recs.filter((x) => x.projectSlug === proj)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]
        if (!rec) return null
        return {
            jobs: (rec.alternatives?.[0]?.jobs || []).map((j) => ({
                fileName: j.fileName,
                bytes: Array.from(j.bytes || []),
            })),
            leadInReserve: rec.leadInReserve || null,
        }
    }, slug)
    if (!payload?.jobs?.length) throw new Error('aucun .job dans le résultat')
    const outBytes = Uint8Array.from(payload.jobs[0].bytes)
    fs.writeFileSync(path.join(OUT, 'result.job'), outBytes)
    log('.job rendu :', payload.jobs[0].fileName, outBytes.length, 'octets')

    // ---------- VERROUS §9.59 ---------------------------------------------
    const inJob = parseSheetCamJob(new Uint8Array(fs.readFileSync(JOB)))
    const outJob = parseSheetCamJob(outBytes)
    const inBlocks = jobPathRecords(inJob.binary)
    const outBlocks = jobPathRecords(outJob.binary)

    // Le chemin déplacé à la main (celui du rectangle) : IDENTIQUE à l'octet.
    let movedPath = null
    for (const [bi, b] of inBlocks.entries()) {
        for (const [pi, p] of (b.paths || []).entries()) {
            if (p.moved) movedPath = { bi, pi, p }
        }
    }
    check('V0 le fichier d’entrée porte UN point déplacé à la main', movedPath !== null)
    if (movedPath) {
        const { p, bi, pi } = movedPath
        const at = p.at
        const same = [at.x, at.y].every((base) => {
            for (let i = 0; i < 8; i++) {
                if (outJob.binary[base + i] !== inJob.binary[base + i]) return false
            }
            return true
        }) && outJob.binary[at.moved] === inJob.binary[at.moved]
        check('V1 les 17 octets du chemin déplacé sortent IDENTIQUES (valeur + drapeau)', same)
        const abs = [
            inBlocks[bi].origin[0] + p.start[0],
            inBlocks[bi].origin[1] + p.start[1],
        ]
        log(`point de l’utilisateur (absolu) : (${abs[0].toFixed(2)} ; ${abs[1].toFixed(2)})`)
        check('V2 le point conservé est bien (10 ; 138,9) — celui où la réserve se pose',
            Math.abs(abs[0] - 10) <= 0.05 && Math.abs(abs[1] - 138.9) <= 0.05,
            `(${abs[0].toFixed(2)} ; ${abs[1].toFixed(2)})`)
        // CONTRÔLE NÉGATIF : les chemins automatiques du même fichier, eux,
        // sont figés (J4-ter) — NestorCut peut les réécrire.
        const autos = (inBlocks[bi].paths || []).filter((q) => !q.moved)
        const frozen = autos.filter((q) => {
            const o = (outBlocks[bi].paths || []).find((z) => z.at.moved === q.at.moved)
            return o?.moved === true
        })
        check('V3 contrôle négatif : les chemins AUTOMATIQUES sont figés (réécrivables)',
            autos.length > 0 && frozen.length === autos.length,
            `${frozen.length}/${autos.length}`)
    }

    // Le constat de réserve dit le cas par pièce.
    const note = (payload.leadInReserve || [])[0]
    check('V4 le constat de réserve compte les points utilisateur vs NestorCut',
        note != null && note.userPoints === 1 && (note.nestorcutPoints || 0) >= 1,
        `userPoints=${note?.userPoints}, nestorcutPoints=${note?.nestorcutPoints}`)

    // Aucun AUTRE octet du binaire ne bouge (hors drapeaux des automatiques).
    const autoFlags = new Set()
    for (const b of inBlocks) {
        for (const q of (b.paths || [])) {
            if (!q.moved) autoFlags.add(q.at.moved)
        }
    }
    let stray = 0
    for (let i = 0; i < outJob.binary.length; i++) {
        if (outJob.binary[i] !== inJob.binary[i] && !autoFlags.has(i)) stray++
    }
    check('V5 le reste du binaire ne bouge d’AUCUN octet', stray === 0, `${stray} octet(s) hors drapeaux`)

    await shot('resultat.png')
    log(failures ? `${failures} VERROU(S) EN ÉCHEC` : 'TOUS LES VERROUS SONT VERTS')
} catch (e) {
    failed = e
    log('EXCEPTION', String(e).slice(0, 600))
    failures++
    await shot('99-error.png').catch(() => {})
} finally {
    fs.writeFileSync(path.join(OUT, 'run.log'), logs.join('\n') + '\n')
    fs.writeFileSync(path.join(OUT, 'resultats.json'), JSON.stringify(results, null, 1))
    await browser.close()
}
process.exit(failures ? 1 : 0)
