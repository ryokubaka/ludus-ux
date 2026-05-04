/**
 * Copies Monaco Editor's VS distribution files from node_modules into public/monaco-vs/vs
 * so the editor can be served locally without any CDN dependency.
 *
 * Layout must match what workerMain.js expects: `MonacoEnvironment.baseUrl + "vs/loader.js"`
 * resolves to the AMD loader. So the `vs` directory (contents of monaco-editor/min/vs) lives
 * under public/monaco-vs/vs/, and baseUrl is …/monaco-vs/ (see yaml-editor.tsx).
 *
 * Run automatically via `npm run dev` and `npm run build` (see package.json scripts).
 * Always syncs with `force: true` so upgrades / partial copies do not leave a stale tree.
 */

const fs = require("fs")
const path = require("path")

const src = path.join(__dirname, "..", "node_modules", "monaco-editor", "min", "vs")
const destRoot = path.join(__dirname, "..", "public", "monaco-vs")
const dest = path.join(destRoot, "vs")

if (!fs.existsSync(src)) {
  console.warn("[copy-monaco] monaco-editor not found in node_modules – skipping copy.")
  process.exit(0)
}

// Legacy layout copied min/vs *files* into public/monaco-vs/ (loader at monaco-vs/loader.js).
// Worker always loads baseUrl + "vs/loader.js" → that 404 broke nls. Remove flat tree if present.
const legacyLoader = path.join(destRoot, "loader.js")
if (fs.existsSync(legacyLoader)) {
  fs.rmSync(destRoot, { recursive: true, force: true })
}

console.log("[copy-monaco] Syncing monaco-editor/min/vs → public/monaco-vs/vs …")
fs.mkdirSync(dest, { recursive: true })
fs.cpSync(src, dest, { recursive: true, force: true })
console.log("[copy-monaco] Done.")
