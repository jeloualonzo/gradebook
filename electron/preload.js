/**
 * Minimal, safe bridge between the gradebook web app and the desktop shell.
 * Exposes exactly one capability: a native folder picker for sync settings.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gradebookDesktop', {
  pickFolder: () => ipcRenderer.invoke('gradebook:pick-folder'),
});
