<template>
    <!-- Rapport PDF : « base » (tout le monde) ou « avancé » (Unlimited et Pro).
         La fenêtre n'exprime qu'une INTENTION (`download`) : le verrou, la relecture
         de l'offre et la fabrication restent dans ResultModal. Le logo et le nom de
         l'entreprise sont gardés dans CE navigateur (reportBranding.js), jamais envoyés. -->
    <DialogWrapper
        :isModalOpen="isModalOpen"
        trackingTag="report_pdf"
        backdrop="dim"
        @update:isModalOpen="$emit('update:isModalOpen', $event)"
    >
        <div class="rpd" data-testid="report-pdf-dialog">
            <h2 class="rpd__title">{{ t('reportPdf.dialog.title') }}</h2>
            <p class="rpd__intro">{{ t('reportPdf.dialog.intro') }}</p>

            <UiSegmented
                v-model="mode"
                class="rpd__mode"
                :options="modeOptions"
                :label="t('reportPdf.mode.label')"
                testid="report-pdf-mode"
            />
            <p class="rpd__hint" data-testid="report-pdf-mode-hint">
                {{ advancedChosen ? t('reportPdf.mode.advancedHint') : t('reportPdf.mode.basicHint') }}
            </p>

            <p v-if="advancedChosen && locked" class="rpd__locked" data-testid="report-pdf-locked">
                <svg class="rpd__lock" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                    <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
                </svg>
                <span>{{ t('reportPdf.mode.locked') }}</span>
            </p>

            <section v-if="advancedChosen && canEdit" class="rpd__section" data-testid="report-pdf-advanced">
                <h3 class="rpd__h">{{ t('reportPdf.brand.title') }}</h3>

                <div
                    class="rpd__drop"
                    :class="{ 'rpd__drop--over': dragOver }"
                    data-testid="report-pdf-logo-drop"
                    @dragover.prevent="dragOver = true"
                    @dragleave.prevent="dragOver = false"
                    @drop.prevent="onDrop"
                >
                    <img v-if="logo" class="rpd__logo" :src="logo" :alt="t('reportPdf.brand.alt')" data-testid="report-pdf-logo-preview" />
                    <span v-else class="rpd__droptext">{{ t('reportPdf.brand.choose') }}</span>
                    <div class="rpd__logo-actions">
                        <MainButton
                            :label="logo ? t('reportPdf.brand.change') : t('reportPdf.brand.logo')"
                            :size="sizeType.s"
                            :theme="themeType.secondary"
                            data-testid="report-pdf-logo-pick"
                            @click="pickFile"
                        />
                        <MainButton
                            v-if="logo"
                            :label="t('reportPdf.brand.remove')"
                            :size="sizeType.s"
                            :theme="themeType.ghost"
                            data-testid="report-pdf-logo-remove"
                            @click="removeLogo"
                        />
                    </div>
                    <input
                        ref="fileEl"
                        class="rpd__file"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
                        tabindex="-1"
                        aria-hidden="true"
                        data-testid="report-pdf-logo-input"
                        @change="onPick"
                    />
                </div>
                <p class="rpd__note" data-testid="report-pdf-logo-note">{{ t('reportPdf.brand.kept') }}</p>
                <p v-if="logoError" class="rpd__error" role="alert" data-testid="report-pdf-logo-error">{{ logoError }}</p>

                <UiField v-model="company" :label="t('reportPdf.brand.company')" maxlength="120" autocomplete="organization" />
                <UiField v-model="line" :label="t('reportPdf.brand.line')" maxlength="200" />

                <h3 class="rpd__h">{{ t('reportPdf.fields.title') }}</h3>
                <p class="rpd__note">{{ t('reportPdf.fields.hint') }}</p>
                <UiField v-model="fields.client" :label="t('reportPdf.field.client')" maxlength="200" />
                <UiField v-model="fields.reference" :label="t('reportPdf.field.reference')" maxlength="200" />
                <UiField v-model="fields.material" :label="t('reportPdf.field.material')" maxlength="200" />
                <label class="rpd__area">
                    <span class="rpd__arealabel">{{ t('reportPdf.field.comment') }}</span>
                    <textarea v-model="fields.comment" rows="3" maxlength="1000" class="rpd__textarea" />
                </label>
            </section>

            <p v-if="errorText" class="rpd__error" role="alert" data-testid="report-pdf-error">{{ errorText }}</p>

            <div class="rpd__actions">
                <MainButton
                    :label="busy ? t('reportPdf.working') : t('reportPdf.download')"
                    :icon="advancedChosen && locked ? iconType.lock : undefined"
                    :isDisable="busy"
                    :size="sizeType.m"
                    :theme="themeType.primary"
                    trackingTag="report_pdf_download"
                    data-testid="report-pdf-download"
                    @click="onDownload"
                />
            </div>
        </div>
    </DialogWrapper>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { iconType } from '~~/constants/icon.constants'
import { sizeType } from '~~/constants/size.constants'
import { themeType } from '~~/constants/theme.constants'
import { clearBranding, loadBranding, saveBranding } from '~/utils/reportBranding'

const props = defineProps({
    isModalOpen: { type: Boolean, default: false },
    // 'enabled' | 'locked' | 'disabled' (reportPdfState(...).advanced)
    advancedState: { type: String, default: 'locked' },
    busy: { type: Boolean, default: false },
    errorText: { type: String, default: '' },
})
const emit = defineEmits(['update:isModalOpen', 'download'])

const { t } = useLocale()

