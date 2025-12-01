const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Tray,
  Menu,
  systemPreferences,
  nativeImage,
  session,
  dialog
} = require('electron');
const keytar = require('keytar');

const { transcribeAudio, formatTranscript } = require('./groq-client');
const { deliverText, notify, captureActiveWindow } = require('./paste-util');
const settingsStore = require('./settings-store');

const SERVICE_NAME = 'FlashType';
const ACCOUNT_NAME = 'default';
let ipcRegistered = false;

// Log startup info for debugging
console.log('=== Flash Type Starting ===');
console.log('App packaged:', app.isPackaged);
console.log('__dirname:', __dirname);
console.log('app.getAppPath():', app.getAppPath());
console.log('process.resourcesPath:', process.resourcesPath);
// Microphone icon for tray - blue circle with white mic (16x16)
const TRAY_ICON_16 = `
iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlz
AAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAE5SURB
VDiNpZM9S8NAGMd/l6RNm1ZFcXBwcHAQHBwcHBwcHPwAfgA/gB/A1ckvIOjk5uDg4ODg4CAIDoKD
g4MgOAiCg2BfkjS5F+9yJk3TFvzDwXH33P/5P8/dCf6zBMAu8AjMAI+SCqANnEg6ADYlBcADMAm8
TQBPwBXwCqwBj5JegA3gEfgA1oFnSa/AOvAIvAMbwIukN2ADeAQ+gU3gVdI7sAk8Al/AFvAm6QPY
Ah6Bb2AbeJf0CWwDj8APsAO8S/oCdoBH4BfYBT4k/QC7wCPwB+wBn5J+gT3gEfgHDoAvSX/APvAI
DABHwLekADgAHoEhcAx8SxoAh8AjMAKcAN+SRsAx8AiMgVPgR9IYOAEegQlwBvxKmgCnwCMwBc6B
P0lT4Ax4BGbABfAvaQZcAI/AHPgH/gBZbXjwAAAAAElFTkSuQmCC
`.replace(/\s/g, '');
const TRAY_ICON_DATA_URL = 'data:image/png;base64,' + TRAY_ICON_16;
const BASE_APP_IMAGE = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);

let recorderWindow;
let settingsWindow;
let tray;
let isRecording = false;
let recorderReady = false;
let processing = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

