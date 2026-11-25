/**
 * Les ENTITÉS RÉELLES d'une source DXF canonique (mm, celle que le navigateur
 * garde et passe à l'écrivain DXF) et la FORME d'une pièce posée.
 * Fichier PUR (aucune E/S, aucun DOM) : il tourne dans le Worker de finalisation.
 *
 * Ce qu'EST une pièce, c'est son anneau importé (son enveloppe convexe suffit pour
 * une boîte à tout angle) : ses poignées portent aussi ce que l'importeur a
 * rattaché à son encre (axes, cotes, repères, arête commune avec une voisine).
 * Les entités ne font qu'affiner (voir partShape) : le cercle exact d'une pièce
 * ronde, les arcs de polyligne que l'anneau a en cordes, et l'aplatissement
 * (0,01 mm) des autres courbes. Les anneaux du payload, eux, ne servent pas : ils
 * sont simplifiés (0,05 mm) ou élargis (réserve d'amorce SheetCam).
 *
 * Entités lues (celles que l'écrivain sait livrer) : LINE, LWPOLYLINE (groupe 42),
 * POLYLINE/VERTEX/SEQEND (groupe 42), ARC, CIRCLE, ELLIPSE, POINT, SPLINE. Un
 * type inconnu, un nombre illisible ou une entité dégénérée rend CETTE entité
 * illisible (`bad`) : elle n'affine rien ; une polyligne illisible refuse la pièce
 * (ses arcs manqueraient).
 *
 * SPLINE : le fichier livré porte la B-spline de l'écrivain (degré, nœuds, points
 * de contrôle, poids ; drapeaux périodique/fermé écrits à 0). On évalue CETTE
 * courbe, 256 échantillons par intervalle de nœuds (affinage seulement).
 */

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const TWO_PI = 2 * Math.PI
const SPLINE_SAMPLES = 256
// Un point à moins que cela du bord de l'enveloppe est dessus.
const ON_HULL_TOL_MM = 0.05
// Un arc aplati à 0,01 mm dépasse son anneau d'au plus cela.
const REFINE_TOL_MM = 0.015
// Les sommets d'un cercle aplati sont sur le cercle (grille, flèche comprises).
const ROUND_TOL_MM = 0.015

/** Un arc normalisé { cx, cy, r, a0, sweep } : balayage CCW, a0 en radians. */
function arcOf(cx, cy, r, a0, sweep) {
    if (sweep < 0) return { cx, cy, r, a0: a0 + sweep, sweep: -sweep }
    return { cx, cy, r, a0, sweep }
}

/** Arc d'un segment de polyligne p -> q de bosse `b` (tan(θ/4)). */
function bulgeArc(p, q, b) {
    const theta = 4 * Math.atan(b)
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const L = Math.hypot(dx, dy)
    if (!(L > 0) || !finite(theta)) return null
    const half = theta / 2
    const r = L / (2 * Math.abs(Math.sin(half)))
    // Centre : milieu de la corde décalé sur sa normale gauche de (L/2)/tan(θ/2).
    const off = (L / 2) / Math.tan(half)
    const cx = (p[0] + q[0]) / 2 + (-dy / L) * off
    const cy = (p[1] + q[1]) / 2 + (dx / L) * off
    return arcOf(cx, cy, r, Math.atan2(p[1] - cy, p[0] - cx), theta)
}

