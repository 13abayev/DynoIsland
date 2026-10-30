'use strict';
// The bridge between the island page and Island's main process.
const { contextBridge, ipcRenderer } = require('electron');

const on = channel => cb => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld('islandApi', {
  onState: on('state'),
  onNudge: on('nudge'),
  onToggle: on('toggle'),
  onBlur: on('blur'),
  onTunnels: on('tunnels'),
  onIdentify: on('identify'),
  displays: () => ipcRenderer.invoke('displays:list'),
  setDisplays: ids => ipcRenderer.invoke('displays:set', ids),
  identifyDisplays: () => ipcRenderer.invoke('displays:identify'),
  setInteractive: yes => ipcRenderer.send('interactive', !!yes),
  focusWindow: () => ipcRenderer.send('focus-window'),
  jump: key => ipcRenderer.invoke('jump', key),
  act: (key, action, arg) => ipcRenderer.invoke('act', key, action, arg),
  menu: () => ipcRenderer.send('menu'),
  connectStatus: () => ipcRenderer.invoke('connect:status'),
  connect: (target, on, arg) => ipcRenderer.invoke('connect:run', target, on, arg),
  setSettings: patch => ipcRenderer.invoke('settings:set', patch),
  refreshLimits: () => ipcRenderer.invoke('limits:refresh'),
  copyToken: () => ipcRenderer.invoke('copy-token'),
  openExtensionFolder: () => ipcRenderer.invoke('open-extension-folder'),
});
