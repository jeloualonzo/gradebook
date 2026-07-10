/**
 * Window state persistence — size, position, maximized state, zoom level.
 *
 * Behaves like VS Code / Office: close the app, reopen it, and the window
 * comes back exactly where and how you left it — including your Ctrl +/- or
 * Ctrl+wheel zoom. State lives in <userData>/window-state.json (device-local
 * UI preference: never in the database, never synced between laptops).
 *
 * Why zoom is handled HERE and not left to Chromium: the app picks a free
 * localhost port on every launch, so the page origin changes every time and
 * Chromium's own per-origin zoom memory never applies. All zoom paths
 * (Ctrl +/-/0, Ctrl+mouse wheel) run through this module's single
 * clamp-and-persist pipeline instead.
 *
 * The logic is written with injected deps (screen, file path) so the pure
 * parts are testable without Electron — see scripts/test-window-state.mjs.
 */
const fs = require('fs');
const path = require('path');

const ZOOM_MIN = -3;   // ≈ 58%
const ZOOM_MAX = 4;    // ≈ 207%
const ZOOM_STEP = 0.5; // ≈ ±10% per press — the usual desktop-app step

/** Clamp a zoom level to the supported range (0 = 100%). */
function clampZoom(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 0;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}

/** Read saved state; any unreadable/corrupt file falls back to defaults. */
function loadState(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const b = raw?.bounds;
    const boundsOk = b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width >= 200 && b.height >= 150;
    return {
      bounds: boundsOk ? { x: b.x, y: b.y, width: b.width, height: b.height } : null,
      maximized: !!raw?.maximized,
      zoomLevel: clampZoom(raw?.zoomLevel ?? 0),
    };
  } catch {
    return { bounds: null, maximized: false, zoomLevel: 0 };
  }
}

/**
 * A saved position is only reusable if enough of the window still lands on
 * a connected display to grab the title bar — otherwise (monitor unplugged,
 * resolution changed) the window would restore off-screen and look "lost".
 */
function boundsVisible(bounds, displays) {
  if (!bounds || !Array.isArray(displays)) return false;
  return displays.some(d => {
    const a = d.workArea || d.bounds;
    if (!a) return false;
    const overlapX = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const overlapY = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    return overlapX >= 100 && overlapY >= 80;
  });
}

function saveStateFile(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    /* persistence must never crash or block the app */
  }
}

/**
 * createWindowState({ file, defaults, screen }) → keeper
 *   keeper.windowOptions()  — spread into `new BrowserWindow({...})`
 *   keeper.manage(win)      — restore maximized/zoom + track all changes
 */
function createWindowState({ file, defaults, screen }) {
  const saved = loadState(file);
  const displays = screen ? screen.getAllDisplays() : [];
  const usableBounds = boundsVisible(saved.bounds, displays) ? saved.bounds : null;

  const state = {
    bounds: usableBounds,
    maximized: saved.maximized,
    zoomLevel: saved.zoomLevel,
  };
  let win = null;
  let saveTimer = null;

  const snapshot = () => {
    if (!win || win.isDestroyed()) return;
    // getNormalBounds(): the UN-maximized geometry even while maximized, so
    // un-maximizing after a restart still lands on the remembered size.
    if (!win.isMaximized() && !win.isMinimized()) state.bounds = win.getNormalBounds();
    state.maximized = win.isMaximized();
    state.zoomLevel = clampZoom(win.webContents.getZoomLevel());
  };

  // Debounced save on every change (not just on close), so a crash or a
  // force-kill still loses at most half a second of state.
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { snapshot(); saveStateFile(file, state); }, 500);
  };

  const keeper = {
    windowOptions() {
      return state.bounds
        ? { x: state.bounds.x, y: state.bounds.y, width: state.bounds.width, height: state.bounds.height }
        : { width: defaults.width, height: defaults.height };
    },

    setZoom(level) {
      if (!win || win.isDestroyed()) return;
      const z = clampZoom(level);
      win.webContents.setZoomLevel(z);
      state.zoomLevel = z;
      scheduleSave();
    },

    nudgeZoom(delta) {
      if (!win || win.isDestroyed()) return;
      keeper.setZoom(win.webContents.getZoomLevel() + delta);
    },

    /**
     * Restore state and start tracking. With { deferMaximize: true } the
     * remembered maximized state is NOT applied here — on Windows,
     * maximize() force-SHOWS a hidden window, which would break the splash
     * cross-fade (the main window starts show:false and is revealed later
     * via showManaged()).
     */
    manage(w, { deferMaximize = false } = {}) {
      win = w;
      if (state.maximized && !deferMaximize) w.maximize();

      // Reapply the remembered zoom on every load (see module comment).
      w.webContents.on('did-finish-load', () => {
        w.webContents.setZoomLevel(state.zoomLevel);
      });

      // Ctrl + mouse wheel.
      w.webContents.on('zoom-changed', (_event, direction) => {
        keeper.nudgeZoom(direction === 'in' ? ZOOM_STEP : -ZOOM_STEP);
      });

      // Ctrl +/-/0 — intercepted here (not via menu roles) so they work with
      // the menu bar hidden, even while typing in a field, and always go
      // through the same clamp + persist path.
      w.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || !input.control || input.alt) return;
        const k = input.key;
        if (k === '=' || k === '+') { event.preventDefault(); keeper.nudgeZoom(ZOOM_STEP); }
        else if (k === '-' || k === '_') { event.preventDefault(); keeper.nudgeZoom(-ZOOM_STEP); }
        else if (k === '0') { event.preventDefault(); keeper.setZoom(0); }
      });

      w.on('resize', scheduleSave);
      w.on('move', scheduleSave);
      w.on('maximize', scheduleSave);
      w.on('unmaximize', scheduleSave);
      w.on('close', () => {
        clearTimeout(saveTimer);
        snapshot();
        saveStateFile(file, state);
      });
    },

    /**
     * Reveal a window created with show:false, honoring the remembered
     * maximized state (maximize() both shows AND maximizes a hidden window;
     * plain windows use show()). The counterpart of deferMaximize above.
     */
    showManaged() {
      if (!win || win.isDestroyed()) return;
      if (state.maximized) win.maximize();
      else win.show();
      win.focus();
    },
  };
  return keeper;
}

module.exports = { createWindowState, loadState, boundsVisible, clampZoom, saveStateFile, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP };
