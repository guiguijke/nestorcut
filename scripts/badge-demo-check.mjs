/**
 * Retouche « badge Démo » (PLAN-UI-PRO §Retouche immédiate) : capture de la
 * colonne Projets (240 px dans la grille de l'accueil) avec le nom long du
 * projet de démonstration — le nom doit être en ellipse, le badge entier.
 *
 * Usage : node scripts/badge-demo-check.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.argv[2] || 'http://localhost:7100'
const EMAIL = 'guillaume@local.dev'
const PASSWORD = 'nestorcut-local-2026'
const OUT = join('docs', 'qa', 'atelier-ui')

mkdirSync(OUT, { recursive: true })

const main = async () => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(30000)

    const login = await page.request.post(`${BASE}/api/auth/local/login`, {
        data: { email: EMAIL, password: PASSWORD },
    })
    if (!login.ok()) throw new Error(`login ${login.status()} ${await login.text()}`)

    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)

    // Français : le nom de démo y est le plus long (« Démo — Tôlerie marine »).
    const fr = page.getByRole('button', { name: /^FR$/ })
    if (await fr.count()) {
        await fr.first().click()
        await page.waitForTimeout(900)
    }

    const aside = page.locator('.content__projects').first()
    const demo = page.locator('.project').filter({ hasText: /Démo|Demo/ }).first()

    const report = async (label) => {
        const name = demo.locator('.project__name').first()
        const badge = demo.locator('.project__badge').first()
        const nb = await name.boundingBox()
        const bb = await badge.boundingBox()
        const card = await demo.boundingBox()
        const text = (await badge.innerText()).trim()
        const truncated = await name.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
        console.log(`${label} :: badge "${text}" ${bb ? Math.round(bb.width) : '?'}px`
            + ` | nom ${nb ? Math.round(nb.width) : '?'}px ellipse=${truncated}`
            + ` | badge dans la carte=${bb && card ? (bb.x + bb.width <= card.x + card.width + 0.5) : '?'}`)
    }

    await report('clair')
    await aside.screenshot({ path: join(OUT, 'badge-demo-clair.png') })
    console.log('shot', join(OUT, 'badge-demo-clair.png'))

    const themeBtn = page.getByRole('button', { name: /toggle theme/i })
    if (await themeBtn.count()) {
        await themeBtn.first().click()
        await page.waitForTimeout(800)
        await report('sombre')
        await aside.screenshot({ path: join(OUT, 'badge-demo-sombre.png') })
        console.log('shot', join(OUT, 'badge-demo-sombre.png'))
    }

    await browser.close()
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
