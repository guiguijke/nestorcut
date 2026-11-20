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
const RETRY = { en: /try again/i, fr: /réessayer/i, de: /erneut/i, es: /reintentarlo/i, it: /riprovare/i, pt: /tentar novamente/i }
const SUPPORT = { en: /contact support/i, fr: /contactez le support/i, de: /an den Support/i, es: /contacta con soporte/i, it: /contatta il supporto/i, pt: /fale com o suporte/i }
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
                // Une action concrète, pas seulement un constat : réessayer ET
                // joindre le support, dans la langue du dictionnaire.
                expect(dict[key], `${name}:${key} (réessayer)`).toMatch(RETRY[name])
                expect(dict[key], `${name}:${key} (support)`).toMatch(SUPPORT[name])
            }
        }
    })
})

describe('J5 : « toutes les options rejetées » est vrai pour les trois raisons', () => {
    // chevauchement mesuré, pièce hors du contour, pièce sur une zone interdite
    const OUTSIDE = { en: /outside the outline/i, fr: /hors du contour/i, de: /außerhalb der Kontur/i, es: /fuera del contorno/i, it: /fuori dal contorno/i, pt: /fora do contorno/i }
    const ZONE = { en: /forbidden zone/i, fr: /zone interdite/i, de: /Sperrzone/i, es: /zona prohibida/i, it: /zona vietata/i, pt: /zona proibida/i }
    it('les deux clés nomment le contour et la zone, dans les 6 langues', () => {
        for (const [name, dict] of Object.entries(DICTS)) {
            for (const key of ['localMode.allInvalid', 'localMode.allInvalidLocal']) {
                expect(dict[key], `${name}:${key} (contour)`).toMatch(OUTSIDE[name])
                expect(dict[key], `${name}:${key} (zone)`).toMatch(ZONE[name])
            }
        }
    })
})
