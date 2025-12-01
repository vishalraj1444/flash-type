const keytar = require('keytar');

const SERVICE_NAME = 'GroqVoiceTypr';
const ACCOUNT_NAME = 'default';

(async () => {
  try {
    const removed = await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    if (removed) {
      console.log('Groq API key removed from credential store.');
    } else {
      console.log('No stored Groq API key was found.');
    }
  } catch (error) {
    console.error('Failed to clear API key:', error);
    process.exitCode = 1;
  }
})();

