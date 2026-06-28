'use strict';
/**
 * evolution.js — cliente da Evolution API (WhatsApp). A instância vem de config.EVOLUTION_INSTANCE.
 * Auth: header `apikey`.
 */

const { EVOLUTION_BASE, EVOLUTION_INSTANCE } = require('../config');
const secrets = require('../secrets');

const INST = encodeURIComponent(EVOLUTION_INSTANCE);

function apikey() {
  return secrets.get('EVOLUTION_API_KEY', { required: true });
}

async function post(path, body, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${EVOLUTION_BASE}${path}`, {
      method: 'POST',
      headers: { apikey: apikey(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Evolution ${path} ${res.status}: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(t);
  }
}

/** Texto simples. `mentions` = array de JIDs (ex: ['5511...@s.whatsapp.net']). */
function sendText(number, text, { mentions } = {}) {
  const body = { number, text };
  if (mentions && mentions.length) body.mentioned = mentions;
  return post(`/message/sendText/${INST}`, body);
}

/** Áudio (voice note) a partir de uma URL pública (mp3/ogg). */
function sendAudio(number, audioUrl) {
  return post(`/message/sendWhatsAppAudio/${INST}`, { number, audio: audioUrl }, 60000);
}

/** Mídia genérica (document/image) — `media` = URL pública ou base64. */
function sendMedia(number, { mediatype, media, fileName, caption, mimetype }) {
  const body = { number, mediatype, media };
  if (fileName) body.fileName = fileName;
  if (caption) body.caption = caption;
  if (mimetype) body.mimetype = mimetype;
  return post(`/message/sendMedia/${INST}`, body, 60000);
}

/** Baixa a mídia de uma mensagem recebida (retorna { base64 }). `messageKey` = data.key. */
function getBase64FromMedia(messageKey) {
  return post(`/chat/getBase64FromMediaMessage/${INST}`, { message: { key: messageKey } }, 20000);
}

module.exports = { sendText, sendAudio, sendMedia, getBase64FromMedia };
