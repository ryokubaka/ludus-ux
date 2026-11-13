export const RELEASE_PAGE_SIZE = 10

export function releasePageCount(count: number, pageSize = RELEASE_PAGE_SIZE): number {
  if (count <= 0) return 1
  return Math.ceil(count / pageSize)
}

/** Page index clamped to the list. An empty list stays on page 0. */
export function releasePageIndex(count: number, page: number, pageSize = RELEASE_PAGE_SIZE): number {
  if (count <= 0) return 0
  const pages = releasePageCount(count, pageSize)
  return Math.min(Math.max(0, page), pages - 1)
}

export function releasePageSlice<T>(items: T[], page: number, pageSize = RELEASE_PAGE_SIZE): T[] {
  const safe = releasePageIndex(items.length, page, pageSize)
  const start = safe * pageSize
  return items.slice(start, start + pageSize)
}

export function releasePageRange(
  count: number,
  page: number,
  pageSize = RELEASE_PAGE_SIZE,
): { from: number; to: number; page: number; pages: number } {
  const pages = releasePageCount(count, pageSize)
  const safe = releasePageIndex(count, page, pageSize)
  if (count <= 0) return { from: 0, to: 0, page: 0, pages }
  return {
    from: safe * pageSize + 1,
    to: Math.min(count, (safe + 1) * pageSize),
    page: safe,
    pages,
  }
}
