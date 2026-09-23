// QA captures — lots D1/D2/D3 (docs/PLAN-DOCUMENTATION-2026-09-15.md).
//
// Règles posées par les vérifications D1 et D2 :
//   1. COMPTE NEUF dédié, créé par le harnais à CHAQUE exécution via
//      /api/auth/local/register — jamais le compte de développement ;
//   2. CAPTURES D'ÉLÉMENT, cadrées sur ce que la légende de la page dit ;
//   3. AUCUNE IMAGE ORPHELINE (verrou en fin de harnais, exit 1 sinon) ;
//   4. UNE CAPTURE PAR LANGUE (vérification D2, point 9) : le harnais
//      tourne en DEUX PASSES — cookie français puis anglais — écrit deux
//      jeux dans docs-img/fr/ et docs-img/en/, chaque page référence le
//      jeu de sa langue, le verrou compte les DEUX jeux, et une sonde
//      vérifie la langue du texte rendu AU MOMENT DE LA PRISE.
//
// Fichiers neutres uniquement : la pièce L (fixtures du propriétaire),
// un SVG généré, un .job à quatre originales SYNTHÉTISÉ depuis la pièce
// L (bloc binaire dupliqué, re-lu par nos décodeurs avant usage), un
// fichier vide nommé .dwg (le refus appareil se déclare sur le NOM
// avant toute lecture). Retina ×2. Journal dans .qa-pw/.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { parseSheetCamJob, jobDrawings } from '../shared/sheetcamJob.js'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const SITE = path.resolve('../nestorcut-website')
const IMG = path.join(SITE, 'public/docs-img')
const DOCS = path.join(SITE, 'src/content/docs')
const LOG = process.env.QA_LOG || path.resolve('.qa-pw/docs-captures/run.log')
const STAGE = path.resolve('.qa-pw/docs-captures')

const FIX_DXF = path.resolve('app/tests/fixtures/sheetcam/piece-l.dxf')
const FIX_JOB_X4 = path.join(STAGE, 'piece-l-x4.job')
const FIX_JOB_L = path.resolve('app/tests/fixtures/sheetcam/piece-l-none-default.job')
const GEN_SVG = path.join(STAGE, 'fixture-rect.svg')
const FAKE_DWG = path.join(STAGE, 'piece-l.dwg')

fs.mkdirSync(LOG.replace(/run\.log$/, ''), { recursive: true })
fs.mkdirSync(STAGE, { recursive: true })

fs.writeFileSync(GEN_SVG, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">',
    '  <rect x="8" y="8" width="60" height="60" fill="none" stroke="#000" stroke-width="1.5"/>',
    '  <circle cx="66" cy="66" r="18" fill="none" stroke="#000" stroke-width="1.5"/>',
    '</svg>',
    '',
].join('\n'))
fs.writeFileSync(FAKE_DWG, '\0')

const logs = []
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; logs.push(s); console.log(s) }
const checks = []
const check = (pass, label, ok, detail) => {
    checks.push({ pass, label, ok })
    log(ok ? 'PASS' : 'FAIL', `[${pass}]`, label, detail === undefined ? '' : JSON.stringify(detail))
}

/** Synthétise le .job à quatre originales depuis la pièce L (voir
 *  FIX_JOB_X4) — auto-vérifié par re-lecture, jette sinon. */
