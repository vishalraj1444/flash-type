const { clipboard, Notification } = require('electron');
const { exec, execSync } = require('child_process');

let savedWindowInfo = null;

function copyToClipboard(text) {
  clipboard.writeText(text || '', 'text/plain');
}

function runPowershell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execSync(`powershell -NoProfile -EncodedCommand "${encoded}"`, {
    stdio: 'pipe'
  }).toString().trim();
}

function captureActiveWindow() {
  if (process.platform !== 'win32') return;

  try {
    const psScript = `
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  using System.Text;
  public class WinAPI {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  }
"@
$hwnd = [WinAPI]::GetForegroundWindow()
$titleBuilder = New-Object System.Text.StringBuilder 512
[WinAPI]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity) | Out-Null
$title = $titleBuilder.ToString()
if (-not $title) { $title = "" }
'{ "handle": ' + $hwnd.ToInt64() + ', "title": "' + $title.Replace('"','\\"') + '" }'
    `.trim();

    const stdout = runPowershell(psScript);

    savedWindowInfo = JSON.parse(stdout);
    console.log('Captured active window:', savedWindowInfo);
  } catch (error) {
    console.warn('Unable to capture active window', error.message);
    savedWindowInfo = null;
  }
}

function restoreActiveWindow() {
  if (process.platform !== 'win32' || !savedWindowInfo) return false;

  let restored = false;

  if (savedWindowInfo.handle && savedWindowInfo.handle !== 0) {
    const psScript = `
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class WinAPI {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
  }
"@
[WinAPI]::SetForegroundWindow([IntPtr]${savedWindowInfo.handle})
    `.trim();

    try {
      runPowershell(psScript);
      restored = true;
    } catch (error) {
      console.warn('SetForegroundWindow failed', error.message);
    }
  }

  if (!restored && savedWindowInfo.title) {
    const safeTitle = savedWindowInfo.title.replace(/"/g, '``"');
    const psScript = `
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.Interaction]::AppActivate("${safeTitle}")
    `.trim();

    try {
      runPowershell(psScript);
      restored = true;
    } catch (error) {
      console.warn('AppActivate fallback failed', error.message);
    }
  }

  return restored;
}

function attemptPaste() {
  if (process.platform !== 'win32') return false;
  
  try {
    const startTime = Date.now();
    const restoreSuccess = restoreActiveWindow();
    const restoreTime = Date.now() - startTime;
    
    console.log(`[Paste] Window restore ${restoreSuccess ? 'succeeded' : 'failed'} in ${restoreTime}ms`);
    
    // Increased delay: 1.5-2 seconds for Windows to fully restore focus
    const delay = restoreSuccess ? 1500 : 2000;
    console.log(`[Paste] Waiting ${delay}ms before sending Ctrl+V...`);
    
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds ${delay}
[System.Windows.Forms.SendKeys]::SendWait("^v")
    `.trim();
    
    // Use execSync for reliability - wait for paste to complete
    const pasteStartTime = Date.now();
    runPowershell(psScript);
    const pasteTime = Date.now() - pasteStartTime;
    console.log(`✓ Paste command sent to original window (took ${pasteTime}ms total)`);
    return true;
  } catch (error) {
    console.error('Auto-paste failed:', error);
    // Retry once after additional delay
    console.log('[Paste] Retrying paste after 500ms...');
    try {
      setTimeout(() => {
        const retryScript = `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait("^v")
        `.trim();
        runPowershell(retryScript);
        console.log('✓ Paste retry succeeded');
      }, 500);
    } catch (retryError) {
      console.error('Paste retry also failed:', retryError);
    }
    return false;
  }
}

function notify({ title, body }) {
  new Notification({ title, body, silent: false }).show();
}

function deliverText(text, { autoPaste = true } = {}) {
  copyToClipboard(text);
  
  if (autoPaste) {
    attemptPaste();
    // Small delay then notify
    setTimeout(() => {
      notify({
        title: 'Groq Voice Typr',
        body: 'Text pasted automatically!'
      });
    }, 200);
  } else {
    notify({
      title: 'Groq Voice Typr',
      body: 'Formatted text copied. Press Ctrl+V to paste.'
    });
  }

  return { pasted: autoPaste };
}

module.exports = {
  copyToClipboard,
  deliverText,
  notify,
  captureActiveWindow
};

