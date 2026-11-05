// QA — poids du JS préchargé par /auth/local (AGENTS.md §2 #64 : c'est la
// page d'entrée de la prod, le chargement initial y compte).
//
// Constat du 04/11 : le HTML de /auth/local préchargeait 27 chunks (+ 18 en
// prefetch), dont un de 1,2 Mo qui contenait dxf-viewer et three, alors que
// ces deux paquets ne servent qu'à la vue DXF, chargée à la demande. Un
// import dynamique ne suffit pas : si l'assistant CommonJS partagé atterrit
// dans ce chunk, chaque petit chunk qui l'importe en statique le fait
// précharger. Ce garde-fou le détecte sur un build.
//
// Usage (sur un build, serveur lancé avec `node .output/server/index.mjs`) :
//   node scripts/qa-preload-auth-local.mjs [--base http://127.0.0.1:3000]
//        [--public .output/public] [--html page.html] [--max-ko 900]
// Échec (exit 1) si le JS préchargé dépasse --max-ko (non compressé) ou si un
// fichier préchargé contient le moteur WebGL de three. Aucune écriture.
import fs from 'node:fs'
import path from 'node:path'

const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > 0 ? process.argv[i + 1] : def
}
const BASE = arg('base', process.env.QA_BASE_URL || 'http://127.0.0.1:3000')
const PUBLIC_DIR = path.resolve(arg('public', '.output/public'))
const MAX_KO = Number(arg('max-ko', '900'))
const htmlFile = arg('html', null)

const html = htmlFile
    ? fs.readFileSync(htmlFile, 'utf8')
    : await (await fetch(`${BASE}/auth/local`)).text()

const urls = { modulepreload: new Set(), prefetch: new Set(), script: new Set() }
for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    const rel = /rel="([^"]+)"/.exec(tag)?.[1]
    const href = /href="([^"]+\.js)"/.exec(tag)?.[1]
    if (href && urls[rel]) urls[rel].add(href)
}
for (const [, src] of html.matchAll(/<script\b[^>]*src="([^"]+\.js)"/g)) urls.script.add(src)

const read = (href) => {
    const file = path.join(PUBLIC_DIR, href)
    return fs.existsSync(file) ? fs.readFileSync(file) : null
}
const eager = new Set([...urls.modulepreload, ...urls.script])
let bytes = 0
const heavy = []
for (const href of eager) {
    const buf = read(href)
    if (!buf) { console.error(`introuvable sur disque : ${href}`); process.exit(2) }
    bytes += buf.length
    if (buf.includes('WebGLRenderer')) heavy.push(href)
}
let prefetchBytes = 0
for (const href of urls.prefetch) prefetchBytes += read(href)?.length ?? 0

const ko = (n) => `${Math.round(n / 1024)} Ko`
console.log(`préchargés (modulepreload + script) : ${eager.size} fichiers, ${ko(bytes)}`)
console.log(`prefetch : ${urls.prefetch.size} fichiers, ${ko(prefetchBytes)}`)
let failed = false
if (bytes / 1024 > MAX_KO) { console.error(`ÉCHEC : ${ko(bytes)} > ${MAX_KO} Ko`); failed = true }
if (heavy.length) { console.error(`ÉCHEC : three (WebGLRenderer) dans un chunk préchargé : ${heavy.join(', ')}`); failed = true }
if (!failed) console.log('OK')
process.exit(failed ? 1 : 0)
