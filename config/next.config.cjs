/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  serverExternalPackages: ["ssh2", "better-sqlite3"],
  eslint: {
    ignoreDuringBuilds: true,
  },
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
