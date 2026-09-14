import type { MaybeRefOrGetter } from 'vue'

import { useIdlePersonalityStore } from '@proj-airi/stage-shared/personality'
import { computed, onScopeDispose, toValue, watch } from 'vue'

export interface IdlePersonalityCyclerOptions {
  paused?: MaybeRefOrGetter<boolean>
  nowSpeaking?: MaybeRefOrGetter<boolean>
  motionControlOwnerId?: MaybeRefOrGetter<string | null>
  isIdle?: MaybeRefOrGetter<boolean>
  random?: () => number
}

export interface IdlePersonalityCycler {
  start: () => void
  stop: () => void
  kick: () => void
}

/**
 * Cycles the idle personality while the stage is idle.
 *
 * The cycler owns nothing besides the selection timer. `activePersonalityId`
 * on the shared store is the single source of truth for what is playing;
 * renderers react to it. Gated ticks are dropped silently, and the timer
 * chain reschedules whenever the store interval changes.
 *
 * Exposed controls:
 * - `start()` picks immediately, then arms the interval chain.
 * - `stop()` cancels the timer.
 * - `kick()` picks immediately without touching the timer.
 */
export function useIdlePersonalityCycler(options: IdlePersonalityCyclerOptions = {}): IdlePersonalityCycler {
  const {
    paused = false,
    nowSpeaking = false,
    motionControlOwnerId = null,
    isIdle = true,
    random = Math.random,
  } = options

  const store = useIdlePersonalityStore()

  const gated = computed(() => (
    !toValue(isIdle)
    || toValue(paused)
    || toValue(nowSpeaking)
    || toValue(motionControlOwnerId) !== null
  ))

  let running = false
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function pick() {
    if (gated.value)
      return

    let next: string | null
    if (store.randomizeEnabled)
      next = store.pickNextIdlePersonality(random)
    else if (store.pinnedId && store.enabledIds.includes(store.pinnedId))
      next = store.pinnedId
    else
      next = null

    if (next !== null)
      store.setActivePersonalityId(next)
  }

  function arm() {
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      pick()
      if (running)
        arm()
    }, store.intervalMs)
  }

  function start() {
    if (running)
      return
    running = true
    pick()
    arm()
  }

  function stop() {
    running = false
    clearTimer()
  }

  watch(
    () => store.intervalMs,
    () => {
      if (running)
        arm()
    },
  )

  onScopeDispose(stop)

  return { start, stop, kick: pick }
}
