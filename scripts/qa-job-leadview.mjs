// QA E2E — verrou J11-ter (2026-09-16) : la vue agrandie d'une fiche `.job`
// AFFICHE VRAIMENT ses amorces. Le défaut (NO-GO J11-bis, R10) : la chaîne
// d'imports dynamiques de files.js RESOLVAIT le mauvais module, l'appel à
// `previewSvgWithLeads` jetait, le catch silencieux gardait l'aperçu NU —
// et la vue montrait un L bleu sans aucun tracé d'amorce, pas de perçage,
// pas de zone, pendant que la légende promettait les trois.
//
// Les sondes géométriques SONT le verrou : le SVG de la vue (l'attribut src
// de l'<img>, décodé) doit porter PLUS D'UN tracé d'amorce (#D97706) dès
// que la fiche a des points de départ, le disque de perçage doit y être,
// la légende ne doit chevaucher NI le nom NI les constats, et le badge
// « Nouveau » doit rester un badge (≤ 90 px), pas une barre pleine largeur.
// Vérifié à 1440 px ET à 390 px (le chevauchement du NO-GO y était le pire).
// Échec d'une sonde = exit 1.
//
// Scratch uniquement sous .qa-pw/leadview/ — aucun fichier tracké modifié.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('.qa-pw/leadview')
fs.mkdirSync(OUT, { recursive: true })

// Fichier d'atelier privé (.testparts, jamais commité) : ses QUATRE
// exemplaires portent un point de départ déplacé à la main (moved=true).
const JOB = path.resolve('.testparts/job-tests-new/c16__marine_lpl_005 x4 parts.job')

const logs = []
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; logs.push(s); console.log(s) }
const flushLogs = () => fs.writeFileSync(path.join(OUT, 'run.log'), logs.join('\n') + '\n')

const browser = await chromium.launch({ headless: true })

// Vue en FRANÇAIS (le cookie est honoré au rendu depuis R9) — la capture
// exigée par le vérificateur est française.
const ctx = await browser.newContext({
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
})
await ctx.addCookies([{ name: 'locale', value: 'fr', url: BASE }])
const page = await ctx.newPage()
page.on('console', (m) => { const t = m.type(); if (t === 'error') log('[console:error]', m.text().slice(0, 300)) })
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 500)))

const shot = async (name) => {
    try { await page.screenshot({ path: path.join(OUT, name), timeout: 15000 }); log('screenshot:', name) }
    catch (e) { log('screenshot FAILED (non fatal):', name, String(e).slice(0, 120)) }
}

/** Sonde du SVG enrichi DEPUIS LE DOM : décode le src de l'<img> et compte
 * les tracés d'amorce, le disque de perçage, la zone tangente. */