/** Points d'une spline (évaluation de Cox-de Boor, rationnelle si poids). */
function splinePoints(sp) {
    const { degree: p, knots: U, control: P, weights: W } = sp
    const n = P.length
    if (!(Number.isInteger(p) && p >= 1) || n < p + 1 || U.length !== n + p + 1) return null
    if (W.length && W.length !== n) return null
    if (!U.every(finite) || U.some((u, i) => i && u < U[i - 1])) return null
    const out = []
    const basis = (u, span) => {
        const N = new Array(p + 1).fill(0)
        const left = new Array(p + 1).fill(0)
        const right = new Array(p + 1).fill(0)
        N[0] = 1
        for (let j = 1; j <= p; j++) {
            left[j] = u - U[span + 1 - j]
            right[j] = U[span + j] - u
            let saved = 0
            for (let r = 0; r < j; r++) {
                const den = right[r + 1] + left[j - r]
                const t = den === 0 ? 0 : N[r] / den
                N[r] = saved + right[r + 1] * t
                saved = left[j - r] * t
            }
            N[j] = saved
        }
        return N
    }
    const at = (u, span) => {
        const N = basis(u, span)
        let x = 0, y = 0, w = 0
        for (let j = 0; j <= p; j++) {
            const k = span - p + j
            const wk = W.length ? W[k] : 1
            x += N[j] * wk * P[k][0]
            y += N[j] * wk * P[k][1]
            w += N[j] * wk
        }
        return w === 0 ? null : [x / w, y / w]
    }
    const lo = U[p]
    const hi = U[n]
    if (!(hi > lo)) return null
    for (let span = p; span < n; span++) {
        if (!(U[span + 1] > U[span])) continue
        for (let s = 0; s <= SPLINE_SAMPLES; s++) {
            const u = U[span] + ((U[span + 1] - U[span]) * s) / SPLINE_SAMPLES
            const pt = at(u, span)
            if (!pt) return null
            out.push(pt)
        }
    }
    return out.length ? out : null
}

/**
 * Index d'une source DXF : poignée -> entités. `null` seulement si le TEXTE est
 * inutilisable ; une entité illisible (type inconnu, nombre illisible, dégénérée,
 * spline incohérente) est marquée `bad` et ne refuse que les pièces qui la portent.
 * Lecture par PAIRES code/valeur (jamais ligne à ligne : une valeur « 10 » n'est
 * pas un code).
 */
