import { clientIp, rateLimitAllow, denyRateLimit } from '~~/server/utils/ratelimit'

/**
 * /api/files/** is the download surface whose slug used to be a 24-bit
 * secret (pentest C-1). 30 req/min per session (IP as fallback) makes a
 * brute-force of even a short leftover slug impractical.
 *
 * Exceptions (bug démo 2026-08-29 + QA 2026-08-30) : sous /api/files/project/
 * (geometry, dxf, svg) chaque requête passe un contrôle d'accès AUTHENTIFIÉ
 * (requireFileAccess : propriétaire ou démo — le secret du slug n'y est plus
 * la seule défense) et une session légitime en consomme UN PAR FICHIER :
 *   - geometry : polygones d'affichage (24 pour la démo) ;
 *   - dxf/svg : le calcul LOCAL télécharge les bytes bruts pour l'export
 *     client (24 de plus) — avec le budget anti-brute-force partagé, la démo
 *     s'auto-sature (429 en boucle, finalisation locale coincée en
 *     awaiting_local, constaté en QA sur la prod).
 * Budget séparé et plus large pour ces trois préfixes ; le 30/min strict
 * reste pour tout le reste de /api/files/**.
 *
 * A-9 (M4) : même traitement (180/min) pour /api/files/result/{dxf,svg}/ ; le ZIP
 * (zlib niveau 9, coûteux) a son propre budget strict de 20/min (`:zip`) pour — une liste
 * d'~30 tôles = ~30 vignettes SVG + DXF/ZIP, ce qui vidait les 30/min et
 * rendait le téléchargement suivant 429. Les trois routes exigent une session
 * ET la propriété du fichier : dxf/svg via openOwnedFileStream
 * (server/utils/vault.js : 401 sans userId, 404 si ownerId !== userId),
 * zip via le 401 sans userId et un findOne({ slug, ownerId: userId })
 * (server/api/files/result/zip/[nestslug].get.js). Budget distinct (clé
 * suffixée `:result`) pour ne pas se vider mutuellement avec les fichiers de
 * projet. Toute autre route /api/files/** (p. ex. celles qui ne reposent que
 * sur le secret du slug) garde le 30/min strict.
 */
export default defineEventHandler((event) => {
    const url = String(event.path || event.node?.req?.url || '')
    if (!url.startsWith('/api/files')) return

    const userId = event.context?.auth?.userId
    const ip = clientIp(event)
    const key = userId ? `files:user:${userId}` : `files:ip:${ip}`
    const windowMs = 60_000
    const isProjectFile =
        url.startsWith('/api/files/project/geometry/')
        || url.startsWith('/api/files/project/dxf/')
        || url.startsWith('/api/files/project/svg/')
    const isResultFile =
        url.startsWith('/api/files/result/dxf/')
        || url.startsWith('/api/files/result/svg/')
    // Le ZIP fabrique une archive zlib niveau 9 (coûteux en CPU) : budget strict propre.
    const isResultZip = url.startsWith('/api/files/result/zip/')
    const limit = isProjectFile || isResultFile ? 180 : isResultZip ? 20 : 30
    const budgetKey = isProjectFile ? `${key}:project`
        : isResultFile ? `${key}:result`
        : isResultZip ? `${key}:zip`
        : key
    if (!rateLimitAllow(budgetKey, { limit, windowMs })) {
        denyRateLimit(event, { windowMs })
    }
})
