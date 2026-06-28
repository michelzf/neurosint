'use strict';
/**
 * respond.js — converte texto em voz (ElevenLabs), sobe no storage e envia como
 * áudio no WhatsApp. Em qualquer falha de TTS/upload, cai para texto. Reutilizado
 * pelos schedules (matinal, relatório).
 */

const { GROUP_JID } = require('../config');
const evolution = require('../clients/evolution');
const elevenlabs = require('../clients/elevenlabs');
const supabase = require('../clients/supabase');
const { expandForTTS, chunkText } = require('../util');
const log = require('../logger');

let seq = 0;

/** Envia `text` como ÁUDIO (1+ voice notes) para `number`. Fallback texto em erro. */
async function speak(text, number = GROUP_JID) {
  const original = text;
  const ttsText = expandForTTS(text);
  if (!ttsText) return;
  const chunks = chunkText(ttsText);
  const stamp = Date.now();

  for (let i = 0; i < chunks.length; i++) {
    try {
      const mp3 = await elevenlabs.tts(chunks[i]);
      const path = `assistant/assistant_${stamp}_${String(i + 1).padStart(2, '0')}_${seq++}.mp3`;
      const url = await supabase.uploadAudio(path, mp3);
      await evolution.sendAudio(number, url);
    } catch (e) {
      log.warn('respond.tts_fallback', { err: e.message, chunk: i });
      // fallback: manda o texto original inteiro uma vez e para
      try {
        await evolution.sendText(number, `📝 _Áudio indisponível, segue em texto:_\n\n${original}`);
      } catch (e2) {
        log.error('respond.text_fallback_failed', { err: e2.message });
      }
      return;
    }
  }
}

/** Envia texto puro. */
function sendText(text, number = GROUP_JID, opts = {}) {
  return evolution.sendText(number, text, opts);
}

module.exports = { speak, sendText };
