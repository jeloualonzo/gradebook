/**
 * Desktop build pipeline.
 *
 * 1. Build the Next.js app with `output: 'standalone'` (self-contained server)
 * 2. Copy in the pieces standalone doesn't include (static assets, public/)
 * 3. Swap the bundled better-sqlite3 native binary for one built against
 *    ELECTRON's ABI (the root node_modules copy stays on Node's ABI, so the
 *    web workflow is unaffected)
 * 4. Run electron-builder for the installer
 *
 * Usage:
 *   node scripts/build-desktop.mjs            → build + Windows installer
 *   node scripts/build-desktop.mjs --publish  → build + PUBLISH a GitHub release
 *                                               (requires the GH_TOKEN env var)
 *   node scripts/build-desktop.mjs --dir      → build + unpacked app (smoke tests)
 *   node scripts/build-desktop.mjs --no-pack  → build server bundle only
 */
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
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

// The root node_modules copy must stay on the SYSTEM Node ABI — `next build`
// itself loads it while collecting page data. If a previous desktop build
// corrupted it (Next standalone output can HARD-LINK node_modules files on
// Windows, so writing the Electron binary "into the bundle" also rewrote the
// root copy), restore the Node prebuild before doing anything else.
function ensureRootNodeAbi() {
  const rootSqlite = path.join(root, 'node_modules', 'better-sqlite3');
  // NB: the binding loads lazily inside `new Database()` — a bare require()
  // succeeds even with a wrong-ABI binary, so the probe must construct one.
  const probe = spawnSync(
    node,
    ['-e', `const D = require(${JSON.stringify(rootSqlite)}); new D(':memory:').prepare('SELECT 1').get();`],
    { stdio: 'pipe' }
  );
  if (probe.status === 0) return;
  console.log('\n→ root better-sqlite3 does not load under Node — restoring the Node-ABI prebuild');
  fs.rmSync(path.join(rootSqlite, 'build'), { recursive: true, force: true });
  run(node, [path.join(root, 'node_modules', 'prebuild-install', 'bin.js')], { cwd: rootSqlite });
}

// 0. Publishing pre-flight — fail in ONE SECOND, not after a full build.
const publishing = process.argv.includes('--publish');
if (publishing && !process.env.GH_TOKEN) {
  console.error(
    'Publishing needs a GitHub token in the GH_TOKEN environment variable.\n' +
    'Create one at https://github.com/settings/tokens (classic, "repo" scope), then:\n' +
    '  setx GH_TOKEN <your token>\n' +
    'and CLOSE EVERY terminal window (or restart VS Code entirely) — new tabs\n' +
    'inside an already-open terminal app keep the OLD environment.\n' +
    'For this session only, you can also run:  $env:GH_TOKEN = "<your token>"'
  );
  process.exit(1);
}

// 1. Standalone Next build (from a clean slate) --------------------------------
ensureRootNodeAbi();
fs.rmSync(standalone, { recursive: true, force: true });
run(node, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
  env: { ...process.env, BUILD_STANDALONE: '1' },
});

// Guards against tracer regressions. Next's output tracing globbed the ENTIRE
// project root into the bundle once (gigabytes: src/, scripts/, dist/ — even
// previous builds, recursively) because a runtime file read used a path it
// could not statically resolve. The schema is a static import now, but if any
// future code reintroduces a dynamic fs read, fail LOUDLY here instead of
// silently shipping a 1.5 GB installer.
for (const junk of ['data', 'backups', 'src', 'scripts', 'dist', 'electron', 'build', 'README.md']) {
  if (fs.existsSync(path.join(standalone, junk))) {
    console.error(
      `Refusing to continue: "${junk}" was traced into the standalone bundle.\n` +
      'Some server code reads a file via a runtime-computed path — find it and\n' +
      'make it a static import instead (see src/lib/schema.mjs for the pattern).'
    );
    process.exit(1);
  }
}

// 2. Assets the standalone output does not include ----------------------------
console.log('\n→ copying static assets and public/ into the bundle');
fs.cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true });
if (fs.existsSync(path.join(root, 'public'))) {
  fs.cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
}

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

