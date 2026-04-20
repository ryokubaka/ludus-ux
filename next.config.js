/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['ssh2', 'better-sqlite3'],
  eslint: {
    // ESLint runs separately in CI; don't fail the Docker build over warnings
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Type errors are caught in dev; don't block the Docker build
    ignoreBuildErrors: false,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // ssh2 uses native modules (cpu-features, bcrypt-pbkdf) that need to be externalized
      config.externals = config.externals || []
      if (!Array.isArray(config.externals)) {
        config.externals = [config.externals]
      }
      config.externals.push('ssh2')
      config.externals.push('better-sqlite3')
    }
    return config
  },
  // Browsers still probe `/favicon.ico` directly (bookmark bar, history
  // contexts) regardless of the `<link rel="icon">` tag emitted from
  // `metadata.icons`. Route that probe at the existing `/api/logo` endpoint
  // so the favicon is always the current LUX logo (custom upload or bundled
  // default) and the console no longer shows a 404.
  async rewrites() {
    return [
      { source: '/favicon.ico', destination: '/api/logo' },
    ]
  },
}

module.exports = nextConfig
