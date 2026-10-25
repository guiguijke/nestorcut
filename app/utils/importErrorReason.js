/**
 * Cause d'un échec d'import (`importErrorCode`, posé par le worker sur le
 * document fichier) : rend la clé i18n de l'explication destinée à
 * l'utilisateur, ou `null` sans code (fichiers d'avant, autres formats) —
 * la carte garde alors son seul libellé « Échec de l'import ».
 */
const REASON_KEYS = {
    dwg_converter_missing: 'files.importError.dwgMissing',
    dwg_timeout: 'files.importError.dwgTimeout',
    dwg_version_unsupported: 'files.importError.dwgVersion',
    dwg_conversion_failed: 'files.importError.dwgCorrupt',
    dwg_output_unreadable: 'files.importError.dwgOutput',
}

export function importErrorReasonKey(code) {
    return Object.prototype.hasOwnProperty.call(REASON_KEYS, code) ? REASON_KEYS[code] : null
}
