// QA J7-a — parité JS ≡ Python sur la bascule multi-tôles (étude §9.69).
//
// Le cas : UNE pièce seule trop petite pour la bande initiale (garde #2b).
// Côté navigateur, c'est le harnais qa-e2e-job.mjs (QA_ALONE sur les
// fichiers j7) qui le mesure ; ici c'est le CHEMIN SERVEUR — le worker
// nesting (core/main.py) doit, lui aussi, basculer en multi-tôles au lieu
// de refuser. Même géométrie, mêmes réglages : 1/1 posée des deux côtés.
//
// Le DXF est GÉNÉRÉ par le script (un carré de 20 × 20 mm) : aucun fichier
// privé n'entre ici. Sur la tôle 1 000 × 1 250 à espacement 4 (kerf 1,5 +
// sécurité 1), la bande initiale vaudrait 400/1 250 = 0,32 mm — l'ancien
// refus « spacing too large » tirait AVANT J7-a ; attendu désormais : BPP,
// 1 pièce posée, résultat lisible.
//
// Usage : QA_BASE_URL=http://localhost:7100 node scripts/qa-j7-server-parity.mjs
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const SHEET = { w: '1000', h: '1250' }
const KERF = '1.5'
const SAFETY = '1'

// Un carré de 20 × 20 mm en LINE, en-têtes millimètres (piège #27).
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

const logs = []
let failures = 0
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; logs.push(s); console.log(s) }
const check = (name, ok, detail = '') => {
    if (!ok) failures++
    log(ok ? 'OK  ' : 'ÉCHEC', name, detail ? `— ${detail}` : '')
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1680, height: 1000 } })
await ctx.addCookies([{ name: 'locale', value: 'fr', domain: new URL(BASE).hostname, path: '/' }])
const page = await ctx.newPage()
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))

try {
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
    const server = page.locator('.create__privacy [role="radio"]')
        .filter({ hasText: /(Our servers|Nos serveurs)/i }).first()
    await server.waitFor({ timeout: 30000 })
    await server.click()
    await page.setInputFiles('input[name="dxf"]', {
        name: 'j7-carre-20.dxf', mimeType: 'application/dxf',
        buffer: Buffer.from(dxfSquare(20), 'latin1'),
    })
    await page.waitForURL('**/project/**', { timeout: 90000 })
    const slug = page.url().split('/project/')[1].split(/[?#]/)[0]
    log('projet serveur', slug)

    // La fiche traitée par le worker (le petit carré).
    const done = await page.waitForFunction(async () => {
        const data = await window.$nuxt?.$fetch?.('/api/project/' + location.pathname.split('/').pop())
            ?? await fetch('/api/project/' + location.pathname.split('/').pop()).then((r) => r.json())
        return (data.files || []).length === 1 && data.files[0].processingStatus === 'done'
    }, { timeout: 240000 }).then(() => true).catch(() => false)
    check('la fiche est importée côté serveur', done)
    if (!done) throw new Error('fiche serveur non traitée')

    // Tôle 1 000 × 1 250, kerf 1,5, sécurité 1 → espacement 4.
    const inputs = page.locator('[data-testid="settings-sheets"] input')
    await inputs.first().fill(SHEET.w)
    await inputs.nth(1).fill(SHEET.h)
    const kerfInput = page.locator('[data-testid="settings-kerf"] input, input[data-testid="settings-kerf"]').first()
    await kerfInput.fill(KERF)
    const safetyInput = page.locator('[data-testid="settings-safety"] input, input[data-testid="settings-safety"]').first()
    await safetyInput.fill(SAFETY)
    await safetyInput.dispatchEvent('change')
    await page.waitForTimeout(800)
    const rule = await page.locator('.size__rule').textContent().catch(() => '')
    log('règle d\'espacement affichée :', rule.trim())

    await page.locator('.atelier__nest').click()
    log('nesting serveur lancé (bande initiale serait 0,32 mm ≤ espacement 4)')
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
    log('nesting serveur :', outcome, `${Math.round((Date.now() - t0) / 1000)} s`)
    // AVANT J7-a, ce cas mourait en « Spacing 4 mm is too large for this
    // instance … add more parts/stock » (main.py) ; attendu : posée 1/1.
    check('le serveur neste la petite pièce seule (bascule BPP, miroir main.py)',
        outcome === 'fini', outcome)

    if (outcome === 'fini') {
        const res = await page.evaluate(async (s) => {
            const data = await fetch(`/api/project/${s}`).then((r) => r.json())
            const results = await Promise.all((data.results || data.items || [])
                .map((r2) => fetch(`/api/result/${r2.slug ?? r2}`).then((x) => x.json()).catch(() => null)))
            return { results: data.results ?? data.items ?? null, raw: JSON.stringify(data).slice(0, 400) }
        }, slug).catch(() => null)
        log('réponse projet :', res?.raw ?? 'illisible')
    }
} catch (e) {
    failures++
    log('EXCEPTION :', String(e?.stack || e).slice(0, 800))
} finally {
    await browser.close()
    log(failures ? `${failures} VERROU(S) EN ÉCHEC` : 'TOUS LES VERROUS SONT VERTS')
    process.exit(failures ? 1 : 0)
}
