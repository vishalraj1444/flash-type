const fs = require('fs');
const FormData = require('form-data');

const STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const CHAT_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const REFRAME_SYSTEM_PROMPT = `You are a transcript cleaner. You fix grammar, spelling, and punctuation while keeping the speaker's exact words. 
CRITICAL RULES:
- Ensure strict grammatical correctness and proper punctuation (commas, periods, question marks).
- Fix run-on sentences by splitting them into proper sentences.
- Remove any hallucinated text or repetitive loops (e.g., "in Hindi in Hindi in Hindi").
- DO NOT TRANSLATE. Keep every word in its original language.
- For mixed Hindi/English (Hinglish): Keep Hindi words in Roman script EXACTLY as given. DO NOT "fix" Hindi spelling - words like "chalo", "bhai", "kya", "hai" are correct as-is.
- Only fix obvious English spelling/grammar errors. Leave Hindi words untouched.
- Never add explanations or commentary. 
- Output only the cleaned text.`;

const GRAMMAR_SYSTEM_PROMPT = `You are a strict grammar corrector. You fix ONLY grammar, spelling, and punctuation errors. 
CRITICAL RULES:
- Remove any hallucinated text or repetitive loops.
- DO NOT TRANSLATE. Keep every word in its original language.
- For mixed Hindi/English: Preserve code-switching exactly. DO NOT "correct" Hindi words - they are phonetically spelled in Roman and are correct as-is.
- Only fix objective English errors (spelling mistakes, missing punctuation).
- Do NOT touch Hindi words at all - words like "chalo", "bhai", "accha", "kya" are already correct.
- Output only the corrected text.`;

const PRESET_SYSTEM_PROMPTS = {
  'bullet-points': `You clean transcripts and format them. ONLY create numbered lists when ordinal words (first, second, third, etc.) clearly introduce separate distinct points or topics. Keep ordinal words when they're used as sentence connectors, adverbs, or part of normal speech flow. 
  CRITICAL:
  - DO NOT TRANSLATE. Keep every word in its original language. For Hinglish, preserve code-switching exactly.
  - Output only the cleaned text, nothing else.`,
  'note': `You clean transcripts and format them as well-structured notes. Ensure strict grammatical correctness and proper punctuation. ONLY create numbered lists when ordinal words (first, second, third, then, next) clearly introduce separate distinct topics or distinct points (e.g., "First problem is X. Second issue is Y"). Keep ordinal words when they're used as sentence connectors, adverbs, or part of normal speech (e.g., "First, tell me..." or "I first went..." or "The first thing I noticed..."). When topics change, use new paragraphs. 
  CRITICAL:
  - DO NOT TRANSLATE. Keep every word in its original language. For Hinglish, preserve "chalo bhai" as "chalo bhai", not "come on brother".
  - Output only the cleaned text, nothing else.`,
  'email': `You clean transcripts and format as emails. 
  CRITICAL:
  - DO NOT TRANSLATE. Keep every word in its original language. Preserve mixed Hindi/English exactly.
  - Output only the cleaned text, nothing else.`,
  'default': `You clean transcripts and format them as well-structured notes. Ensure strict grammatical correctness and proper punctuation. ONLY create numbered lists when ordinal words (first, second, third, then, next) clearly introduce separate distinct topics or distinct points (e.g., "First problem is X. Second issue is Y"). Keep ordinal words when they're used as sentence connectors, adverbs, or part of normal speech (e.g., "First, tell me..." or "I first went..." or "The first thing I noticed..."). When topics change, use new paragraphs. 
  CRITICAL:
  - DO NOT TRANSLATE. Keep every word in its original language. For Hinglish, preserve "chalo bhai" as "chalo bhai", not "come on brother".
  - Output only the cleaned text, nothing else.`
};

const fetchFn = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

function makeAuthHeaders(apiKey) {
  if (!apiKey) {
    throw new Error('Groq API key is required but was not provided.');
  }

  return {
    Authorization: `Bearer ${apiKey}`
  };
}

