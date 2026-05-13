import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { FlatCompat } from "@eslint/eslintrc"

const __dirname = dirname(fileURLToPath(import.meta.url))

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

export default [
  {
    ignores: [
      "**/node_modules/**",
      ".next/**",
      "out/**",
      "public/monaco-vs/**",
      "public/novnc/**",
      "coverage/**",
      "*.config.js",
      "*.config.cjs",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]
