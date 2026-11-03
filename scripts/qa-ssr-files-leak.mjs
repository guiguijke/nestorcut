/**
 * Fuite d'état de projet entre rendus SSR (branche fix/ssr-files-state,
 * suite du correctif d'auth fix/ssr-auth-state, 2026-11-03).
 *
 * filesStore (app/composables/files.js) vivait au niveau MODULE : un seul
 * état pour toutes les requêtes du process Nitro. La page /project/[slug]
 * lance getProject() dans un watch immédiat que le rendu n'attend pas : le
 * HTML servi montre donc l'état laissé par la requête PRÉCÉDENTE, quel qu'en
 * soit l'utilisateur. Constaté : un utilisateur B qui ouvre l'URL du projet
 * de A reçoit le titre et les noms de fichiers de A ; tout rendu de projet
 * porte le compte « Nest N parts » du dernier projet chargé.
 *
 * Sonde HTTP pure (aucun navigateur) : elle lit le HTML servi.
 *  1. séquentielle : A rend son projet (le fetch serveur remplit l'état
 *     après le rendu), puis B rend le MÊME slug, puis B rend son propre
 *     projet ; et l'inverse. Le rendu de B ne doit montrer aucun nom de
 *     projet ni de fichier de A, et son compte « Nest N parts » vaut 0 ou
 *     celui de B.
 *  2. concurrente : rafales entrelacées A/B × slug A/slug B → chaque rendu
 *     ne montre que les données de son utilisateur.
 *
 * Marqueurs : les fichiers de chaque compte portent un préfixe unique
 * (SsrFilesA<tag>…, SsrFilesB<tag>…) ; le nom du projet en dérive. A a trois
 * fichiers, B un seul : les comptes « Nest N parts » se distinguent. Le menu
 * latéral liste les projets de l'utilisateur (requête à part) : y voir SON
 * préfixe est le témoin que la session est reconnue.
 *
 * Comptes : --register OBLIGATOIRE — la sonde crée deux comptes et deux
 * projets (base JETABLE uniquement, jamais la base QA partagée). Il faut le
 * worker de traitement de fichiers : la sonde attend les fichiers « done ».
 *
 * Cible : UN process Nitro (un conteneur). Derrière plusieurs workers, deux
 * requêtes peuvent ne jamais partager de process — un vert n'y prouve rien.
 *
 * Usage : node scripts/qa-ssr-files-leak.mjs [baseUrl] --register [--rounds N]
 * Sortie : 0 = aucune fuite, 1 = fuite constatée, 2 = sonde invalide.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
    const i = args.indexOf(name)
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const BASE = (args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--rounds') || 'http://localhost:7100').replace(/\/$/, '')
const ROUNDS = Number(option('--rounds', 15))
// Le fetch serveur de getProject se résout APRÈS l'envoi du HTML : on lui
// laisse le temps d'écrire l'état avant le rendu suivant.
const SETTLE_MS = 500

const DXF_DIR = new URL('../docs/cam-validation/', import.meta.url)
const DXF = ['_src_simple.dxf', '_src_holed.dxf', '_src_multi.dxf'].map((f) => readFileSync(fileURLToPath(new URL(f, DXF_DIR))))
const FILE_STEMS = { A: ['Plate', 'Bracket', 'Flange'], B: ['Plate'] }

class ProbeError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function sessionCookie(res) {
    const hit = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('sessionId='))
    return hit ? hit.split(';')[0] : null
}

async function api(path, { cookie, json, form } = {}) {
    const res = await fetch(`${BASE}${path}`, {
        method: json || form ? 'POST' : 'GET',
        headers: { ...(cookie ? { cookie } : {}), ...(json ? { 'content-type': 'application/json' } : {}) },
        body: json ? JSON.stringify(json) : form,
    })
    if (!res.ok) throw new ProbeError(`${path} → ${res.status} ${await res.text().catch(() => '')}`.slice(0, 200))
    return { res, data: await res.json() }
}

async function waitProcessed(user) {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
        const { data } = await api(`/api/project/${user.slug}`, { cookie: user.cookie })
        const files = data.files || []
        if (files.some((f) => f.processingStatus === 'error')) {
            throw new ProbeError(`${user.label} : un fichier est en erreur de traitement`)
        }
        if (files.length === FILE_STEMS[user.label].length && files.every((f) => f.processingStatus === 'done')) {
            return { name: data.name, files: files.map((f) => f.name) }
        }
        await sleep(1000)
    }
    throw new ProbeError(`${user.label} : fichiers non traités après 120 s (worker de traitement absent ?)`)
}

async function accounts() {
    if (!flag('--register')) {
        throw new ProbeError('--register requis : la sonde crée deux comptes et deux projets (base jetable uniquement)')
    }
    const tag = Date.now().toString(36)
    const out = []
    for (const label of ['A', 'B']) {
        const email = `ssr-files-${label.toLowerCase()}-${tag}@probe.test`
        const { res } = await api('/api/auth/local/register', {
            json: { email, name: `SsrProbe${label}${tag}`, password: `probe-${tag}-pw` },
        })
        const cookie = sessionCookie(res)
        if (!cookie) throw new ProbeError(`${label} : inscription sans cookie de session`)
        const prefix = `SsrFiles${label}${tag}`
        const form = new FormData()
        FILE_STEMS[label].forEach((stem, i) => {
            form.append('dxf', new Blob([DXF[i]], { type: 'application/dxf' }), `${prefix}${stem}.dxf`)
        })
        const { data } = await api('/api/project', { cookie, form })
        const user = { label, cookie, prefix, slug: data.slug, count: FILE_STEMS[label].length }
        Object.assign(user, await waitProcessed(user))
        out.push(user)
    }
    return out
}

async function render(path, user) {
    const res = await fetch(`${BASE}${path}`, {
        headers: { 'accept-language': 'en', ...(user ? { cookie: user.cookie } : {}) },
        redirect: 'manual',
    })
    return { status: res.status, location: res.headers.get('location') || '', html: await res.text() }
}

// Ce qu'un rendu laisse voir des projets : préfixes des comptes n'importe où
// (titre, cartes de fichiers, menu latéral, payload), titre <h1>, noms de
// fichiers .dxf et compte du bouton « Nest N parts ».
function inspect(html, users) {
    const nest = html.match(/Nest (\d+) parts?/)
    return {
        seen: users.filter((u) => html.includes(u.prefix)).map((u) => u.label),
        title: (html.match(/<h1 class="content__title"[^>]*>([^<]*)<\/h1>/)?.[1] ?? '').trim(),
        files: [...new Set(html.match(/SsrFiles[AB][a-z0-9]+[A-Za-z]+\.dxf/g) || [])].length,
        count: nest ? Number(nest[1]) : null,
    }
}

const fmt = (r, s) =>
    `${r.status}${r.location ? `→${r.location}` : ''} title="${s.title}" files=${s.files} nest=${s.count ?? '-'} users=[${s.seen.join(',')}]`

// Mauvais rendu : données de l'AUTRE utilisateur, ou compte « Nest » qui
// n'est ni 0 ni celui du lecteur. Sur son propre slug, le lecteur doit
// recevoir la page (200) et y voir son préfixe (témoin de session).
function verdict(r, s, viewer, ownSlug) {
    const foreign = s.seen.some((l) => l !== viewer.label)
    const wrongCount = s.count != null && s.count !== 0 && s.count !== viewer.count
    const ownMissing = ownSlug && (r.status !== 200 || !s.seen.includes(viewer.label))
    return { bad: foreign || wrongCount || ownMissing, foreign, wrongCount, ownMissing }
}

async function sequential(users) {
    let leaks = 0
    for (const [owner, other] of [users, [...users].reverse()]) {
        const steps = [
            { what: `${owner.label} sur son projet (amorce)`, viewer: owner, slug: owner.slug },
            { what: `${other.label} sur le slug de ${owner.label}`, viewer: other, slug: owner.slug },
            { what: `${owner.label} sur son projet (amorce)`, viewer: owner, slug: owner.slug },
            { what: `${other.label} sur son projet`, viewer: other, slug: other.slug },
        ]
        for (const step of steps) {
            const r = await render(`/project/${step.slug}`, step.viewer)
            const s = inspect(r.html, users)
            const v = verdict(r, s, step.viewer, step.slug === step.viewer.slug)
            if (v.bad) leaks++
            console.log(`[seq] ${step.what.padEnd(34)} : ${fmt(r, s)} → ${v.bad ? 'FUITE' : 'ok'}`)
            await sleep(SETTLE_MS)
        }
    }
    return leaks
}

async function concurrent(users) {
    const jobs = []
    for (const viewer of users) for (const owner of users) jobs.push({ viewer, owner })
    const tally = new Map()
    let leaks = 0
    for (let round = 0; round < ROUNDS; round++) {
        // Ordre mélangé à chaque rafale : les rendus A / B s'entrelacent dans
        // le même process, leurs fetchs serveur se résolvent en désordre.
        const batch = [...jobs].sort(() => Math.random() - 0.5)
        const results = await Promise.all(batch.map(async (job) => ({ job, r: await render(`/project/${job.owner.slug}`, job.viewer) })))
        for (const { job, r } of results) {
            const key = `${job.viewer.label} sur projet ${job.owner.label}`
            const row = tally.get(key) || { renders: 0, bad: 0, foreign: 0, wrongCount: 0, ownMissing: 0, statuses: {}, sample: '' }
            row.renders++
            row.statuses[r.status] = (row.statuses[r.status] || 0) + 1
            const s = inspect(r.html, users)
            const v = verdict(r, s, job.viewer, job.owner === job.viewer)
            if (v.bad) {
                row.bad++
                leaks++
                for (const k of ['foreign', 'wrongCount', 'ownMissing']) if (v[k]) row[k]++
                row.sample ||= fmt(r, s)
            }
            tally.set(key, row)
        }
    }
    for (const [key, row] of tally) {
        const statuses = Object.entries(row.statuses).map(([k, n]) => `${k}×${n}`).join(' ')
        const kinds = row.bad ? ` [autre utilisateur ${row.foreign}, compte ${row.wrongCount}, témoin ${row.ownMissing}] (ex. ${row.sample})` : ''
        console.log(`[conc] ${key.padEnd(16)} ${row.bad}/${row.renders} rendus faux, statuts ${statuses}${kinds}`)
    }
    return leaks
}

async function main() {
    if (!Number.isInteger(ROUNDS) || ROUNDS < 1) throw new ProbeError(`--rounds ${option('--rounds')} : entier ≥ 1 attendu`)
    console.log(`Sonde fuite d'état de projet SSR — ${BASE}`)
    const users = await accounts()
    for (const u of users) console.log(`  ${u.label} : projet « ${u.name} » (${u.slug}), ${u.files.length} fichier(s) ${u.files.join(', ')}`)

    const seqLeaks = await sequential(users)
    const concLeaks = await concurrent(users)
    const total = seqLeaks + concLeaks
    if (total) {
        console.log(`ROUGE : ${seqLeaks} rendu(s) séquentiel(s) faux, ${concLeaks} rendu(s) concurrent(s) faux`)
        process.exit(1)
    }
    console.log('VERT : aucune fuite')
    process.exit(0)
}

main().catch((err) => {
    console.error(err instanceof ProbeError ? `SONDE INVALIDE : ${err.message}` : err)
    process.exit(2)
})