async function transcribeAudio({ apiKey, filePath, model = 'whisper-large-v3-turbo', language, signal }) {
  console.log('\n=== TRANSCRIPTION ===');
  console.log('Model:', model);
  console.log('File:', filePath);
  
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  
  // Strong multilingual prompt for code-switching
  // Tell Whisper to transcribe Hindi phonetically in Roman, keep English as-is
  const whisperPrompt = 'Mixed Hindi-English conversation. Transcribe Hindi words phonetically in Roman/Latin script (not Devanagari). Keep English words in English. Example: "chalo bhai let\'s go" not "come on brother let\'s go". Do not translate.';
  
  form.append('prompt', whisperPrompt);
  if (language) form.append('language', language);

  console.log('Language mode:', language || 'auto-detect');
  console.log('Uploading to Groq STT...');
  
  const response = await fetchFn(STT_ENDPOINT, {
    method: 'POST',
    headers: makeAuthHeaders(apiKey),
    body: form,
    signal
  });

  if (!response.ok) {
    const message = await safeReadJson(response);
    throw new Error(`Groq STT failed (${response.status}): ${message}`);
  }

  const payload = await response.json();
  if (!payload?.text) {
    throw new Error('Groq STT response did not include text.');
  }

  // Normalization map for language names to ISO codes
  const LANGUAGE_MAP = {
    'hindi': 'hi',
    'english': 'en',
    // add others if needed in future
  };

  let detectedLanguage = payload.language || language;
  
  // Normalize detected language to lowercase ISO code if it comes back as a full name
  if (detectedLanguage) {
    const lower = detectedLanguage.toLowerCase();
    if (LANGUAGE_MAP[lower]) {
      detectedLanguage = LANGUAGE_MAP[lower];
    } else {
      detectedLanguage = lower; // fallback to lowercase
    }
  }

  console.log('\n=== RAW TRANSCRIPTION ===');
  console.log('Language:', detectedLanguage);
  console.log(payload.text);
  console.log('=========================\n');
  
  return {
    text: payload.text,
    language: detectedLanguage
  };
}

// Indic languages that need transliteration
const INDIC_LANGUAGES = ['hi'];

async function transliterateToRoman({ apiKey, text, language, completionModel = 'llama-3.1-8b-instant', signal }) {
  if (!INDIC_LANGUAGES.includes(language)) {
    return text; // No transliteration needed
  }

  console.log('\n=== TRANSLITERATION ===');
  console.log('Language:', language);
  console.log('Converting to Roman script...');

  const transliterationPrompt = `Convert this ${language === 'hi' ? 'Hindi' : 'text'} from Devanagari script to Roman/Latin script (transliteration). 

IMPORTANT: 
- Use standard phonetic transliteration (e.g., "मैं" = "main", "है" = "hai", "चलो" = "chalo", "भाई" = "bhai")
- Only output the transliterated text in Roman letters
- Do NOT translate the meaning
- Do NOT add explanations or commentary
- Keep the same structure and punctuation
- Be consistent with spelling

Text to transliterate:
"""
${text}
"""`;

  const response = await fetchFn(CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      ...makeAuthHeaders(apiKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: completionModel,
      temperature: 0.0, // Reduce temperature for more consistent transliteration
      messages: [
        { 
          role: 'system', 
          content: 'You are a transliteration assistant. Convert text from Devanagari/Indic scripts to Roman/Latin script using standard phonetic spellings. Be consistent and accurate. Output only the transliterated text, nothing else.' 
        },
        { role: 'user', content: transliterationPrompt }
      ]
    }),
    signal
  });

  if (!response.ok) {
    const message = await safeReadJson(response);
    console.warn(`Transliteration failed (${response.status}): ${message}, using original text`);
    return text; // Fallback to original
  }

  const payload = await response.json();
  const transliterated = payload?.choices?.[0]?.message?.content?.trim();
  
  if (!transliterated) {
    console.warn('Transliteration returned empty, using original text');
    return text;
  }

  console.log('\n=== TRANSLITERATED TEXT ===');
  console.log(transliterated);
  console.log('===========================\n');
  
  return transliterated;
}

