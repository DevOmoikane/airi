/**
 * In-memory stand-in for the IndexedDB `open` boundary used by the idle
 * personality persistence module. Fire-and-forget store operations resolve on
 * a microtask, mirroring real IndexedDB's async request events.
 */
export interface FakeIdb {
  open: (name: string, version?: number) => IDBOpenDBRequest
  stores: Map<string, Map<string, string>>
}

interface FakeRequest {
  result: unknown
  error: DOMException | null
  onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null
  onsuccess: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
}

export function createFakeIdb(): FakeIdb {
  const stores = new Map<string, Map<string, string>>()

  const database = {
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    createObjectStore: (name: string) => {
      stores.set(name, new Map())
    },
    transaction: (_storeName: string, _mode: IDBTransactionMode) => ({
      objectStore: () => {
        const store = stores.get(_storeName)!
        return {
          get: (id: string) => storeRequest(() => store.get(id)),
          put: (value: string, id: string) => storeRequest(() => store.set(id, value)),
          delete: (id: string) => storeRequest(() => store.delete(id)),
        }
      },
    }),
    close: () => {},
  }

  const open = (_name: string, _version?: number): IDBOpenDBRequest => {
    const request: FakeRequest = {
      result: undefined,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
    }
    queueMicrotask(() => {
      request.result = database
      request.onupgradeneeded?.({} as IDBVersionChangeEvent)
      request.onsuccess?.({} as Event)
    })
    return request as unknown as IDBOpenDBRequest
  }

  function storeRequest(run: () => unknown): IDBRequest<unknown> {
    const request: FakeRequest = {
      result: undefined,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
    }
    queueMicrotask(() => {
      request.result = run()
      request.onsuccess?.({} as Event)
    })
    return request as unknown as IDBRequest<unknown>
  }

  return { open, stores }
}
