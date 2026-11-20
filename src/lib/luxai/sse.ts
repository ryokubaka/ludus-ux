/** Read a Server-Sent Event response and emit each event as it arrives. */

export async function readSse(
  response: Response,
  onData: (data: string, eventName: string) => void,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ""
  let size = 0
  let eventName = ""
  const pending: string[] = []
  const flush = () => {
    const data = pending.join("\n")
    const name = eventName
    pending.length = 0
    eventName = ""
    if (data && data !== "[DONE]") onData(data, name)
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2_000_000) {
        await reader.cancel()
        throw new Error("The model response was larger than 2 MB.")
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) flush()
        else if (trimmed.startsWith("event:")) eventName = trimmed.slice(6).trim()
        else if (trimmed.startsWith("data:")) pending.push(trimmed.slice(5).trim())
      }
    }
    flush()
  } catch (err) {
    await reader.cancel().catch(() => undefined)
    throw err
  }
}
