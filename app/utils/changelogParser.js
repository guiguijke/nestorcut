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
    // PAS de drapeau « m » : `$` doit matcher la FIN DU BLOC (paresseux).
    // Lot J11-bis (R2) : une ligne INDENTÉE qui ne commence pas par « - »
    // est une CONTINUATION de la puce précédente — l'ancien parseur la
    // jetait, et chaque puce se retrouvait tronquée à sa première ligne.
    const re = new RegExp(`\\*${tag}\\*\\s*\\n([\\s\\S]*?)(?=\\s*\\*(?:FR|EN)\\*\\s*\\n|$)`)
    const m = re.exec(body)
    if (!m) return []
    const lines = m[1].split('\n').map((l) => l.trim())
    const items = []
    for (const line of lines) {
        if (/^[-*]\s+/.test(line)) {
            items.push(renderSimpleMd(line.replace(/^[-*]\s+/, '')))
        } else if (line && items.length && !/^\*/.test(line)) {
            // Continuation : appartient à la puce précédente.
            items[items.length - 1] += ' ' + renderSimpleMd(line)
        }
    }
    return items
}

/**
 * Markdown minimal : `**gras**` → <strong>, `` `code` `` → <code>, les
 * accents graves solitaires retirés — JAMAIS affichés bruts (R2). Le
 * contenu vient de NOTRE `CHANGELOG.md`, pas d'une entrée utilisateur.
 */
export function renderSimpleMd(text) {
    return String(text || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
}

export function useAppChangelog() {
    return parseChangelog(raw)
}
