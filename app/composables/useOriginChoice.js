/**
 * Zéro des fichiers livrés : choix partagé par la fenêtre de résultat et la
 * carte de résultat (même état, retenu par navigateur — voir utils/originChoice).
 */
import { ref } from 'vue'
import { readOrigin, writeOrigin } from '~/utils/originChoice'

const choice = ref('corner')
let loaded = false

export function useOriginChoice() {
    // Lu une fois, côté navigateur seulement (rien au rendu serveur).
    if (!loaded && typeof window !== 'undefined') {
        loaded = true
        try {
            choice.value = readOrigin(window.localStorage)
        } catch {
            choice.value = 'corner'
        }
    }
    const setOrigin = (value) => {
        choice.value = value === 'center' ? 'center' : 'corner'
        try {
            writeOrigin(window.localStorage, choice.value)
        } catch {
            // stockage indisponible : le choix vaut pour la session
        }
    }
    return { origin: choice, setOrigin }
}