async function formatTranscript({
  apiKey,
  transcript,
  preset = 'default',
  processingMode = 'grammar-and-reframe',
  completionModel = 'llama-3.1-8b-instant',
  temperature = 0.2,
  language,
  hindiScriptPreference = 'devanagari',
  signal
}) {
  // Step 1: Transliterate if needed (Hindi only if Roman script is preferred)
  // Logic: Check language (which might be detected from Auto) against 'hi'
  let processedTranscript = transcript;
  
  // Check if text contains Devanagari characters (Unicode range U+0900 to U+097F)
  const hasDevanagari = /[\u0900-\u097F]/.test(transcript);
  
  if (language === 'hi' && hindiScriptPreference === 'roman' && hasDevanagari) {
    processedTranscript = await transliterateToRoman({
      apiKey,
      text: transcript,
      language,
      completionModel,
      signal
    });
  }

  let formatInstructions = '';
  let systemPrompt = '';

  if (processingMode === 'grammar-only') {
    systemPrompt = GRAMMAR_SYSTEM_PROMPT;
    formatInstructions = 'Fix grammar, spelling, and punctuation errors. Do not rephrase or restructure the text.';
  } else {
    // Grammar + Reframe (original behavior)
    systemPrompt = PRESET_SYSTEM_PROMPTS[preset] || PRESET_SYSTEM_PROMPTS['default'];
    
    switch (preset) {
      case 'email':
        formatInstructions = `Format as a professional email with appropriate greeting and sign-off.`;
        break;
      case 'bullet-points':
        formatInstructions = `Format as numbered list ONLY when ordinal words clearly introduce separate distinct points (e.g., "First problem is X. Second issue is Y"). Otherwise use bullet points. Keep ordinal words when they're used as sentence connectors or adverbs (e.g., "First, let me say..." or "I first went to...").`;
        break;
      case 'note':
        formatInstructions = `Format as a structured note. ONLY create numbered lists when ordinal words (first, second, third, etc.) clearly introduce separate distinct topics or distinct points (e.g., "First problem is X. Second issue is Y"). Keep ordinal words when they're used as sentence connectors, adverbs, or part of normal speech (e.g., "First, tell me..." or "I first went..." or "The first thing I noticed..."). When topics change, use new paragraphs. Keep all other words exactly as spoken.`;
        break;
      default:
        formatInstructions = `Format as a structured note. ONLY create numbered lists when ordinal words (first, second, third, etc.) clearly introduce separate distinct topics or distinct points (e.g., "First problem is X. Second issue is Y"). Keep ordinal words when they're used as sentence connectors, adverbs, or part of normal speech (e.g., "First, tell me..." or "I first went..." or "The first thing I noticed..."). When topics change, use new paragraphs. Keep all other words exactly as spoken.`;
    }
  }

  console.log('\n=== AI FORMATTING ===');
  console.log('Preset:', preset);
  console.log('Mode:', processingMode);
  console.log('Model:', completionModel);
  console.log('Format:', formatInstructions.split('\n')[0]);

  const userPrompt = `Clean up this speech transcript. ${formatInstructions}

IMPORTANT: Output ONLY the cleaned transcript text. Do NOT include any instructions, rules, explanations, notes, or commentary. Just the corrected spoken words.

Transcript to clean:
"""
${processedTranscript}
"""`;

  console.log('Sending to AI for formatting...');
  
  const response = await fetchFn(CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      ...makeAuthHeaders(apiKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: completionModel,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }),
    signal
  });

  if (!response.ok) {
    const message = await safeReadJson(response);
    throw new Error(`Groq Chat failed (${response.status}): ${message}`);
  }

  const payload = await response.json();
  const choice = payload?.choices?.[0]?.message?.content;
  if (!choice) {
    throw new Error('Groq Chat response did not include a completion.');
  }

  const result = choice.trim();
  console.log('\n=== FINAL OUTPUT ===');
  console.log('Format applied:', preset);
  const hasNumbers = /^\d+\./m.test(result);
  const hasBullets = result.includes('•') || /^-\s/m.test(result);
  const structure = hasNumbers ? 'Numbered list' : hasBullets ? 'Bullet points' : 'Paragraph format';
  console.log('Structure:', structure);
  console.log('\n' + result);
  console.log('====================\n');
  
  return result;
}

async function safeReadJson(response) {
  try {
    const text = await response.text();
    return text || response.statusText;
  } catch (error) {
    return response.statusText || error.message;
  }
}

module.exports = {
  transcribeAudio,
  formatTranscript
};

