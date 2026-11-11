// QA E2E navigateur — lot V1 « téléchargement Free limité à 2 tôles »
// (spec `specs/LOT-V1-TELECHARGEMENT-FREE-2026-11.md` §5 WP-QA point 3,
// critères §6.1-§6.4). Ossature : `qa-e2e-local-2sheets.mjs`.
//
// Ce que le harnais affirme, scénario par scénario (chacun vert ou rouge,
// indépendamment des autres — un échec n'arrête pas la suite) :
//
//   sse      préalable : le flux SSE des résultats répond (les cartes, la
//            fenêtre de résultat et le calcul navigateur en dépendent).
//   local    verrou LOCAL : projet « cet appareil » d'un Free, calcul
//            navigateur vérifié (job `awaiting_local`, sinon échec dit), au
//            moins 3 tôles ; carte `result-unlock` + ZIP de 2 entrées
//            (`nesting-<slug>-sheets-1-2.zip`) ; fenêtre : tôle 1
//            téléchargeable, tôle 3 badge + `sheet-unlock` + Vue DXF
//            `disabled` ET `aria-disabled="true"`, clic RÉEL sur
//            `sheet-unlock` → `subscription-context` ; `report-unlock`.
//            Captures de la carte en FR et en DE (deux lignes de boutons,
//            aucun libellé rogné — mesuré, pas seulement regardé).
//            Fenêtre d'abonnement (§6.4, §2.5) : prix + bouton d'essai (ou
//            « S'abonner ») affichés, `sub.freeLeft` / `sub.resetsAt` masqués
//            dans ce contexte — le bouton n'est JAMAIS cliqué (aucun appel
//            Stripe). Exige un document `subscription_plan` en base (voir
//            CONFIGURATION). En FR et en DE : fenêtre du résultat sur la
//            tôle 3 (badge, déblocage de la visionneuse, rangée d'actions)
//            et fenêtre d'abonnement ouverte par `sheet-unlock`, libellés
//            traduits et mesure « rien de rogné » (`surfaceLayout`).
//   retour   retour de paiement simulé (annulation) : intention posée en
//            sessionStorage, `?checkout=cancelled` → URL nettoyée, fenêtre
//            du résultat rouverte, aucun toast ; rechargement → pas rouverte.
//   relance  D11 : refus de capacité (1 tôle déclarée), information D26 dans
//            le panneau, rechargement (panneau parti), carte refusée rouverte
//            → `report-capacity` + `capacity-add-sheet` (pas « Ouvrir le
//            projet ») ; clic → fenêtre fermée, count + k, `live-cancel`
//            visible puis annulé ; sur /home : `capacity-open-project` →
//            /project/<slug>, réglages inchangés. Sur la fenêtre refusée, le
//            bouton mono-tôle « Download » est désactivé (attribut, fix
//            6a711818) ; panneau de capacité de la fenêtre capturé et mesuré
//            en FR et en DE.
//   plans    /plans : ligne « tôles téléchargeables » et puces Free.
//   demo     /project/demo : total ≥ 3 au pager EXIGÉ (sinon « démo < 3
//            tôles : assertion vide »), tôle 3 sans badge, carte sans
//            `result-unlock`, libellé de téléchargement complet.
//   serveur  verrou SERVEUR : grant posé en base, projet « nos serveurs »
//            calculé par le worker local (≥ 3 tôles), grant retiré,
//            rechargement ; aucune requête `/api/files/result/dxf/…_part_3`
//            pendant la visite de la tôle 3, ZIP de la carte à 2 entrées
//            nommé `nesting-<slug>-sheets-1-2.zip`, fetch direct du `_part_3`
//            → 403 `sheet_download_locked`.
//   payant   compte granté (AGENTS §4) : carte et fenêtre d'un résultat
//            multi-tôles sans aucun cadenas, libellés d'origine.
//
// ---------------------------------------------------------------------------
// RECETTE DU COMPTE FREE DE DEV (AGENTS §4 n'a qu'un compte granté)
//   1. Créer le compte (une fois) : POST /api/auth/local/register
//      { email: 'qa-free@local.dev', name: 'QA Free', password } — le harnais
//      le fait lui-même si le compte n'existe pas en base (le rate-limit
//      d'inscription est de 5/h/IP, en mémoire).
//   2. En base : users.updateOne({ email }, { $set: { emailVerified: true },
//      $unset: { grantedUntil: '', grantedTier: '' } }).
//   3. AVANT CHAQUE PASSAGE : $set { freeNestingUsed: 0 } (quota 10/mois) —
//      le harnais rejoue 2 et 3 à chaque lancement (et remet
//      demoNestingUsed à 0), puis vérifie GET /api/user : compute.level
//      'free', granted false.
//   Le scénario « serveur » pose puis RETIRE un grant (grantedUntil futur,
//   grantedTier 'standard') sur ce même compte ; le retrait est rejoué en fin
//   de harnais quoi qu'il arrive.
//   Identifiants : QA_FREE_EMAIL / QA_FREE_PASSWORD (valeurs de dev par
//   défaut ci-dessous) ; compte granté : QA_EMAIL / QA_PASSWORD.
//
// CONFIGURATION EXIGÉE (§5 WP-QA 3) : app lancée avec
//   NUXT_PUBLIC_LOCAL_COMPUTE_ENABLED=true et NUXT_PUBLIC_PAID_PLANS_DISABLED=false
//   (vérifié dans la config runtime servie), Mongo local joignable
//   (QA_MONGO_URI, défaut mongodb://127.0.0.1:27017/nest2d) et un worker de
//   nesting local pour le scénario « serveur ».
//   Fenêtre d'abonnement : sans clé Stripe, le plugin
//   `server/plugins/6_subscription_plan_sync.ts` ne synchronise rien et
//   la fenêtre affiche « plan unavailable » (ou n'affiche pas l'offre Pro).
//   Semer en base QA les DEUX documents lus par
//   `server/api/payment/subscription.get.js` (Unlimited ET Pro) :
//     subscription_plan.updateOne({ id: 'subscription' }, { $set: { id:
//       'subscription', tier: 'standard', title: 'NestorCut Unlimited',
//       interval: 'month', prices: { eur: 1900 }, priceId: '…', productId: '…' } },
//       { upsert: true })
//     subscription_plan.updateOne({ id: 'subscription:privacy' }, { $set: { id:
//       'subscription:privacy', tier: 'privacy', title: 'NestorCut Pro',
//       interval: 'month', prices: { eur: 3900 }, priceId: '…', productId: '…' } },
//       { upsert: true })
//   Le harnais les lit par l'API et échoue en le disant s'ils manquent.
//
// Usage :
//   QA_OUT=<dossier hors OneDrive> node scripts/qa-e2e-free-lock.mjs
//   QA_SCENARIOS=local,retour   (sous-ensemble ; « retour » exige « local »)
//   QA_DEMO_SHEET=LxH           (format de tôle de la démo, défaut 1000x1000)
//   QA_DEMO_COUNT=N             (tôles déclarées pour la démo, défaut 12)
// Sortie QA_OUT : captures, run.log, summary.json, ZIP téléchargés.
// Code de sortie : 0 si tous les scénarios lancés sont verts, 1 sinon.
import { chromium } from 'playwright'
import { MongoClient } from 'mongodb'
import { unzipSync } from 'fflate'
import fs from 'node:fs'
import path from 'node:path'
import { translate, pluralSelect, intlTag } from '../app/utils/i18n/index.js'
import { FREE_DOWNLOAD_SHEET_CAP } from '../shared/constants/payment.constants.js'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('.qa-pw/free-lock')
const MONGO_URI = process.env.QA_MONGO_URI || 'mongodb://127.0.0.1:27017/nest2d'
const FREE_EMAIL = process.env.QA_FREE_EMAIL || 'qa-free@local.dev'
const FREE_PASSWORD = process.env.QA_FREE_PASSWORD || 'qa-free-8b7a33a5e2764b166a43629b'
const PAID_EMAIL = process.env.QA_EMAIL || 'guillaume@local.dev'
const PAID_PASSWORD = process.env.QA_PASSWORD || 'nestorcut-local-2026'
const ONLY = process.env.QA_SCENARIOS
    ? process.env.QA_SCENARIOS.split(',').map((s) => s.trim()).filter(Boolean)
    : null
const [DEMO_W, DEMO_H] = String(process.env.QA_DEMO_SHEET || '1000x1000').toLowerCase().split('x')
const DEMO_COUNT = process.env.QA_DEMO_COUNT || '12'
fs.mkdirSync(OUT, { recursive: true })

// Pièce carrée 100 × 100 mm à trou (fixture des harnais existants). Sur une
// tôle 230 × 230, il en tient 4 (2 × 2) et jamais 5 : 10 pièces = 3 tôles,
// en quelques secondes même à 1 cœur.
const TROU = path.resolve('.testparts/Piece_Trou.DXF')
const LOCK = { qty: '10', w: '230', h: '230', count: '5' }
// Refus de capacité : 80 pièces sur UNE tôle 500 × 500 — ratio ≈ 3, environ
// 4 tôles nécessaires (> 2 ⇒ information D26), k = 3.
const REFUSE = { qty: '80', w: '500', h: '500', count: '1' }
const CAP = FREE_DOWNLOAD_SHEET_CAP

const T = (key, params = {}, loc = 'en') => translate(key, loc, params)

