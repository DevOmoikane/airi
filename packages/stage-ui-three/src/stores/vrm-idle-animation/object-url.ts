/**
 * Isolated boundary for URL.createObjectURL / URL.revokeObjectURL
 * so Vitest unit tests running in JSDOM can stub or mock this module safely.
 */
export function createObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob)
}

export function revokeObjectUrl(url: string): void {
  URL.revokeObjectURL(url)
}
