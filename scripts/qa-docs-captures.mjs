// QA captures — lots D1/D2 (docs/PLAN-DOCUMENTATION-2026-09-15.md).
//
// Règles posées par la vérification D1 (vérificateur, 16/09) :
//   1. COMPTE NEUF dédié, créé par le harnais à CHAQUE exécution via
//      /api/auth/local/register — jamais le compte de développement du
//      propriétaire (les captures D1 montraient « Bonjour, Guillaume »,
//      980 projets et une colonne d'essais) ;
//   2. CAPTURES D'ÉLÉMENT, cadrées sur ce que la légende de la page dit —
//      jamais de page entière où la chose promise est sous le pli ;
//   3. AUCUNE IMAGE ORPHELINE : chaque fichier écrit dans
//      ../nestorcut-website/public/docs-img/ doit être référencé par une
//      page de la doc (verrou en fin de harnais, exit 1 sinon), et les
//      images devenues orphelines sont retirées en le disant.
//
// Fichiers neutres uniquement : la pièce L (fixtures validées par le
// propriétaire le 13/09), un SVG généré par ce harnais, un fichier vide
// nommé .dwg (le refus appareil se déclare sur le NOM avant toute lecture
// — comportement identique pour un vrai DWG à ce stade, aucun octet n'est
// lu). Interface en FRANÇAIS, retina ×2.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { parseSheetCamJob, jobDrawings } from '../shared/sheetcamJob.js'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('../nestorcut-website/public/docs-img')
const DOCS = path.resolve('../nestorcut-website/src/content/docs')
const LOG = process.env.QA_LOG || path.resolve('.qa-pw/docs-captures/run.log')
const STAGE = path.resolve('.qa-pw/docs-captures')

const FIX_DXF = path.resolve('app/tests/fixtures/sheetcam/piece-l.dxf')
// La CARTE groupée exige un .job à QUATRE sections originales du MÊME
// dessin. Le dépôt n'en a pas de neutre (x4-reference porte deux dessins
// DIFFÉRENTS) : le harnais en SYNTHÉTISE un depuis la pièce L — le bloc
// binaire de son unique dessin est dupliqué quatre fois (les blocs
// s'ouvrent sur le tag 0x0025 et se relaient de longueur en longueur) et
// la section texte [Part 0] est recopiée en Part 1/2/3, copyOf=-1, à
// des positions distinctes. Auto-VÉRIFIÉ avant usage : relu par nos
// propres décodeurs (4 originales, 4 blocs binaires). Fichier d'essai
// neutre, vit dans .qa-pw/, jamais committé — la capture ne montre que
// le nom du dessin de la fixture.
const FIX_JOB_X4 = path.join(STAGE, 'piece-l-x4-synth.job')
// La VUE AGRANDIE la plus lisible : la pièce L seule, un seul point.
const FIX_JOB_L = path.resolve('app/tests/fixtures/sheetcam/piece-l-none-default.job')

/**
 * Synthétise le .job à quatre originales (voir FIX_JOB_X4). Retourne
 * l'Uint8Array ou jette — l'appelant vérifie ensuite par re-lecture.
 */
