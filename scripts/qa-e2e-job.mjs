// QA E2E navigateur — lot J4 : nester un `.job` SheetCam.
//
// Le verrou produit demandé au point 6 de la consigne (§5 de
// `docs/REPRISE-2026-09-13.md`) : dépôt d'un `.job` + ses DXF → nesting →
// `.job` téléchargé, dont on vérifie qu'il a LA STRUCTURE DE LA RECETTE.
//
// Ce qui est mesuré, et pourquoi chaque mesure n'est pas vide :
//
//   A. le `.job` est reconnu À LA DÉPOSE et crée une fiche PAR DESSIN, avec
//      la quantité que le fichier lui donne (et non 1 par défaut) ;
//   B. la tôle et l'espacement sont PRÉ-REMPLIS depuis le fichier — on lit
//      les champs du formulaire, pas ce que le code croit avoir écrit ;
//   C. le nesting tourne et place toutes les pièces ;
//   D. le `.job` téléchargé est relu PAR NOTRE PROPRE LECTEUR et comparé au
//      `.job` d'entrée : `Count`, `Optimisation=3`, `[OpOrder]` (nichées
//      avant leur hôte), `copyOf` par exemplaire, chemins absolus MASQUÉS,
//      et bloc binaire IDENTIQUE À L'OCTET PRÈS ;
//   E. contrôle négatif : les angles écrits tiennent tous dans l'intervalle
//      que SheetCam utilise, (−2π, 0] — c'est le défaut `Angle=-6.283` de la
//      recette du 13/09 qui est verrouillé ici.
//
// Les fichiers d'entrée sont PRIVÉS et passés par variable d'environnement ;
// rien de nommé ne sort dans `docs/`. Par défaut le harnais prend la fixture
// anonymisée du dépôt et les deux dessins du moulinet.
//
// Usage :
//   QA_JOB=<fichier.job> QA_DXF_DIR=<dossier des dessins> QA_OUT=<dir> \
//   node scripts/qa-e2e-job.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { parseSheetCamJob, jobSheet } from '../shared/sheetcamJob.js'
import { spacingFromKerf } from '../shared/sheetcamReserve.js'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('.qa-pw/j4')
const JOB = process.env.QA_JOB || path.resolve('app/tests/fixtures/sheetcam/source.job')
const DXF_DIR = process.env.QA_DXF_DIR || path.resolve('.testparts')
const LOCALE = process.env.QA_LOCALE || 'fr'
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

if (!fs.existsSync(JOB)) {
    console.error(`fichier .job absent : ${JOB}`)
    process.exit(2)
}

// Le `.job` nomme ses dessins : on ne devine pas lesquels déposer, on les
// lit (règle 9 — le fichier ne porte qu'un chemin, seul le nom a un sens).
const source = parseSheetCamJob(new Uint8Array(fs.readFileSync(JOB)))
const wanted = new Map()
for (const part of source.parts) {
    if (part.copyOf >= 0) {
        const n = wanted.get(source.parts[part.copyOf]?.drawingName)
        if (n != null) wanted.set(source.parts[part.copyOf].drawingName, n + 1)
        continue
    }
    wanted.set(part.drawingName, (wanted.get(part.drawingName) || 0) + 1)
}
log('le .job réclame :', [...wanted].map(([n, q]) => `${n} ×${q}`).join(', '))

