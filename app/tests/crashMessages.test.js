/**
 * Lot A : les messages d'arrêt inattendu ne conseillent plus « une tâche plus
 * petite » à tort.
 *
 * Les plantages de petits jobs (2 pièces de 40×40 mm, réglages d'usine)
 * recevaient « réessayez avec une tâche plus petite » : un conseil invérifiable
 * et absurde pour un job de deux pièces. Un message d'arrêt dont la cause est
 * INCONNUE dit ce qui s'est passé et ce qu'on peut tenter — il ne prétend pas
 * connaître la cause. Les messages de MÉMOIRE (non couverts ici) gardent leur
 * conseil de taille : elle y est la cause mesurée.
 */
import { describe, it, expect } from 'vitest'
import en from '../utils/i18n/en'
import fr from '../utils/i18n/fr'
import de from '../utils/i18n/de'
import es from '../utils/i18n/es'
import it_ from '../utils/i18n/it'
import pt from '../utils/i18n/pt'

const DICTS = { en, fr, de, es, it: it_, pt }
// « job / tâche / trabalho… plus petit » dans les 6 langues.
const SMALLER = /smaller|plus petit|kleiner|más pequeño|più piccolo|\bmenor\b/i
const UNKNOWN_CAUSE_KEYS = ['localMode.crashLocal', 'localMode.crashError', 'localMode.allInvalidLocal']

describe('messages d’arrêt à cause inconnue', () => {
    it('aucun ne conseille un job plus petit', () => {
        for (const [name, dict] of Object.entries(DICTS)) {
            for (const key of UNKNOWN_CAUSE_KEYS) {
                expect(dict[key], `${name}:${key}`).toBeTruthy()
                expect(dict[key], `${name}:${key}`).not.toMatch(SMALLER)
            }
        }
    })

    it('ils annoncent le remboursement et proposent d’agir (réessayer, support)', () => {
        const refund = { en: /refunded/i, fr: /rembours/i, de: /erstattet/i, es: /reembols/i, it: /rimbors/i, pt: /reembols/i }
        for (const [name, dict] of Object.entries(DICTS)) {
            for (const key of ['localMode.crashLocal', 'localMode.crashError']) {
                expect(dict[key], `${name}:${key}`).toMatch(refund[name])
                // Une action concrète, pas seulement un constat.
                expect(dict[key].length, `${name}:${key}`).toBeGreaterThan(120)
            }
        }
    })
})