const logs = []
const log = (...a) => {
    const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`
    logs.push(s)
    console.log(s)
}
const flushLogs = () => fs.writeFileSync(path.join(OUT, 'run.log'), logs.join('\n') + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Scénarios : chaque `check` est consigné ; un scénario est vert si tous ses
// checks le sont et qu'aucune exception ne l'a interrompu.
// ---------------------------------------------------------------------------
const scenarios = []
let cur = null
const captures = []

function check(label, ok, detail = '') {
    const pass = Boolean(ok)
    if (cur) cur.checks.push({ label, ok: pass, detail: String(detail ?? '') })
    log(`${pass ? 'OK' : 'KO'} [${cur?.id || '-'}] ${label}${detail !== '' && detail != null ? ' — ' + detail : ''}`)
    return pass
}

async function scenario(id, title, fn, { needs = [] } = {}) {
    if (ONLY && !ONLY.includes(id)) {
        scenarios.push({ id, title, status: 'skipped' })
        return
    }
    cur = { id, title, checks: [], console: [], error: null, t0: Date.now() }
    scenarios.push(cur)
    log(`===== ${id} : ${title}`)
    try {
        for (const dep of needs) {
            if (!state[dep]) throw new Error(`prérequis absent : ${dep} (scénario amont rouge ou non lancé)`)
        }
        await fn()
    } catch (e) {
        cur.error = String(e && e.stack || e).slice(0, 1500)
        log('FATAL', `[${id}]`, cur.error)
        for (const p of [freePage, paidPage].filter(Boolean)) {
            await shot(p, `99-${id}-error-${p === freePage ? 'free' : 'paid'}.png`, null, 'état au moment de l’erreur').catch(() => {})
        }
    }
    cur.status = !cur.error && cur.checks.length > 0 && cur.checks.every((c) => c.ok) ? 'green' : 'red'
    cur.durationS = Math.round((Date.now() - cur.t0) / 1000)
    log(`===== ${id} : ${cur.status.toUpperCase()} (${cur.durationS} s, ${cur.checks.filter((c) => c.ok).length}/${cur.checks.length} checks)`)
    flushLogs()
    cur = null
}

const state = {}

// ---------------------------------------------------------------------------
// Mongo (grant / quota du compte de QA, statut des jobs)
// ---------------------------------------------------------------------------
const mongo = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
await mongo.connect()
const db = mongo.db()
const users = db.collection('users')
const jobs = db.collection('nesting_jobs')
const TERMINAL = ['done', 'completed', 'failed', 'cancelled', 'error']

// Un job « cet appareil » n'avance que si le navigateur le prend en charge :
// le client le découvre dans le flux SSE des résultats, puis demande
// /local-payload (qui pose `takenAt`). Sans prise en charge après ce délai,
// on échoue en le disant au lieu d'attendre 10 minutes.
const LOCAL_START_MS = Number(process.env.QA_LOCAL_START_MS || 90000)

async function waitJob(slug, timeoutMs = 10 * 60 * 1000) {
    const t0 = Date.now()
    let doc = null
    while (Date.now() - t0 < timeoutMs) {
        doc = await jobs.findOne({ slug })
        if (doc && TERMINAL.includes(doc.status)) return doc
        if (doc?.status === 'awaiting_local' && !doc.takenAt && Date.now() - t0 > LOCAL_START_MS) {
            throw new Error(`calcul navigateur jamais pris en charge en ${Math.round(LOCAL_START_MS / 1000)} s : job ${slug} `
                + 'awaiting_local sans takenAt (le client n’a jamais demandé /local-payload — il découvre le job '
                + `par le flux SSE des résultats${state.sseMute ? ', MUET sur cette pile (scénario « sse »)' : ''})`)
        }
        await sleep(1500)
    }
    throw new Error(`job ${slug} non terminé après ${Math.round(timeoutMs / 1000)} s (statut ${doc?.status})`)
}

/** Premier message du flux SSE des résultats (global ou d'un projet), ou
 * 'timeout' / 'error'. Ouvert depuis la page (cookie de session). */
const probeSse = (page, url, ms = 10000) => page.evaluate(([u, t]) => new Promise((res) => {
    const t0 = performance.now()
    const es = new EventSource(u)
    const timer = setTimeout(() => { es.close(); res({ outcome: 'timeout', ms: Math.round(performance.now() - t0) }) }, t)
    es.onmessage = (e) => {
        clearTimeout(timer)
        es.close()
        let type = null
        try { type = JSON.parse(e.data)?.type } catch { /* non JSON */ }
        res({ outcome: 'message', type, ms: Math.round(performance.now() - t0) })
    }
    es.onerror = () => { clearTimeout(timer); es.close(); res({ outcome: 'error', ms: Math.round(performance.now() - t0) }) }
}), [url, ms])

async function resetFreeAccount() {
    const r = await users.updateOne(
        { email: FREE_EMAIL },
        {
            $set: { emailVerified: true, freeNestingUsed: 0, demoNestingUsed: 0 },
            $unset: { grantedUntil: '', grantedTier: '' },
        },
    )
    return r.matchedCount
}

// ---------------------------------------------------------------------------
// Navigateur
// ---------------------------------------------------------------------------
const browser = await chromium.launch({ headless: process.env.QA_HEADLESS !== '0' })
async function newContext() {
    const ctx = await browser.newContext({
        locale: 'en-US',
        viewport: { width: 1680, height: 1000 },
        acceptDownloads: true,
    })
    await ctx.addCookies([{ name: 'locale', value: 'en', url: BASE }])
    // Toasts vus depuis le chargement (UiToast vit 4 s) : un observateur
    // posé avant tout script de la page.
    await ctx.addInitScript(() => {
        window.__qaToasts = []
        const seen = () => {
            for (const el of document.querySelectorAll('.ui-toast')) {
                const t = (el.textContent || '').trim()
                if (t && !window.__qaToasts.includes(t)) window.__qaToasts.push(t)
            }
        }
        new MutationObserver(seen).observe(document, { childList: true, subtree: true, characterData: true })
    })
    return ctx
}
function wirePage(page, tag) {
    page.on('console', (m) => {
        const t = m.type()
        if (t === 'error' || t === 'warning') {
            const line = `[${tag} console:${t}] ${m.text().slice(0, 400)}`
            if (cur) cur.console.push(line)
            log(line)
        }
    })
    page.on('pageerror', (e) => {
        const line = `[${tag} pageerror] ${String(e).slice(0, 600)}`
        if (cur) cur.console.push(line)
        log(line)
    })
    page.on('response', (r) => {
        if (r.status() >= 400) {
            const line = `[${tag} http ${r.status()}] ${r.request().method()} ${r.url()}`
            if (cur) cur.console.push(line)
            log(line)
        }
    })
}

async function shot(page, name, locator = null, shows = '') {
    try {
        const p = path.join(OUT, name)
        if (locator) await locator.screenshot({ path: p, timeout: 60000 })
        else await page.screenshot({ path: p, fullPage: false, timeout: 60000 })
        captures.push({ path: p, scenario: cur?.id || '-', shows })
        log('capture :', name)
    } catch (e) {
        log('capture ÉCHOUÉE (non fatale) :', name, String(e).slice(0, 160))
    }
}

async function login(page, email, password) {
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

const apiUser = (page) => page.evaluate(async () => {
    const r = await fetch('/api/user', { credentials: 'same-origin' })
    return r.ok ? r.json() : { httpStatus: r.status }
})

/** Annule les jobs encore actifs d'un compte (reste d'un passage précédent) :
 * sans cela le prochain POST /nest prend un 409 concurrent_limit. */
async function cancelActiveJobs(page, ownerId) {
    const active = await jobs.find({ ownerId, status: { $in: ['pending', 'processing', 'awaiting_local'] } })
        .project({ slug: 1, status: 1 }).toArray()
    for (const j of active) {
        log(`job actif hérité ${j.slug} (${j.status}) → annulation`)
        await page.evaluate((s) => fetch(`/api/results/${s}/cancel`, { method: 'POST' }).then((r) => r.status), j.slug)
            .catch(() => null)
    }
    if (active.length) await sleep(3000)
    return active.length
}

/** Crée un projet depuis /home (« cet appareil » ou « nos serveurs »). */
async function createProject(page, files, { local = true } = {}) {
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const re = local
        ? new RegExp(`(${T('privacy.device.title')}|${T('privacy.device.title', {}, 'fr')})`, 'i')
        : new RegExp(`(${T('privacy.cloud.title')}|${T('privacy.cloud.title', {}, 'fr')})`, 'i')
    const card = page.locator('.create__privacy [role="radio"]').filter({ hasText: re }).first()
    await card.waitFor({ timeout: 30000 })
    await card.click()
    if ((await card.getAttribute('aria-checked')) !== 'true') {
        throw new Error(`carte de confidentialité « ${local ? 'cet appareil' : 'nos serveurs'} » non sélectionnée`)
    }
    await page.setInputFiles('input[name="dxf"]', files)
    await page.waitForURL('**/project/**', { timeout: 90000 })
    return page.url().split('/project/')[1].split(/[?#]/)[0]
}

async function waitFiles(page, n, timeout = 240000) {
    await page.waitForFunction(
        (k) => document.querySelectorAll('.files__item input.counter__value').length >= k,
        n, { timeout },
    )
}

async function waitServerFilesDone(page, slug, n, timeoutMs = 300000) {
    const t0 = Date.now()
    let files = []
    while (Date.now() - t0 < timeoutMs) {
        files = await page.evaluate(async (s) => {
            const r = await fetch(`/api/project/${s}`, { credentials: 'same-origin' })
            if (!r.ok) return []
            const d = await r.json()
            return (d.files || []).map((f) => ({ name: f.name, status: f.processingStatus }))
        }, slug)
        if (files.length >= n && files.every((f) => f.status === 'done')) return files
        if (files.some((f) => f.status === 'error')) throw new Error('fichier serveur en erreur : ' + JSON.stringify(files))
        await sleep(2000)
    }
    throw new Error('traitement serveur du fichier non terminé : ' + JSON.stringify(files))
}

async function ensureMm(page) {
    const suffix = await page.locator('.size__sheet .input__suffix').first().innerText().catch(() => '')
    if (!/mm/i.test(suffix)) {
        log('unité ≠ mm → bascule mm')
        await page.locator('.unit-switch__segment', { hasText: 'mm' }).first().click()
        await page.waitForTimeout(400)
    }
}

async function setFileCount(page, value) {
    const input = page.locator('.files__item input.counter__value').first()
    await input.click()
    await input.fill(String(value))
    await input.blur()
    await page.waitForTimeout(300)
}

const sheetDims = (page) => page.locator('.size__sheet').first().locator('.size__line .input__value')
const sheetCount = (page) => page.locator('.size__sheet').first().locator('> .input__value, > label.input .input__value').first()

async function setSheet(page, { w, h, count }) {
    const dims = sheetDims(page)
    await dims.nth(0).fill(String(w)); await dims.nth(0).blur()
    await dims.nth(1).fill(String(h)); await dims.nth(1).blur()
    const c = sheetCount(page)
    await c.fill(String(count)); await c.blur()
    await page.waitForTimeout(400)
}

async function readSheet(page) {
    const dims = sheetDims(page)
    return {
        w: await dims.nth(0).inputValue(),
        h: await dims.nth(1).inputValue(),
        count: await sheetCount(page).inputValue(),
    }
}

const isNestPost = (r) => r.request().method() === 'POST'
    && /^\/api\/project\/[^/]+\/nest$/.test(new URL(r.url()).pathname)

/** Clique « Nest » et rend { status, jobSlug } de la réponse POST /nest. */
async function startNest(page) {
    const btn = page.locator('.atelier__nest')
    const t0 = Date.now()
    while (Date.now() - t0 < 15000) {
        if (!(await btn.isDisabled().catch(() => true))) break
        await page.waitForTimeout(300)
    }
    const respP = page.waitForResponse(isNestPost, { timeout: 30000 })
    await btn.click()
    const resp = await respP
    let body = null
    try { body = await resp.json() } catch { /* corps vide */ }
    return { status: resp.status(), jobSlug: body?.slug || null, body }
}

const firstCard = (page) => page.locator('.results__item').first()

/** Attend que la carte la plus récente soit terminée (boutons de téléchargement). */
async function waitFirstCardDone(page, timeout = 90000) {
    await firstCard(page).locator('.controls__download').first().waitFor({ state: 'visible', timeout })
    await page.waitForTimeout(800)
}

async function openCard(page, card) {
    await card.locator('[data-testid="result-area"]').click()
    await page.locator('[data-testid="result-space"]').waitFor({ state: 'visible', timeout: 30000 })
    await page.waitForTimeout(1200)
}

async function pager(page) {
    const txt = (await page.locator('[data-testid="sheet-label"]').first().innerText().catch(() => '')).trim()
    const m = /(\d+)\s*\/\s*(\d+)/.exec(txt)
    return { text: txt, n: m ? Number(m[1]) : null, total: m ? Number(m[2]) : null }
}

async function gotoSheet(page, target) {
    for (let i = 0; i < 12; i++) {
        const p = await pager(page)
        if (p.n === target) return p
        const btn = page.locator(p.n < target ? '[data-testid="sheet-next"]' : '[data-testid="sheet-prev"]').first()
        await btn.click({ timeout: 5000 })
        await page.waitForTimeout(700)
    }
    return pager(page)
}

async function closeDialogs(page) {
    for (let i = 0; i < 4; i++) {
        if (!(await page.locator('.modal-body').count())) return
        await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
    }
}

const viewerDownload = (page, n) => page.locator('[data-testid="viewer-stage"] .modal__part-download')
    .filter({ hasText: T('result.downloadSheet', { n }) })

/** Clique le bouton principal de la carte et rend le ZIP téléchargé. */
async function downloadFromCard(page, card, prefix) {
    const btn = card.locator('.controls__download').first()
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        btn.click(),
    ])
    const name = download.suggestedFilename()
    const saved = path.join(OUT, `${prefix}-${name}`)
    await download.saveAs(saved)
    let entries = []
    try { entries = Object.keys(unzipSync(new Uint8Array(fs.readFileSync(saved)))) } catch (e) { log('unzip :', String(e)) }
    return { name, saved, entries }
}

/** Mesure de la carte : rangées de boutons, libellés rognés (D27). */
const cardLayout = (card) => card.evaluate((el) => {
    const controls = el.querySelector('.controls')
    if (!controls) return null
    const kids = [...controls.children].filter((c) => c.offsetParent !== null)
    const rect = (c) => c.getBoundingClientRect()
    const btn = (sel) => {
        const c = controls.querySelector(sel)
        return c ? { top: Math.round(rect(c).top), left: Math.round(rect(c).left), width: Math.round(rect(c).width) } : null
    }
    const clipped = []
    for (const c of kids) {
        for (const n of [c, ...c.querySelectorAll('*')]) {
            if (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow !== 'visible') {
                clipped.push((c.className || '').toString().slice(0, 60) + ' :: ' + (n.textContent || '').trim().slice(0, 40))
            }
        }
    }
    const cardRect = el.getBoundingClientRect()
    const outside = kids.filter((c) => rect(c).right > cardRect.right + 1).map((c) => (c.className || '').toString().slice(0, 60))
    return {
        locked: controls.classList.contains('controls--locked'),
        rows: [...new Set(kids.map((c) => Math.round(rect(c).top)))].length,
        download: btn('.controls__download'),
        unlock: btn('.controls__unlock'),
        clipped,
        outside,
    }
})

async function setLocale(page, loc) {
    await page.context().addCookies([{ name: 'locale', value: loc, url: BASE }])
}

/** Mesure « rien de rogné » d'une surface de fenêtre (D27 étendu aux
 * fenêtres, même principe que `cardLayout`). Pour chaque cible visible
 * `{ name, sel, within, optional }` :
 *   - outside : la boîte de la cible sort de son conteneur (`within`, un
 *     ancêtre trouvé par closest, sinon le parent) ou de la largeur de la
 *     fenêtre du navigateur ;
 *   - clipped : un nœud de la cible (elle comprise) coupe son contenu —
 *     overflow ≠ visible avec scroll > client (+1 px), ou text-overflow
 *     ellipsis ;
 *   - spill : un texte de la cible déborde de son élément ou de la cible
 *     (mesuré par Range sur chaque nœud texte : un texte nowrap qui
 *     « dépasse » sans être coupé est attrapé ici).
 * `missing` liste les cibles obligatoires absentes. */
const surfaceLayout = (page, targets) => page.evaluate(async (targets) => {
    try { await document.fonts?.ready } catch { /* sans polices */ }
    const R = (r) => ({ l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) })
    const inside = (a, b, tol = 1) => a.left >= b.left - tol && a.right <= b.right + tol
        && a.top >= b.top - tol && a.bottom <= b.bottom + tol
    const shown = (el) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
    }
    const cut = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 50)
    const res = { checked: 0, missing: [], outside: [], clipped: [], spill: [], items: [] }
    for (const t of targets) {
        const els = [...document.querySelectorAll(t.sel)].filter(shown)
        if (!els.length) {
            if (!t.optional) res.missing.push(t.name)
            continue
        }
        els.forEach((el, i) => {
            const name = els.length > 1 ? `${t.name}[${i}]` : t.name
            const box = el.getBoundingClientRect()
            const cont = t.within ? el.closest(t.within) : el.parentElement
            res.checked++
            res.items.push({ name, text: cut(el.innerText), box: R(box) })
            if (!cont) {
                res.missing.push(`${name} : conteneur ${t.within} absent`)
            } else if (!inside(box, cont.getBoundingClientRect())) {
                res.outside.push(`${name} ${JSON.stringify(R(box))} hors de ${t.within || 'parent'} ${JSON.stringify(R(cont.getBoundingClientRect()))}`)
            }
            if (box.left < -1 || box.right > window.innerWidth + 1) {
                res.outside.push(`${name} ${JSON.stringify(R(box))} hors de la fenêtre (largeur ${window.innerWidth})`)
            }
            for (const n of [el, ...el.querySelectorAll('*')]) {
                if (!shown(n)) continue
                const cs = getComputedStyle(n)
                const cutX = cs.overflowX !== 'visible' && n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 1
                const cutY = cs.overflowY !== 'visible' && n.clientHeight > 0 && n.scrollHeight > n.clientHeight + 1
                const ellipsis = cs.textOverflow === 'ellipsis' && n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 1
                if (cutX || cutY || ellipsis) {
                    res.clipped.push(`${name} :: <${n.tagName.toLowerCase()} class="${cut(n.className?.baseVal ?? n.className)}"> `
                        + `« ${cut(n.textContent)} » scroll ${n.scrollWidth}×${n.scrollHeight} > client ${n.clientWidth}×${n.clientHeight}`
                        + ` (overflow ${cs.overflowX}/${cs.overflowY}${ellipsis ? ', ellipsis' : ''})`)
                }
                const own = n.getBoundingClientRect()
                for (const tn of n.childNodes) {
                    if (tn.nodeType !== 3 || !tn.textContent.trim()) continue
                    const rg = document.createRange()
                    rg.selectNodeContents(tn)
                    const tr = rg.getBoundingClientRect()
                    if (!tr.width) continue
                    if (!inside(tr, own) || !inside(tr, box)) {
                        res.spill.push(`${name} :: « ${cut(tn.textContent)} » texte ${JSON.stringify(R(tr))} / élément ${JSON.stringify(R(own))} / cible ${JSON.stringify(R(box))}`)
                    }
                }
            }
        })
    }
    return res
}, targets)

/** Consigne la mesure d'une surface : vert si au moins une cible mesurée et
 * aucune absence, aucun débordement, aucun rognage. */
function checkSurface(label, lay) {
    return check(`${label} : aucun élément débordant ni texte rogné (mesuré)`,
        lay && lay.checked > 0 && lay.missing.length === 0 && lay.outside.length === 0
            && lay.clipped.length === 0 && lay.spill.length === 0,
        JSON.stringify({ checked: lay?.checked, missing: lay?.missing, outside: lay?.outside, clipped: lay?.clipped, spill: lay?.spill })
            .slice(0, 1500))
}

// Surfaces mesurées (cibles `surfaceLayout`).
const SHEET3_SURFACE = [
    { name: 'toolbar', sel: '[data-testid="viewer-toolbar"]', within: '.modal-body' },
    { name: 'pager', sel: '[data-testid="sheet-label"]', within: '[data-testid="viewer-toolbar"]' },
    { name: 'badge', sel: '[data-testid="sheet-locked-badge"]', within: '[data-testid="viewer-toolbar"]' },
    { name: 'mode', sel: '[data-testid="viewer-toolbar"] .viewer__mode', within: '[data-testid="viewer-toolbar"]' },
    { name: 'viewer-unlock', sel: '[data-testid="sheet-unlock"]', within: '[data-testid="viewer-stage"]' },
    { name: 'actions', sel: '[data-testid="report-actions"]', within: '.modal-body' },
    { name: 'action', sel: '[data-testid="report-actions"] > *', within: '[data-testid="report-actions"]' },
]
const SUB_SURFACE = [
    { name: 'carte', sel: '.subscription .subscription__card', within: '.modal-body' },
    { name: 'contexte', sel: '[data-testid="subscription-context"]', within: '.subscription__card' },
    { name: 'offre', sel: '.subscription .subscription__plan-title', within: '.subscription__card' },
    { name: 'prix', sel: '.subscription .subscription__price', within: '.subscription__card' },
    { name: 'bouton', sel: '.subscription .subscription__card .subscription__btn', within: '.subscription__card' },
    { name: 'note', sel: '.subscription .subscription__note', within: '.subscription__card', optional: true },
]
const CAPACITY_SURFACE = [
    { name: 'panneau', sel: '[data-testid="report-capacity"]', within: '.modal-body' },
    { name: 'titre', sel: '[data-testid="report-capacity"] .capacity-panel__title', within: '[data-testid="report-capacity"]' },
    { name: 'levier', sel: '[data-testid="report-capacity"] .capacity-panel__levers li', within: '[data-testid="report-capacity"]' },
    { name: 'ajouter', sel: '[data-testid="report-capacity"] [data-testid="capacity-add-sheet"]', within: '[data-testid="report-capacity"]' },
    { name: 'actions', sel: '[data-testid="report-actions"]', within: '.modal-body' },
    { name: 'action', sel: '[data-testid="report-actions"] > *', within: '[data-testid="report-actions"]' },
]

/** Fenêtre d'abonnement ouverte depuis un « Débloquer » (§2.5, §6.4) :
 * phrase de contexte, prix et bouton d'essai / d'abonnement présents,
 * compteur Free et date de remise à zéro masqués. Le bouton n'est JAMAIS
 * cliqué : il ouvrirait le Checkout Stripe. */
async function subscriptionChecks(page, loc, total) {
    const L = loc.toUpperCase()
    const api = await page.evaluate(async () => {
        const r = await fetch('/api/payment/subscription', { credentials: 'same-origin' })
        return r.ok ? r.json() : { httpStatus: r.status }
    })
    const plan = api?.plan || null
    const proPlan = api?.privacyPlan || null
    check(`abonnement ${L} : /api/payment/subscription rend les offres Unlimited et Pro (documents subscription_plan semés)`,
        Boolean(plan) && Boolean(proPlan),
        JSON.stringify({ plan, privacyPlan: proPlan, trialEligible: api?.trialEligible, httpStatus: api?.httpStatus }))
    const sub = page.locator('.subscription').last()
    // Deux offres dans la fenêtre : Unlimited (bloc sans modificateur) puis Pro.
    const unl = sub.locator('.subscription__plan:not(.subscription__plan--pro)')
    const pro = sub.locator('[data-testid="subscription-pro-offer"]')
    await unl.locator('.subscription__price').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
    const ctxText = (await sub.locator('[data-testid="subscription-context"]').innerText().catch(() => '')).trim()
    check(`abonnement ${L} : phrase de contexte traduite (N tôles, les 2 premières)`,
        ctxText === T('sub.ctx.lockedSheets', { n: total, cap: CAP }, loc), ctxText)
    // Même formatage que Subscription.vue (formatPlanMoney : Intl de la langue).
    const fmt = (p) => new Intl.NumberFormat(intlTag(loc), {
        style: 'currency', currency: p.currency, minimumFractionDigits: 0, maximumFractionDigits: 2,
    }).format(p.amount)
    const monthTxt = T('plans.interval.month', {}, loc)
    const priceTxt = (await unl.locator('.subscription__price').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    const wantPrice = plan ? fmt(plan).replace(/\s+/g, ' ') : null
    check(`abonnement ${L} : prix Unlimited affiché (§6.4)`,
        Boolean(plan) && priceTxt.includes(wantPrice) && priceTxt.includes(`/ ${monthTxt}`),
        `« ${priceTxt} » (attendu ${wantPrice} / ${monthTxt})`)
    const proPriceTxt = (await pro.locator('.subscription__price').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    const wantProPrice = proPlan ? fmt(proPlan).replace(/\s+/g, ' ') : null
    check(`abonnement ${L} : prix Pro affiché`,
        Boolean(proPlan) && proPriceTxt.includes(wantProPrice) && proPriceTxt.includes(`/ ${monthTxt}`),
        `« ${proPriceTxt} » (attendu ${wantProPrice} / ${monthTxt})`)
    const btn = unl.locator('.subscription__btn')
    const btnCount = await btn.count()
    const btnLabel = btnCount ? (await btn.first().innerText().catch(() => '')).trim() : ''
    const btnEnabled = btnCount ? await btn.first().isEnabled().catch(() => false) : false
    const wantBtn = !plan ? null : api.trialEligible !== false
        ? T('sub.startTrial', { days: plan.trialDays }, loc)
        : T('sub.subscribe', {}, loc)
    check(`abonnement ${L} : bouton Unlimited (essai ou « S’abonner ») présent et actif (§6.4, non cliqué)`,
        btnCount === 1 && btnEnabled && btnLabel === wantBtn,
        `${btnCount} bouton(s), « ${btnLabel} », actif=${btnEnabled}, attendu « ${wantBtn} » (trialEligible=${api?.trialEligible})`)
    const proBtn = pro.locator('.subscription__btn')
    const proBtnCount = await proBtn.count()
    const proBtnLabel = proBtnCount ? (await proBtn.first().innerText().catch(() => '')).trim() : ''
    const proBtnEnabled = proBtnCount ? await proBtn.first().isEnabled().catch(() => false) : false
    const wantProBtn = !proPlan ? null : api.trialEligible !== false
        ? T('sub.startTrial', { days: proPlan.trialDays }, loc)
        : T('sub.subscribe', {}, loc)
    check(`abonnement ${L} : bouton Pro présent et actif (non cliqué)`,
        proBtnCount === 1 && proBtnEnabled && proBtnLabel === wantProBtn,
        `${proBtnCount} bouton(s), « ${proBtnLabel} », actif=${proBtnEnabled}, attendu « ${wantProBtn} »`)
    // Conditions du Checkout dites AVANT le clic, sous chaque offre ; le coffre
    // (ouvert à toutes les offres) n'est pas listé comme un avantage payant.
    const unlTerms = (await unl.locator('[data-testid="subscription-terms"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
    const proTermsTxt = (await pro.locator('[data-testid="subscription-terms-pro"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
    check(`abonnement ${L} : conditions affichées sous les deux offres, avec leur prix`,
        Boolean(plan) && Boolean(proPlan) && unlTerms.includes(wantPrice) && proTermsTxt.includes(wantProPrice),
        `Unlimited « ${unlTerms} » ; Pro « ${proTermsTxt} »`)
    const featTxt = (await sub.locator('[data-testid="subscription-features"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
    check(`abonnement ${L} : le coffre zero-knowledge n'est pas listé comme avantage d'Unlimited`,
        featTxt.length > 0 && !featTxt.includes(T('plans.unlimited.f5', {}, loc)), `« ${featTxt} »`)
    const txt = (await sub.innerText().catch(() => '')).replace(/\s+/g, ' ')
    const longest = (s) => s.split(/\{[a-z]+\}/).map((x) => x.trim()).sort((a, b) => b.length - a.length)[0]
    const freeLeftTxt = longest(T('sub.freeLeft', {}, loc))
    const resetTxt = longest(T('sub.resetsAt', {}, loc))
    const freeEl = await sub.locator('.subscription__free').count()
    const resetEl = await sub.locator('.subscription__reset').count()
    check(`abonnement ${L} : sub.freeLeft et sub.resetsAt masqués dans ce contexte (§2.5)`,
        freeEl === 0 && resetEl === 0 && !txt.includes(freeLeftTxt) && !txt.includes(resetTxt),
        `.subscription__free=${freeEl} .subscription__reset=${resetEl} texte « ${freeLeftTxt} » ${txt.includes(freeLeftTxt) ? 'PRÉSENT' : 'absent'}, `
        + `« ${resetTxt} » ${txt.includes(resetTxt) ? 'PRÉSENT' : 'absent'}`)
    check(`abonnement ${L} : pas de « plan indisponible »`, !txt.includes(T('sub.unavailable', {}, loc)))
    return { plan, priceTxt, btnLabel }
}

/** Boutons mono-tôle « Download » / « Download the DXF » de la rangée
 * d'actions et leur état (fix 6a711818 : grisés sur un résultat refusé). */
const singleDownloadButtons = (page, loc) => page.locator('[data-testid="report-actions"]').first().evaluate((row, labels) => {
    return [...row.querySelectorAll('button, a')]
        .filter((b) => labels.includes((b.innerText || '').trim()))
        .map((b) => ({
            tag: b.tagName.toLowerCase(),
            label: (b.innerText || '').trim(),
            disabled: b.hasAttribute('disabled'),
            aria: b.getAttribute('aria-disabled'),
            tabindex: b.getAttribute('tabindex'),
            href: b.getAttribute('href'),
            classDisabled: b.classList.contains('button--disabled'),
        }))
}, [T('results.download', {}, loc), T('results.downloadDxf', {}, loc)]).catch((e) => [{ error: String(e).slice(0, 120) }])

function checkSingleDownloadDisabled(label, list) {
    return check(label, list.length > 0 && list.every((b) => !b.error && (b.disabled || b.aria === 'true')), JSON.stringify(list))
}

let freeCtx = null
let freePage = null
let paidCtx = null
let paidPage = null
let exitCode = 1

try {
    // ---------- 0. Recette du compte Free + configuration ----------
    if (!(await users.findOne({ email: FREE_EMAIL }, { projection: { _id: 1 } }))) {
        log('compte Free absent → inscription', FREE_EMAIL)
        const r = await fetch(BASE + '/api/auth/local/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: FREE_EMAIL, name: 'QA Free', password: FREE_PASSWORD }),
        })
        log('register →', r.status)
    }
    const matched = await resetFreeAccount()
    if (!matched) throw new Error(`compte ${FREE_EMAIL} introuvable en base après inscription`)
    log('recette Free rejouée (emailVerified, quota 0, grant retiré)')

    freeCtx = await newContext()
    freePage = await freeCtx.newPage()
    wirePage(freePage, 'free')
    await login(freePage, FREE_EMAIL, FREE_PASSWORD)
    const me = await apiUser(freePage)
    log('GET /api/user (Free) :', JSON.stringify({
        level: me?.compute?.level, granted: me?.granted, subscriptionStatus: me?.subscriptionStatus,
        freeRemaining: me?.freeRemaining, emailVerified: me?.emailVerified,
    }))
    if (me?.compute?.level !== 'free' || me?.granted) {
        throw new Error(`le compte ${FREE_EMAIL} n'est pas Free (level=${me?.compute?.level}, granted=${me?.granted})`)
    }
    // La config publique est sérialisée dans le HTML servi
    // (`window.__NUXT__.config={public:{…}}`), retirée après l'hydratation :
    // on la lit dans le HTML, pas dans `window`.
    const html = await (await fetch(BASE + '/')).text()
    const flag = (name) => {
        const m = new RegExp(`${name}:("?)(true|false)\\1`).exec(html)
        return m ? m[2] : undefined
    }
    const runtimePublic = {
        localComputeEnabled: flag('localComputeEnabled'),
        paidPlansDisabled: flag('paidPlansDisabled'),
    }
    log('config runtime servie :', JSON.stringify(runtimePublic))
    const on = (v) => v === true || v === 'true'
    if (!on(runtimePublic.localComputeEnabled) || on(runtimePublic.paidPlansDisabled)) {
        throw new Error('configuration exigée absente : NUXT_PUBLIC_LOCAL_COMPUTE_ENABLED=true et '
            + 'NUXT_PUBLIC_PAID_PLANS_DISABLED=false (§5 WP-QA 3) — servi : ' + JSON.stringify(runtimePublic))
    }
    const freeUserId = (await users.findOne({ email: FREE_EMAIL }, { projection: { id: 1 } }))?.id
    state.freeUserId = freeUserId
    await cancelActiveJobs(freePage, freeUserId)

    // =====================================================================
    // 0. Préalable : le flux SSE des résultats répond
    // =====================================================================
    // Tout le reste en dépend : les cartes, la fenêtre de résultat ET le
    // calcul navigateur (le client découvre ses jobs awaiting_local par ce
    // flux). Un flux muet est un défaut de l'app, consigné ici une fois.
    await scenario('sse', 'Préalable : flux SSE des résultats (cartes, calcul navigateur)', async () => {
        const global = await probeSse(freePage, '/api/results')
        check('GET /api/results (SSE) : premier message en < 10 s', global.outcome === 'message' && global.type === 'initial',
            JSON.stringify(global))
        const demo = await probeSse(freePage, '/api/project/demo/results')
        check('GET /api/project/demo/results (SSE) : premier message en < 10 s', demo.outcome === 'message' && demo.type === 'initial',
            JSON.stringify(demo))
        state.sseMute = global.outcome !== 'message' && demo.outcome !== 'message'
        if (state.sseMute) {
            log('DÉFAUT APP : flux SSE des résultats MUET — aucune carte de résultat, aucun calcul navigateur, '
                + 'aucune fenêtre de résultat ne peut apparaître ; les scénarios qui en dépendent échoueront.')
        }
    })

    // =====================================================================
    // A. Verrou LOCAL
    // =====================================================================
    await scenario('local', 'Verrou local (Free, calcul navigateur, ≥ 3 tôles)', async () => {
        const P = freePage
        await cancelActiveJobs(P, state.freeUserId)
        const slug = await createProject(P, [TROU], { local: true })
        log('projet local :', slug)
        await waitFiles(P, 1)
        await ensureMm(P)
        await setFileCount(P, LOCK.qty)
        await setSheet(P, LOCK)
        log('réglages :', JSON.stringify(await readSheet(P)))

        // D26, surface 1 : information sous le bouton Nest (pré-vol > 2 tôles).
        const note = P.locator('[data-testid="free-download-note"]')
        await note.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
        check('D26 : information Free sous le bouton Nest (pré-vol > 2 tôles)',
            await note.isVisible(), (await note.innerText().catch(() => '')).trim())
        await shot(P, 'a0-preflight-d26.png', P.locator('.atelier__params').first(),
            'colonne de réglages avant le calcul : bouton Nest et information D26 sous le ctaHint')

        const nest = await startNest(P)
        check('POST /nest 200', nest.status === 200, `HTTP ${nest.status} ${JSON.stringify(nest.body)}`)
        if (!nest.jobSlug) throw new Error('POST /nest sans slug de job')
        const job0 = await jobs.findOne({ slug: nest.jobSlug })
        const local = job0?.params?.computeLocation === 'local' && Boolean(job0?.localConfig)
        check('premier calcul Free parti en calcul NAVIGATEUR (job awaiting_local)', local
            && ['awaiting_local', 'done'].includes(job0?.status),
        `statut=${job0?.status} computeLocation=${job0?.params?.computeLocation} localConfig=${Boolean(job0?.localConfig)}`)
        if (!local) {
            throw new Error('le projet Free ne part PAS en calcul navigateur : la configuration '
                + 'NUXT_PUBLIC_LOCAL_COMPUTE_ENABLED=true est-elle appliquée ? (§5 WP-QA 3)')
        }
        const job = await waitJob(nest.jobSlug)
        check('job terminé (done)', job.status === 'done', `statut=${job.status} information=${job.information || ''}`)
        check('au moins 3 tôles (alternative 0)', (job.layoutCount || 0) >= 3, `layoutCount=${job.layoutCount}`)
        state.local = { slug, jobSlug: nest.jobSlug, layoutCount: job.layoutCount, total: job.layoutCount }

        await waitFirstCardDone(P)
        const card = firstCard(P)
        const unlock = card.locator('[data-testid="result-unlock"]')
        check('carte : result-unlock visible', await unlock.isVisible())
        const dlBtn = card.locator('.controls__download').first()
        const dlLabel = (await dlBtn.innerText()).trim()
        check('carte : libellé court « Tôles 1–2 »', dlLabel === T('results.downloadFirstSheetsShort', { n: CAP }), dlLabel)
        check('carte : aria-label « Télécharger les 2 premières tôles »',
            (await dlBtn.getAttribute('aria-label')) === T('results.downloadFirstSheets', { n: CAP }),
            await dlBtn.getAttribute('aria-label'))
        check('carte : aria-label du déblocage = « Débloquer les N tôles »',
            (await unlock.getAttribute('aria-label')) === T('results.unlockSheets', { n: job.layoutCount }),
            await unlock.getAttribute('aria-label'))
        const layoutEn = await cardLayout(card)
        log('carte EN :', JSON.stringify(layoutEn))
        check('carte : classe controls--locked', layoutEn?.locked === true)
        await shot(P, 'a1-local-card-en.png', card, 'carte F3+ locale en anglais')

        // ZIP de la carte : 2 entrées, nom partiel.
        const zip = await downloadFromCard(P, card, 'local-card')
        log('ZIP carte :', zip.name, JSON.stringify(zip.entries))
        check('ZIP carte : nom nesting-<slug>-sheets-1-2.zip',
            zip.name === `nesting-${nest.jobSlug}-sheets-1-${CAP}.zip`, zip.name)
        check('ZIP carte : exactement 2 entrées (tôles 1 et 2)',
            zip.entries.length === CAP && zip.entries.every((e) => /_part_[12]\.dxf$/.test(e)),
            JSON.stringify(zip.entries))

        // Carte en FR puis en DE (D27 : seconde ligne, rien d'écrasé).
        for (const loc of ['fr', 'de']) {
            await setLocale(P, loc)
            await P.reload({ waitUntil: 'domcontentloaded' })
            await waitFirstCardDone(P)
            const c = firstCard(P)
            const lay = await cardLayout(c)
            log(`carte ${loc.toUpperCase()} :`, JSON.stringify(lay))
            const label = (await c.locator('.controls__download').first().innerText()).trim()
            const unlockLabel = (await c.locator('[data-testid="result-unlock"]').innerText().catch(() => '')).trim()
            check(`carte ${loc.toUpperCase()} : libellés traduits`,
                label === T('results.downloadFirstSheetsShort', { n: CAP }, loc)
                && unlockLabel === T('results.unlockShort', {}, loc), `« ${label} » / « ${unlockLabel} »`)
            check(`carte ${loc.toUpperCase()} : « Débloquer » sur une seconde ligne`,
                lay?.unlock && lay?.download && lay.unlock.top > lay.download.top, JSON.stringify({ d: lay?.download, u: lay?.unlock }))
            check(`carte ${loc.toUpperCase()} : aucun libellé rogné ni bouton débordant`,
                lay && lay.clipped.length === 0 && lay.outside.length === 0,
                JSON.stringify({ clipped: lay?.clipped, outside: lay?.outside }))
            await shot(P, `a2-local-card-${loc}.png`, c, `carte F3+ locale en ${loc.toUpperCase()}`)
        }
        await setLocale(P, 'en')
        await P.reload({ waitUntil: 'domcontentloaded' })
        await waitFirstCardDone(P)

        // Fenêtre : tôle 1.
        await openCard(P, firstCard(P))
        const p1 = await pager(P)
        check('fenêtre : pager « Tôle 1 / N », N ≥ 3', p1.n === 1 && p1.total >= 3, p1.text)
        state.local.total = p1.total
        check('fenêtre tôle 1 : « Télécharger la tôle 1 » présent', await viewerDownload(P, 1).isVisible())
        check('fenêtre tôle 1 : aucun badge de verrou', !(await P.locator('[data-testid="sheet-locked-badge"]').count()))
        check('fenêtre : report-unlock présent', await P.locator('[data-testid="report-unlock"]').isVisible(),
            (await P.locator('[data-testid="report-unlock"]').innerText().catch(() => '')).trim())
        const reportZip = P.locator('[data-testid="report-actions"] button, [data-testid="report-actions"] a')
            .filter({ hasText: T('results.downloadFirstSheets', { n: CAP }) })
        check('fenêtre : « Tout télécharger » renommé « Télécharger les 2 premières tôles »', await reportZip.count() > 0)
        await shot(P, 'a3-local-modal-sheet1.png', P.locator('.modal-body').first(), 'fenêtre du résultat local, tôle 1')

        // Fenêtre : tôle 3.
        const p3 = await gotoSheet(P, 3)
        check('fenêtre : pager sur la tôle 3', p3.n === 3, p3.text)
        const badge = P.locator('[data-testid="sheet-locked-badge"]')
        check('fenêtre tôle 3 : sheet-locked-badge visible', await badge.isVisible(), (await badge.innerText().catch(() => '')).trim())
        check('fenêtre tôle 3 : sheet-unlock visible', await P.locator('[data-testid="sheet-unlock"]').isVisible())
        check('fenêtre tôle 3 : téléchargement absent', !(await viewerDownload(P, 3).count()))
        const dxfOpt = P.locator('[data-testid="view-mode-dxf"]')
        const dxfAttrs = await dxfOpt.evaluate((el) => ({
            disabled: el.hasAttribute('disabled'), aria: el.getAttribute('aria-disabled'), title: el.getAttribute('title'),
        })).catch(() => null)
        check('fenêtre tôle 3 : view-mode-dxf disabled ET aria-disabled="true"',
            dxfAttrs?.disabled === true && dxfAttrs?.aria === 'true', JSON.stringify(dxfAttrs))
        await shot(P, 'a4-local-modal-sheet3.png', P.locator('.modal-body').first(),
            'fenêtre du résultat local, tôle 3 verrouillée (badge, Vue DXF inactive, bouton Débloquer)')
        const sheet3En = await surfaceLayout(P, SHEET3_SURFACE)
        log('fenêtre tôle 3 EN :', JSON.stringify(sheet3En.items))
        checkSurface('fenêtre EN tôle 3 (badge, déblocage, rangée d’actions)', sheet3En)

        // Clic RÉEL sur « Débloquer » de la visionneuse.
        await P.locator('[data-testid="sheet-unlock"]').click()
        const ctx = P.locator('[data-testid="subscription-context"]')
        const ctxOk = await ctx.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)
        const ctxText = (await ctx.innerText().catch(() => '')).trim()
        check('clic sheet-unlock → subscription-context visible', ctxOk, ctxText)
        check('phrase de contexte : N tôles, les 2 premières',
            ctxText === T('sub.ctx.lockedSheets', { n: p1.total, cap: CAP }), ctxText)
        // §6.4 / §2.5 : prix + bouton d'essai, compteur Free masqué (gap a
        // du passage r2 : la base QA n'avait aucun subscription_plan).
        await subscriptionChecks(P, 'en', p1.total)
        await P.waitForTimeout(600)
        const subEn = await surfaceLayout(P, SUB_SURFACE)
        log('fenêtre d’abonnement EN :', JSON.stringify(subEn.items))
        checkSurface('fenêtre d’abonnement EN (contexte, prix, essai)', subEn)
        await shot(P, 'a5-subscription-context.png', P.locator('.modal-body').last(),
            'fenêtre d’abonnement ouverte depuis « Débloquer » : phrase de contexte, prix, bouton d’essai')
        await closeDialogs(P)

        // Fenêtres en FR puis en DE (gap b du passage r2) : tôle 3 (badge,
        // déblocage de la visionneuse, rangée d'actions) puis fenêtre
        // d'abonnement ouverte par un clic RÉEL sur sheet-unlock.
        try {
            for (const loc of ['fr', 'de']) {
                const L = loc.toUpperCase()
                await setLocale(P, loc)
                await P.reload({ waitUntil: 'domcontentloaded' })
                await waitFirstCardDone(P)
                await openCard(P, firstCard(P))
                const q = await gotoSheet(P, 3)
                check(`fenêtre ${L} : pager sur la tôle 3`, q.n === 3 && q.total === p1.total, q.text)
                const badgeTxt = (await P.locator('[data-testid="sheet-locked-badge"]').innerText().catch(() => '')).trim()
                check(`fenêtre ${L} tôle 3 : badge traduit`, badgeTxt === T('result.sheetLocked', {}, loc), badgeTxt)
                const vUnlock = (await P.locator('[data-testid="sheet-unlock"]').innerText().catch(() => '')).trim()
                check(`fenêtre ${L} tôle 3 : déblocage de la visionneuse traduit`,
                    vUnlock === T('results.unlockSheets', { n: p1.total }, loc), vUnlock)
                check(`fenêtre ${L} tôle 3 : téléchargement de la tôle absent`,
                    !(await P.locator('[data-testid="viewer-stage"] .modal__part-download')
                        .filter({ hasText: T('result.downloadSheet', { n: 3 }, loc) }).count()))
                const rUnlock = (await P.locator('[data-testid="report-unlock"]').innerText().catch(() => '')).trim()
                const rZip = await P.locator('[data-testid="report-actions"] button, [data-testid="report-actions"] a')
                    .filter({ hasText: T('results.downloadFirstSheets', { n: CAP }, loc) }).count()
                check(`fenêtre ${L} : rangée d’actions traduite (Débloquer + 2 premières tôles)`,
                    rUnlock === T('results.unlockSheets', { n: p1.total }, loc) && rZip > 0, `« ${rUnlock} », ZIP 1-2 : ${rZip}`)
                const lay = await surfaceLayout(P, SHEET3_SURFACE)
                log(`fenêtre tôle 3 ${L} :`, JSON.stringify(lay.items))
                checkSurface(`fenêtre ${L} tôle 3 (badge, déblocage, rangée d’actions)`, lay)
                await shot(P, `a6-local-modal-sheet3-${loc}.png`, P.locator('.modal-body').first(),
                    `fenêtre du résultat local en ${L}, tôle 3 verrouillée (badge, déblocage, rangée d’actions)`)

                await P.locator('[data-testid="sheet-unlock"]').click()
                const ok = await P.locator('[data-testid="subscription-context"]').waitFor({ state: 'visible', timeout: 15000 })
                    .then(() => true).catch(() => false)
                check(`clic sheet-unlock ${L} → subscription-context visible`, ok)
                await subscriptionChecks(P, loc, p1.total)
                await P.waitForTimeout(600)
                const sl = await surfaceLayout(P, SUB_SURFACE)
                log(`fenêtre d’abonnement ${L} :`, JSON.stringify(sl.items))
                checkSurface(`fenêtre d’abonnement ${L} (contexte, prix, essai)`, sl)
                await shot(P, `a7-subscription-${loc}.png`, P.locator('.modal-body').last(),
                    `fenêtre d’abonnement en ${L} ouverte depuis « Débloquer » : contexte, prix, bouton d’essai`)
                await closeDialogs(P)
            }
        } finally {
            await setLocale(P, 'en')
        }
    })

    // =====================================================================
    // B. Retour de paiement simulé (annulation)
    // =====================================================================
    await scenario('retour', 'Retour de paiement simulé (checkout=cancelled)', async () => {
        const P = freePage
        const { slug, jobSlug, total } = state.local
        await P.goto(BASE + `/project/${slug}`, { waitUntil: 'domcontentloaded' })
        await waitFirstCardDone(P)
        await P.evaluate(([k, v]) => sessionStorage.setItem(k, v), ['nestorcut:checkoutIntent', JSON.stringify({
            v: 1, source: 'locked_sheets', resultSlug: jobSlug, projectSlug: slug, at: Date.now(),
        })])
        await P.goto(BASE + `/project/${slug}?checkout=cancelled`, { waitUntil: 'domcontentloaded' })
        await P.waitForFunction(() => !location.search.includes('checkout'), null, { timeout: 15000 }).catch(() => {})
        check('URL nettoyée (plus de « checkout »)', !new URL(P.url()).searchParams.has('checkout'), P.url())
        const opened = await P.locator('[data-testid="result-space"]').waitFor({ state: 'visible', timeout: 30000 })
            .then(() => true).catch(() => false)
        check('fenêtre du résultat rouverte', opened)
        if (opened) {
            await P.waitForTimeout(1200)
            const p = await pager(P)
            check('fenêtre rouverte = le résultat de l’intention', p.total === total, p.text)
        }
        await P.waitForTimeout(5000)
        const toasts = await P.evaluate(() => window.__qaToasts || [])
        check('aucun toast', toasts.length === 0, JSON.stringify(toasts))
        check('intention consommée (sessionStorage vide)',
            (await P.evaluate(() => sessionStorage.getItem('nestorcut:checkoutIntent'))) === null)
        await shot(P, 'b1-retour-annule.png', null, 'retour d’annulation : fenêtre du résultat rouverte, URL nettoyée, aucun toast')
        await P.reload({ waitUntil: 'domcontentloaded' })
        await waitFirstCardDone(P)
        await P.waitForTimeout(6000)
        check('rechargement : la fenêtre ne se rouvre pas', !(await P.locator('[data-testid="result-space"]').isVisible()))
    }, { needs: ['local'] })

    // =====================================================================
    // C. Relance depuis la fenêtre (D11)
    // =====================================================================
    await scenario('relance', 'Relance depuis la fenêtre (refus de capacité, D11 / D12)', async () => {
        const P = freePage
        await cancelActiveJobs(P, state.freeUserId)
        const slug = await createProject(P, [TROU], { local: true })
        log('projet refus :', slug)
        await waitFiles(P, 1)
        await ensureMm(P)
        await setFileCount(P, REFUSE.qty)
        await setSheet(P, REFUSE)
        const nest = await startNest(P)
        check('POST /nest 200 (projet local)', nest.status === 200, `HTTP ${nest.status}`)
        const panel = P.locator('[data-testid="capacity-panel"]').first()
        const refused = await panel.waitFor({ state: 'visible', timeout: 60000 }).then(() => true).catch(() => false)
        check('refus de capacité : panneau visible', refused)
        if (!refused) {
            throw new Error('aucun refus de capacité affiché en 60 s (le refus navigateur part quand le client prend le job '
                + `en charge${state.sseMute ? ' — flux SSE des résultats muet, le job reste awaiting_local' : ''})`)
        }
        const freeNote = panel.locator('[data-testid="capacity-free-note"]')
        // ab62f439 : un refus ne porte plus la note Free (rien à télécharger).
        check('refus : pas de note Free dans le panneau', !(await freeNote.isVisible().catch(() => false)),
            (await freeNote.innerText().catch(() => '')).trim())
        const pageAdd = panel.locator('[data-testid="capacity-add-sheet"]')
        log('bouton du panneau :', (await pageAdd.innerText().catch(() => '')).trim(),
            'data-add-sheets=', await pageAdd.getAttribute('data-add-sheets').catch(() => null))
        const job = await waitJob(nest.jobSlug, 120000)
        // Un refus NAVIGATEUR est persisté `status: 'error'` en base
        // (server/api/results/[slug]/local-fail.post.js:99) ; c'est l'API qui
        // le présente `failed` (server/features/results/resultcontroller.js:46-47).
        // Le harnais lit la BASE : il attend donc `error`.
        check('job refusé (status « error » en base = « failed » à l’API, unfit capacity)',
            job.status === 'error' && job.unfit?.reason === 'capacity',
            `statut=${job.status} unfit=${JSON.stringify(job.unfit || null)}`)
        // Capture APRÈS la fin du job : le panneau apparaît dès le refus côté
        // client, alors que le bouton Nest dit encore « Computing… » tant que le
        // flux SSE liste le job awaiting_local (`runningJob` ← pickRunningJob,
        // app/pages/project/[slug].vue:103-106 et :269-273).
        const nestBtn = P.locator('.atelier__nest')
        const computing = T('nest.computing')
        for (let i = 0; i < 20 && (await nestBtn.innerText().catch(() => '')).includes(computing.replace(/[.…]+$/, '')); i++) {
            await P.waitForTimeout(500)
        }
        log('bouton Nest après le refus :', JSON.stringify((await nestBtn.innerText().catch(() => '')).trim()),
            'disabled=', await nestBtn.isDisabled().catch(() => null))
        await shot(P, 'c1-capacity-panel-d26.png', P.locator('.atelier__params').first(),
            'panneau de capacité de la page projet avec l’information D26')
        const before = await readSheet(P)

        // Rechargement : le panneau de la page disparaît.
        await P.reload({ waitUntil: 'domcontentloaded' })
        await waitFiles(P, 1)
        await firstCard(P).waitFor({ state: 'visible', timeout: 60000 })
        await P.waitForTimeout(2500)
        check('rechargement : panneau de la page disparu', !(await P.locator('.atelier__params [data-testid="capacity-panel"]').count()))
        const capTitle = T('nest.capacity.title')
        const refusedCard = P.locator('.results__item').filter({
            has: P.locator('[data-testid="result-name"]', { hasText: capTitle }),
        }).first()
        await openCard(P, refusedCard)
        const rc = P.locator('[data-testid="report-capacity"]')
        check('fenêtre : report-capacity visible', await rc.isVisible())
        const addBtn = rc.locator('[data-testid="capacity-add-sheet"]')
        check('fenêtre (projet du job) : capacity-add-sheet présent', await addBtn.isVisible())
        check('fenêtre (projet du job) : pas de capacity-open-project', !(await rc.locator('[data-testid="capacity-open-project"]').count()))
        check('fenêtre : pas de note Free dans un refus', !(await rc.locator('[data-testid="capacity-free-note"]').isVisible().catch(() => false)))
        check('fenêtre : plus de code brut capacity_exceeded',
            !(await P.locator('.modal-body').first().innerText()).includes('capacity_exceeded'))
        // Fix 6a711818 (ResultReport.vue, garde isHaveError || isUnfit sur
        // la paire mono-tôle) : plus de « Download » primaire et mort à côté
        // du panneau de capacité (gap c du passage r2).
        checkSingleDownloadDisabled('fenêtre refusée EN : bouton mono-tôle « Download » désactivé (disabled ou aria-disabled, fix 6a711818)',
            await singleDownloadButtons(P, 'en'))
        await P.waitForTimeout(400)
        const capEn = await surfaceLayout(P, CAPACITY_SURFACE)
        log('panneau de capacité (fenêtre) EN :', JSON.stringify(capEn.items))
        checkSurface('panneau de capacité de la fenêtre EN', capEn)
        await shot(P, 'c2-report-capacity-projet.png', P.locator('.modal-body').first(),
            'fenêtre d’un job refusé, sur la page du projet : panneau de capacité + « Ajouter environ k tôles et relancer »')

        // Panneau de capacité de la fenêtre en FR puis en DE (gap b du
        // passage r2), AVANT le clic de relance qui consomme le refus.
        const kShown = Number(await addBtn.getAttribute('data-add-sheets'))
        await closeDialogs(P)
        try {
            for (const loc of ['fr', 'de']) {
                const L = loc.toUpperCase()
                await setLocale(P, loc)
                await P.reload({ waitUntil: 'domcontentloaded' })
                await waitFiles(P, 1)
                await firstCard(P).waitFor({ state: 'visible', timeout: 60000 })
                await P.waitForTimeout(2500)
                const cardL = P.locator('.results__item').filter({
                    has: P.locator('[data-testid="result-name"]', { hasText: T('nest.capacity.title', {}, loc) }),
                }).first()
                await openCard(P, cardL)
                const rcL = P.locator('[data-testid="report-capacity"]')
                check(`fenêtre refusée ${L} : report-capacity visible`, await rcL.isVisible())
                const addL = (await rcL.locator('[data-testid="capacity-add-sheet"]').innerText().catch(() => '')).trim()
                const wantAdd = T(`report.unfit.addSheets.${pluralSelect(loc, kShown)}`, { n: kShown }, loc)
                check(`fenêtre refusée ${L} : « Ajouter … tôles et relancer » traduit (k=${kShown})`, addL === wantAdd,
                    `« ${addL} » (attendu « ${wantAdd} »)`)
                const noteL = (await rcL.locator('[data-testid="capacity-free-note"]').innerText().catch(() => '')).trim()
                check(`fenêtre refusée ${L} : pas de note Free dans un refus`, noteL === '', noteL)
                checkSingleDownloadDisabled(`fenêtre refusée ${L} : bouton mono-tôle désactivé (fix 6a711818)`,
                    await singleDownloadButtons(P, loc))
                await P.waitForTimeout(400)
                const lay = await surfaceLayout(P, CAPACITY_SURFACE)
                log(`panneau de capacité (fenêtre) ${L} :`, JSON.stringify(lay.items))
                checkSurface(`panneau de capacité de la fenêtre ${L}`, lay)
                await shot(P, `c4-report-capacity-${loc}.png`, P.locator('.modal-body').first(),
                    `fenêtre du job refusé en ${L}, sur la page du projet : panneau de capacité, D26, rangée d’actions`)
                await closeDialogs(P)
            }
        } finally {
            await setLocale(P, 'en')
        }
        await P.reload({ waitUntil: 'domcontentloaded' })
        await waitFiles(P, 1)
        await firstCard(P).waitFor({ state: 'visible', timeout: 60000 })
        await P.waitForTimeout(2500)
        await openCard(P, refusedCard)
        check('fenêtre refusée rouverte en EN : capacity-add-sheet présent', await addBtn.isVisible())

        const k = Number(await addBtn.getAttribute('data-add-sheets'))
        check('data-add-sheets entier ≥ 1', Number.isInteger(k) && k >= 1, String(k))
        const relaunchP = P.waitForResponse(isNestPost, { timeout: 20000 })
        relaunchP.catch(() => {})
        await addBtn.click()
        const closed = await P.locator('[data-testid="result-space"]').waitFor({ state: 'hidden', timeout: 10000 })
            .then(() => true).catch(() => false)
        check('clic → fenêtre fermée', closed)
        let after = await readSheet(P)
        for (let i = 0; i < 10 && Number(after.count) === Number(before.count); i++) {
            await P.waitForTimeout(500)
            after = await readSheet(P)
        }
        check('count du premier format + k', Number(after.count) === Number(before.count) + k,
            `${before.count} → ${after.count} (k=${k})`)
        const relaunch = await relaunchP.catch(() => null)
        check('relance : POST /nest 200', relaunch?.status() === 200, relaunch ? `HTTP ${relaunch.status()}` : 'aucun POST /nest en 20 s')
        let relaunchSlug = null
        try { relaunchSlug = (await relaunch?.json())?.slug } catch { /* corps vide */ }
        const liveCancel = P.locator('[data-testid="live-cancel"]')
        const live = await liveCancel.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false)
        check('live-cancel visible (la relance est partie)', live)
        if (live) {
            await liveCancel.click()
            const gone = await liveCancel.waitFor({ state: 'hidden', timeout: 30000 }).then(() => true).catch(() => false)
            check('relance annulée (live-cancel disparu)', gone)
        }
        if (relaunchSlug) {
            const rj = await waitJob(relaunchSlug, 60000).catch(() => null)
            check('aucun orphelin : job relancé terminal', rj && TERMINAL.includes(rj.status), `statut=${rj?.status}`)
        }
        const settings = await readSheet(P)
        log('réglages après relance :', JSON.stringify(settings))

        // /home : « Ouvrir le projet » seulement.
        await P.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
        await firstCard(P).waitFor({ state: 'visible', timeout: 60000 })
        await P.waitForTimeout(2500)
        const homeCard = P.locator('.results__item').filter({
            has: P.locator('[data-testid="result-name"]', { hasText: capTitle }),
        }).first()
        await openCard(P, homeCard)
        const rcHome = P.locator('[data-testid="report-capacity"]')
        const openBtn = rcHome.locator('[data-testid="capacity-open-project"]')
        check('/home : capacity-open-project présent', await openBtn.isVisible())
        check('/home : pas de capacity-add-sheet', !(await rcHome.locator('[data-testid="capacity-add-sheet"]').count()))
        await shot(P, 'c3-report-capacity-home.png', P.locator('.modal-body').first(),
            'fenêtre du même job refusé, depuis /home : un seul bouton « Ouvrir le projet »')
        await openBtn.click()
        await P.waitForURL(`**/project/${slug}`, { timeout: 30000 }).catch(() => {})
        check('« Ouvrir le projet » → /project/<slug>', new URL(P.url()).pathname === `/project/${slug}`, P.url())
        await waitFiles(P, 1)
        await P.waitForTimeout(1500)
        const reopened = await readSheet(P)
        check('réglages inchangés après « Ouvrir le projet »',
            reopened.w === settings.w && reopened.h === settings.h && reopened.count === settings.count,
            `${JSON.stringify(settings)} → ${JSON.stringify(reopened)}`)
    })

    // =====================================================================
    // D. /plans
    // =====================================================================
    await scenario('plans', '/plans (Free : 2 premières tôles, Unlimited : toutes)', async () => {
        const P = freePage
        await P.goto(BASE + '/plans', { waitUntil: 'domcontentloaded' })
        await P.waitForTimeout(2500)
        const txt = await P.locator('body').innerText()
        check('comparatif : « tôles téléchargeables par tâche »', txt.includes(T('plans.compare.sheetDownloads')))
        check('comparatif : « Les 2 premières »', txt.includes(T('plans.value.firstSheets', { n: CAP })))
        check('carte Free : puce « autant de tôles que nécessaire »', txt.includes(T('plans.free.allSheets')))
        check('carte Free : export des 2 premières tôles', txt.includes(T('plans.free.f3', { n: CAP })))
        await shot(P, 'd1-plans.png', null, '/plans en anglais (haut de page)')
        const table = P.locator('table').first()
        if (await table.count()) {
            await table.scrollIntoViewIfNeeded().catch(() => {})
            await shot(P, 'd2-plans-compare.png', table, 'comparatif de /plans avec la ligne des tôles téléchargeables')
        }
    })

    // =====================================================================
    // E. Démo
    // =====================================================================
    await scenario('demo', 'Démo (aucun verrou, total ≥ 3 exigé)', async () => {
        const P = freePage
        await cancelActiveJobs(P, state.freeUserId)
        await P.goto(BASE + '/project/demo', { waitUntil: 'domcontentloaded' })
        await waitFiles(P, 1)
        await P.waitForTimeout(2000)
        await ensureMm(P)
        await setSheet(P, { w: DEMO_W, h: DEMO_H, count: DEMO_COUNT })
        log('démo, réglages :', JSON.stringify(await readSheet(P)))
        const nest = await startNest(P)
        check('démo : POST /nest 200', nest.status === 200, `HTTP ${nest.status} ${JSON.stringify(nest.body)}`)
        if (!nest.jobSlug) throw new Error('POST /nest démo sans slug')
        const job = await waitJob(nest.jobSlug, 15 * 60 * 1000)
        check('démo : job terminé', job.status === 'done', `statut=${job.status} ${job.information || ''}`)
        await waitFirstCardDone(P, 120000)
        const card = firstCard(P)
        await openCard(P, card)
        const p = await pager(P)
        if (!(p.total >= 3)) {
            throw new Error(`démo < 3 tôles : assertion vide (pager « ${p.text} », QA_DEMO_SHEET=${DEMO_W}x${DEMO_H}) — réduire le format`)
        }
        check('démo : total ≥ 3 au pager', p.total >= 3, p.text)
        const p3 = await gotoSheet(P, 3)
        check('démo tôle 3 : pager', p3.n === 3, p3.text)
        check('démo tôle 3 : aucun sheet-locked-badge', !(await P.locator('[data-testid="sheet-locked-badge"]').count()))
        check('démo tôle 3 : aucun sheet-unlock', !(await P.locator('[data-testid="sheet-unlock"]').count()))
        check('démo tôle 3 : « Télécharger la tôle 3 » présent', await viewerDownload(P, 3).isVisible())
        const dxfDisabled = await P.locator('[data-testid="view-mode-dxf"]').evaluate((el) => el.hasAttribute('disabled')).catch(() => null)
        check('démo tôle 3 : Vue DXF active', dxfDisabled === false, String(dxfDisabled))
        check('démo : aucun report-unlock', !(await P.locator('[data-testid="report-unlock"]').count()))
        await shot(P, 'e1-demo-modal-sheet3.png', P.locator('.modal-body').first(), 'fenêtre d’un résultat démo, tôle 3 sans verrou')
        await closeDialogs(P)
        const c = firstCard(P)
        check('carte démo : aucun result-unlock', !(await c.locator('[data-testid="result-unlock"]').count()))
        const label = (await c.locator('.controls__download').first().innerText()).trim()
        check('carte démo : libellé de téléchargement complet', label === T('results.downloadAll'), label)
        const lay = await cardLayout(c)
        check('carte démo : pas de controls--locked', lay?.locked === false)
        await shot(P, 'e2-demo-card.png', c, 'carte d’un résultat démo, libellé complet, aucun cadenas')
    })

    // =====================================================================
    // F. Verrou SERVEUR
    // =====================================================================
    await scenario('serveur', 'Verrou serveur (grant posé, calcul worker, grant retiré)', async () => {
        const P = freePage
        try {
            await cancelActiveJobs(P, freeUserId)
            await users.updateOne({ email: FREE_EMAIL }, {
                $set: { grantedUntil: new Date(Date.now() + 24 * 3600 * 1000), grantedTier: 'standard' },
            })
            await P.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
            const meGranted = await apiUser(P)
            check('grant posé : /api/user granted', meGranted?.granted === true, `level=${meGranted?.compute?.level}`)
            const slug = await createProject(P, [TROU], { local: false })
            log('projet serveur :', slug)
            await waitServerFilesDone(P, slug, 1)
            await P.reload({ waitUntil: 'domcontentloaded' })
            await waitFiles(P, 1)
            await ensureMm(P)
            await setFileCount(P, LOCK.qty)
            await setSheet(P, LOCK)
            const nest = await startNest(P)
            check('POST /nest 200 (projet serveur)', nest.status === 200, `HTTP ${nest.status} ${JSON.stringify(nest.body)}`)
            if (!nest.jobSlug) throw new Error('POST /nest sans slug')
            const job0 = await jobs.findOne({ slug: nest.jobSlug })
            check('calcul SERVEUR (pas de localConfig)', !job0?.localConfig && job0?.params?.computeLocation !== 'local',
                `statut=${job0?.status} computeLocation=${job0?.params?.computeLocation}`)
            const job = await waitJob(nest.jobSlug, 10 * 60 * 1000)
            check('job serveur terminé (worker local)', job.status === 'done', `statut=${job.status} ${job.information || ''}`)
            check('au moins 3 tôles', (job.layoutCount || 0) >= 3, `layoutCount=${job.layoutCount}`)
            const dxfNames = Array.isArray(job.dxf_files) ? job.dxf_files : []
            log('dxf_files (alternative 0) :', JSON.stringify(dxfNames))
            const cardGranted = await waitFirstCardDone(P, 60000).then(() => true).catch(() => false)
            check('granté : carte du résultat affichée', cardGranted)
            if (cardGranted) {
                check('granté : carte sans result-unlock', !(await firstCard(P).locator('[data-testid="result-unlock"]').count()))
                await shot(P, 'f0-server-card-granted.png', firstCard(P), 'carte du résultat serveur PENDANT le grant (payant : aucun cadenas)')
            }

            // Retrait du grant, rechargement.
            await users.updateOne({ email: FREE_EMAIL }, { $unset: { grantedUntil: '', grantedTier: '' } })
            await P.reload({ waitUntil: 'domcontentloaded' })
            const meFree = await apiUser(P)
            check('grant retiré : /api/user Free', meFree?.granted === false && meFree?.compute?.level === 'free',
                `granted=${meFree?.granted} level=${meFree?.compute?.level}`)

            // --- Verrou HTTP (indépendant de l'interface) : la route que porte
            // le href de la carte, puis le DXF de la tôle 3 en appel direct.
            const zipRes = await P.request.get(`${BASE}/api/files/result/zip/${nest.jobSlug}`)
            const zipCd = zipRes.headers()['content-disposition'] || ''
            let zipEntries = []
            try { zipEntries = Object.keys(unzipSync(new Uint8Array(await zipRes.body()))) } catch (e) { log('unzip route :', String(e)) }
            log('route ZIP :', zipRes.status(), zipCd, JSON.stringify(zipEntries))
            check('route ZIP de la carte : nom nesting-<slug>-sheets-1-2.zip',
                zipRes.status() === 200 && zipCd.includes(`filename=nesting-${nest.jobSlug}-sheets-1-${CAP}.zip`), `HTTP ${zipRes.status()} ${zipCd}`)
            check('route ZIP de la carte : exactement 2 entrées (tôles 1 et 2)',
                zipEntries.length === CAP && zipEntries.every((e) => /_part_[12]\.dxf$/.test(e)), JSON.stringify(zipEntries))
            const name1 = dxfNames.find((n) => /_part_1\.dxf$/.test(n))
            const name3 = dxfNames.find((n) => /_part_3\.dxf$/.test(n))
            if (!name1 || !name3) throw new Error('dxf_files sans _part_1 / _part_3 : ' + JSON.stringify(dxfNames))
            const direct = await P.evaluate(async ([u1, u3]) => {
                const r3 = await fetch(u3, { credentials: 'same-origin' })
                let b3 = null
                try { b3 = await r3.json() } catch { /* pas de JSON */ }
                const r1 = await fetch(u1, { credentials: 'same-origin' })
                return { s3: r3.status, b3, s1: r1.status }
            }, [`/api/files/result/dxf/${name1}`, `/api/files/result/dxf/${name3}`])
            log('fetch direct :', JSON.stringify(direct))
            check('fetch direct _part_3 → 403 sheet_download_locked', direct.s3 === 403
                && (direct.b3?.statusMessage === 'sheet_download_locked' || direct.b3?.data?.reason === 'sheet_download_locked'),
            `HTTP ${direct.s3} ${JSON.stringify(direct.b3)?.slice(0, 200)}`)
            check('contrôle : fetch direct _part_1 → 200', direct.s1 === 200, `HTTP ${direct.s1}`)

            // --- Interface : carte (ZIP au clic) puis visite de la tôle 3.
            const cardOk = await waitFirstCardDone(P, 60000).then(() => true).catch(() => false)
            check('Free : carte du résultat serveur affichée', cardOk)
            if (!cardOk) throw new Error('carte du résultat serveur absente : clic ZIP et visite de la tôle 3 non jouables'
                + (state.sseMute ? ' (flux SSE des résultats muet)' : ''))
            const card = firstCard(P)
            check('carte : result-unlock visible', await card.locator('[data-testid="result-unlock"]').isVisible())
            await shot(P, 'f1-server-card-locked.png', card, 'carte du résultat serveur après retrait du grant (Tôles 1–2 + Tout débloquer)')

            const zip = await downloadFromCard(P, card, 'server-card')
            log('ZIP serveur (clic carte) :', zip.name, JSON.stringify(zip.entries))
            check('ZIP de la carte : nom nesting-<slug>-sheets-1-2.zip',
                zip.name === `nesting-${nest.jobSlug}-sheets-1-${CAP}.zip`, zip.name)
            check('ZIP de la carte : exactement 2 entrées (tôles 1 et 2)',
                zip.entries.length === CAP && zip.entries.every((e) => /_part_[12]\.dxf$/.test(e)), JSON.stringify(zip.entries))

            const requests = []
            const onReq = (r) => requests.push(r.url())
            P.on('request', onReq)
            await openCard(P, firstCard(P))
            const href1 = await viewerDownload(P, 1).getAttribute('href').catch(() => null)
            check('fenêtre tôle 1 : « Télécharger la tôle 1 » vers le DXF de la tôle 1', Boolean(href1 && href1.endsWith(name1)), String(href1))
            await gotoSheet(P, 3)
            const p3 = await pager(P)
            check('fenêtre : tôle 3 affichée', p3.n === 3, p3.text)
            check('tôle 3 : sheet-locked-badge', await P.locator('[data-testid="sheet-locked-badge"]').isVisible())
            const dxfOpt = P.locator('[data-testid="view-mode-dxf"]')
            const attrs = await dxfOpt.evaluate((el) => ({ disabled: el.hasAttribute('disabled'), aria: el.getAttribute('aria-disabled') }))
                .catch(() => null)
            check('tôle 3 : Vue DXF disabled + aria-disabled', attrs?.disabled === true && attrs?.aria === 'true', JSON.stringify(attrs))
            // Tentative de bascule sur l'option inactive (le clic forcé ne doit rien émettre).
            await dxfOpt.click({ force: true, timeout: 3000 }).catch(() => {})
            await P.waitForTimeout(3000)
            await shot(P, 'f2-server-modal-sheet3.png', P.locator('.modal-body').first(),
                'fenêtre du résultat serveur, tôle 3 verrouillée, aperçu couleur seul')
            P.off('request', onReq)
            const part3 = requests.filter((u) => /\/api\/files\/result\/dxf\/[^?#]*_part_3\.dxf/.test(u))
            check('aucune requête /api/files/result/dxf/…_part_3 pendant la visite', part3.length === 0,
                part3.length ? JSON.stringify(part3) : `${requests.filter((u) => u.includes('/api/files/result/dxf/')).length} requête(s) DXF au total`)
            await closeDialogs(P)
        } finally {
            await users.updateOne({ email: FREE_EMAIL }, { $unset: { grantedUntil: '', grantedTier: '' } })
        }
    })

    // =====================================================================
    // G. Compte granté (payant) : aucun cadenas, libellés d'origine
    // =====================================================================
    await scenario('payant', 'Compte granté : résultat multi-tôles sans verrou', async () => {
        paidCtx = await newContext()
        paidPage = await paidCtx.newPage()
        wirePage(paidPage, 'paid')
        const P = paidPage
        await login(P, PAID_EMAIL, PAID_PASSWORD)
        const me = await apiUser(P)
        log('GET /api/user (granté) :', JSON.stringify({ level: me?.compute?.level, granted: me?.granted }))
        if (!me?.granted) throw new Error(`${PAID_EMAIL} n'a plus de grant actif (renouveler grantedUntil en base)`)
        const paidId = (await users.findOne({ email: PAID_EMAIL }, { projection: { id: 1 } }))?.id
        await cancelActiveJobs(P, paidId)
        const slug = await createProject(P, [TROU], { local: true })
        log('projet payant :', slug)
        await waitFiles(P, 1)
        await ensureMm(P)
        await setFileCount(P, LOCK.qty)
        await setSheet(P, LOCK)
        check('payant : aucune information D26 avant le calcul', !(await P.locator('[data-testid="free-download-note"]').count()))
        const nest = await startNest(P)
        check('POST /nest 200', nest.status === 200, `HTTP ${nest.status}`)
        const job = await waitJob(nest.jobSlug)
        check('job terminé', job.status === 'done', `statut=${job.status}`)
        check('au moins 3 tôles', (job.layoutCount || 0) >= 3, `layoutCount=${job.layoutCount}`)
        await waitFirstCardDone(P)
        const card = firstCard(P)
        const lay = await cardLayout(card)
        check('carte payante : aucun result-unlock', !(await card.locator('[data-testid="result-unlock"]').count()))
        check('carte payante : pas de controls--locked', lay?.locked === false)
        const label = (await card.locator('.controls__download').first().innerText()).trim()
        check('carte payante : libellé d’origine « Download All »', label === T('results.downloadAll'), label)
        check('carte payante : aucun aria-label ajouté', (await card.locator('.controls__download').first().getAttribute('aria-label')) === null)
        await shot(P, 'g1-paid-card.png', card, 'carte d’un résultat multi-tôles du compte granté (aucun cadenas)')
        await openCard(P, card)
        const p = await pager(P)
        check('fenêtre payante : total ≥ 3', p.total >= 3, p.text)
        await gotoSheet(P, 3)
        check('fenêtre payante tôle 3 : aucun badge', !(await P.locator('[data-testid="sheet-locked-badge"]').count()))
        check('fenêtre payante tôle 3 : « Télécharger la tôle 3 »', await viewerDownload(P, 3).isVisible())
        check('fenêtre payante : aucun report-unlock', !(await P.locator('[data-testid="report-unlock"]').count()))
        const allBtn = P.locator('[data-testid="report-actions"] button, [data-testid="report-actions"] a')
            .filter({ hasText: new RegExp(`^\\s*${T('results.downloadAll')}\\s*$`) })
        check('fenêtre payante : « Download All » d’origine dans la rangée', await allBtn.count() > 0)
        const dxfDisabled = await P.locator('[data-testid="view-mode-dxf"]').evaluate((el) => el.hasAttribute('disabled')).catch(() => null)
        check('fenêtre payante tôle 3 : Vue DXF active', dxfDisabled === false, String(dxfDisabled))
        await shot(P, 'g2-paid-modal-sheet3.png', P.locator('.modal-body').first(), 'fenêtre du résultat payant, tôle 3 téléchargeable')
        await closeDialogs(P)
    })

    const ran = scenarios.filter((s) => s.status !== 'skipped')
    exitCode = ran.length && ran.every((s) => s.status === 'green') ? 0 : 1
} catch (e) {
    log('FATAL (préparation)', String(e && e.stack || e).slice(0, 1500))
    if (freePage) await shot(freePage, '99-setup-error.png').catch(() => {})
    exitCode = 1
} finally {
    await users.updateOne({ email: FREE_EMAIL }, { $unset: { grantedUntil: '', grantedTier: '' } }).catch(() => {})
    // Aucun job laissé actif par le harnais (le prochain passage prendrait un
    // 409 concurrent_limit) : annulation par l'API, comme « Annuler ».
    if (freePage && state.freeUserId) await cancelActiveJobs(freePage, state.freeUserId).catch(() => {})
    if (paidPage) {
        const paidId = (await users.findOne({ email: PAID_EMAIL }, { projection: { id: 1 } }).catch(() => null))?.id
        if (paidId) await cancelActiveJobs(paidPage, paidId).catch(() => {})
    }
    const summary = {
        base: BASE,
        at: new Date().toISOString(),
        scenarios: scenarios.map((s) => ({
            id: s.id, title: s.title, status: s.status, durationS: s.durationS,
            checks: s.checks, error: s.error, console: (s.console || []).slice(0, 40),
        })),
        captures,
    }
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1))
    log('RÉSUMÉ :', scenarios.map((s) => `${s.id}=${s.status}`).join(' '))
    flushLogs()
    await browser.close().catch(() => {})
    await mongo.close().catch(() => {})
}
process.exit(exitCode)
