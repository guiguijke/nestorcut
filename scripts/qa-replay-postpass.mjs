// §17.2 — REJOUE les post-pass du navigateur, passe par passe, sur un état
// MOTEUR dumpé, et écrit un fichier de poses APRÈS CHAQUE passe.
//
// Pourquoi ce script existe : le badge rouge et le rejet total sont rares
// (mesuré 2 sur 12, puis 1 sur 24). Attendre l'événement dans le navigateur
// coûte une heure de banc par occurrence, et ne dit toujours pas QUELLE
// passe a bougé quoi. Ici, l'entrée est un état moteur figé
// (`qaPrePostPass.layoutsPre` d'un dump du harnais) : les passes sont
// rejouées dans l'ordre exact de `buildAlternativeArtifacts`, et chaque
// étape est écrite pour être mesurée par
// `workers/nesting/bench/measure_svg_gaps.py` (shapely, anneaux bruts) —
// la mesure ne se fait donc PAS dans le langage qui a produit le défaut.
//
// Les modules de l'app utilisent les imports sans extension résolus par
// Vite : ce script se lance avec vite-node, pas avec node.
//
// Usage :
//   npx vite-node scripts/qa-replay-postpass.mjs <dump.json> <sortie/>
//
// Le dump peut être un `poses-*.json`, un `spacing-fail-*.json` ou un
// `discarded-*.json` (première alternative écartée).
import fs from 'node:fs'
import path from 'node:path'

import { applyHoleFill, expandMeta, sheetDims } from '../app/composables/localBridge'
import { fillResidualBands } from '../app/composables/residualClient'

const [dumpPath, outDir] = process.argv.slice(2)
if (!dumpPath || !outDir) {
    console.error('usage: vite-node scripts/qa-replay-postpass.mjs <dump.json> <sortie/>')
    process.exit(2)
}
fs.mkdirSync(outDir, { recursive: true })

const raw = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
const entry = raw.discarded?.[0] || raw.alternative
const qa = entry?.qaPrePostPass
if (!qa?.layoutsPre) {
    console.error('dump sans `qaPrePostPass.layoutsPre` — relancer le harnais avec QA_DUMP_PRE_POSTPASS=1')
    process.exit(2)
}
const space = Number(qa.space ?? raw.space ?? 0)
// Les pièces du dump portent `coords`/`holes` : la forme que les passes
// attendent (`parts[]` du payload), sans les champs d'affichage.
const parts = qa.parts.map((p) => ({ ...p, id: p.id, count: 0, rotations: [0, 90, 180, 270] }))
const partsById = new Map(parts.map((p) => [String(p.id), p]))

const clone = (layouts) => layouts.map((l) => ({
    container_id: l.container_id ?? 0,
    placed_items: (l.placed_items || []).map((pi) => ({
        item_id: pi.item_id,
        transformation: {
            rotation: pi.transformation?.rotation ?? 0,
            translation: [...(pi.transformation?.translation || [0, 0])],
        },
    })),
}))

// Tôle de la démo : le dump ne porte pas les paramètres, on les reconstruit
// depuis les poses (l'AABB de la tôle est celle du payload d'origine, mais
// seules les DISTANCES nous intéressent ici).
const payload = {
    problem: 'bpp',
    parts,
    engineConfig: { min_item_separation: space },
    params: { sheets: [{ width: 1500, height: 3000, count: 3 }] },
}

let layouts = clone(qa.layoutsPre)
const steps = []
const write = (label) => {
    const file = path.join(outDir, `step-${steps.length}-${label}.json`)
    fs.writeFileSync(file, JSON.stringify({
        space,
        alternative: {
            strategy: entry.strategy || 'engine',
            step: label,
            qaPrePostPass: { parts: qa.parts, space, layoutsPre: qa.layoutsPre, layoutsPost: clone(layouts) },
        },
    }, null, 1))
    steps.push({ label, file: path.basename(file), pieces: layouts.map((l) => l.placed_items.length) })
    console.log(`étape ${steps.length - 1} ${label.padEnd(16)} pièces ${JSON.stringify(layouts.map((l) => l.placed_items.length))} → ${path.basename(file)}`)
}

write('moteur')

// 1. hole-fill (relocations vers les trous), scopé par tôle (piège #52).
const recovered = applyHoleFill(parts, layouts, space)
console.log(`applyHoleFill : ${recovered} relocation(s)`)
write('holefill-1')

// 2. bandes résiduelles (déplacements entre tôles + lattice des bandes).
const postPass = { residualMoved: 0, residualRounds: 0, compactRollback: false, errors: [] }
fillResidualBands(parts, layouts, space, payload, postPass)
console.log(`fillResidualBands : ${JSON.stringify(postPass)}`)
write('residuel')

// 3. second hole-fill (A13 : le résiduel peut rendre un trou remplissable).
const recovered2 = applyHoleFill(parts, layouts, space)
console.log(`applyHoleFill #2 : ${recovered2} relocation(s)`)
write('holefill-2')

fs.writeFileSync(path.join(outDir, 'steps.json'), JSON.stringify({
    dump: path.basename(dumpPath),
    space,
    strategy: entry.strategy || null,
    verification: entry.verification || null,
    holeFillRecovered: recovered,
    residual: postPass,
    holeFillRecovered2: recovered2,
    steps,
}, null, 1))
console.log(`\n${steps.length} étapes écrites dans ${outDir}`)
console.log('Mesurer chacune avec measure_svg_gaps.py (shapely) : c\'est la mesure qui tranche, pas le rejeu.')
void expandMeta
void sheetDims
