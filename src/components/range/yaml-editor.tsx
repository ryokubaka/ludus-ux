"use client"

import dynamic from "next/dynamic"

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
        beforeMount={(monaco) => {
          // Add Ludus range config schema
          monaco.languages.yaml?.yamlDefaults?.setDiagnosticsOptions?.({
            validate: true,
            schemas: [
              {
                uri: "https://docs.ludus.cloud/schemas/range-config.json",
                fileMatch: ["*"],
              },
            ],
          })
        }}
      />
    </div>
  )
}
