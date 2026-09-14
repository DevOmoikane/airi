<script setup lang="ts">
import { FieldCheckbox } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import { useLive2DMotionMagicSettings } from '../settings'

const { t } = useI18n()
const { forceViewTarget, skipMouthOpen } = storeToRefs(useLive2DMotionMagicSettings())
</script>

<template>
  <div :class="['grid gap-3']">
    <FieldCheckbox
      v-model="skipMouthOpen"
      :label="t('settings.live2d.animation.motion-driver.magic.skip-mouth-open.title')"
      :description="t('settings.live2d.animation.motion-driver.magic.skip-mouth-open.description')"
      placement="right"
    />
    <FieldCheckbox
      v-model="forceViewTarget"
      :label="t('settings.live2d.animation.motion-driver.magic.force-view-target.title')"
      :description="t('settings.live2d.animation.motion-driver.magic.force-view-target.description')"
      placement="right"
    />
  </div>
</template>
