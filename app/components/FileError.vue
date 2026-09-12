<template>
    <div class="file">
        <div class="file__display">
            {{ t('files.importFailed') }}
        </div>
        <p class="file__name">
            {{ file.name }}
        </p>
        <!-- Lot 2c : la CAUSE du refus, avec ses nombres, quand le serveur
             l'a écrite (`importRefusal`, lot 2a). Sans elle, l'utilisateur
             ne lisait que « Échec de l'import ». -->
        <p v-if="refusal" class="file__reason">
            {{ refusal }}
        </p>
        <MainButton
            :size="sizeType.s"
            :theme="themeType.secondary"
            href="https://github.com/guiguijke/nestorcut/issues/new"
            target="_blank"
            :label="t('nav.reportProblem')"
            tag="a"
            trackingTag="report_problem"
            class="file__problem"
        />
    </div>
</template>
<script setup>
import { sizeType } from "~~/constants/size.constants";
import { themeType } from '~~/constants/theme.constants';
import { refusalMessage } from '~/composables/importFindings';

const { t, fmtNumber } = useLocale()

const props = defineProps({
    file: {
        type: Object,
        required: true
    },
})

const refusal = computed(() =>
    refusalMessage(props.file.importRefusal, t, (v) => fmtNumber(v, 0)),
)

</script>

<style lang="scss" scoped>
.file {
    position: relative;
    $self: &;
    padding: 12px;
    border-radius: var(--radius-l);
    border: 1px solid var(--separator-secondary);
    transition: border-color 0.3s;

    &__display {
        width: 56px;
        height: 56px;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        border-radius: var(--radius-l);
        background-color: var(--error-background);
        border: solid 1px var(--error-border);
        color: var(--label-primary);
        font-size: var(--fs-12);
        padding: 4px;
    }
    &__reason {
        margin-bottom: 16px;
        font-size: var(--fs-12);
        color: var(--label-secondary);
    }
    &__name {
        margin-top: 16px;
        margin-bottom: 16px;
        color: var(--label-secondary);
        transition: color 0.3s;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    &__btn {
        opacity: 0;
        position: absolute;
        top: 8px;
        right: 8px;
        transition: opacity 0.3s;
    }
    &__problem {
        margin-left: auto;
        margin-right: auto;
    }

    @media (hover:hover) {
        &:hover {
            border-color: var(--separator-primary);

            #{$self}__name {
                color: var(--label-primary);
            }
            #{$self}__btn {
                opacity: 1;
            }
        }
    }
}
</style>
