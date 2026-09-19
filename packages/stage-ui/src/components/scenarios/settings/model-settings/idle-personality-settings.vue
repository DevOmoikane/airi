<script setup lang="ts">
import { useIdlePreviewState } from '@proj-airi/stage-shared/composables'
import { bundledIdlePersonalityEntryById, parseLive2DMotionRecording, useIdlePersonalityStore } from '@proj-airi/stage-shared/personality'
import { Button, Checkbox, FieldCheckbox, FieldInputFile, FieldRange, FieldSelect, GhostButton } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../layouts'

const { t } = useI18n()
const store = useIdlePersonalityStore()
const {
  customPersonalities,
  enabledIds,
  intervalMs,
  pinnedId,
  randomizeEnabled,
} = storeToRefs(store)

const preview = useIdlePreviewState()
const previewingPersonalityId = computed(() => preview.state.value.personalityId)

function togglePersonalityPreview(id: string) {
  if (previewingPersonalityId.value === id)
    preview.stopIdlePreview()
  else
    preview.startPersonalityPreview(id)
}

const bundledIds = Object.keys(bundledIdlePersonalityEntryById)

const knownIds = computed(() => [
  ...bundledIds,
  ...customPersonalities.value.map(entry => entry.id),
])

function personalityLabel(id: string): string {
  if (bundledIds.includes(id))
    return t(`settings.personality.list.bundled.name.${id}`)
  return customPersonalities.value.find(entry => entry.id === id)?.name ?? id
}

function personalityDescription(id: string): string | undefined {
  if (bundledIds.includes(id))
    return t(`settings.personality.list.bundled.description.${id}`)
  return undefined
}

function isEnabled(id: string): boolean {
  return enabledIds.value.includes(id)
}

const pinnedOptions = computed(() => knownIds.value.map(id => ({
  label: personalityLabel(id),
  value: id,
})))

const intervalSeconds = computed({
  get: () => Math.round(intervalMs.value / 1000),
  set: (value: number) => store.setIntervalMs(value * 1000),
})

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
    const recording = parseLive2DMotionRecording(await file.text())
    const name = file.name.replace(/\.json$/i, '')
    await store.addCustomDataset(recording, name)
  }
  catch {
    importError.value = t('settings.personality.custom.import-error')
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
    :title="t('settings.personality.title')"
    icon="i-solar:face-scan-circle-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80  dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="false"
  >
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ t('settings.personality.description') }}
    </p>

    <FieldRange
      v-model="intervalSeconds"
      as="div"
      :min="15"
      :max="90"
      :step="1"
      :label="t('settings.personality.interval')"
      :description="t('settings.personality.interval-hint')"
      :format-value="(value: number) => `${value}s`"
    />
    <FieldCheckbox
      :model-value="randomizeEnabled"
      :label="t('settings.personality.randomize')"
      placement="right"
      @update:model-value="store.setRandomizeEnabled"
    />
    <FieldSelect
      v-if="!randomizeEnabled"
      :model-value="pinnedId"
      :label="t('settings.personality.pinned')"
      :options="pinnedOptions"
      @update:model-value="value => store.setPinnedId(value as string | null)"
    />

    <div
      flex flex-col gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-700
    >
      <div class="text-sm font-medium">
        {{ t('settings.personality.list.title') }}
      </div>
      <div
        v-for="id in bundledIds"
        :key="id"
        class="flex items-center justify-between gap-2"
      >
        <div class="min-w-0">
          <div class="truncate text-sm text-neutral-700 dark:text-neutral-300">
            {{ personalityLabel(id) }}
          </div>
          <div v-if="personalityDescription(id)" class="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {{ personalityDescription(id) }}
          </div>
        </div>
        <div flex items-center gap-2>
          <GhostButton
            class="shrink-0"
            size="sm"
            :active="previewingPersonalityId === id"
            :label="t(previewingPersonalityId === id
              ? 'settings.personality.stop-preview'
              : 'settings.personality.preview')"
            :icon="previewingPersonalityId === id
              ? 'i-solar:stop-circle-bold-duotone'
              : 'i-solar:play-circle-bold-duotone'"
            @click="togglePersonalityPreview(id)"
          />
          <Checkbox
            class="shrink-0"
            :model-value="isEnabled(id)"
            @update:model-value="value => store.setEnabled(id, value)"
          />
        </div>
      </div>
    </div>

    <div
      v-if="customPersonalities.length > 0"
      flex flex-col gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-700
    >
      <div
        v-for="entry in customPersonalities"
        :key="entry.id"
        class="flex items-center justify-between gap-2"
      >
        <div class="min-w-0">
          <div class="truncate text-sm text-neutral-700 dark:text-neutral-300">
            {{ entry.name }}
          </div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ t('settings.personality.custom.imported-at', { date: new Date(entry.importedAt).toLocaleDateString() }) }}
          </div>
        </div>
        <div flex items-center gap-2>
          <GhostButton
            class="shrink-0"
            size="sm"
            :active="previewingPersonalityId === entry.id"
            :label="t(previewingPersonalityId === entry.id
              ? 'settings.personality.stop-preview'
              : 'settings.personality.preview')"
            :icon="previewingPersonalityId === entry.id
              ? 'i-solar:stop-circle-bold-duotone'
              : 'i-solar:play-circle-bold-duotone'"
            @click="togglePersonalityPreview(entry.id)"
          />
          <Checkbox
            class="shrink-0"
            :model-value="isEnabled(entry.id)"
            @update:model-value="value => store.setEnabled(entry.id, value)"
          />
          <GhostButton class="shrink-0 text-xs" @click="store.removeCustom(entry.id)">
            {{ t('settings.personality.custom.remove') }}
          </GhostButton>
        </div>
      </div>
    </div>

    <FieldInputFile
      v-model="importFiles"
      accept="application/json,.json"
      :label="t('settings.personality.custom.import')"
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
      {{ t('settings.personality.custom.reset-to-defaults') }}
    </Button>
  </Section>
</template>
