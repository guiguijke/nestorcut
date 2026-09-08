/**
 * U2-ter — planche « compte neuf » : inscription autonome sur le build
 * local (Docker Desktop, même commit que la prod), puis captures pleine
 * page de la page PROJET (presets + interrupteurs en situation) et de la
 * page PROFIL.
 *
 * Usage : node scripts/u2ter-fresh-account.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.argv[2] || 'http://localhost:7100'
const OUT = join('docs', 'qa', 'atelier-ui')
const stamp = Date.now()
const EMAIL = `u2ter.${stamp}@local.dev`
const PASSWORD = 'nestorcut-u2ter-2026'

mkdirSync(OUT, { recursive: true })

const shot = async (page, name) => {
    const file = join(OUT, `${name}.png`)
    await page.screenshot({ path: file, fullPage: true })
    console.log('shot', file)
}

const main = async () => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(30000)

    const reg = await page.request.post(`${BASE}/api/auth/local/register`, {
        data: { email: EMAIL, password: PASSWORD, name: 'Atelier QA' },
    })
    console.log('register', reg.status(), EMAIL)
    if (!reg.ok()) {
        const login = await page.request.post(`${BASE}/api/auth/local/login`, {
            data: { email: EMAIL, password: PASSWORD },
        })
        if (!login.ok()) throw new Error(`login ${login.status()} ${await login.text()}`)
    }

    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    const dismiss = page.getByRole('button', { name: /no thanks|non merci/i })
    if (await dismiss.isVisible().catch(() => false)) {
        await dismiss.click()
        await page.waitForTimeout(400)
    }
    await shot(page, 'u2ter-compte-neuf-accueil')

    // Page projet : la démo est semée pour tout compte.
    await page.goto(`${BASE}/project/demo`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    await shot(page, 'u2ter-projet')

    await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    await shot(page, 'u2ter-profil-compte-neuf')

    await browser.close()
    console.log('done', EMAIL)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
