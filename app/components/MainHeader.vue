<template>
    <header
        ref="headerRoot"
        class="header"
        :class="'header--lang-' + locale"
    >
        <component
            :is="logoTag"
            v-bind="logoHref"
            class="header__logo logo"
        >
            <img
                :src="logoMarkSrc"
                alt=""
                aria-hidden="true"
                class="logo__mark"
            />
            <span class="logo__label"> Nestor<span class="logo__label--light">Cut</span> </span>
            <!-- Lot J11-b : la version PRODUIT à côté du titre —
                 MAJEUR.MINEUR seulement (V0.9), discret. Le numéro complet
                 vit au pied de page et dans le journal. -->
            <span class="logo__version" data-testid="header-version">V{{ majorMinor }}</span>
        </component>
        <!-- U1 : lien « Espace de travail » en texte simple — plus de
             pilule centrée, l'en-tête tient sur une ligne à 56 px. -->
        <nav v-if="isPrimaryTheme" class="header__tabs tabs">
            <NuxtLink to="/home" class="tabs__text" active-class="tabs__text--active">
                {{ t('nav.workspace') }}
            </NuxtLink>
            <!-- Lot M3 : la documentation reste accessible une fois connecté —
                 un lien texte à côté d'« Espace de travail », même style. -->
            <a
                :href="docsHomeLink"
                target="_blank"
                class="tabs__text tabs__text--docs"
            >
                {{ t('nav.docs') }}
            </a>
        </nav>
        <!-- Lot M3-bis : replié, la Documentation reste VISIBLE dans la
             barre (même style que l'en-tête connecté). M3-ter : l'élément
             vit toujours dans le DOM — c'est le CSS qui choisit l'état
             (replié par défaut, déplié au seuil de la langue), pour que le
             premier affichage, sans JavaScript, soit le bon. -->
        <nav
            v-if="isSecondaryTheme"
            class="header__tabs tabs tabs--collapsed-docs"
        >
            <a
                :href="docsHomeLink"
                target="_blank"
                class="tabs__text tabs__text--docs"
            >
                {{ t('nav.docs') }}
            </a>
        </nav>
        <nav
            v-if="isSecondaryTheme"
            :class="navClasses"
            class="header__nav nav"
        >
            <ul class="nav__list">
                <li
                    v-for="(navItem, navIndex) in nav"
                    :key="navIndex"
                    @click="toggleMenu"
                    :class="['nav__item', navItem.cls]"
                >
                    <NuxtLink
                        :to="navItem.href"
                        class="nav__link"
                    >
                        {{ navItem.label }}
                    </NuxtLink>
                </li>
            </ul>
            <div
                @click="toggleMenu"
                class="nav__background"
            />
        </nav>
        <div
            :class="{ 'header__wrapper--is-primary': isPrimaryTheme }"
            class="header__wrapper"
        >
            <!-- U1 : trois boutons FANTÔMES de même poids — unités,
                 langue, thème (plus de carré bleu plein pour le thème). -->
            <UiButton
                variant="ghost"
                size="s"
                :icon="themeIconName"
                :aria-label="t('nav.toggleTheme')"
                tracking-tag="toggle_theme"
                @click="updateTheme"
            />
            <UnitSwitcher class="header__btn" />
            <LocaleSwitcher class="header__btn" />
            <VaultMenuButton
                v-if="isPrimaryTheme"
                class="header__btn"
            />
            <!-- Chantier B : bouton Turbo (flag dev NUXT_PUBLIC_TURBO_ENABLED,
                 composant inerte sinon) — à côté du vault dans le header. -->
            <TurboMenuButton
                v-if="isPrimaryTheme"
                class="header__btn"
            />
            <MainButton
                :href="githubIssues"
                target="_blank"
                :label="t('nav.reportProblem')"
                tag="a"
                trackingTag="report_problem"
                class="header__btn header__btn--report"
                v-if="isSecondaryTheme"
            />
            <MainButton
                v-if="isSecondaryTheme && userIsLoggedIn"
                :theme="themeType.primary"
                :label="t('nav.openWorkspace')"
                trackingTag="open_workspace"
                @click="openWorkspace"
                class="header__btn"
            />
            <MainButton
                v-if="isSecondaryTheme && !userIsLoggedIn"
                :theme="themeType.primary"
                @click="onLoginClick"
                :label="t('nav.login')"
                class="header__btn header__btn--login"
            />
            <LoginView />
            <Avatar
                v-if="isPrimaryTheme || userIsLoggedIn"
                :size="sizeType.s"
                class="header__avatar"
            />
            <div
                v-if="isSecondaryTheme"
                class="header__toggler"
            >
                <MainButton
                    :theme="themeType.secondary"
                    :icon="iconType.menu"
                    :isLabelShow="false"
                    trackingTag="menu_toggle"
                    @click="toggleMenu"
                    :label="t('nav.menu')"
                />
            </div>
        </div>
    </header>
</template>
<script setup>
    import { NuxtLink } from '#components'
    import { defaultThemeType, themeType } from '~~/constants/theme.constants'
    import { iconType } from '~~/constants/icon.constants'
    import { sizeType } from '~~/constants/size.constants'
    import { trackEvent } from '~/utils/track'
    import { useSiteConfig } from '~~/data/siteConfig'
    import { siteUrl, docsHomeUrl } from '~/utils/docsLinks'

    const { githubIssues } = useSiteConfig()

    const { t, locale } = useLocale()
// Lot J11-b : version produit de package.json (runtimeConfig).
const appVersion = String(useRuntimeConfig().public.appVersion || '')
const majorMinor = appVersion.split('.').slice(0, 2).join('.')

    const loginDialog = useLoginDialog()

    async function onLoginClick() {
        trackEvent('click_login', { page: 'main_header' })
        loginDialog.value = true
    }

    function openWorkspace() {
        trackEvent('click_open_workspace', { page: 'main_header' })
        navigateTo('/home')
    }

    const { theme } = defineProps({
        theme: {
            type: String,
            default: defaultThemeType,
        },
    })

    const route = useRoute()

    const menuIsOpen = ref(false)
    // Lot M3-ter : le repli est décidé au PREMIER AFFICHAGE par le seuil
    // CSS de la langue (seuils mesurés, carte $nav-inflow-at dans le
    // style) — le serveur rend la classe de langue, aucune mesure
    // n'attend JavaScript. Cette fonction reste le FILET : si la réalité
    // déborde (fonte, zoom), elle pose la classe de repli directement sur
    // l'élément — pas d'état Vue, tout se joue avant le rendu, zéro saut.
    const headerRoot = ref(null)
    let recheckTimer = null

    function applyNavFit() {
        const el = headerRoot.value
        if (!el) return
        if (window.innerWidth < 567) {
            el.classList.add('header--nav-collapsed')
            return
        }
        // Mesure en état déplié : tout se passe dans UNE tâche synchrone,
        // le navigateur ne peint que l'état final.
        el.classList.remove('header--nav-collapsed')
        el.classList.toggle('header--nav-collapsed', el.scrollWidth > el.clientWidth + 1)
    }

    function scheduleRecheckNavFit() {
        clearTimeout(recheckTimer)
        recheckTimer = setTimeout(applyNavFit, 120)
    }

    // Ajout M3-ter : Échap referme le panneau ouvert.
    function onKeydown(e) {
        if (e.key === 'Escape' && menuIsOpen.value) menuIsOpen.value = false
    }

    // Lot M3 : les liens du site VITRINE dans la LANGUE de l'utilisateur
    // (siteUrl dans docsLinks.js — anglais à la racine, cinq autres sous
    // préfixe). M3-ter : la liste porte les DEUX états — Documentation et
    // signalement y vivent en permanence, le CSS affiche l'un ou l'autre
    // (replié : Documentation dans la barre, signalement dans le panneau ;
    // déplié : l'inverse). Le DOM ne change jamais d'état : pas de saut.
    const nav = computed(() => [
        {
            label: t('nav.features'),
            href: siteUrl(locale.value, 'features'),
        },
        {
            label: t('nav.howItWorks'),
            href: siteUrl(locale.value, 'how-it-works'),
        },
        {
            label: t('nav.pricing'),
            href: '/plans',
        },
        {
            label: t('nav.faq'),
            href: siteUrl(locale.value, 'faq'),
        },
        {
            label: t('nav.docs'),
            href: docsHomeUrl(locale.value),
            cls: 'nav__item--docs',
        },
        {
            label: t('nav.changelog'),
            href: '/changelog',
        },
        {
            label: t('nav.reportProblem'),
            href: githubIssues,
            cls: 'nav__item--report',
        },
    ])

    const { getters: authGetters } = authStore
    const userIsLoggedIn = computed(() => Boolean(unref(authGetters.userIsSet)))

    const isPrimaryTheme = computed(() => {
        return unref(theme) === themeType.primary
    })
    const isSecondaryTheme = computed(() => {
        return unref(theme) === themeType.secondary
    })
    const isHomePage = computed(() => {
        return route.path === '/home' || route.path === '/'
    })
    // The logo is always a link back to a meaningful home: the tool's workspace
    // when already inside the app (primary theme), the marketing landing
    // otherwise. Previously it was a non-clickable <div> on the landing and on
    // /home, which stranded the user.
    const logoTag = computed(() => NuxtLink)
    const logoHref = computed(() => {
        const hrefValue = unref(isPrimaryTheme) ? '/home' : '/'
        return { to: hrefValue }
    })
    const navClasses = computed(() => ({
        'nav--is-open': unref(menuIsOpen),
        'header__nav--is-open': unref(menuIsOpen),
    }))
    const toggleMenu = () => {
        menuIsOpen.value = !unref(menuIsOpen)
    }

    const { actions } = themeStore
    const { updateTheme } = actions

    const themeCookie = useCookie('theme')
    const themeGlobal = computed(() => {
        return themeCookie.value || defaultThemeType
    })
    const themeIconName = computed(() => {
        // sombre actif → soleil (action : passer en clair)
        return unref(theme) === themeType.primary ? 'sun' : 'moon'
    })

    // Lot M3 : le lien Documentation dans la langue de l'utilisateur.
    const docsHomeLink = computed(() => docsHomeUrl(locale.value))
    // Brand mark: the NestorCut "N" tile works on both light and dark themes.
    const logoMarkSrc = computed(() => '/brand/n-mark.png')

    onMounted(() => {
        applyNavFit()
        window.addEventListener('resize', scheduleRecheckNavFit)
        window.addEventListener('keydown', onKeydown)
        // Les libellés changent de largeur avec la langue et avec la
        // fonte définitive : re-mesurer dans les deux cas.
        watch(locale, applyNavFit)
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyNavFit)
    })

    onBeforeUnmount(() => {
        window.removeEventListener('resize', scheduleRecheckNavFit)
        window.removeEventListener('keydown', onKeydown)
        clearTimeout(recheckTimer)
    })
