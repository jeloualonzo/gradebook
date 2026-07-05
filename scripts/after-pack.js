/**
 * electron-builder afterPack hook.
 *
 * Copies the self-contained Next.js server bundle (.next/standalone) into the
 * packaged app's resources/server. Done here (not via extraResources) because
 * electron-builder's resource copier hard-excludes node_modules — which is
 * precisely the part the standalone server needs.
 */
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  const src = path.join(process.cwd(), '.next', 'standalone');
  const dest = path.join(context.appOutDir, 'resources', 'server');
  if (!fs.existsSync(path.join(src, 'server.js'))) {
    throw new Error(`Standalone server bundle missing at ${src} — run the desktop build script, not electron-builder directly.`);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });

  // Sanity: the pieces the app cannot start without.
  for (const f of ['server.js', 'schema.sql', 'node_modules/better-sqlite3', 'node_modules/next', '.next/static']) {
    if (!fs.existsSync(path.join(dest, f))) {
      throw new Error(`Packaged server bundle is missing: ${f}`);
    }
  }
  console.log(`  • server bundle copied → ${dest}`);
};
