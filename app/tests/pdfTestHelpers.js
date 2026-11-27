// Aides de test communes aux tests PDF (pas un fichier de test).
import { expect } from 'vitest'
import { unzlibSync } from 'fflate'

const latin1 = (u8) => Buffer.from(u8).toString('latin1')

/** Contrôles de structure : en-tête, EOF, xref aux décalages exacts, startxref. */
export function checkPdfStructure(bytes) {
    const s = latin1(bytes)
    expect(s.startsWith('%PDF-1.4')).toBe(true)
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
    const sx = /startxref\n(\d+)\n%%EOF\s*$/.exec(s)
    expect(sx).not.toBeNull()
    const xrefAt = Number(sx[1])
    expect(s.slice(xrefAt, xrefAt + 4)).toBe('xref')
    const head = /^xref\n0 (\d+)\n/.exec(s.slice(xrefAt))
    const count = Number(head[1])
    const entries = s.slice(xrefAt + head[0].length).split('\n').slice(0, count)
    expect(entries[0]).toBe('0000000000 65535 f ')
    for (let id = 1; id < count; id++) {
        expect(entries[id]).toMatch(/^\d{10} 00000 n $/)
        const off = Number(entries[id].slice(0, 10))
        expect(s.slice(off, off + `${id} 0 obj`.length)).toBe(`${id} 0 obj`)
    }
    expect(s).toContain(`/Size ${count}`)
    return { s, count }
}

/** Contenu décompressé des flux Flate (latin1) : flux de contenu des pages en premier lieu. */
export function pageStreams(bytes) {
    const s = latin1(bytes)
    const out = []
    const re = /\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g
    let m
    while ((m = re.exec(s))) {
        const start = m.index + m[0].length
        const data = Buffer.from(s.slice(start, start + Number(m[1])), 'latin1')
        out.push(latin1(unzlibSync(new Uint8Array(data))))
    }
    return out
}

/** Tailles /MediaBox des pages, dans l'ordre : [[w, h], …]. */
export function mediaBoxes(bytes) {
    return [...latin1(bytes).matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])])
}
