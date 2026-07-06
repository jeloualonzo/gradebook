/**
 * Minimal, safe bridge between the gradebook web app and the desktop shell:
 * a native folder picker (sync settings) and opening the backups folder.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gradebookDesktop', {
  pickFolder: () => ipcRenderer.invoke('gradebook:pick-folder'),
  openBackupsFolder: () => ipcRenderer.invoke('gradebook:open-backups'),
});
