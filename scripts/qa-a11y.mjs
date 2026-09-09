// QA accessibilité — axe-core sur les écrans du plan UI PRO (U3 passe 3).
//
// Pages auditées : auth (connexion), home (accueil), project (page projet
// après import), modal-desktop et modal-mobile (l'espace de résultat).
// Chaque page produit docs/qa/ui-pro-2026-09-07/a11y-<page>.json.
//
// VERROU : 0 violation « serious » ou « critical » — sinon sortie 1.
// Le même script mesure sur la modale ce qu'axe ne voit pas : focus piégé
// (Tab / Shift+Tab), Échap qui ferme, focus rendu au déclencheur
// (a11y-modal-focus.json).
//
// Prérequis : `playwright` n'est PAS dans package.json (il ferait
// télécharger les navigateurs à chaque build d'image) — l'installer hors
// verrou : `npm i --no-save playwright && npx playwright install chromium`.
// Seul `@axe-core/playwright` est en devDependencies (AGENTS §5).
//
// Usage : QA_BASE_URL=http://localhost:7100 node scripts/qa-a11y.mjs
import { AxeBuilder } from '@axe-core/playwright'
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = process.env.QA_A11Y_OUT || path.join(ROOT, 'docs', 'qa', 'ui-pro-2026-09-07')
fs.mkdirSync(OUT, { recursive: true })

const TROU = path.join(ROOT, '.testparts', 'Piece_Trou.DXF')
const FILL = path.join(ROOT, '.testparts', 'Piece_Fillx4.DXF')
// Petites quantités : l'audit a11y n'a pas besoin d'un banc de 900 pièces,
// seulement d'un résultat complet à ouvrir.
const TRO_QTY = process.env.QA_TRO_QTY || '6'
const FILL_QTY = process.env.QA_FILL_QTY || '12'

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))

const summary = []
let bad = 0

const scan = async (name) => {
    const res = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    const serious = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    const payload = {
        page: name,
        url: res.url,
        timestamp: res.timestamp,
        viewport: page.viewportSize(),
        counts: {
            violations: res.violations.length,
            seriousOrCritical: serious.length,
            passes: res.passes.length,
            incomplete: res.incomplete.length,
        },
        violations: res.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            helpUrl: v.helpUrl,
            nodes: v.nodes.map((n) => ({ target: n.target, failureSummary: n.failureSummary })),
        })),
    }
    fs.writeFileSync(path.join(OUT, `a11y-${name}.json`), JSON.stringify(payload, null, 2) + '\n')
    const line = `${name}: ${res.violations.length} violation(s), dont ${serious.length} sérieuse(s)/critique(s)`
    log(line)
    for (const v of serious) log(`   ${v.impact.toUpperCase()} ${v.id} — ${v.help} (${v.nodes.length})`)
    summary.push({ name, ...payload.counts })
    bad += serious.length
}

const focusInfo = () => page.evaluate(() => {
    const el = document.activeElement
    const modal = document.querySelector('.modal-body')
    return {
        tag: el ? el.tagName.toLowerCase() : null,
        testid: el?.getAttribute?.('data-testid') || null,
        label: (el?.getAttribute?.('aria-label') || el?.innerText || '').trim().slice(0, 40),
        insideModal: Boolean(modal && el && modal.contains(el)),
    }
})

