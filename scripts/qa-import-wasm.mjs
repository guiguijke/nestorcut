#!/usr/bin/env node
/**
 * QA import — lot B (docs/PLAN-IMPORT-2026-09-09.md §3) : coureur WASM.
 *
 * Charge le bundle géométrie du CHEMIN NAVIGATEUR (public/geometry/, produit
 * par workers/geometry/build-wasm.sh, cible wasm-bindgen `web`) et appelle
 * l'import EXACTEMENT comme le worker géométrie de l'app :
 *
 *   public/workers/geometry.worker.js  ->  import_file(new Uint8Array(bytes), tol ?? 0.01)
 *   app/composables/geometryClient.js  ->  geoImportFile(bytes, tol = 0.01)
 *                                          geoCanonicalDxf(bytes, tol = 0.01)
 *
 * L'app (app/composables/localImport.js) enchaîne import_file_limited PUIS
 * canonical_dxf, et applique ses gardes AVANT d'accepter le fichier :
 * extension (.dxf/.svg, .dwg refusé), taille (MAX_UPLOAD_FILE_BYTES = 5 Mio),
 * puis les BORNES D'IMPORT portées par le wasm depuis le lot 2a (plafond de
 * 10 000 entités posé avant la décomposition, budget de 20 s qui arrête le
 * travail) et parts.length === 0. Le coureur reproduit cette chaîne
 * complète : le statut décrit ce que VOIT l'utilisateur du chemin
 * navigateur, pas seulement le crate.
 *
 * Isolation : chaque fichier est traité dans un PROCESSUS ENFANT avec
 * timeout. Un panic wasm (trap), un OOM, une boucle O(n²) qui ne rend pas la
 * main -> `status: "refused"` + message dans le JSON, jamais un arrêt du
 * coureur (contrat du lot B).
 *
 * Sortie : un fichier par DXF, grille §4 du plan (clés dans l'ordre du plan,
 * champ non mesurable = null, JAMAIS omis), plus un bloc additif `extra`
 * (identification + traçabilité du bundle) que le lot D peut ignorer.
 *
 * Usage :
 *   node scripts/qa-import-wasm.mjs [--in <dir|file>] [--out <dir>]
 *                                   [--tol 0.01] [--timeout 120000]
 *                                   [--ids <ids.json>] [--quiet]
 *   node scripts/qa-import-wasm.mjs --one <file> --id <id> [--tol 0.01]   (mode enfant)
 *
 * Défauts : --in .testparts  --out docs/qa/import-2026-09-09/wasm
 * `--ids` : JSON { "Piece_Trou.DXF": "c07", ... } (nom de fichier -> id du
 * corpus du lot A) ; sans lui, l'id = basename slugifié.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const BUNDLE_JS = path.join(ROOT, 'public', 'geometry', 'nest_geometry.js')
const BUNDLE_WASM = path.join(ROOT, 'public', 'geometry', 'nest_geometry_bg.wasm')

// Miroirs EXACTS des gardes du chemin navigateur (localImport.js /
// geometryClient.js / shared/constants/upload.constants.js) — ne pas diverger.
const MAX_ENTITY_LIMIT = 10000
const TIME_BUDGET_MS = 20000
const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024
const ACCEPTED_EXTENSIONS = ['.dxf', '.svg']
const DEFAULT_TOL = 0.01

const MARKER = '@@QA_IMPORT_JSON@@'

// ------------------------------------------------------------------ args

function parseArgs(argv) {
    const out = { _: [] }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a.startsWith('--')) {
            const key = a.slice(2)
            const next = argv[i + 1]
            if (next === undefined || next.startsWith('--')) out[key] = true
            else {
                out[key] = next
                i++
            }
        } else out._.push(a)
    }
    return out
}

// ------------------------------------------------------------- utilities

function sha256(buf) {
    return createHash('sha256').update(buf).digest('hex')
}

function slugify(name) {
    return (
        name
            .replace(/\.[^.]+$/, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'file'
    )
}

// Miroir EXACT de nest-import/src/units.rs (lot 2b) — table complète 0-20,
// facteurs exacts par définition (pas ceux, arrondis, de ezdxf), et noms
// canoniques IDENTIQUES à worker_common.geometry.units.unit_name : le verrou
// de parité du lot 2b compare `unitDetected` entre les deux coureurs.
const INSUNITS_TO_MM = {
    1: 25.4, 2: 304.8, 3: 1609344, 4: 1, 5: 10, 6: 1000, 7: 1e6,
    8: 2.54e-5, 9: 0.0254, 10: 914.4, 11: 1e-7, 12: 1e-6, 13: 1e-3,
    14: 100, 15: 10000, 16: 100000, 17: 1e12, 18: 1.495978707e14,
    19: 9.4607304725808e18, 20: 3.0856775814913673e19,
}
const INSUNITS_NAME = {
    0: 'unitless', 1: 'inch', 2: 'foot', 3: 'mile', 4: 'mm', 5: 'cm', 6: 'm',
    7: 'km', 8: 'microinch', 9: 'mil', 10: 'yard', 11: 'angstrom',
    12: 'nanometer', 13: 'micron', 14: 'decimeter', 15: 'decameter',
    16: 'hectometer', 17: 'gigameter', 18: 'au', 19: 'lightyear', 20: 'parsec',
}

/** $INSUNITS -> facteur mm : miroir de units.rs::factor_to_mm (nest-import). */
function factorToMm(code) {
    if (code === 0 || code === 4) return { factor: 1, unknown: false }
    if (Object.prototype.hasOwnProperty.call(INSUNITS_TO_MM, code)) {
        return { factor: INSUNITS_TO_MM[code], unknown: false }
    }
    return { factor: 1, unknown: true }
}

