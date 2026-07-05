/**
 * Desktop build pipeline.
 *
 * 1. Build the Next.js app with `output: 'standalone'` (self-contained server)
 * 2. Copy in the pieces standalone doesn't include (static assets, public/,
 *    schema.sql)
 * 3. Swap the bundled better-sqlite3 native binary for one built against
 *    ELECTRON's ABI (the root node_modules copy stays on Node's ABI, so the
 *    web workflow is unaffected)
 * 4. Run electron-builder for the installer
 *
 * Usage:
 *   node scripts/build-desktop.mjs            → build + Windows installer
 *   node scripts/build-desktop.mjs --dir      → build + unpacked app (smoke tests)
 *   node scripts/build-desktop.mjs --no-pack  → build server bundle only
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
const run = (cmd, args, opts = {}) => {
  console.log(`\n→ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.error) {
    console.error(`Step failed to start: ${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`Step failed (${cmd} ${args.join(' ')}), exit ${res.status ?? `signal ${res.signal}`}`);
    process.exit(res.status ?? 1);
  }
};
const node = process.execPath;

// Electron's postinstall sometimes fails silently (npm still reports success),
// leaving node_modules/electron without the actual binary. Detect and repair.
function ensureElectronBinary() {
  const bin = path.join(
    root, 'node_modules', 'electron', 'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron'
  );
  if (!fs.existsSync(bin)) {
    console.log('\n→ electron binary is missing — running its installer');
    run(node, [path.join(root, 'node_modules', 'electron', 'install.js')], {
      cwd: path.join(root, 'node_modules', 'electron'),
    });
  }
  if (!fs.existsSync(bin)) {
    console.error(
      'The Electron binary is still missing after reinstall.\n' +
      'Try: npm install electron --force   (then re-run this build)'
    );
    process.exit(1);
  }
  return bin;
}

// 1. Standalone Next build (from a clean slate) --------------------------------
fs.rmSync(standalone, { recursive: true, force: true });
run(node, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
  env: { ...process.env, BUILD_STANDALONE: '1' },
});

// Guard against ever shipping a local database inside the bundle.
if (fs.existsSync(path.join(standalone, 'data'))) {
  console.error('Refusing to continue: local data/ was traced into the bundle.');
  process.exit(1);
}

// 2. Assets the standalone output does not include ----------------------------
console.log('\n→ copying static assets, public/, schema.sql into the bundle');
fs.cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true });
if (fs.existsSync(path.join(root, 'public'))) {
  fs.cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
}
fs.copyFileSync(path.join(root, 'src', 'lib', 'schema.sql'), path.join(standalone, 'schema.sql'));

// 3. Electron-ABI better-sqlite3 in the bundle --------------------------------
// Two passes: first the HOST platform's binary so we can verify the bundle
// actually boots under Electron here; then the TARGET platform's binary
// (win32 for the Windows installer) which is what actually ships.
const electronVersion = JSON.parse(
  fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')
).version;
const bundledSqlite = path.join(standalone, 'node_modules', 'better-sqlite3');
if (!fs.existsSync(bundledSqlite)) {
  console.error('better-sqlite3 was not traced into the standalone bundle — aborting.');
  process.exit(1);
}

const fetchPrebuild = (platform) => {
  console.log(`\n→ fetching better-sqlite3 prebuilt binary (electron ${electronVersion}, ${platform}-x64)`);
  run(node, [
    path.join(root, 'node_modules', 'prebuild-install', 'bin.js'),
    '--runtime', 'electron',
    '--target', electronVersion,
    '--platform', platform,
    '--arch', 'x64',
  ], { cwd: bundledSqlite });
  syncHashedCopies();
};

// Turbopack ALSO keeps content-hashed copies of external packages under
// .next/node_modules/<pkg>-<hash>/ — and the compiled server loads THOSE.
// Every copy must carry the Electron-ABI binary, or the packaged app dies
// with ERR_DLOPEN_FAILED (NODE_MODULE_VERSION mismatch).
function syncHashedCopies() {
  const srcBin = path.join(bundledSqlite, 'build', 'Release', 'better_sqlite3.node');
  const hashedRoot = path.join(standalone, '.next', 'node_modules');
  const patched = [];
  if (fs.existsSync(srcBin) && fs.existsSync(hashedRoot)) {
    for (const name of fs.readdirSync(hashedRoot)) {
      if (name !== 'better-sqlite3' && !name.startsWith('better-sqlite3-')) continue;
      const destDir = path.join(hashedRoot, name, 'build', 'Release');
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcBin, path.join(destDir, 'better_sqlite3.node'));
      patched.push(name);
    }
  }
  if (patched.length) console.log(`  patched hashed copies: ${patched.join(', ')}`);
  return patched;
}

// Host pass + real boot verification under Electron's Node runtime.
fetchPrebuild(process.platform);
const electronBin = ensureElectronBinary();
console.log('\n→ verifying the bundled binaries load under Electron');
// Verify EVERY copy the server could load — especially the Turbopack-hashed
// one, which is the copy the compiled server actually requires.
const hashedRoot = path.join(standalone, '.next', 'node_modules');
const verifyTargets = [
  bundledSqlite,
  ...(fs.existsSync(hashedRoot)
    ? fs.readdirSync(hashedRoot)
        .filter(n => n === 'better-sqlite3' || n.startsWith('better-sqlite3-'))
        .map(n => path.join(hashedRoot, n))
    : []),
];
// A script FILE (not -e) — robust across Windows quoting/newline handling.
const verifyPath = path.join(standalone, '.verify-sqlite.cjs');
fs.writeFileSync(verifyPath, `
  for (const target of ${JSON.stringify(verifyTargets)}) {
    const Database = require(target);
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t(id TEXT)');
    db.prepare('INSERT INTO t VALUES (?)').run('ok');
    console.log('OK under Electron ABI:', target);
  }
`);
run(electronBin, [verifyPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
fs.rmSync(verifyPath);

// Target pass: the binary that ships inside the installer. Only the full
// Windows packaging run swaps in the win32 binary; --dir and --no-pack keep
// the host binary so the bundle stays locally runnable.
const packagingForWindows = !process.argv.includes('--no-pack') && !process.argv.includes('--dir');
if (packagingForWindows && process.platform !== 'win32') fetchPrebuild('win32');

// 4. Package ------------------------------------------------------------------
if (process.argv.includes('--no-pack')) {
  console.log('\n✓ server bundle ready (skipping electron-builder)');
  process.exit(0);
}

// The Windows icon is stored as text (build/icon.b64) so git never carries a
// binary; decode it to the .ico electron-builder expects.
const icoPath = path.join(root, 'build', 'icon.ico');
if (!fs.existsSync(icoPath)) {
  fs.writeFileSync(icoPath, Buffer.from(fs.readFileSync(path.join(root, 'build', 'icon.b64'), 'utf8'), 'base64'));
  console.log('\n→ decoded build/icon.ico from build/icon.b64');
}
const builderArgs = process.argv.includes('--dir')
  ? ['--dir']
  : ['--win', 'nsis', '--x64'];
run(node, [path.join(root, 'node_modules', 'electron-builder', 'cli.js'), ...builderArgs]);

console.log('\n✓ desktop build complete — see dist/');