// CRITICAL: Next's standalone output LINKS node_modules content instead of
// copying it when it can — symlinked package dirs (observed on Linux for the
// Turbopack-hashed copies) and hard-linked files (Windows). Patching the
// Electron binary "into the bundle" THROUGH such a link corrupts the link's
// target — which is how a desktop build overwrote the root node_modules
// binary and broke `next build` for the web workflow. So: before writing
// anywhere, replace links with true copies.
function materializeDir(dir, copyFrom) {
  let st = null;
  try { st = fs.lstatSync(dir); } catch { return false; }
  if (!st.isSymbolicLink()) return false;
  fs.rmSync(dir, { recursive: true, force: true }); // removes the link itself, not its target
  fs.cpSync(copyFrom, dir, { recursive: true, dereference: true });
  return true;
}

const fetchPrebuild = (platform) => {
  console.log(`\n→ fetching better-sqlite3 prebuilt binary (electron ${electronVersion}, ${platform}-x64)`);
  if (materializeDir(bundledSqlite, path.join(root, 'node_modules', 'better-sqlite3'))) {
    console.log('  (bundle copy was a link — replaced with a real copy)');
  }
  // Break potential HARD links (per-file, Windows): removing the build dir
  // unlinks the bundle's names without touching the root files' inodes, and
  // prebuild-install then extracts fresh files.
  fs.rmSync(path.join(bundledSqlite, 'build'), { recursive: true, force: true });
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
      const hashedDir = path.join(hashedRoot, name);
      if (materializeDir(hashedDir, bundledSqlite)) {
        // Was a link → now a full real copy of the already-patched bundle
        // package (Electron binary included). Nothing more to write.
        patched.push(`${name} (link → real copy)`);
        continue;
      }
      const destDir = path.join(hashedDir, 'build', 'Release');
      const destFile = path.join(destDir, 'better_sqlite3.node');
      fs.mkdirSync(destDir, { recursive: true });
      fs.rmSync(destFile, { force: true }); // break a potential hard link first
      fs.copyFileSync(srcBin, destFile);
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

// Self-heal: make sure the dev/web copy still loads under system Node.
ensureRootNodeAbi();

// 4. Package ------------------------------------------------------------------
if (process.argv.includes('--no-pack')) {
  console.log('\n✓ server bundle ready (skipping electron-builder)');
  process.exit(0);
}

// The Windows icon is stored as text (build/icon.b64) so git never carries a
// binary; decode it to the .ico electron-builder expects. ALWAYS overwrite —
// a stale or corrupt local icon.ico must never win over the one in git.
const icoPath = path.join(root, 'build', 'icon.ico');
fs.writeFileSync(icoPath, Buffer.from(fs.readFileSync(path.join(root, 'build', 'icon.b64'), 'utf8'), 'base64'));
console.log('\n→ refreshed build/icon.ico from build/icon.b64');
// electron-builder ONLY builds; this script owns publishing (below).
// Its own GitHub publisher runs two parallel tasks that race each other
// creating the release (observed: 422 already_exists killing the publish
// halfway, leaving a release with missing assets).
const builderArgs = process.argv.includes('--dir')
  ? ['--dir']
  : ['--win', 'nsis', '--x64', '--publish', 'never'];
run(node, [path.join(root, 'node_modules', 'electron-builder', 'cli.js'), ...builderArgs]);

/**
 * Upload ONE release asset by streaming it over node:https.
 *
 * WHY NOT fetch(): Node's built-in fetch (undici) enforces a fixed 300s
 * deadline for receiving RESPONSE HEADERS (undici's `headersTimeout`), and
 * Node exposes no way to raise it — no fetch option, no CLI flag, no env
 * var — short of shipping the undici npm package as a new dependency. For
 * a release-asset upload, GitHub sends its response only AFTER the entire
 * body has been received and finalized, so that deadline silently caps
 * every upload at 5 minutes. The v1.0.8 publish died exactly this way: the
 * 113 MB installer uploaded COMPLETELY (the asset was live on the release),
 * the 201 just arrived later than undici was willing to wait — and the
 * release was left half-published, without its blockmap and latest.yml.
 * Streaming the request body through fetch (duplex: 'half') would not help
 * either: the deadline is on the response side.
 *
 * Timeout model — the SHAPE matters more than the numbers:
 * - While the body is flowing: an INACTIVITY timeout. socket.setTimeout
 *   resets on every read/write, so a slow but progressing upload may take
 *   as long as it needs; only a genuinely dead connection trips it.
 * - After the body is fully flushed: waiting for GitHub's reply produces
 *   ZERO socket activity, so the idle timer would misfire there — it is
 *   swapped for one wide absolute response deadline instead.
 */
function uploadAsset(url, filePath, { inactivityMs = 180_000, responseMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const size = fs.statSync(filePath).size;
    let responseTimer = null;
    const req = https.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': size,
        'User-Agent': 'gradebook-release-script',
      },
    }, (res) => {
      clearTimeout(responseTimer);
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.setTimeout(inactivityMs, () => {
      req.destroy(new Error(`upload stalled — no socket activity for ${inactivityMs / 1000}s`));
    });
    req.on('finish', () => {
      req.setTimeout(0); // disable the idle timer: silence is EXPECTED while GitHub finalizes
      responseTimer = setTimeout(() => {
        req.destroy(new Error(`no response from GitHub within ${responseMs / 1000}s of the upload finishing`));
      }, responseMs);
    });
    req.on('error', reject);
    const src = fs.createReadStream(filePath);
    src.on('error', (err) => req.destroy(err));
    req.on('close', () => { clearTimeout(responseTimer); src.destroy(); });
    src.pipe(req);
  });
}

