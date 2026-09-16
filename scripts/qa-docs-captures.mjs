// QA captures — lot D1 (docs/PLAN-DOCUMENTATION-2026-09-15.md §3).
//
// La documentation du site vitrine s'appuie sur des captures de
// l'application. Elles viennent d'ICI, jamais d'une session manuelle :
//   - fichiers NEUTRES uniquement (la pièce L du dépôt, fixture validée
//     par le propriétaire le 13/09 — aucun nom de client, aucun fichier
//     du corpus) ;
//   - interface en FRANÇAIS (le marché du propriétaire, « le français
//     d'abord ») ;
//   - écrites dans le dépôt frère ../nestorcut-website/public/docs-img/
//     — relancer ce harnais à chaque version dont la page projet change
//     d'allure, pour ne jamais montrer une interface périmée.
//
// Sorties actuelles :
//   demarrer-accueil.png  — l'accueil connecté (choix de l'endroit du calcul)
//   demarrer-projet.png   — la page projet : pièce L déposée, tôles, réglages
//
// Échec d'une sonde = exit 1 (une doc qui montre autre chose que la vérité
// est un mensonge public).
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('../nestorcut-website/public/docs-img')
// Le journal reste HORS du site publié (public/) — il vit dans .qa-pw/.
const LOG = process.env.QA_LOG || path.resolve('.qa-pw/docs-captures/run.log')
// Fixture neutre : la pièce L (accord owner 13/09), un seul exemplaire.
const JOB = path.resolve('app/tests/fixtures/sheetcam/piece-l-none-default.job')

fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(path.dirname(LOG), { recursive: true })

const logs = []
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; logs.push(s); console.log(s) }

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // net dans la doc sur écrans retina
})
await ctx.addCookies([{ name: 'locale', value: 'fr', url: BASE }])
const page = await ctx.newPage()
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 400)))

const checks = []
const check = (label, ok, detail) => {
    checks.push({ label, ok })
    log(ok ? 'PASS' : 'FAIL', label, detail || '')
}
const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, name) })
    log('capture:', name)
}

let failed = null
try {
    // ---------- 1. Connexion (compte local de dev, AGENTS §4) ----------
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

    // ---------- 2. L'accueil connecté : le choix de l'endroit du calcul ----------
    await page.waitForTimeout(2000)
    const homeFr = await page.evaluate(() => ({
        // la page doit être en français (cookie honoré, R9)
        hasDeviceCard: /Cet appareil/i.test(document.body.innerText),
        hasServerCard: /Nos serveurs/i.test(document.body.innerText),
    }))
    check('accueil : les deux modes affichés (FR)', homeFr.hasDeviceCard && homeFr.hasServerCard)
    await shot('demarrer-accueil.png')

    // ---------- 3. Dépôt de la pièce L (.job neutre) ----------
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    await page.setInputFiles('input[name="dxf"]', JOB)
    await page.waitForURL('**/project/**', { timeout: 90000 })
    await page.waitForTimeout(6000)
    const projectState = await page.evaluate(() => ({
        card: Boolean(document.querySelector('[data-testid="file-grouped-card"]') || document.querySelector('.file__name')),
        preflight: document.querySelector('[data-testid="project-preflight"]')?.textContent || null,
        nestBtn: Boolean(document.querySelector('.atelier__nest')),
    }))
    check('projet : fiche déposée', Boolean(projectState.card), projectState.preflight?.slice(0, 80))
    check('projet : bouton de nesting présent', projectState.nestBtn)
    await shot('demarrer-projet.png')
} catch (e) {
    failed = String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)
    log('ERREUR:', failed)
}

fs.writeFileSync(LOG, logs.join('\n') + '\n')
await browser.close()

const reds = checks.filter((c) => !c.ok)
if (failed || reds.length) {
    console.log(`NO-GO — ${reds.length} sonde(s) rouge(s)${failed ? ' + erreur' : ''}`)
    process.exit(1)
}
console.log('GO — captures de documentation régénérées (accueil + projet, pièce L, interface FR)')
