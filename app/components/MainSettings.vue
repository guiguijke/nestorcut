<template>
    <div class="settings">
        <div class="settings__content content">
            <div class="content__size size">
                <section class="settings__section" data-testid="settings-sheets">
                    <h3 class="settings__h">{{ t('settings.section.sheets') }}<HelpDot topic="sheets" /></h3>
                <div
                    v-for="(sheet, index) in sheets"
                    :key="index"
                    class="size__sheet sheet"
                >
                    <div class="sheet__header">
                        <span
                            :class="['sheet__label', { 'sheet__label--named': sheet.shapeId && sheet.name }]"
                            :title="sheet.shapeId && sheet.name ? sheet.name : undefined"
                        >{{ sheetTitle(sheet, index) }}</span>
                        <span v-if="sheet.shapeId" class="shape__badge">{{ t('settings.sheetShape.badge') }}</span>
                        <!-- Une tôle importée seule reste retirable : elle est alors remplacée par la tôle simple d'usine. -->
                        <button
                            v-if="sheets.length > 1 || sheet.shapeId"
                            class="sheet__remove"
                            @click="onRemoveSheet(index)"
                            :title="t('settings.removeSheet')"
                        >
                            ✕
                        </button>
                    </div>
                    <div
                        v-if="sheetPresets.length && !sheet.shapeId"
                        class="sheet__presets presets"
                    >
                        <button
                            v-for="preset in sheetPresets"
                            :key="`${preset.width}x${preset.height}`"
                            :class="[
                                'presets__chip',
                                { 'presets__chip--active': isPresetActive(sheet, preset) },
                            ]"
                            :title="t('settings.sheetPreset.hint')"
                            @click="applyPreset(index, preset)"
                        >
                            {{ preset.width }}×{{ preset.height }}
                        </button>
                    </div>
                    <!-- Tôle importée d'un DXF : sa taille est celle du contour (lecture
                         seule, libellée) ; seule la quantité s'édite. -->
                    <div v-if="sheet.shapeId" class="shape" data-testid="settings-sheet-shape">
                        <span class="shape__size" :title="t('settings.sheetShape.sizeFixed')">
                            <span class="shape__label">{{ t('settings.sheetShape.size') }}</span>
                            {{ shapeSizeText(sheet) }}
                        </span>
                        <button
                            type="button"
                            class="shape__edit"
                            data-testid="settings-sheet-edit-zones"
                            @click="openEdit(index)"
                        >
                            {{ t('settings.sheetShape.editZones') }}
                        </button>
                    </div>
                    <div v-else class="size__line">
                        <InputField
                            :prefix="t('settings.width')"
                            :suffix="unitLabel"
                            :modelValue="sheet.width"
                            @update:modelValue="(value) => updateSheet(index, { width: value })"
                            class="size__input"
                        />
                        <InputField
                            :prefix="t('settings.height')"
                            :suffix="unitLabel"
                            :modelValue="sheet.height"
                            @update:modelValue="(value) => updateSheet(index, { height: value })"
                            class="size__input"
                        />
                    </div>
                    <InputField
                        :prefix="t('settings.count')"
                        :suffix="t('settings.units')"
                        :modelValue="unlimitedOn(sheet) ? '∞' : sheet.count"
                        :is-disable="unlimitedOn(sheet)"
                        :disabled="unlimitedOn(sheet)"
                        @update:modelValue="(value) => updateSheet(index, { count: value })"
                        class="size__input"
                    />
                    <!-- Quantité illimitée : prise après les tôles à quantité
                         fixe. Calcul dans le navigateur seulement : grisée
                         ailleurs, avec sa raison sous la liste. -->
                    <label
                        :class="['size__checkbox', 'size__unlimited', { 'size__unlimited--off': !isLocalProject }]"
                    >
                        <input
                            type="checkbox"
                            data-testid="settings-sheet-unlimited"
                            :aria-label="t('settings.sheetUnlimitedAria', { sheet: sheetTitle(sheet, index) })"
                            :aria-describedby="unlimitedDescription(sheet, index)"
                            :checked="unlimitedOn(sheet)"
                            :disabled="!isLocalProject"
                            @change="setSheetUnlimited(index, $event.target.checked)"
                        />
                        <span>{{ t('settings.sheetUnlimited') }}</span>
                    </label>
                    <p
                        v-if="unlimitedOn(sheet)"
                        :id="`${unlimitedId}-hint-${index}`"
                        class="size__rule"
                        data-testid="settings-sheet-unlimited-hint"
                    >{{ t('settings.sheetUnlimitedHint', { n: fmtNumber(MAX_SHEETS_PER_JOB, 0) }) }}</p>
                </div>
                <p v-if="!isLocalProject" :id="`${unlimitedId}-local`" class="size__rule" data-testid="settings-unlimited-local-only">
                    {{ t('settings.sheetUnlimitedLocalOnly') }}
                </p>
                <button
                    class="size__add"
                    :disabled="formatsAtLimit"
                    @click="addSheet"
                >
                    {{ t('settings.addSheet') }}
                </button>
                <!-- Tôle importée d'un DXF : projet local seulement (la géométrie
                     reste dans le navigateur). -->
                <button
                    v-if="isLocalProject"
                    class="size__add size__import"
                    data-testid="settings-import-sheet"
                    :disabled="formatsAtLimit"
                    @click="openImport"
                >
                    <svg class="size__importIcon" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M8 11V3m0 0L5 6m3-3 3 3M3 13h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    {{ t('settings.importSheet') }}
                </button>
                <p v-if="formatsAtLimit" class="size__rule" data-testid="settings-formats-limit">
                    {{ t('settings.sheetFormatsLimit', { max: MAX_SHEET_FORMATS }) }}
                </p>
                <!-- Tôle d'usine intacte remplacée par l'import : dit une fois. -->
                <p v-if="factorySheetNote" class="size__rule" data-testid="settings-factory-replaced">
                    {{ factorySheetNote }}
                </p>
                </section>
                <!-- B.4 / masterplan 3.10 : l'espacement se règle par ses deux
                     causes — kerf (largeur de coupe) et sécurité (marge par
                     pièce). L'espacement effectif (clé moteur `space`) vaut
                     toujours 2 × kerf + sécurité, règle affichée dessous. -->
                <section class="settings__section" data-testid="settings-spacing">
                    <h3 class="settings__h">{{ t('settings.section.spacing') }}<HelpDot topic="spacing" /></h3>
                <InputField
                    :prefix="t('settings.kerf')"
                    :suffix="unitLabel"
                    v-model="localKerf"
                    class="size__input"
                    data-testid="settings-kerf"
                />
                <InputField
                    :prefix="t('settings.safety')"
                    :suffix="unitLabel"
                    v-model="localSafety"
                    class="size__input"
                    data-testid="settings-safety"
                />
                <p class="size__rule">{{ spacingRule }}</p>
                <!-- Distance au bord de la tôle : réglage séparé de l'espacement.
                     Vide = comme l'espacement ; négatif = les pièces peuvent
                     dépasser du bord. Calcul dans le navigateur : grisé dans la démo, avec
                     un DWG ou calcul navigateur coupé, avec sa raison. -->
                <InputField
                    :prefix="t('settings.edgeDistance')"
                    :suffix="unitLabel"
                    :placeholder="edgePlaceholder"
                    v-model="localEdge"
                    :is-disable="edgeDisabled"
                    :is-error="edgeInvalid"
                    :disabled="edgeDisabled"
                    :aria-invalid="edgeInvalid ? 'true' : undefined"
                    class="size__input"
                    data-testid="settings-edge"
                />
                <p class="size__rule" data-testid="settings-edge-rule">{{ t('settings.edgeRule') }}</p>
                <p v-if="edgeDisabledText" class="size__rule" data-testid="settings-edge-local-only">
                    {{ edgeDisabledText }}
                </p>
                <p v-else-if="edgeOnDevice" class="size__rule" data-testid="settings-edge-computed-here">
                    {{ t('settings.edgeComputedHere') }}
                </p>
                <div v-if="edgeInvalid" class="size__warning" data-testid="settings-edge-invalid">
                    {{ t('settings.edgeInvalid') }}
                </div>
                <div v-else-if="edgeNegativeHint" class="size__warning" data-testid="settings-edge-overhang">
                    {{ edgeNegativeHint }}
                </div>
                <!-- W10 (vérif 2026-09-04) : espacement sous le kerf laser —
                     avertissement visible (micro-chevauchements possibles). -->
                <div
                    v-if="spacingBelowKerf"
                    class="size__warning"
                >
                    {{ t('settings.spacingKerf', { limit: fmtLengthValue(0.05, 4), unit: unitLabel }) }}
                </div>
                <!-- B.4 : dès 2,38 mm d'espacement le moteur ne peut plus
                     ouvrir les trous pour y nicher (limite canal, D-MOT-2). -->
                <div
                    v-if="holesDisabledHint"
                    class="size__warning"
                >
                    {{ t('settings.spacingHolesDisabled') }}
                </div>
                </section>
                <section class="settings__section" data-testid="settings-rotations">
                    <h3 class="settings__h">{{ t('settings.section.rotations') }}<HelpDot topic="rotations" /></h3>
                <div class="size__rotations rotations">
                    <UiSegmented
                        v-model="rotationSeg"
                        :options="rotationSegOptions"
                        :label="t('settings.rotations')"
                        class="rotations__seg"
                    />
                    <InputField
                        v-if="rotationSeg === 'other'"
                        :prefix="t('settings.rotations')"
                        :suffix="t('settings.steps')"
                        v-model="localRotationCount"
                        class="rotations__input"
                    />
                    <p class="rotations__hint">{{ rotationHint }}</p>
                </div>
                </section>
                <section class="settings__section" data-testid="settings-directions">
                    <h3 class="settings__h">{{ t('settings.section.directions') }}<HelpDot topic="directions" :hint="t('settings.directions.help')" /></h3>
                <div class="size__compute compute">
                    <div class="compute__options">
                        <button
                            v-for="option in directionOptions"
                            :key="option.value"
                            :class="[
                                'compute__option',
                                { 'compute__option--active': option.active },
                            ]"
                            :title="option.hint"
                            @click="toggleDirection(option.value)"
                        >
                            <UiIcon :name="option.icon" :size="14" class="compute__arrow" />
                            {{ option.label }}
                        </button>
                    </div>
                    <p class="compute__hint">{{ directionsHint }}</p>
                </div>
                <div v-if="isDemoProject" class="size__compute compute">
                    <span class="compute__label">
                        {{ t('settings.demoPower') }}
                        <span
                            class="compute__help"
                            :title="t('settings.demoPower.help')"
                            >?</span
                        >
                    </span>
                    <div class="compute__options">
                        <button
                            v-for="option in demoPowerOptions"
                            :key="option.walks"
                            :class="[
                                'compute__option',
                                { 'compute__option--active': option.active },
                            ]"
                            :title="option.hint"
                            @click="setDemoWalks(option.walks)"
                        >
                            <span class="compute__arrow">×{{ option.walks }}</span>
                            {{ option.label }}
                        </button>
                    </div>
                    <p class="compute__hint">{{ t('settings.demoPower.hint') }}</p>
                </div>
                </section>
                <section class="settings__section" data-testid="settings-options">
                    <h3 class="settings__h">{{ t('settings.section.options') }}</h3>
                <UiSwitch
                    v-model="localAddOutShape"
                    class="size__checkbox"
                    :title="t('settings.addOutShapeHint')"
                    :label="t('settings.addOutShape')"
                />
                <UiSwitch
                    v-model="localFillHoles"
                    class="size__checkbox"
                    :title="t('settings.fillHolesHint')"
                    :label="t('settings.fillHoles')"
                >
                    <template #default>{{ t('settings.fillHoles') }}<HelpDot topic="holes" /></template>
                </UiSwitch>
                </section>
            </div>
        </div>
        <SheetImportDialog
            v-if="isLocalProject"
            v-model:open="importOpen"
            :projectSlug="String(route.params.slug || '')"
            :replaceIndex="importIndex"
            :editSlug="importSlug"
        />
    </div>
