// U0 : contraste WCAG AA des couples texte/fond des jetons, deux thèmes.
// Lit app/assets/css/tokens.css, calcule les ratios — 4.5:1 (texte),
// 3:1 pour on-accent (texte gras sur bouton).
import { readFileSync } from 'node:fs'

const css = readFileSync('app/assets/css/tokens.css', 'utf8')
const MARK = '[data-theme="primary"] {'
const lightBlock = css.slice(css.indexOf(':root'), css.indexOf(MARK))
const darkBlock = css.slice(css.indexOf(MARK))

const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
        const c = v / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (l1 + 0.05) / (l2 + 0.05)
}
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

function parseBlock(block) {
    const vars = {}
    for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
        vars[m[1]] = hexToRgb(m[2])
    }
    return vars
}

let hardFail = false
for (const [name, block] of [['clair', parseBlock(lightBlock)], ['sombre', parseBlock(darkBlock)]]) {
    const couples = [
        ['text/bg', 'text', 'bg'], ['text/surface', 'text', 'surface'],
        ['text-2/surface', 'text-2', 'surface'], ['text-3/surface', 'text-3', 'surface'],
        ['on-accent/accent', 'on-accent', 'accent'],
        ['ok/ok-bg', 'ok', 'ok-bg'], ['warn/warn-bg', 'warn', 'warn-bg'],
        ['danger/danger-bg', 'danger', 'danger-bg'], ['info/info-bg', 'info', 'info-bg'],
    ]
    let fails = 0
    for (const [label, fg, bg] of couples) {
        if (!block[fg] || !block[bg]) { console.log(`  ? ${label}: jeton absent`); fails++; hardFail = true; continue }
        const r = ratio(block[fg], block[bg])
        const min = fg === 'on-accent' ? 3 : 4.5
        const ok = r >= min
        if (!ok) { fails++; hardFail = true }
        console.log(`  ${ok ? 'OK ' : 'FAIL'} ${label}: ${r.toFixed(2)}:1 (min ${min})`)
    }
    console.log(`thème ${name}: ${fails === 0 ? 'AA 100 %' : fails + ' ÉCHECS'}`)
}
process.exit(hardFail ? 1 : 0)