/** Nom canonique de l'unité du code $INSUNITS (units.rs::unit_name). */
function unitName(code) {
    return INSUNITS_NAME[code] || 'unknown'
}

/** Constats d'unité émis par l'importeur (texte identique côté Python). */
function unitWarnings(warnings) {
    return (warnings || []).filter((w) => /\$INSUNITS/.test(w))
}

const BINARY_DXF_SENTINEL = 'AutoCAD Binary DXF'

/**
 * Comptage des entités du MODELSPACE (section ENTITIES) d'un DXF ASCII, par
 * balayage des paires (code, valeur). C'est une mesure du FICHIER SOURCE, pas
 * une sortie de l'importeur : le crate ne rend qu'un `entity_count` total
 * (après cleanup + résolution des INSERT). DXF binaire ou SVG -> null.
 */
function scanDxfEntities(buf) {
    const head = buf.subarray(0, 32).toString('latin1')
    if (head.startsWith(BINARY_DXF_SENTINEL)) return null
    let text
    try {
        text = buf.toString('utf8')
        if (text.includes('�')) text = buf.toString('latin1')
    } catch {
        return null
    }
    const lines = text.split(/\r\n|\r|\n/)
    const counts = {}
    let section = null
    let inserts = 0
    for (let i = 0; i + 1 < lines.length; i += 2) {
        const code = lines[i].trim()
        const value = lines[i + 1]
        if (code !== '0') continue
        const kind = (value || '').trim().toUpperCase()
        if (kind === 'SECTION') {
            // la paire suivante porte le nom de section (code 2)
            const nameCode = (lines[i + 2] || '').trim()
            const nameVal = (lines[i + 3] || '').trim().toUpperCase()
            if (nameCode === '2') section = nameVal
            continue
        }
        if (kind === 'ENDSEC') {
            section = null
            continue
        }
        if (section !== 'ENTITIES') continue
        if (kind === 'SEQEND' || kind === 'VERTEX' || kind === '') continue
        counts[kind] = (counts[kind] || 0) + 1
        if (kind === 'INSERT') inserts++
    }
    if (Object.keys(counts).length === 0) return null
    return { counts, inserts }
}

/** Version DXF déclarée ($ACADVER) — traçabilité, hors grille §4. */
function scanAcadVer(buf) {
    const head = buf.subarray(0, 32).toString('latin1')
    if (head.startsWith(BINARY_DXF_SENTINEL)) return 'binary'
    const text = buf.subarray(0, 4096).toString('latin1')
    const m = text.match(/\$ACADVER\s*[\r\n]+\s*1\s*[\r\n]+\s*([A-Za-z0-9._]+)/)
    return m ? m[1] : null
}

