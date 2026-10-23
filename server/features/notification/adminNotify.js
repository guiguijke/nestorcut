import { COUNTRY_HEADER_NAME } from '../../tracking/const'
import { connectDB } from '../../db/mongo'
import logger from '../../utils/logger'

// Notifies the platform administrator (by email) when a new user signs up.
//
// The destination address is NUXT_ADMIN_NOTIFY_EMAIL. If unset, this is a no-op
// (the admin panel's periodic digest is the safety net that catches any signup
// missed here, e.g. when Resend was unreachable at signup time).
//
// D4 (C1-b): after a SUCCESSFUL send, the user doc is stamped with
// `adminNotifiedAt` — the admin digest filters on its absence, so each
// signup reaches the admin exactly once (the digest truly becomes the
// safety net it claims to be). A failed send leaves no marker on purpose:
// the digest will pick that signup up.
//
// This is fire-and-forget from the caller's perspective: a failure to send
// the notification must never block registration. Country/IP are derived from
// the Cloudflare cf-ipcountry header (best-effort; null behind a non-Cloudflare proxy).
export async function notifyAdminNewUser(event, { id, email, name, provider }) {
  const config = useRuntimeConfig(event)
  const notifyEmail = config.adminNotifyEmail
  if (!notifyEmail) return

  const country = event.node.req.headers[COUNTRY_HEADER_NAME] || null
  const ip =
    event.node.req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    event.node.req.socket?.remoteAddress ||
    null

  const subject = `Nouvelle inscription — ${name} (${email})`
  const html = `
    <h2 style="margin:0 0 8px">Nouvel utilisateur sur NestorCut</h2>
    <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;color:#222">
      <tr><td style="padding:2px 12px 2px 0;color:#666">Nom</td><td>${escapeHtml(name || '—')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Email</td><td>${escapeHtml(email || '—')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Provider</td><td>${escapeHtml(provider || '—')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Pays</td><td>${escapeHtml(country || '— inconnu')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">IP</td><td>${escapeHtml(ip || '—')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Identifiant</td><td style="font-family:monospace">${escapeHtml(id)}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Date</td><td>${new Date().toLocaleString('fr-FR')}</td></tr>
    </table>
    <p style="margin-top:16px;font-size:13px;color:#666">Connectez-vous au panneau d'administration pour voir le détail.</p>
  `

  try {
    await $fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.resendToken}`,
      },
      body: {
        from: config.resendFrom || 'onboarding@resend.dev',
        to: notifyEmail,
        subject,
        html,
      },
    })
    // D4 (C1-b) : envoi réussi → marqueur. Le digest filtre sur son
    // absence ; un échec ci-dessous (Resend KO) ne pose RIEN et le digest
    // reprendra cet inscrit.
    const db = await connectDB()
    await db.collection('users').updateOne({ id }, { $set: { adminNotifiedAt: new Date() } })
  } catch (err) {
    // Swallow — the periodic digest in the admin panel covers missed signups.
    logger.warn('Failed to notify admin of new signup', { id, err: String(err) })
  }
}

// Notifie l'administrateur quand un UTILISATEUR écrit au support (chat in-app
// ou formulaire de contact). Même destinataire et même garde que
// notifyAdminNewUser : sans NUXT_ADMIN_NOTIFY_EMAIL, no-op.
//
// Anti-spam : pour le chat, un seul e-mail par expéditeur toutes les 10 min
// (Map en mémoire, clé = userId). Un envoi échoué ne consomme pas la fenêtre.
// Le formulaire de contact n'est pas throttlé ici : contact.post.js le limite
// déjà par IP.
//
// Ne lève jamais : l'appelant ne doit pas échouer à cause d'un e-mail.
const SUPPORT_NOTIFY_COOLDOWN_MS = 10 * 60 * 1000
const SUPPORT_EXCERPT_MAX = 500
const ADMIN_SUPPORT_URL = 'http://192.168.1.180:7200/support'
const lastChatNotifyAt = new Map() // userId -> timestamp (ms)

export async function notifyAdminSupportMessage(event, { kind, userId, name, email, message }) {
  try {
    const config = useRuntimeConfig(event)
    const notifyEmail = config.adminNotifyEmail
    if (!notifyEmail) return

    if (kind === 'chat') {
      const now = Date.now()
      const last = lastChatNotifyAt.get(userId)
      if (last !== undefined && now - last < SUPPORT_NOTIFY_COOLDOWN_MS) return
      lastChatNotifyAt.set(userId, now)
    }

    const raw = String(message ?? '')
    const excerpt = raw.length > SUPPORT_EXCERPT_MAX ? `${raw.slice(0, SUPPORT_EXCERPT_MAX)}…` : raw
    const who = name || email || userId || '—'
    const source = kind === 'chat' ? 'Support in-app (chat)' : 'Formulaire de contact (nestorcut.com)'
    const date = new Date().toLocaleString('fr-FR')
    const subject = `[NestorCut] Nouveau message de support — ${who}`

    const text = [
      'Nouveau message de support sur NestorCut',
      '',
      `Source : ${source}`,
      `Nom : ${name || '—'}`,
      `Email : ${email || '—'}`,
      ...(kind === 'chat' ? [`Identifiant : ${userId}`] : []),
      `Date : ${date}`,
      '',
      excerpt,
      '',
      `Répondre : ${ADMIN_SUPPORT_URL}`,
    ].join('\n')

    const html = `
    <h2 style="margin:0 0 8px">Nouveau message de support sur NestorCut</h2>
    <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;color:#222">
      <tr><td style="padding:2px 12px 2px 0;color:#666">Source</td><td>${escapeHtml(source)}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Nom</td><td>${escapeHtml(name || '—')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Email</td><td>${escapeHtml(email || '—')}</td></tr>
      ${kind === 'chat' ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Identifiant</td><td style="font-family:monospace">${escapeHtml(userId)}</td></tr>` : ''}
      <tr><td style="padding:2px 12px 2px 0;color:#666">Date</td><td>${escapeHtml(date)}</td></tr>
    </table>
    <p style="margin-top:16px;white-space:pre-wrap;font-size:14px;color:#222">${escapeHtml(excerpt)}</p>
    <p style="margin-top:16px;font-size:13px"><a href="${ADMIN_SUPPORT_URL}">Ouvrir le support d'administration</a></p>
  `

    await $fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.resendToken}`,
      },
      body: {
        from: config.resendFrom || 'onboarding@resend.dev',
        to: notifyEmail,
        subject,
        text,
        html,
      },
    })
  } catch (err) {
    // Échec d'envoi : on libère la fenêtre anti-spam pour le prochain message.
    if (kind === 'chat') lastChatNotifyAt.delete(userId)
    logger.warn('Failed to notify admin of support message', { kind, userId, err: String(err) })
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
