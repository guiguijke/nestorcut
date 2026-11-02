/**
 * Fuite d'état d'authentification entre rendus SSR (branche
 * fix/ssr-auth-state, constat QA 2026-11-02, présente depuis le lot 3.1.6).
 *
 * authStore (app/composables/auth.js) vivait au niveau MODULE : un seul état
 * pour toutes les requêtes du process Nitro. Après N'IMPORTE QUEL rendu
 * connecté, un anonyme sur /plans, /changelog ou /benchmarks (middleware
 * auth-optional, qui sautait setUser() quand userIsSet était déjà vrai)
 * recevait l'avatar et le nom du connecté précédent ; et deux rendus
 * concurrents pouvaient s'échanger leur utilisateur entre setUser() et le
 * rendu (/home, /profile…).
 *
 * Sonde HTTP pure (aucun navigateur) : elle lit le HTML servi.
 *  1. séquentielle : la page publique connecté A (témoin : le détecteur voit
 *     bien l'avatar), GET /home connecté A, puis la page publique SANS
 *     cookie → ni avatar, ni nom, ni e-mail de A, ni CTA « Manage in profile ».
 *  2. concurrente : rafales A / B / anonyme entrelacées sur les pages
 *     publiques et protégées → chaque rendu ne montre QUE son utilisateur.
 *
 * Comptes : --register crée deux comptes jetables (base JETABLE uniquement,
 * jamais la base QA partagée) ; sinon SSR_PROBE_USERS="mail:mdp,mail:mdp" ;
 * à défaut, le compte de dev (AGENTS.md §4) seul — la variante concurrente
 * est alors sautée (sortie 3, jamais « vert »). <html data-vault-active> est
 * comparé à l'état du coffre de chaque compte : pour le couvrir vraiment, un
 * des deux comptes doit avoir un coffre déverrouillé.
 *
 * Cible : UN process Nitro (un conteneur). Derrière plusieurs workers, deux
 * requêtes peuvent ne jamais partager de process — un vert n'y prouve rien.
 *
 * Usage : node scripts/qa-ssr-auth-leak.mjs [baseUrl] [--register] [--rounds N]
 * Sortie : 0 = aucune fuite, 1 = fuite constatée, 2 = sonde invalide,
 * 3 = partiel (un seul compte).
 */

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
    const i = args.indexOf(name)
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const BASE = (args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--rounds') || 'http://localhost:7100').replace(/\/$/, '')
const ROUNDS = Number(option('--rounds', 15))
const DEV_ACCOUNT = 'guillaume@local.dev:nestorcut-local-2026'

const PUBLIC_PAGES = ['/plans', '/changelog', '/benchmarks']
const PROTECTED_PAGES = ['/home', '/profile']

class ProbeError extends Error {}

function sessionCookie(res) {
    const hit = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('sessionId='))
    return hit ? hit.split(';')[0] : null
}

async function post(path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    })
    if (!res.ok) throw new ProbeError(`${path} → ${res.status} ${await res.text().catch(() => '')}`.slice(0, 200))
    return sessionCookie(res)
}

async function whoAmI(label, cookie) {
    const res = await fetch(`${BASE}/api/user`, { headers: { cookie } })
    const user = await res.json()
    if (!user?.id || !user?.name) throw new ProbeError(`${label} : /api/user sans utilisateur (${res.status})`)
    const vault = Boolean(user.encryption?.enabled && !user.encryption?.locked)
    return { label, cookie, name: user.name, email: user.email, vault }
}

async function accounts() {
    if (flag('--register')) {
        const tag = Date.now().toString(36)
        const out = []
        for (const label of ['A', 'B']) {
            const email = `ssr-probe-${label.toLowerCase()}-${tag}@probe.test`
            const name = `SsrProbe${label}${tag}`
            const cookie = await post('/api/auth/local/register', { email, name, password: `probe-${tag}-pw` })
            out.push(await whoAmI(label, cookie))
        }
        return out
    }
    const pairs = (process.env.SSR_PROBE_USERS || DEV_ACCOUNT).split(',').slice(0, 2)
    const out = []
    for (const [i, pair] of pairs.entries()) {
        const sep = pair.indexOf(':')
        const cookie = await post('/api/auth/local/login', { email: pair.slice(0, sep), password: pair.slice(sep + 1) })
        out.push(await whoAmI(i ? 'B' : 'A', cookie))
    }
    return out
}

async function render(path, user) {
    const res = await fetch(`${BASE}${path}`, {
        headers: { 'accept-language': 'en', ...(user ? { cookie: user.cookie } : {}) },
        redirect: 'manual',
    })
    return { status: res.status, html: await res.text() }
}