function isSvgSignature(buf) {
    let i = 0
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3
    while (i < buf.length && /\s/.test(String.fromCharCode(buf[i]))) i++
    return i < buf.length && buf[i] === 0x3c // '<'
}

function gitVersion() {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
    if (r.status !== 0) return null
    const commit = (r.stdout || '').trim()
    const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        cwd: ROOT,
        encoding: 'utf8',
    })
    const isDirty = dirty.status === 0 && (dirty.stdout || '').trim().length > 0
    return isDirty ? `${commit}-dirty` : commit
}

/** Grille §4 : ordre des clés figé, aucun champ omis. */
function emptyRow(id) {
    return {
        id,
        importer: 'wasm',
        version: null,
        status: 'refused',
        error: null,
        failingEntity: null,
        unitDeclared: null,
        unitDetected: null,
        scaleApplied: null,
        entities: null,
        parts: null,
        holes: null,
        openContours: null,
        openContoursClosed: null,
        blocksFlattened: null,
        splines: null,
        splinesHandled: null,
        ms: null,
        // ADDITIF lot 2b : constats d'unité (même texte que le coureur ezdxf).
        unitWarnings: null,
        extra: null,
    }
}

// ------------------------------------------------------------ mode enfant

async function runOne(file, id, tol) {
    const row = emptyRow(id)
    const buf = fs.readFileSync(file)
    const ext = path.extname(file).toLowerCase()
    const scan = ext === '.svg' || isSvgSignature(buf) ? null : scanDxfEntities(buf)

    row.version = gitVersion()
    row.entities = scan ? scan.counts : null
    row.splines = scan ? scan.counts.SPLINE || 0 : null
    row.blocksFlattened = scan ? scan.inserts : null
    row.extra = {
        file: path.basename(file),
        path: path.relative(ROOT, file).split(path.sep).join('/'),
        bytes: buf.length,
        sha256: sha256(buf),
        acadVer: scanAcadVer(buf),
        format: isSvgSignature(buf) ? 'svg' : 'dxf',
        bundle: {
            js: 'public/geometry/nest_geometry.js',
            wasmSha256: sha256(fs.readFileSync(BUNDLE_WASM)),
            wasmBytes: fs.statSync(BUNDLE_WASM).size,
        },
        tol,
        entityCount: null,
        warnings: null,
        canonicalMs: null,
        canonicalBytes: null,
        gate: null,
    }

    // Garde d'extension du chemin navigateur (localImport.js) — mesurée
    // AVANT l'appel wasm, comme dans l'app.
    if (ext === '.dwg') {
        row.error = 'gate: localImport.dwgRejected (extension .dwg)'
        row.extra.gate = 'dwgRejected'
        return row
    }
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        row.error = `gate: localImport.unsupportedType (extension "${ext}")`
        row.extra.gate = 'unsupportedType'
        return row
    }
    if (buf.length > MAX_UPLOAD_FILE_BYTES) {
        row.error = `gate: upload.tooLarge (${buf.length} > ${MAX_UPLOAD_FILE_BYTES})`
        row.extra.gate = 'tooLarge'
        return row
    }

    // Bundle cible `web` : Node ne peut pas `fetch` l'URL relative du glue —
    // on lit le .wasm et on passe par initSync (WebAssembly.Module compilé
    // ici). Aucun patch du bundle : c'est le fichier servi au navigateur.
    const glue = await import(pathToFileURL(BUNDLE_JS).href)
    glue.initSync({ module: new WebAssembly.Module(fs.readFileSync(BUNDLE_WASM)) })

    const bytes = new Uint8Array(buf)

    let imported = null
    const t0 = performance.now()
    let outcome = null
    try {
        outcome = JSON.parse(glue.import_file_limited(bytes, tol, MAX_ENTITY_LIMIT, TIME_BUDGET_MS))
        row.ms = Math.round((performance.now() - t0) * 1000) / 1000
    } catch (err) {
        row.ms = Math.round((performance.now() - t0) * 1000) / 1000
        row.error = `import_file: ${String(err && err.message ? err.message : err)}`
        row.failingEntity = extractFailingEntity(row.error)
        return row
    }
    // Lot 2a : un refus « trop lourd » est une RÉPONSE du wasm, avec ses
    // nombres — la garde ne s'applique plus après coup côté JS.
    if (outcome && outcome.status === 'refused') {
        const r = outcome.refusal || {}
        row.extra.entityCount = Number.isInteger(r.entities) ? r.entities : null
        row.extra.gate =
            r.reason === 'time' ? 'tooHeavy'
                : r.reason === 'blockDepth' ? 'blockDepth'
                    : 'tooManyEntities'
        row.error = `gate: localImport.${row.extra.gate} (${outcome.message})`
        return row
    }
    imported = outcome && outcome.result ? outcome.result : outcome

    const warnings = Array.isArray(imported.warnings) ? imported.warnings : []
    const parts = Array.isArray(imported.parts) ? imported.parts : []
    const insunits = Number.isInteger(imported.source_units) ? imported.source_units : null
    const { factor } = insunits === null ? { factor: null } : factorToMm(insunits)

    row.unitDeclared = insunits
    row.unitDetected = insunits === null ? null : unitName(insunits)
    row.scaleApplied = factor
    row.unitWarnings = unitWarnings(warnings)
    row.parts = parts.length
    row.holes = parts.reduce((n, p) => n + ((p.holes && p.holes.length) || 0), 0)
    row.extra.entityCount = Number.isInteger(imported.entity_count) ? imported.entity_count : null
    row.extra.warnings = warnings
    if (row.splines !== null && row.splines > 0) {
        row.splinesHandled = warnings.some((w) => /skipped entity\s+SPLINE/i.test(w)) ? 'refused' : 'sampled'
    }

    // Garde app postérieure à l'import (localImport.js) : le plafond
    // d'entités, lui, vit désormais DANS le wasm (traité plus haut).
    if (parts.length === 0) {
        row.error = 'gate: localImport.noParts (import_file a rendu 0 pièce)'
        row.extra.gate = 'noParts'
        return row
    }

    // L'app appelle ensuite canonical_dxf : son échec = parseError côté UI.
    const t1 = performance.now()
    try {
        const canonical = glue.canonical_dxf(bytes, tol)
        row.extra.canonicalMs = Math.round((performance.now() - t1) * 1000) / 1000
        row.extra.canonicalBytes = canonical.length
    } catch (err) {
        row.extra.canonicalMs = Math.round((performance.now() - t1) * 1000) / 1000
        row.error = `canonical_dxf: ${String(err && err.message ? err.message : err)}`
        row.failingEntity = extractFailingEntity(row.error)
        return row
    }

    // read = aucun avertissement ; repaired = l'importeur a nettoyé ou
    // supposé quelque chose (entités écartées, $INSUNITS inconnu, élément SVG
    // non supporté — les seuls warnings émis par nest-import).
    row.status = warnings.length === 0 ? 'read' : 'repaired'
    row.failingEntity = warnings.length ? extractFailingEntity(warnings.join(' | ')) : null
    return row
}

