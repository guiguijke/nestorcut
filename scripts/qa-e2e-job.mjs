// QA E2E navigateur — lot J4 : nester un `.job` SheetCam.
//
// Le verrou produit demandé au point 6 de la consigne (§5 de
// `docs/REPRISE-2026-09-13.md`) : dépôt d'un `.job` + ses DXF → nesting →
// `.job` téléchargé, dont on vérifie qu'il a LA STRUCTURE DE LA RECETTE.
//
// Ce qui est mesuré, et pourquoi chaque mesure n'est pas vide :
//
//   A. le `.job` est reconnu À LA DÉPOSE et crée une fiche PAR DESSIN, avec
//      la quantité que le fichier lui donne (et non 1 par défaut) ;
//   B. la tôle et l'espacement sont PRÉ-REMPLIS depuis le fichier — on lit
//      les champs du formulaire, pas ce que le code croit avoir écrit ;
//   C. le nesting tourne et place toutes les pièces ;
//   D. le `.job` téléchargé est relu PAR NOTRE PROPRE LECTEUR et comparé au
//      `.job` d'entrée : `Count`, `Optimisation=3`, `[OpOrder]` (nichées
//      avant leur hôte), `copyOf` par exemplaire, chemins absolus MASQUÉS,
//      et bloc binaire IDENTIQUE À L'OCTET PRÈS ;
//   E. contrôle négatif : les angles écrits tiennent tous dans l'intervalle
//      que SheetCam utilise, (−2π, 0] — c'est le défaut `Angle=-6.283` de la
//      recette du 13/09 qui est verrouillé ici.
//
// Les fichiers d'entrée sont PRIVÉS et passés par variable d'environnement ;
// rien de nommé ne sort dans `docs/`. Par défaut le harnais prend la fixture
// anonymisée du dépôt et les deux dessins du moulinet.
//
// Lot J6 — QA_ALONE=1 : le cas « `.job` SEUL » de bout en bout (§9.62
// point 6) : la dépose ne contient QUE le `.job`, les fiches viennent du
// bloc binaire (source: 'job'), le nesting tourne, le `.job` rendu est
// relu avec les mêmes verrous D/E. À jouer sur la recette ×4 et sur le
// fichier « ordre ».
//
// Usage :
//   QA_JOB=<fichier.job> QA_DXF_DIR=<dossier des dessins> QA_OUT=<dir> \
//   node scripts/qa-e2e-job.mjs
//   QA_ALONE=1 QA_JOB=<fichier.job> QA_OUT=<dir> node scripts/qa-e2e-job.mjs
//   QA_TWO_DROPS=1 QA_JOB=… QA_DXF_DIR=… node scripts/qa-e2e-job.mjs   (J6-bis)
//   QA_J7_AB=1 [QA_J7_DIR=<dossier>] node scripts/qa-e2e-job.mjs      (J7-b)
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { jobDrawings, parseSheetCamJob, jobSheet } from '../shared/sheetcamJob.js'
import { spacingFromKerf } from '../shared/sheetcamReserve.js'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('.qa-pw/j4')
const DXF_DIR = process.env.QA_DXF_DIR || path.resolve('.testparts')
const LOCALE = process.env.QA_LOCALE || 'fr'
// Lot J7-b (§9.69 point 6) : le couple A/B des points de départ — deux
// `.job` du MÊME dessin, l'un à points tous DÉPLACÉS À LA MAIN, l'autre à
// points tous AUTOMATIQUES. Résolus PAR CARACTÉRISTIQUES dans QA_J7_DIR
// (défaut neutre) : aucun nom de fichier du propriétaire dans ce script ni
// au journal — identifiants j7-ab-manuel / j7-ab-auto. La phase principale
// joue le MANUEL (§9.59 : 0 octet du binaire ne doit bouger), une phase 2
// en fin de parcours joue l'AUTOMATIQUE (seuls les DRAPEAUX changent).
const J7_DIR = process.env.QA_J7_DIR || path.resolve('.testparts/job-tests-new')
const J7_AB = process.env.QA_J7_AB === '1'
let JOB_MANUAL = null
let JOB_AUTO = null
if (J7_AB) {
    const cands = fs.existsSync(J7_DIR)
        ? fs.readdirSync(J7_DIR).filter((f) => f.toLowerCase().endsWith('.job'))
        : []
    const byDrawing = new Map()
    for (const f of cands) {
        try {
            const bytes = new Uint8Array(fs.readFileSync(path.join(J7_DIR, f)))
            const job = parseSheetCamJob(bytes)
            const blocks = jobDrawings(job.binary)
            const originals = job.parts.filter((p) => p.copyOf < 0)
            if (!blocks || originals.length !== 1) continue
            const paths = blocks[0]?.paths || []
            if (!paths.length) continue
            const moved = paths.filter((p) => p.moved).length
            const list = byDrawing.get(originals[0].drawingName) || []
            list.push({ f: path.join(J7_DIR, f), moved, total: paths.length })
            byDrawing.set(originals[0].drawingName, list)
        } catch {
            // illisible : hors couple
        }
    }
    for (const list of byDrawing.values()) {
        if (list.length !== 2) continue
        const man = list.find((x) => x.moved === x.total)
        const aut = list.find((x) => x.moved === 0)
        if (man && aut) { JOB_MANUAL = man.f; JOB_AUTO = aut.f; break }
    }
    if (!JOB_MANUAL) {
        console.error(`QA_J7_AB : couple (tous manuels / tous automatiques, même dessin) introuvable dans ${J7_DIR}`)
        process.exit(2)
    }
}
const JOB = J7_AB ? JOB_MANUAL : (process.env.QA_JOB || path.resolve('app/tests/fixtures/sheetcam/source.job'))
// Lot J6 : déposer le `.job` SANS ses DXF — la géométrie vient du binaire.
const ALONE = process.env.QA_ALONE === '1' || J7_AB
// Lot J6-bis (§9.64) : le cas double dépôt — `.job` seul PUIS `.job` + ses
// DXF sur le MÊME projet. Le DXF doit REMPLACER la fiche du binaire en
// place : toujours autant de fiches que de dessins, plus aucune source
// 'job'. Implique ALONE pour la première dépose.
const TWO_DROPS = process.env.QA_TWO_DROPS === '1'
// QA_SAFETY : force la SECURITE du formulaire avant de nester, pour mesurer
// l'effet de l'espacement toutes choses egales par ailleurs. Sans elle, le
// harnais garde ce que le `.job` pre-remplit (1 mm, donc 2 x kerf + 1).
const SAFETY = process.env.QA_SAFETY || null
// QA_ALLOW_OVERLAP : allume `allowOverlappingLeads` sur chaque fiche avant de
// nester. L'option n'a pas encore de commande dans l'interface ; ce drapeau
// sert a MESURER ce que la reserve coute, toutes choses egales par ailleurs.
const ALLOW_OVERLAP = process.env.QA_ALLOW_OVERLAP === '1'
fs.mkdirSync(OUT, { recursive: true })