// Ce qu'un rendu laisse voir des utilisateurs : <img class="avatar__img">
// (MainHeader → Avatar.vue), nom / e-mail n'importe où dans le HTML (alt de
// l'avatar, payload), CTA connecté de /plans, et <html data-vault-active>
// (layout auth : en-tête résolu APRÈS le rendu, hors contexte Nuxt).
function inspect(html, users) {
    const avatars = html.match(/<img[^>]*class="[^"]*\bavatar__img\b[^>]*>/g) || []
    return {
        avatars: avatars.length,
        alts: [...new Set(avatars.map((tag) => tag.match(/\balt="([^"]*)"/)?.[1] ?? ''))],
        manage: html.split('Manage in profile').length - 1,
        vault: /<html[^>]*\bdata-vault-active="true"/.test(html),
        seen: users.filter((u) => html.includes(u.name) || (u.email && html.includes(u.email))).map((u) => u.label),
    }
}

const fmt = (s) =>
    `avatar=${s.avatars}${s.avatars ? `(alt=${s.alts.join('|')})` : ''} manage=${s.manage} vault=${s.vault ? 1 : 0} users=[${s.seen.join(',')}]`

async function sequential(users) {
    const [a] = users
    let leaks = 0
    for (const page of PUBLIC_PAGES) {
        // Témoin : la page connecté A. Sans avatar, le détecteur ne voit pas
        // un rendu connecté (sonde invalide) ; avec l'avatar d'un AUTRE que
        // A, c'est déjà la fuite.
        const witness = await render(page, a)
        const w = inspect(witness.html, users)
        if (witness.status !== 200 || !w.avatars) {
            throw new ProbeError(`témoin ${page} connecté A : ${witness.status} ${fmt(w)} — le détecteur ne voit pas un rendu connecté`)
        }
        if (w.alts.some((alt) => alt !== a.name)) {
            leaks++
            console.log(`[seq] ${page.padEnd(11)} témoin connecté A      : ${witness.status} ${fmt(w)} → FUITE (avatar d'un autre)`)
        }
        const primed = await render('/home', a)
        if (primed.status !== 200 || !inspect(primed.html, users).seen.includes('A')) {
            throw new ProbeError(`/home connecté A : ${primed.status} — session non reconnue`)
        }
        const anon = await render(page, null)
        const s = inspect(anon.html, users)
        const leak = anon.status !== 200 || s.avatars > 0 || s.manage > 0 || s.seen.length > 0
        if (leak) leaks++
        console.log(`[seq] ${page.padEnd(11)} anonyme après /home(A) : ${anon.status} ${fmt(s)} → ${leak ? 'FUITE' : 'ok'}`)
    }
    return leaks
}

async function concurrent(users) {
    const jobs = []
    for (const page of [...PUBLIC_PAGES, ...PROTECTED_PAGES]) {
        for (const user of users) jobs.push({ page, user })
        if (PUBLIC_PAGES.includes(page)) jobs.push({ page, user: null })
    }
    const tally = new Map()
    let leaks = 0
    for (let round = 0; round < ROUNDS; round++) {
        // Ordre mélangé à chaque rafale : les rendus A / B / anonyme
        // s'entrelacent dans le même process.
        const batch = [...jobs].sort(() => Math.random() - 0.5)
        const results = await Promise.all(batch.map(async (job) => ({ job, ...(await render(job.page, job.user)) })))
        for (const { job, status, html } of results) {
            const key = `${job.page} ${job.user ? job.user.label : 'anon'}`
            const row = tally.get(key) || { renders: 0, bad: 0, sample: '' }
            row.renders++
            const s = inspect(html, users)
            const others = s.seen.filter((l) => l !== job.user?.label)
            const vaultWrong = PROTECTED_PAGES.includes(job.page) ? s.vault !== Boolean(job.user?.vault) : s.vault
            const foreignAvatar = job.user && s.alts.some((alt) => alt !== job.user.name)
            const bad = job.user
                ? status !== 200 || others.length > 0 || foreignAvatar || !s.seen.includes(job.user.label) || vaultWrong
                : status !== 200 || s.avatars > 0 || s.manage > 0 || s.seen.length > 0 || vaultWrong
            if (bad) {
                row.bad++
                leaks++
                row.sample ||= `${status} ${fmt(s)}`
            }
            tally.set(key, row)
        }
    }
    for (const [key, row] of tally) {
        console.log(`[conc] ${key.padEnd(16)} ${row.bad}/${row.renders} rendus faux${row.bad ? ` (ex. ${row.sample})` : ''}`)
    }
    return leaks
}

async function main() {
    if (!Number.isInteger(ROUNDS) || ROUNDS < 1) throw new ProbeError(`--rounds ${option('--rounds')} : entier ≥ 1 attendu`)
    console.log(`Sonde fuite d'auth SSR — ${BASE}`)
    const users = await accounts()
    for (const u of users) console.log(`  utilisateur ${u.label} : ${u.name}${u.vault ? ' (coffre déverrouillé)' : ''}`)
    if (!users.some((u) => u.vault)) console.log('  data-vault-active : contrôle d\'absence seulement (aucun coffre déverrouillé)')

    const seqLeaks = await sequential(users)
    let concLeaks = 0
    const partial = users.length < 2
    if (partial) {
        console.log('[conc] SAUTÉE : un seul compte (--register ou SSR_PROBE_USERS pour deux)')
    } else {
        concLeaks = await concurrent(users)
    }
    const total = seqLeaks + concLeaks
    if (total) {
        console.log(`ROUGE : ${seqLeaks} fuite(s) séquentielle(s), ${concLeaks} rendu(s) concurrent(s) faux`)
        process.exit(1)
    }
    console.log(partial ? 'PARTIEL : aucune fuite séquentielle, concurrence NON testée' : 'VERT : aucune fuite')
    process.exit(partial ? 3 : 0)
}

main().catch((err) => {
    console.error(err instanceof ProbeError ? `SONDE INVALIDE : ${err.message}` : err)
    process.exit(2)
})
