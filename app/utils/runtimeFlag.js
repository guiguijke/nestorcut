/** AGENTS #29 : un override runtime NUXT_PUBLIC_* arrive en CHAÎNE ('true'),
 * jamais en booléen. */
export function flagOn(value) {
    return value === true || value === 'true'
}