try {
    // ---------- auth ----------
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    await scan('auth')

    // ---------- connexion + accueil ----------
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', 'guillaume@local.dev')
    await page.fill('.local-auth__form input[type="password"]', 'nestorcut-local-2026')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    await page.waitForTimeout(1200)
    await scan('home')

    // ---------- projet ----------
    await page.setInputFiles('input[name="dxf"]', [TROU, FILL])
    await page.waitForURL('**/project/**', { timeout: 60000 })
    await page.waitForFunction(
        () => document.querySelectorAll('.files__item input.counter__value').length === 2,
        null, { timeout: 180000 })
    const cards = page.locator('.files__item')
    for (let i = 0; i < await cards.count(); i++) {
        const name = await cards.nth(i).locator('.file__name').innerText().catch(() => '')
        const target = /Piece_Trou/i.test(name) ? TRO_QTY : FILL_QTY
        const input = cards.nth(i).locator('input.counter__value')
        await input.click(); await input.fill(target); await input.blur()
    }
    const sheet = page.locator('.size__sheet').first()
    const dims = sheet.locator('.size__line .input__value')
    if (String(await dims.nth(1).inputValue()) !== '1000') { await dims.nth(1).fill('1000'); await dims.nth(1).blur() }
    await page.waitForTimeout(500)
    await scan('project')

    // ---------- nesting puis modale résultat ----------
    log('nest clicked')
    await page.locator('.atelier__nest').click()
    let outcome = 'timeout'
    const t0 = Date.now()
    while (Date.now() - t0 < 300000) {
        await page.waitForTimeout(2000)
        const errTxt = (await page.locator('.content__error').allInnerTexts().catch(() => [])).join(' ')
        if (errTxt) { outcome = 'page-error: ' + errTxt; break }
        const stageRunning = await page.locator('.stage__status').count()
        const doneBtn = await page.locator('[data-testid="result-report-btn"]').count()
        if (doneBtn && !stageRunning) { outcome = 'done'; break }
    }
    log('compute outcome:', outcome, `(${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    if (outcome !== 'done') throw new Error('nest did not complete: ' + outcome)
    await page.waitForTimeout(1500)

    // Le déclencheur : c'est à LUI que le focus doit revenir à la fermeture.
    const trigger = page.locator('[data-testid="result-report-btn"]').first()
    await trigger.focus()
    const triggerBefore = await focusInfo()
    await trigger.click()
    await page.waitForSelector('.modal-body', { timeout: 15000 })
    await page.waitForTimeout(1500)
    await scan('modal-desktop')

    // ---- focus piégé / Échap / restitution (ce qu'axe ne mesure pas) ----
    const focusAfterOpen = await focusInfo()
    const trap = []
    for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab')
        trap.push(await page.evaluate(() => {
            const modal = document.querySelector('.modal-body')
            return Boolean(modal && document.activeElement && modal.contains(document.activeElement))
        }))
    }
    const backTrap = []
    for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Shift+Tab')
        backTrap.push(await page.evaluate(() => {
            const modal = document.querySelector('.modal-body')
            return Boolean(modal && document.activeElement && modal.contains(document.activeElement))
        }))
    }

    // ---------- modale en mobile ----------
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(1200)
    await scan('modal-mobile')
    await page.setViewportSize({ width: 1680, height: 1000 })
    await page.waitForTimeout(600)

    // ---- Échap ferme, le focus revient au déclencheur ----
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    const modalGone = (await page.locator('.modal-body').count()) === 0
    const focusAfterClose = await focusInfo()

    const focusReport = {
        trigger: triggerBefore,
        focusAfterOpen,
        tabStaysInModal: trap.every(Boolean),
        tabSteps: trap.length,
        shiftTabStaysInModal: backTrap.every(Boolean),
        shiftTabSteps: backTrap.length,
        escapeClosesModal: modalGone,
        focusAfterClose,
        focusReturnedToTrigger: focusAfterClose.testid === triggerBefore.testid
            && focusAfterClose.testid != null,
    }
    fs.writeFileSync(path.join(OUT, 'a11y-modal-focus.json'), JSON.stringify(focusReport, null, 2) + '\n')
    log('FOCUS:', JSON.stringify(focusReport))
    for (const [k, v] of Object.entries({
        tabStaysInModal: focusReport.tabStaysInModal,
        shiftTabStaysInModal: focusReport.shiftTabStaysInModal,
        escapeClosesModal: focusReport.escapeClosesModal,
        focusReturnedToTrigger: focusReport.focusReturnedToTrigger,
    })) {
        if (!v) { bad += 1; log('FAIL —', k) }
    }

    console.log('\n--- a11y ---')
    for (const s of summary) console.log(`  ${s.name}: ${s.violations} violation(s), ${s.seriousOrCritical} sérieuse(s)/critique(s)`)
    console.log(bad === 0
        ? 'GO — 0 violation sérieuse ou critique, focus piégé, Échap, retour de focus'
        : `NO-GO — ${bad} point(s) en échec`)
    await browser.close()
    process.exit(bad === 0 ? 0 : 1)
} catch (e) {
    console.error('a11y FAIL:', e.message)
    await page.screenshot({ path: path.join(OUT, 'a11y-fail.png') }).catch(() => {})
    await browser.close()
    process.exit(1)
}
