// QA lot J8-e (étude §9.73, 8.3-quater) — que l'utilisateur n'ait JAMAIS à
// compter ses fichiers.
//
//   (a) 25 fichiers en mode SERVEUR ⇒ DEUX requêtes (lots automatiques de
//       MAX_UPLOAD_FILES = 20), 25 fiches importées, AUCUN message d'erreur ;
//   (b) une requête refusée par le serveur ⇒ le refus est À L'ÉCRAN, avec
//       le message du serveur ET les noms des fichiers du lot en cause —
//       plus jamais le défaut muet mesuré en production ;
//   (c) 30 fichiers en mode APPAREIL ⇒ 30 fiches et le nesting aboutit (il
//       n'y a AUCUN plafond de nombre sur ce chemin — on ne l'affirme pas
//       sans preuve, on le mesure, §9.73 point 31) ;
//   (d) au passage, le négatif J8-a sur ce projet SANS `.job` : aucun bouton
//       `.job` au rapport, le DXF reste « Télécharger » primaire.
//
// Les DXF sont GÉNÉRÉS par le script (carrés de 20 × 20 mm, en-têtes
// millimètres) : aucun fichier privé n'entre ici.
//
// Usage : QA_BASE_URL=http://localhost:7100 node scripts/qa-j8-uploads.mjs
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'

const dxfSquare = (size) => {
    const s = size / 2
    const lines = [
        [[-s, -s], [s, -s]], [[s, -s], [s, s]], [[s, s], [-s, s]], [[-s, s], [-s, -s]],
    ]
    const f = (v) => (Number.isInteger(v) ? v + '.0' : String(v))
    let h = 0x2f
    const entities = lines.map(([a, b]) => {
        const handle = (h++).toString(16).toUpperCase()
        return `0\r\nLINE\r\n5\r\n${handle}\r\n8\r\n0\r\n10\r\n${f(a[0])}\r\n20\r\n${f(a[1])}\r\n30\r\n0.0\r\n11\r\n${f(b[0])}\r\n21\r\n${f(b[1])}\r\n31\r\n0.0`
    }).join('\r\n')
    return `0\r\nSECTION\r\n2\r\nHEADER\r\n9\r\n$ACADVER\r\n1\r\nAC1009\r\n9\r\n$INSUNITS\r\n70\r\n4\r\n9\r\n$MEASUREMENT\r\n70\r\n1\r\n0\r\nENDSEC\r\n0\r\nSECTION\r\n2\r\nENTITIES\r\n${entities}\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n`
}

const fakeDxf = (name) => ({
    name, mimeType: 'application/dxf',
    buffer: Buffer.from(dxfSquare(20), 'latin1'),
})

const logs = []
let failures = 0
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; logs.push(s); console.log(s) }
const check = (name, ok, detail = '') => {
    if (!ok) failures++
    log(ok ? 'OK  ' : 'ÉCHEC', name, detail ? `— ${detail}` : '')
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1680, height: 1000 }, acceptDownloads: true })
await ctx.addCookies([{ name: 'locale', value: 'fr', domain: new URL(BASE).hostname, path: '/' }])
const page = await ctx.newPage()
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))

const login = async () => {
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', 'guillaume@local.dev')
    await page.fill('.local-auth__form input[type="password"]', 'nestorcut-local-2026')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
}

