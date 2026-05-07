import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const configDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(configDir, "..")

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    root: projectRoot,
  },
  resolve: {
    alias: {
      "@": path.join(projectRoot, "src"),
    },
  },
})