function buildX4Job(sourcePath, targetPath) {
    const bytes = new Uint8Array(fs.readFileSync(sourcePath))
    const latin1 = Buffer.from(bytes).toString('latin1')
    const MARKER = '[BinaryDataStart]'
    const at = latin1.indexOf(MARKER)
    if (at < 0) throw new Error('marqueur binaire introuvable')
    const textLines = latin1.slice(0, at).split('\r\n')
    if (textLines.length && textLines[textLines.length - 1] === '') textLines.pop()
    const binaryHead = Buffer.from(latin1.slice(at, at + MARKER.length), 'latin1')
    const binaryBytes = bytes.subarray(at + MARKER.length)

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
    {
        let o = 0
        while (o + 6 <= block0.length) o += 6 + new DataView(block0.buffer).getUint16(o + 4, true)
        if (o !== block0.length) throw new Error('flux binaire incohérent')
    }
    {
        const bv = new DataView(block0.buffer)
        let flipped = 0
        for (let o = 0; o + 6 <= block0.length;) {
            const tag = bv.getUint16(o, true)
            const len = bv.getUint16(o + 4, true)
            if (tag === 0x001d && len === 1) { block0[o + 6] = 1; flipped++ }
            o += 6 + len
        }
        if (!flipped) throw new Error('aucun drapeau 0x001d à poser')
    }

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
        if (i === start) { out.push(...newParts); continue }
        if (i > start && i < end) continue
        if (textLines[i] === 'Count=1' && i > 0 && textLines[i - 1] === '[Misc]') { out.push('Count=4'); continue }
        out.push(textLines[i])
    }
    const final = Buffer.concat([
        Buffer.from(out.join('\r\n') + '\r\n', 'latin1'),
        binaryHead,
        ...Array.from({ length: 4 }, () => Buffer.from(block0)),
    ])
    fs.writeFileSync(targetPath, final)
    const read = parseSheetCamJob(new Uint8Array(final))
    const originals = read.parts.filter((p) => p.copyOf < 0)
    const blocks = jobDrawings(read.binary) || []
    if (originals.length !== 4) throw new Error(`originales=${originals.length}`)
    if (blocks.length !== 4) throw new Error(`blocs=${blocks.length}`)
    return { originals: originals.length, blocks: blocks.length }
}

/** Le compte DÉDIÉ aux captures (vérification D1 : « créé par le harnais
 *  via /api/auth/local/register s'il n'existe pas — jamais le compte de
 *  développement »). PERSISTANT : l'inscription est limitée à 5/heure par
 *  IP (anti-brute-force), un compte neuf à chaque exécution est donc
 *  impossible — et l'historique n'apparaît nulle part puisque CHAQUE
 *  capture est cadrée sur son élément (jamais la colonne des projets).
 *  PRÉPARATION UNIQUE en dev : créer via ce harnais, vérifier l'email
 *  en base (db.users.updateOne({email}, {$set: {emailVerified: true}})) —
 *  en base, et REMETTRE le compteur gratuit quand il est épuisé (chaque
 *  passe consomme un nesting ; l'offre est de 10/mois — les captures
 *  doivent montrer l'état GRATUIT, jamais un grant de tier qui retirerait
 *  les cadenas) : db.users.updateOne({email}, {$set: {freeNestingUsed: 0}}), et purger les jobs
 *  orphelins awaiting_local (une passe interrompue en laisse un, il
 *  bloque le compte en 409 concurrent_limit) :
 *  db.nesting_jobs.deleteMany({ownerId: 'local:docs-captures@local.dev',
 *  status: {$in: ['pending','processing','awaiting_local']}}). */
const ACCOUNT = { email: 'docs-captures@local.dev', password: 'docs-captures-2026' }
const ensureAccount = async (request) => {
    const res = await request.post(BASE + '/api/auth/local/register', {
        data: { email: ACCOUNT.email, name: 'Captures doc', password: ACCOUNT.password },
    })
    if (res.status === 409) { log('compte dédié déjà présent :', ACCOUNT.email); return ACCOUNT }
    if (res.status >= 400) throw new Error('inscription du compte dédié refusée : ' + res.status())
    log('compte dédié créé :', ACCOUNT.email)
    return ACCOUNT
}

