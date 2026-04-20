"use client"

import dynamic from "next/dynamic"
import { loader } from "@monaco-editor/react"

// Serve Monaco from the local /monaco-vs path (copied from node_modules at build time)
// instead of loading from cdn.jsdelivr.net, so the editor works in air-gapped / restricted
// network environments and doesn't suffer from CDN latency on first load.
//
// `'vs/nls'.availableLanguages = { '*': '' }` forces Monaco's worker to use
// its built-in English strings instead of trying to fetch `vs/nls.messages.*`
// files that we don't ship in public/monaco-vs. Without this you get a benign
// but noisy "Failed trying to load default language strings — Not Found"
// warning from workerMain.js on every Range Config / yaml editor load.
loader.config({
  paths: { vs: "/monaco-vs" },
  "vs/nls": { availableLanguages: { "*": "" } },
})

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-black/60 rounded-md">
      <span className="text-muted-foreground text-sm animate-pulse">Loading editor...</span>
    </div>
  ),
})

interface YamlEditorProps {
  value: string
  onChange: (value: string) => void
  height?: string
  readOnly?: boolean
}

export function YamlEditor({
  value,
  onChange,
  height = "500px",
  readOnly = false,
}: YamlEditorProps) {
  return (
    <div className="rounded-lg overflow-hidden border border-border" style={{ height }}>
      <MonacoEditor
        height={height}
        language="yaml"
        value={value}
        theme="vs-dark"
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          lineNumbers: "on",
          wordWrap: "on",
          automaticLayout: true,
          tabSize: 2,
          formatOnPaste: true,
        }}
        onChange={(val) => onChange(val || "")}
      />
    </div>
  )
}
