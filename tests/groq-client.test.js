const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nock = require('nock');

const { transcribeAudio, formatTranscript } = require('../groq-client');

test('formatTranscript builds prompt with preset information', async () => {
  const transcript = 'raw words';
  const preset = 'email';
  const apiKey = 'test-key';
  const responseText = 'Cleaned text\nSUMMARY: A thing';

  nock('https://api.groq.com', {
    reqheaders: { Authorization: `Bearer ${apiKey}` }
  })
    .post('/openai/v1/chat/completions', (body) => {
      assert.equal(body.model, 'groq/llama-3.1-8b-instant');
      assert.ok(body.messages[1].content.includes('Preset requested: email'));
      assert.ok(body.messages[1].content.includes('<<<raw words>>>'));
      return true;
    })
    .reply(200, {
      choices: [{ message: { content: responseText } }]
    });

  const formatted = await formatTranscript({ apiKey, transcript, preset });
  assert.equal(formatted, responseText);
});

test('transcribeAudio returns Groq text payload', async () => {
  const apiKey = 'test-key';
  const tmpFile = path.join(__dirname, 'sample.wav');
  fs.writeFileSync(tmpFile, 'pcm');

  nock('https://api.groq.com', {
    reqheaders: { Authorization: `Bearer ${apiKey}` }
  })
    .post('/openai/v1/audio/transcriptions')
    .reply(200, { text: 'hello world' });

  const text = await transcribeAudio({
    apiKey,
    filePath: tmpFile,
    model: 'whisper-large-v3-turbo'
  });

  assert.equal(text, 'hello world');
  fs.unlinkSync(tmpFile);
});