</template>

<script setup>
    import { DEFAULT_SHEET, SHEET_PRESETS } from '~/utils/units'
    import { useId } from 'vue'
    import { MAX_SHEET_FORMATS, MAX_SHEETS_PER_JOB } from '~~/shared/constants/payment.constants'
    import { isUnlimitedSheet } from '~/utils/sheetStock'
    import { holesDisabledHintVisible } from '~/utils/holesHint'
    import { edgeDistanceNumber, isValidEdgeDistance } from '~/utils/spacingParams'
    import { maxOverhangMm } from '~/utils/partSheetFit'
    import { DEMO_MAX_DIRECTIONS, DEMO_PROJECT_SLUG, DEMO_WALK_CHOICES, resolveDemoWalks } from '~~/shared/constants/demo.constants'
    import { displayDirectionArrow } from '~/utils/sheetView'
    import {
        ROT_PRESETS,
        effectiveRotationCount,
        initialOtherMode,
        pickRotationSegment,
        rotationSegment,
    } from '~/utils/rotationChoice'

    const { t, fmtNumber } = useLocale()
    const { unit, unitLabel, enabled: unitsEnabled, fmtLength, fmtLengthValue, fmtLengthMax, displayToMm } = useUnit()
    const { getters, actions } = filesStore
    const { updateParams, updateKerfSafety, updateEdgeDistance, updateSheet, setSheetUnlimited, addSheet, removeSheet } = actions
    const params = computed(() => getters.params)

    // Standard sheet sizes of the current unit (a US user picks 48×96 from a
    // list, never types it). Hidden when the units feature is off.
    const sheetPresets = computed(() => (unitsEnabled.value ? SHEET_PRESETS[unit.value] || [] : []))
    const isPresetActive = (sheet, preset) =>
        Number(String(sheet.width).replace(',', '.')) === preset.width &&
        Number(String(sheet.height).replace(',', '.')) === preset.height
    const applyPreset = (index, preset) =>
        updateSheet(index, { width: String(preset.width), height: String(preset.height) })

    // Tôle importée d'un DXF : projet local seulement. Entrée (« Importer »),
    // édition des zones (ligne `index`), et suppression avec son enregistrement.
    const isLocalProject = computed(() => Boolean(unref(getters.projectLocal)))
    // Quantité illimitée active : cochée ET projet « Cet appareil » (ailleurs la
    // quantité saisie vaut).
    const unlimitedOn = (sheet) => isLocalProject.value && isUnlimitedSheet(sheet)
    // Nom d'une ligne de tôle : celui de la tôle importée, sinon son rang.
    const sheetTitle = (sheet, index) => (sheet.shapeId && sheet.name ? sheet.name : t('settings.sheet', { n: index + 1 }))
    // La case est décrite par la phrase affichée à son sujet : l'aide quand elle
    // est cochée, la raison quand le projet ne la permet pas.
    const unlimitedId = useId()
    const unlimitedDescription = (sheet, index) => {
        if (!isLocalProject.value) return `${unlimitedId}-local`
        return unlimitedOn(sheet) ? `${unlimitedId}-hint-${index}` : undefined
    }
    // Plafond de formats (le serveur refuse au-delà) : on n'en ajoute plus.
    const formatsAtLimit = computed(() => Boolean(unref(getters.sheetFormatsAtLimit)))
    // Note unique : la tôle d'usine intacte a été remplacée par la tôle importée.
    // Elle disparaît dès que la liste change (autre ligne, autre tôle).
    const factorySheetNote = computed(() => {
        const id = unref(getters.factorySheetReplaced)
        const list = sheets.value
        if (!id || list.length !== 1 || list[0]?.shapeId !== id) return ''
        // Chiffres figés au remplacement : après un changement d'unité, la phrase
        // nomme encore la tôle réellement remplacée.
        const replaced = unref(getters.factorySheetReplacedLabel)
        if (!replaced) return ''
        return t('settings.factorySheetReplaced', replaced)
    })
    const importOpen = ref(false)
    const importIndex = ref(null)
    const importSlug = ref('')
    const openImport = () => {
        importIndex.value = null
        importSlug.value = ''
        importOpen.value = true
    }
    const openEdit = (index) => {
        importIndex.value = index
        importSlug.value = String(sheets.value[index]?.shapeId || '')
        importOpen.value = true
    }
    const shapeSizeText = (sheet) => {
        const w = Number(String(sheet.width).replace(',', '.'))
        const h = Number(String(sheet.height).replace(',', '.'))
        return `${fmtLength(displayToMm(w))} × ${fmtLength(displayToMm(h))}`
    }
    // Retirer une tôle importée supprime aussi son enregistrement (jamais une
    // entrée de « tôles récentes » : leur slug commence par `recent-`).
    const onRemoveSheet = async (index) => {
        const target = sheets.value[index]
        const shapeId = target?.shapeId
        if (sheets.value.length <= 1 && shapeId) {
            // removeSheet garde toujours une tôle : l'unique tôle importée est
            // remplacée par la tôle simple d'usine (même quantité).
            const dflt = DEFAULT_SHEET[unit.value === 'inch' ? 'inch' : 'mm']
            // « Même quantité » : une quantité illimitée le reste.
            const quantity = { count: target.count ?? '1', ...(isUnlimitedSheet(target) ? { unlimited: true } : {}) }
            updateParams({ sheets: [{ width: dflt.width, height: dflt.height, ...quantity }] })
        } else {
            removeSheet(index)
        }
        if (!shapeId || String(shapeId).startsWith('recent-')) return
        try {
            const { deleteSheet } = await import('~/composables/localSheetsStore')
            await deleteSheet(String(shapeId))
        } catch {
            // l'enregistrement orphelin est inoffensif ; la ligne est déjà retirée
        }
    }

    const sheets = computed(() => {
        const p = unref(params)
        if (Array.isArray(p.sheets) && p.sheets.length > 0) return p.sheets
        // Legacy params shape (before multi-sheet).
        return [{ width: p.widthPlate ?? '400', height: p.heightPlate ?? '560', count: p.sheetCount ?? '1' }]
    })

    // B.4 : les deux réglages explicites passent par updateKerfSafety —
    // l'unique chemin qui maintient `space` (= 2 × kerf + sécurité), la
    // clé comprise par l'API et les deux moteurs.
    const localKerf = computed({
        get: () => unref(params).kerf ?? '0',
        set: (value) => updateKerfSafety({ kerf: value }),
    })

    const localSafety = computed({
        get: () => unref(params).safety ?? '0',
        set: (value) => updateKerfSafety({ safety: value }),
    })

    // Distance au bord : passe par son propre chemin d'écriture (jamais par
    // updateKerfSafety) ; '' = comme l'espacement. Champ grisé hors des projets
    // « Cet appareil ». Sur « Nos serveurs » il est actif : le calcul se fait alors
    // dans le navigateur (une phrase le dit). Grisé, chaque cas a sa phrase.
    const localEdge = computed({
        get: () => unref(params).edgeDistance ?? '',
        set: (value) => updateEdgeDistance(value),
    })
    const edgeBlock = computed(() => getters.edgeBlock)
    const edgeDisabled = computed(() => edgeBlock.value !== null)
    const edgeOnDevice = computed(() => !isLocalProject.value && edgeBlock.value === null)
    const edgeDisabledText = computed(() => {
        if (edgeBlock.value === 'demo') return t('settings.edgeNoDemo')
        if (edgeBlock.value === 'dwg') return t('settings.edgeNoDwg')
        if (edgeBlock.value === 'off') return t('settings.edgeLocalOnly')
        return ''
    })
    const edgeInvalid = computed(() => !edgeDisabled.value && !isValidEdgeDistance(unref(params).edgeDistance))
    const edgePlaceholder = computed(() =>
        t('settings.edgePlaceholder', { v: unref(params).space ?? '0', unit: unitLabel.value })
    )
    // Bord négatif : dit jusqu'où les pièces peuvent dépasser, et le plafond
    // (la moitié de la plus petite pièce, mesurée sur les fiches du projet).
    const edgeNegativeHint = computed(() => {
        if (edgeDisabled.value) return ''
        const n = edgeDistanceNumber(unref(params).edgeDistance)
        if (n === null || !(n < 0)) return ''
        // Valeur tapée, au séparateur de la langue et sans arrondi (6 décimales).
        const x = fmtLengthValue(displayToMm(Math.abs(n)), 6)
        const maxMm = Number(maxOverhangMm(unref(getters.projectFiles) || []))
        if (!Number.isFinite(maxMm)) return t('settings.edgeNegativeNoParts', { x, unit: unitLabel.value })
        return t('settings.edgeNegative', { x, max: fmtLengthMax(maxMm), unit: unitLabel.value })
    })

    const effectiveSpace = computed(() => Number(String(unref(params).space ?? '0').replace(',', '.')) || 0)

    // Règle affichée (B.4/3.10) : « espacement entre pièces = 2 × kerf +
    // sécurité = {v} » — l'utilisateur voit la décomposition ET le
    // chiffre effectivement envoyé au moteur.
    const spacingRule = computed(() =>
        t('settings.spacingRule', {
            kerf: unref(params).kerf ?? '0',
            safety: unref(params).safety ?? '0',
            v: unref(params).space ?? '0',
            unit: unitLabel.value,
        })
    )

    // Dès 2,38 mm (2,5 − marge de courbes maximale 0,12) : voir utils/holesHint.
    const holesDisabledHint = computed(() =>
        holesDisabledHintVisible(effectiveSpace.value, unref(params).fillHoles !== false)
    )

    const localAddOutShape = computed({
        get: () => unref(params).addOutShape,
        set: (value) => updateParams({ addOutShape: value }),
    })

    const localFillHoles = computed({
        get: () => unref(params).fillHoles !== false,
        set: (value) => updateParams({ fillHoles: value }),
    })

    const localRotationCount = computed({
        get: () => unref(params).rotationCount,
        set: (value) => updateParams({ rotationCount: value }),
    })

    // Layout directions: each checked direction is one result option.
    // Default is 1 (left) = the best of that search. Paid can check up to
    // 3 to compare. Free is radio (1 per nesting). Server re-validates.
    const DIRECTION_ORDER = ['left', 'bottom', 'balanced']
    const { getters: authGetters } = authStore
    const route = useRoute()
    // The shared demo project runs at standard power (4 vcores) but computes
    // ONE direction per nesting — all 3 stay selectable (radio) so newcomers
    // can try each, and the checkboxes always show what the server will
    // actually compute.
    const isDemoProject = computed(() => route.params.slug === DEMO_PROJECT_SLUG)
    const maxDirections = computed(() => {
        if (unref(isDemoProject)) return DEMO_MAX_DIRECTIONS
        const n = unref(authGetters.user)?.compute?.maxDirections
        return Math.min(3, Math.max(1, Number(n) || 1))
    })
    const localDirections = computed(() => {
        const dirs = unref(params).directions
        const valid = Array.isArray(dirs) ? dirs.filter((d) => DIRECTION_ORDER.includes(d)) : []
        return valid.length ? valid : ['left']
    })
    const toggleDirection = (value) => {
        const current = localDirections.value
        if (maxDirections.value === 1) {
            // Free plan: radio behaviour — one direction per nesting.
            updateParams({ directions: [value] })
            return
        }
        if (current.includes(value)) {
            if (current.length === 1) return // at least one direction
            updateParams({ directions: current.filter((d) => d !== value) })
        } else {
            updateParams({
                directions: DIRECTION_ORDER.filter((d) => current.includes(d) || d === value),
            })
        }
    }
    const firstSheet = computed(() => {
        const s = sheets.value[0] || {}
        return {
            width: Number(String(s.width).replace(',', '.')) || 0,
            height: Number(String(s.height).replace(',', '.')) || 0,
        }
    })
    const DIRECTION_ICONS = { left: 'arrowLeft', bottom: 'arrowDown', balanced: 'layers' }
    const directionOptions = computed(() =>
        DIRECTION_ORDER.map((value) => ({
            value,
            icon: DIRECTION_ICONS[value] || 'arrowLeft',
            arrow: displayDirectionArrow(value, firstSheet.value.width, firstSheet.value.height),
            label: t(`settings.directions.${value}`),
            hint: t(`settings.directions.${value}Hint`),
            active: localDirections.value.includes(value),
        }))
    )
    const rotationSegOptions = computed(() => [
        ...ROT_PRESETS.map((n) => ({ value: n, label: String(n) })),
        { value: 'other', label: t('settings.rotation.other') },
    ])
    // « Autre » reste choisi tant que l'utilisateur y est : sinon taper « 1 »
    // (début de « 12 ») bascule sur le préréglage 1 et ferme le champ.
    const rotationOther = ref(initialOtherMode(unref(params).rotationCount))
    watch(
        () => unref(params).rotationCount,
        (raw) => {
            if (initialOtherMode(raw)) rotationOther.value = true
        }
    )
    const rotationSeg = computed({
        get: () => rotationSegment(unref(params).rotationCount, rotationOther.value),
        set(v) {
            const pick = pickRotationSegment(v, unref(params).rotationCount, rotationOther.value)
            rotationOther.value = pick.otherMode
            if (pick.count !== undefined) updateParams({ rotationCount: pick.count })
        },
    })
    const directionsHint = computed(() =>
        maxDirections.value === 1
            ? t('settings.directions.freeHint')
            : t('settings.directions.paidHint')
    )

    const DEMO_POWER_KEYS = { 1: 'free', 4: 'unlimited', 8: 'pro' }
    const demoWalks = computed(() => resolveDemoWalks(unref(params).demoWalks))
    const setDemoWalks = (n) => updateParams({ demoWalks: resolveDemoWalks(n) })
    const demoPowerOptions = computed(() =>
        DEMO_WALK_CHOICES.map((walks) => ({
            walks,
            label: t(`settings.demoPower.${DEMO_POWER_KEYS[walks]}`),
            hint: t(`settings.demoPower.${DEMO_POWER_KEYS[walks]}Hint`),
            active: demoWalks.value === walks,
        })),
    )

    // Preview the angles that the current rotation count produces, so the user
    // understands what "N rotations" means (e.g. 8 -> 0°, 45°, 90°, ... 315°).
    const rotationHint = computed(() => {
        const n = effectiveRotationCount(unref(params).rotationCount)
        if (n === 1) return t('settings.noRotation')
        const step = 360 / n
        const angles = Array.from({ length: n }, (_, i) => Math.round(i * step))
        return angles.map((a) => a + '°').join(', ')
    })