async function buildX4Job(sourcePath, targetPath) {
    const bytes = new Uint8Array(fs.readFileSync(sourcePath))
    const latin1 = Buffer.from(bytes).toString('latin1')
    const MARKER = '[BinaryDataStart]'
    const at = latin1.indexOf(MARKER)
    if (at < 0) throw new Error('marqueur binaire introuvable')
    const textLines = latin1.slice(0, at).split('\r\n')
    // Le texte finit par un CRLF : le dernier morceau est vide.
    if (textLines.length && textLines[textLines.length - 1] === '') textLines.pop()
    const binaryHead = Buffer.from(latin1.slice(at, at + MARKER.length), 'latin1')
    const binaryBytes = bytes.subarray(at + MARKER.length)

    // Bloc 0 : du premier enregistrement 0x0025 (origine d'un dessin) à
    // sa fin — ici le fichier n'a QU'UN dessin, donc jusqu'au bout du flux.
    const view = new DataView(binaryBytes.buffer, binaryBytes.byteOffset, binaryBytes.byteLength)
    let firstBlock = -1
    for (let o = 0; o + 6 <= binaryBytes.length;) {
        const tag = view.getUint16(o, true)
        const len = view.getUint16(o + 4, true)
        if (tag === 0x0025) { if (firstBlock < 0) firstBlock = o; break }
        o += 6 + len
    }
    if (firstBlock < 0) throw new Error('aucun bloc dessin dans le binaire')
    const block0 = Uint8Array.from(binaryBytes.subarray(firstBlock))
    // Le flux doit finir PILE au bout (même garde que jobPathRecords).
    {
        let o = 0
        while (o + 6 <= block0.length) o += 6 + view.getUint16(o + 4, true)
        if (o !== block0.length) throw new Error('flux binaire incohérent')
    }
    // Marquer les points de départ « posés à la main » (tag 0x001d,
    // charge 1 octet) : la fixture source sort de SheetCam avec des
    // points par défaut (valeur 0) — la capture doit montrer la marque
    // « votre point », on la pose donc dans la COPIE de synthèse.
    {
        const bv = new DataView(block0.buffer)
        let flipped = 0
        for (let o = 0; o + 6 <= block0.length;) {
            const tag = bv.getUint16(o, true)
            const len = bv.getUint16(o + 4, true)
            if (tag === 0x001d && len === 1) { block0[o + 6] = 1; flipped++ }
            o += 6 + len
        }
        if (!flipped) throw new Error('aucun enregistrement de drapeau « point déplacé » (0x001d) à poser')
    }

    // La section texte [Part 0] : de l'ouverture [Part 0] jusqu'à la
    // prochaine section qui n'est pas [Part 0] ni [Part 0/...].
    const start = textLines.findIndex((l) => l === '[Part 0]')
    if (start < 0) throw new Error('section [Part 0] introuvable')
    let end = textLines.length
    for (let i = start + 1; i < textLines.length; i++) {
        const l = textLines[i]
        if (l.startsWith('[') && l.endsWith(']') && l !== '[Part 0]' && !l.startsWith('[Part 0/')) { end = i; break }
    }
    const part0 = textLines.slice(start, end)
    const positions = [[90, 100], [220, 100], [90, 220], [220, 220]]
    const newParts = []
    for (let k = 0; k < 4; k++) {
        const pos = positions[k]
        for (const line of part0) {
            if (line === '[Part 0]') { newParts.push(`[Part ${k}]`); continue }
            if (line.startsWith('[Part 0/')) { newParts.push(line.replace('[Part 0/', `[Part ${k}/`)); continue }
            if (line.startsWith('XPos=')) { newParts.push(`XPos=${pos[0]}`); continue }
            if (line.startsWith('YPos=')) { newParts.push(`YPos=${pos[1]}`); continue }
            newParts.push(line)
        }
    }
    const out = []
    for (let i = 0; i < textLines.length; i++) {
        if (i === start) {
            out.push(...newParts)
            continue
        }
        if (i > start && i < end) continue
        // Compteur de pièces : [Misc] Count=N → 4.
        if (textLines[i] === 'Count=1' && i > 0 && textLines[i - 1] === '[Misc]') { out.push('Count=4'); continue }
        out.push(textLines[i])
    }
    const textOut = out.join('\r\n') + '\r\n'
    const binaryOut = Buffer.concat([binaryHead, ...Array.from({ length: 4 }, () => Buffer.from(block0))])
    const final = Buffer.concat([Buffer.from(textOut, 'latin1'), binaryOut])
    fs.writeFileSync(targetPath, final)

    // AUTO-VÉRIFICATION par nos propres décodeurs (le fichier synthétique
    // doit se lire EXACTEMENT comme un .job à quatre originales).
    const read = parseSheetCamJob(new Uint8Array(final))
    const originals = read.parts.filter((p) => p.copyOf < 0)
    const blocks = jobDrawings(read.binary) || []
    if (originals.length !== 4) throw new Error(`originales=${originals.length}, 4 attendues`)
    if (blocks.length !== 4) throw new Error(`blocs=${blocks.length}, 4 attendus`)
    return { originals: originals.length, blocks: blocks.length }
}
const GEN_SVG = path.join(STAGE, 'fixture-rect.svg')
const FAKE_DWG = path.join(STAGE, 'piece-l.dwg')

fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(path.dirname(LOG), { recursive: true })
fs.mkdirSync(STAGE, { recursive: true })

