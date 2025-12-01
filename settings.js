if (!window.settingsBridge) {
  document.body.innerHTML =
    '<div class="app"><p>Settings bridge unavailable. Please restart the app.</p></div>';
} else {
  const { useState, useEffect } = React;
  const PRESETS = [
    { id: 'default', label: 'Default' },
    { id: 'email', label: 'Email' },
    { id: 'bullet-points', label: 'Bullet points' },
    { id: 'note', label: 'Note' }
  ];

  function App() {
    // Initialize with an empty object so it renders immediately
    const [settings, setSettings] = useState({});
    const [apiKey, setApiKey] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
      async function bootstrap() {
        try {
          // Fetch settings and key in parallel, but don't block rendering if one fails
          const [currentSettings, storedKey] = await Promise.all([
            window.settingsBridge.getSettings().catch(err => {
              console.error('Failed to load settings:', err);
              return {}; 
            }),
            window.settingsBridge.getApiKey().catch(err => {
              console.error('Failed to load API key:', err);
              return '';
            })
          ]);
          
          setSettings(currentSettings || {});
          setApiKey(storedKey || '');
        } catch (error) {
          console.error('Bootstrap error:', error);
        } finally {
          setLoading(false);
        }
      }
      bootstrap();

      window.settingsBridge.onSettingsUpdated((next) => {
        setSettings(next);
      });
    }, []);

    if (loading) {
      return React.createElement('div', { className: 'app' }, 'Loading preferences…');
    }

    const updateSetting = (key, value) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    };

    const handleSave = async () => {
      setSaving(true);
      setMessage('');
      try {
        await window.settingsBridge.saveSettings(settings);
        setMessage('Settings saved ✅');
      } catch (error) {
        console.error(error);
        setMessage('Failed to save settings');
      } finally {
        setSaving(false);
      }
    };

    const handleSaveKey = async () => {
      setSaving(true);
      setMessage('');
      try {
        await window.settingsBridge.saveApiKey(apiKey.trim());
        setMessage('API key updated ✅');
      } catch (error) {
        console.error(error);
        setMessage('Failed to update API key');
      } finally {
        setSaving(false);
      }
    };

    return React.createElement(
      'div',
      { className: 'app' },
      React.createElement('img', { src: './build/logo.png', className: 'app-logo', alt: 'Flash Type Logo' }),
      React.createElement(
        'section',
        null,
        React.createElement('label', null, 'Groq API Key'),
        React.createElement('input', {
          type: 'password',
          placeholder: 'gsk_...',
          value: apiKey,
          onChange: (e) => setApiKey(e.target.value)
        }),
        React.createElement(
          'div',
          { className: 'button-row' },
          React.createElement(
            'button',
            { onClick: handleSaveKey, disabled: saving },
            'Save Key'
          ),
          React.createElement(
            'button',
            {
              className: 'secondary',
              onClick: () => {
                setApiKey('');
                window.settingsBridge.saveApiKey('');
              }
            },
            'Clear Key'
          )
        ),
        React.createElement(
          'p',
          { className: 'hint' },
          'Stored securely using the OS credential vault via keytar.'
        )
      ),
      React.createElement(
        'section',
        null,
        React.createElement('label', null, 'Groq Whisper model'),
        React.createElement(
          'select',
          {
            value: settings.transcriptionModel,
            onChange: (e) => updateSetting('transcriptionModel', e.target.value)
          },
          React.createElement('option', { value: 'whisper-large-v3-turbo' }, 'whisper-large-v3-turbo'),
          React.createElement('option', { value: 'whisper-large-v3' }, 'whisper-large-v3'),
          React.createElement('option', { value: 'distil-whisper-large-v3-en' }, 'distil-whisper-large-v3-en')
        )
      ),
      React.createElement(
        'section',
        null,
        React.createElement('label', null, 'Transcription Language'),
        React.createElement(
          'select',
          {
            value: settings.language || '',
            onChange: (e) => updateSetting('language', e.target.value)
          },
          React.createElement('option', { value: '' }, 'Auto-detect'),
          React.createElement('option', { value: 'en' }, 'English'),
          React.createElement('option', { value: 'hi' }, 'Hindi (हिन्दी)')
        ),
        React.createElement(
          'p',
          { className: 'hint' },
          'Select your spoken language for better transcription accuracy.'
        )
      ),
      (settings.language === 'hi' || settings.language === '') && React.createElement(
        'section',
        null,
        React.createElement('label', null, 'Hindi Output Preference (if detected)'),
        React.createElement(
          'div',
          { style: { display: 'flex', gap: '10px', marginTop: '5px' } },
          React.createElement(
            'label',
            { style: { display: 'flex', alignItems: 'center', fontWeight: 'normal' } },
            React.createElement('input', {
              type: 'radio',
              name: 'hindiScriptPreference',
              value: 'devanagari',
              checked: settings.hindiScriptPreference === 'devanagari' || !settings.hindiScriptPreference,
              onChange: (e) => updateSetting('hindiScriptPreference', e.target.value),
              style: { marginRight: '5px' }
            }),
            'Devanagari (हिन्दी)'
          ),
          React.createElement(
            'label',
            { style: { display: 'flex', alignItems: 'center', fontWeight: 'normal' } },
            React.createElement('input', {
              type: 'radio',
              name: 'hindiScriptPreference',
              value: 'roman',
              checked: settings.hindiScriptPreference === 'roman',
              onChange: (e) => updateSetting('hindiScriptPreference', e.target.value),
              style: { marginRight: '5px' }
            }),
            'Roman (Hindi)'
          )
        )
      ),
      React.createElement(
        'section',
        null,
        React.createElement('label', null, 'Groq completion model'),
        React.createElement(
          'select',
          {
            value: settings.completionModel,
            onChange: (e) => updateSetting('completionModel', e.target.value)
          },
          React.createElement('option', { value: 'llama-3.1-8b-instant' }, 'llama-3.1-8b-instant'),
          React.createElement('option', { value: 'llama-3.3-70b-versatile' }, 'llama-3.3-70b-versatile'),
          React.createElement('option', { value: 'gemma2-9b-it' }, 'gemma2-9b-it')
        )
      ),
      React.createElement(
        'section',
        null,
        React.createElement('label', null, 'Preset formatting'),
        React.createElement(
          'div',
          { className: 'presets' },
          PRESETS.map((preset) =>
            React.createElement(
              'div',
              {
                key: preset.id,
                className: `preset-card ${settings.preset === preset.id ? 'active' : ''}`,
                onClick: () => updateSetting('preset', preset.id)
              },
              preset.label
            )
          )
        )
      ),
      React.createElement(
        'section',
        null,
        React.createElement('label', null, 'Processing Mode'),
        React.createElement(
          'div',
          { style: { display: 'flex', gap: '10px', marginTop: '5px' } },
          React.createElement(
            'label',
            { style: { display: 'flex', alignItems: 'center', fontWeight: 'normal' } },
            React.createElement('input', {
              type: 'radio',
              name: 'processingMode',
              value: 'grammar-only',
              checked: settings.processingMode === 'grammar-only',
              onChange: (e) => updateSetting('processingMode', e.target.value),
              style: { marginRight: '5px' }
            }),
            'Fix only grammar'
          ),
          React.createElement(
            'label',
            { style: { display: 'flex', alignItems: 'center', fontWeight: 'normal' } },
            React.createElement('input', {
              type: 'radio',
              name: 'processingMode',
              value: 'grammar-and-reframe',
              checked: settings.processingMode === 'grammar-and-reframe' || !settings.processingMode,
              onChange: (e) => updateSetting('processingMode', e.target.value),
              style: { marginRight: '5px' }
            }),
            'Fix grammar and reframe'
          )
        )
      ),
      React.createElement(
        'section',
        null,
        React.createElement(
          'label',
          null,
          React.createElement('input', {
            type: 'checkbox',
            checked: settings.autoPaste,
            onChange: (e) => updateSetting('autoPaste', e.target.checked)
          }),
          ' Auto-paste result'
        ),
        React.createElement(
          'label',
          null,
          React.createElement('input', {
            type: 'checkbox',
            checked: settings.notifyOnComplete,
            onChange: (e) => updateSetting('notifyOnComplete', e.target.checked)
          }),
          ' Show notification when ready'
        ),
        React.createElement(
          'label',
          null,
          React.createElement('input', {
            type: 'checkbox',
            checked: settings.keepRecordings,
            onChange: (e) => updateSetting('keepRecordings', e.target.checked)
          }),
          ' Keep audio files after upload'
        )
      ),
      React.createElement(
        'div',
        { className: 'button-row' },
        React.createElement(
          'button',
          { onClick: handleSave, disabled: saving },
          saving ? 'Saving…' : 'Save Preferences'
        )
      ),
      message && React.createElement('p', { className: 'hint' }, message)
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
}

