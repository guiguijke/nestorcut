// QA E2E navigateur — une page dont un chunk échoue au démarrage ne doit pas
// rester morte (constat prod 04/11 : 522 Cloudflare sur un chunk de 63 octets de
// /auth/local, page affichée, bouton « Login » sans effet ; AGENTS.md §2 #64).
//
// Ce que le harnais affirme, sans compte ni base (page publique) :
//
//   matrice   chaque chunk JS demandé par /auth/local échoue UNE fois, en 522
//             après QA_FAIL_DELAY_MS (une vraie 522 arrive après une longue
//             attente, donc pendant que l'import partage le préchargement) :
//             le bouton de bascule doit réagir avant QA_LIMIT_MS.
//   panne     un chunk vital échoue TOUJOURS : au plus deux chargements du
//             document si l'échec est rapide, un rechargement toutes les 10 s
//             au plus s'il est lent (pas de boucle serrée).
//   tiers     un script module tiers refusé par la CSP (la balise Cloudflare en
//             prod) : aucun rechargement.
//   apres     un chunk paresseux qui échoue APRÈS le démarrage (calcul en cours,
//             saisie) : aucun rechargement, la saisie reste.
//
// Usage :
//   QA_BASE_URL=http://localhost:7391 node scripts/qa-e2e-chunk-failure.mjs
//   QA_FAIL_DELAY_MS=3000  QA_LIMIT_MS=15000  QA_CONCURRENCY=4
// Code de sortie : 0 si tout est vert, 1 sinon.
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const URL_PAGE = BASE + '/auth/local'
const FAIL_DELAY_MS = Number(process.env.QA_FAIL_DELAY_MS || 3000)
const LIMIT_MS = Number(process.env.QA_LIMIT_MS || 15000)
const CONCURRENCY = Number(process.env.QA_CONCURRENCY || 4)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fail522 = (r) => r.fulfill({ status: 522, contentType: 'text/plain', body: 'error code: 522' })
const shortName = (u) => new URL(u).pathname.split('/').pop()

