#!/usr/bin/env node
/**
 * QA « moteur × corpus » — lot E0 de docs/PLAN-ECLATEMENT-2026-09-12.md.
 *
 * Question mesurée, une seule : **le moteur accepte-t-il la géométrie de tous
 * les fichiers du corpus à l'import ?** C'est la panne de production du lot
 * E0 : jagua gonfle chaque pièce de `space/2` à l'import et, sur une pièce
 * dont deux brins laissent un canal plus étroit que le gonflement, le contour
 * gonflé se recoupe et le moteur MEURT (« importing SPP instance into
 * jagua-rs: Simple polygon contains intersecting edges ») — job en « stopped
 * unexpectedly » avec remboursement.
 *
 * Chaîne : import navigateur (bundle wasm géométrie de public/geometry, le
 * MÊME que le worker de l'app) -> une instance SPP par fichier (un item par
 * contour, demande 1, espacement 2 mm) -> binaire moteur natif.
 *
 * Pourquoi le binaire NATIF et pas le wasm moteur : c'est le même code et le
 * verrou de déterminisme (bench/determinism_lock.py, fixture e0_volute)
 * prouve que natif et wasm rendent les mêmes octets sur le chemin du repli.
 * Le natif fait le corpus en minutes au lieu d'heures.
 *
 * Avant/après : passer `--bin-before <exe>` pour compter les mêmes échecs
 * avec un binaire SANS le repli (construit à HEAD avec le repli désactivé).
 *
 * Identifiants : les fichiers du corpus RÉEL sont désignés par les 8
 * premiers caractères de leur sha256 — aucun nom réel ne sort d'ici.
 *
 * Usage :
 *   node scripts/qa-engine-corpus.mjs [--in <dir> ...] [--out <dir>]
 *        [--bin <exe>] [--bin-before <exe>] [--space 2] [--budget 2]
 *        [--sheet 3000x1500] [--timeout 60000] [--quiet]
 *
 * Défauts : --in .testparts/corpus + specs/import-corpus
 *           --out $QA_OUT/engine-238 (ou docs/qa/engine-corpus si absent)
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const BUNDLE_JS = path.join(ROOT, 'public', 'geometry', 'nest_geometry.js')
const BUNDLE_WASM = path.join(ROOT, 'public', 'geometry', 'nest_geometry_bg.wasm')

// Miroirs des bornes du chemin navigateur (lot 2a) — un fichier refusé à
// l'import n'arrive jamais au moteur, il n'a rien à faire dans le compte.
const MAX_ENTITY_LIMIT = 10000
const TIME_BUDGET_MS = 20000
const DEFAULT_TOL = 0.01

function parseArgs(argv) {
    const out = { _: [], in: [] }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (!a.startsWith('--')) { out._.push(a); continue }
        const key = a.slice(2)
        const next = argv[i + 1]
        const val = next === undefined || next.startsWith('--') ? true : (i++, next)
        if (key === 'in') out.in.push(String(val))
        else out[key] = val
    }
    return out
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function gitVersion() {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
    return r.status === 0 ? r.stdout.trim() : 'unknown'
}

function listFiles(dir) {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
        .map((f) => path.join(dir, f))
        .filter((p) => fs.statSync(p).isFile())
        .sort()
}

// ------------------------------------------------------------ import wasm

let glue = null
async function loadGlue() {
    if (glue) return glue
    const mod = await import(pathToFileURL(BUNDLE_JS).href)
    await mod.default({ module_or_path: fs.readFileSync(BUNDLE_WASM) })
    glue = mod
    return glue
}

/** Contours du fichier, via l'importeur du navigateur. */
async function importParts(file) {
    const g = await loadGlue()
    const bytes = new Uint8Array(fs.readFileSync(file))
    // Enveloppe du crate : { status, result } | { status, error } — la même
    // que lit app/composables/localImport.js.
    const out = JSON.parse(g.import_file_limited(bytes, DEFAULT_TOL, MAX_ENTITY_LIMIT, TIME_BUDGET_MS))
    if (!out || out.status !== 'ok') {
        return { refused: String(out?.error || out?.reason || out?.status || 'refus sans motif') }
    }
    const parts = Array.isArray(out.result?.parts) ? out.result.parts : []
    return { parts }
}

