/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@aire/shared'],
  reactStrictMode: true,
  typescript: {
    // Type checking is handled by tsc --noEmit in CI.
    // Page files export testable interfaces/types which conflict with App Router constraints.
    ignoreBuildErrors: true,
  },
  eslint: {
    // Lint only source files, not test files, during build.
    dirs: ['src/app', 'src/components', 'src/hooks', 'src/lib', 'src/stores'],
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