export function readDxfEntities(input) {
    try {
        const text = typeof input === 'string'
            ? input
            : new TextDecoder('utf-8').decode(input)
        const lines = text.split(/\r\n|\r|\n/)
        const byHandle = new Map()
        let section = null
        let cur = null
        let poly = null // POLYLINE ouverte : ses VERTEX s'y ajoutent
        const num = (v) => {
            const n = Number(v)
            if (v === '' || !Number.isFinite(n)) {
                if (cur) cur.bad = true
                else if (poly) poly.bad = true
            }
            return n
        }
        const push = (e) => {
            const h = e.handle
            if (!byHandle.has(h)) byHandle.set(h, [])
            byHandle.get(h).push(e)
        }
        const closeCur = () => {
            if (!cur) return
            const e = cur
            cur = null
            if (e.type === 'VERTEX') return
            if (e.type === 'SEQEND') { poly = null; return }
            if (e.type === 'POLYLINE') { poly = e; push(e); return }
            push(e)
        }
        const fin = () => {
            if (cur?.type === 'VERTEX' && poly) {
                poly.verts.push(cur.v)
                if (cur.bad) poly.bad = true
            }
        }
        for (let i = 0; i + 1 < lines.length; i += 2) {
            const code = Number(lines[i].trim())
            const val = lines[i + 1].trim()
            if (!Number.isInteger(code)) return null
            if (code === 0) {
                fin()
                closeCur()
                if (val === 'SECTION') continue
                if (val === 'ENDSEC') { section = null; continue }
                if (val === 'EOF') break
                if (section !== 'ENTITIES') continue
                switch (val) {
                    case 'LINE': cur = { type: 'LINE', handle: '', pts: [0, 0, 0, 0] }; break
                    case 'LWPOLYLINE': cur = { type: 'LWPOLYLINE', handle: '', closed: false, verts: [] }; break
                    case 'POLYLINE': cur = { type: 'POLYLINE', handle: '', closed: false, verts: [] }; break
                    case 'VERTEX': cur = { type: 'VERTEX', v: [0, 0, 0] }; break
                    case 'SEQEND': cur = { type: 'SEQEND' }; break
                    case 'ARC': cur = { type: 'ARC', handle: '', c: [0, 0], r: 0, a0: 0, a1: 0 }; break
                    case 'CIRCLE': cur = { type: 'CIRCLE', handle: '', c: [0, 0], r: 0 }; break
                    case 'ELLIPSE': cur = { type: 'ELLIPSE', handle: '', c: [0, 0], m: [1, 0], q: 1, t0: 0, t1: TWO_PI }; break
                    case 'POINT': cur = { type: 'POINT', handle: '', c: [0, 0] }; break
                    case 'SPLINE': cur = { type: 'SPLINE', handle: '', degree: 0, knots: [], control: [], weights: [] }; break
                    // INSERT, TEXT, HATCH… : non livrable, donc non mesurable ; seule
                    // sa poignée compte, pour refuser les pièces qui la portent.
                    default: cur = { type: 'UNREADABLE', handle: '', bad: true }
                }
                continue
            }
            if (code === 2 && section === null && lines[i - 2]?.trim() === '0' && lines[i - 1]?.trim() === 'SECTION') {
                section = val
                continue
            }
            if (!cur) continue
            if (code === 5) { if (cur.type !== 'VERTEX') cur.handle = val; continue }
            if (code === 8) { if (cur.type !== 'VERTEX') cur.layer = val; continue }
            switch (cur.type) {
                case 'LINE':
                    if (code === 10) cur.pts[0] = num(val)
                    else if (code === 20) cur.pts[1] = num(val)
                    else if (code === 11) cur.pts[2] = num(val)
                    else if (code === 21) cur.pts[3] = num(val)
                    break
                case 'LWPOLYLINE':
                    if (code === 70) cur.closed = (Number(val) & 1) === 1
                    else if (code === 10) cur.verts.push([num(val), 0, 0])
                    else if (code === 20 && cur.verts.length) cur.verts[cur.verts.length - 1][1] = num(val)
                    else if (code === 42 && cur.verts.length) cur.verts[cur.verts.length - 1][2] = num(val)
                    break
                case 'POLYLINE':
                    if (code === 70) cur.closed = (Number(val) & 1) === 1
                    break
                case 'VERTEX':
                    if (code === 10) cur.v[0] = num(val)
                    else if (code === 20) cur.v[1] = num(val)
                    else if (code === 42) cur.v[2] = num(val)
                    break
                case 'ARC':
                case 'CIRCLE':
                    if (code === 10) cur.c[0] = num(val)
                    else if (code === 20) cur.c[1] = num(val)
                    else if (code === 40) cur.r = num(val)
                    else if (code === 50 && cur.type === 'ARC') cur.a0 = num(val)
                    else if (code === 51 && cur.type === 'ARC') cur.a1 = num(val)
                    break
                case 'ELLIPSE':
                    if (code === 10) cur.c[0] = num(val)
                    else if (code === 20) cur.c[1] = num(val)
                    else if (code === 11) cur.m[0] = num(val)
                    else if (code === 21) cur.m[1] = num(val)
                    else if (code === 40) cur.q = num(val)
                    else if (code === 41) cur.t0 = num(val)
                    else if (code === 42) cur.t1 = num(val)
                    break
                case 'POINT':
                    if (code === 10) cur.c[0] = num(val)
                    else if (code === 20) cur.c[1] = num(val)
                    break
                case 'SPLINE':
                    if (code === 71) cur.degree = num(val)
                    else if (code === 40) cur.knots.push(num(val))
                    else if (code === 41) cur.weights.push(num(val))
                    else if (code === 10) cur.control.push([num(val), 0])
                    else if (code === 20 && cur.control.length) cur.control[cur.control.length - 1][1] = num(val)
                    break
                default:
            }
        }
        fin()
        closeCur()
        if (poly) poly.bad = true // POLYLINE jamais fermée par un SEQEND
        for (const list of byHandle.values()) {
            for (const e of list) {
                if (e.bad) continue
                if (e.type === 'SPLINE') {
                    e.pts = splinePoints(e)
                    if (!e.pts) e.bad = true
                } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.verts.length < 1) e.bad = true
                else if ((e.type === 'CIRCLE' || e.type === 'ARC') && !(e.r > 0)) e.bad = true
                else if (e.type === 'ELLIPSE' && !(e.q > 0 && Math.hypot(e.m[0], e.m[1]) > 0)) e.bad = true
            }
        }
        return byHandle
    } catch {
        return null
    }
}

/** Fabrique `slug -> index | null` mémoïsée (une lecture par source). `sources` :
 * { slug: Uint8Array | string }. Porte aussi `.cache`, la mémoire des formes de
 * pièces mesurées (voir partShape) : une mesure par (source, poignées). */
