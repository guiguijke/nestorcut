/**
 * Lot J11-b — le journal UNIQUE : `CHANGELOG.md` à la racine du dépôt de
 * l'app est LA source (§3 point 9). Cette page le lit tel quel (import
 * brut au build) et le découpe : une entrée par titre « ## V… », les
 * blocs *FR* / *EN* rendus dans la langue de l'utilisateur. Jamais de
 * seconde copie à maintenir.
 */
import raw from '~~/CHANGELOG.md?raw'

function parseChangelog(md) {
    const versions = []
    // Les entrées : « ## V0.9 » etc., au format le plus simple possible.
    const chunks = String(md || '').split(/^## /m).slice(1)
    for (const chunk of chunks) {
        const nl = chunk.indexOf('\n')
        const title = chunk.slice(0, nl).trim()
        const body = chunk.slice(nl + 1)
        const fr = extractBlock(body, 'FR')
        const en = extractBlock(body, 'EN')
        versions.push({ title, fr, en })
    }
    return versions
}

function extractBlock(body, tag) {
    // PAS de drapeau « m » : `$` doit matcher la FIN DU BLOC (paresseux),
    // sinon il s'arrête à la première fin de ligne et ne prend qu'une ligne.
    const re = new RegExp(`\\*${tag}\\*\\s*\\n([\\s\\S]*?)(?=\\s*\\*(?:FR|EN)\\*\\s*\\n|$)`)
    const m = re.exec(body)
    if (!m) return []
    return m[1]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^[-*]\s+/.test(l))
        .map((l) => l.replace(/^[-*]\s+/, ''))
}

export function useAppChangelog() {
    return parseChangelog(raw)
}
