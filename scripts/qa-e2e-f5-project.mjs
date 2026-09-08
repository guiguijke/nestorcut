// Verrou P5 : F5 sur une page projet garde l'URL (cookies SSR).
// QA_BASE_URL (défaut http://localhost:7100). Compte local.
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)

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
    log('logged in')

    const created = await page.evaluate(async () => {
        const r = await fetch('/api/project', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ local: true }),
        })
        return { status: r.status, body: await r.json() }
    })
    const slug = created.body?.slug
    if (!slug) throw new Error('no slug: ' + JSON.stringify(created))

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    const href = `/project/${slug}`
    await page.locator(`a[href="${href}"]`).first().click({ timeout: 15000 })
    await page.waitForURL(`**${href}`, { timeout: 15000 })
    const before = page.url()
    log('on project', before)

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2000)
    const after = page.url()
    const keeps = after.includes(`/project/${slug}`)
    log('F5', before, '->', after, 'keeps', keeps)
    if (!keeps) {
        console.error('FAIL: F5 bounced to', after)
        await browser.close()
        process.exit(1)
    }
    console.log('OK: F5 sur une page projet garde l\'URL')
    await browser.close()
    process.exit(0)
} catch (e) {
    console.error('FAIL', e.message)
    await browser.close()
    process.exit(1)
}
