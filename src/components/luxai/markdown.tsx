"use client"

import { Fragment, type ReactNode } from "react"
import { renderStructured } from "@/lib/luxai/command-output"

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g
  const nodes: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  let index = 0
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${index++}`
    if (token.startsWith("`")) {
      nodes.push(<code key={key} className="rounded bg-black/30 px-1 py-0.5 font-mono text-[0.85em]">{token.slice(1, -1)}</code>)
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    } else {
      const linked = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token)
      if (linked) {
        nodes.push(
          <a key={key} href={linked[2]} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {linked[1]}
          </a>,
        )
      }
    }
    cursor = match.index + token.length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

function isTable(lines: string[], index: number): boolean {
  return /^\|.+\|$/.test(lines[index] || "") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[index + 1] || "")
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim())
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim().toLowerCase()
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i])
        i += 1
      }
      i += 1
      const structured = lang === "json" || lang === "yaml" || lang === "yml" ? renderStructured(code.join("\n")) : null
      if (structured) {
        blocks.push(<Markdown key={key++} text={structured} />)
      } else {
        blocks.push(
          <pre key={key++} className="overflow-auto rounded-md bg-black/50 p-3 text-xs leading-relaxed">
            <code>{code.join("\n")}</code>
          </pre>,
        )
      }
      continue
    }
    if (isTable(lines, i)) {
      const header = tableCells(lines[i])
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\|.+\|$/.test(lines[i])) {
        rows.push(tableCells(lines[i]))
        i += 1
      }
      blocks.push(
        <div key={key++} className="overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>{header.map((cell, cellIndex) => <th key={cellIndex} className="border border-white/15 px-2 py-1 text-left">{renderInline(cell, `h-${key}-${cellIndex}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => <td key={cellIndex} className="border border-white/15 px-2 py-1 align-top">{renderInline(cell, `c-${key}-${rowIndex}-${cellIndex}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    if (/^#{1,3}\s+/.test(line)) {
      const level = line.match(/^#+/)?.[0].length || 1
      const content = line.replace(/^#{1,3}\s+/, "")
      const className = level === 1 ? "text-lg font-semibold" : level === 2 ? "text-base font-semibold" : "text-sm font-semibold"
      blocks.push(<div key={key++} className={className}>{renderInline(content, `hd-${key}`)}</div>)
      i += 1
      continue
    }
    if (line.startsWith("> ")) {
      const quote: string[] = []
      while (i < lines.length && lines[i].startsWith("> ")) {
        quote.push(lines[i].slice(2))
        i += 1
      }
      blocks.push(<blockquote key={key++} className="border-l-2 border-white/30 pl-3 text-sm opacity-90">{renderInline(quote.join(" "), `q-${key}`)}</blockquote>)
      continue
    }
    if (/^(\s*[-*]|\s*\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && /^(\s*[-*]|\s*\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^(\s*[-*]|\s*\d+\.)\s+/, ""))
        i += 1
      }
      const List = ordered ? "ol" : "ul"
      blocks.push(
        <List key={key++} className={ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}>
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `li-${key}-${itemIndex}`)}</li>)}
        </List>,
      )
      continue
    }
    const paragraph: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !/^#{1,3}\s+/.test(lines[i]) && !/^(\s*[-*]|\s*\d+\.)\s+/.test(lines[i]) && !lines[i].startsWith("> ") && !isTable(lines, i)) {
      paragraph.push(lines[i])
      i += 1
    }
    const structured = renderStructured(paragraph.join("\n"))
    if (structured) {
      blocks.push(<Markdown key={key++} text={structured} />)
      continue
    }
    blocks.push(<p key={key++} className="whitespace-pre-wrap">{renderInline(paragraph.join("\n"), `p-${key}`)}</p>)
  }
  return <div className="space-y-2">{blocks.map((block, index) => <Fragment key={index}>{block}</Fragment>)}</div>
}
