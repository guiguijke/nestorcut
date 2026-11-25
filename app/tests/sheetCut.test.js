import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Découpe d'une tôle par des défauts : la route JS (geoCutSheet -> worker ->
// cut_sheet) sur le bundle wasm livré. La géométrie elle-même est testée en
// Rust (nest-import/tests/sheet_cut.rs).

const ROOT = path.resolve(__dirname, '../..')
const BUNDLE_JS = path.join(ROOT, 'public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.join(ROOT, 'public/geometry/nest_geometry_bg.wasm')
const glue = vi.hoisted(() => ({ mod: null }))

vi.mock('../composables/localCompute', () => ({ isLocalComputeEnabled: () => true }))

// Le vrai corps de geometry.worker.js, sans son import : un faux Worker l'exécute.
class FakeWorker {
    constructor(url) {
        expect(url).toBe('/workers/geometry.worker.js')
        const src = readFileSync(path.join(ROOT, 'public/workers/geometry.worker.js'), 'utf8')
        const names = /import init, \{([^}]*)\}/.exec(src)[1].split(',').map((s) => s.trim()).filter(Boolean)
        for (const n of names) expect(typeof glue.mod[n], `${n} absent du bundle`).toBe('function')
        const body = src.replace(/import init, \{[^}]*\} from '[^']*'/, '')
        const self = { postMessage: (data) => this.onmessage({ data }) }
        new Function('self', 'init', ...names, body)(self, async () => {}, ...names.map((n) => glue.mod[n]))
        this.inner = self
    }
    postMessage(data) { this.inner.onmessage({ data }) }
    terminate() {}
}

beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
    vi.stubGlobal('Worker', FakeWorker)
})

import { geoCutSheet } from '../composables/geometryClient'

const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]

describe('geoCutSheet', () => {
    it('sans défaut : anneaux rendus au bit près, même quand le lecteur JSON se trompe', async () => {
        // 20 000 valeurs : le lecteur de nombres par défaut en arrondit mal une partie.
        const outer = []
        let x = 0.1
        for (let i = 0; i < 20000; i++) {
            x = (x * 1.000317 + 0.7) % 977
            outer.push([x / 3, i * 0.1 + x / 7])
        }
        outer.push([-5, -5])
        outer.push(outer[0])
        const r = await geoCutSheet(outer, [sq(0.1 + 0.2, 1 / 3, 2, 2)], [])
        expect(r.changed).toBe(false)
        expect(r.outer).toEqual(outer)
        expect(r.holes).toEqual([sq(0.1 + 0.2, 1 / 3, 2, 2)])
        expect(r.hazards).toEqual(r.holes)
        expect(r.lostPieces).toEqual([])
    })

    it('un défaut dedans fait un trou, un défaut au bord une encoche', async () => {
        const sheet = sq(0, 0, 100, 100)
        const r = await geoCutSheet(sheet, [sq(10, 10, 20, 20)], [sq(40, 40, 50, 60), sq(90, 30, 130, 50)])
        expect(r).toMatchObject({
            usableArea: 10000 - 100 - 200 - 200, pieces: 1, lostArea: 0, removedArea: 400,
            changed: true, repairs: 0, maxShift: 0,
        })
        expect(r.holes).toEqual([sq(10, 10, 20, 20), sq(40, 40, 50, 60)])
        expect(r.outer.length).toBe(9)
        expect(r.outer[0]).toEqual(r.outer[8])
        // Le moteur reçoit le contour d'origine et les défauts coupés par lui.
        expect(r.hazards).toEqual([sq(10, 10, 20, 20), sq(40, 40, 50, 60), sq(90, 30, 100, 50)])
        expect(r.lostPieces).toEqual([])
    })

    it('un morceau perdu est rendu à part et fondu dans les interdits', async () => {
        const r = await geoCutSheet(sq(0, 0, 100, 50), [], [sq(60, -5, 62, 55)])
        expect(r).toMatchObject({ pieces: 2, usableArea: 3000, lostArea: 1900, removedArea: 100 })
        expect(r.lostPieces).toEqual([{ outer: sq(62, 0, 100, 50), holes: [] }])
        expect(r.hazards).toEqual([sq(60, 0, 100, 50)])
    })

    it('les refus sont des codes nommés', async () => {
        const sheet = sq(0, 0, 100, 100)
        const err = async (...a) => (await geoCutSheet(...a)).error
        expect(await err(sheet, [], [sq(-1, -1, 101, 101)])).toBe('sheet_no_usable_area')
        expect(await err(sheet, [], [[[1, 1], [NaN, 2], [3, 3]]])).toBe('sheet_bad_defect')
        expect(await err(sheet, [], [[]])).toBe('sheet_bad_defect')
        expect(await err([[0, 0], [Infinity, 0], [0, 1]])).toBe('sheet_bad_geometry')
        expect(await err(null, [], [sheet])).toBe('sheet_bad_geometry')
        expect(await err([[0, 0], [1], [0, 1]])).toBe('sheet_bad_geometry')
        const many = Array.from({ length: 3000 }, (_, i) => (i % 2 ? [90 - i * 0.03, 99] : [i * 0.03, 1]))
        expect(await err(sheet, [], [many])).toBe('sheet_cut_too_complex')
    })
})