function extractFailingEntity(text) {
    const m =
        /skipp?ed entity\s+([A-Z0-9_]+)/i.exec(text) ||
        /unsupported SVG element:\s*([A-Za-z0-9_:-]+)/i.exec(text) ||
        /\b(LWPOLYLINE|POLYLINE|SPLINE|ELLIPSE|INSERT|ARC|CIRCLE|LINE|TEXT|MTEXT|HATCH|DIMENSION|SOLID|IMAGE)\b/.exec(text)
    return m ? m[1].toUpperCase() : null
}

// ------------------------------------------------------------ mode parent

function listInputs(inPath) {
    const stat = fs.statSync(inPath)
    if (stat.isFile()) return [inPath]
    return fs
        .readdirSync(inPath)
        .filter((n) => !n.startsWith('.'))
        .map((n) => path.join(inPath, n))
        .filter((p) => fs.statSync(p).isFile())
        .sort((a, b) => a.localeCompare(b))
}

function runChild(file, id, tol, timeoutMs) {
    const r = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), '--one', file, '--id', id, '--tol', String(tol)],
        { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 },
    )
    const stdout = r.stdout || ''
    const line = stdout.split(/\r?\n/).find((l) => l.startsWith(MARKER))
    if (line) {
        try {
            return JSON.parse(line.slice(MARKER.length))
        } catch (err) {
            // JSON illisible : on ne devine rien, on rapporte l'échec.
            const row = emptyRow(id)
            row.error = `runner: sortie enfant illisible (${String(err && err.message)})`
            return row
        }
    }
    const row = emptyRow(id)
    row.version = gitVersion()
    const stderr = (r.stderr || '').trim().split(/\r?\n/).slice(-6).join(' / ')
    if (r.error && r.error.code === 'ETIMEDOUT') {
        row.error = `crash: timeout ${timeoutMs} ms (processus tué)`
    } else if (r.signal) {
        row.error = `crash: signal ${r.signal}${stderr ? ` — ${stderr}` : ''}`
    } else {
        row.error = `crash: exit ${r.status}${stderr ? ` — ${stderr}` : ''}`
    }
    row.extra = {
        file: path.basename(file),
        path: path.relative(ROOT, file).split(path.sep).join('/'),
        bytes: fs.statSync(file).size,
        sha256: sha256(fs.readFileSync(file)),
        acadVer: null,
        format: null,
        bundle: null,
        tol,
        entityCount: null,
        warnings: null,
        canonicalMs: null,
        canonicalBytes: null,
        gate: 'childCrash',
    }
    return row
}

