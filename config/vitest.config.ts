import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const configDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(configDir, "..")

export default defineConfig({
  // tsconfig keeps jsx "preserve" for Next. Vite cannot analyze preserved JSX
  // when a test imports a .tsx module, so tests compile it here.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    root: projectRoot,
  },
  resolve: {
    alias: {
      "@": path.join(projectRoot, "src"),
      "server-only": path.join(configDir, "vitest-server-only-stub.ts"),
    },
  },
})
