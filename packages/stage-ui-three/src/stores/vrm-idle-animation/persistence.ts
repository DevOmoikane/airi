export const VRM_IDLE_ANIMATION_BLOBS_STORE = 'vrm-idle-animation-blobs'

/** Minimal IndexedDB-based store for custom VRMA animation clip blobs. */
export interface VrmIdleAnimationBlobDb {
  /** Reads the stored Blob for `id`; resolves `undefined` when absent. */
  getBlob: (id: string) => Promise<Blob | undefined>
  /** Stores the Blob for `id`. */
  putBlob: (id: string, blob: Blob) => Promise<void>
  /** Removes the stored Blob for `id`, if any. */
  deleteBlob: (id: string) => Promise<void>
}

/**
 * Creates an IndexedDB-backed dataset store for custom VRMA blobs.
 * Bundled clips never use this; only custom imports persist here.
 *
 * @param dbFactory `IDBFactory.open` boundary; defaults to the global `indexedDB`
 * @param name database name
 */
export function createVrmIdleAnimationBlobDb(
  dbFactory: Pick<IDBFactory, 'open'> = indexedDB,
  name = 'airi-vrm-idle-animation',
): VrmIdleAnimationBlobDb {
  let databasePromise: Promise<IDBDatabase> | undefined

  function openDatabase(): Promise<IDBDatabase> {
    if (!databasePromise) {
      databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = dbFactory.open(name, 1)
        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(VRM_IDLE_ANIMATION_BLOBS_STORE))
            database.createObjectStore(VRM_IDLE_ANIMATION_BLOBS_STORE)
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
      // Close and drop the cached connection so the next operation reopens a
      // fresh one. Without clearing `databasePromise`, the second operation
      // would reuse this closed connection and `transaction()` would throw.
      database.close()
      databasePromise = undefined
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
    getBlob(id) {
      return withDatabase(database => requestValue(
        database.transaction(VRM_IDLE_ANIMATION_BLOBS_STORE, 'readonly')
          .objectStore(VRM_IDLE_ANIMATION_BLOBS_STORE)
          .get(id),
      ))
    },
    async putBlob(id, blob) {
      await withDatabase(database => requestValue(
        database.transaction(VRM_IDLE_ANIMATION_BLOBS_STORE, 'readwrite')
          .objectStore(VRM_IDLE_ANIMATION_BLOBS_STORE)
          .put(blob, id),
      ))
    },
    async deleteBlob(id) {
      await withDatabase(database => requestValue(
        database.transaction(VRM_IDLE_ANIMATION_BLOBS_STORE, 'readwrite')
          .objectStore(VRM_IDLE_ANIMATION_BLOBS_STORE)
          .delete(id),
      ))
    },
  }
}