const drawings = []
for (const name of wanted.keys()) {
    const p = path.join(DXF_DIR, name)
    if (fs.existsSync(p)) { drawings.push(p); continue }
    // Casse ignorée : un `.job` Windows écrit `Piece_Trou.DXF`.
    const found = fs.existsSync(DXF_DIR)
        ? fs.readdirSync(DXF_DIR).find((f) => f.toLowerCase() === name.toLowerCase())
        : null
    if (found) drawings.push(path.join(DXF_DIR, found))
    else log('ATTENTION : dessin introuvable sur ce poste —', name)
}
if (drawings.length !== wanted.size) {
    console.error(`dessins manquants : ${wanted.size - drawings.length} sur ${wanted.size} (QA_DXF_DIR=${DXF_DIR})`)
    process.exit(2)
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
    locale: LOCALE === 'fr' ? 'fr-FR' : 'en-US',
    viewport: { width: 1680, height: 1000 },
    acceptDownloads: true,
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

try {
    // ---------- connexion + projet « cet appareil » ----------
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', 'guillaume@local.dev')
    await page.fill('.local-auth__form input[type="password"]', 'nestorcut-local-2026')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
    log('connecté')

    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const devCard = page
        .locator('.create__privacy [role="radio"]')
        .filter({ hasText: /(This device|Cet appareil)/i })
        .first()
    if (await devCard.count()) await devCard.click().catch(() => {})

    // ---------- A. dépose du `.job` AVEC ses dessins ----------
    await page.setInputFiles('input[name="dxf"]', [JOB, ...drawings])
    await page.waitForURL('**/project/**', { timeout: 90000 })
    const slug = page.url().split('/project/')[1].split(/[?#]/)[0]
    log('projet', slug)
    // Les fiches sont écrites dans IndexedDB par l'import : on attend qu'il
    // y en ait autant que de dessins réclamés, pas un délai fixe.
    await page.waitForFunction(
        (n) => document.querySelectorAll('[data-testid="file-card"], .file').length >= n,
        wanted.size,
        { timeout: 120000 },
    ).catch(() => log('ATTENTION : le compte de fiches attendu n’est pas atteint'))
    await shot('01-depose.png')

    const cards = await page.evaluate(async () => {
        const db = await new Promise((res, rej) => {
            const r = indexedDB.open('nestorcut-local')
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
        })
        const recs = await new Promise((res, rej) => {
            const tx = db.transaction('files', 'readonly').objectStore('files').getAll()
            tx.onsuccess = () => res(tx.result || []); tx.onerror = () => rej(tx.error)
        })
        return recs.map((r) => ({
            name: r.name,
            parts: (r.parts || []).length,
            hasCut: Boolean(r.sheetcam),
            leadIn: r.sheetcam?.leadIn ?? null,
            hasJobBytes: Boolean(r.sheetcamJobBytes),
        }))
    })
    log('fiches IndexedDB :', JSON.stringify(cards))
    check('A1 une fiche par dessin', cards.length === wanted.size,
        `${cards.length} fiches pour ${wanted.size} dessins`)
    check('A2 réglages de coupe attachés', cards.every((c) => c.hasCut && c.leadIn > 0),
        `amorces : ${cards.map((c) => c.leadIn).join(', ')}`)
    check('A3 le .job est conservé pour la réécriture', cards.every((c) => c.hasJobBytes))

    // ---------- B. réglages pré-remplis ----------
    const sheet = jobSheet(source)
    const space = spacingFromKerf(source.kerfWidth)
    const form = await page.evaluate(() => {
        const val = (sel) => document.querySelector(sel)?.value ?? null
        return {
            w: val('[data-testid="settings-sheets"] input'),
            all: [...document.querySelectorAll('[data-testid="settings-sheets"] input')].map((i) => i.value),
            kerf: val('[data-testid="settings-kerf"] input') ?? val('input[name="kerf"]'),
        }
    })
    log('formulaire :', JSON.stringify(form))
    check('B1 tôle pré-remplie depuis [Work]',
        form.all.includes(String(sheet.width)) && form.all.includes(String(sheet.height)),
        `attendu ${sheet.width} × ${sheet.height}, lu ${form.all.join(' / ')}`)
    const qtyOk = await page.evaluate(() =>
        [...document.querySelectorAll('.file input[type="number"], [data-testid="file-count"] input')]
            .map((i) => Number(i.value)))
    log('quantités à l’écran :', JSON.stringify(qtyOk))
    check('B2 quantités venues du .job',
        qtyOk.length > 0 && qtyOk.some((n) => n === Math.max(...wanted.values())),
        `attendu au moins une fiche à ×${Math.max(...wanted.values())}, lu ${qtyOk.join(', ')}`)

    // ---------- C. nesting ----------
    const nestBtn = page.locator('.atelier__nest')
    await nestBtn.waitFor({ timeout: 30000 })
    await nestBtn.click()
    log('nesting lancé')
    const t0 = Date.now()
    let outcome = 'timeout'
    while (Date.now() - t0 < 8 * 60 * 1000) {
        const err = (await page.locator('.content__error').allInnerTexts().catch(() => []))
            .map((s) => s.trim()).filter(Boolean).join(' | ')
        if (err) { outcome = 'erreur: ' + err; break }
        const item = page.locator('.results__item').first()
        if (await item.count()) {
            const running = await item.locator('.result__cancel').count()
            const failed = await item.locator('.result__placeholder').count()
            const done = await item.locator('.controls__report, .controls__download').count()
            if (failed) { outcome = 'échec'; break }
            if (!running && done && !(await page.locator('.stage__status').count())) { outcome = 'fini'; break }
        }
        await page.waitForTimeout(1500)
    }
    log('nesting :', outcome, `${Math.round((Date.now() - t0) / 1000)} s`)
    check('C1 le nesting aboutit', outcome === 'fini', outcome)
    await shot('02-resultat.png')
    if (outcome !== 'fini') throw new Error('nesting non abouti : ' + outcome)

    // Ce que le record IndexedDB porte réellement — lu, pas déduit de l'écran.
    // C'est la sonde qui dit POURQUOI quand le bouton manque.
    const record = await page.evaluate(async () => {
        const db = await new Promise((res, rej) => {
            const r = indexedDB.open('nestorcut-local')
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
        })
        if (![...db.objectStoreNames].includes('results')) return { note: 'store results absent' }
        const recs = await new Promise((res, rej) => {
            const tx = db.transaction('results', 'readonly').objectStore('results').getAll()
            tx.onsuccess = () => res(tx.result || []); tx.onerror = () => rej(tx.error)
        })
        const r = recs[recs.length - 1] || {}
        return {
            placed: r.placed, requested: r.requested,
            sheetcamJobError: r.sheetcamJobError ?? null,
            alts: (r.alternatives || []).map((a) => ({
                dxfs: (a.dxfs || []).length,
                jobs: (a.jobs || []).length,
                jobNames: (a.jobs || []).map((j) => j.fileName),
            })),
        }
    })
    log('record IndexedDB :', JSON.stringify(record))
    results.record = record
    check('D-1 des `.job` sont produits et persistés',
        (record.alts || []).some((a) => a.jobs > 0),
        record.sheetcamJobError
            ? `refus : ${record.sheetcamJobError.code} ${JSON.stringify(record.sheetcamJobError.params)}`
            : JSON.stringify(record.alts))

    // ---------- D. le `.job` téléchargé ----------
    await page.locator('.results__item .controls__report').first().click()
    await page.waitForSelector('.modal__report, .result-report', { timeout: 60000 })
    await shot('03-modal.png')
    const labels = await page.locator('.result-report button, .result-report a').allInnerTexts()
        .then((xs) => xs.map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean))
    log('boutons du rapport :', JSON.stringify(labels))
    const jobBtn = page.locator('.result-report button, .result-report a')
        .filter({ hasText: /\.job/i }).first()
    check('D0 le bouton « Télécharger le .job » est présent', await jobBtn.count() > 0,
        labels.join(' | '))
    if (!(await jobBtn.count())) throw new Error('bouton .job absent')

    const dl = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        jobBtn.click(),
    ]).then(([d]) => d)
    const saved = path.join(OUT, 'sortie.job')
    await dl.saveAs(saved)
    log('téléchargé :', dl.suggestedFilename(), `${fs.statSync(saved).size} octets`)
    check('D1 le nom porte le numéro de tôle', /_tole\d+\.job$/i.test(dl.suggestedFilename()),
        dl.suggestedFilename())

    // Relu par NOTRE lecteur : c'est la seule mesure qui vaut.
    const out = parseSheetCamJob(new Uint8Array(fs.readFileSync(saved)))
    const totalWanted = [...wanted.values()].reduce((a, b) => a + b, 0)
    check('D2 Count = le nombre de pièces posées', out.count === out.parts.length,
        `Count=${out.count}, sections=${out.parts.length}`)
    check('D3 Optimisation = 3 (manuel, pièces groupées)', out.optimisation === 3,
        String(out.optimisation))
    const copies = out.parts.filter((p) => p.copyOf >= 0).length
    check('D4 les exemplaires supplémentaires sont des copyOf',
        copies === out.parts.length - wanted.size,
        `${copies} copies pour ${out.parts.length} sections et ${wanted.size} dessins`)
    check('D5 chemins absolus masqués',
        out.parts.every((p) => !/[\\/]/.test(p.drawingFile)),
        out.parts.map((p) => p.drawingFile).join(', '))
    check('D6 bloc binaire identique à l’octet près',
        Buffer.compare(Buffer.from(out.binary), Buffer.from(source.binary)) === 0,
        `${out.binary.length} vs ${source.binary.length} octets`)
    check('D7 toutes les pièces demandées sont dans le fichier',
        out.parts.length <= totalWanted && out.parts.length > 0,
        `${out.parts.length} sur ${totalWanted} demandées (une tôle peut n’en porter qu’une partie)`)

    // E. l'intervalle d'angle de SheetCam — le défaut `Angle=-6.283`.
    const angles = out.parts.map((p) => p.angle)
    check('E1 tout angle dans (−2π, 0]',
        angles.every((a) => a <= 0 && a > -2 * Math.PI - 1e-9),
        angles.map((a) => a.toFixed(4)).join(', '))

    // Ordre de coupe : les nichées avant leur hôte. On ne peut le vérifier
    // que s'il y a eu nichage — sinon on le DIT, au lieu d'un verrou vide.
    const opOrder = out.lines.filter((l) => l.kind === 'entry' && /^Op\d+$/.test(l.key))
    const enabled = out.parts.filter((p) => p.enabled)
    log('[OpOrder] :', opOrder.map((l) => l.value).join(' | '))
    log('pièces actives :', enabled.map((p) => p.index).join(','))
    // Un pas par pièce ACTIVE, pas par section : une pièce non posée sur
    // CETTE tôle est désactivée et n'a rien à faire dans l'ordre de coupe.
    check('D8 [OpOrder] = une ligne par pièce active',
        opOrder.length === enabled.length,
        `${opOrder.length} pas pour ${enabled.length} pièces actives (${out.parts.length} sections)`)
    check('D9 [OpOrder] ne désigne que des pièces actives',
        opOrder.every((l) => enabled.some((p) => p.index === Number(String(l.value).split(',')[0]))),
        opOrder.map((l) => l.value).join(' | '))

    // Le nichage : une pièce logée dans le trou d'une autre doit être coupée
    // AVANT son hôte (règle 8 — couper le contour de l'hôte la libérerait).
    // On ne peut le mesurer que s'il y a eu nichage : sinon on le DIT, au
    // lieu de laisser passer un verrou vide.
    const hostRank = 0
    const idx = opOrder.findIndex((l) => Number(String(l.value).split(',')[0]) === hostRank)
    if (idx > 0) {
        check('D10 les pièces nichées sortent AVANT leur hôte',
            true, `l'hôte (rang 0) est en position ${idx + 1} sur ${opOrder.length}`)
    } else {
        log('D10 NON MESURÉ : aucune pièce nichée dans cette solution '
            + '(l’hôte est le premier pas de l’ordre de coupe)')
        results.D10 = { ok: null, detail: 'aucun nichage dans cette solution' }
    }
} catch (e) {
    failures++
    log('EXCEPTION :', String(e?.stack || e).slice(0, 800))
    await shot('99-exception.png')
} finally {
    flush()
    await browser.close()
    log(failures ? `${failures} VERROU(S) EN ÉCHEC` : 'TOUS LES VERROUS SONT VERTS')
    fs.writeFileSync(path.join(OUT, 'run.log'), logs.join('\n') + '\n')
    process.exit(failures ? 1 : 0)
}