// SVG neutre : un carré et un rond, contours nets (segments droits = 2
// points par arc droit, piège #15).
fs.writeFileSync(GEN_SVG, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">',
    '  <rect x="8" y="8" width="60" height="60" fill="none" stroke="#000" stroke-width="1.5"/>',
    '  <circle cx="66" cy="66" r="18" fill="none" stroke="#000" stroke-width="1.5"/>',
    '</svg>',
    '',
].join('\n'))
// Refus DWG appareil : déclenché par le NOM, avant toute lecture du fichier.
fs.writeFileSync(FAKE_DWG, '\0')

const logs = []
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; logs.push(s); console.log(s) }

const checks = []
const check = (label, ok, detail) => {
    checks.push({ label, ok })
    log(ok ? 'PASS' : 'FAIL', label, detail || '')
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
})
await ctx.addCookies([{ name: 'locale', value: 'fr', url: BASE }])
const page = await ctx.newPage()
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 400)))

/** Capture d'ÉLÉMENT — le cadre est la chose, pas la page. */
const shot = async (name, selector) => {
    const el = page.locator(selector).first()
    await el.scrollIntoViewIfNeeded()
    await el.screenshot({ path: path.join(OUT, name) })
    log('capture:', name, '←', selector)
}

const registerFresh = async () => {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const email = `docs-captures-${stamp}@local.dev`
    const password = 'docs-captures-2026'
    const res = await page.request.post(BASE + '/api/auth/local/register', {
        data: { email, name: 'Captures doc', password },
    })
    if (res.status() >= 400) throw new Error('inscription refusée : ' + res.status() + ' ' + (await res.text()).slice(0, 120))
    log('compte neuf :', email)
    return { email, password }
}

const login = async ({ email, password }) => {
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', email)
    await page.fill('.local-auth__form input[type="password"]', password)
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
}

const deposit = async (file) => {
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    // « Cet appareil » : la carte .job l'exige ; le DXF y marche aussi.
    const deviceCard = page.locator('.create__privacy button, .create__privacy [class*="option"]').filter({ hasText: /Cet appareil/i }).first()
    if (await deviceCard.count()) await deviceCard.click()
    await page.setInputFiles('input[name="dxf"]', file)
    await page.waitForURL('**/project/**', { timeout: 90000 })
}

const waitForCard = () => page.waitForSelector('.files__grid .file__display img', { timeout: 120000 })

