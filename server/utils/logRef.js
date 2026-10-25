import { createHash } from 'node:crypto'

/**
 * Référence de journal non réversible d'un utilisateur : l'identifiant d'un
 * compte e-mail (`local:<email>`) contient l'adresse, il ne doit jamais
 * atteindre les journaux tel quel. Huit hex du SHA-256 suffisent à corréler.
 */
export function logRef(userId) {
    if (userId === undefined || userId === null || userId === '') return null
    return createHash('sha256').update(String(userId)).digest('hex').slice(0, 8)
}