// ------------------------------------------------------------- instance

function ringBbox(coords) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
    for (const [x, y] of coords) {
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (y < miny) miny = y
        if (y > maxy) maxy = y
    }
    return { w: maxx - minx, h: maxy - miny }
}

function ringArea(coords) {
    let a = 0
    for (let i = 0; i < coords.length; i++) {
        const [px, py] = coords[i]
        const [qx, qy] = coords[(i + 1) % coords.length]
        a += px * qy - qx * py
    }
    return Math.abs(a / 2)
}

/**
 * Instance SPP d'un fichier : un item par contour, demande 1, anneau
 * EXTERNE (les trous sont ouverts par un canal capillaire côté worker —
 * c'est le périmètre des lots E1/E2, pas celui-ci).
 *
 * La hauteur de bande n'est pas toujours celle de la tôle : sparrow part
 * d'une largeur `aire totale / hauteur` DÉFLATÉE de `space/2` (piège AGENTS
 * #2b) et panique si elle passe sous zéro. Sur les fichiers à petites pièces
 * on abaisse donc la bande — la question posée reste l'IMPORT, et une panique
 * de garde de bande n'y répondrait pas. Le nombre de fichiers concernés est
 * reporté (`stripAdjusted`).
 */
function buildInstance(parts, { space, sheetW, sheetH }) {
    const items = []
    let maxDim = 0
    let totalArea = 0
    for (const p of parts) {
        const coords = p.coordinates || p.coords
        if (!Array.isArray(coords) || coords.length < 3) continue
        const { w, h } = ringBbox(coords)
        maxDim = Math.max(maxDim, w, h)
        totalArea += ringArea(coords)
        items.push({
            id: items.length,
            demand: 1,
            allowed_orientations: [0.0],
            shape: { type: 'simple_polygon', data: coords.map(([x, y]) => [x, y]) },
        })
    }
    if (!items.length) return null
    // Garde de FAISABILITÉ (piège AGENTS #49 : jagua gonfle l'item ET le
    // conteneur, donc `w + 2·space ≤ tôle`). La production la pose des deux
    // côtés (`part_fits_any_sheet`, `localPayloadBuilder`) et refuse avec un
    // message ; sans elle le moteur panique (« strip-width is running away »),
    // ce qui ne répond pas à la question de l'import. Rotations [0] ici : la
    // pièce doit tenir telle quelle.
    const tooBig = items.some((it) => {
        const { w, h } = ringBbox(it.shape.data)
        return w + 2 * space > sheetW || h + 2 * space > sheetH
    })
    if (tooBig) return { guarded: 'fit', items: items.length, maxDim, totalArea }
    // Il faut aussi que la largeur initiale de bande reste positive.
    const hMin = maxDim + 2 * space
    const hMax = totalArea / (3 * space)
    if (hMin > hMax) {
        // Aucune hauteur ne satisfait les deux contraintes à la fois : c'est
        // exactement le cas que la GARDE de production refuse AVANT d'appeler
        // le moteur (piège #2b, `localPayloadBuilder.js` côté navigateur et
        // `main.py` côté serveur, avec un message explicite). Le faire
        // tourner quand même ne mesurerait qu'une panique connue de la garde
        // de bande, pas l'import.
        return { guarded: 'strip', items: items.length, maxDim, totalArea }
    }
    let stripHeight = sheetH
    let adjusted = false
    if (hMax < sheetH) {
        stripHeight = Math.max(hMin, Math.min(sheetH, hMax))
        adjusted = stripHeight !== sheetH
    }
    return {
        instance: { name: 'qa-engine-corpus', strip_height: stripHeight, items },
        adjusted,
        stripHeight,
        items: items.length,
        maxDim,
        totalArea,
        sheetW,
    }
}

function engineConfig({ space, budget, sheetW }) {
    return {
        time_budget_sec: budget,
        prng_seed: 20260912,
        n_alternatives: 1,
        n_workers: 1,
        separator_workers: 1,
        min_item_separation: space,
        poly_simpl_tolerance: 0.001,
        narrow_concavity_cutoff: null,
        max_strip_width: sheetW,
        live_events: false,
        two_phase: false,
    }
}

// --------------------------------------------------------------- moteur