async function ensureIconAssets() {
  // Skip icon generation when app is packaged (asar is read-only)
  if (app.isPackaged) {
    console.log('App is packaged, skipping icon asset generation');
    return;
  }
  
  const buildDir = path.join(__dirname, 'build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  const pngPath = path.join(buildDir, 'icon.png');
  const pngBuffer = BASE_APP_IMAGE.resize({ width: 256, height: 256 }).toPNG();

  try {
    if (!fs.existsSync(pngPath)) {
      fs.writeFileSync(pngPath, pngBuffer);
      console.log('Generated', pngPath);
    }
  } catch (error) {
    console.warn('Unable to generate icon assets automatically:', error.message);
  }
}

app.on('second-instance', () => {
  if (settingsWindow) {
    settingsWindow.focus();
  } else {
    createSettingsWindow();
  }
});

app.whenReady().then(async () => {
  app.setAppUserModelId('com.example.flashtype');
  
  await ensureIconAssets();
  
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'geolocation') {
      console.log('Blocking geolocation permission request');
      return callback(false);
    }

    callback(true);
  });
  
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').catch((error) => {
      console.warn('Microphone permission request failed', error);
    });
  }
  
  registerIpc();
  createRecorderWindow();
  createTray();
  
  // Register shortcuts after a small delay to ensure app is fully ready
  setTimeout(() => {
    registerShortcuts();
  }, 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createRecorderWindow();
    }
  });

  const apiKey = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
  if (!apiKey) {
    notify({
      title: 'Flash Type',
      body: 'Please set your API Key to get started.'
    });
    createSettingsWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

function createRecorderWindow() {
  if (recorderWindow) return;

  const iconPath = path.join(__dirname, 'build', 'icon.png');
  
  recorderWindow = new BrowserWindow({
    width: 280,
    height: 150,
    show: false,
    skipTaskbar: true,
    resizable: false,
    alwaysOnTop: true,
    frame: false,
    transparent: false,
    focusable: false,
    icon: fs.existsSync(iconPath) ? iconPath : BASE_APP_IMAGE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  recorderWindow.loadFile('recorder.html');

  recorderWindow.on('closed', () => {
    recorderWindow = null;
    recorderReady = false;
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  // Ensure IPC handlers are registered before creating the window
  if (!ipcRegistered) {
    registerIpc();
  }

  const iconPath = path.join(__dirname, 'build', 'icon.png');
  
  settingsWindow = new BrowserWindow({
    width: 640,
    height: 520,
    title: 'Flash Type – Settings',
    icon: fs.existsSync(iconPath) ? iconPath : BASE_APP_IMAGE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  settingsWindow.loadFile('settings.html');
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createTray() {
  // Use the embedded icon image for tray
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  let trayIcon = BASE_APP_IMAGE;

  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  }

  const size = process.platform === 'win32' ? 16 : 24;
  trayIcon = trayIcon.resize({ width: size, height: size });

  tray = new Tray(trayIcon);
  tray.setToolTip('Flash Type');
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;

  const template = [
    {
      label: isRecording ? 'Stop Recording (Ctrl+Alt+V)' : 'Start Recording (Ctrl+Alt+V)',
      click: toggleRecording
    },
    { type: 'separator' },
    {
      label: 'Settings…',
      click: createSettingsWindow
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function registerShortcuts() {
  // Unregister first in case of app restart
  globalShortcut.unregisterAll();
  
  console.log('Attempting to register global shortcut Ctrl+Alt+V...');
  
  try {
    const success = globalShortcut.register('Control+Alt+V', toggleRecording);
    
    if (!success) {
      console.error('Failed to register global shortcut Ctrl+Alt+V - returned false');
      notify({
        title: 'Flash Type - Hotkey Registration Failed',
        body: 'Unable to register Ctrl+Alt+V. Another app may be using this shortcut. Try closing other apps or use the tray menu to record.'
      });
    } else {
      console.log('Global shortcut Ctrl+Alt+V registered successfully');
      // Verify registration
      const isRegistered = globalShortcut.isRegistered('Control+Alt+V');
      console.log('Shortcut verification - isRegistered:', isRegistered);
    }
  } catch (error) {
    console.error('Exception while registering shortcut:', error);
    notify({
      title: 'Flash Type - Hotkey Error',
      body: `Error registering hotkey: ${error.message}`
    });
  }
}

function registerIpc() {
  // Remove existing handlers first to avoid conflicts
  if (ipcRegistered) {
    try {
      ipcMain.removeHandler('recording:save');
      ipcMain.removeHandler('settings:get');
      ipcMain.removeHandler('settings:save');
      ipcMain.removeHandler('groq:get-api-key');
      ipcMain.removeHandler('groq:set-api-key');
    } catch (e) {
      // Handlers might not exist yet, that's okay
    }
  }
  
  ipcRegistered = true;
  
  ipcMain.on('recorder:ready', () => {
    recorderReady = true;
  });

  ipcMain.on('recorder:error', (_, message) => {
    isRecording = false;
    refreshTrayMenu();
    notify({
      title: 'Flash Type',
      body: `Recorder error: ${message}`
    });
  });

  ipcMain.handle('recording:save', async (_, payload) => {
    const filePath = await persistRecording(payload);
    processRecording(filePath, payload?.durationMs || 0).catch((error) => {
      console.error('Processing error', error);
      notify({
        title: 'Flash Type',
        body: `Processing failed: ${error.message}`
      });
    });

    return { filePath };
  });

  ipcMain.handle('settings:get', () => {
    try {
      return settingsStore.getSettings();
    } catch (error) {
      console.error('Error getting settings:', error);
      return settingsStore.DEFAULT_SETTINGS;
    }
  });
  
  ipcMain.handle('settings:save', (_, updates) => {
    try {
      const next = settingsStore.saveSettings(updates);
      if (settingsWindow) {
        settingsWindow.webContents.send('settings:updated', next);
      }
      return next;
    } catch (error) {
      console.error('Error saving settings:', error);
      throw error;
    }
  });

  ipcMain.handle('groq:get-api-key', async () => {
    try {
      return await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
    } catch (error) {
      console.error('Error getting API key:', error);
      return null;
    }
  });
  
  ipcMain.handle('groq:set-api-key', async (_, key) => {
    try {
      if (!key) {
        await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
        return null;
      }
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, key);
      return key;
    } catch (error) {
      console.error('Error setting API key:', error);
      throw error;
    }
  });
  
  console.log('IPC handlers registered successfully');
}

async function toggleRecording() {
  if (!recorderWindow || recorderWindow.isDestroyed()) {
    createRecorderWindow();
    notify({
      title: 'Flash Type',
      body: 'Recorder is reloading, please try again in a second.'
    });
    return;
  }

  if (!recorderReady) {
    notify({
      title: 'Flash Type',
      body: 'Recorder is initializing microphone access…'
    });
    return;
  }

  if (isRecording) {
    console.log('\n========================================');
    console.log('🛑 RECORDING STOPPED');
    console.log('========================================');
    recorderWindow.webContents.send('recorder:command', { action: 'stop' });
    // Hide after a short delay to show "Processing" status
    setTimeout(() => {
      if (recorderWindow && !recorderWindow.isDestroyed()) {
        recorderWindow.hide();
      }
    }, 1000);
    isRecording = false;
    refreshTrayMenu();
  } else {
    const apiKey = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
    if (!apiKey) {
      notify({
        title: 'Flash Type',
        body: 'Please set your API Key first.'
      });
      createSettingsWindow();
      return;
    }

    console.log('\n========================================');
    console.log('🎤 RECORDING STARTED');
    console.log('========================================');
    
    // Capture the currently active window BEFORE showing recorder
    captureActiveWindow();
    
    const settings = settingsStore.getSettings();
    const presetLabels = {
      'default': 'Default',
      'email': 'Email',
      'bullet-points': 'Bullet Points',
      'note': 'Note'
    };
    
    recorderWindow.webContents.send('recorder:command', { 
      action: 'start',
      mode: settings.processingMode === 'grammar-only' ? 'Grammar only' : 'Grammar + Reframe',
      format: presetLabels[settings.preset] || 'Default'
    });
    
    // Position window in bottom-right corner
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    recorderWindow.setPosition(width - 300, height - 170);
    
    recorderWindow.showInactive(); // Show without stealing focus
    isRecording = true;
    refreshTrayMenu();
  }
}

async function persistRecording({ dataArray, mimeType }) {
  const recordingsDir = path.join(app.getPath('userData'), 'recordings');
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }

  const extension = mimeType?.includes('webm') ? 'webm' : 'ogg';
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
  const filePath = path.join(recordingsDir, fileName);
  
  const buffer = Buffer.from(dataArray);
  fs.writeFileSync(filePath, buffer);
  
  const fileSize = fs.statSync(filePath).size;
  console.log('\n=== FILE SAVED ===');
  console.log('Path:', filePath);
  console.log('Size:', (fileSize / 1024).toFixed(1), 'KB');
  
  if (fileSize === 0) {
    throw new Error('File was saved but is empty on disk');
  }
  
  return filePath;
}

async function processRecording(filePath) {
  if (processing) {
    notify({
      title: 'Flash Type',
      body: 'Still processing previous recording. Please wait.'
    });
    return;
  }

  processing = true;
  const settings = settingsStore.getSettings();
  const apiKey = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);

  if (!apiKey) {
    notify({
      title: 'Flash Type',
      body: 'Groq API key missing. Open Settings to add it.'
    });
    processing = false;
    return;
  }

  notify({
    title: 'Flash Type',
    body: 'Uploading audio to Groq…'
  });

  try {
    const { text: transcript, language: detectedLanguage } = await transcribeAudio({
      apiKey,
      filePath,
      model: settings.transcriptionModel,
      language: settings.language || undefined // Pass language if set
    });

    const formatted = await formatTranscript({
      apiKey,
      transcript,
      preset: settings.preset,
      processingMode: settings.processingMode,
      completionModel: settings.completionModel,
      language: settings.language || detectedLanguage, // Use detected language if user chose Auto
      hindiScriptPreference: settings.hindiScriptPreference
    });

    console.log('✅ Copying to clipboard and pasting...');
    deliverText(formatted, { autoPaste: settings.autoPaste });
    
    if (!settings.keepRecordings) {
      fs.promises
        .unlink(filePath)
        .catch((error) => console.warn('Unable to delete recording', error));
    }
    
    console.log('========================================\n');
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.log('========================================\n');
    notify({
      title: 'Flash Type',
      body: `Error: ${error.message}`
    });
  } finally {
    processing = false;
  }
}

