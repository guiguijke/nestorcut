<template>
    <header class="header">
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
        </component>
        <!-- U1 : lien « Espace de travail » en texte simple — plus de
             pilule centrée, l'en-tête tient sur une ligne à 56 px. -->
        <nav v-if="isPrimaryTheme" class="header__tabs tabs">
            <NuxtLink to="/home" class="tabs__text" active-class="tabs__text--active">
                {{ t('nav.workspace') }}
            </NuxtLink>
            <NuxtLink
                v-if="isStripFeatureEnabled"
                to="/strip"
                class="tabs__text"
                active-class="tabs__text--active"
            >
                {{ t('nav.strip') }}
            </NuxtLink>
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
                    class="nav__item"
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
                class="header__btn"
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

    const { githubIssues } = useSiteConfig()

    const { t } = useLocale()

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
    const nav = computed(() => [
        {
            label: t('nav.features'),
            href: 'https://nestorcut.com/#features',
        },
        {
            label: t('nav.howItWorks'),
            href: 'https://nestorcut.com/#how-it-works',
        },
        {
            label: t('nav.pricing'),
            href: '/plans',
        },
        {
            label: t('nav.faq'),
            href: 'https://nestorcut.com/#faq',
        },
        {
            label: t('nav.changelog'),
            href: '/changelog',
        },
    ])

    const { getters: authGetters } = authStore
    // The strip tab requires BOTH the global kill-switch
    // (NUXT_PUBLIC_STRIP_ENABLED) and the per-user feature flag.
    const isStripFeatureEnabled = computed(() => {
        const stripGloballyEnabled = useRuntimeConfig().public.stripEnabled === true
        return stripGloballyEnabled && Boolean(unref(authGetters.user)?.isStripFeatureEnable)
    })
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
    const isStripPage = computed(() => {
        return route.path === '/strip' || route.path.startsWith('/strip/')
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

    // Brand mark: the NestorCut "N" tile works on both light and dark themes.
    const logoMarkSrc = computed(() => '/brand/n-mark.png')
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
            flex-wrap: wrap;
            align-items: center;

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
            z-index: 1;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            transform: translate3d(120%, 0, 0);
            transition: transform 0.3s;

            @media (min-width: 1199px) {
                position: initial;
                top: initial;
                left: initial;
                right: initial;
                bottom: initial;
                transform: initial;
            }

            &--is-open {
                transform: translate3d(0, 0, 0);

                @media (min-width: 1199px) {
                    transform: initial;
                }
            }
        }

        &__toggler {
            @media (min-width: 1199px) {
                display: none;
            }
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
        }
    }

    .tabs {
        display: flex;
        align-items: center;
        gap: 8px;
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
        }
    }

    .logo {
        display: flex;
        align-items: center;
        gap: 10px;

        &__mark {
            height: 42px;
            width: auto;
            object-fit: contain;
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
        padding-top: 80px;

        @media (min-width: 1199px) {
            padding-top: initial;
        }

        &__list {
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;

            @media (min-width: 1199px) {
                position: initial;
                z-index: initial;
                justify-content: initial;
                flex-direction: initial;
            }
        }

        &__item {
            width: 100%;

            @media (min-width: 1199px) {
                margin-left: 5px;
                margin-right: 5px;
                width: initial;
            }

            &:not(:last-child) {
                margin-bottom: 20px;

                @media (min-width: 1199px) {
                    margin-bottom: initial;
                }
            }
        }

        &__link {
            text-align: center;
            border-radius: var(--radius);
            padding: 6px 12px;
            display: block;
            font-size: var(--fs-18);
            color: var(--main-white);
            transition:
                color 0.3s,
                background-color 0.3s;

            @media (min-width: 1199px) {
                font-size: var(--fs-12);
                color: var(--label-secondary);
                background-color: var(--fill-tertiary);
            }

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

            @media (min-width: 1199px) {
                display: none;
            }
        }
    }
</style>