/** Une passe COMPLÈTE de captures dans une langue. */
async function runPass(browser, pass, creds) {
    const OUT = path.join(IMG, pass)
    fs.mkdirSync(OUT, { recursive: true })
    // Textes attendus DANS LA LANGUE DE LA PASSE (sonde au moment de la
    // prise — vérification D2, point 9). Paquet C : pt ajouté.
    const T = pass === 'fr'
        ? { device: /Cet appareil/i, servers: /Nos serveurs/i, yourPoint: /votre point/i, spacing: 'Espacement', directions: 'Sens', computing: /calcul/i }
        : pass === 'pt'
        ? { device: /Este dispositivo/i, servers: /Nossos servidores/i, yourPoint: /seu ponto/i, spacing: 'Espaçamento', directions: 'Direções', computing: /Processando/i }
        : pass === 'it'
        ? { device: /Questo dispositivo/i, servers: /I nostri server/i, yourPoint: /il tuo punto/i, spacing: 'Distanza', directions: 'Direzioni', computing: /Calcolo|nesting/i }
        : pass === 'es'
        ? { device: /Este dispositivo/i, servers: /Nuestros servidores/i, yourPoint: /tu punto/i, spacing: 'Separación', directions: 'Direcciones', computing: /Calculando|Nesting/i }
        : pass === 'de'
        ? { device: /Dieses Gerät/i, servers: /Unsere Server/i, yourPoint: /Ihr Punkt/i, spacing: 'Abstand', directions: 'Richtungen', computing: /Berechnung|Nesting/i }
        : { device: /This device/i, servers: /Our servers/i, yourPoint: /your point/i, spacing: 'Spacing', directions: 'Layout directions', computing: /computing|nesting/i }

    const ctx = await browser.newContext({
        locale: pass === 'fr' ? 'fr-FR' : pass === 'pt' ? 'pt-BR' : pass === 'it' ? 'it-IT' : pass === 'de' ? 'de-DE' : pass === 'es' ? 'es-ES' : 'en-US',
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
    })
    await ctx.addCookies([{ name: 'locale', value: pass, url: BASE }])
    const page = await ctx.newPage()
    page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))

    const shot = async (name, selector) => {
        const el = page.locator(selector).first()
        await el.scrollIntoViewIfNeeded()
        await el.screenshot({ path: path.join(OUT, name) })
        log(`capture [${pass}]:`, name, '←', selector)
    }
    /** Capture d'élément TROUVÉ PAR TEXTE dans un périmètre : la sonde
     *  cherche l'étiquette, remonte au champ, cadre le champ. */
    const shotField = async (name, scopeSelector, label) => {
        const rect = await page.evaluate(([scopeSel, label]) => {
            const scope = document.querySelector(scopeSel)
            if (!scope) return null
            const all = [...scope.querySelectorAll('*')].filter((n) => (n.textContent || '').trim().startsWith(label))
            if (!all.length) return null
            all.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)
            let el = all[0]
            for (let i = 0; i < 3 && el.parentElement; i++) {
                const p = el.parentElement
                if (p.getBoundingClientRect().height > 170) break
                el = p
            }
            const r = el.getBoundingClientRect()
            return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 170) }
        }, [scopeSelector, label])
        if (!rect) throw new Error(`champ "${label}" introuvable dans ${scopeSelector}`)
        await page.screenshot({ path: path.join(OUT, name), clip: rect })
        log(`capture [${pass}]:`, name, `← champ "${label}"`)
    }

    // ---------- connexion ----------
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', creds.email)
    await page.fill('.local-auth__form input[type="password"]', creds.password)
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
    await page.waitForTimeout(2000)

    // ---------- accueil : SONDE DE LANGUE puis bloc création ----------
    const langProbe = await page.evaluate(() => document.body.innerText)
    check(pass, `langue de la passe (${pass}) rendue à l'écran`,
        T.device.test(langProbe) && T.servers.test(langProbe))
    await shot('demarrer-calcul.png', 'section.create')
    await shot('fichiers-depot.png', '.upload')

    // ---------- projet DXF : atelier, réglages, fiche, champs ----------
    const deposit = async (file) => {
        await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
        const deviceCard = page.locator('.create__privacy button, .create__privacy [class*="option"]').filter({ hasText: T.device }).first()
        if (await deviceCard.count()) await deviceCard.click()
        await page.setInputFiles('input[name="dxf"]', file)
        await page.waitForURL('**/project/**', { timeout: 90000 })
    }
    await deposit(FIX_DXF)
    await page.waitForSelector('.files__grid .file__display img', { timeout: 120000 })
    await page.waitForTimeout(1500)
    check(pass, 'projet DXF : fiche importée', true)
    await shot('demarrer-projet.png', 'section.atelier')
    await shot('interface-projet.png', '.atelier__params')
    await shotField('nesting-espacement.png', '.atelier__params', T.spacing)
    await shotField('nesting-sens.png', '.atelier__params', T.directions)
    await shot('fichiers-dxf.png', '.files__grid .file')

    // ---------- le nesting sur CE projet : live puis résultat ----------
    await page.locator('.atelier__nest').scrollIntoViewIfNeeded()
    await page.locator('.atelier__nest').click()
    await page.waitForTimeout(8000)
    await shot('interface-live.png', '.atelier__stage')
    await page.waitForFunction(() => {
        const btn = document.querySelector('.atelier__nest')
        return btn && !/calcul|computing/i.test(btn.textContent || '')
    }, null, { timeout: 300000 }).catch(() => log('attente fin nesting expirée — on tente le résultat'))
    await page.waitForTimeout(6000)
    await page.locator('.results__item').first().scrollIntoViewIfNeeded()
    await page.locator('.results__item').first().click()
    await page.waitForSelector('[data-testid="result-space"]', { timeout: 20000 })
    await page.waitForTimeout(3500)
    check(pass, 'résultat ouvert', true)
    await shot('interface-resultat.png', '[data-testid="result-space"]')
    await shot('resultats-rapport.png', '.result-space__report')
    await page.evaluate(() => { const t = document.querySelector('[data-testid="report-tech"]'); if (t) t.open = true })
    await shot('nesting-badges.png', '[data-testid="report-badges"]')
    await shot('resultats-exports.png', '[data-testid="report-actions"]')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    // ---------- projet .job x4 : la carte groupée ----------
    await deposit(FIX_JOB_X4)
    await page.waitForSelector('[data-testid="file-grouped-card"]', { timeout: 120000 })
    await page.waitForTimeout(1500)
    const marks = await page.evaluate(() => document.querySelectorAll('.fgroup__moved:not([class*="--auto"])').length)
    check(pass, 'carte groupée ×4, marques du point posé à la main', marks >= 1, { marks })
    await shot('fichiers-job.png', '[data-testid="file-grouped-card"]')

    // ---------- projet .job pièce L : carte, vue agrandie ----------
    await deposit(FIX_JOB_L)
    await page.waitForSelector('.files__grid .file__display img', { timeout: 120000 })
    await page.waitForTimeout(1500)
    await shot('interface-carte.png', '.files__grid .file')
    await page.locator('.files__grid .file__area').first().click()
    await page.waitForSelector('.modal__enriched', { timeout: 15000 })
    await page.waitForTimeout(1200)
    const leads = await page.evaluate(() => {
        const img = document.querySelector('.modal__enriched-svg img')
        return img ? (decodeURIComponent(img.src).match(/#D97706/g) || []).length : 0
    })
    check(pass, 'vue agrandie : amorces dessinées (> 0)', leads > 0, { leads })
    await shot('fichiers-job-apercu.png', '.modal__body')
    await page.keyboard.press('Escape')

    // ---------- SVG ----------
    await deposit(GEN_SVG)
    await page.waitForSelector('.files__grid .file__display img', { timeout: 120000 })
    await page.waitForTimeout(1500)
    await shot('fichiers-svg.png', '.files__grid .file')

    // ---------- refus DWG appareil ----------
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const deviceCard2 = page.locator('.create__privacy button, .create__privacy [class*="option"]').filter({ hasText: T.device }).first()
    if (await deviceCard2.count()) await deviceCard2.click()
    await page.setInputFiles('input[name="dxf"]', FAKE_DWG)
    await page.waitForTimeout(1500)
    const refusal = await page.evaluate(() => {
        const el = document.querySelector('.create__error')
        return el && el.offsetParent !== null
    })
    check(pass, 'refus DWG appareil affiché, nommé', Boolean(refusal))
    await shot('fichiers-dwg.png', '.create__error')

    // ---------- le journal des nouveautés de l'application ----------
    await page.goto(BASE + '/changelog', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2500)
    const cl = await page.evaluate(() => Boolean(document.querySelector('.changelog__title')))
    check(pass, 'journal de l\'application ouvert', cl)
    await shot('nouveautes.png', '.changelog')

    await ctx.close()
}

let failed = null
const browser = await chromium.launch({ headless: true })
try {
    const synth = buildX4Job(FIX_JOB_L, FIX_JOB_X4)
    check('setup', '.job x4 synthétique relu : 4 originales, 4 blocs', synth.originals === 4 && synth.blocks === 4, synth)

    const regCtx = await browser.newContext()
    const creds = await ensureAccount(regCtx.request)
    await regCtx.close()
    await runPass(browser, 'fr', creds)
    await runPass(browser, 'en', creds)
    await runPass(browser, 'pt', creds)
    await runPass(browser, 'it', creds)
    await runPass(browser, 'de', creds)
    await runPass(browser, 'es', creds)
} catch (e) {
    failed = String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)
    log('ERREUR:', failed)
}
await browser.close()

