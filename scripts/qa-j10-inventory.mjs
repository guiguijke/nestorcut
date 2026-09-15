// Lot J10 (étude §9.77) — la carte complète du `.job`.
//
//   J10-b : diff systématique PAR PAIRES sur les fichiers qui ne diffèrent
//   que d'un réglage (la série de rétro-ingénierie), pour chaque champ
//   inconnu : chercher la paire qui le fait bouger. Rapport champ par
//   champ : identifié (preuve) ou « ne bouge sur aucune paire disponible ».
//   AUCUNE interprétation sans preuve.
//
// Usage : node scripts/qa-j10-inventory.mjs   (fichiers privés du poste)
import fs from 'node:fs'
import path from 'node:path'
import { parseSheetCamJob } from '../shared/sheetcamJob.js'

const DIRS = ['.testparts/job-tests', '.testparts/retro-eng-job', '.testparts/job-tests-new']
// Les 19 champs DÉCODÉS (ceux que jobDrawings lit, §9.61/§9.42) : segments,
// amorces, points de départ, ordre, drapeau, origine, brackets de flux.
// 0x14/0x15/0x16/0x17 sont lus dans le FLUX mais leur SENS est inconnu —
// ils comptent donc parmi les inconnus (l'inventaire du §9.77).
const DECODED = new Set([
    '0x0001', '0x0002', '0x0003', '0x0004', '0x0005', '0x0006', '0x0007',
    '0x0008', '0x0009', '0x000a', '0x000b', '0x0012', '0x0013', '0x0018',
    '0x0019', '0x001a', '0x001d', '0x0025', '0x002f',
])

const files = []
for (const d of DIRS) {
    if (!fs.existsSync(d)) continue
    for (const f of fs.readdirSync(d).filter(x => x.toLowerCase().endsWith('.job'))) {
        files.push({ dir: d, name: f, bytes: new Uint8Array(fs.readFileSync(path.join(d, f))) })
    }
}
if (!files.length) {
    console.error('aucun .job privé sur ce poste — rien à mesurer')
    process.exit(2)
}

// --- le flux binaire en champ par occurrence ---------------------------------

function binaryOf(bytes) {
    const text = Buffer.from(bytes).toString('latin1')
    return bytes.subarray(text.indexOf('[BinaryDataStart]'))
}

function fieldStream(bytes) {
    const bin = binaryOf(bytes)
    const v = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
    let o = '[BinaryDataStart]'.length
    const out = []
    while (o + 6 <= bin.length) {
        const tag = v.getUint16(o, true)
        const len = v.getUint16(o + 4, true)
        const at = o + 6
        if (at + len > bin.length) break
        let val
        if (len === 8) { const x = v.getFloat64(at, true); val = Math.abs(x) > 1e30 ? 'SENT' : +x.toFixed(6) }
        else if (len === 16) val = [v.getFloat64(at, true), v.getFloat64(at + 8, true)]
            .map(x => (Math.abs(x) > 1e30 ? 'SENT' : +x.toFixed(4))).join(';')
        else if (len === 4) val = v.getInt32(at, true)
        else if (len === 2) val = v.getUint16(at, true)
        else if (len === 1) val = bin[at]
        else val = 'opaque'
        out.push({ tag: '0x' + tag.toString(16).padStart(4, '0'), offset: o, len, val })
        o = at + len
    }
    return { stream: out, exact: o === bin.length }
}

// --- 1. aller-retour (le socle, re-mesuré par le script) ---------------------

let identical = 0
for (const f of files) {
    const { serializeSheetCamJob } = await import('../shared/sheetcamJob.js')
    const out = serializeSheetCamJob(parseSheetCamJob(f.bytes))
    if (Buffer.compare(Buffer.from(out), Buffer.from(f.bytes)) === 0) identical++
}
console.log(`1. ALLER-RETOUR : ${identical}/${files.length} identiques à l'octet`)

// --- 2. inventaire ------------------------------------------------------------

const tags = new Map() // tag -> Set de signatures (toutes occurrences, tous fichiers)
for (const f of files) {
    const { stream, exact } = fieldStream(f.bytes)
    if (!exact) console.error('  ATTENTION flux non exact :', f.name)
    for (const rec of stream) {
        if (!tags.has(rec.tag)) tags.set(rec.tag, new Set())
        tags.get(rec.tag).add(JSON.stringify(rec.val))
    }
}
console.log(`2. INVENTAIRE : ${tags.size} champs distincts, ${[...tags.keys()].filter(t => DECODED.has(t)).length} décodés, ${[...tags.keys()].filter(t => !DECODED.has(t)).length} inconnus`)