export function entityIndexOf(sources) {
    const cache = new Map()
    const fn = (slug) => {
        if (!cache.has(slug)) {
            const src = sources?.[slug]
            cache.set(slug, src ? readDxfEntities(src) : null)
        }
        return cache.get(slug)
    }
    fn.cache = new Map()
    return fn
}

/** Balayage d'une ELLIPSE réduit modulo 2π comme l'importeur : { t0, sweep, full }. */
function ellipseSweep(e) {
    const raw = e.t1 - e.t0
    if (Math.abs(Math.abs(raw) - TWO_PI) < 1e-9 || Math.abs(raw) < 1e-9) return { t0: 0, sweep: TWO_PI, full: true }
    let sweep = ((raw % TWO_PI) + TWO_PI) % TWO_PI
    if (sweep < 1e-9) sweep = TWO_PI
    const t0 = ((e.t0 % TWO_PI) + TWO_PI) % TWO_PI
    return { t0, sweep, full: sweep >= TWO_PI - 1e-9 }
}

/** Entité -> pièces géométriques posées : points (sommets, extrêmes) et arcs. */
function placeEntity(e, T, pts, arcs) {
    const { c, s, tx, ty, angle } = T
    const P = (x, y) => [c * x - s * y + tx, s * x + c * y + ty]
    switch (e.type) {
        case 'LINE':
            pts.push(P(e.pts[0], e.pts[1]), P(e.pts[2], e.pts[3]))
            return
        case 'POINT':
            pts.push(P(e.c[0], e.c[1]))
            return
        case 'CIRCLE': {
            const ct = P(e.c[0], e.c[1])
            arcs.push({ cx: ct[0], cy: ct[1], r: e.r, a0: 0, sweep: TWO_PI, full: true })
            return
        }
        case 'ARC': {
            const ct = P(e.c[0], e.c[1])
            const a0 = (e.a0 * Math.PI) / 180
            let sw = ((e.a1 - e.a0) * Math.PI) / 180
            sw = ((sw % TWO_PI) + TWO_PI) % TWO_PI
            if (sw === 0) sw = TWO_PI
            arcs.push({ cx: ct[0], cy: ct[1], r: e.r, a0: a0 + angle, sweep: sw })
            return
        }
        case 'ELLIPSE': {
            const ct = P(e.c[0], e.c[1])
            const mx = c * e.m[0] - s * e.m[1]
            const my = s * e.m[0] + c * e.m[1]
            // pt(t) = ct + m cos t + q·perp(m) sin t, perp(m) = (-my, mx)
            const ax = [mx, -e.q * my]
            const ay = [my, e.q * mx]
            const { t0, sweep, full } = ellipseSweep(e)
            const t1 = t0 + sweep
            const ts = [t0, t1]
            for (const [A, B] of [ax, ay]) {
                const t = Math.atan2(B, A)
                for (const cand of [t, t + Math.PI]) {
                    let u = cand
                    while (u < t0) u += TWO_PI
                    while (u >= t0 + TWO_PI) u -= TWO_PI
                    if (full || u <= t1) ts.push(u)
                }
            }
            for (const t of ts) {
                pts.push([ct[0] + mx * Math.cos(t) - e.q * my * Math.sin(t), ct[1] + my * Math.cos(t) + e.q * mx * Math.sin(t)])
            }
            return
        }
        case 'LWPOLYLINE':
        case 'POLYLINE': {
            const v = e.verts
            const n = v.length
            for (const q of v) pts.push(P(q[0], q[1]))
            const segs = e.closed ? n : n - 1
            for (let i = 0; i < segs; i++) {
                const b = v[i][2]
                if (!b) continue
                const a = bulgeArc([v[i][0], v[i][1]], [v[(i + 1) % n][0], v[(i + 1) % n][1]], b)
                if (!a) continue
                const ct = P(a.cx, a.cy)
                arcs.push({ cx: ct[0], cy: ct[1], r: a.r, a0: a.a0 + angle, sweep: a.sweep, seg: true })
            }
            return
        }
        case 'SPLINE':
            for (const q of e.pts) pts.push(P(q[0], q[1]))
            return
        default:
            throw new Error('unreadable')
    }
}