// ---------- verrou anti-orpheline (les DEUX jeux, tout type d'image) ----
const referenced = new Set()
const walkMd = (dir) => {
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f)
        if (fs.statSync(p).isDirectory()) { walkMd(p); continue }
        if (!f.endsWith('.md')) continue
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/\/docs-img\/(?:fr|en|pt|it|de|es)\/([\w.-]+)/g)) referenced.add(m[1])
    }
}
walkMd(DOCS)
const presentByLang = {}
let orphans = 0
const walkImg = (dir, lang) => {
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f)
        if (fs.statSync(p).isDirectory()) { walkImg(p, f); continue }
        if (!/\.(png|svg)$/i.test(f)) continue
        ;(presentByLang[lang] = presentByLang[lang] || []).push({ f, p })
    }
}
walkImg(IMG, 'root')
// Les fichiers à la RACINE de docs-img (l'ancien jeu D2, référencé par
// personne depuis les jeux par langue) : retirés, en le disant.
for (const { f, p } of presentByLang.root || []) {
    fs.unlinkSync(p)
    orphans++
    log('image racine retirée (jeux par langue désormais) :', f)
}
const allPresent = new Map()
for (const [lang, files] of Object.entries(presentByLang)) {
    if (lang === 'root') continue
    for (const { f, p } of files) allPresent.set(`${lang}/${f}`, p)
}
for (const [key, p] of allPresent) {
    if (!referenced.has(key.split('/')[1])) {
        fs.unlinkSync(p)
        orphans++
        log('image orpheline retirée :', key)
    }
}
const missing = [...referenced].filter((f) => !allPresent.has(`fr/${f}`) || !allPresent.has(`en/${f}`) || !allPresent.has(`pt/${f}`) || !allPresent.has(`it/${f}`) || !allPresent.has(`de/${f}`) || !allPresent.has(`es/${f}`))
check('lock', 'chaque image référencée existe DANS LES SIX langues', missing.length === 0, { manquantes: missing })
check('lock', 'aucune image orpheline après nettoyage', true, { retirees: orphans })

fs.writeFileSync(LOG, logs.join('\n') + '\n')
const reds = checks.filter((c) => !c.ok)
if (failed || reds.length) {
    console.log(`NO-GO — ${reds.length} sonde(s) rouge(s)${failed ? ' + erreur' : ''}`)
    process.exit(1)
}
console.log('GO — captures régénérées dans les SIX langues (compte neuf, éléments cadrés, langue sondée, zéro orpheline)')
