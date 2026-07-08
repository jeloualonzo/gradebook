/**
 * Window-state persistence tests (electron/window-state.js).
 *
 * The module is written with injected deps, so everything except the real
 * BrowserWindow is testable here: state file round-trips, corrupt-file
 * recovery, off-screen sanitizing, zoom clamping, and the full manage()
 * lifecycle against a stub window (restore → zoom keys → close → saved).
 *
 * Run: node scripts/test-window-state.mjs
 */
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const {
  createWindowState, loadState, boundsVisible, clampZoom, saveStateFile,
  ZOOM_MAX, ZOOM_STEP,
} = require('../electron/window-state.js');

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-winstate-'));
const file = (name) => path.join(tmp, name);

// A 1920×1080 primary display (workArea excludes the taskbar).
const DISPLAY = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const SECOND = { workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };

console.log('clampZoom');
check('passes normal levels through', clampZoom(1.5) === 1.5);
check('clamps above the max', clampZoom(99) === ZOOM_MAX);
check('clamps below the min', clampZoom(-99) < 0 && clampZoom(-99) === clampZoom(-100));
check('non-finite falls back to 100%', clampZoom('junk') === 0 && clampZoom(undefined) === 0);

console.log('loadState');
const missing = loadState(file('nope.json'));
check('missing file → defaults', missing.bounds === null && missing.maximized === false && missing.zoomLevel === 0);
fs.writeFileSync(file('corrupt.json'), '{not json');
check('corrupt file → defaults', loadState(file('corrupt.json')).bounds === null);
saveStateFile(file('ok.json'), { bounds: { x: 10, y: 20, width: 1100, height: 700 }, maximized: true, zoomLevel: 1 });
const ok = loadState(file('ok.json'));
check('round-trips bounds', ok.bounds.x === 10 && ok.bounds.width === 1100);
check('round-trips maximized + zoom', ok.maximized === true && ok.zoomLevel === 1);
saveStateFile(file('bad.json'), { bounds: { x: 'a', y: 0, width: 100, height: 80 }, zoomLevel: 40 });
const bad = loadState(file('bad.json'));
check('rejects malformed/too-small bounds', bad.bounds === null);
check('clamps stored zoom', bad.zoomLevel === ZOOM_MAX);

console.log('boundsVisible');
check('on-screen bounds are visible', boundsVisible({ x: 100, y: 100, width: 1200, height: 800 }, [DISPLAY]));
check('off-screen bounds are not', !boundsVisible({ x: 5000, y: 5000, width: 1200, height: 800 }, [DISPLAY]));
check('a sliver of overlap is not enough', !boundsVisible({ x: 1860, y: 0, width: 1200, height: 800 }, [DISPLAY]));
check('second monitor counts when present', boundsVisible({ x: 2000, y: 50, width: 1200, height: 800 }, [DISPLAY, SECOND]));
check('…but not after it is unplugged', !boundsVisible({ x: 2000, y: 50, width: 1200, height: 800 }, [DISPLAY]));

console.log('createWindowState + manage()');
// Stub Electron window: enough surface for the keeper to drive.
function stubWin({ bounds, maximized = false } = {}) {
  const win = new EventEmitter();
  win.webContents = new EventEmitter();
  let zoom = 0;
  let max = maximized;
  win.webContents.getZoomLevel = () => zoom;
  win.webContents.setZoomLevel = (z) => { zoom = z; };
  win.isDestroyed = () => false;
  win.isMaximized = () => max;
  win.isMinimized = () => false;
  win.getNormalBounds = () => bounds;
  win.maximize = () => { max = true; win.maximizedCalled = true; };
  win.pressKey = (key, control = true) => {
    let prevented = false;
    win.webContents.emit('before-input-event',
      { preventDefault: () => { prevented = true; } },
      { type: 'keyDown', control, alt: false, key });
    return prevented;
  };
  return win;
}
const screenStub = { getAllDisplays: () => [DISPLAY] };

// Fresh start: no file → defaults.
const fresh = createWindowState({ file: file('s1.json'), defaults: { width: 1280, height: 820 }, screen: screenStub });
const freshOpts = fresh.windowOptions();
check('no saved state → default size, centered (no x/y)', freshOpts.width === 1280 && freshOpts.x === undefined);

// Saved on-screen state → restored exactly.
saveStateFile(file('s2.json'), { bounds: { x: 60, y: 40, width: 1500, height: 900 }, maximized: true, zoomLevel: 1.5 });
const keeper = createWindowState({ file: file('s2.json'), defaults: { width: 1280, height: 820 }, screen: screenStub });
const opts = keeper.windowOptions();
check('saved geometry is restored', opts.x === 60 && opts.y === 40 && opts.width === 1500 && opts.height === 900);
const win = stubWin({ bounds: { x: 60, y: 40, width: 1500, height: 900 }, maximized: false });
keeper.manage(win);
check('maximized state is reapplied', win.maximizedCalled === true);
win.webContents.emit('did-finish-load');
check('zoom level is reapplied on load', win.webContents.getZoomLevel() === 1.5);

// Keyboard zoom: Ctrl+= / Ctrl+- / Ctrl+0, always clamped.
check('Ctrl+= is intercepted', win.pressKey('=') === true);
check('…and zooms in one step', win.webContents.getZoomLevel() === 1.5 + ZOOM_STEP);
win.pressKey('-');
check('Ctrl+- zooms back out', win.webContents.getZoomLevel() === 1.5);
win.pressKey('0');
check('Ctrl+0 resets to 100%', win.webContents.getZoomLevel() === 0);
for (let i = 0; i < 30; i++) win.pressKey('=');
check('zoom-in is clamped at the max', win.webContents.getZoomLevel() === ZOOM_MAX);
check('plain typing is not intercepted', win.pressKey('=', false) === false);

// Ctrl+wheel zoom.
win.pressKey('0');
win.webContents.emit('zoom-changed', {}, 'in');
check('Ctrl+wheel zooms in', win.webContents.getZoomLevel() === ZOOM_STEP);

// Close → everything lands in the file.
win.emit('close');
const savedBack = loadState(file('s2.json'));
check('close persists bounds', savedBack.bounds.width === 1500);
check('close persists maximized', savedBack.maximized === true);
check('close persists zoom', savedBack.zoomLevel === ZOOM_STEP);

// Off-screen saved state → sanitized back to defaults.
saveStateFile(file('s3.json'), { bounds: { x: 9000, y: 9000, width: 1200, height: 800 }, maximized: false, zoomLevel: 0 });
const ghost = createWindowState({ file: file('s3.json'), defaults: { width: 1280, height: 820 }, screen: screenStub });
const ghostOpts = ghost.windowOptions();
check('off-screen position is discarded', ghostOpts.x === undefined && ghostOpts.width === 1280);

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
