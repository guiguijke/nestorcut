import { MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_FILES } from '../../shared/constants/upload.constants.js'
import logger from '../utils/logger'

/**
 * S-5 (audit M4) : plafond de corps par route, sur l'en-tête Content-Length.
 * L'ancien `nitro.maxRequestSize` n'existe dans aucun paquet installé
 * (nitropack, h3, nuxt) — le plafond annoncé n'a jamais borné quoi que ce soit.
 *
 * Le middleware NE LIT PAS le corps (le webhook Stripe lit le corps brut, cf.
 * 1_log-requests.js) : il ne regarde que l'en-tête et répond 413 avant que
 * le moindre octet soit consommé. Nom en `0_` : il passe avant tout autre
 * middleware (log, auth, limites de débit).
 *
 * Plafonds (recensés par `git grep readBody|readMultipartFormData|readRawBody`) :
 *   - uploads multipart : POST /api/project et POST /api/project/{slug}/addfiles
 *     (saveFiles : MAX_UPLOAD_FILES × MAX_UPLOAD_FILE_BYTES + 1 Mo = ~101 Mo,
 *     même formule que server/core/project/dxf.js) ;
 *   - POST /api/results/{slug}/local-result : le navigateur renvoie les
 *     alternatives du solveur local (layouts) ET, calcul local activé en
 *     prod, `clientArtifacts` (SVG/rapport par tôle, non mesurés, ignorés
 *     par le serveur mais transmis) — seule route JSON volumineuse, 64 Mo :
 *     un 413 ici ferait échouer un job local réussi, le plafond ne doit
 *     borner que l'abus (route authentifiée, job awaiting_local du
 *     propriétaire) ;
 *   - toute autre route : 1 Mo. Les corps JSON légitimes sont des
 *     formulaires, clés de coffre (< 1 Ko), échelles, préférences, événements
 *     de suivi, messages de support (5 000 caractères) ou le corps du webhook
 *     Stripe (quelques Ko).
 *
 * Requêtes SANS Content-Length (Transfer-Encoding: chunked) : sans l'en-tête
 * on ne peut pas borner le corps sans le lire, et readBody l'accumulerait en
 * mémoire (plafond contourné). Aucun client légitime n'en envoie côté app
 * (navigateur $fetch/fetch avec JSON ou FormData et Stripe posent
 * Content-Length ; git grep duplex|ReadableStream -- app : vide) — MAIS rien
 * ne prouve que Cloudflare puis Caddy (reverse_proxy, sans request_body)
 * transmettent l'en-tête intact jusqu'ici : un relais qui passerait en
 * chunked ferait tomber TOUTES les requêtes en 411. Donc mode observation par
 * défaut : on journalise la route (préfixe, une fois par préfixe et par
 * processus) sans refuser ; BODY_LIMIT_REJECT_CHUNKED=true active le 411 une
 * fois les journaux de production vérifiés vides. Les routes d'upload
 * multipart sont exemptées (elles ont leur propre contrôle).
 */
const MB = 1024 * 1024
const JSON_LIMIT = 1 * MB
const UPLOAD_LIMIT = MAX_UPLOAD_FILE_BYTES * MAX_UPLOAD_FILES + 1 * MB
const LOCAL_RESULT_LIMIT = 64 * MB

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const seenChunkedPrefixes = new Set()
// Lu à chaque requête (et non au chargement) pour que les tests puissent basculer.
const rejectChunked = () => process.env.BODY_LIMIT_REJECT_CHUNKED === 'true'

export function isUploadRoute(pathname) {
    return pathname === '/api/project' || /^\/api\/project\/[^/]+\/addfiles$/.test(pathname)
}

export function bodyLimitFor(pathname) {
    if (isUploadRoute(pathname)) return UPLOAD_LIMIT
    if (/^\/api\/results\/[^/]+\/local-result$/.test(pathname)) return LOCAL_RESULT_LIMIT
    return JSON_LIMIT
}

export default defineEventHandler((event) => {
    const req = event.node.req
    if (!BODY_METHODS.has(String(req.method || '').toUpperCase())) return

    const pathname = String(event.path || req.url || '').split('?')[0].replace(/\/+$/, '')
    const raw = req.headers?.['content-length']
    if (raw === undefined) {
        if (req.headers?.['transfer-encoding'] && !isUploadRoute(pathname)) {
            if (rejectChunked()) {
                throw createError({ statusCode: 411, statusMessage: 'Length Required' })
            }
            // Préfixe seulement (/api/<domaine>) : jamais de slug ni d'id.
            const prefix = pathname.split('/').slice(0, 3).join('/')
            // Plafonné : le préfixe vient du client (le middleware passe
            // avant le routage), un flot de /api/<aléa> ne doit rien faire grossir.
            if (!seenChunkedPrefixes.has(prefix) && seenChunkedPrefixes.size < 50) {
                seenChunkedPrefixes.add(prefix)
                logger.warn('[body-limit] chunked request without Content-Length (not rejected)', { prefix })
            }
        }
        return
    }
    const length = Number(Array.isArray(raw) ? raw[0] : raw)
    if (!Number.isFinite(length)) return

    if (length > bodyLimitFor(pathname)) {
        throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
    }
})