const createProject = async (files, mode) => {
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const card = page.locator('.create__privacy [role="radio"]')
        .filter({ hasText: mode === 'device' ? /(This device|Cet appareil)/i : /(Our servers|Nos serveurs)/i })
        .first()
    await card.waitFor({ timeout: 30000 })
    await card.click()
    await page.setInputFiles('input[name="dxf"]', files)
    try {
        await page.waitForURL('**/project/**', { timeout: 120000 })
    } catch (e) {
        const banner = (await page.locator('.content__error, .create__error, [class*="error"]').allInnerTexts().catch(() => [])).join(' | ').slice(0, 300)
        log('NAVIGATION MANQUÉE — url:', page.url(), '— bannière :', banner)
        throw e
    }
    return page.url().split('/project/')[1].split(/[?#]/)[0]
}

const serverDone = async (slug, expected, timeoutMs = 300000) => {
    const t0 = Date.now()
    let lastSeen = 'jamais'
    while (Date.now() - t0 < timeoutMs) {
        const done = await page.evaluate(async ({ s, n }) => {
            const data = await fetch(`/api/project/${s}`).then((r) => r.json()).catch(() => null)
            const files = data?.files || []
            return { ok: files.length >= n && files.every((f) => f.processingStatus === 'done'), seen: files.length }
        }, { s: slug, n: expected }).catch((e) => ({ ok: false, seen: 'ERR ' + String(e).slice(0, 80) }))
        lastSeen = String(done.seen)
        if (done.ok) return true
        await page.waitForTimeout(2000)
    }
    log(`serverDone épuisé (${expected} attendues) — dernières fiches vues : ${lastSeen}`)
    return false
}

try {
    await login()
    log('connecté')

    // ---------- (a) 25 fichiers en mode SERVEUR : deux lots, zéro erreur --
    {
        const files = Array.from({ length: 25 }, (_, k) => fakeDxf(`j8-lot-a-${String(k + 1).padStart(2, '0')}.dxf`))
        // Le premier lot (20 fichiers) part DANS LA CRÉATION du projet
        // (POST /api/project, FormData), le restant suit par UNE requête
        // addfiles : le transfert complet = DEUX requêtes porteuses de
        // fichiers, aucune ne dépasse le plafond serveur.
        let fileRequests = 0
        const onRequest = (req) => {
            if (req.method() !== 'POST') return
            if (req.url().includes('/addfiles')
                || /\/api\/project\/?$/.test(new URL(req.url()).pathname)) fileRequests++
        }
        page.on('request', onRequest)
        const slug = await createProject(files, 'server')
        const ok = await serverDone(slug, 25)
        page.off('request', onRequest)
        const banner = (await page.locator('.content__error').allInnerTexts().catch(() => [])).join(' ').trim()
        check('J8e-a 25 fichiers serveur : 25 fiches importées', ok, ok ? '' : 'fiches non toutes done')
        check('J8e-a la dépose est passée par DEUX requêtes (création + lot suivant)',
            fileRequests === 2, `${fileRequests} requête(s) portant des fichiers`)
        check('J8e-a aucun message d\'erreur', banner === '', banner.slice(0, 160))
        log('projet serveur', slug)
    }

    // ---------- (b) un lot refusé : le refus s'affiche, avec les noms -----
    {
        const files = Array.from({ length: 25 }, (_, k) => fakeDxf(`j8-lot-b-${String(k + 1).padStart(2, '0')}.dxf`))
        // Le premier lot (création, 20 fichiers) passe ; la requête ADDFILES
        // qui porte les 5 restants est refusée par le serveur (simulation
        // 400, même forme que Nitro createError) : les 5 fichiers doivent
        // être NOMMÉS à l'écran — le défaut muet d'avant J8-e.
        let interceptedAddfiles = 0
        await page.route('**/addfiles', async (route) => {
            interceptedAddfiles++
            await route.fulfill({
                status: 400,
                contentType: 'application/json',
                body: JSON.stringify({ statusCode: 400, message: 'Refus simulé — lot trop lourd.' }),
            })
        })
        const slug = await createProject(files, 'server')
        await serverDone(slug, 20)
        await page.waitForTimeout(1500)
        const banner = (await page.locator('.content__error').allInnerTexts().catch(() => []))
            .join(' ').replace(/\s+/g, ' ').trim()
        log('bannière :', banner.slice(0, 300))
        await page.unroute('**/addfiles')
        check('J8e-b la requête addfiles du restant a bien eu lieu (et été refusée)',
            interceptedAddfiles === 1, `${interceptedAddfiles} requête(s) interceptée(s)`)
        check('J8e-b le refus est À L\'ÉCRAN',
            banner.includes('Refus simulé'), banner.slice(0, 160))
        check('J8e-b les fichiers du lot refusé sont NOMMÉS',
            banner.includes('j8-lot-b-21') && banner.includes('j8-lot-b-25'),
            banner.slice(0, 200))
        // Le premier lot a bien été importé : projet rempli à moitié, DIT.
        check('J8e-b le premier lot (20 fichiers) a bien été importé',
            await serverDone(slug, 20), 'fiches du premier lot attendues')
    }

    // ---------- (c) 30 fichiers en mode APPAREIL : 30 fiches, nesting -----
    {
        const files = Array.from({ length: 30 }, (_, k) => fakeDxf(`j8-appareil-${String(k + 1).padStart(2, '0')}.dxf`))
        const slug = await createProject(files, 'device')
        await page.waitForFunction(
            (n) => document.querySelectorAll('[data-testid="file-card"], .file').length >= n,
            30,
            { timeout: 240000 },
        ).catch(() => log('ATTENTION : 30 fiches attendues'))
        const count = await page.evaluate(async (s) => {
            const db = await new Promise((res, rej) => {
                const r = indexedDB.open('nestorcut-local')
                r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
            })
            const recs = await new Promise((res, rej) => {
                const tx = db.transaction('files', 'readonly').objectStore('files').getAll()
                tx.onsuccess = () => res(tx.result || []); tx.onerror = () => rej(tx.error)
            })
            return recs.filter((r) => r.projectSlug === s).length
        }, slug).catch(() => -1)
        check('J8e-c 30 fichiers appareil : 30 fiches (aucun plafond de nombre)',
            count === 30, `${count} fiche(s)`)

        await page.locator('.atelier__nest').waitFor({ timeout: 30000 })
        await page.locator('.atelier__nest').click()
        const t0 = Date.now()
        let outcome = 'timeout'
        while (Date.now() - t0 < 8 * 60 * 1000) {
            const err = (await page.locator('.content__error').allInnerTexts().catch(() => []))
                .map((s) => s.trim()).filter(Boolean).join(' | ')
            if (err) { outcome = 'erreur: ' + err; break }
            const item = page.locator('.results__item').first()
            if (await item.count()) {
                if (await item.locator('.result__placeholder').count()) { outcome = 'échec'; break }
                if (await item.locator('.controls__report, .controls__download').count()) { outcome = 'fini'; break }
            }
            await page.waitForTimeout(2000)
        }
        check('J8e-c le nesting des 30 pièces aboutit', outcome === 'fini', outcome)

        // Négatif J8-a : projet SANS `.job` — aucun bouton `.job`, le DXF
        // reste « Télécharger » PRIMAIRE (rien ne change pour un projet
        // ordinaire, §9.73 point 4).
        if (outcome === 'fini') {
            await page.locator('.results__item .controls__report').first().click()
            await page.waitForSelector('.modal__report, .result-report', { timeout: 60000 })
            const labels = await page.locator('.result-report button, .result-report a').allInnerTexts()
                .then((xs) => xs.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean))
            log('boutons (projet sans .job) :', JSON.stringify(labels))
            check('J8-a négatif : aucun bouton .job sur un projet ordinaire',
                !labels.some((l) => /\.job/i.test(l)), labels.join(' | '))
            const dl = page.locator('.result-report button').filter({ hasText: /^Télécharger$|^Download$/ }).first()
            const cls = await dl.getAttribute('class').catch(() => '')
            check('J8-a négatif : le DXF reste « Télécharger » PRIMAIRE',
                Boolean(cls) && /button--theme-primary/.test(cls), String(cls).slice(0, 80))
        }
    }
} catch (e) {
    failures++
    log('EXCEPTION :', String(e?.stack || e).slice(0, 800))
} finally {
    await browser.close()
    log(failures ? `${failures} VERROU(S) EN ÉCHEC` : 'TOUS LES VERROUS SONT VERTS')
    process.exit(failures ? 1 : 0)
}