async function main() {
    const args = parseArgs(process.argv.slice(2))
    const tol = args.tol !== undefined && args.tol !== true ? Number(args.tol) : DEFAULT_TOL

    if (args.one) {
        const id = args.id && args.id !== true ? String(args.id) : slugify(path.basename(String(args.one)))
        const row = await runOne(path.resolve(String(args.one)), id, tol)
        process.stdout.write(`${MARKER}${JSON.stringify(row)}\n`)
        return
    }

    if (!fs.existsSync(BUNDLE_WASM) || !fs.existsSync(BUNDLE_JS)) {
        console.error(
            `bundle géométrie absent : ${BUNDLE_WASM}\n` +
                'le rebâtir avec `bash workers/geometry/build-wasm.sh` (wasm-opt via node_modules/binaryen/bin).',
        )
        process.exit(2)
    }

    const inPath = path.resolve(args.in && args.in !== true ? String(args.in) : path.join(ROOT, '.testparts'))
    const outDir = path.resolve(
        args.out && args.out !== true ? String(args.out) : path.join(ROOT, 'docs', 'qa', 'import-2026-09-09', 'wasm'),
    )
    const timeoutMs = args.timeout && args.timeout !== true ? Number(args.timeout) : 120000
    const quiet = Boolean(args.quiet)

    let ids = {}
    if (args.ids && args.ids !== true) ids = JSON.parse(fs.readFileSync(path.resolve(String(args.ids)), 'utf8'))

    const files = listInputs(inPath)
    fs.mkdirSync(outDir, { recursive: true })

    const rows = []
    const seen = new Set()
    for (const file of files) {
        const base = path.basename(file)
        let id = ids[base] || slugify(base)
        while (seen.has(id)) id = `${id}-2`
        seen.add(id)
        const row = runChild(file, id, tol, timeoutMs)
        rows.push(row)
        fs.writeFileSync(path.join(outDir, `${id}.json`), `${JSON.stringify(row, null, 2)}\n`)
        if (!quiet) {
            const bits = [
                row.id.padEnd(24),
                String(row.status).padEnd(9),
                `parts=${row.parts ?? '-'}`,
                `holes=${row.holes ?? '-'}`,
                `units=${row.unitDeclared ?? '-'}/${row.unitDetected ?? '-'}`,
                `ms=${row.ms ?? '-'}`,
            ]
            console.log(bits.join('  ') + (row.error ? `  ${row.error}` : ''))
        }
    }

    const tally = rows.reduce((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), {})
    if (!quiet) {
        console.log(
            `\n${rows.length} fichier(s) — ` +
                ['read', 'repaired', 'refused'].map((s) => `${s}: ${tally[s] || 0}`).join(', ') +
                `\nJSON: ${path.relative(ROOT, outDir).split(path.sep).join('/')}/`,
        )
    }
}

main().catch((err) => {
    console.error(`qa-import-wasm: ${err && err.stack ? err.stack : err}`)
    process.exit(1)
})