/**
 * Publish to GitHub Releases — deterministic and IDEMPOTENT:
 *   1. push the version tag (published releases require an existing tag)
 *   2. create the release, or reuse it if it already exists
 *   3. upload the installer, blockmap, and latest.yml — replacing any
 *      half-uploaded assets from a previous failed attempt
 * Re-running after any failure repairs the release in place.
 */
async function publishToGitHub() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  const tag = `v${version}`;
  const gh = (pkg.build?.publish || [])[0] || {};
  const scrub = (s) => String(s || '').replaceAll(process.env.GH_TOKEN, '***');
  const api = (p, init = {}) => fetch(`https://api.github.com${p}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'gradebook-release-script',
      ...(init.headers || {}),
    },
  });
  const fail = async (msg, resp) => {
    const body = resp ? await resp.text().catch(() => '') : '';
    console.error(scrub(`${msg}${body ? `\n${body}` : ''}`));
    process.exit(1);
  };

  // 1. Tag (idempotent).
  console.log(`\n→ ensuring git tag ${tag} exists on GitHub`);
  spawnSync('git', ['tag', tag], { cwd: root, stdio: 'ignore' });
  const pushUrl = `https://x-access-token:${process.env.GH_TOKEN}@github.com/${gh.owner}/${gh.repo}.git`;
  const pushed = spawnSync('git', ['push', pushUrl, tag], { cwd: root, stdio: 'pipe' });
  const pushOut = scrub(pushed.stdout) + scrub(pushed.stderr);
  if (pushed.status !== 0 && !/already exists|up to date/i.test(pushOut)) {
    console.error(`Could not push the ${tag} tag to GitHub:\n${pushOut}`);
    process.exit(1);
  }

  // 2. Release (create or reuse).
  console.log(`→ ensuring the ${tag} release exists`);
  let release;
  const existing = await api(`/repos/${gh.owner}/${gh.repo}/releases/tags/${tag}`);
  if (existing.status === 200) {
    release = await existing.json();
    console.log('  release exists — repairing/attaching assets');
  } else {
    const created = await api(`/repos/${gh.owner}/${gh.repo}/releases`, {
      method: 'POST',
      body: JSON.stringify({ tag_name: tag, name: version }),
    });
    if (created.status !== 201) return fail(`Could not create the ${tag} release (${created.status}):`, created);
    release = await created.json();
    console.log('  release created');
  }

  // 3. The update manifest — electron-updater's source of truth. If
  // electron-builder didn't emit it (publish=never can skip it), synthesize
  // it: version, file name, size, and base64 sha512 of the installer.
  const exeName = `Gradebook-Setup-${version}.exe`;
  const exePath = path.join(root, 'dist', exeName);
  if (!fs.existsSync(exePath)) return fail(`dist/${exeName} is missing — build failed?`);
  const ymlPath = path.join(root, 'dist', 'latest.yml');
  if (!fs.existsSync(ymlPath)) {
    const buf = fs.readFileSync(exePath);
    const sha512 = crypto.createHash('sha512').update(buf).digest('base64');
    fs.writeFileSync(ymlPath, [
      `version: ${version}`,
      'files:',
      `  - url: ${exeName}`,
      `    sha512: ${sha512}`,
      `    size: ${buf.length}`,
      `path: ${exeName}`,
      `sha512: ${sha512}`,
      `releaseDate: '${new Date().toISOString()}'`,
      '',
    ].join('\n'));
    console.log('  latest.yml synthesized');
  }

  // 4. Upload assets (replace any partial leftovers) — streamed via
  // uploadAsset(), NOT fetch(); see the comment on that function.
  //
  // Always consult a LIVE asset listing rather than the `release` object in
  // hand: it goes stale the moment an upload attempt dies after the bytes
  // actually landed (v1.0.8: the exe was complete on the release while the
  // client saw only a timeout).
  const listAssets = async () => {
    const resp = await api(`/repos/${gh.owner}/${gh.repo}/releases/${release.id}/assets`);
    if (resp.status !== 200) return fail(`Could not list ${tag} release assets (${resp.status}):`, resp);
    return resp.json();
  };
  for (const name of [exeName, `${exeName}.blockmap`, 'latest.yml']) {
    const filePath = path.join(root, 'dist', name);
    if (!fs.existsSync(filePath)) return fail(`dist/${name} is missing — build failed?`);
    const size = fs.statSync(filePath).size;
    const mb = (size / 1048576).toFixed(1);
    for (let attempt = 1; ; attempt++) {
      for (const leftover of (await listAssets()).filter(a => a.name === name)) {
        const del = await api(`/repos/${gh.owner}/${gh.repo}/releases/assets/${leftover.id}`, { method: 'DELETE' });
        if (del.status !== 204 && del.status !== 404) {
          return fail(`Could not delete leftover asset ${name} (${del.status}):`, del);
        }
      }
      console.log(`  uploading ${name} (${mb} MB)${attempt > 1 ? ' — second attempt' : ''} …`);
      let up;
      try {
        up = await uploadAsset(
          `https://uploads.github.com/repos/${gh.owner}/${gh.repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
          filePath
        );
      } catch (err) {
        // Network-level failure. First: did the bytes land anyway? This run
        // streamed THIS exact file, so a complete asset with the same name
        // and byte size IS this file (v1.0.8's failure mode) — adopt it
        // instead of re-spending the whole upload. latest.yml's sha512 stays
        // valid: the adopted bytes are the very bytes it was computed from.
        const landed = (await listAssets()).find(
          a => a.name === name && a.state === 'uploaded' && a.size === size
        );
        if (landed) {
          console.log(`  uploaded ${name} (${mb} MB) — confirmed on the release after a lost response`);
          break;
        }
        if (attempt >= 2) {
          return fail(
            `Uploading ${name} failed twice (${err.message}).\n` +
            'Re-run npm run desktop:release to repair — the publish flow is idempotent.'
          );
        }
        console.log(scrub(`  ${err.message} — deleting the partial and retrying once`));
        continue;
      }
      // HTTP-level failure (401/403/422/…): retrying cannot change the answer.
      if (up.status !== 201) return fail(`Uploading ${name} failed (${up.status}):\n${up.body}`);
      console.log(`  uploaded ${name} (${mb} MB)`);
      break;
    }
  }

  console.log(`\n✓ v${version} published to GitHub Releases — installed apps will pick it up.`);
}

if (publishing) {
  await publishToGitHub();
} else {
  console.log('\n✓ desktop build complete — see dist/');
}
