/**
 * Vitest setup for stage-ui-three.
 *
 * Node 22+ ships an experimental `localStorage` global getter that resolves to
 * `undefined` unless Node is launched with `--localstorage-file`. vitest 4's
 * jsdom environment does not propagate jsdom's own `localStorage` onto the
 * global because the key already exists on `globalThis` and is not part of the
 * propagated window key set. This leaves every jsdom test that touches
 * `localStorage` (existing and new) failing with "Cannot read properties of
 * undefined (reading 'clear')".
 *
 * NOTICE:
 * - Root cause: Node's native `localStorage` getter shadows jsdom's, and
 *   vitest skips propagating it (see vitest `getWindowKeys`).
 * - Source/context: Node v26.4.0 + vitest 4.1.11 jsdom environment.
 * - Removal condition: when a Node/ vitest combination restores jsdom
 *   `localStorage` propagation, or tests run in Vitest browser mode.
 */
import { beforeEach } from 'vitest'

const memoryStorage = new Map<string, string>()

function createStorage(): Storage {
  return {
    get length() {
      return memoryStorage.size
    },
    clear() {
      memoryStorage.clear()
    },
    getItem(key) {
      return memoryStorage.has(key) ? memoryStorage.get(key)! : null
    },
    key(index) {
      return [...memoryStorage.keys()][index] ?? null
    },
    removeItem(key) {
      memoryStorage.delete(key)
    },
    setItem(key, value) {
      memoryStorage.set(key, String(value))
    },
  }
}

beforeEach(() => {
  if (typeof globalThis.localStorage === 'undefined')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: createStorage() })
})