/** Les extrêmes d'un arc : ses bouts, plus les directions d'axe dans son balayage. */
function arcExtremes(a, pts) {
    const at = (t) => pts.push([a.cx + a.r * Math.cos(t), a.cy + a.r * Math.sin(t)])
    if (a.full || a.sweep >= TWO_PI - 1e-12) {
        for (let k = 0; k < 4; k++) at((k * Math.PI) / 2)
        return
    }
    at(a.a0)
    at(a.a0 + a.sweep)
    for (let k = 0; k < 4; k++) {
        const t = (k * Math.PI) / 2
        let d = (t - a.a0) % TWO_PI
        if (d < 0) d += TWO_PI
        if (d <= a.sweep) at(t)
    }
}

const hasBulge = (e) => (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.verts.some((v) => v[2])

/** Enveloppe convexe sans son point de fermeture ; null si inutilisable. */
function openHull(hull) {
    if (!Array.isArray(hull) || hull.length < 3) return null
    const pts = []
    for (const p of hull) {
        if (!Array.isArray(p) || !finite(p[0]) || !finite(p[1])) return null
        pts.push([p[0], p[1]])
    }
    const a = pts[0]
    const b = pts[pts.length - 1]
    if (pts.length > 3 && a[0] === b[0] && a[1] === b[1]) pts.pop()
    return pts.length >= 3 ? pts : null
}

/** Sommets de l'enveloppe convexe d'un nuage (chaîne monotone, anti-horaire). */
function hullPoints(points) {
    const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
    if (pts.length < 4) return pts
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const half = (list) => {
        const out = []
        for (const p of list) {
            while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
            out.push(p)
        }
        out.pop()
        return out
    }
    return [...half(pts), ...half(pts.reverse())]
}

function segDist(p, a, b) {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** Distance d'un point au BORD de l'enveloppe. */
function toEdge(p, H) {
    let best = Infinity
    for (let i = 0; i < H.length; i++) best = Math.min(best, segDist(p, H[i], H[(i + 1) % H.length]))
    return best
}

/** De combien un point sort de l'enveloppe (anti-horaire) : 0 dedans ou au bord. */
function outside(p, H) {
    for (let i = 0; i < H.length; i++) {
        const a = H[i]
        const b = H[(i + 1) % H.length]
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) return toEdge(p, H)
    }
    return 0
}

/** Points d'un arc, tous les 2°, bouts compris. */
function arcSamples(a) {
    const n = Math.max(8, Math.ceil(a.sweep / (Math.PI / 90)))
    return Array.from({ length: n + 1 }, (_, i) => {
        const t = a.a0 + (a.sweep * i) / n
        return [a.cx + a.r * Math.cos(t), a.cy + a.r * Math.sin(t)]
    })
}

/** Segments droits d'une entité (LINE, polyligne sans bosse) : [[a, b]…]. */
function straights(e) {
    if (e.type === 'LINE') return [[[e.pts[0], e.pts[1]], [e.pts[2], e.pts[3]]]]
    if (e.type !== 'LWPOLYLINE' && e.type !== 'POLYLINE') return []
    const v = e.verts
    const n = e.closed ? v.length : v.length - 1
    return Array.from({ length: Math.max(0, n) }, (_, i) => i).filter((i) => !v[i][2])
        .map((i) => [v[i], v[(i + 1) % v.length]])
}

/** Un segment droit du dessin longe-t-il déjà la corde p-q (même droite, au milieu) ? */
function chordDrawn(list, p, q) {
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    const L = Math.hypot(q[0] - p[0], q[1] - p[1])
    return list.some((e) => straights(e).some(([a, b]) => segDist(mid, a, b) <= 0.02
        && Math.abs((b[0] - a[0]) * (q[1] - p[1]) - (b[1] - a[1]) * (q[0] - p[0]))
            <= 0.01 * L * Math.hypot(b[0] - a[0], b[1] - a[1])))
}

/** La corde p-q longe-t-elle le bord de l'enveloppe (au moins 3 points sur 39) ? */
function chordOnEdge(p, q, H) {
    let on = 0
    for (let k = 1; k < 40; k++) {
        const t = k / 40
        if (toEdge([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], H) <= ON_HULL_TOL_MM) on++
    }
    return on >= 3
}

/**
 * Arcs de polyligne qui font partie du CONTOUR : l'importeur les a lus en cordes,
 * l'enveloppe ne les connaît pas. Trois cas, rien d'autre :
 *  - la polyligne EST le contour (fermée, dans l'enveloppe, et chaque sommet de
 *    l'enveloppe est l'un des siens) : tous ses arcs ;
 *  - un arc qui sort de l'enveloppe, d'une polyligne qui tient dedans, dont la corde
 *    est un bord de l'enveloppe que rien d'autre ne dessine : cet arc ;
 *  - un arc qui ne sort pas de l'enveloppe, ou une polyligne étrangère (une cote,
 *    un repère qui part d'ici) : ignoré.
 * Le reste est ambigu (contour et amorce dans la même polyligne, contour mal
 * ajusté, repère tracé d'un bord à l'autre…) : null.
 */
function outlineArcs(list, H) {
    const out = []
    for (const e of list) {
        if (!hasBulge(e)) continue
        const v = e.verts
        const n = v.length
        const far = v.some((q) => outside(q, H) > ON_HULL_TOL_MM)
        if (far) {
            if (v.filter((q) => toEdge(q, H) <= ON_HULL_TOL_MM).length >= 2) return null
            for (let i = 0; i < (e.closed ? n : n - 1); i++) {
                if (v[i][2] && chordOnEdge(v[i], v[(i + 1) % n], H)) return null
            }
            continue
        }
        const whole = e.closed
            && H.every((h) => v.some((q) => Math.hypot(q[0] - h[0], q[1] - h[1]) <= ON_HULL_TOL_MM))
        const segs = e.closed ? n : n - 1
        for (let i = 0; i < segs; i++) {
            if (!v[i][2]) continue
            const p = [v[i][0], v[i][1]]
            const q = [v[(i + 1) % n][0], v[(i + 1) % n][1]]
            const a = bulgeArc(p, q, v[i][2])
            if (!a) continue
            if (whole) out.push(a)
            else if (arcSamples(a).some((s) => outside(s, H) > ON_HULL_TOL_MM)) {
                if (toEdge(p, H) > ON_HULL_TOL_MM || toEdge(q, H) > ON_HULL_TOL_MM) return null
                if (toEdge([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], H) > ON_HULL_TOL_MM) return null
                if (chordDrawn(list, p, q)) return null
                out.push(a)
            }
        }
    }
    return out
}

/** Cercle qui passe par des points (Kåsa), ou null si l'ensemble n'est pas un
 * cercle à `tol` mm près, ou si un écart angulaire atteint `maxGap` radians. */
function fitCircle(points, tol, maxGap) {
    const n = points.length
    if (n < 12) return null
    let mx = 0, my = 0
    for (const p of points) { mx += p[0]; my += p[1] }
    mx /= n; my /= n
    let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0
    for (const p of points) {
        const u = p[0] - mx
        const v = p[1] - my
        suu += u * u; suv += u * v; svv += v * v
        suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u
    }
    const det = suu * svv - suv * suv
    if (!(Math.abs(det) > 1e-12 * (suu * svv || 1))) return null
    const b1 = (suuu + suvv) / 2
    const b2 = (svvv + svuu) / 2
    const cx = mx + (b1 * svv - b2 * suv) / det
    const cy = my + (suu * b2 - suv * b1) / det
    let r = 0
    for (const p of points) r += Math.hypot(p[0] - cx, p[1] - cy)
    r /= n
    if (!(r > 0) || !finite(cx) || !finite(cy)) return null
    if (points.some((p) => Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - r) > tol)) return null
    return widestGap(points, cx, cy) < maxGap ? { cx, cy, r } : null
}

