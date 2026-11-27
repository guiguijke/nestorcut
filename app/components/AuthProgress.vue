<template>
    <div class="authenticating">
        <MainTitle 
            :label="t('auth.progressTitle')"
            class="authenticating__title"
        />
        <MainLoader
            :size="sizeType.l"
            class="authenticating__loader"
        />
        <p class="authenticating__text">
            {{ t('auth.progressText') }}
        </p>
    </div>
</template>
<script setup>
import { sizeType } from "~~/constants/size.constants";

const { t } = useLocale();
</script>
<style lang="scss" scoped>
.authenticating {
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    
    &__loader {
        margin-top: 20px;
        margin-bottom: 40px;
        width: 120px;
        height: 120px;
    }
    &__text {
        color: var(--label-primary);
    }
}
</style>