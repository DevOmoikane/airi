export const IDLE_PERSONALITY_DATASETS_STORE = 'idle-personality-datasets'

/** Minimal IndexedDB-based store for custom idle personality dataset blobs. */
export interface IdlePersonalityDatasetDb {
  /** Reads the JSON-serialized recording for `id`; resolves `undefined` when absent. */
  getId: (id: string) => Promise<string | undefined>
  /** Stores the JSON-serialized recording for `id`. */
  putId: (id: string, json: string) => Promise<void>
  /** Removes the stored blob for `id`, if any. */
  deleteId: (id: string) => Promise<void>
}

/**
 * Creates an IndexedDB-backed dataset store. Bundled personalities never use
 * this; only custom imports persist here. The database is opened lazily on the
 * first operation and reopened after the instance is garbage collected.
 *
 * @param dbFactory `IDBFactory.open` boundary; defaults to the global `indexedDB`
 * @param name database name
 */
export function createIdlePersonalityDatasetDb(
  dbFactory: Pick<IDBFactory, 'open'> = indexedDB,
  name = 'airi-idle-personality',
): IdlePersonalityDatasetDb {
  let databasePromise: Promise<IDBDatabase> | undefined

  function openDatabase(): Promise<IDBDatabase> {
    if (!databasePromise) {
      databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = dbFactory.open(name, 1)
        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(IDLE_PERSONALITY_DATASETS_STORE))
            database.createObjectStore(IDLE_PERSONALITY_DATASETS_STORE)
        }
        request.onsuccess = () => {
          resolve(request.result)
        }
        request.onerror = () => {
          reject(request.error ?? new Error(`Failed to open IndexedDB database "${name}".`))
        }
      }).catch((error: unknown) => {
        databasePromise = undefined
        throw error
      })
    }
    return databasePromise
  }

  async function withDatabase<T>(run: (database: IDBDatabase) => Promise<T>): Promise<T> {
    const database = await openDatabase()
    try {
      return await run(database)
    }
    finally {
      database.close()
    }
  }

  function requestValue<T>(request: IDBRequest<T>): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result)
      }
      request.onerror = () => {
        reject(request.error ?? new Error('IndexedDB request failed.'))
      }
    })
  }

  return {
    getId(id) {
      return withDatabase(database => requestValue(
        database.transaction(IDLE_PERSONALITY_DATASETS_STORE, 'readonly')
          .objectStore(IDLE_PERSONALITY_DATASETS_STORE)
          .get(id),
      ))
    },
    async putId(id, json) {
      await withDatabase(database => requestValue(
        database.transaction(IDLE_PERSONALITY_DATASETS_STORE, 'readwrite')
          .objectStore(IDLE_PERSONALITY_DATASETS_STORE)
          .put(json, id),
      ))
    },
    async deleteId(id) {
      await withDatabase(database => requestValue(
        database.transaction(IDLE_PERSONALITY_DATASETS_STORE, 'readwrite')
          .objectStore(IDLE_PERSONALITY_DATASETS_STORE)
          .delete(id),
      ))
    },
  }
}
