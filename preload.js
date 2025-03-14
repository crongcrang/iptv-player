const { contextBridge, ipcRenderer } = require('electron');
const { shell } = require('electron');

console.log('preload.js loaded'); // ดีบั๊กพื้นฐาน

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    getChannels: () => {
      console.log('getChannels called');
      return ipcRenderer.invoke('get-channels');
    },
    onChannelsUpdated: (callback) => {
      console.log('onChannelsUpdated registered');
      ipcRenderer.on('channels-updated', (event, channels) => callback(channels));
    },
    onChangeLanguage: (callback) => {
      console.log('onChangeLanguage registered');
      ipcRenderer.on('change-language', (event, lang) => callback(lang));
    },
    getFavorites: () => {
      console.log('getFavorites called');
      return ipcRenderer.invoke('get-favorites');
    },
    setFavorites: (favorites) => {
      console.log('setFavorites called with:', favorites);
      ipcRenderer.send('set-favorites', favorites);
    },
    openExternal: (url) => {
      console.log('openExternal called with URL:', url);
      shell.openExternal(url);
    },
  });
  console.log('electronAPI exposed to window successfully');
} catch (error) {
  console.error('Error in contextBridge.exposeInMainWorld:', error);
}

console.log('preload.js execution completed');