const probeSvg = () => page.evaluate(() => {
    const img = document.querySelector('.modal__enriched-svg img')
    if (!img || !img.src) return { ok: false, reason: 'img .modal__enriched-svg absente' }
    let svg = null
    try {
        svg = decodeURIComponent(img.src.replace(/^data:image\/svg\+xml;utf8,/, ''))
    } catch (e) {
        return { ok: false, reason: 'src non décodable : ' + String(e).slice(0, 80) }
    }
    return {
        ok: true,
        leadTraces: (svg.match(/#D97706/g) || []).length,
        pierceDiscs: (svg.match(/<circle[^>]*dasharray/g) || []).length,
        tangentZones: (svg.match(/fill-opacity="0\.16"/g) || []).length,
        leadPaths: (svg.match(/stroke="#D97706"[^>]*fill="none"/g) || []).length,
        viewBox: (svg.match(/viewBox="[^"]+"/) || [null])[0],
    }
})

/** Chevauchement de boîtes réelles — les BONS nœuds cette fois : la
 * légende <ul>, le nom, la liste de constats, le badge. */
const probeLayout = () => page.evaluate(() => {
    const box = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }
    }
    const legend = box('.modal__legend')
    const name = box('.modal__name')
    const findings = box('.modal__findings')
    const badge = box('.modal__enriched-badge')
    const enriched = box('.modal__enriched')
    const overlap = (a, b) => a && b
        && !(a.bottom <= b.top + 1 || a.top >= b.bottom - 1 || a.right <= b.left + 1 || a.left >= b.right - 1)
    return {
        legend,
        name,
        findings,
        badge,
        legendInItsBlock: legend && enriched ? legend.bottom <= enriched.bottom + 1 : null,
        legendVsName: overlap(legend, name),
        legendVsFindings: overlap(legend, findings),
        badgeIsBadge: badge ? badge.w <= 90 : null,
        legendItems: document.querySelectorAll('.modal__legend li').length,
    }
})

const checks = []
const check = (label, ok, detail) => {
    checks.push({ label, ok, detail })
    log(ok ? 'PASS' : 'FAIL', label, detail !== undefined ? JSON.stringify(detail) : '')
}

let failed = null
try {
    // ---------- 1. Connexion ----------
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

    // ---------- 2. Dépôt du .job seul (points déplacés à la main) ----------
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    await page.setInputFiles('input[name="dxf"]', JOB)
    await page.waitForURL('**/project/**', { timeout: 90000 })
    await page.waitForSelector('[data-testid="file-grouped-card"]', { timeout: 60000 })
    await page.waitForTimeout(4000)
    log('projet .job créé')

    // L'exemplaire ouvert porte bien « votre point » (moved=true) — sinon
    // le verrou « > 0 amorces » ne voudrait rien dire.
    const movedCount = await page.locator('.fgroup__moved:not([class*="--auto"])').count()
    check('exemplaires « votre point » ≥ 1', movedCount >= 1, { movedCount })

    // ---------- 3. Vue agrandie du PREMIER exemplaire, à 1440 ----------
    const group = page.locator('[data-testid="file-grouped-card"]')
    await group.scrollIntoViewIfNeeded()
    await group.locator('.fgroup__member').first().click()
    await page.waitForSelector('.modal__enriched', { timeout: 15000 })
    await page.waitForTimeout(1200)
    log('vue agrandie ouverte')

    // LE verrou géométrique : les tracés d'amorce comptent dans le SVG.
    const svg1440 = await probeSvg()
    check('vue enrichie rendue', svg1440.ok === true, svg1440.reason || svg1440.viewBox)
    check('tracés d\'amorce > 0 dans le SVG de la vue', svg1440.ok && svg1440.leadTraces > 0,
        { leadTraces: svg1440.leadTraces, leadPaths: svg1440.leadPaths })
    check('disque de perçage présent', svg1440.ok && svg1440.pierceDiscs > 0, { pierceDiscs: svg1440.pierceDiscs })
    const lay1440 = await probeLayout()
    check('légende dans son bloc (ne sort pas)', lay1440.legendInItsBlock === true)
    check('légende sans chevauchement avec le nom', lay1440.legendVsName === false)
    check('légende sans chevauchement avec les constats', lay1440.legendVsFindings === false)
    check('badge ≤ 90 px (un badge, pas une barre)', lay1440.badgeIsBadge === true,
        lay1440.badge ? { w: Math.round(lay1440.badge.w) } : null)
    check('légende à quatre entrées', lay1440.legendItems === 4, { items: lay1440.legendItems })
    await shot('01-vue-enrichie-1440-fr.png')

    // ---------- 4. La même vue à 390 px ----------
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(800)
    const lay390 = await probeLayout()
    check('390 px : légende sans chevauchement avec le nom', lay390.legendVsName === false)
    check('390 px : légende sans chevauchement avec les constats', lay390.legendVsFindings === false)
    check('390 px : badge ≤ 90 px', lay390.badgeIsBadge === true,
        lay390.badge ? { w: Math.round(lay390.badge.w) } : null)
    await shot('02-vue-enrichie-390-fr.png')
} catch (e) {
    failed = String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)
    log('ERREUR:', failed)
}

flushLogs()
await browser.close()

const reds = checks.filter((c) => !c.ok)
if (failed || reds.length) {
    console.log(`NO-GO — ${reds.length} verrou(s) rouge(s)${failed ? ' + erreur' : ''}`)
    process.exit(1)
}
console.log('GO — la vue agrandie d\'une fiche .job montre ses amorces (tracés comptés dans le SVG), légende sans chevauchement à 1440 comme à 390 px, badge redevenu badge')
