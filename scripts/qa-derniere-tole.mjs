// Verrou L5 « dernière tôle » — la démo NAVIGATEUR, trois directions.
//
// Plan : docs/PLAN-DERNIERE-TOLE-2026-09-09.md §4 (L5). Rejoue le projet
// démo en mode local (moteur wasm) avec les trois directions, ouvre la
// modale de résultat et capture la TÔLE PARTIELLE de chaque alternative,
// avec les nombres lus dans la trace `finish` du record IndexedDB.
//
// Aucune écriture en production : pile locale + compte de dev.
//
// Prérequis : `npm i --no-save playwright && npx playwright install chromium`
// (AGENTS §5 — playwright n'est pas dans package.json).
//
// Usage : QA_BASE_URL=http://localhost:7100 node scripts/qa-derniere-tole.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = process.env.QA_OUT || path.join(ROOT, 'docs', 'qa', 'derniere-tole-2026-09-09')
fs.mkdirSync(OUT, { recursive: true })

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({
    locale: 'en-US', viewport: { width: 1680, height: 1000 },
})).newPage()
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

    // Le projet démo est semé au démarrage de l'app.
    await page.goto(BASE + '/project/demo', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.atelier__nest', { timeout: 60000 })
    await page.waitForTimeout(3000)

    // Tôle 1500 × 3000 × 3 (repère moteur X = largeur).
    const sheet = page.locator('.size__sheet').first()
    const dims = sheet.locator('.size__line .input__value')
    for (const [i, v] of [[0, '1500'], [1, '3000']]) {
        if (String(await dims.nth(i).inputValue()) !== v) {
            await dims.nth(i).fill(v); await dims.nth(i).blur()
        }
    }
    const countInput = sheet.locator('> .input__value, > label.input .input__value').first()
    if (String(await countInput.inputValue()) !== '3') {
        await countInput.fill('3'); await countInput.blur()
    }
    // Espacement effectif 2 mm : kerf 0 + sécurité 1.
    const kerf = page.locator('label.input', { hasText: 'Kerf' }).locator('.input__value')
    await kerf.fill('0'); await kerf.blur()
    const safety = page.locator('label.input', { hasText: 'Safety' }).locator('.input__value')
    await safety.fill('1'); await safety.blur()
    // Les TROIS directions.
    const dirOpts = page.locator('.compute__options .compute__option')
    for (let i = 0; i < await dirOpts.count(); i++) {
        const active = (await dirOpts.nth(i).getAttribute('class') || '').includes('--active')
        if (!active) await dirOpts.nth(i).click()
    }
    await page.waitForTimeout(400)
    const dirs = []
    for (let i = 0; i < await dirOpts.count(); i++) {
        dirs.push((await dirOpts.nth(i).getAttribute('class') || '').includes('--active'))
    }
    log('directions actives :', JSON.stringify(dirs))

    const t0 = Date.now()
    await page.locator('.atelier__nest').click()
    log('nest lancé')
    let done = false
    while (Date.now() - t0 < 15 * 60 * 1000) {
        await page.waitForTimeout(3000)
        const err = (await page.locator('.content__error').allInnerTexts().catch(() => [])).join(' ')
        if (err) throw new Error('page-error: ' + err)
        const running = await page.locator('.stage__status').count()
        const btn = await page.locator('[data-testid="result-report-btn"]').count()
        if (btn && !running) { done = true; break }
    }
    if (!done) throw new Error('le calcul démo n’a pas abouti')
    log('calcul terminé en', ((Date.now() - t0) / 1000).toFixed(0) + 's')
    await page.waitForTimeout(2000)

    // Trace `finish` + extrémités par alternative, lues dans IndexedDB.
    const rec = await page.evaluate(async () => {
        const db = await new Promise((res, rej) => {
            const req = indexedDB.open('nestorcut-local')
            req.onsuccess = () => res(req.result)
            req.onerror = () => rej(req.error)
        })
        const recs = await new Promise((res, rej) => {
            const r = db.transaction('results', 'readonly').objectStore('results').getAll()
            r.onsuccess = () => res(r.result || [])
            r.onerror = () => rej(r.error)
        })
        recs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        const rr = recs[0] || {}
        return {
            slug: rr.slug, requested: rr.requested, placed: rr.placed,
            alternatives: (rr.alternatives || []).map((a) => ({
                strategy: a.strategy, layoutCount: a.layoutCount,
                finish: a.finish || null,
                overlapFree: a.report?.overlapFree, spacingOk: a.report?.spacingOk,
                insideSheet: a.report?.insideSheet,
                sheets: (a.report?.sheets || []).map((s) => ({
                    index: s.index, parts: s.partCount, densityPct: s.densityPct,
                })),
            })),
        }
    })
    fs.writeFileSync(path.join(OUT, 'demo-finish.json'), JSON.stringify(rec, null, 2) + '\n')
    log('record :', rec.slug, rec.placed + '/' + rec.requested)

    // Captures : pour chaque alternative, la tôle PARTIELLE (la moins dense).
    await page.locator('[data-testid="result-report-btn"]').first().click()
    await page.waitForSelector('.modal-body', { timeout: 20000 })
    await page.waitForTimeout(1500)
    const tabs = page.locator('[data-testid="alt-tab"]')
    const n = await tabs.count()
    for (let k = 0; k < n; k++) {
        await tabs.nth(k).click()
        await page.waitForTimeout(1200)
        const alt = rec.alternatives[k] || {}
        const strategy = alt.strategy || `alt${k}`
        // Tôle la moins dense = la partielle.
        let target = 0
        const sh = alt.sheets || []
        for (let i = 1; i < sh.length; i++) {
            if ((sh[i].densityPct ?? 100) <= (sh[target].densityPct ?? 100)) target = i
        }
        const next = page.locator('[data-testid="sheet-next"]').first()
        for (let i = 0; i < target; i++) {
            const off = await next.evaluate(
                (el) => el.disabled === true || el.classList.contains('button--disabled'),
            ).catch(() => true)
            if (off) break
            await next.click({ timeout: 5000 }).catch(() => {})
            await page.waitForTimeout(700)
        }
        const stage = page.locator('[data-testid="viewer-stage"]').first()
        const file = path.join(OUT, `demo-${strategy}.png`)
        await stage.screenshot({ path: file })
        const f = alt.finish
        log(`${strategy.padEnd(9)} tôle ${target}`
            + (f ? `  kept=${f.kept}  avant x≤${f.before.xMax.toFixed(1)} y≤${f.before.yMax.toFixed(1)}`
                 + `  après x≤${f.after.xMax.toFixed(1)} y≤${f.after.yMax.toFixed(1)} (${f.elapsedMs} ms)`
                 : '  finish absent')
            + `  badges ${alt.overlapFree}/${alt.spacingOk}/${alt.insideSheet}`)
    }
    console.log('\nL5 OK — captures dans', OUT)
    await browser.close()
    process.exit(0)
} catch (e) {
    console.error('L5 FAIL:', e.message)
    await page.screenshot({ path: path.join(OUT, 'l5-fail.png') }).catch(() => {})
    await browser.close()
    process.exit(1)
}
