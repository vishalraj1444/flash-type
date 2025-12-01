const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_SETTINGS = {
  transcriptionModel: 'whisper-large-v3-turbo',
  completionModel: 'llama-3.3-70b-versatile',
  preset: 'default',
  processingMode: 'grammar-and-reframe',
  language: '', // Empty string = auto-detect
  hindiScriptPreference: 'roman',
  autoPaste: true,
  notifyOnComplete: true,
  keepRecordings: true
};

const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function ensureSettingsFile() {
  const filePath = getSettingsPath();
  if (!fs.existsSync(path.dirname(filePath))) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  }
}

function readSettings() {
  try {
    ensureSettingsFile();
    const raw = fs.readFileSync(getSettingsPath(), 'utf8');
    const settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) || {}) };
    
    // Migrate old model names (remove groq/ prefix)
    if (settings.completionModel && settings.completionModel.startsWith('groq/')) {
      settings.completionModel = settings.completionModel.replace('groq/', '');
      // Write directly without calling readSettings again
      fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
    }
    
    return settings;
  } catch (error) {
    console.error('Failed to read settings, falling back to defaults');
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(partial) {
  const current = readSettings();
  const next = { ...current, ...partial };
  fs.writeFileSync(getSettingsPath(), JSON.stringify(next, null, 2));
  return next;
}

module.exports = {
  getSettings: readSettings,
  saveSettings: writeSettings,
  DEFAULT_SETTINGS
};

