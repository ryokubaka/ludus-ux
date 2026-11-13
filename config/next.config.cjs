const { fixTailwindSelectorEscapes } = require("../scripts/fix-tailwind-selector-escapes.cjs")

class TailwindSelectorEscapePlugin {
  apply(compiler) {
    const { Compilation, sources } = compiler.webpack
    compiler.hooks.thisCompilation.tap("TailwindSelectorEscapePlugin", (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: "TailwindSelectorEscapePlugin",
          stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE + 1,
        },
        () => {
          for (const { name, source } of compilation.getAssets()) {
            if (!name.endsWith(".css")) continue
            const raw = source.source().toString()
            const fixed = fixTailwindSelectorEscapes(raw)
            if (fixed !== raw) compilation.updateAsset(name, new sources.RawSource(fixed))
          }
        },
      )
    })
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  cacheComponents: true,
  // Cache Components landed here before Partial Prefetching existed.
  // false keeps that prefetch behavior. The next major enables both.
  partialPrefetching: false,
  serverExternalPackages: ["ssh2", "better-sqlite3"],
  typescript: {
    ignoreBuildErrors: false,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || []
      if (!Array.isArray(config.externals)) {
        config.externals = [config.externals]
      }
      config.externals.push("ssh2")
    }
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /[\\/]src[\\/]lib[\\/]db\.ts/, message: /Critical dependency/ },
    ]
    if (!isServer) config.plugins.push(new TailwindSelectorEscapePlugin())
    return config
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ]
  },
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/api/logo" }]
  },
}

module.exports = nextConfig
