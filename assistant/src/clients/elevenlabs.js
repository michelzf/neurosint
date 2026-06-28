'use strict';
/**
 * elevenlabs.js — TTS. Converte texto em mp3 (Buffer) com a voz do assistente.
 */

const { ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL, ELEVENLABS_VOICE_SETTINGS } = require('../config');
const secrets = require('../secrets');

/** @returns {Promise<Buffer>} mp3 */
async function tts(text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': secrets.get('ELEVENLABS_API_KEY', { required: true }),
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL,
      voice_settings: ELEVENLABS_VOICE_SETTINGS,
      speed: 1.0,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ElevenLabs TTS ${res.status}: ${t.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { tts };
