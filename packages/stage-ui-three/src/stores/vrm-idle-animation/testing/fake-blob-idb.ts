/**
 * In-memory IndexedDB stand-in that stores `Blob` values, mirroring the string
 * fake used by stage-shared's personality persistence but for binary VRMA data.
 *
 * Unlike the personality fake, this models real IndexedDB close semantics: a
 * database connection that has been `close()`d throws `InvalidStateError` on a
 * subsequent `transaction()` call, and each `open()` returns a fresh connection
 * backed by the same shared data store. This is what lets the regression test
 * catch the persistence module reusing a closed connection.
 */
export function createFakeBlobIdb() {
  const stores = new Map<string, Map<string, Blob>>()

  function createDatabaseConnection() {
    let closed = false

    function assertOpen() {
      if (closed) {
        throw new DOMException('The database connection is closing.', 'InvalidStateError')
      }
    }

    return {
      objectStoreNames: {
        contains: (name: string) => stores.has(name),
      },
      createObjectStore: (name: string) => {
        assertOpen()
        stores.set(name, new Map())
      },
      transaction: (_storeName: string, _mode: IDBTransactionMode) => {
        assertOpen()
        return {
          objectStore: () => {
            const store = stores.get(_storeName)!
            return {
              get: (id: string) => storeRequest(() => store.get(id)),
              put: (value: Blob, id: string) => storeRequest(() => store.set(id, value)),
              delete: (id: string) => storeRequest(() => store.delete(id)),
            }
          },
        }
      },
      close: () => {
        closed = true
      },
    }
  }

  const open = (_name: string, _version?: number): IDBOpenDBRequest => {
    const database = createDatabaseConnection()
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

interface FakeRequest {
  result: unknown
  error: DOMException | null
  onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null
  onsuccess: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
}
