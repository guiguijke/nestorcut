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
            <!-- Lot E4-d : l'interrupteur « Import avancé » a disparu — le
                 dépôt est l'import ordinaire, l'échelle et l'éclatement se
                 demandent sur la fiche après import. -->
            <DxfUpload
                :extensions="uploadExtensions"
                @files="handleSubmit"
                @rejected="handleRejected"
                @oversize="handleOversize"
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
    import { MAX_UPLOAD_FILES } from '~~/shared/constants/upload.constants'

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
    const localProject = computed(() => privacyChoice.value === 'device')
    watch(privacyChoice, () => { error.value = '' })
    // La page d'accueil porte SA PROPRE liste : c'est elle qui filtre la
    // toute première dépose, celle qui CRÉE le projet. Lot J4 : sans `.job`
    // ici, un `.job` déposé à la création était écarté par la dropzone, en
    // silence — les DXF partaient seuls et le nesting se faisait sans les
    // réserves d'amorce. Défaut trouvé au harnais navigateur, qu'aucun
    // test unitaire ne pouvait voir. Lot J8-bis : le `.job` passe le filtre
    // dans les DEUX modes — c'est `handleSubmit` qui décide (bascule
    // « Cet appareil » si le mode choisi est serveur, §9.73 point 22) ;
    // la liste ne sert qu'au filtre du sélecteur de fichiers : la vérité
    // du format reste la SIGNATURE (piège #31).
    const uploadExtensions = computed(() =>
        localImportEnabled.value
            ? ['.dxf', '.svg', '.job', ...(localProject.value ? [] : ['.dwg'])]
            : ['.dxf', '.svg', '.dwg']
    )

    // Lot J8-bis (§9.75) : tout fichier écarté est NOMMÉ — le silence de
    // setFiles dès qu'un autre fichier passait était la même famille de
    // défaut que le mutisme d'uploadToServer (J8-e). Le motif rappelle ce
    // que CE mode accepte (la même chose que la légende, jamais plus).
    const handleRejected = (files) => {
        const list = files || []
        const names = list.map((f) => String(f.name || '?')).join(', ')
        if (localProject.value && list.some((f) => /\.dwg$/i.test(String(f.name || '')))) {
            error.value = t('upload.dwgNamed', { names })
            return
        }
        error.value = localProject.value
            ? t('upload.rejectedDevice', { names })
            : t('upload.rejectedServer', { names })
    }

    const handleOversize = (files) => {
        const names = (files || []).map((f) => String(f.name || '?')).join(', ')
        error.value = t('upload.oversizeNamed', { names })
    }

    const handleSubmit = async (files) => {
        error.value = ''
        if (!files?.length) return

        // Lot J8-bis — les points 22 et 23 du §8.3-ter : la dépose est lue
        // par SIGNATURE (piège #31), pas par extension. Un `.job` déposé en
        // mode « Nos serveurs » BASCULE le projet en « Cet appareil » (le
        // seul mode qui les neste) et le DIT en information — l'écran ne
        // peut pas promettre « .job acceptés » sur une carte et répondre
        // « type non supporté » au dépôt. Le seul cas contradictoire,
        // `.job` + `.dwg` dans la MÊME dépose (l'un exige l'appareil,
        // l'autre le serveur), est un refus explicite qui nomme les deux.
        let jobNames = []
        let dwgNames = []
        if (localImportEnabled.value) {
            const { isSheetCamJob } = await import('~~/shared/sheetcamJob.js')
            for (const file of files) {
                try {
                    const bytes = new Uint8Array(await file.arrayBuffer())
                    if (isSheetCamJob(bytes)) jobNames.push(String(file.name || '?'))
                    else if (/\.dwg$/i.test(String(file.name || ''))) dwgNames.push(String(file.name || '?'))
                } catch {
                    // Illisible : la chaîne ordinaire saura le dire.
                }
            }
        } else {
            dwgNames = files.filter((f) => /\.dwg$/i.test(String(f.name || ''))).map((f) => String(f.name || '?'))
        }
        if (jobNames.length && dwgNames.length) {
            error.value = t('home.jobPlusDwg')
            return
        }
        let switchedForJob = false
        if (jobNames.length && !localProject.value && localImportEnabled.value) {
            privacyChoice.value = 'device'
            switchedForJob = true
        }

        if (localProject.value && localImportEnabled.value) {
            // J-090 : création JSON sans fichiers — l'import navigateur des
            // fichiers déposés se fait sur la page projet (IndexedDB).
            try {
                const data = await $fetch(API_ROUTES.PROJECT(), {
                    method: 'POST',
                    body: { local: true },
                })
                filesActions.setPendingLocalFiles(files)
                // Lot J8-bis (point 22) : l'information de bascule survit à
                // la navigation — la page projet l'affiche UNE fois, en
                // information, puis l'oublie (sessionStorage : rien de
                // persistant, rien de serveur).
                if (switchedForJob) {
                    try {
                        sessionStorage.setItem('nestorcut-job-switched', '1')
                    } catch { /* pas de session : l'info se perd, pas le projet */ }
                }
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

        // Lot J8-e (étude §9.73, 8.3-quater) : le plafond de
        // MAX_UPLOAD_FILES protège le CORPS HTTP de la requête, pas une
        // règle produit. La CRÉATION emporte le premier lot, le reste suit
        // sur la page projet par l'envoi par lots automatiques — plus
        // personne n'a à compter ses fichiers, et le dépôt de plus de
        // vingt fichiers ne meurt plus en silence au moment de créer.
        const firstLot = files.slice(0, MAX_UPLOAD_FILES)
        const rest = files.slice(MAX_UPLOAD_FILES)
        const formData = new FormData()
        firstLot.forEach((file) => formData.append('dxf', file))


        try {
            const data = await $fetch(API_ROUTES.PROJECT(), {
                method: 'POST',
                body: formData,
            })
            if (rest.length) filesActions.setPendingLocalFiles(rest)

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

        &__error {
            margin-top: 16px;
            padding: 12px;
            background-color: var(--error-background);
            border: solid 1px var(--error-border);
            border-radius: var(--radius-l);
        }
    }
</style>
