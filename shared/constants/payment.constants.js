/**
 * Payment-related constants shared between server and client (landing copy).
 * Single source of truth so marketing text can never drift from the code.
 */
export const FREE_NESTING_LIMIT = 10
export const TRIAL_DAYS = 7
export const SUBSCRIPTION_PRICE_LABEL = '€19'
export const PRO_PRICE_LABEL = '€39'
/** O2 (02/11) : un compte Free télécharge les tôles numérotées 1..N de chaque
 * alternative — le reste avec Unlimited. Seule source de ce nombre (serveur,
 * client, /plans) ; côté serveur, lu UNIQUEMENT dans server/utils/entitlement.js
 * (AGENTS #34). Doit rester >= 2 : les libellés « les {n} premières »
 * (results.downloadFirstSheets, plans.value.firstSheets…) n'ont pas de singulier. */
export const FREE_DOWNLOAD_SHEET_CAP = 2
/** d6 (02/11) : borne TECHNIQUE (pas commerciale) de la somme des `count` des
 * formats d'un job, tous paliers, démo comprise — 400 `too_many_sheets`. */
export const MAX_SHEETS_PER_JOB = 1000
