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
            kerf: val('[data-testid="settings-kerf"] input') ?? val('input[data-testid="settings-kerf"]'),
            safety: val('[data-testid="settings-safety"] input') ?? val('input[data-testid="settings-safety"]'),
            rule: document.querySelector('.size__rule')?.textContent?.trim() ?? null,
        }
    })
    log('formulaire :', JSON.stringify(form))
    check('B1 tôle pré-remplie depuis [Work]',
        form.all.includes(String(sheet.width)) && form.all.includes(String(sheet.height)),
        `attendu ${sheet.width} × ${sheet.height}, lu ${form.all.join(' / ')}`)
    // Lot J4-bis-2 (§9.40) : l'espacement d'un `.job` vaut 2 × kerf +
    // sécurité, sécurité à 1 mm. Sur la recette (kerf 1,5) : 4 mm, et non 2.
    check('B1b kerf et sécurité pré-remplis depuis [Tool0]',
        Number(form.kerf) === Number(source.kerfWidth) && Number(form.safety) === 1,
        `kerf lu ${form.kerf} (attendu ${source.kerfWidth}), sécurité lue ${form.safety} (attendu 1)`)
    check('B1c la règle affichée donne 2 × kerf + sécurité',
        form.rule != null && form.rule.includes(String(space)),
        `règle affichée « ${form.rule} », espacement attendu ${space} mm`)
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
            // Lot J4-bis-2 : les constats de reserve d'amorce, tels que le
            // payload les a produits et que la fiche les a persistes.
            leadInReserve: r.leadInReserve || [],
            alts: (r.alternatives || []).map((a) => ({
                dxfs: (a.dxfs || []).length,
                jobs: (a.jobs || []).length,
                jobNames: (a.jobs || []).map((j) => j.fileName),
            })),
            // D10 : le nichage tel que le POST-PASS l'a etabli, en RANGS
            // `[Part N]` du fichier ecrit. Lu dans le record, pas deduit de
            // l'ordre de coupe — sinon le verrou ne mesurerait que lui-meme.
            // Toutes les alternatives, chacune avec SES paires et SON ordre
            // ecrit : le verrou compare les deux d'un meme fichier.
            jobsAll: (r.alternatives || []).map((a) => (a.jobs || []).map((j) => ({
                fileName: j.fileName,
                nestedPairs: j.nestedPairs || [],
                order: j.order || [],
            }))),
        }
    })
    log('record IndexedDB :', JSON.stringify(record))
    results.record = record

    // C2 — LE VERROU QUI MANQUAIT. Sans lui, un job qui perd une piece
    // passait VERT : l'ancien harnais lisait `placed` et le journalisait,
    // sans jamais le comparer a `requested`. Mesure du verificateur : la
    // recette posait 4 pieces sur 5 et tous les verrous restaient verts.
    const totalWanted = [...wanted.values()].reduce((a, b) => a + b, 0)
    check('C2 autant de pieces posees que demandees',
        record.placed === record.requested,
        `posees ${record.placed}, demandees ${record.requested}`)
    check('C3 le nombre demande est celui du `.job`',
        record.requested === totalWanted,
        `demandees ${record.requested}, somme des quantites du .job ${totalWanted}`)
    // F — LA RESERVE D'AMORCE, LOT J4-bis-2. Elle est desormais posee au
    // POINT DE DEPART LU dans le binaire du `.job`. Ce qu'on verifie ici :
    // qu'elle s'est appliquee sur CE fichier reel, qu'aucun trou n'a ete
    // retire du nesting faute de point lisible, et que le centre de boite
    // que NOUS mesurons est bien celui que SheetCam a memorise — un ecart la
    // ferait tomber a cote des contours en silence.
    const reserve = record.leadInReserve || []
    check('F1 la reserve d`amorce s`est appliquee sur chaque piece du `.job`',
        reserve.length > 0 && reserve.every((n) => n.applied === true),
        JSON.stringify(reserve.map((n) => ({ f: n.file_slug, ok: n.applied, why: n.reason }))))
    // F2 n'exige PAS qu'aucun trou ne sorte du nesting : un `.job` peut
    // legitimement percer la ou l'on nicherait (voir F4). Ce qui ne doit
    // JAMAIS arriver, c'est un trou retire SANS raison nommee — la
    // degradation muette est le defaut que tout ce chantier corrige.
    const allHoles = reserve.flatMap((n) => n.holes || [])
    check('F2 aucun trou retire sans raison nommee',
        allHoles.every((h) => !h.dropped || (typeof h.reason === 'string' && h.reason)),
        JSON.stringify(allHoles))
    // F3 : les orphelins sont COMPTES, et le compte se boucle. Un `.job` peut
    // porter un chemin sans contour chez nous (une entite POINT, par exemple,
    // que notre import ne retient pas) ; ce qui compterait comme un defaut,
    // c'est qu'un point disparaisse du decompte.
    log('points de depart :', JSON.stringify(reserve.map((n) =>
        ({ f: n.file_slug, lus: n.starts, orphelins: n.unmatched, errants: n.strayPierces }))))
    check('F3 le compte des points de depart se boucle',
        reserve.every((n) => Number.isFinite(Number(n.starts))
            && Number(n.unmatched) >= 0 && Number(n.unmatched) <= Number(n.starts)),
        JSON.stringify(reserve.map((n) => ({ lus: n.starts, orphelins: n.unmatched }))))
    // F4 n'est PAS un verrou d'egalite : les deux origines sont differentes et
    // c'est mesure. Le point de depart du binaire est relatif a l'origine que
    // SheetCam memorise pour le dessin ; la pose, elle, tourne autour du
    // centre de la geometrie de COUPE. L'ecart vaut la distance dont une
    // entite ignoree par notre import (un POINT, par exemple) deplace la
    // boite du dessin. On le JOURNALISE, et on verifie que les points
    // atterrissent bien sur les contours (c'est F3 qui le dit).
    log('ecart entre les deux origines (mm) :', JSON.stringify(reserve.map((n) => n.originGapMm)))
    // F4 EST LE VERROU DE SECURITE : tout percage qui tombe dans une zone ou
    // l'on nicherait doit avoir FAIT SORTIR cette zone du nesting. Zero
    // percage errant ⇒ zero trou retire pour cette raison ; un percage
    // errant ⇒ un trou retire, avec `strayPierce` en clair.
    const strays = reserve.reduce((a, n) => a + (Number(n.strayPierces) || 0), 0)
    const droppedForStray = allHoles.filter((h) => h.reason === 'strayPierce').length
    check('F4 tout percage en zone nichee a fait sortir sa zone',
        strays === 0 ? droppedForStray === 0 : droppedForStray >= 1,
        `percages errants ${strays}, trous retires pour cette raison ${droppedForStray}`)

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
    // D7 ne compte PAS les pièces : le cas A4 dépose volontairement une
    // seconde fois, et une tôle peut de toute façon n'en porter qu'une partie.
    // Ce qui doit être vrai quoi qu'il arrive : aucune section écrite qui ne
    // vienne d'un dessin du `.job` (on ne peut pas inventer une pièce, règle 5),
    // et `Count` cohérent avec le nombre de sections.
    const known = new Set(source.parts.map((p) => p.drawingName))
    check('D7 aucune pièce écrite qui ne vienne du `.job`',
        out.parts.length > 0 && out.parts.every((p) => known.has(p.drawingName)),
        `${out.parts.length} sections, dessins : ${[...new Set(out.parts.map((p) => p.drawingName))].join(', ')}`)
    check('D7b Count est cohérent avec le nombre de sections',
        out.count === out.parts.length, `Count=${out.count}, sections=${out.parts.length}`)

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

    // D10 — le nichage, mesuré sur ce que le post-pass a ÉTABLI (les paires
    // `[nichée, hôte]`) contre l'ordre de coupe ÉCRIT DANS LE MÊME FICHIER.
    // Un résultat porte plusieurs alternatives : comparer les paires de l'une
    // à l'ordre de l'autre ne mesurerait rien. On balaie donc TOUS les
    // fichiers produits — la propriété doit tenir sur chacun.
    {
        const files = (record.jobsAll || []).flat()
        const withNesting = files.filter((f) => (f.nestedPairs || []).length)
        if (withNesting.length) {
            const bad = []
            for (const f of withNesting) {
                const pos = new Map((f.order || []).map((rank, i) => [rank, i]))
                for (const [n, h] of f.nestedPairs) {
                    if (!(pos.get(n) < pos.get(h))) bad.push({ file: f.fileName, n, h, order: f.order })
                }
            }
            check('D10 chaque pièce nichée est coupée AVANT SON hôte',
                bad.length === 0,
                `${withNesting.length} fichier(s) avec nichage, `
                + `${withNesting.reduce((k, f) => k + f.nestedPairs.length, 0)} paire(s)`
                + (bad.length ? ` — fautifs : ${JSON.stringify(bad)}` : ''))
        } else {
            log('D10 NON MESURÉ : aucune pièce nichée dans aucune alternative')
            results.D10 = { ok: null, detail: 'aucun nichage' }
        }
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
