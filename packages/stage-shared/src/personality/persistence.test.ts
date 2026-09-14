import { describe, expect, it } from 'vitest'

import { createIdlePersonalityDatasetDb } from './persistence'

interface PlainRequest {
  result: unknown
  error: DOMException | null
  onupgradeneeded: ((event: unknown) => void) | null
  onsuccess: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
}

function createFakeIdb() {
  const stores = new Map<string, Map<string, string>>()

  const database = {
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    createObjectStore: (name: string) => {
      stores.set(name, new Map())
    },
    transaction: (name: string, _mode: IDBTransactionMode) => ({
      objectStore: () => {
        const store = stores.get(name)!
        return {
          get: (id: string) => storeRequest(() => store.get(id)),
          put: (value: string, id: string) => storeRequest(() => store.set(id, value)),
          delete: (id: string) => storeRequest(() => store.delete(id)),
        }
      },
    }),
    close: () => {},
  }

  const open = (_name: string, _version?: number) => {
    const request: PlainRequest = {
      result: undefined,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
    }
    queueMicrotask(() => {
      request.result = database
      request.onupgradeneeded?.({})
      request.onsuccess?.({})
    })
    return request
  }

  function storeRequest(run: () => unknown): PlainRequest {
    const request: PlainRequest = {
      result: undefined,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
    }
    queueMicrotask(() => {
      request.result = run()
      request.onsuccess?.({})
    })
    return request
  }

  return {
    open,
    stores,
  }
}

describe('createIdlePersonalityDatasetDb', () => {
  it('round-trips a JSON blob through the object store', async () => {
    const fake = createFakeIdb()
    const db = createIdlePersonalityDatasetDb({ open: fake.open } as unknown as Pick<IDBFactory, 'open'>, 'test-db')

    await db.putId('custom-1', '{"samples":[]}')

    await expect(db.getId('custom-1')).resolves.toBe('{"samples":[]}')
  })

  it('resolves undefined for a key that was never saved', async () => {
    const fake = createFakeIdb()
    const db = createIdlePersonalityDatasetDb({ open: fake.open } as unknown as Pick<IDBFactory, 'open'>, 'test-db')

    await expect(db.getId('missing')).resolves.toBeUndefined()
  })

  it('deletes a stored blob', async () => {
    const fake = createFakeIdb()
    const db = createIdlePersonalityDatasetDb({ open: fake.open } as unknown as Pick<IDBFactory, 'open'>, 'test-db')

    await db.putId('custom-1', '{"samples":[]}')
    await db.deleteId('custom-1')

    await expect(db.getId('custom-1')).resolves.toBeUndefined()
  })

  it('isolates values by key', async () => {
    const fake = createFakeIdb()
    const db = createIdlePersonalityDatasetDb({ open: fake.open } as unknown as Pick<IDBFactory, 'open'>, 'test-db')

    await db.putId('custom-1', '{"id":"one"}')
    await db.putId('custom-2', '{"id":"two"}')

    await expect(db.getId('custom-1')).resolves.toBe('{"id":"one"}')
    await expect(db.getId('custom-2')).resolves.toBe('{"id":"two"}')
  })
})
