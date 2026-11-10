/**
 * Heure relative d'un projet ou d'un résultat : la clé de traduction et
 * le nombre à afficher, pour une durée écoulée en minutes entières.
 * Fonction pure — les composants appellent `t(key, { n })`.
 *
 * Le singulier a sa propre clé (« 1 hour ago », « il y a 1 h ») : la clé
 * plurielle ne doit jamais rendre « 1 hours ».
 */
export function relativeTimeParts(diffMinutes) {
    const minutes = Math.floor(Number(diffMinutes) || 0)
    if (minutes < 1) return { key: 'time.justNow', n: 0 }
    if (minutes < 60) return { key: 'time.minAgo', n: minutes }
    const hours = Math.floor(minutes / 60)
    if (hours < 24) {
        return hours === 1
            ? { key: 'time.hourAgo', n: 1 }
            : { key: 'time.hoursAgo', n: hours }
    }
    const days = Math.floor(minutes / 1440)
    return days === 1
        ? { key: 'time.dayAgo', n: 1 }
        : { key: 'time.daysAgo', n: days }
}