/** Classe une sortie moteur : ok / import / autre. */
function classify(res) {
    const out = `${res.stdout || ''}`
    const err = `${res.stderr || ''}`
    const all = `${out}\n${err}`
    if (res.status === 0) return { outcome: 'ok', detail: null }
    const importItem = /item_geometry:(\d+):([^\n]*)/.exec(all)
    if (importItem) {
        return {
            outcome: 'import_item',
            item: Number(importItem[1]),
            detail: importItem[2].trim().slice(0, 160),
        }
    }
    if (/importing (SPP|BPP) instance into jagua-rs/.test(all)) {
        const m = /importing (?:SPP|BPP) instance into jagua-rs[^\n]*/.exec(all)
        return { outcome: 'import_instance', detail: (m ? m[0] : '').slice(0, 160) }
    }
    // Une panique : garder la LIGNE DE LA PANIQUE, pas le « note: run with
    // RUST_BACKTRACE » qui la suit et qui ne dit rien.
    const lines = all.split(/\r?\n/)
    const pi = lines.findIndex((l) => l.includes('panicked at'))
    if (pi >= 0) {
        const detail = [lines[pi], lines[pi + 1] || ''].join(' ').replace(/\s+/g, ' ').trim()
        return { outcome: 'panic', detail: detail.slice(0, 160) }
    }
    const fail = /nest-engine failed:[^\r\n]*/.exec(all)
    if (fail) return { outcome: 'other', detail: fail[0].slice(0, 160) }
    const line = (all.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '').slice(0, 160)
    return { outcome: res.status === null ? 'timeout' : 'other', detail: line }
}

function runEngine(bin, instance, config, tmpDir, timeout) {
    const iPath = path.join(tmpDir, 'instance.json')
    const cPath = path.join(tmpDir, 'config.json')
    const oDir = path.join(tmpDir, 'out')
    fs.writeFileSync(iPath, JSON.stringify(instance))
    fs.writeFileSync(cPath, JSON.stringify(config))
    fs.rmSync(oDir, { recursive: true, force: true })
    fs.mkdirSync(oDir, { recursive: true })
    const t0 = Date.now()
    const res = spawnSync(bin, ['-i', iPath, '-c', cPath, '-s', oDir, '-p', 'spp'], {
        encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024,
    })
    return { ...classify(res), ms: Date.now() - t0 }
}

// ----------------------------------------------------------------- main

