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
}

module.exports = nextConfig
