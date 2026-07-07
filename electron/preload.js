/**
 * Minimal, safe bridge between the gradebook web app and the desktop shell:
 * folder picker (sync settings), backups folder, and application updates.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gradebookDesktop', {
  pickFolder: () => ipcRenderer.invoke('gradebook:pick-folder'),
  openBackupsFolder: () => ipcRenderer.invoke('gradebook:open-backups'),
  updateStatus: () => ipcRenderer.invoke('gradebook:update-status'),
  checkForUpdates: () => ipcRenderer.invoke('gradebook:check-updates'),
  installUpdate: () => ipcRenderer.invoke('gradebook:install-update'),
});
