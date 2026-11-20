/** Plain text for a Ludus doc page. Script and style go first, then the remaining tags, then one entity decode. */
export function htmlToText(html: string): string {
  const withoutBlocks = stripElement(stripElement(html, "script"), "style")
  return decodeEntities(withoutBlocks.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

function stripElement(html: string, tag: string): string {
  const lower = html.toLowerCase()
  const open = `<${tag}`
  const close = `</${tag}`
  let out = ""
  let cursor = 0
  while (cursor < html.length) {
    const start = lower.indexOf(open, cursor)
    if (start === -1) {
      out += html.slice(cursor)
      break
    }
    const boundary = lower[start + open.length]
    if (boundary !== undefined && boundary !== ">" && boundary !== "/" && !/\s/.test(boundary)) {
      out += html.slice(cursor, start + open.length)
      cursor = start + open.length
      continue
    }
    out += html.slice(cursor, start)
    const end = closeTagEnd(lower, close, start + open.length)
    if (end === -1) break
    cursor = end
  }
  return out
}

/** The end tag may contain characters before `>`, as in `</script >`. */
function closeTagEnd(lower: string, close: string, from: number): number {
  const found = lower.indexOf(close, from)
  if (found === -1) return -1
  const gt = lower.indexOf(">", found + close.length)
  if (gt === -1) return -1
  return gt + 1
}

/** One pass, so `&amp;lt;` stays `&lt;` and is not decoded again into `<`. */
function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|nbsp);/g, (entity) => {
    if (entity === "&amp;") return "&"
    if (entity === "&lt;") return "<"
    if (entity === "&gt;") return ">"
    return " "
  })
}
