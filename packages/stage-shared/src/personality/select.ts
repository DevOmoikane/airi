/**
 * Picks the next idle personality id from the enabled set, never repeating
 * the current id when more than one personality is enabled.
 *
 * @param enabledIds ids currently available for selection
 * @param current the currently active id, excluded from the pool when possible
 * @param random uniform `[0, 1)` source
 * @returns a selected enabled id, or `null` when nothing is enabled
 */
export function pickNextIdlePersonality(
  enabledIds: readonly string[],
  current: string | null,
  random: () => number = Math.random,
): string | null {
  if (enabledIds.length === 0)
    return null

  if (enabledIds.length === 1)
    return enabledIds[0]

  const candidates = enabledIds.filter(id => id !== current)
  const pool = candidates.length > 0 ? candidates : enabledIds
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}