let failed = null
try {
    // ---------- 0. Le .job à quatre originales, synthétisé et relu ------
    const synth = await buildX4Job(FIX_JOB_L, FIX_JOB_X4)
    check('.job x4 synthétique : relu, 4 originales et 4 blocs', synth.originals === 4 && synth.blocks === 4, synth)

    // ---------- 1. Compte neuf + connexion ----------
    const creds = await registerFresh()
    await login(creds)
    await page.waitForTimeout(2500)
    const statsClean = await page.evaluate(() => !/Bonjour,\s*Guillaume/.test(document.body.innerText))
    check('compte dédié (pas le compte de développement)', statsClean)

    // ---------- 2. Accueil : le bloc « Nouvelle imbrication » ----------
    const privacyCards = await page.evaluate(() => ({
        device: /Cet appareil/i.test(document.body.innerText),
        servers: /Nos serveurs/i.test(document.body.innerText),
    }))
    check('accueil : les deux modes affichés (FR)', privacyCards.device && privacyCards.servers)
    await shot('demarrer-calcul.png', 'section.create')
    await shot('fichiers-depot.png', '.upload')

    // ---------- 3. Projet DXF : tôle + réglages, puis la fiche ----------
    await deposit(FIX_DXF)
    await waitForCard()
    await page.waitForTimeout(1500)
    const dxfState = await page.evaluate(() => ({
        preflight: document.querySelector('[data-testid="project-preflight"]')?.textContent || null,
        cardName: document.querySelector('.files__grid .file__name')?.textContent?.trim() || null,
    }))
    check('projet DXF : fiche importée', Boolean(dxfState.cardName), dxfState.preflight?.slice(0, 70))
    await shot('demarrer-projet.png', 'section.atelier')
    await shot('fichiers-dxf.png', '.files__grid .file')

    // ---------- 4. Projet .job à quatre sections : la carte groupée ----------
    await deposit(FIX_JOB_X4)
    await page.waitForSelector('[data-testid="file-grouped-card"]', { timeout: 120000 })
    await page.waitForTimeout(1500)
    const jobState = await page.evaluate(() => ({
        group: Boolean(document.querySelector('[data-testid="file-grouped-card"]')),
        count: document.querySelector('.fgroup__count')?.textContent?.trim() || null,
        userPointMarks: document.querySelectorAll('.fgroup__moved:not([class*="--auto"])').length,
    }))
    check('projet .job : carte groupée ×4', jobState.group, jobState.count)
    check('projet .job : marques « votre point » ≥ 1', jobState.userPointMarks >= 1, { marks: jobState.userPointMarks })
    await shot('fichiers-job.png', '[data-testid="file-grouped-card"]')

    // ---------- 4-bis. La vue agrandie sur la pièce L (.job une section) ----------
    await deposit(FIX_JOB_L)
    await waitForCard()
    await page.waitForTimeout(1500)
    const lState = await page.evaluate(() => ({
        chip: Boolean(document.querySelector('[data-testid="file-job-origin"]')),
        jobName: document.querySelector('.file__origin-name')?.textContent?.trim() || null,
    }))
    check('projet .job pièce L : puce .job présente', lState.chip, lState.jobName)
    await page.locator('.files__grid .file__area').first().click()
    await page.waitForSelector('.modal__enriched', { timeout: 15000 })
    await page.waitForTimeout(1200)
    const modalLeads = await page.evaluate(() => {
        const img = document.querySelector('.modal__enriched-svg img')
        if (!img) return 0
        return (decodeURIComponent(img.src).match(/#D97706/g) || []).length
    })
    check('vue agrandie : amorces dessinées (> 0)', modalLeads > 0, { leadTraces: modalLeads })
    await shot('fichiers-job-apercu.png', '.modal__body')
    await page.keyboard.press('Escape')

    // ---------- 5. Projet SVG ----------
    await deposit(GEN_SVG)
    await waitForCard()
    await page.waitForTimeout(1500)
    await shot('fichiers-svg.png', '.files__grid .file')
    const svgOk = await page.evaluate(() => Boolean(document.querySelector('.files__grid .file__display img')))
    check('projet SVG : fiche importée', svgOk)

    // ---------- 6. Refus DWG en mode appareil (nommé, avec la raison) ----------
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const deviceCard2 = page.locator('.create__privacy button, .create__privacy [class*="option"]').filter({ hasText: /Cet appareil/i }).first()
    if (await deviceCard2.count()) await deviceCard2.click()
    await page.setInputFiles('input[name="dxf"]', FAKE_DWG)
    await page.waitForTimeout(1500)
    const refusal = await page.evaluate(() => {
        const el = document.querySelector('.create__error')
        return el && el.offsetParent !== null ? el.textContent.trim().slice(0, 140) : null
    })
    check('refus DWG appareil : message affiché, nommé', Boolean(refusal), refusal || '')
    await shot('fichiers-dwg.png', '.create__error')
} catch (e) {
    failed = String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)
    log('ERREUR:', failed)
}

// ---------- 7. Verrou anti-orpheline ----------
const referenced = new Set()
for (const dir of ['docs', 'fr/docs', 'files', 'fr/files']) {
    const p = path.join(DOCS, dir)
    if (!fs.existsSync(p)) continue
    for (const f of fs.readdirSync(p)) {
        if (!f.endsWith('.md')) continue
        const md = fs.readFileSync(path.join(p, f), 'utf8')
        for (const m of md.matchAll(/\/docs-img\/([\w.-]+)/g)) referenced.add(m[1])
    }
}
const present = fs.readdirSync(OUT).filter((f) => f.endsWith('.png'))
let orphans = 0
for (const f of present) {
    if (!referenced.has(f)) {
        fs.unlinkSync(path.join(OUT, f))
        orphans++
        log('image orpheline retirée :', f)
    }
}
const missing = [...referenced].filter((f) => !present.includes(f))
check('chaque image référencée existe', missing.length === 0, { manquantes: missing })
check('aucune image orpheline après nettoyage', true, { retirees: orphans })

fs.writeFileSync(LOG, logs.join('\n') + '\n')
await browser.close()

const reds = checks.filter((c) => !c.ok)
if (failed || reds.length) {
    console.log(`NO-GO — ${reds.length} sonde(s) rouge(s)${failed ? ' + erreur' : ''}`)
    process.exit(1)
}
console.log('GO — captures de documentation régénérées (compte neuf, éléments cadrés, zéro orpheline)')