</script>
<style lang="scss" scoped>
    .header {
        position: relative;
        display: flex;
        justify-content: space-between;
        /* U1 : 56 px (plan) sur les écrans assez larges pour la ligne
           unique ; mobile garde le colonnage historique. */
        padding: 8px 16px;
        min-height: 56px;
        align-items: center;
        flex-direction: column;

        @media (min-width: 567px) {
            flex-direction: row;
            align-items: center;
            /* U1 : une ligne à 56 px (le padding du bloc fait la hauteur
               avec les boutons fantômes à 30 px). */
            padding: 0 var(--sp-4);
            min-height: 56px;
        }

        &__wrapper {
            margin-top: 16px;
            display: flex;
            justify-content: flex-end;
            /* Lot M3-bis : pas de wrap — quand la place manque, le nav
               replié prend le relais et « Signaler un problème » déménage
               dans le panneau. */
            flex-wrap: nowrap;
            align-items: center;

            /* Lot M3-bis, filet 567-679 : avec les libellés les plus
               longs, les boutons passent à la ligne plutôt que de
               sortir de l'écran — repli dégradé, jamais de débordement. */
            @media (min-width: 567px) and (max-width: 679px) {
                flex-wrap: wrap;
            }

            & > *:not(:first-child) {
                margin: 4px;

                @media (min-width: 567px) {
                    margin: 0 0 0 16px;
                }
            }

            @media (min-width: 567px) {
                flex-direction: initial;
                margin-top: initial;
            }

            &--is-primary {
                flex-direction: row-reverse;
                justify-content: space-between;

                @media (min-width: 567px) {
                    flex-direction: initial;
                }
            }
        }

        &__theme {
            @media (min-width: 567px) {
                margin-bottom: initial;
            }
        }

        &__avatar {
            position: absolute;
            top: 8px;
            right: 4px;

            @media (min-width: 567px) {
                position: initial;
                top: initial;
                right: initial;
            }
        }

        &__nav {
            /* Base = panneau replié (plein écran, coulissé hors écran).
               L'état « en place » suit le seuil CSS DE LA LANGUE (bloc
               $nav-inflow-at en fin de style) — voir le lot M3-ter. */
            z-index: 1;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            transform: translate3d(120%, 0, 0);
            transition: transform 0.3s;

            &--is-open {
                transform: translate3d(0, 0, 0);
            }
        }

        &__toggler {
            /* M3-ter : AU-DESSUS du panneau ouvert — l'utilisateur qui
               ouvre par ☰ doit pouvoir refermer par ☰, le fond ne le
               recouvre pas. */
            position: relative;
            z-index: 2;
        }

        &__btn {
            &--login {
                position: absolute;
                top: 8px;
                right: 4px;

                @media (min-width: 567px) {
                    position: initial;
                    top: initial;
                    right: initial;
                }
            }

            /* M3-ter : replié, le signalement vit dans le PANNEAU — le
               bouton ne revient dans la barre qu'à l'état « en place »
               (sélecteur .header .header__wrapper pour gagner sur le
               display:flex du MainButton quel que soit l'ordre du CSS). */
            &--report {
                .header .header__wrapper & {
                    display: none;
                }
            }
        }
    }

    .tabs {
        display: flex;
        align-items: center;
        /* Lot M3-bis : le même écart qu'entre les liens du menu
           déconnecté (marges 5+5 + padding 8+8 = 26 px) — à 8 px,
           « Espace de travail » et « Documentation » se lisaient d'un
           seul tenant. */
        gap: 26px;
        margin-top: 16px;

        @media (min-width: 567px) {
            margin-top: initial;
            /* U1 passe 2 (retouche 3) : collé à la marque — le lien part à
               GAUCHE, plus de pilule centrée entre marque et actions. */
            margin-left: var(--sp-4);
            margin-right: auto;
        }

        /* U1 : lien texte — l'active garde l'accent sur la COULEUR du
             texte (l'aplat bleu est réservé aux actions primaires). */
        &__text {
            font-size: var(--fs-14);
            font-weight: 600;
            color: var(--text-2);
            text-decoration: none;
            transition: color 0.15s;

            @media (hover: hover) {
                &:hover { color: var(--accent); }
            }

            &--active {
                color: var(--accent);
                font-weight: 700;
            }

            &--docs {
                color: var(--text-2);
            }
        }

        /* Lot M3-bis : le lien Documentation de la barre repliée n'existe
           qu'à partir de la rangée unique — en dessous, il vit dans le
           panneau comme sur mobile. */
        &--collapsed-docs {
            @media (max-width: 566.98px) {
                display: none;
            }
        }
    }

    .logo {
        display: flex;
        align-items: center;
        gap: 10px;
        /* Lot M3 : le logo ne se comprime jamais — le nav fait le déplacement. */
        flex-shrink: 0;

        &__mark {
            height: 42px;
            width: auto;
            object-fit: contain;
        }

                    // Lot J11-b : la version d'en-tête, discrète mais lisible sur les
            // deux thèmes (piège #21).
            &__version {
                margin-left: 6px;
                font-size: var(--fs-12, 12px);
                font-weight: 500;
                color: var(--label-tertiary);
                letter-spacing: 0.02em;
                /* Lot M3 : un vrai écart entre la version et le premier lien du menu. */
                margin-right: 16px;
            }

&__label {
            display: block;
            font-size: var(--fs-22);
            font-weight: 700;
            color: var(--accent-primary);
            white-space: nowrap;

            &--light {
                font-weight: 400;
                color: var(--label-secondary);
            }
        }
    }

    .nav {
        /* Base = panneau replié. L'état « en place » suit le seuil CSS de
           la langue ($nav-inflow-at, fin de style) — lot M3-ter. */
        padding-top: 80px;

        &__list {
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
        }

        &__item {
            width: 100%;

            &:not(:last-child) {
                margin-bottom: 20px;
            }

            /* M3-ter : la Documentation vit dans le PANNEAU à l'état
               replié — dans la barre, c'est le lien tabs--collapsed-docs
               qui la porte. L'item n'apparaît qu'à l'état « en place ». */
            &--docs {
                display: none;
            }
        }

        &__link {
                /* Lot M3 : chaque libellé du menu sur UNE ligne — jamais de retour à la ligne. */
                white-space: nowrap;
            text-align: center;
            border-radius: var(--radius);
            /* Lot M3 : 14px + padding réduit — six liens tiennent dans
               l'en-tête à 1280px sans chevaucher la version ni faire
               passer les boutons à la ligne. */
            padding: 4px 8px;
            display: block;
            font-size: var(--fs-14);
            color: var(--main-white);
            transition:
                color 0.3s,
                background-color 0.3s;

            @media (hover: hover) {
                &:hover {
                    color: var(--accent-primary);
                    background-color: var(--fill-secondary);
                }
            }
        }

        &__background {
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            left: 0;
            background-color: var(--menu-background);
        }
    }

    /* ==================================================================
       Lot M3-ter : l'état « en place » (menu déplié dans la barre).
       Déclencheur = seuil CSS PAR LANGUE : le serveur pose la classe
       header--lang-<locale> (il connaît la langue), et les seuils sont
       les largeurs mesurées du menu complet + 8 px. Le premier affichage
       — sans JavaScript comme avant hydratation — est ainsi le bon dans
       chaque langue. La classe header--nav-collapsed (posée par la
       mesure JavaScript, applyNavFit) reste le FILET : elle replie si la
       réalité déborde (fonte différente, zoom). :where garde la
       spécificité du base pour que :hover gagne toujours ; les bascules
       de visibilité (signalement, Documentation) utilisent un sélecteur
       plein, elles n'ont pas de :hover à préserver.
       Seuils = largeur NATURELLE mesurée du menu déplié (padding +
       logo+version + nav + actions) + 8 px, par langue :
       en 1288, it 1333, pt 1372, de 1399, es 1436, fr 1446.
       ================================================================== */
    $nav-inflow-at: (
        en: 1296px,
        fr: 1454px,
        pt: 1380px,
        it: 1341px,
        de: 1407px,
        es: 1444px,
    );

    @each $lang, $min in $nav-inflow-at {
        @media (min-width: $min) {
            :where(.header--lang-#{$lang}:not(.header--nav-collapsed)) {
                & .header__nav {
                    position: initial;
                    top: initial;
                    left: initial;
                    right: initial;
                    bottom: initial;
                    transform: initial;
                }
                & .header__toggler {
                    display: none;
                }
                & .tabs--collapsed-docs {
                    display: none;
                }
                & .nav {
                    padding-top: initial;
                }
                & .nav__list {
                    position: initial;
                    z-index: initial;
                    justify-content: initial;
                    flex-direction: initial;
                }
                & .nav__item {
                    margin-left: 5px;
                    margin-right: 5px;
                    width: initial;
                }
                & .nav__item:not(:last-child) {
                    margin-bottom: initial;
                }
                & .nav__item--docs {
                    display: list-item;
                }
                & .nav__item--report {
                    display: none;
                }
                & .nav__link {
                    font-size: var(--fs-12);
                    color: var(--label-secondary);
                    background-color: var(--fill-tertiary);
                }
                & .nav__background {
                    display: none;
                }
            }

            /* Le signalement revient dans la barre : sélecteur PLEIN
               (0,4,0) — la base le cache avec .header .header__wrapper
               (0,3,0) pour gagner sur le display:flex du MainButton
               quel que soit l'ordre du CSS bundlé ; il faut la battre. */
            .header--lang-#{$lang}:not(.header--nav-collapsed) .header__wrapper .header__btn--report {
                display: flex;
            }
        }
    }
</style>