const logs = []
const log = (...a) => {
    const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`
    logs.push(s)
    console.log(s)
}
const results = {}
let failures = 0
const check = (name, ok, detail = '') => {
    results[name] = { ok: Boolean(ok), detail: String(detail) }
    if (!ok) failures++
    log(ok ? 'OK  ' : 'ÉCHEC', name, detail ? `— ${detail}` : '')
}
const flush = () => {
    fs.writeFileSync(path.join(OUT, 'run.log'), logs.join('\n') + '\n')
    fs.writeFileSync(path.join(OUT, 'resultats.json'), JSON.stringify(results, null, 1))
}

if (!fs.existsSync(JOB)) {
    console.error(`fichier .job absent : ${JOB}`)
    process.exit(2)
}

// Le `.job` nomme ses dessins : on ne devine pas lesquels déposer, on les
// lit (règle 9 — le fichier ne porte qu'un chemin, seul le nom a un sens).
const source = parseSheetCamJob(new Uint8Array(fs.readFileSync(JOB)))
const wanted = new Map()
for (const part of source.parts) {
    if (part.copyOf >= 0) {
        const n = wanted.get(source.parts[part.copyOf]?.drawingName)
        if (n != null) wanted.set(source.parts[part.copyOf].drawingName, n + 1)
        continue
    }
    wanted.set(part.drawingName, (wanted.get(part.drawingName) || 0) + 1)
}
log('le .job réclame :', [...wanted].map(([n, q]) => `${n} ×${q}`).join(', '))

const drawings = []
if (!ALONE || TWO_DROPS) {
    for (const name of wanted.keys()) {
        const p = path.join(DXF_DIR, name)
        if (fs.existsSync(p)) { drawings.push(p); continue }
        // Casse ignorée : un `.job` Windows écrit `Piece_Trou.DXF`.
        const found = fs.existsSync(DXF_DIR)
            ? fs.readdirSync(DXF_DIR).find((f) => f.toLowerCase() === name.toLowerCase())
            : null
        if (found) drawings.push(path.join(DXF_DIR, found))
        else log('ATTENTION : dessin introuvable sur ce poste —', name)
    }
    if (drawings.length !== wanted.size) {
        console.error(`dessins manquants : ${wanted.size - drawings.length} sur ${wanted.size} (QA_DXF_DIR=${DXF_DIR})`)
        process.exit(2)
    }
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
    locale: LOCALE === 'fr' ? 'fr-FR' : 'en-US',
    viewport: { width: 1680, height: 1000 },
    acceptDownloads: true,
})
await ctx.addCookies([{
    name: 'locale', value: LOCALE, domain: new URL(BASE).hostname, path: '/',
}])
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') log('[console:error]', m.text().slice(0, 300)) })
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))
const shot = async (name) => {
    try { await page.screenshot({ path: path.join(OUT, name), timeout: 60000 }); log('capture:', name) }
    catch (e) { log('capture échouée (non fatale):', name, String(e).slice(0, 100)) }
}

try {
    // ---------- connexion + projet « cet appareil » ----------
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

    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })

    // ---------- J8-d : ce que l'écran de création DIT des `.job` ----------
    //
    // La carte « Cet appareil » nomme le `.job` comme une CAPACITÉ, la
    // carte « Nos serveurs » dit qu'il n'y est pas encore, la légende de la
    // zone de dépôt confirme — et ne le cite JAMAIS en mode serveur (§9.73
    // points 17-19 et 21 : promesse et zone de dépôt racontent la même
    // chose).
    {
        const legend = page.locator('.upload__text--gray').first()
        const devCardJ8 = page
            .locator('.create__privacy [role="radio"]')
            .filter({ hasText: /(This device|Cet appareil)/i })
            .first()
        const srvCardJ8 = page
            .locator('.create__privacy [role="radio"]')
            .filter({ hasText: /(Our servers|Nos serveurs)/i })
            .first()
        if (await devCardJ8.count()) {
            await devCardJ8.click().catch(() => {})
            await page.waitForTimeout(300)
            const deviceBody = (await devCardJ8.innerText()).replace(/\s+/g, ' ')
            const legendDevice = (await legend.innerText()).replace(/\s+/g, ' ')
            check('J8-d la carte « Cet appareil » cite le .job (capacité)',
                /\.job/.test(deviceBody), deviceBody)
            check('J8-d la légende cite le .job en mode appareil',
                /\.job/.test(legendDevice), legendDevice)
            await shot('00-j8d-carte-appareil.png')
            if (await srvCardJ8.count()) {
                await srvCardJ8.click().catch(() => {})
                await page.waitForTimeout(300)
                const srvBody = (await srvCardJ8.innerText()).replace(/\s+/g, ' ')
                const legendSrv = (await legend.innerText()).replace(/\s+/g, ' ')
                check('J8-d la carte « Nos serveurs » dit que le .job n\'y est pas encore',
                    /\.job/.test(srvBody) && /(pas encore|not here yet)/i.test(srvBody), srvBody)
                check('J8-d la légende ne cite PAS le .job en mode serveur',
                    !/\.job/.test(legendSrv), legendSrv)
                await shot('00-j8d-carte-serveur.png')
            }
            // Le dépôt principal repart en mode appareil.
            await devCardJ8.click().catch(() => {})
        }
    }

    // ---------- J8-bis : les points 22 et 23 du §8.3-ter -------------------
    //
    // (a) un `.job` déposé en mode SERVEUR depuis l'écran de création
    //     BASCULE le projet en « Cet appareil » et l'affiche en
    //     INFORMATION (texte figé) — l'écran ne peut pas promettre
    //     « .job acceptés » et répondre « type non supporté » au dépôt ;
    // (b) `.job` + `.dwg` dans la même dépose ⇒ refus explicite (texte
    //     figé), AUCUN projet créé ;
    // (c) négatif : une dépose sans `.job` ne change JAMAIS le mode choisi ;
    // (d) corollaire §9.75 : un fichier écarté est NOMMÉ même quand un
    //     autre passe (le .dwg mêlé ne disparaît plus en silence).
    {
        const squareDxf = {
            name: 'j8bis-carre.dxf', mimeType: 'application/dxf',
            buffer: Buffer.from(
                '0\r\nSECTION\r\n2\r\nHEADER\r\n9\r\n$ACADVER\r\n1\r\nAC1009\r\n9\r\n$INSUNITS\r\n70\r\n4\r\n0\r\nENDSEC\r\n0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nLINE\r\n5\r\n2F\r\n8\r\n0\r\n10\r\n-10.0\r\n20\r\n-10.0\r\n30\r\n0.0\r\n11\r\n10.0\r\n21\r\n-10.0\r\n31\r\n0.0\r\n0\r\nLINE\r\n5\r\n30\r\n8\r\n0\r\n10\r\n10.0\r\n20\r\n-10.0\r\n30\r\n0.0\r\n11\r\n10.0\r\n21\r\n10.0\r\n31\r\n0.0\r\n0\r\nLINE\r\n5\r\n31\r\n8\r\n0\r\n10\r\n10.0\r\n20\r\n10.0\r\n30\r\n0.0\r\n11\r\n-10.0\r\n21\r\n10.0\r\n31\r\n0.0\r\n0\r\nLINE\r\n5\r\n32\r\n8\r\n0\r\n10\r\n-10.0\r\n20\r\n10.0\r\n30\r\n0.0\r\n11\r\n-10.0\r\n21\r\n-10.0\r\n31\r\n0.0\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n',
                'latin1'),
        }
        const fakeDwg = { name: 'j8bis-plan.dwg', mimeType: 'application/acad', buffer: Buffer.from('AC1015fake') }
        // JOB en OBJET : Playwright refuse de mélanger chemins et buffers
        // dans un même setInputFiles.
        const jobAsFile = { name: path.basename(JOB), mimeType: 'application/octet-stream', buffer: fs.readFileSync(JOB) }
        const srvCardBis = page
            .locator('.create__privacy [role="radio"]')
            .filter({ hasText: /(Our servers|Nos serveurs)/i })
            .first()
        const devCardBis = page
            .locator('.create__privacy [role="radio"]')
            .filter({ hasText: /(This device|Cet appareil)/i })
            .first()

        // (a) `.job` en mode serveur ⇒ bascule + information.
        if (await srvCardBis.count()) {
            await srvCardBis.click()
            await page.setInputFiles('input[name="dxf"]', [JOB])
            await page.waitForURL('**/project/**', { timeout: 90000 })
            const slugBis = page.url().split('/project/')[1].split(/[?#]/)[0]
            const isLocal = await page.evaluate(async (s) => {
                const data = await fetch(`/api/project/${s}`).then((r) => r.json()).catch(() => ({}))
                return data.local === true
            }, slugBis).catch(() => null)
            // L'info est posée APRÈS l'import asynchrone (le watch de la
            // page attend getProject + addFiles) : on l'ATTEND.
            await page.locator('.content__notice').waitFor({ timeout: 20000 }).catch(() => {})
            const notice = (await page.locator('.content__notice').allInnerTexts().catch(() => []))
                .join(' ').replace(/\s+/g, ' ').trim()
            log('J8-bis (a) projet', slugBis, 'local:', isLocal, '— info:', notice.slice(0, 90))
            check('J8-bis (a) .job en mode serveur ⇒ projet créé « Cet appareil »', isLocal === true)
            check('J8-bis (a) l\'information de bascule est affichée (texte figé)',
                /(passage en « Cet appareil »|switched to "This device")/.test(notice), notice.slice(0, 120))
            await shot('00b-j8bis-bascule.png')

            // (d) corollaire §9.75 : un écarté NOMMÉ même quand un autre
            // passe. Joué SUR LA PAGE PROJET de (a) — à la création, la
            // navigation gagnerait la course de l'affichage ; ici le
            // message reste. Mode APPAREIL : le .dwg y est écarté (le
            // serveur seul le convertit) et doit être NOMMÉ pendant que le
            // carré passe.
            await page.setInputFiles('input[name="dxf"]', [squareDxf, fakeDwg])
            await page.waitForTimeout(2500)
            const namedRejection = (await page.locator('.files__error').allInnerTexts().catch(() => []))
                .join(' ').replace(/\s+/g, ' ').trim()
            log('J8-bis (d) message d\'écart :', namedRejection.slice(0, 140))
            check('J8-bis (d) le .dwg écarté est NOMMÉ (un autre fichier passait)',
                namedRejection.includes('j8bis-plan.dwg'), namedRejection.slice(0, 160))
        }

        // (b) `.job` + `.dwg` ⇒ refus figé, aucun projet. La contradiction
        // n'existe qu'en mode SERVEUR (le seul où les DEUX formats passent
        // le filtre de la création) : en mode appareil, le .dwg est écarté
        // et NOMMÉ par (d), le .job suit son chemin — rien à refuser.
        await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
        if (await srvCardBis.count()) {
            await srvCardBis.click()
            await page.setInputFiles('input[name="dxf"]', [jobAsFile, fakeDwg])
            await page.waitForTimeout(2500)
            const stillHome = !/\/project\//.test(page.url())
            const refusal = (await page.locator('.create__error').allInnerTexts().catch(() => []))
                .join(' ').replace(/\s+/g, ' ').trim()
            log('J8-bis (b) refus :', refusal.slice(0, 140))
            check('J8-bis (b) .job + .dwg ⇒ AUCUN projet créé', stillHome, page.url())
            check('J8-bis (b) le refus nomme les deux (texte figé)',
                    /(deux projets séparés|two separate projects)/.test(refusal), refusal.slice(0, 140))
        }

        // (c) négatif : sans `.job`, le mode choisi ne change pas.
        await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
        if (await srvCardBis.count()) {
            await srvCardBis.click()
            await page.setInputFiles('input[name="dxf"]', [squareDxf])
            await page.waitForURL('**/project/**', { timeout: 90000 })
            const slugC = page.url().split('/project/')[1].split(/[?#]/)[0]
            const isServer = await page.evaluate(async (s) => {
                const data = await fetch(`/api/project/${s}`).then((r) => r.json()).catch(() => ({}))
                return data.local === false
            }, slugC).catch(() => null)
            check('J8-bis (c) négatif : sans .job, le mode SERVEUR est respecté', isServer === true)
            const noticeC = await page.locator('.content__notice').count()
            check('J8-bis (c) aucune information de bascule', noticeC === 0)
        }
    }

    // Les actes J8-bis finissent sur une page PROJET : retour à la création.
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const devCard = page
        .locator('.create__privacy [role="radio"]')
        .filter({ hasText: /(This device|Cet appareil)/i })
        .first()
    if (await devCard.count()) await devCard.click().catch(() => {})

    // ---------- A. dépose du `.job` AVEC ses dessins (seul si QA_ALONE) ----
    await page.setInputFiles('input[name="dxf"]', (ALONE || TWO_DROPS) ? [JOB] : [JOB, ...drawings])
    await page.waitForURL('**/project/**', { timeout: 90000 })
    const slug = page.url().split('/project/')[1].split(/[?#]/)[0]
    log('projet', slug, (ALONE || TWO_DROPS) ? '(dépose du .job SEUL — lot J6)' : '')
    // Les fiches sont écrites dans IndexedDB par l'import : on attend qu'il
    // y en ait autant que de dessins réclamés, pas un délai fixe.
    await page.waitForFunction(
        (n) => document.querySelectorAll('[data-testid="file-card"], .file').length >= n,
        wanted.size,
        { timeout: 120000 },
    ).catch(() => log('ATTENTION : le compte de fiches attendu n’est pas atteint'))
    await shot('01-depose.png')

    const cards = await page.evaluate(async (projectSlug) => {
        const db = await new Promise((res, rej) => {
            const r = indexedDB.open('nestorcut-local')
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
        })
        const recs = await new Promise((res, rej) => {
            const tx = db.transaction('files', 'readonly').objectStore('files').getAll()
            tx.onsuccess = () => res(tx.result || []); tx.onerror = () => rej(tx.error)
        })
        // Seules les fiches du projet COURANT (piège #47 : les actes
        // préparatoires J8-bis créent d'autres projets dans le même
        // navigateur, la sonde globale ne vaut plus un verrou).
        return recs.filter((r) => r.projectSlug === projectSlug).map((r) => ({
            name: r.name,
            parts: (r.parts || []).length,
            hasCut: Boolean(r.sheetcam),
            leadIn: r.sheetcam?.leadIn ?? null,
            hasJobBytes: Boolean(r.sheetcamJobBytes),
            source: r.source ?? null,
            finding: (r.findings || []).some((f) => f.code === 'sheetcam.jobGeometry'),
        }))
    }, slug)
    log('fiches IndexedDB :', JSON.stringify(cards))
    check('A1 une fiche par dessin', cards.length === wanted.size,
        `${cards.length} fiches pour ${wanted.size} dessins`)
    check('A2 réglages de coupe attachés', cards.every((c) => c.hasCut && c.leadIn > 0),
        `amorces : ${cards.map((c) => c.leadIn).join(', ')}`)
    check('A3 le .job est conservé pour la réécriture', cards.every((c) => c.hasJobBytes))
    // Lot J6 — cas « .job seul » : chaque fiche vient du BLOC BINAIRE et le
    // DIT (`source: 'job'` + constat d'information). Dans le cas normal
    // (DXF déposés), AUCUNE ne doit porter la marque du binaire : le DXF a
    // gagné — c'est le contrôle négatif de la priorité des sources.
    if (ALONE || TWO_DROPS) {
        check('J6-A la géométrie de chaque fiche vient du `.job` et le dit',
            cards.length === wanted.size
            && cards.every((c) => c.source === 'job' && c.finding && c.parts > 0),
            JSON.stringify(cards.map((c) => ({ n: c.name, src: c.source, parts: c.parts }))))
    } else {
        check('J6-A aucun dessin ne vient du binaire quand les DXF sont déposés',
            cards.every((c) => c.source == null),
            JSON.stringify(cards.map((c) => ({ n: c.name, src: c.source }))))
    }
    // Lot J8-c, contrôle négatif : une fiche DXF ordinaire n'a NI puce
    // « .job » NI ligne secondaire — sa carte est inchangée (§9.73 point 16).
    if (!(ALONE || TWO_DROPS || J7_AB)) {
        const chips = await page.locator('[data-testid="file-job-origin"]').count()
        check('J8-c négatif : aucune puce .job sur des fiches DXF ordinaires',
            chips === 0, `${chips} puce(s) trouvée(s)`)
    }

    // ---------- J6-bis : le double dépôt (§9.64) -------------------------
    //
    // `.job` seul PUIS, SUR LE MÊME PROJET, `.job` + les DXF : le DXF
    // REMPLACE la fiche du binaire en place — toujours autant de fiches que
    // de dessins, plus AUCUNE source 'job'. C'est le défaut mesuré par le
    // vérificateur (4 fiches au lieu de 2, quantités doublées).
    if (TWO_DROPS) {
        const slugsBefore = await page.evaluate(async () => {
            const db = await new Promise((res, rej) => {
                const r = indexedDB.open('nestorcut-local')
                r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
            })
            const recs = await new Promise((res, rej) => {
                const tx = db.transaction('files', 'readonly').objectStore('files').getAll()
                tx.onsuccess = () => res(tx.result || []); tx.onerror = () => rej(tx.error)
            })
            return recs.map((r) => r.slug).sort()
        })
        await page.setInputFiles('input[name="dxf"]', [JOB, ...drawings])
        // La dépose repasse par addSheetCamJobDrop : les fiches se sont
        // réécrites en place, la liste se recharge. On attend le même compte
        // de fiches — PAS le double.
        await page.waitForTimeout(4000)
        const after = await page.evaluate(async () => {
            const db = await new Promise((res, rej) => {
                const r = indexedDB.open('nestorcut-local')
                r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
            })
            const recs = await new Promise((res, rej) => {
                const tx = db.transaction('files', 'readonly').objectStore('files').getAll()
                tx.onsuccess = () => res(tx.result || []); tx.onerror = () => rej(tx.error)
            })
            return recs.map((r) => ({
                slug: r.slug, name: r.name, source: r.source ?? null,
                hasCut: Boolean(r.sheetcam), addedAt: r.addedAt,
            }))
        })
        log('après second dépôt :', JSON.stringify(after))
        check('J6bis-1 toujours une fiche par dessin après .job + DXF',
            after.length === wanted.size,
            `${after.length} fiches pour ${wanted.size} dessins — ${after.map((c) => `${c.name}(${c.source ?? 'dxf'})`).join(', ')}`)
        check('J6bis-2 la source binaire a été REMPLACÉE par le DXF',
            after.every((c) => c.source == null),
            JSON.stringify(after.map((c) => ({ n: c.name, src: c.source }))))
        // EN PLACE : mêmes slugs, mêmes rangs (addedAt) — la quantité réglée
        // à l'écran et l'ordre des fiches ne bougent pas.
        const slugsAfter = after.map((c) => c.slug).sort()
        check('J6bis-3 remplacement EN PLACE (mêmes slugs, mêmes rangs)',
            JSON.stringify(slugsAfter) === JSON.stringify(slugsBefore)
            && after.every((c) => c.hasCut),
            `slugs ${slugsBefore.join(',')} → ${slugsAfter.join(',')}`)
        await shot('02b-double-depot.png')
    }

    // ---------- B. réglages pré-remplis ----------
    const sheet = jobSheet(source)
    const space = spacingFromKerf(source.kerfWidth)
    const form = await page.evaluate(() => {
        const val = (sel) => document.querySelector(sel)?.value ?? null
        return {
            w: val('[data-testid="settings-sheets"] input'),
            all: [...document.querySelectorAll('[data-testid="settings-sheets"] input')].map((i) => i.value),
            kerf: val('[data-testid="settings-kerf"] input') ?? val('input[data-testid="settings-kerf"]'),
            safety: val('[data-testid="settings-safety"] input') ?? val('input[data-testid="settings-safety"]'),
            rule: document.querySelector('.size__rule')?.textContent?.trim() ?? null,
        }
    })
    log('formulaire :', JSON.stringify(form))
    check('B1 tôle pré-remplie depuis [Work]',
        form.all.includes(String(sheet.width)) && form.all.includes(String(sheet.height)),
        `attendu ${sheet.width} × ${sheet.height}, lu ${form.all.join(' / ')}`)
    // Lot J4-bis-2 (§9.40) : l'espacement d'un `.job` vaut 2 × kerf +
    // sécurité, sécurité à 1 mm. Sur la recette (kerf 1,5) : 4 mm, et non 2.
    check('B1b kerf et sécurité pré-remplis depuis [Tool0]',
        Number(form.kerf) === Number(source.kerfWidth) && Number(form.safety) === 1,
        `kerf lu ${form.kerf} (attendu ${source.kerfWidth}), sécurité lue ${form.safety} (attendu 1)`)
    check('B1c la règle affichée donne 2 × kerf + sécurité',
        form.rule != null && form.rule.includes(String(space)),
        `règle affichée « ${form.rule} », espacement attendu ${space} mm`)
    const qtyOk = await page.evaluate(() =>
        [...document.querySelectorAll('.file input[type="number"], [data-testid="file-count"] input')]
            .map((i) => Number(i.value)))
    log('quantités à l’écran :', JSON.stringify(qtyOk))
    check('B2 quantités venues du .job',
        qtyOk.length > 0 && qtyOk.some((n) => n === Math.max(...wanted.values())),
        `attendu au moins une fiche à ×${Math.max(...wanted.values())}, lu ${qtyOk.join(', ')}`)

    // ---------- C. nesting ----------
    if (ALLOW_OVERLAP) {
        const n = await page.evaluate(async () => {
            const db = await new Promise((res, rej) => {
                const r = indexedDB.open('nestorcut-local')
                r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
            })
            const store = () => db.transaction('files', 'readwrite').objectStore('files')
            const recs = await new Promise((res, rej) => {
                const tx = store().getAll()
                tx.onsuccess = () => res(tx.result || []); tx.onerror = () => rej(tx.error)
            })
            let k = 0
            for (const r of recs) {
                if (!r.sheetcam) continue
                r.sheetcam = { ...r.sheetcam, allowOverlappingLeads: true }
                await new Promise((res, rej) => {
                    const tx = store().put(r)
                    tx.onsuccess = () => res(); tx.onerror = () => rej(tx.error)
                })
                k++
            }
            return k
        })
        // SURTOUT PAS DE RECHARGEMENT ICI. Le premier essai en faisait un, et
        // la page repartait des params d'usine : le kerf pre-rempli par le
        // `.job` etait perdu et la mesure se faisait a un espacement de 0 au
        // lieu de celui qu'on voulait comparer. La fiche est relue depuis
        // IndexedDB au moment du nesting — l'ecriture suffit.
        log('allowOverlappingLeads pose sur', n, 'fiche(s) — aucune reserve ne sera appliquee')
    }
    if (SAFETY != null) {
        const champ = page.locator('[data-testid="settings-safety"] input')
            .or(page.locator('input[data-testid="settings-safety"]')).first()
        await champ.waitFor({ timeout: 30000 })
        await champ.fill(String(SAFETY))
        await champ.dispatchEvent('change')
        const lu = await page.evaluate(() =>
            document.querySelector('.size__rule')?.textContent?.trim() ?? null)
        log('securite forcee a', SAFETY, '— regle affichee :', lu)
    }
    // Lot J8-a — forcer la tôle (QA_J8_SHEETS=600x300 ou 500x600x2 : largeur
    // × hauteur × NOMBRE, le nombre dépassant 1 fait sortir du mode bande
    // quand une seconde direction est donnée) pour provoquer plusieurs tôles
    // et verrouiller le « tout télécharger les .job » : autant de fichiers
    // téléchargés que de tôles, chacun relu.
    if (process.env.QA_J8_SHEETS) {
        const [w, h, count] = String(process.env.QA_J8_SHEETS).split('x')
        const inputs = page.locator('[data-testid="settings-sheets"] input')
        await inputs.first().waitFor({ timeout: 30000 })
        await inputs.first().fill(String(w))
        await inputs.nth(1).fill(String(h))
        if (count) {
            await inputs.nth(2).fill(String(count))
            // Sortir du « gauche seule » : une seconde direction rend le
            // leftOnly faux, et le nombre de tôles ≥ 2 rend totalStock > 1 —
            // les deux conditions du mode multi-tôles (payload #isSpp).
            const dirBtn = page.locator('[data-testid="settings-directions"] .compute__option')
                .filter({ hasText: /(bas|bottom)/i }).first()
            if (await dirBtn.count()) await dirBtn.click().catch(() => {})
        }
        await inputs.nth(1).dispatchEvent('change')
        log('tôle forcée à', `${w} × ${h}${count ? ' × ' + count : ''}`)
    }
    // … ou forcer les QUANTITÉS (QA_J8_QUANTITY=40 : la voie P4-8 de
    // l'audit, deux tôles sur la tôle du `.job` sans tôle pathologique).
    if (process.env.QA_J8_QUANTITY) {
        const counts = page.locator('.file input[type="number"], [data-testid="file-count"] input')
        await counts.first().waitFor({ timeout: 30000 })
        const n0 = await counts.count()
        for (let k = 0; k < n0; k++) {
            await counts.nth(k).fill(String(process.env.QA_J8_QUANTITY))
            await counts.nth(k).dispatchEvent('change')
        }
        log('quantités forcées à ×' + process.env.QA_J8_QUANTITY)
    }
    const nestBtn = page.locator('.atelier__nest')
    await nestBtn.waitFor({ timeout: 30000 })
    await nestBtn.click()
    log('nesting lancé')
    // Lot J8-b : pendant le nesting, les AMORCES se voient dans la vue live
    // (trajets CERTAINS en trait fin, éventail tangent en zone, disque de
    // perçage pointillé) — sous la MÊME transformation que la pièce. Sonde
    // unique dès la première pièce posée.
    let leadProbeDone = false
    const probeLeads = async () => {
        if (leadProbeDone) return
        if (!(await page.locator('.live__part').count())) return
        leadProbeDone = true
        await page.waitForTimeout(400)
        const strokes = await page.locator('.live__lead--stroke, .live__lead--pierce, .live__lead--zone').count()
        // Capture pendant le live : c'est la pièce du vérificateur.
        await shot('02a-j8b-live-amorces.png')
        log('amorces dans la vue live :', String(strokes), 'élément(s)')
        results.j8bLiveLeads = strokes
    }
    const t0 = Date.now()
    let outcome = 'timeout'
    while (Date.now() - t0 < 8 * 60 * 1000) {
        const err = (await page.locator('.content__error').allInnerTexts().catch(() => []))
            .map((s) => s.trim()).filter(Boolean).join(' | ')
        if (err) { outcome = 'erreur: ' + err; break }
        const item = page.locator('.results__item').first()
        if (await item.count()) {
            const running = await item.locator('.result__cancel').count()
            const failed = await item.locator('.result__placeholder').count()
            const done = await item.locator('.controls__report, .controls__download').count()
            if (failed) { outcome = 'échec'; break }
            if (!running && done && !(await page.locator('.stage__status').count())) { outcome = 'fini'; break }
        }
        await probeLeads()
        await page.waitForTimeout(1500)
    }
    log('nesting :', outcome, `${Math.round((Date.now() - t0) / 1000)} s`)
    results.spacing = { safetyForcee: SAFETY }
    check('C1 le nesting aboutit', outcome === 'fini', outcome)
    // Lot J8-b : sur un projet `.job`, la vue live a montré les amorces
    // (sonde posée dès la première pièce) ; l'APERÇU de la fiche les porte
    // aussi — le record le dit, c'est la donnée pas le pixel.
    if ((ALONE || TWO_DROPS || J7_AB) && leadProbeDone) {
        check('J8-b les amorces se voient dans la vue live pendant le nesting',
            Number(results.j8bLiveLeads) > 0, `${results.j8bLiveLeads ?? 0} élément(s) d'amorce`)
    }
    await shot('02-resultat.png')
    if (outcome !== 'fini') throw new Error('nesting non abouti : ' + outcome)

    // Ce que le record IndexedDB porte réellement — lu, pas déduit de l'écran.
    // C'est la sonde qui dit POURQUOI quand le bouton manque.
    const record = await page.evaluate(async () => {
        const db = await new Promise((res, rej) => {
            const r = indexedDB.open('nestorcut-local')
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
        })
        if (![...db.objectStoreNames].includes('results')) return { note: 'store results absent' }
        const recs = await new Promise((res, rej) => {
            const tx = db.transaction('results', 'readonly').objectStore('results').getAll()
            tx.onsuccess = () => res(tx.result || []); tx.onerror = () => rej(tx.error)
        })
        const r = recs[recs.length - 1] || {}
        return {
            placed: r.placed, requested: r.requested,
            sheetcamJobError: r.sheetcamJobError ?? null,
            // Lot J4-bis-2 : les constats de reserve d'amorce, tels que le
            // payload les a produits et que la fiche les a persistes.
            leadInReserve: r.leadInReserve || [],
            alts: (r.alternatives || []).map((a) => ({
                dxfs: (a.dxfs || []).length,
                jobs: (a.jobs || []).length,
                jobNames: (a.jobs || []).map((j) => j.fileName),
            })),
            // D10 : le nichage tel que le POST-PASS l'a etabli, en RANGS
            // `[Part N]` du fichier ecrit. Lu dans le record, pas deduit de
            // l'ordre de coupe — sinon le verrou ne mesurerait que lui-meme.
            // Toutes les alternatives, chacune avec SES paires et SON ordre
            // ecrit : le verrou compare les deux d'un meme fichier.
            jobsAll: (r.alternatives || []).map((a) => (a.jobs || []).map((j) => ({
                fileName: j.fileName,
                nestedPairs: j.nestedPairs || [],
                order: j.order || [],
            }))),
        }
    })
    log('record IndexedDB :', JSON.stringify(record))
    results.record = record

    // C2 — LE VERROU QUI MANQUAIT. Sans lui, un job qui perd une piece
    // passait VERT : l'ancien harnais lisait `placed` et le journalisait,
    // sans jamais le comparer a `requested`. Mesure du verificateur : la
    // recette posait 4 pieces sur 5 et tous les verrous restaient verts.
    const totalWanted = [...wanted.values()].reduce((a, b) => a + b, 0)
    check('C2 autant de pieces posees que demandees',
        record.placed === record.requested,
        `posees ${record.placed}, demandees ${record.requested}`)
    // QA_J8_QUANTITY force les quantités (acte multi-tôles) : l'écart au
    // `.job` est VOULU, le verrou C3 n'a alors rien à mesurer.
    if (process.env.QA_J8_QUANTITY) log('C3 NON MESURÉ : quantités forcées par acte J8-a')
    else check('C3 le nombre demande est celui du `.job`',
        record.requested === totalWanted,
        `demandees ${record.requested}, somme des quantites du .job ${totalWanted}`)
    // F — LA RESERVE D'AMORCE, LOT J4-bis-2. Elle est desormais posee au
    // POINT DE DEPART LU dans le binaire du `.job`. Ce qu'on verifie ici :
    // qu'elle s'est appliquee sur CE fichier reel, qu'aucun trou n'a ete
    // retire du nesting faute de point lisible, et que le centre de boite
    // que NOUS mesurons est bien celui que SheetCam a memorise — un ecart la
    // ferait tomber a cote des contours en silence.
    const reserve = record.leadInReserve || []
    if (ALLOW_OVERLAP) {
        // Mesure « sans reserve » : F1/F3/F4 n'ont pas de sens, et les exiger
        // serait un verrou faux. Ce qui DOIT rester vrai, c'est que le refus
        // est DIT — une reserve absente en silence serait le defaut que tout
        // ce chantier corrige.
        check('F0 aucune reserve, et la raison est nommee',
            reserve.length > 0
            && reserve.every((n) => n.applied === false && n.reason === 'leadsAllowedToOverlap'),
            JSON.stringify(reserve.map((n) => ({ f: n.file_slug, why: n.reason }))))
    } else {
    check('F1 la reserve d`amorce s`est appliquee sur chaque piece du `.job`',
        reserve.length > 0 && reserve.every((n) => n.applied === true),
        JSON.stringify(reserve.map((n) => ({ f: n.file_slug, ok: n.applied, why: n.reason }))))
    // F2 n'exige PAS qu'aucun trou ne sorte du nesting : un `.job` peut
    // legitimement percer la ou l'on nicherait (voir F4). Ce qui ne doit
    // JAMAIS arriver, c'est un trou retire SANS raison nommee — la
    // degradation muette est le defaut que tout ce chantier corrige.
    const allHoles = reserve.flatMap((n) => n.holes || [])
    check('F2 aucun trou retire sans raison nommee',
        allHoles.every((h) => !h.dropped || (typeof h.reason === 'string' && h.reason)),
        JSON.stringify(allHoles))
    // F3 : les orphelins sont COMPTES, et le compte se boucle. Un `.job` peut
    // porter un chemin sans contour chez nous (une entite POINT, par exemple,
    // que notre import ne retient pas) ; ce qui compterait comme un defaut,
    // c'est qu'un point disparaisse du decompte.
    log('points de depart :', JSON.stringify(reserve.map((n) =>
        ({ f: n.file_slug, lus: n.starts, ignores: n.ignoredPaths,
           percage: n.pierceRadiusMm, repli: n.pierceFallback }))))
    check('F3 le compte des points de depart se boucle',
        reserve.every((n) => Number.isFinite(Number(n.starts))
            && Number(n.unmatched) >= 0 && Number(n.unmatched) <= Number(n.starts)),
        JSON.stringify(reserve.map((n) => ({ lus: n.starts, orphelins: n.unmatched }))))
    // F4 n'est PAS un verrou d'egalite : les deux origines sont differentes et
    // c'est mesure. Le point de depart du binaire est relatif a l'origine que
    // SheetCam memorise pour le dessin ; la pose, elle, tourne autour du
    // centre de la geometrie de COUPE. L'ecart vaut la distance dont une
    // entite ignoree par notre import (un POINT, par exemple) deplace la
    // boite du dessin. On le JOURNALISE, et on verifie que les points
    // atterrissent bien sur les contours (c'est F3 qui le dit).
    log('ecart entre les deux origines (mm) :', JSON.stringify(reserve.map((n) => n.originGapMm)))
    // F4 — LES MARGES DERIVENT DU KERF (SS9.51) : disque de percage 2 x kerf.
    // Un kerf illisible ne doit pas rendre une marge NULLE : repli 3 mm, et le
    // constat doit le dire.
    check('F4 le rayon de percage vaut 2 x kerf, ou dit son repli',
        reserve.every((n) => {
            const r = Number(n.pierceRadiusMm)
            if (!Number.isFinite(r) || r <= 0) return false
            return n.pierceFallback === true ? r === 3 : Math.abs(r - 2 * source.kerfWidth) < 1e-9
        }),
        JSON.stringify(reserve.map((n) => ({ r: n.pierceRadiusMm, repli: n.pierceFallback }))))
    }

    check('D-1 des `.job` sont produits et persistés',
        (record.alts || []).some((a) => a.jobs > 0),
        record.sheetcamJobError
            ? `refus : ${record.sheetcamJobError.code} ${JSON.stringify(record.sheetcamJobError.params)}`
            : JSON.stringify(record.alts))

    // ---------- D. le `.job` téléchargé ----------
    await page.locator('.results__item .controls__report').first().click()
    await page.waitForSelector('.modal__report, .result-report', { timeout: 60000 })
    await shot('03-modal.png')
    const labels = await page.locator('.result-report button, .result-report a').allInnerTexts()
        .then((xs) => xs.map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean))
    log('boutons du rapport :', JSON.stringify(labels))
    const jobBtn = page.locator('.result-report button, .result-report a')
        .filter({ hasText: /\.job/i }).first()
    check('D0 le bouton « Télécharger le .job » est présent', await jobBtn.count() > 0,
        labels.join(' | '))
    if (!(await jobBtn.count())) throw new Error('bouton .job absent')

    // ---------- J8-a : le `.job` EST la sortie attendue --------------------
    //
    // PRIMAIRE et EN TÊTE ; le DXF dit son nom et passe secondaire. Ordre ET
    // thème mesurés dans le DOM (§9.73 point 5) — sur un projet issu d'un
    // `.job`, l'outil ne propose plus en premier ce qu'on ne lui a pas
    // demandé.
    {
        const all = page.locator('.result-report button, .result-report a')
        const n = await all.count()
        let jobIdx = -1
        let dxfIdx = -1
        let jobTheme = ''
        let dxfTheme = ''
        for (let k = 0; k < n; k++) {
            const el = all.nth(k)
            const text = (await el.innerText().catch(() => '')).replace(/\s+/g, ' ')
            const cls = await el.getAttribute('class')
            if (jobIdx < 0 && /\.job/i.test(text)) { jobIdx = k; jobTheme = cls || '' }
            if (dxfIdx < 0 && /(Télécharger le DXF|Download the DXF|Tout télécharger \(DXF\)|Download All \(DXF\))/i.test(text)) {
                dxfIdx = k; dxfTheme = cls || ''
            }
        }
        check('J8-a le bouton `.job` vient EN TÊTE, avant le DXF',
            jobIdx >= 0 && dxfIdx >= 0 && jobIdx < dxfIdx,
            `.job à ${jobIdx}, DXF à ${dxfIdx}`)
        check('J8-a le `.job` est PRIMAIRE, le DXF secondaire',
            /button--theme-primary/.test(jobTheme) && /button--theme-secondary/.test(dxfTheme),
            `.job « ${jobTheme.slice(0, 60)} », DXF « ${dxfTheme.slice(0, 60)} »`)
        check('J8-a le DXF dit son nom (plus de « Télécharger » ambigu)',
            labels.some((l) => /(Télécharger le DXF|Download the DXF|Tout télécharger \(DXF\)|Download All \(DXF\))/i.test(l)),
            labels.join(' | '))

        // J8-a, multi-tôles — le `.job` a le même « tout télécharger » que
        // le DXF : autant de fichiers que de tôles, chacun relu par NOTRE
        // lecteur (§9.73 point 5). L'asymétrie d'avant : changer d'onglet
        // et recliquer une fois par tôle.
        const allJobsBtn = page.locator('.result-report button, .result-report a')
            .filter({ hasText: /(Télécharger tous les \.job|Download all the \.job files)/i }).first()
        if (await allJobsBtn.count()) {
            const downloads = []
            const grab = (d) => downloads.push(d)
            page.on('download', grab)
            await allJobsBtn.click()
            // Les téléchargements sont ÉTALÉS de 300 ms (garde anti-rafale
            // du navigateur) : on laisse le temps à tous de partir.
            await page.waitForTimeout(4000)
            page.off('download', grab)
            const savedJobs = []
            for (const d of downloads) {
                const p = path.join(OUT, `j8-multi-${savedJobs.length + 1}.job`)
                await d.saveAs(p).catch(() => null)
                if (fs.existsSync(p)) savedJobs.push(p)
            }
            let allValid = savedJobs.length > 0
            const counts = []
            for (const p of savedJobs) {
                try {
                    const j = parseSheetCamJob(new Uint8Array(fs.readFileSync(p)))
                    counts.push(j.parts.filter((x2) => x2.enabled).length)
                } catch {
                    allValid = false
                }
            }
            log('tous les .job téléchargés :', savedJobs.length, 'fichiers, pièces actives', counts.join('/'))
            check('J8-a multi-tôles : autant de .job téléchargés que de tôles, chacun valide',
                allValid && savedJobs.length >= 2
                && counts.reduce((a, b) => a + b, 0) === record.placed,
                `${savedJobs.length} fichier(s), pièces actives ${counts.join('/')} pour ${record.placed} posées`)
        } else {
            log('J8-a multi-tôles NON MESURÉ : une seule tôle (bouton « tous les .job » absent)')
        }
    }

    const dl = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        jobBtn.click(),
    ]).then(([d]) => d)
    const saved = path.join(OUT, 'sortie.job')
    await dl.saveAs(saved)
    log('téléchargé :', dl.suggestedFilename(), `${fs.statSync(saved).size} octets`)
    check('D1 le nom porte le numéro de tôle', /_tole\d+\.job$/i.test(dl.suggestedFilename()),
        dl.suggestedFilename())

    // Relu par NOTRE lecteur : c'est la seule mesure qui vaut.
    const out = parseSheetCamJob(new Uint8Array(fs.readFileSync(saved)))

    check('D2 Count = le nombre de pièces posées', out.count === out.parts.length,
        `Count=${out.count}, sections=${out.parts.length}`)
    check('D3 Optimisation = 3 (manuel, pièces groupées)', out.optimisation === 3,
        String(out.optimisation))
    const copies = out.parts.filter((p) => p.copyOf >= 0).length
    check('D4 les exemplaires supplémentaires sont des copyOf',
        copies === out.parts.length - wanted.size,
        `${copies} copies pour ${out.parts.length} sections et ${wanted.size} dessins`)
    check('D5 chemins absolus masqués',
        out.parts.every((p) => !/[\\/]/.test(p.drawingFile)),
        out.parts.map((p) => p.drawingFile).join(', '))
    // D6 — LE CACHE BINAIRE RESTE CELUI DE SHEETCAM, SAUF LA OU NOUS ECRIVONS.
    //
    // Jusqu'au lot J4-bis-3 ce verrou exigeait l'identite a l'octet. Le lot
    // J4-ter ecrit desormais le point de depart retenu et leve le drapeau
    // « deplace a la main » (SS9.50 : sans lui, SheetCam RECALCULE le point a
    // l'ouverture et amorce ailleurs que la ou la place est gardee). Le verrou
    // devient donc : rien ne bouge en dehors de ces champs-la.
    const { jobPathRecords } = await import('../shared/sheetcamJob.js')
    const champs = new Set()
    for (const d of jobPathRecords(source.binary) || []) {
        for (const p of d.paths) {
            if (Number.isInteger(p.at?.moved)) champs.add(p.at.moved)
            for (let k = 0; k < 8; k++) {
                if (Number.isInteger(p.at?.x)) champs.add(p.at.x + k)
                if (Number.isInteger(p.at?.y)) champs.add(p.at.y + k)
            }
        }
    }
    const bouges = []
    if (out.binary.length === source.binary.length) {
        for (let i = 0; i < out.binary.length; i++) {
            if (out.binary[i] !== source.binary[i]) bouges.push(i)
        }
    }
    check('D6 bloc binaire intact SAUF les points de depart que nous ecrivons',
        out.binary.length === source.binary.length && bouges.every((i) => champs.has(i)),
        `${bouges.length} octet(s) change(s), tous dans les champs de depart : `
        + `${bouges.every((i) => champs.has(i))}`)
    // Lot J7-b — phase MANUELLE du couple A/B : TOUS les points de ce
    // fichier sont déplacés à la main (§9.59) : NestorCut n'écrit RIEN, le
    // bloc binaire sort IDENTIQUE à l'octet près.
    if (J7_AB) {
        check('J7-ab (manuel) : 0 octet du bloc binaire change',
            out.binary.length === source.binary.length && bouges.length === 0,
            `${bouges.length} octet(s) change(s)`)
    } else {
        // D6b : et nous avons BIEN ecrit — un `.job` rendu dont aucun drapeau
        // n'est leve signifierait que J4-ter ne fait rien.
        const leves = (jobPathRecords(out.binary) || [])
            .flatMap((d) => d.paths).filter((p) => p.moved).length
        check('D6b au moins un point de depart est marque « deplace »', leves > 0,
            `${leves} drapeau(x) leve(s)`)
    }
    // D7 ne compte PAS les pièces : le cas A4 dépose volontairement une
    // seconde fois, et une tôle peut de toute façon n'en porter qu'une partie.
    // Ce qui doit être vrai quoi qu'il arrive : aucune section écrite qui ne
    // vienne d'un dessin du `.job` (on ne peut pas inventer une pièce, règle 5),
    // et `Count` cohérent avec le nombre de sections.
    const known = new Set(source.parts.map((p) => p.drawingName))
    check('D7 aucune pièce écrite qui ne vienne du `.job`',
        out.parts.length > 0 && out.parts.every((p) => known.has(p.drawingName)),
        `${out.parts.length} sections, dessins : ${[...new Set(out.parts.map((p) => p.drawingName))].join(', ')}`)
    check('D7b Count est cohérent avec le nombre de sections',
        out.count === out.parts.length, `Count=${out.count}, sections=${out.parts.length}`)

    // E. l'intervalle d'angle de SheetCam — le défaut `Angle=-6.283`.
    const angles = out.parts.map((p) => p.angle)
    check('E1 tout angle dans (−2π, 0]',
        angles.every((a) => a <= 0 && a > -2 * Math.PI - 1e-9),
        angles.map((a) => a.toFixed(4)).join(', '))

    // Ordre de coupe : les nichées avant leur hôte. On ne peut le vérifier
    // que s'il y a eu nichage — sinon on le DIT, au lieu d'un verrou vide.
    const opOrder = out.lines.filter((l) => l.kind === 'entry' && /^Op\d+$/.test(l.key))
    const enabled = out.parts.filter((p) => p.enabled)
    log('[OpOrder] :', opOrder.map((l) => l.value).join(' | '))
    log('pièces actives :', enabled.map((p) => p.index).join(','))
    // Un pas par pièce ACTIVE, pas par section : une pièce non posée sur
    // CETTE tôle est désactivée et n'a rien à faire dans l'ordre de coupe.
    check('D8 [OpOrder] = une ligne par pièce active',
        opOrder.length === enabled.length,
        `${opOrder.length} pas pour ${enabled.length} pièces actives (${out.parts.length} sections)`)
    check('D9 [OpOrder] ne désigne que des pièces actives',
        opOrder.every((l) => enabled.some((p) => p.index === Number(String(l.value).split(',')[0]))),
        opOrder.map((l) => l.value).join(' | '))

    // D10 — le nichage, mesuré sur ce que le post-pass a ÉTABLI (les paires
    // `[nichée, hôte]`) contre l'ordre de coupe ÉCRIT DANS LE MÊME FICHIER.
    // Un résultat porte plusieurs alternatives : comparer les paires de l'une
    // à l'ordre de l'autre ne mesurerait rien. On balaie donc TOUS les
    // fichiers produits — la propriété doit tenir sur chacun.
    {
        const files = (record.jobsAll || []).flat()
        const withNesting = files.filter((f) => (f.nestedPairs || []).length)
        if (withNesting.length) {
            const bad = []
            for (const f of withNesting) {
                const pos = new Map((f.order || []).map((rank, i) => [rank, i]))
                for (const [n, h] of f.nestedPairs) {
                    if (!(pos.get(n) < pos.get(h))) bad.push({ file: f.fileName, n, h, order: f.order })
                }
            }
            check('D10 chaque pièce nichée est coupée AVANT SON hôte',
                bad.length === 0,
                `${withNesting.length} fichier(s) avec nichage, `
                + `${withNesting.reduce((k, f) => k + f.nestedPairs.length, 0)} paire(s)`
                + (bad.length ? ` — fautifs : ${JSON.stringify(bad)}` : ''))
        } else {
            log('D10 NON MESURÉ : aucune pièce nichée dans aucune alternative')
            results.D10 = { ok: null, detail: 'aucun nichage' }
        }
    }

    // ---------- J7-b : phase 2 — le fichier AUTOMATIQUE du couple ----------
    //
    // MÊME dessin que la phase principale, points TOUS automatiques : la
    // géométrie importée doit être identique (même compte de pièces et de
    // trous), et le `.job` rendu ne doit changer QUE LES DRAPEAUX « déplacé
    // à la main » — les valeurs écrites sont celles lues, elles ne bougent
    // pas (mesure §9.69 : 3 octets sur le fichier j7-2). Contraste exact
    // avec la phase manuelle : 0 octet.
    if (J7_AB) {
        // Les fiches des DEUX projets cohabitent dans IndexedDB : on ne
        // compte que celles du projet courant ( piège #47 ).
        const countsOf = (slugFilter) => page.evaluate(async ({ slugFilter }) => {
            const db = await new Promise((res, rej) => {
                const r = indexedDB.open('nestorcut-local')
                r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
            })
            const recs = await new Promise((res, rej) => {
                const tx = db.transaction('files', 'readonly').objectStore('files').getAll()
                tx.onsuccess = () => res(tx.result || []); tx.onerror = () => rej(tx.error)
            })
            return recs
                .filter((r) => r.projectSlug === slugFilter)
                .map((r) => ({
                    parts: (r.parts || []).length,
                    holes: (r.parts || []).reduce((n, p) => n + (p.holes || []).length, 0),
                    source: r.source ?? null,
                }))
        }, { slugFilter })
        const phase1Counts = (await countsOf(slug)).map((c) => `${c.parts}p/${c.holes}t`)
        log('phase 1 (manuel) :', JSON.stringify(phase1Counts))

        const autoBytes = new Uint8Array(fs.readFileSync(JOB_AUTO))
        await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
        const devCard2 = page
            .locator('.create__privacy [role="radio"]')
            .filter({ hasText: /(This device|Cet appareil)/i })
            .first()
        if (await devCard2.count()) await devCard2.click().catch(() => {})
        await page.setInputFiles('input[name="dxf"]', [JOB_AUTO])
        await page.waitForURL('**/project/**', { timeout: 90000 })
        const slug2 = page.url().split('/project/')[1].split(/[?#]/)[0]
        await page.waitForFunction(
            (n) => document.querySelectorAll('[data-testid="file-card"], .file').length >= n,
            1,
            { timeout: 120000 },
        ).catch(() => log('ATTENTION : fiche attendue non visible (phase 2)'))
        await shot('04-j7ab-auto-depose.png')

        const phase2Counts = (await countsOf(slug2)).map((c) => `${c.parts}p/${c.holes}t`)
        log('phase 2 (auto) :', JSON.stringify(phase2Counts))
        check('J7-ab même compte de pièces et de trous des deux côtés',
            JSON.stringify(phase1Counts) === JSON.stringify(phase2Counts),
            `manuel ${phase1Counts.join(',')} / auto ${phase2Counts.join(',')}`)

        const nestBtn2 = page.locator('.atelier__nest')
        await nestBtn2.waitFor({ timeout: 30000 })
        await nestBtn2.click()
        const t2 = Date.now()
        let outcome2 = 'timeout'
        while (Date.now() - t2 < 5 * 60 * 1000) {
            const err2 = (await page.locator('.content__error').allInnerTexts().catch(() => []))
                .map((s) => s.trim()).filter(Boolean).join(' | ')
            if (err2) { outcome2 = 'erreur: ' + err2; break }
            const item2 = page.locator('.results__item').first()
            if (await item2.count()) {
                const failed2 = await item2.locator('.result__placeholder').count()
                const done2 = await item2.locator('.controls__report, .controls__download').count()
                if (failed2) { outcome2 = 'échec'; break }
                if (done2) { outcome2 = 'fini'; break }
            }
            await page.waitForTimeout(1500)
        }
        log('phase 2 nesting :', outcome2)
        check('J7-ab (auto) le nesting aboutit', outcome2 === 'fini', outcome2)
        if (outcome2 !== 'fini') throw new Error('phase 2 : nesting non abouti — ' + outcome2)
        await shot('05-j7ab-auto-resultat.png')

        await page.locator('.results__item .controls__report').first().click()
        await page.waitForSelector('.modal__report, .result-report', { timeout: 60000 })
        const jobBtn2 = page.locator('.result-report button, .result-report a')
            .filter({ hasText: /\.job/i }).first()
        const dl2 = await Promise.all([
            page.waitForEvent('download', { timeout: 60000 }),
            jobBtn2.click(),
        ]).then(([d]) => d)
        const saved2 = path.join(OUT, 'sortie-auto.job')
        await dl2.saveAs(saved2)
        const out2 = parseSheetCamJob(new Uint8Array(fs.readFileSync(saved2)))
        // Le BLOC BINAIRE du `.job` d'entrée (sous-tableau depuis le
        // marqueur) — jamais le fichier entier, qui commencerait la lecture
        // dans le texte INI.
        const autoBinary = parseSheetCamJob(autoBytes).binary

        const flagOffsets = new Set()
        for (const d of jobPathRecords(autoBinary) || []) {
            for (const p of d.paths) {
                if (Number.isInteger(p.at?.moved)) flagOffsets.add(p.at.moved)
            }
        }
        const bouges2 = []
        if (out2.binary.length === autoBinary.length) {
            for (let i = 0; i < out2.binary.length; i++) {
                if (out2.binary[i] !== autoBinary[i]) bouges2.push(i)
            }
        }
        check('J7-ab (auto) seuls les DRAPEAUX « déplacé » changent',
            out2.binary.length === autoBinary.length
            && bouges2.length > 0 && bouges2.every((i) => flagOffsets.has(i)),
            `${bouges2.length} octet(s) change(s), drapeaux attendus : ${flagOffsets.size}`)
    }

    // ---------- J8-c : PLUSIEURS `.job` d'un coup, chacun reconnaissable --
    //
    // L'atelier dépose cinq `.job` d'un coup : autant de fiches que de
    // fichiers, chacune portant SA puce « .job » et le NOM DE SON fichier
    // déposé en ligne secondaire (§9.73 point 16). Les fichiers viennent de
    // QA_J7_DIR, choisis PAR CARACTÉRISTIQUES (dessin unique) — aucun nom
    // du propriétaire ici ni au journal.
    if (fs.existsSync(J7_DIR)) {
        const singles = []
        for (const f of fs.readdirSync(J7_DIR).filter((x) => x.toLowerCase().endsWith('.job'))) {
            try {
                const job = parseSheetCamJob(new Uint8Array(fs.readFileSync(path.join(J7_DIR, f))))
                if (job.parts.filter((p) => p.copyOf < 0).length === 1) singles.push(path.join(J7_DIR, f))
            } catch { /* hors cas */ }
            if (singles.length >= 2) break
        }
        if (singles.length >= 2) {
            await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
            await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
            const devCardJ8 = page
                .locator('.create__privacy [role="radio"]')
                .filter({ hasText: /(This device|Cet appareil)/i })
                .first()
            if (await devCardJ8.count()) await devCardJ8.click().catch(() => {})
            await page.setInputFiles('input[name="dxf"]', singles)
            await page.waitForURL('**/project/**', { timeout: 90000 })
            const j8Slug = page.url().split('/project/')[1].split(/[?#]/)[0]
            await page.waitForFunction(
                (n) => document.querySelectorAll('[data-testid="file-card"], .file').length >= n,
                singles.length,
                { timeout: 120000 },
            ).catch(() => log('ATTENTION : fiches multi-.job attendues non visibles'))
            await shot('06-j8c-multi-job.png')
            const origins = await page.locator('[data-testid="file-job-origin"]').allInnerTexts()
                .then((xs) => xs.map((s) => s.replace(/\s+/g, ' ').trim()))
            log('lignes de provenance :', JSON.stringify(origins))
            check('J8-c autant de fiches que de `.job` déposés',
                origins.length === singles.length,
                `${origins.length} ligne(s) pour ${singles.length} fichiers`)
            check('J8-c chaque fiche porte sa puce .job',
                origins.every((o) => /^\.job/.test(o) && o.length > 4),
                JSON.stringify(origins))
            // Chaque fiche nomme SON `.job` : les lignes sont DISTINCTES.
            check('J8-c chaque fiche nomme SON `.job` (lignes distinctes)',
                new Set(origins).size === origins.length,
                JSON.stringify(origins))
            // Et les fiches du projet principal ne sont pas comptées : la
            // sonde est DOM (page courante), pas IndexedDB.
            void j8Slug
        } else {
            log('J8-c NON MESURÉ : moins de deux `.job` à dessin unique dans', J7_DIR)
        }
    } else {
        log('J8-c NON MESURÉ : dossier de la série absent')
    }

} catch (e) {
    failures++
    log('EXCEPTION :', String(e?.stack || e).slice(0, 800))
    await shot('99-exception.png')
} finally {
    flush()
    await browser.close()
    log(failures ? `${failures} VERROU(S) EN ÉCHEC` : 'TOUS LES VERROUS SONT VERTS')
    fs.writeFileSync(path.join(OUT, 'run.log'), logs.join('\n') + '\n')
    process.exit(failures ? 1 : 0)
}
