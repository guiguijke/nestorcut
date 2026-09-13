<template>
    <div class="home">
        <!-- 3.1.5 : bannière e-mail non vérifié (comptes locaux). -->
        <VerifyEmailBanner />
        <!-- C1-c : carte de re-demande newsletter (90 jours, discrète). -->
        <NewsletterCard />
        <!-- Account summary -->
        <!-- U1 : accueil sobre — h1 Poppins, plus d'avatar géant ni
             d'emoji ; le lien de compte reste en discret. -->
        <section class="home__welcome welcome">
            <div class="welcome__body">
                <h1 class="welcome__title">{{ greeting }}, {{ userName }}</h1>
                <p class="welcome__text">
                    <NuxtLink
                        to="/profile"
                        class="welcome__link"
                    >
                        {{ t('home.manageAccount') }}
                    </NuxtLink>
                </p>
            </div>
        </section>

        <!-- Activity stats -->
        <UserStats class="home__stats" />

        <!-- New nesting: the original DXF upload, kept verbatim -->
        <section class="home__create create">
            <MainTitle
                :label="t('home.newNesting')"
                class="create__title"
            />
            <PrivacyModePicker
                v-if="localImportEnabled"
                v-model="privacyChoice"
                class="create__privacy"
            />
            <!-- Lot E3 : l'interrupteur « Import avancé », à la CRÉATION du
                 projet, entre les cartes de mode et la zone de dépôt — à
                 l'endroit demandé par le propriétaire. Éteint par défaut ; son
                 état part avec la création et devient une propriété du projet.
                 Il vaut pour les DEUX modes : côté « cet appareil » la fenêtre
                 de choix s'ouvre à chaque dépôt, côté « nos serveurs » ce sont
                 les mêmes options, appliquées par le worker (lot E2). -->
            <AdvancedImportSwitch
                v-model="advancedImport"
                class="create__advanced"
            />
            <DxfUpload
                :class="{ 'create__drop--advanced': advancedImport }"
                :extensions="uploadExtensions"
                @files="handleSubmit"
                @rejected="handleRejected"
                @oversize="error = t('upload.tooLarge')"
            />
            <div
                v-if="error"
                class="create__error"
            >
                {{ error }}
            </div>
        </section>

        <!-- U1 passe 2 (retouche 4) : la section « Projets récents »
             disparaît — la colonne de gauche liste déjà les mêmes projets,
             une seule liste. -->

        <NewsletterPrompt />
    </div>
</template>

