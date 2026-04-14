const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // window
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
  toggleOnTop: () => ipcRenderer.send('win:toggle-on-top'),
  openExternal: (url) => ipcRenderer.send('app:open-external', url),

  // config
  getConfig: (key) => ipcRenderer.invoke('config:get', key),
  setConfig: (key, value) => ipcRenderer.invoke('config:set', key, value),

  // spotify
  spotifyLogin: (clientId) => ipcRenderer.invoke('spotify:login', clientId),
  spotifyRefresh: () => ipcRenderer.invoke('spotify:refresh'),
  spotifyLogout: () => ipcRenderer.invoke('spotify:logout')
});
