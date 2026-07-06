import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import reactHooks from "eslint-plugin-react-hooks"

const config = [
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
  ...nextCoreWebVitals,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      // react-hooks v7 (via eslint-config-next 16) — opt out until codebase is React Compiler–ready
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
]

export default config