const failures = []
const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'OK ' : 'KO '} ${label}${detail ? ' — ' + detail : ''}`)
    if (!ok) failures.push(label)
}

async function openPage(browser) {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1000, height: 800 } })
    const page = await ctx.newPage()
    const state = { documents: 0 }
    page.on('request', (r) => {
        if (r.isNavigationRequest() && r.frame() === page.mainFrame()) state.documents++
    })
    return { ctx, page, state }
}

/** Clique le bouton de bascule jusqu'à ce que le titre change ; rend le délai en ms, ou null. */
async function firstReaction(page, t0, limit = LIMIT_MS) {
    const title = page.locator('.local-auth__title').first()
    const toggle = page.locator('.local-auth__toggle').first()
    while (Date.now() - t0 < limit) {
        const before = await title.innerText({ timeout: 300 }).catch(() => null)
        if (before === null) { await sleep(100); continue }
        await toggle.click({ timeout: 300 }).catch(() => {})
        await sleep(100)
        const after = await title.innerText({ timeout: 300 }).catch(() => null)
        if (after !== null && after !== before) return Date.now() - t0
    }
    return null
}

/** Chunks JS d'un chargement normal, dans l'ordre des requêtes. */
async function listChunks(browser) {
    const { ctx, page } = await openPage(browser)
    const chunks = new Set()
    page.on('request', (r) => {
        if (/\/_nuxt\/[^/]+\.js$/.test(new URL(r.url()).pathname)) chunks.add(r.url())
    })
    const t0 = Date.now()
    await page.goto(URL_PAGE, { waitUntil: 'commit' })
    const reacted = await firstReaction(page, t0)
    await page.waitForLoadState('networkidle').catch(() => {})
    await ctx.close()
    return { chunks: [...chunks], reacted }
}

async function failOnce(browser, chunk) {
    const { ctx, page, state } = await openPage(browser)
    let hits = 0
    await page.route(chunk, async (r) => {
        hits++
        if (hits > 1) return r.continue()
        await sleep(FAIL_DELAY_MS)
        return fail522(r)
    })
    const t0 = Date.now()
    await page.goto(URL_PAGE, { waitUntil: 'commit' })
    const reacted = await firstReaction(page, t0)
    await ctx.close()
    return { chunk: shortName(chunk), reacted, documents: state.documents, hits }
}

async function runMatrix(browser, chunks) {
    const queue = [...chunks]
    const results = []
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length) results.push(await failOnce(browser, queue.shift()))
    }))
    return results
}

const browser = await chromium.launch()
try {
    const { chunks, reacted } = await listChunks(browser)
    check('chargement normal : le bouton réagit', reacted !== null, `${reacted} ms, ${chunks.length} chunks`)

    const results = await runMatrix(browser, chunks)
    const dead = results.filter((r) => r.reacted === null)
    const worst = Math.max(...results.map((r) => r.reacted ?? 0))
    const reloaded = results.filter((r) => r.documents > 1).length
    console.log(`matrice : ${results.length} chunks, ${dead.length} pages mortes, ${reloaded} rechargements, pire délai ${worst} ms`)
    check('matrice : chaque chunk en échec une fois laisse une page vivante', dead.length === 0,
        dead.map((r) => r.chunk).join(' '))

    // Un chunk dont la perte a vraiment fait recharger : un chunk inutile au
    // démarrage rendrait les deux assertions suivantes vides.
    const vital = results.find((r) => r.documents > 1)
    check('matrice : au moins un chunk vital a déclenché un rechargement', Boolean(vital), vital?.chunk)
    const persistent = (delay, ms) => async () => {
        const { ctx, page, state } = await openPage(browser)
        const loads = []
        page.on('request', (r) => {
            if (r.isNavigationRequest() && r.frame() === page.mainFrame()) loads.push(Date.now())
        })
        await page.route(`**/_nuxt/${vital.chunk}`, async (r) => { await sleep(delay); return fail522(r).catch(() => {}) })
        await page.goto(URL_PAGE, { waitUntil: 'commit' })
        await sleep(ms)
        await ctx.close()
        return { documents: state.documents, gaps: loads.slice(1).map((t, i) => t - loads[i]) }
    }
    if (vital) {
        // Délais fixes, indépendants de QA_FAIL_DELAY_MS : l'un sous la garde de
        // 10 s (c'est lui qui verrouille la garde : on abandonne après un essai),
        // l'autre au-dessus, où la garde ne bloque rien : on vérifie seulement
        // que la page réessaie tant que la panne dure.
        const quick = await persistent(1000, 7000)()
        check('panne durable, échec rapide : au plus 2 chargements du document', quick.documents <= 2, `${quick.documents} chargements`)
        const slow = await persistent(11000, 36000)()
        check('panne durable, échec lent : la page continue de réessayer',
            slow.documents >= 3 && slow.documents <= 4 && slow.gaps.every((g) => g >= 10000),
            `${slow.documents} chargements, écarts ${slow.gaps.join(' ')} ms`)
    }
    {
        const { ctx, page, state } = await openPage(browser)
        await page.addInitScript(() => {
            // L'erreur doit tomber AVANT la fin de l'hydratation : après, le script
            // ne recharge plus et le filtre /_nuxt/ ne serait pas éprouvé.
            window.addEventListener('error', (e) => {
                if (!e.target?.src?.includes('cloudflareinsights')) return
                const app = document.getElementById('__nuxt')?.__vue_app__
                window.__beaconError = { booted: app?.$nuxt?.isHydrating === false }
            }, true)
            document.addEventListener('DOMContentLoaded', () => {
                const s = document.createElement('script')
                s.type = 'module'
                s.src = 'https://static.cloudflareinsights.com/beacon.min.js'
                document.body.appendChild(s)
            })
        })
        const t0 = Date.now()
        await page.goto(URL_PAGE, { waitUntil: 'commit' })
        const r = await firstReaction(page, t0)
        await sleep(1500)
        const beacon = await page.evaluate(() => window.__beaconError ?? null)
        check('script tiers refusé : erreur reçue avant la fin de l’hydratation', beacon?.booted === false, JSON.stringify(beacon))
        check('script tiers refusé : aucun rechargement', r !== null && state.documents === 1, `${state.documents} chargements`)
        await ctx.close()
    }
    {
        const { ctx, page, state } = await openPage(browser)
        const t0 = Date.now()
        await page.goto(URL_PAGE, { waitUntil: 'commit' })
        await firstReaction(page, t0)
        const email = page.locator('#local-auth-email')
        await email.fill('saisie@exemple.test')
        await page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError', { cancelable: true })))
        await sleep(1500)
        const kept = await email.inputValue()
        check('chunk en échec après le démarrage : aucun rechargement, saisie conservée',
            state.documents === 1 && kept === 'saisie@exemple.test', `${state.documents} chargements, « ${kept} »`)
        await ctx.close()
    }
} finally {
    await browser.close()
}

console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est vert')
process.exit(failures.length ? 1 : 0)
