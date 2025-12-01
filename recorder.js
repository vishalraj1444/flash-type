const state = {
  stream: null,
  recorder: null,
  chunks: [],
  startTime: null,
  timerInterval: null
};

const statusEl = document.getElementById('status');
const timerEl = document.getElementById('timer');
const modeEl = document.getElementById('mode');
const formatEl = document.getElementById('format');

function log(msg) {
  console.log(msg);
}

log('Recorder initialized');
window.recorderBridge.notifyReady();

window.recorderBridge.onCommand(async ({ action, mode, format }) => {
  if (action === 'start') {
    if (mode) modeEl.textContent = mode;
    if (format) formatEl.textContent = format;
    await startRecording();
  }
  if (action === 'stop') {
    stopRecording();
  }
});

function updateUI(recording) {
  if (recording) {
    statusEl.textContent = '🔴 Recording';
    startTimer();
    document.getElementById('meta').style.display = 'block';
  } else {
    statusEl.textContent = '⏹️ Processing';
    timerEl.textContent = '';
    stopTimer();
    // Keep meta visible during processing or hide?
    // User didn't specify, but usually nice to see what's processing.
  }
}

function startTimer() {
  stopTimer();
  let seconds = 0;
  timerEl.textContent = '0:00';
  state.timerInterval = setInterval(() => {
    seconds++;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

async function startRecording() {
  if (state.recorder && state.recorder.state === 'recording') {
    log('Already recording');
    return;
  }

  try {
    // Always request fresh microphone access
    log('Requesting microphone access...');
    state.stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    log('Microphone access granted! Stream active: ' + state.stream.active);
    log('Audio tracks: ' + state.stream.getAudioTracks().length);

    state.chunks = [];
    
    // Check supported mime types
    const mimeTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ];
    
    let selectedMimeType = mimeTypes[0];
    for (const type of mimeTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        selectedMimeType = type;
        log('Using MIME type: ' + type);
        break;
      }
    }
    
    state.recorder = new MediaRecorder(state.stream, {
      mimeType: selectedMimeType
    });

    state.recorder.ondataavailable = (event) => {
      // Only log occasionally to avoid spam
      if (state.chunks.length % 300 === 0) { // Every 30 seconds (300 * 100ms)
        log('Recording... ' + Math.floor((Date.now() - state.startTime) / 1000) + 's');
      }
      if (event.data && event.data.size > 0) {
        state.chunks.push(event.data);
      }
    };

    state.recorder.onstop = handleStop;
    
    state.recorder.onerror = (event) => {
      log('ERROR: MediaRecorder error - ' + event.error);
      window.recorderBridge.reportError('Recording error: ' + event.error);
    };

    state.startTime = Date.now();
    // Request data every 100ms to ensure we capture audio
    state.recorder.start(100);
    log('Recording started! State: ' + state.recorder.state);
    updateUI(true);
  } catch (error) {
    log('ERROR: ' + error.message);
    window.recorderBridge.reportError(error.message || 'Unable to access microphone');
  }
}

function stopRecording() {
  if (state.recorder && state.recorder.state !== 'inactive') {
    log('Stopping recorder... Chunks collected: ' + state.chunks.length);
    state.recorder.stop();
    updateUI(false);
  } else {
    log('Recorder not active. State: ' + (state.recorder?.state || 'null'));
  }
}

async function handleStop() {
  try {
    log('handleStop called. Total chunks: ' + state.chunks.length);
    const blob = new Blob(state.chunks, { type: 'audio/webm;codecs=opus' });
    log('Blob created. Size: ' + blob.size + ' bytes');
    
    if (blob.size === 0) {
      log('ERROR: Recording is empty!');
      window.recorderBridge.reportError('No audio data captured. Microphone may not be working or recording was too short.');
      return;
    }
    
    log('Converting to array buffer...');
    const arrayBuffer = await blob.arrayBuffer();
    log('Saving recording (' + arrayBuffer.byteLength + ' bytes)...');
    
    await window.recorderBridge.saveRecording({
      arrayBuffer,
      mimeType: blob.type,
      durationMs: Date.now() - (state.startTime || Date.now())
    });
    
    log('✅ Recording saved successfully!');
  } catch (error) {
    log('ERROR: ' + error.message);
    window.recorderBridge.reportError(error.message || 'Failed to save recording');
  } finally {
    state.chunks = [];
    state.startTime = null;
  }
}

