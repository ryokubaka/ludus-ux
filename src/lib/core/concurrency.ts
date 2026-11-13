/**
 * Run an async mapper over `items` with a bounded number of workers.
 * Results keep the input order. Used for SSH/API fan-out where a serial loop
 * is too slow and an unbounded `Promise.all` would open too many connections.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  const results = new Array<R>(items.length)
  let next = 0

  const worker = async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index]!, index)
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()))
  return results
}
