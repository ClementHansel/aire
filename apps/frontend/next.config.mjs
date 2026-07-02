import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Pin the file-tracing root to this monorepo. Without it, Next walks up and
  // finds an unrelated package-lock.json in a parent folder, infers the wrong
  // workspace root, and traces/symlinks a huge tree (which also breaks the
  // standalone copy on Windows). '../../' → the aire repo root (and /app in Docker).
  outputFileTracingRoot: path.join(__dirname, '../../'),
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
  // Proxy /api to the backend so the frontend works even when accessed directly
  // (e.g. on :3000), not only through nginx. When behind nginx, nginx handles
  // /api first and this rewrite is never reached.
  async rewrites() {
    const backend = process.env.BACKEND_ORIGIN || 'http://backend:4000';
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/socket.io/:path*', destination: `${backend}/socket.io/:path*` },
    ];
  },
};

export default nextConfig;