// W10 : espacement EFFECTIF < 0,05 mm (kerf laser) — la découpe peut
// micro-chevaucher.
const spacingBelowKerf = computed(() => {
    const v = effectiveSpace.value
    return Number.isFinite(v) && v > 0 && v < 0.05
})
</script>

<style lang="scss" scoped>
.size__warning {
    grid-column: 1 / -1;
    color: var(--warn);
    font-size: var(--fs-12);
    margin-top: 2px;
}

.size__rule {
    margin: 2px 4px 0;
    font-size: var(--fs-12);
    color: var(--label-tertiary);
}

    .settings {
        text-align: left;

        &__title {
            margin-bottom: 12px;
        }

        &__content {
            width: 100%;
        }

        &__section {
            margin-bottom: 12px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--separator-secondary);

            &:last-child {
                border-bottom: none;
                margin-bottom: 0;
                padding-bottom: 0;
            }
        }

        &__h {
            margin: 0 0 6px;
            font-size: var(--fs-12);
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: var(--label-secondary);
        }
    }

    .content {
        display: block;

        &__size {
            width: 100%;
        }
    }

    .size {
        & > *:not(:last-child) {
            margin-bottom: 6px;
        }
        // Les cartes de tôle et les deux entrées en pointillés sont dans la
        // section : même écart de 6 px qu'avant entre elles.
        .settings__section > .sheet:not(:last-child),
        .settings__section > .size__add:not(:last-child) {
            margin-bottom: 6px;
        }

        &__line {
            display: grid;
            grid-template-columns: 1fr;
            gap: 6px;
        }

        // Champs plus bas : la même saisie, moins de hauteur.
        :deep(.input) {
            padding-top: 8px;
            padding-bottom: 8px;
        }

        &__input {
            flex-grow: 1;
            min-width: 80px;
        }

        &__add {
            width: 100%;
            padding: 8px;
            border: 1.5px dashed var(--separator-primary);
            border-radius: var(--radius-l);
            background-color: transparent;
            color: var(--label-secondary);
            font-size: var(--fs-14);
            font-weight: 600;
            cursor: pointer;
            transition:
                border-color 0.3s,
                color 0.3s,
                background-color 0.3s;

            @media (hover: hover) {
                &:hover:not(:disabled) {
                    border-color: var(--accent-primary);
                    color: var(--accent-primary);
                    background-color: color-mix(in srgb, var(--accent-primary) 5%, transparent);
                }
            }

            &:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        }

        // Même famille que « + Add sheet type » (classe size__add) : pointillés,
        // ton secondaire, survol accentué ; une petite icône de dépôt en plus.
        &__import {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;

            &:focus-visible {
                outline: none;
                box-shadow: var(--focus-ring);
            }
        }
        &__importIcon {
            flex: 0 0 auto;
            width: 14px;
            height: 14px;
        }

        &__checkbox {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--label-primary);
            font-size: var(--fs-13);
            font-weight: 500;
            cursor: pointer;
            padding: 0 4px;

            input {
                width: 16px;
                height: 16px;
                margin-top: 2px;
                flex-shrink: 0;
                cursor: pointer;
                accent-color: var(--accent-primary);
            }
        }

        // Quantité illimitée : cible tactile d'une ligne ; grisée hors projet
        // « Cet appareil ».
        &__unlimited {
            min-height: 28px;

            input {
                margin-top: 0;
            }

            input:focus-visible {
                outline: none;
                box-shadow: var(--focus-ring);
            }

            &--off {
                color: var(--label-tertiary);
                cursor: not-allowed;

                input {
                    cursor: not-allowed;
                }
            }
        }
    }

    .sheet {
        border: 1px solid var(--separator-secondary);
        border-radius: var(--radius-l);
        padding: 10px;
        background-color: var(--background-primary);
        box-shadow:
            0 1px 2px color-mix(in srgb, var(--label-primary) 4%, transparent),
            0 4px 12px color-mix(in srgb, var(--label-primary) 5%, transparent);

        & > *:not(:last-child) {
            margin-bottom: 6px;
        }

        &__header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 4px 2px;
        }

        &__label {
            font-size: var(--fs-13);
            font-weight: 700;
            color: var(--label-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;

            // Nom d'une tôle importée : tel que saisi, jamais en capitales.
            &--named {
                min-width: 0;
                flex: 0 1 auto;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                text-transform: none;
                letter-spacing: 0;
            }
        }

        &__remove {
            border: none;
            background: none;
            color: var(--label-tertiary);
            cursor: pointer;
            font-size: var(--fs-14);
            padding: 2px 6px;
            border-radius: var(--radius);
            transition: color 0.3s;

            @media (hover: hover) {
                &:hover {
                    color: var(--error-text);
                }
            }
        }
    }

    // La taille et « Edit zones » tiennent sur la même ligne aux largeurs de bureau ;
    // le retour à la ligne n'arrive que si la colonne devient vraiment étroite.
    .shape {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 6px 10px;
        padding: 0 4px;

        &__badge {
            flex: 0 0 auto;
            margin: 0 6px 0 8px;
            padding: 2px 6px;
            border-radius: var(--radius-s);
            background-color: var(--fill-secondary);
            color: var(--label-secondary);
            font-size: var(--fs-12);
            font-weight: 600;
            white-space: nowrap;
            margin-right: auto;
        }
        &__size {
            color: var(--label-primary);
            font-size: var(--fs-13);
            font-weight: 600;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }
        &__label {
            margin-right: 4px;
            color: var(--label-secondary);
            font-weight: 500;
        }
        &__edit {
            flex: 0 0 auto;
            margin-left: auto;
            padding: 4px 8px;
            border: 1px solid var(--separator-secondary);
            border-radius: var(--radius);
            background: transparent;
            color: var(--accent-primary);
            font-size: var(--fs-12);
            font-weight: 600;
            cursor: pointer;

            @media (hover: hover) {
                &:hover {
                    border-color: var(--accent-primary);
                }
            }
            &:focus-visible {
                outline: none;
                box-shadow: var(--focus-ring);
            }
        }
    }

    .presets {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;

        &__chip {
            padding: 5px 10px;
            border: 1px solid var(--separator-secondary);
            border-radius: var(--radius);
            background-color: transparent;
            color: var(--label-secondary);
            font-size: var(--fs-12);
            font-weight: 600;
            cursor: pointer;
            transition:
                border-color 0.2s,
                color 0.2s,
                background-color 0.2s;

            @media (hover: hover) {
                &:hover {
                    border-color: var(--accent-primary);
                    color: var(--accent-primary);
                }
            }

            &--active {
                border-color: var(--accent-primary);
                color: var(--accent-secondary);
                background-color: color-mix(in srgb, var(--accent-primary) 8%, transparent);
            }
        }
    }

    .compute {
        &__label {
            display: block;
            font-size: var(--fs-13);
            font-weight: 700;
            color: var(--label-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 8px;
            padding: 0 4px;
            text-align: left;
        }

        &__help {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            margin-left: 6px;
            border-radius: var(--radius);
            border: 1px solid var(--label-tertiary);
            color: var(--label-tertiary);
            font-size: var(--fs-12);
            font-weight: 700;
            text-transform: none;
            cursor: help;
            vertical-align: 1px;
        }

        &__arrow {
            display: block;
            font-size: var(--fs-16);
            line-height: 1;
            margin-bottom: 2px;
        }

        &__options {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
            padding: 4px;
            border-radius: var(--radius-l);
            background-color: var(--fill-tertiary);
        }

        &__option {
            padding: 8px 4px;
            border: none;
            border-radius: var(--radius-l);
            background-color: transparent;
            color: var(--label-secondary);
            font-size: var(--fs-13);
            font-weight: 600;
            cursor: pointer;
            transition:
                background-color 0.2s,
                color 0.2s,
                box-shadow 0.2s;

            &--active {
                background-color: var(--background-primary);
                color: var(--accent-primary);
                box-shadow: 0 1px 3px color-mix(in srgb, var(--label-primary) 12%, transparent);
            }

            &--locked {
                opacity: 0.4;
                cursor: not-allowed;
            }

            @media (hover: hover) {
                &:not(&--active):not(&--locked):hover {
                    color: var(--label-primary);
                }
            }
        }

        &__hint {
            margin-top: 6px;
            font-size: var(--fs-12);
            color: var(--label-tertiary);
            text-align: left;
            padding: 0 4px;
        }
    }

    .rotations {
        &__hint {
            margin-top: 6px;
            font-size: var(--fs-13);
            color: var(--label-secondary);
            word-break: break-word;
            line-height: 1.4;
        }
    }
</style>
