import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3', 'exceljs'],
  // Anchor file tracing to THIS project (otherwise Next may infer a parent
  // workspace root and nest the standalone output), and never trace the
  // local database into a build.
  outputFileTracingRoot: projectRoot,
  outputFileTracingExcludes: {
    '*': ['data/**'],
  },
  // The desktop build bundles a self-contained server (Electron boots it as a
  // child process). Env-gated so `next dev` / `next start` keep working for
  // the plain web workflow.
  ...(process.env.BUILD_STANDALONE === '1' ? { output: 'standalone' } : {}),
};

export default nextConfig;
