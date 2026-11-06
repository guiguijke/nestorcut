// QA E2E navigateur — le bandeau d'échec d'un job local arrive à l'écran, sans
// arracher à sa lecture un utilisateur parti ailleurs. Exécute la vraie page
// projet : c'est le seul verrou de son câblage à `useJobScroll` (le comportement
// lui-même est verrouillé par `app/tests/useJobScroll.test.js`, en vitest).
//
// Scénarios (1440x900 sauf mention, réglages d'usine, un contexte neuf chacun) :
//
//   sans_geste           pièce à la cote exacte (vrai refus moteur), aucun geste :
//                        la vue live part, puis le bandeau finit entier à l'écran.
//   molette_avant_frame  un cran de molette avant la première frame, le geste
//                        naturel pour remonter voir la vue live.
//   cran_apres_live      vue live arrivée, un cran de molette, le worker meurt :
//                        l'atelier est encore à l'écran, le bandeau est amené.
//   echec_en_vol         Nest cliqué en haut d'écran (bandeau visible à cet
//                        instant) ; échec pendant que la vue live remonte : c'est
//                        la position d'arrivée qui compte, pas celle de l'instant.
//   lit_ailleurs         molette jusque sous l'atelier, le worker meurt : la page
//                        reste où elle est, aucun défilement vers le bandeau.
//   job_suivant          enchaîné au précédent : le geste du job 1 ne compte plus,
//                        l'échec du job 2 amène le bandeau.
//   retour_echoue        A échoue pendant qu'on regarde B, retour sur A : bandeau
//                        affiché, aucun défilement (composant réutilisé, piège 47).
//   retour_en_cours      A tourne, /home, retour sur A : pas de second défilement
//                        live ; le worker meurt : le bandeau est amené.
//   grand_ecran          1440x1500 : le bandeau est visible à l'arrivée de la vue
//                        live, aucun défilement en plus.
//   telephone            390x844 : le bandeau finit entier à l'écran.
//
// « Le worker meurt » : `onerror` des workers du moteur est appelé depuis la page,
// le chemin réel d'un crash (localPool.failSlot), pour fixer l'instant de l'échec
// sur un long job au lieu de dépendre d'un temps de calcul.
//
// Prérequis : build du lot servi par `node .output/server/index.mjs` avec le calcul
// et l'import locaux activés (NUXT_PUBLIC_LOCAL_COMPUTE_ENABLED=true,
// NUXT_PUBLIC_LOCAL_IMPORT_ENABLED=true, NUXT_PUBLIC_LOCAL_AUTH_ENABLED=true),
// sur une base Mongo JETABLE : le harnais pose le compte de test et efface ses jobs.
//
// Usage :
//   QA_BASE_URL=http://localhost:7100 QA_MONGO_URI=mongodb://127.0.0.1:27018/qa_jetable \
//     node scripts/qa-e2e-failure-scroll.mjs
//   QA_SCENARIOS=sans_geste,lit_ailleurs   QA_OUT=dossier   QA_CHROMIUM_PATH=chrome.exe
// Code de sortie : 0 si tout est vert, 1 sinon. Harnais MANUEL, sans CI.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { MongoClient } from 'mongodb'

const BASE = process.env.QA_BASE_URL || ''
const MONGO_URI = process.env.QA_MONGO_URI || ''
const OUT = process.env.QA_OUT || path.resolve('.qa-pw/failure-scroll')
const ONLY = (process.env.QA_SCENARIOS || '').split(',').map((s) => s.trim()).filter(Boolean)
const EMAIL = process.env.QA_EMAIL || 'qa-failure-scroll@local.dev'
const PASSWORD = process.env.QA_PASSWORD || 'qa-failure-scroll-6f1c0a9e27d84b35'
const SETTLE_MS = 2500 // fin du défilement animé avant de mesurer

const mongoUrl = new URL(MONGO_URI || 'mongodb://invalid/invalid')
const baseUrl = new URL(BASE || 'http://invalid')
const LOCAL_HOSTS = ['localhost', '127.0.0.1']
if (!LOCAL_HOSTS.includes(baseUrl.hostname) || !LOCAL_HOSTS.includes(mongoUrl.hostname) || mongoUrl.pathname === '/nest2d') {
    throw new Error('QA_BASE_URL et QA_MONGO_URI doivent viser un serveur local et une base jetable (jamais nest2d)')
}

fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'OK ' : 'KO '} ${label}${detail ? ' — ' + detail : ''}`)
    if (!ok) failures.push(label)
}

const rectDxf = (w, h) => {
    const l = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1']
    for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]]) l.push('10', String(x), '20', String(y))
    l.push('0', 'ENDSEC', '0', 'EOF')
    return l.join('\r\n') + '\r\n'
}
const dxf = (name, w, h) => {
    const f = path.join(OUT, name)
    fs.writeFileSync(f, rectDxf(w, h))
    return f
}
const EXACT = dxf('piece-exacte.dxf', 996, 1996) // refusée : 996 + 2 x 2 de marge sur 1000 x 2000
const SMALL = dxf('piece-40.dxf', 40, 40)
// Page haute : l'atelier peut sortir de l'écran, et Nest peut être cliqué en haut.
const MANY = [SMALL, ...Array.from({ length: 18 }, (_, i) => dxf(`petite-${i}.dxf`, 30 + i, 30))]
const LONG_JOB_COUNT = '400'

const mongo = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
await mongo.connect()
const db = mongo.db()
const browser = await chromium.launch({
    headless: process.env.QA_HEADLESS !== '0',
    ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}),
    ignoreDefaultArgs: ['--hide-scrollbars'],
})

if (!(await db.collection('users').findOne({ email: EMAIL }))) {
    const reg = await fetch(BASE + '/api/auth/local/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, name: 'QA Failure Scroll', password: PASSWORD }),
    })
    if (reg.status !== 200) throw new Error(`inscription ${reg.status} (limite 5/h/IP, en mémoire : relancer le serveur)`)
}
const resetAccount = async () => {
    const user = await db.collection('users').findOneAndUpdate(
        { email: EMAIL },
        { $set: { emailVerified: true, freeNestingUsed: 0, demoNestingUsed: 0 } },
        { returnDocument: 'after' },
    )
    // Un job resté en cours après un scénario interrompu bloquerait le suivant (409).
    await db.collection('nesting_jobs').deleteMany({ ownerId: user.id })
}
await resetAccount()

async function login() {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(BASE + '/auth/local', { waitUntil: 'load' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    await sleep(800)
    await page.fill('.local-auth__form input[type="email"]', EMAIL)
    await page.fill('.local-auth__form input[type="password"]', PASSWORD)
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
    const state = await ctx.storageState()
    await ctx.close()
    return state
}
const session = await login()

function instrument() {
    window.__scrolls = []
    window.__crashAfterLiveMs = null
    const nativeScroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (arg) {
        const el = String(this.className || this.tagName).split(' ')[0]
        window.__scrolls.push({ el, block: arg?.block, y: Math.round(window.scrollY) })
        if (el === 'atelier' && window.__crashAfterLiveMs !== null) setTimeout(() => window.__crash(), window.__crashAfterLiveMs)
        return nativeScroll.call(this, arg)
    }
    const NativeWorker = window.Worker
    const engines = []
    window.Worker = class extends NativeWorker {
        constructor(url, opts) {
            super(url, opts)
            if (String(url).includes('engine.worker')) engines.push(this)
        }
    }
    // Le pool relance les walks en attente : on insiste jusqu'à ce que tous soient morts.
    window.__crash = () => {
        const t = setInterval(() => { for (const w of engines) w.onerror?.({ message: 'qa_crash' }) }, 15)
        setTimeout(() => clearInterval(t), 4000)
    }
}

async function openContext({ width = 1440, height = 900 } = {}) {
    await resetAccount()
    const ctx = await browser.newContext({ viewport: { width, height }, locale: 'en-US', storageState: session, hasTouch: width < 500 })
    const page = await ctx.newPage()
    await page.addInitScript(instrument)
    return { ctx, page }
}

async function newProject(page, files) {
    await page.goto(BASE + '/home', { waitUntil: 'load' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    await sleep(800)
    await page.setInputFiles('input[name="dxf"]', files)
    await page.waitForURL('**/project/**', { timeout: 60000 })
    await page.waitForFunction((n) => document.querySelectorAll('.files__item input.counter__value').length >= n, files.length, { timeout: 120000 })
    await sleep(800)
    return new URL(page.url()).pathname
}

const setCount = async (page, n) => {
    const counter = page.locator('.files__item input.counter__value').first()
    await counter.fill(n)
    await counter.blur()
    await sleep(600)
}
const clickNest = (page) => page.locator('.atelier__nest').first().click({ timeout: 10000 })
const route = (page, to) => page.evaluate((p) => document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push(p), to)
const scrolls = (page) => page.evaluate(() => window.__scrolls)
const probe = (page) => page.evaluate(() => {
    const r = document.querySelector('.content__error')?.getBoundingClientRect()
    return {
        y: Math.round(window.scrollY),
        banner: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), whole: r.top >= 0 && r.bottom <= window.innerHeight } : null,
    }
})
const waitBanner = (page, ms = 90000) => page.waitForSelector('.content__error', { timeout: ms })
const waitLiveScroll = (page, ms = 90000) => page.waitForFunction(() => window.__scrolls.some((s) => s.el === 'atelier'), null, { timeout: ms })
const crash = (page) => page.evaluate(() => window.__crash())
const delayPayload = (ctx, ms) => ctx.route('**/local-payload**', async (r) => { await sleep(ms); await r.continue() })
const wheelOverPage = async (page, dy) => {
    await page.mouse.move(700, 450)
    await page.mouse.wheel(0, dy)
}
const finish = async (page, name) => {
    await sleep(SETTLE_MS)
    await page.screenshot({ path: path.join(OUT, `${name}.png`) })
    return { ...(await probe(page)), scrolls: await scrolls(page) }
}
const bannerCalls = (r) => r.scrolls.filter((s) => s.el === 'content__error').length
const liveCalls = (r) => r.scrolls.filter((s) => s.el === 'atelier').length
const show = (r) => JSON.stringify(r)

const SCENARIOS = {
    async sans_geste() {
        const { ctx, page } = await openContext()
        await newProject(page, [EXACT])
        await clickNest(page)
        await waitBanner(page)
        const r = await finish(page, 'sans_geste')
        check('sans_geste : bandeau entier à l’écran', r.banner?.whole === true, show(r))
        check('sans_geste : vue live puis bandeau, une fois chacun', liveCalls(r) === 1 && bannerCalls(r) === 1)
        await ctx.close()
    },
    async molette_avant_frame() {
        const { ctx, page } = await openContext()
        await newProject(page, [EXACT])
        await delayPayload(ctx, 1500)
        await clickNest(page)
        await sleep(300)
        await wheelOverPage(page, -200)
        await waitBanner(page)
        const r = await finish(page, 'molette_avant_frame')
        check('molette_avant_frame : bandeau entier à l’écran', r.banner?.whole === true, show(r))
        await ctx.close()
    },
    async cran_apres_live() {
        const { ctx, page } = await openContext()
        await newProject(page, [SMALL])
        await setCount(page, LONG_JOB_COUNT)
        await clickNest(page)
        await waitLiveScroll(page)
        await sleep(1500)
        await wheelOverPage(page, 100)
        await sleep(500)
        await crash(page)
        await waitBanner(page)
        const r = await finish(page, 'cran_apres_live')
        check('cran_apres_live : bandeau entier à l’écran', r.banner?.whole === true, show(r))
        await ctx.close()
    },
    async echec_en_vol() {
        const { ctx, page } = await openContext()
        await newProject(page, MANY)
        await setCount(page, LONG_JOB_COUNT)
        const start = await page.evaluate(() => Math.round(document.querySelector('.atelier__nest').getBoundingClientRect().top + window.scrollY) - 8)
        await page.evaluate((y) => window.scrollTo(0, y), start)
        await sleep(400)
        await page.evaluate(() => { window.__crashAfterLiveMs = 0 })
        await clickNest(page)
        await waitBanner(page)
        const r = await finish(page, 'echec_en_vol')
        check('echec_en_vol : la vue live est bien partie de loin', r.scrolls[0]?.el === 'atelier' && r.scrolls[0].y > 500, show(r.scrolls))
        check('echec_en_vol : bandeau entier à l’écran', r.banner?.whole === true, show(r))
        await ctx.close()
    },
    async lit_ailleurs() {
        const { ctx, page } = await openContext()
        await newProject(page, MANY)
        await setCount(page, LONG_JOB_COUNT)
        await clickNest(page)
        await waitLiveScroll(page)
        await sleep(1500)
        await wheelOverPage(page, 1500)
        await sleep(800)
        const before = await probe(page)
        await crash(page)
        await waitBanner(page)
        const r = await finish(page, 'lit_ailleurs')
        check('lit_ailleurs : la page reste où elle est', Math.abs(r.y - before.y) <= 150 && bannerCalls(r) === 0, `avant ${before.y} ; ${show(r)}`)
        // Enchaîné : le geste du job 1 ne compte plus pour le job 2.
        await setCount(page, '401')
        await page.evaluate(() => window.scrollTo(0, 0))
        await sleep(300)
        const n0 = (await scrolls(page)).length
        await clickNest(page)
        await page.waitForFunction((n) => window.__scrolls.length > n, n0, { timeout: 90000 })
        await sleep(1200)
        await crash(page)
        await sleep(300)
        const r2 = await finish(page, 'job_suivant')
        check('job_suivant : bandeau entier à l’écran', r2.banner?.whole === true, show(r2))
        await ctx.close()
    },
    async retour_echoue() {
        const { ctx, page } = await openContext()
        const pB = await newProject(page, [SMALL])
        const pA = await newProject(page, [EXACT])
        await delayPayload(ctx, 3000)
        await clickNest(page)
        await sleep(500)
        await route(page, pB)
        await page.waitForURL('**' + pB)
        await sleep(5500)
        const n0 = (await scrolls(page)).length
        await page.evaluate(() => window.scrollTo(0, 0))
        await route(page, pA)
        await page.waitForURL('**' + pA)
        await waitBanner(page)
        const r = await finish(page, 'retour_echoue')
        check('retour_echoue : bandeau affiché, aucun défilement au retour', Boolean(r.banner) && r.scrolls.length === n0, show(r))
        await ctx.close()
    },
    async retour_en_cours() {
        const { ctx, page } = await openContext()
        const pA = await newProject(page, [SMALL])
        await setCount(page, LONG_JOB_COUNT)
        await clickNest(page)
        await waitLiveScroll(page)
        await route(page, '/home')
        await page.waitForURL('**/home')
        await sleep(800)
        await route(page, pA)
        await page.waitForURL('**' + pA)
        await sleep(1200)
        await page.evaluate(() => window.scrollTo(0, 0))
        await sleep(300)
        await crash(page)
        await waitBanner(page)
        const r = await finish(page, 'retour_en_cours')
        check('retour_en_cours : un seul défilement live', liveCalls(r) === 1, show(r.scrolls))
        check('retour_en_cours : bandeau entier à l’écran', r.banner?.whole === true, show(r))
        await ctx.close()
    },
    async grand_ecran() {
        const { ctx, page } = await openContext({ height: 1500 })
        await newProject(page, [EXACT])
        await clickNest(page)
        await waitBanner(page)
        const r = await finish(page, 'grand_ecran')
        check('grand_ecran : bandeau entier à l’écran', r.banner?.whole === true, show(r))
        check('grand_ecran : aucun défilement vers le bandeau', bannerCalls(r) === 0, show(r.scrolls))
        await ctx.close()
    },
    async telephone() {
        const { ctx, page } = await openContext({ width: 390, height: 844 })
        await newProject(page, [EXACT])
        await clickNest(page)
        await waitBanner(page)
        const r = await finish(page, 'telephone')
        check('telephone : bandeau entier à l’écran', r.banner?.whole === true, show(r))
        await ctx.close()
    },
}

for (const [name, run] of Object.entries(SCENARIOS)) {
    if (ONLY.length && !ONLY.includes(name)) continue
    try {
        await run()
    } catch (e) {
        check(`${name} : déroulement`, false, String(e?.message || e).split('\n')[0])
    }
}

await browser.close()
await mongo.close()
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est vert')
process.exitCode = failures.length ? 1 : 0