async function main() {
    const args = parseArgs(process.argv.slice(2))
    const dirs = args.in.length
        ? args.in.map((d) => path.resolve(ROOT, d))
        : [path.join(ROOT, '.testparts', 'corpus'), path.join(ROOT, 'specs', 'import-corpus')]
    const outDir = path.resolve(
        args.out && args.out !== true
            ? String(args.out)
            : process.env.QA_OUT
                ? path.join(process.env.QA_OUT, 'engine-238')
                : path.join(ROOT, 'docs', 'qa', 'engine-corpus'),
    )
    const binAfter = String(args.bin && args.bin !== true ? args.bin
        : path.join(ROOT, 'workers', 'nesting', 'engine', 'target', 'release',
            process.platform === 'win32' ? 'nest-engine.exe' : 'nest-engine'))
    const binBefore = args['bin-before'] && args['bin-before'] !== true
        ? String(args['bin-before']) : null
    const space = Number(args.space || 2)
    const budget = Number(args.budget || 2)
    const [sheetW, sheetH] = String(args.sheet || '3000x1500').split('x').map(Number)
    const timeout = Number(args.timeout || 60000)
    const quiet = !!args.quiet

    fs.mkdirSync(outDir, { recursive: true })
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-engine-'))
    const config = engineConfig({ space, budget, sheetW })

    const rows = []
    for (const dir of dirs) {
        const versioned = dir.includes('.testparts')
        for (const file of listFiles(dir)) {
            const buf = fs.readFileSync(file)
            const hash = sha256(buf)
            // Corpus versionné : l'identifiant du lot A (c07…) est déjà
            // anonyme. Corpus réel : préfixe de hash, jamais le nom.
            const id = versioned
                ? (path.basename(file).match(/^c\d\d/) || [null])[0] || hash.slice(0, 8)
                : hash.slice(0, 8)
            const row = { id, corpus: versioned ? 'versionne' : 'reel', bytes: buf.length }
            let imported
            try {
                imported = await importParts(file)
            } catch (e) {
                row.stage = 'import_navigateur'
                row.outcome = 'refused_import'
                row.detail = String(e?.message || e).slice(0, 160)
                rows.push(row)
                if (!quiet) console.log(`${id}  import navigateur refusé : ${row.detail}`)
                continue
            }
            if (imported.refused) {
                row.stage = 'import_navigateur'
                row.outcome = 'refused_import'
                row.detail = imported.refused.slice(0, 160)
                rows.push(row)
                if (!quiet) console.log(`${id}  import navigateur refusé : ${row.detail}`)
                continue
            }
            const built = buildInstance(imported.parts, { space, sheetW, sheetH })
            if (built && built.guarded) {
                row.stage = 'garde_de_production'
                row.outcome = built.guarded === 'fit' ? 'refused_fit_guard' : 'refused_strip_guard'
                row.items = built.items
                rows.push(row)
                if (!quiet) {
                    console.log(`${id}  refusé par la garde de production `
                        + (built.guarded === 'fit' ? '(faisabilité, #49)' : '(bande, #2b)'))
                }
                continue
            }
            if (!built) {
                row.stage = 'import_navigateur'
                row.outcome = 'no_parts'
                rows.push(row)
                if (!quiet) console.log(`${id}  aucun contour`)
                continue
            }
            row.stage = 'moteur'
            row.items = built.items
            row.stripAdjusted = built.adjusted
            row.stripHeight = Math.round(built.stripHeight * 10) / 10
            const after = runEngine(binAfter, built.instance, config, tmpDir, timeout)
            row.after = after
            if (binBefore) row.before = runEngine(binBefore, built.instance, config, tmpDir, timeout)
            rows.push(row)
            if (!quiet) {
                const b = row.before ? ` | avant: ${row.before.outcome}` : ''
                console.log(`${id}  items=${built.items}  apres: ${after.outcome}${b}`
                    + (after.detail ? `  — ${after.detail.slice(0, 80)}` : ''))
            }
        }
    }

    const count = (side, outcome) => rows.filter((r) => r[side]?.outcome === outcome).length
    const summary = {
        version: gitVersion(),
        space, budget, sheet: [sheetW, sheetH],
        binAfter, binBefore,
        engineWasmSha256: null,
        files: rows.length,
        refusedByBrowserImport: rows.filter((r) => r.outcome === 'refused_import').length,
        noParts: rows.filter((r) => r.outcome === 'no_parts').length,
        refusedByStripGuard: rows.filter((r) => r.outcome === 'refused_strip_guard').length,
        refusedByFitGuard: rows.filter((r) => r.outcome === 'refused_fit_guard').length,
        reachedEngine: rows.filter((r) => r.stage === 'moteur').length,
        stripAdjusted: rows.filter((r) => r.stripAdjusted).length,
        after: {
            ok: count('after', 'ok'),
            importItem: count('after', 'import_item'),
            importInstance: count('after', 'import_instance'),
            other: count('after', 'other'),
            panic: count('after', 'panic'),
            timeout: count('after', 'timeout'),
        },
        before: binBefore ? {
            ok: count('before', 'ok'),
            importItem: count('before', 'import_item'),
            importInstance: count('before', 'import_instance'),
            other: count('before', 'other'),
            panic: count('before', 'panic'),
            timeout: count('before', 'timeout'),
        } : null,
    }
    summary.importFailuresAfter = summary.after.importItem + summary.after.importInstance
    summary.importFailuresBefore = summary.before
        ? summary.before.importItem + summary.before.importInstance : null
    // Les fichiers RÉPARÉS par le repli : import cassé avant, OK après.
    summary.repaired = binBefore
        ? rows.filter((r) => r.before && r.after
            && r.before.outcome.startsWith('import') && r.after.outcome === 'ok')
            .map((r) => r.id)
        : null

    fs.writeFileSync(path.join(outDir, 'rows.json'), JSON.stringify(rows, null, 1))
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1))
    console.log('\n=== moteur × corpus ===')
    console.log(JSON.stringify(summary, null, 1))
    console.log(`\nsorties : ${outDir}`)
    fs.rmSync(tmpDir, { recursive: true, force: true })
}

main().catch((e) => { console.error(e); process.exit(1) })
