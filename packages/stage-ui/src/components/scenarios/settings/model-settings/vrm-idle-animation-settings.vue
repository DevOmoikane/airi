<script setup lang="ts">
import { useVrmIdleAnimationStore } from '@proj-airi/stage-ui-three'
import { Button, Checkbox, FieldInputFile, GhostButton } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../layouts'

const { t } = useI18n()
const store = useVrmIdleAnimationStore()
const {
  bundledClips,
  customClips,
  enabledIds,
} = storeToRefs(store)

const importFiles = ref<File[] | undefined>(undefined)
const importError = ref<string | null>(null)
const importing = ref(false)

async function handleImport(files?: File[]) {
  const file = files?.at(0)
  if (!file)
    return

  importError.value = null
  importing.value = true
  try {
    await store.importClip(file)
  }
  catch {
    importError.value = t('settings.vrm.idle-animation.import-error')
  }
  finally {
    importing.value = false
    importFiles.value = undefined
  }
}

const resetting = ref(false)

async function handleReset() {
  resetting.value = true
  try {
    await store.resetToDefaults()
  }
  finally {
    resetting.value = false
  }
}
</script>

<template>
  <Section
    :title="t('settings.vrm.idle-animation.title')"
    icon="i-solar:gallery-circle-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80  dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="false"
  >
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ t('settings.vrm.idle-animation.description') }}
    </p>

    <div
      flex flex-col gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-700
    >
      <div class="text-sm font-medium">
        {{ t('settings.vrm.idle-animation.bundled-title') }}
      </div>
      <div
        v-for="clip in bundledClips"
        :key="clip.id"
        class="flex items-center justify-between gap-2"
      >
        <div class="min-w-0">
          <div class="truncate text-sm text-neutral-700 dark:text-neutral-300">
            {{ clip.name }}
          </div>
        </div>
        <Checkbox
          class="shrink-0"
          :model-value="enabledIds.includes(clip.id)"
          @update:model-value="value => store.setEnabled(clip.id, value)"
        />
      </div>
    </div>

    <div
      v-if="customClips.length > 0"
      flex flex-col gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-700
    >
      <div class="text-sm font-medium">
        {{ t('settings.vrm.idle-animation.custom-title') }}
      </div>
      <div
        v-for="entry in customClips"
        :key="entry.id"
        class="flex items-center justify-between gap-2"
      >
        <div class="min-w-0">
          <div class="truncate text-sm text-neutral-700 dark:text-neutral-300">
            {{ entry.name }}
          </div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ t('settings.vrm.idle-animation.imported-at', { date: new Date(entry.importedAt).toLocaleDateString() }) }}
          </div>
        </div>
        <div flex items-center gap-3>
          <Checkbox
            class="shrink-0"
            :model-value="enabledIds.includes(entry.id)"
            @update:model-value="value => store.setEnabled(entry.id, value)"
          />
          <GhostButton class="shrink-0 text-xs" @click="store.removeCustom(entry.id)">
            {{ t('settings.vrm.idle-animation.remove') }}
          </GhostButton>
        </div>
      </div>
    </div>

    <FieldInputFile
      v-model="importFiles"
      accept=".vrma"
      :label="t('settings.vrm.idle-animation.import')"
      @update:model-value="handleImport"
    />
    <div v-if="importError" class="text-xs text-red-500">
      {{ importError }}
    </div>

    <Button
      class="mt-2 w-full"
      :disabled="resetting"
      :loading="resetting"
      @click="handleReset"
    >
      {{ t('settings.vrm.idle-animation.reset-to-defaults') }}
    </Button>
  </Section>
</template>
