/**
 * Display name derived from an uploaded file. Used as the project title
 * in the UI. For 100 % private projects the result stays in IndexedDB —
 * it must never be PATCHed to the server (filenames do not leave the
 * device on that path).
 */
export function titleFromFileName(name) {
    // Lot J11-a (A1) : ne traiter comme CHEMIN qu'un séparateur AVANT le
    // nom, jamais DANS une parenthèse finale. Les fiches `.job` portent des
    // suffixes « nom (3/4) » depuis le lot J9 : l'ancienne expression
    // `^.*[/\\]/` voyait le « / » du suffixe et jetait tout ce qui précède —
    // le projet du fichier à quatre pièces s'appelait « 4) ».
    const slashed = String(name || '').replace(/^.*[/\\](?=[^()]*$)/, '')
    // L'extension s'ôte AVANT le suffixe « (k/N) » : « X.dxf (3/4) » doit
    // donner « X (3/4) », pas « X ».
    const suffix = /(\s\(\d+\/\d+\))$/.exec(slashed)
    const stem = suffix ? slashed.slice(0, suffix.index) : slashed
    const base = stem
        .replace(/\.[^.]+$/, '')
        .replace(/[\u0000-\u001f<>:"|?*]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return (base + (suffix ? suffix[1] : '')).slice(0, 80)
}
