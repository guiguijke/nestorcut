/**
 * U2-ter (PLAN-UI-PRO-2026-09-07.md) : planche de captures — réglages
 * (presets de tôle + interrupteurs), page profil pleine largeur en clair
 * et en sombre, carte abonnement. Passe visuelle, pas de la CI.
 *
 * Usage : node scripts/u2ter-check.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.argv[2] || 'http://localhost:3000'
const EMAIL = 'guillaume@local.dev'
const PASSWORD = 'nestorcut-local-2026'
const OUT = join('docs', 'qa', 'atelier-ui')

mkdirSync(OUT, { recursive: true })

const shot = async (page, name, opts = {}) => {
    const file = join(OUT, `${name}.png`)
    await page.screenshot({ path: file, fullPage: true, ...opts })
    console.log('shot', file)
}

const main = async () => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(25000)

    const login = await page.request.post(`${BASE}/api/auth/local/login`, {
        data: { email: EMAIL, password: PASSWORD },
    })
    if (!login.ok()) throw new Error(`login API ${login.status()} ${await login.text()}`)

    // ---- Profil (clair) : grille pleine largeur, identité, abonnement ----
    await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1800)
    await shot(page, 'u2ter-profil-clair')

    const sub = page.locator('.subscription').first()
    if (await sub.count()) {
        await sub.screenshot({ path: join(OUT, 'u2ter-abonnement.png') })
        console.log('shot', join(OUT, 'u2ter-abonnement.png'))
    }

    // ---- Profil (sombre) ----
    const themeBtn = page.getByRole('button', { name: /toggle theme/i })
    if (await themeBtn.count()) {
        await themeBtn.first().click()
        await page.waitForTimeout(700)
        await shot(page, 'u2ter-profil-sombre')
        await themeBtn.first().click()
        await page.waitForTimeout(500)
    } else {
        console.log('!! bouton de thème introuvable')
    }

    // ---- Réglages d'un projet : presets de tôle + interrupteurs ----
    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    const demoLink = page.locator('a[href="/project/demo"]')
    const projectLink = (await demoLink.count())
        ? demoLink.first()
        : page.locator('a[href^="/project/"]').first()
    if (await projectLink.count()) {
        await projectLink.click()
        await page.waitForURL(/\/project\//, { timeout: 20000 })
        await page.waitForTimeout(2000)
        const settings = page.locator('.settings, .main-settings').first()
        if (await settings.count()) {
            await settings.screenshot({ path: join(OUT, 'u2ter-reglages.png') })
            console.log('shot', join(OUT, 'u2ter-reglages.png'))
        } else {
            await shot(page, 'u2ter-reglages')
        }
    } else {
        console.log('!! aucun projet sur /home')
    }

    await browser.close()
    console.log('done')
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