<script setup>
    import { sizeType } from '~~/constants/size.constants'

    const { t } = useLocale()

    definePageMeta({
        layout: 'auth',
        middleware: 'auth',
    })

    const router = useRouter()

    onMounted(async () => {
        trackEvent('page_view', { page: 'dashboard' })
        const route = useRoute()

        const subscriptionInternalId = route.query.subscriptionInternalId
        if (subscriptionInternalId) {
            try {
                await $fetch('/api/payment/subscription/check?subscriptionInternalId=' + subscriptionInternalId, {
                    method: 'POST',
                })
                // Refresh the cached user so freeRemaining / subscriptionStatus update.
                await setUser()
            } catch (err) {
                console.error('Subscription confirmation failed:', err)
            }
            // Drop the query param so a refresh doesn't re-trigger the check.
            router.replace({ path: '/home' })
        }
    })

    const { getters: authGetters, actions: authActions } = authStore
    const { setUser } = authActions
    const { user } = authGetters

    const userName = computed(() => unref(user)?.name || '')

    // Time-of-day greeting — small touch that makes the dashboard feel personal.
    const greeting = computed(() => {
        const h = new Date().getHours()
        if (h < 6) return t('home.greeting.night')
        if (h < 12) return t('home.greeting.morning')
        if (h < 18) return t('home.greeting.afternoon')
        return t('home.greeting.evening')
    })

    const { actions: filesActions } = filesStore
    const { getProject } = filesActions

    const error = ref('')

    // J-090 : la création 100 % privée n'apparaît que si l'import navigateur
    // est activé (ET le compute local — le solve tourne aussi sur l'appareil).
    const config = useRuntimeConfig()
    const localImportEnabled = computed(() =>
        (config.public.localComputeEnabled === true || config.public.localComputeEnabled === 'true') &&
        (config.public.localImportEnabled === true || config.public.localImportEnabled === 'true')
    )
    // Défaut = cet appareil dès que l'import navigateur est dispo (opt-out
    // cloud : DWG, multi-appareils).
    const privacyChoice = ref(localImportEnabled.value ? 'device' : 'cloud')
    // Lot E3 : l'interrupteur de la création. Éteint par défaut ; il voyage
    // dans le corps du POST et devient le champ `advancedImport` du projet.
    const advancedImport = ref(false)
    const localProject = computed(() => privacyChoice.value === 'device')
    watch(privacyChoice, () => { error.value = '' })
    // La page d'accueil porte SA PROPRE liste : c'est elle qui filtre la
    // toute première dépose, celle qui CRÉE le projet. Lot J4 : sans `.job`
    // ici, un `.job` déposé à la création était écarté par la dropzone, en
    // silence — les DXF partaient seuls et le nesting se faisait sans les
    // réserves d'amorce. Défaut trouvé par le harnais navigateur, qu'aucun
    // test unitaire ne pouvait voir. Garder cette liste alignée sur celle de
    // `ProjectFiles.vue`. La liste ne sert qu'au filtre du sélecteur de
    // fichiers : la vérité du format reste la SIGNATURE (piège #31).
    const uploadExtensions = computed(() =>
        localProject.value && localImportEnabled.value
            ? ['.dxf', '.svg', '.job']
            : ['.dxf', '.svg', '.dwg']
    )

    const handleRejected = (files) => {
        const names = (files || []).map((f) => String(f.name || '').toLowerCase())
        if (names.some((n) => n.endsWith('.dwg')) && localProject.value) {
            error.value = t('localImport.dwgRejected')
            return
        }
        error.value = localProject.value
            ? t('localImport.unsupportedType')
            : t('upload.unsupported')
    }

    const handleSubmit = async (files) => {
        error.value = ''
        if (!files?.length) return

        if (localProject.value && localImportEnabled.value) {
            // J-090 : création JSON sans fichiers — l'import navigateur des
            // fichiers déposés se fait sur la page projet (IndexedDB).
            try {
                const data = await $fetch(API_ROUTES.PROJECT(), {
                    method: 'POST',
                    body: { local: true, advancedImport: advancedImport.value },
                })
                filesActions.setPendingLocalFiles(files)
                await getProjects()
                router.push({ path: `/project/${data.slug}` })
            } catch (err) {
                if (err.response) {
                    const errorData = await err.response.json()
                    error.value = errorData.message
                } else {
                    error.value = t('home.error.unexpected')
                }
            }
            return
        }

        const formData = new FormData()
        files.forEach((file) => formData.append('dxf', file))


        try {
            const data = await $fetch(API_ROUTES.PROJECT(), {
                method: 'POST',
                body: formData,
            })

            // Lot E3 : l'interrupteur est une propriété du PROJET, quel que
            // soit le mode. Sur ce chemin (« nos serveurs », création AVEC
            // fichiers) il ne gouverne pas CETTE dépose — les octets partent
            // avec la création, comme avant le lot — mais il gouverne les
            // suivantes. On le pose donc APRÈS, par le même PATCH que la page
            // projet, plutôt que d'aller lire un champ dans le multipart que
            // l'enregistrement des fichiers est en train de consommer.
            if (advancedImport.value) {
                try {
                    await $fetch(`/api/project/${data.slug}/advanced-import`, {
                        method: 'PATCH',
                        body: { advancedImport: true },
                    })
                } catch { /* le projet existe ; l'interrupteur se remet sur sa page */ }
            }

            await Promise.all([getProjects(), getProject(API_ROUTES.PROJECT(data.slug))])

            router.push({ path: `/project/${data.slug}` })
        } catch (err) {
            if (err.response) {
                const errorData = await err.response.json()
                error.value = errorData.message
            } else {
                error.value = t('home.error.unexpected')
            }
        }
    }

    // Recent projects for the dashboard grid. Reads the shared cache populated by
    // the UserProjects aside; falls back to an SSR-aware fetch on first paint so
    // the dashboard shows data even before the store is hydrated.
    const { getters: globalGetters, actions: globalActions } = globalStore
    const { getProjects } = globalActions

    const $apiFetch = useApiFetch()
    const projectsData = globalGetters.projectsList ? null : await $apiFetch(API_ROUTES.PROJECTS).catch(() => null)

    onMounted(async () => {
        // Hydrate the shared store so the aside's project list survives
        // navigation back to /home without a refetch.
        if (!globalGetters.projectsList && projectsData?.projects) {
            const { overlayLocalProjectTitles } = await import('~/composables/projects')
            globalActions.setProjects(await overlayLocalProjectTitles(projectsData.projects))
        }
    })
</script>

<style lang="scss" scoped>
    .home {
        display: flex;
        flex-direction: column;
        gap: 32px;
        text-align: center;
    }

    // ---------- Welcome ----------
    .welcome {
        display: flex;
        flex-direction: column;
        /* U1 : aligné à gauche (plus de bloc centré avec avatar). */
        align-items: flex-start;
        gap: var(--sp-2);
        text-align: left;

        @media (min-width: 567px) {
            flex-direction: row;
            text-align: left;
        }

        &__body {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        &__title {
            font-family: var(--font-display);
            font-size: var(--fs-22);
            color: var(--text);
            line-height: var(--lh-title);
        }

        &__text {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 4px 16px;
            color: var(--label-secondary);
            font-size: var(--fs-14);
        }

        &__link {
            color: var(--accent-primary);
            font-weight: 600;
            text-decoration: underline;

            @media (hover: hover) {
                &:hover {
                    opacity: 0.8;
                }
            }
        }
    }

    // ---------- Create / upload ----------
    .create {
        border: 1px solid var(--separator-secondary);
        border-radius: var(--radius-l);
        padding: 24px 16px;
        background-color: var(--fill-tertiary);

        @media (min-width: 567px) {
            padding: 32px;
        }

        &__title {
            margin-bottom: 16px;
        }

        &__privacy {
            margin-bottom: 16px;
        }

        /* Lot E3 : l'interrupteur, entre les cartes de mode et la zone de
           dépôt. Allumé, il TEINTE la bordure de la zone de dépôt — le
           propriétaire demande que l'état se voie franchement, pas une case
           grise. */
        &__advanced {
            margin-bottom: 12px;
        }
        &__drop--advanced :deep(.upload__label) {
            border-color: var(--accent-primary);
        }

        &__error {
            margin-top: 16px;
            padding: 12px;
            background-color: var(--error-background);
            border: solid 1px var(--error-border);
            border-radius: var(--radius-l);
        }
    }
</style>