/** Plus grand écart angulaire entre deux points voisins, vus de (cx, cy). */
function widestGap(points, cx, cy) {
    const ang = points.map((p) => Math.atan2(p[1] - cy, p[0] - cx)).sort((a, b) => a - b)
    let gap = ang[0] + TWO_PI - ang[ang.length - 1]
    for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1])
    return gap
}

/** Union des balayages d'arcs d'un même cercle : longueur couverte (radians). */
function coveredSweep(arcs) {
    const iv = []
    for (const a of arcs) {
        const s = ((a.a0 % TWO_PI) + TWO_PI) % TWO_PI
        const e = s + a.sweep
        if (e > TWO_PI) iv.push([s, TWO_PI], [0, e - TWO_PI])
        else iv.push([s, e])
    }
    iv.sort((p, q) => p[0] - q[0])
    let total = 0
    let curS = null
    let curE = null
    for (const [s, e] of iv) {
        if (curE === null || s > curE) {
            if (curE !== null) total += curE - curS
            curS = s
            curE = e
        } else if (e > curE) curE = e
    }
    if (curE !== null) total += curE - curS
    return total
}

/**
 * Le contour est-il UN cercle entier ? { cx, cy, r } ou null. Le cercle vient du
 * dessin (CIRCLE, ELLIPSE de rapport 1, arcs d'un même cercle qui en font le tour)
 * et doit être celui du contour : chaque sommet de l'enveloppe est dessus, et
 * l'enveloppe en fait le tour (flèche du plus grand vide : un méplat, un carré, un
 * polygone à gros côtés ne sont pas ronds, même avec un cercle tracé dessus). Le
 * plus proche gagne (cercles concentriques). Sans cercle dans le dessin (SVG,
 * Bézier), celui de l'enveloppe si elle en est un, à 0,005 mm et tous les 10°, et
 * si le dessin en fait lui-même le tour (une fente, une encoche, des dents ne se
 * voient pas sur l'enveloppe).
 *
 * `bosses` null : seulement les cercles dessinés (CIRCLE, ELLIPSE).
 */
