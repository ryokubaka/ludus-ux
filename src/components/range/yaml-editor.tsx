"use client"

import dynamic from "next/dynamic"
import { loader } from "@monaco-editor/react"

// Serve Monaco from local static files (copied by scripts/copy-monaco.js at build/dev time).
//
// workerMain.js loads the AMD loader as `MonacoEnvironment.baseUrl + "vs/loader.js"`.
// So assets must live at …/monaco-vs/vs/loader.js and baseUrl must be …/monaco-vs/
// (parent of the `vs` directory, trailing slash). A flat copy into /monaco-vs/ alone
// makes that URL 404 and nls then logs "Failed trying to load default language strings".
//
// `paths.vs` is the AMD root (the `vs` folder). `availableLanguages['*'] === ''` is falsy
// in the loader so nls falls back to the default `.nls` bundles shipped under vs/.
const monacoParent =
  typeof window !== "undefined" ? `${window.location.origin}/monaco-vs/` : "/monaco-vs/"
const monacoVsAmd =
  typeof window !== "undefined" ? `${window.location.origin}/monaco-vs/vs` : "/monaco-vs/vs"
if (typeof window !== "undefined") {
  const w = window as Window & { MonacoEnvironment?: { baseUrl?: string } }
  w.MonacoEnvironment = { ...w.MonacoEnvironment, baseUrl: monacoParent }
}
loader.config({
  paths: { vs: monacoVsAmd },
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
