// Lot D5 (docs/PLAN-DOCUMENTATION-2026-09-15.md §3) — les liens « ? »
// depuis l'application vers la documentation, à l'ANCRE EXACTE, dans la
// langue de l'utilisateur, repli anglais.
//
// Écrit pour SIX codes de langue (L0, plan des langues) : DOCS_LANGS
// liste les langues PUBLIÉES du site de documentation — ajouter « pt »,
// « it », « de », « es » y suffira le jour de leur publication ; tout
// code non publié replie sur l'anglais, jamais sur une page absente.
//
// Les ancres sont DÉPENDANTES DE LA LANGUE (Starlight reprend les titres
// traduits : « L'espacement » → #lespacement) : chaque sujet porte donc
// son ancre par langue, relevée dans le HTML PUBLIÉ.

export const DOCS_SITE = 'https://nestorcut.com'

/** Langues de documentation publiées. L'anglais est le repli. */
export const DOCS_LANGS = ['en', 'fr']

/** Sujets d'aide : page + ancre par langue publiée. */
export const HELP_TOPICS = {
    sheets: { page: 'interface/', anchor: { en: 'the-sheets', fr: 'les-tôles' } },
    spacing: { page: 'nesting/spacing/', anchor: { en: 'spacing', fr: 'lespacement' } },
    rotations: { page: 'nesting/spacing/', anchor: { en: 'rotations', fr: 'les-rotations' } },
    directions: { page: 'nesting/directions/', anchor: { en: 'the-three-directions', fr: 'les-trois-sens' } },
    holes: { page: 'nesting/directions/', anchor: { en: 'parts-inside-holes', fr: 'les-pièces-dans-les-trous' } },
    badges: { page: 'nesting/', anchor: { en: 'what-the-badges-guarantee', fr: 'ce-que-garantissent-les-badges' } },
    offcut: { page: 'results/', anchor: { en: 'the-reusable-offcut--and-at-least', fr: 'la-chute-réutilisable--et--au-moins' } },
    alternatives: { page: 'results/', anchor: { en: 'the-alternatives', fr: 'les-alternatives' } },
    downloads: { page: 'results/exports/', anchor: { en: 'what-downloads', fr: 'ce-qui-se-télécharge' } },
}

/** L'URL de documentation d'un sujet, dans la langue (repli anglais). */
export function docsHelpUrl(locale, topic) {
    const t = HELP_TOPICS[topic]
    if (!t) return null
    const lang = DOCS_LANGS.includes(locale) ? locale : 'en'
    const prefix = lang === 'en' ? '/docs/' : `/${lang}/docs/`
    return `${DOCS_SITE}${prefix}${t.page}#${t.anchor[lang]}`
}
