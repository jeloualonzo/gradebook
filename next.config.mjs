import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3', 'exceljs'],
  // Anchor file tracing to THIS project (otherwise Next may infer a parent
  // workspace root and nest the standalone output).
  outputFileTracingRoot: projectRoot,
  // db.js reads device.json from GRADEBOOK_DATA_DIR || ./data — the tracer
  // follows the ./data fallback, and the local dev database must never ship
  // inside a build. This is the ONLY sanctioned dynamic file read in server
  // code; anything else must be a static import (a dynamic read once made the
  // tracer glob the entire project root into the desktop bundle — see
  // src/lib/schema.mjs and the guard in scripts/build-desktop.mjs).
  outputFileTracingExcludes: {
    '*': ['data/**'],
  },
  // The desktop build bundles a self-contained server (Electron boots it as a
  // child process). Env-gated so `next dev` / `next start` keep working for
  // the plain web workflow.
  ...(process.env.BUILD_STANDALONE === '1' ? { output: 'standalone' } : {}),
};

export default nextConfig;