function roundOf(list, H, bosses) {
    let best = null
    const accept = (c, byArcs) => {
        let dev = 0
        for (const h of H) dev = Math.max(dev, Math.abs(Math.hypot(h[0] - c.cx, h[1] - c.cy) - c.r))
        if (dev > ROUND_TOL_MM) return
        const sag = c.r * (1 - Math.cos(widestGap(H, c.cx, c.cy) / 2))
        if (!byArcs && sag > Math.max(ON_HULL_TOL_MM, 0.003 * c.r)) return
        if (!best || dev < best.dev) best = { cx: c.cx, cy: c.cy, r: c.r, dev }
    }
    const arcs = (bosses || []).map((a) => ({ ...a, boss: true }))
    for (const e of list) {
        if (e.type === 'CIRCLE') accept({ cx: e.c[0], cy: e.c[1], r: e.r }, false)
        else if (e.type === 'ELLIPSE' && Math.abs(e.q - 1) <= 1e-9 && ellipseSweep(e).full) {
            accept({ cx: e.c[0], cy: e.c[1], r: Math.hypot(e.m[0], e.m[1]) }, false)
        } else if (e.type === 'ARC' && bosses) {
            let sw = ((e.a1 - e.a0) * Math.PI) / 180
            sw = ((sw % TWO_PI) + TWO_PI) % TWO_PI
            arcs.push({ cx: e.c[0], cy: e.c[1], r: e.r, a0: (e.a0 * Math.PI) / 180, sweep: sw === 0 ? TWO_PI : sw })
        }
    }
    const groups = []
    for (const a of arcs) {
        const g = groups.find((k) => Math.hypot(k.cx - a.cx, k.cy - a.cy) <= 1e-3 && Math.abs(k.r - a.r) <= 1e-3)
        if (g) g.arcs.push(a)
        else groups.push({ cx: a.cx, cy: a.cy, r: a.r, arcs: [a] })
    }
    for (const g of groups) {
        if (Math.abs(coveredSweep(g.arcs) - TWO_PI) <= 1e-3) accept(g, g.arcs.some((a) => a.boss))
    }
    if (best) return { cx: best.cx, cy: best.cy, r: best.r }
    if (!bosses || bosses.length) return null
    const f = fitCircle(H, 0.005, (10 * Math.PI) / 180)
    if (!f) return null
    const on = []
    for (const e of list) {
        const pts = e.type === 'SPLINE'
            ? e.pts
            : (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && !hasBulge(e) ? e.verts : null
        if (pts?.every((q) => Math.abs(Math.hypot(q[0] - f.cx, q[1] - f.cy) - f.r) <= 0.01)) for (const q of pts) on.push(q)
    }
    return on.length && widestGap(on, f.cx, f.cy) < (10 * Math.PI) / 180 ? f : null
}

/**
 * La FORME d'une pièce (repère de la source, non posée), à partir de l'enveloppe
 * convexe de son anneau ORIGINAL importé (`hull`, avant simplification et avant
 * réserve d'amorce) : c'est elle qui dit ce qu'est la pièce, jamais les entités
 * (l'importeur rattache aussi à une pièce ses axes, ses cotes, ses repères, l'arête
 * d'une voisine). Les entités ne font qu'affiner : le cercle exact d'une pièce
 * ronde, les arcs de polyligne que l'anneau a en cordes, et les 0,01 mm qu'un arc
 * aplati perd. `null` si l'enveloppe manque ou si une polyligne à arcs est
 * illisible ou ambiguë : jamais un nombre deviné.
 *
 * @returns {{ hull, bosses, curves, extra, round:null|{cx,cy,d} }|null}
 */
export function partShape(entities, hull) {
    const H = openHull(hull)
    if (!H || !entities?.length) return null
    if (entities.some((e) => e.bad && (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE'))) return null
    const list = entities.filter((e) => !e.bad)
    if (!list.length) return null
    // Un cercle DESSINÉ qui est le contour n'a besoin de rien d'autre.
    let r = roundOf(list, H, null)
    const bosses = r ? [] : outlineArcs(list, H)
    if (!bosses) return null
    r = r || roundOf(list, H, bosses)
    if (r) return { round: { cx: r.cx, cy: r.cy, d: 2 * r.r } }
    // Affinage : les points FIXES qui sortent à peine de l'enveloppe (un point dedans
    // ne peut étendre la boîte à aucun angle), et les courbes, dont les extrêmes
    // dépendent de l'angle.
    const extra = []
    const curves = []
    const near = (p) => {
        const o = outside(p, H)
        if (o > 0 && o <= REFINE_TOL_MM) extra.push(p)
    }
    for (const e of list) {
        if (e.type === 'LINE') {
            near([e.pts[0], e.pts[1]])
            near([e.pts[2], e.pts[3]])
        } else if (e.type === 'POINT') near(e.c)
        // Un point intérieur à l'enveloppe de SA courbe n'étend aucune boîte.
        else if (e.type === 'SPLINE') hullPoints(e.pts).forEach(near)
        else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') e.verts.forEach((q) => near([q[0], q[1]]))
        else curves.push(e)
    }
    return { hull: H, bosses, curves, extra, round: null }
}

/** Centre de la boîte de la forme tournée de `angle` autour de (0,0), sans
 * translation, mémorisé par angle sur la forme. */
export function shapeCentreAt(shape, angle) {
    if (!shape.byAngle) shape.byAngle = new Map()
    if (shape.byAngle.has(angle)) return shape.byAngle.get(angle)
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const R = (p) => [c * p[0] - s * p[1], s * p[0] + c * p[1]]
    const H = shape.hull.map(R)
    const sure = [...H, ...shape.extra.map(R)]
    for (const a of shape.bosses) {
        const ct = R([a.cx, a.cy])
        arcExtremes({ cx: ct[0], cy: ct[1], r: a.r, a0: a.a0 + angle, sweep: a.sweep }, sure)
    }
    // Extrêmes des arcs, cercles et ellipses : gardés seulement s'ils sortent à peine
    // de l'enveloppe (l'arc aplati du contour), jamais ceux d'une cote.
    const pts = []
    const arcs = []
    for (const e of shape.curves) placeEntity(e, { c, s, tx: 0, ty: 0, angle }, pts, arcs)
    for (const a of arcs) arcExtremes(a, pts)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    const add = (p) => {
        if (p[0] < x0) x0 = p[0]
        if (p[0] > x1) x1 = p[0]
        if (p[1] < y0) y0 = p[1]
        if (p[1] > y1) y1 = p[1]
    }
    sure.forEach(add)
    for (const p of pts) {
        if ((p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) && outside(p, H) <= REFINE_TOL_MM) add(p)
    }
    const centre = finite(x0) && finite(x1) && finite(y0) && finite(y1) ? [(x0 + x1) / 2, (y0 + y1) / 2] : null
    shape.byAngle.set(angle, centre)
    return centre
}