const mode = ref('basic')
const company = ref('')
const line = ref('')
const logo = ref(null)
const logoError = ref('')
const dragOver = ref(false)
const fileEl = ref(null)
const fields = reactive({ client: '', reference: '', material: '', comment: '' })

const locked = computed(() => props.advancedState === 'locked')
const disabled = computed(() => props.advancedState === 'disabled')
// Le drapeau « abonnements coupés » grise l'option (aucune fenêtre d'abonnement).
const advancedChosen = computed(() => mode.value === 'advanced' && !disabled.value)
// Les champs avancés ne s'affichent qu'avec l'offre : verrouillé, la fenêtre dit
// seulement ce que contient le rapport avancé.
const canEdit = computed(() => props.advancedState === 'enabled')
const modeOptions = computed(() => [
    { value: 'basic', label: t('reportPdf.mode.basic') },
    { value: 'advanced', label: t('reportPdf.mode.advanced'), disabled: disabled.value },
])
watch(disabled, (d) => {
    if (d && mode.value === 'advanced') mode.value = 'basic'
})

// Lecture de la marque gardée dans ce navigateur, à chaque ouverture.
let loaded = false
watch(() => props.isModalOpen, (isOpen) => {
    if (!isOpen) {
        flushSave()
        loaded = false
        return
    }
    const saved = loadBranding()
    company.value = saved.company
    line.value = saved.line
    logo.value = saved.logo
    logoError.value = ''
    loaded = true
}, { immediate: true })

let saveTimer = null
const flushSave = () => {
    clearTimeout(saveTimer)
    saveTimer = null
    if (!loaded) return
    const r = saveBranding({ company: company.value, line: line.value, logo: logo.value })
    if (!r.ok && r.reason === 'quota') logoError.value = t('reportPdf.brand.quota')
    return r
}
watch([company, line, logo], () => {
    if (!loaded) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(flushSave, 500)
})
onBeforeUnmount(() => flushSave())

const pickFile = () => fileEl.value?.click()
const REASONS = { tooBig: 'reportPdf.brand.tooBig', badType: 'reportPdf.brand.badType', unreadable: 'reportPdf.brand.unreadable' }
const takeFile = async (file) => {
    if (!file) return
    logoError.value = ''
    const { processCompanyLogo } = await import('~/composables/reportPdfExport')
    const r = await processCompanyLogo(file)
    if (!r.ok) {
        logoError.value = t(REASONS[r.reason] || REASONS.unreadable)
        return
    }
    logo.value = r.dataUri
    // Le logo est écrit tout de suite : un quota plein se dit ici, pas au téléchargement.
    const saved = flushSave()
    if (saved && !saved.ok && saved.reason === 'quota') logoError.value = t('reportPdf.brand.quota')
}
const onPick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    await takeFile(file)
}
const onDrop = async (e) => {
    dragOver.value = false
    await takeFile(e.dataTransfer?.files?.[0])
}
const removeLogo = () => {
    logo.value = null
    logoError.value = ''
    // Plus de logo : on n'écrit pas « sans logo » par-dessus, on efface la clé si le reste est vide.
    if (!company.value && !line.value) {
        clearTimeout(saveTimer)
        clearBranding()
    }
}

const onDownload = () => {
    if (props.busy) return
    if (advancedChosen.value) {
        if (canEdit.value) flushSave()
        emit('download', {
            advanced: true,
            branding: { company: company.value.trim(), line: line.value.trim(), logo: logo.value },
            fields: { ...fields },
        })
    } else {
        emit('download', { advanced: false })
    }
}
</script>

<style lang="scss" scoped>
.rpd {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    padding: 40px var(--sp-5) var(--sp-5);
    width: min(520px, 100vw - 32px);
    max-width: 100%;
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    box-sizing: border-box;

    &__title {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--fs-18);
        color: var(--text);
    }
    &__intro,
    &__hint,
    &__note {
        margin: 0;
        font-size: var(--fs-13);
        line-height: 1.5;
        color: var(--text-2);
    }
    &__hint {
        color: var(--text);
    }
    &__note {
        color: var(--text-3);
    }
    &__locked {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-2);
        margin: 0;
        padding: var(--sp-3);
        border-radius: var(--radius);
        background: var(--info-bg);
        color: var(--info);
        font-size: var(--fs-13);
        line-height: 1.5;
    }
    &__lock {
        flex: 0 0 auto;
        margin-top: 1px;
    }
    &__section {
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
    }
    &__h {
        margin: var(--sp-2) 0 0;
        font-size: var(--fs-14);
        color: var(--text);
    }
    &__drop {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--sp-3);
        padding: var(--sp-3);
        border: 1px dashed var(--border-strong);
        border-radius: var(--radius);
        background: var(--surface-2);

        &--over {
            border-color: var(--accent);
        }
    }
    &__droptext {
        font-size: var(--fs-13);
        color: var(--text-2);
    }
    &__logo {
        max-width: 100%;
        max-height: 80px;
        object-fit: contain;
        background: #ffffff;
        border: 1px solid var(--border);
        border-radius: var(--radius);
    }
    &__logo-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2);
    }
    &__file {
        display: none;
    }
    &__error {
        margin: 0;
        font-size: var(--fs-13);
        color: var(--danger);
    }
    &__area {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
    }
    &__arealabel {
        font-size: var(--fs-12);
        color: var(--text-2);
    }
    &__textarea {
        font: inherit;
        font-size: var(--fs-14);
        padding: var(--sp-2);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius);
        resize: vertical;
        color: var(--text);
        background: var(--surface);
    }
    &__actions {
        display: flex;
        justify-content: flex-end;
        padding-top: var(--sp-2);
    }
}
</style>
