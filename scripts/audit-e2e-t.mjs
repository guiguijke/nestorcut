// Audit E2E — transversal T-2 (langues FR) et T-3 (vieux résultats).
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = path.join(process.env.USERPROFILE || '', 'qa-out', 'audit-e2e')
const ECRIN = path.resolve('.testparts/ecrin de valandry.dxf')

const logs = []
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; logs.push(s); console.log(s) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = {}
let failures = 0
const check = (id, name, ok, detail = '') => {
    results[`${id} ${name}`] = { ok: Boolean(ok), detail: String(detail).slice(0, 300) }
    if (!ok) failures++
    log(ok ? 'OK  ' : 'ROUGE', id, name, detail ? `— ${String(detail).slice(0, 170)}` : '')
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1680, height: 1000 } })
await ctx.addCookies([{ name: 'locale', value: 'fr', domain: new URL(BASE).hostname, path: '/' }])
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))
const shot = async (name) => page.screenshot({ path: path.join(OUT, name), timeout: 30000 }).catch(() => { })

// Une clé i18n brute affichée ressemble à « xxx.yyy » (mot.mot) — jamais du
// français. Apostrophe cassée : « l\u2019 » en littéral ou « &#39; ».
const rawKey = (s) => /^[a-z]{2,}\.[a-zA-Z]+(\.[a-zA-Z]+)?$/.test(s.trim())

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
    await page.locator('.unit-switch button, .unit-switch [role="radio"], .unit-switch [class*="option"]').filter({ hasText: /^mm$/ }).first().click().catch(() => { })
    await sleep(500)

    // ---- T-2 : parcours représentatif en FR ------------------------------
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const card = page.locator('.create__privacy [role="radio"]').filter({ hasText: /(Cet appareil|This device)/i }).first()
    await card.click().catch(() => { })
    await page.setInputFiles('input[name="dxf"]', [ECRIN])
    await page.waitForURL('**/project/**', { timeout: 90000 })
    const slug = page.url().split('/project/')[1].split(/[?#]/)[0]
    await page.waitForFunction(() => document.querySelectorAll('.files__item input.counter__value').length === 1, null, { timeout: 240000 })
    await sleep(1000)

    const ficheLine = (await page.locator('.file__parts').first().innerText()).replace(/\s+/g, ' ').trim()
    check('T-2a', 'FR : fiche « 1 bloc · 17 pièces »', /1 bloc · 17 pièces/.test(ficheLine), ficheLine)
    await shot('T-2-fiche-fr.png')

    await page.locator('[data-testid="file-scale"]').first().click()
    await page.locator('[data-testid="import-preview"]').waitFor({ timeout: 30000 })
    const previewTxt = (await page.locator('[data-testid="import-preview"]').innerText()).replace(/\s+/g, ' ').trim()
    const previewKeys = previewTxt.split(/\s+/).filter(rawKey)
    check('T-2b', 'FR : aperçu d’échelle sans clé brute ni apostrophe cassée',
        previewKeys.length === 0 && !/\\u2019|&#39;|l\u00C3\u00A9/.test(previewTxt),
        `clés brutes : ${previewKeys.join(',') || 'aucune'} ; « ${previewTxt.slice(0, 90)} »`)
    await page.locator('[data-testid="import-preview-cancel"]').click()
    await sleep(400)

    await page.locator('[data-testid="file-explode"]').first().click()
    await page.locator('[data-testid="explode-confirm"]').waitFor({ timeout: 10000 })
    const confirmTxt = (await page.locator('[data-testid="explode-confirm"]').innerText()).replace(/\s+/g, ' ').trim()
    check('T-2c', "FR : confirmation d'éclatement lisible (17 pièces, irréversible)",
        confirmTxt.includes('17') && /(irréversible|annuler)/i.test(confirmTxt) && !rawKey(confirmTxt),
        confirmTxt.slice(0, 120))
    await shot('T-2-confirmation-fr.png')
    await page.locator('[data-testid="explode-confirm-cancel"]').click()
    await sleep(400)

    // ---- T-3 : vieux résultat (forme d'avant J4/E4 : sans champ jobs) ----
    // Un résultat ordinaire d'AUJOURD'HUI sans `.job` a exactement la forme
    // d'avant J4 (pas de champ jobs) : on neste le bloc et on rouvre le
    // résultat — l'hydratation doit être silencieuse et le bouton .job absent.
    await page.goto(BASE + '/project/' + slug, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelectorAll('.files__item input.counter__value').length === 1, null, { timeout: 60000 })
    await sleep(1500)
    const dims = page.locator('.size__sheet').first().locator('.size__line .input__value')
    await dims.nth(0).fill('6000'); await dims.nth(0).blur()
    await dims.nth(1).fill('1500'); await dims.nth(1).blur()
    await sleep(400)
    await page.locator('.atelier__nest').click()
    const t0 = Date.now()
    let nested = false
    while (Date.now() - t0 < 300000) {
        if (!(await page.locator('.result__cancel').count())
            && (await page.locator('.results__item .controls__report, .results__item .controls__download').count())) {
            nested = true
            break
        }
        await sleep(2000)
    }
    if (!nested) throw new Error('nesting T-3 non terminé')
    await page.locator('[data-testid="result-area"]').first().click()
    await page.waitForSelector('.modal', { timeout: 30000 })
    await sleep(2500)
    const modalTxt = (await page.locator('[data-testid="result-state"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    const jobBtn = await page.locator('button, a').filter({ hasText: /\.job/i }).count()
    check('T-3', 'résultat sans .job rouvert : hydratation sans erreur, pas de bouton .job',
        pageErrors.length === 0 && jobBtn === 0 && modalTxt.length > 0,
        `pageerror=${pageErrors.length}, boutons .job=${jobBtn}, état « ${modalTxt.slice(0, 60)} »`)

    results['_pageErrors'] = pageErrors.slice(0, 6)
    log(failures ? `${failures} ROUGE(S)` : 'T-2/T-3 : TOUT VERT')
} catch (e) {
    log('EXCEPTION', String(e).slice(0, 500))
    failures++
    await shot('99-erreur-t.png').catch(() => { })
} finally {
    fs.writeFileSync(path.join(OUT, 't-resultats.json'), JSON.stringify(results, null, 1))
    await browser.close()
}
process.exit(failures ? 1 : 0)
