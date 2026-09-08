/**
 * U3 passe 1 — sonde de l'écart constaté par le vérificateur sur
 * 06-modal-final.png : le contenu de la modale est-il SCROLLÉ (cas a) ou
 * les onglets ne sont-ils plus RENDUS (cas b) ?
 *
 * Rejoue la séquence du harnais : ouvrir un résultat depuis la liste,
 * relever le nombre de .alts__tab et le scrollTop des conteneurs, cliquer
 * le bouton de téléchargement (c'est APRÈS ce clic que le harnais prend
 * 06-modal-final.png), puis relever de nouveau.
 *
 * Usage : node scripts/u3-p1-probe.mjs [baseUrl]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:7100'
const EMAIL = 'guillaume@local.dev'
const PASSWORD = 'nestorcut-local-2026'

const probe = async (page, label) => {
    const s = await page.evaluate(() => {
        const q = (sel) => document.querySelector(sel)
        const body = q('.modal-body')
        const modal = q('.modal-body .modal') || q('.modal .modal')
        const tabs = document.querySelectorAll('.alts__tab')
        const close = q('.modal-body__close')
        const closeBox = close ? close.getBoundingClientRect() : null
        const firstTab = tabs[0] ? tabs[0].getBoundingClientRect() : null
        return {
            tabs: tabs.length,
            bodyScrollTop: body ? Math.round(body.scrollTop) : null,
            bodyScrollHeight: body ? Math.round(body.scrollHeight) : null,
            bodyClientHeight: body ? Math.round(body.clientHeight) : null,
            modalPaddingTop: modal ? getComputedStyle(modal).paddingTop : null,
            closeVisible: closeBox ? Math.round(closeBox.top) : null,
            firstTabTop: firstTab ? Math.round(firstTab.top) : null,
            focused: document.activeElement
                ? `${document.activeElement.tagName}.${document.activeElement.className}`.slice(0, 60)
                : null,
        }
    })
    console.log(label, JSON.stringify(s))
    return s
}

const main = async () => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })
    page.setDefaultTimeout(30000)

    const login = await page.request.post(`${BASE}/api/auth/local/login`, {
        data: { email: EMAIL, password: PASSWORD },
    })
    if (!login.ok()) throw new Error(`login ${login.status()}`)

    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    // On cherche un résultat à PLUSIEURS alternatives (le cas du harnais) :
    // les résultats mono-alternative n'affichent pas d'onglets, par dessin.
    const cards = page.locator('.results__item .result__area')
    const n = Math.min(await cards.count(), 8)
    let found = false
    for (let i = 0; i < n; i++) {
        await cards.nth(i).click()
        await page.waitForSelector('.modal', { timeout: 30000 })
        await page.waitForTimeout(1200)
        const tabs = await page.locator('.alts__tab').count()
        if (tabs > 1) { found = true; console.log('résultat #' + i + ' : ' + tabs + ' onglets'); break }
        await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
    }
    if (!found) throw new Error('aucun résultat multi-alternatives dans la liste')
    await probe(page, 'ouverture      ')

    const dlBtn = page.locator('.modal .controls__download, .modal button:has-text("Download")').first()
    if (await dlBtn.count()) {
        const label = (await dlBtn.innerText()).trim()
        console.log('bouton cliqué :', JSON.stringify(label))
        try {
            await Promise.all([
                page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
                dlBtn.click(),
            ])
        } catch { /* le téléchargement peut ne pas se déclencher */ }
        await page.waitForTimeout(800)
        await probe(page, 'après clic dl  ')
    } else {
        console.log('aucun bouton de téléchargement trouvé')
    }

    await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
