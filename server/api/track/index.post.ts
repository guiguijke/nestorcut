import { defineEventHandler, getCookie, readBody } from 'h3'
import { saveTrackRecordInBackground, type TrackDBRecord } from '~~/server/tracking/add'
import { COUNTRY_HEADER_NAME, TRACKING_COOKIE_NAME } from '~~/server/tracking/const'
import type { TrackRequest } from '~~/shared/types/track_body'
import { clientIp, denyRateLimit, rateLimitAllow } from '~~/server/utils/ratelimit'
import { TRACK_ACTIONS } from '../../../shared/constants/trackActions'

// Strict allowlist of accepted tracking actions (snake_case). Anything else is
// rejected: this endpoint is public + unauthenticated, so without validation a
// client could fill the `tracking` collection with arbitrary payloads (storage
// DoS) or smuggle data later surfaced in the admin logs view.
// d8 (02/11) : la liste vit dans shared/constants/trackActions.js, SOURCE
// UNIQUE partagée avec le test de parité des émetteurs
// (app/tests/trackParity.test.js). Chemin RELATIF obligatoire (AGENTS #29c).
const ALLOWED_ACTIONS = new Set(TRACK_ACTIONS)

// Bounded validation of the client payload before it touches the DB.
const MAX_ACTION_LEN = 64
const MAX_DATA_KEYS = 20
const MAX_DATA_VALUE_LEN = 500

function validateTrackRequest(body: unknown): body is TrackRequest {
    if (!body || typeof body !== 'object') return false
    const { action, data } = body as Record<string, unknown>
    if (typeof action !== 'string' || action.length === 0 || action.length > MAX_ACTION_LEN) {
        return false
    }
    if (!ALLOWED_ACTIONS.has(action)) {
        return false
    }
    // data is optional; when present it must be a flat string->string map with
    // bounded size, mirroring the TrackRequest type.
    if (data == null) {
        (body as TrackRequest).data = {}
        return true
    }
    if (typeof data !== 'object' || Array.isArray(data)) return false
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length > MAX_DATA_KEYS) return false
    for (const [k, v] of entries) {
        if (typeof k !== 'string' || k.length > MAX_DATA_VALUE_LEN) return false
        if (v != null && typeof v !== 'string') return false
        if (typeof v === 'string' && v.length > MAX_DATA_VALUE_LEN) return false
    }
    return true
}

// S-5 : endpoint public sans limite de débit. Un usage humain normal émet un
// événement par clic / vue de page (quelques par minute, rafales de ~10 à
// l'ouverture d'une page) : 120/min par utilisateur (IP en repli — jamais le
// cookie de session, que le client choisit) ne refuse aucun usage réel.
const TRACK_LIMIT = 120
const TRACK_WINDOW_MS = 60_000

export default defineEventHandler(async (event) => {
    const rateKey = event.context.auth?.userId
        ? `track:user:${event.context.auth.userId}`
        : `track:ip:${clientIp(event)}`
    if (!rateLimitAllow(rateKey, { limit: TRACK_LIMIT, windowMs: TRACK_WINDOW_MS })) {
        denyRateLimit(event, { windowMs: TRACK_WINDOW_MS })
    }

    const trackRequest = await readBody<TrackRequest>(event)

    // Reject malformed or unexpected payloads early — no DB write.
    if (!validateTrackRequest(trackRequest)) {
        throw createError({ statusCode: 400, statusMessage: 'Bad request' })
    }

    const sessionKey = getCookie(event, TRACKING_COOKIE_NAME) as string
    const country = event.node.req.headers[COUNTRY_HEADER_NAME] as string
    const userId = event.context.auth?.userId

    const trackRecond: TrackDBRecord = {
        action: trackRequest.action,
        country: country,
        data: trackRequest.data,
        sessionKey: sessionKey,
        timestamp: new Date(),
        userId: userId,
    }

    await saveTrackRecordInBackground(trackRecond)
})
