const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recorderBridge', {
  notifyReady: () => ipcRenderer.send('recorder:ready'),
  reportError: (message) => ipcRenderer.send('recorder:error', message),
  onCommand: (handler) => {
    ipcRenderer.on('recorder:command', (_, payload) => handler(payload));
  },
  saveRecording: (payload) => {
    const { arrayBuffer, ...rest } = payload;
    // Convert to regular array for IPC serialization
    const uint8Array = new Uint8Array(arrayBuffer);
    const dataArray = Array.from(uint8Array);
    return ipcRenderer.invoke('recording:save', { dataArray, ...rest });
  }
});

contextBridge.exposeInMainWorld('settingsBridge', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (updates) => ipcRenderer.invoke('settings:save', updates),
  getApiKey: () => ipcRenderer.invoke('groq:get-api-key'),
  saveApiKey: (key) => ipcRenderer.invoke('groq:set-api-key', key),
  onSettingsUpdated: (handler) =>
    ipcRenderer.on('settings:updated', (_, payload) => handler(payload))
});