const unknown = [...tags.keys()].filter(t => !DECODED.has(t)).sort()
const constants = unknown.filter(t => tags.get(t).size === 1)
const variables = unknown.filter(t => tags.get(t).size > 1)
console.log(`   inconnus CONSTANTS (ne bougent sur aucun fichier) : ${constants.join(', ') || 'aucun'}`)
console.log(`   inconnus VARIABLES : ${variables.map(t => `${t} (${tags.get(t).size} signatures)`).join(', ') || 'aucun'}`)

// --- 3. diff PAR PAIRES : fichiers de même longueur binaire -------------------
//
// Deux `.job` de la série qui ne diffèrent que d'un réglage ont le MÊME
// binaire à quelques champs près : chaque paire de même longueur est une
// expérience. Pour chaque paire, on liste les champs qui diffèrent — le
// réglage qui distingue les fichiers est dans le NOM (kerf0/kerf4, mirror,
// 45deg, tangeant/perpendicular/none, corners, start moved…).

const fields = files.map(f => ({ ...f, ...fieldStream(f.bytes), binLen: binaryOf(f.bytes).length }))
const pairs = []
for (let i = 0; i < fields.length; i++) {
    for (let j = i + 1; j < fields.length; j++) {
        if (fields[i].binLen !== fields[j].binLen) continue
        const diffs = []
        const a = fields[i].stream
        const b = fields[j].stream
        if (a.length !== b.length) continue
        for (let k = 0; k < a.length; k++) {
            if (JSON.stringify(a[k].val) !== JSON.stringify(b[k].val)) diffs.push(a[k].tag)
        }
        pairs.push({ a: fields[i].name, b: fields[j].name, diffs: [...new Set(diffs)] })
    }
}
console.log(`3. PAIRES de même longueur binaire : ${pairs.length}`)

// Quels champs INCONNUS bougent, et sur quelles paires ?
for (const tag of unknown) {
    const moving = pairs.filter(p => p.diffs.includes(tag))
    if (!moving.length) {
        console.log(`   ${tag} : ne bouge sur AUCUNE paire disponible`)
        continue
    }
    // Les paires où il bougent SEUL (ou presque) sont les plus informatives.
    const alone = moving.filter(p => p.diffs.length <= 3)
    console.log(`   ${tag} : ${moving.length} paire(s)`)
    for (const p of alone.slice(0, 3)) {
        console.log(`     ex. « ${p.a} » vs « ${p.b} » : ${p.diffs.join(', ')}`)
    }
}

// --- 4. le type d'amorce, LU DANS LA BONNE SECTION ----------------------------
//
// Piège §9.77 point 5 : le sondage rapide du vérificateur a lu le type
// d'amorce de `[Tool0]` et s'est trompé de section. On lit ici
// `[Part N/OperationM]` de CHAQUE pièce, et on compare au binaire 0x14/0x15
// (l'hypothèse « types d'amorce » est déjà réfutée au §9.77 — on documente
// la lecture correcte pour le futur).

let leadPairs = 0
let mismatches = 0
for (const f of files) {
    const job = parseSheetCamJob(f.bytes)
    for (const part of job.parts) {
        for (const op of part.operations) {
            if (Number.isFinite(op.leadInType) && Number.isFinite(op.leadOutType)) {
                leadPairs++
            }
        }
    }
}
console.log(`4. TYPE D'AMORSE : ${leadPairs} opérations portent leadInType/leadOutType dans [Part N/OperationM]`)
console.log('   (0x14/0x15 : réfutés comme types d\'amorce au §9.77 — vraisemblablement liés à la structure de contour, inconnus)')

// --- 5. keepout ----------------------------------------------------------------

let keepoutNonZero = 0
for (const f of files) {
    const job = parseSheetCamJob(f.bytes)
    let inside = false
    for (const line of job.lines) {
        if (line.kind === 'section') { inside = line.name === 'Work/keepout'; continue }
        if (inside && line.kind === 'entry' && /^Corner \d[XY]$/.test(line.key)) {
            const v = Number(line.value)
            if (Number.isFinite(v) && v !== 0) { keepoutNonZero++; break }
        }
    }
}
console.log(`5. KEEPOUT : ${files.length - keepoutNonZero}/${files.length} à coins zéro, ${keepoutNonZero} non nulle(s)`)
