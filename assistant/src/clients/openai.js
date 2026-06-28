'use strict';
/**
 * openai.js — Whisper (transcrição de áudio) + visão de imagem. Chamadas diretas à OpenAI.
 */

const { WHISPER_MODEL, VISION_MODEL } = require('../config');
const secrets = require('../secrets');

function authHeader() {
  return `Bearer ${secrets.get('OPENAI_API_KEY', { required: true })}`;
}

/** Transcreve um áudio (Buffer ogg/mp3) via Whisper, idioma pt. Retorna o texto. */
async function transcribe(buffer, filename = 'audio.ogg') {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('model', WHISPER_MODEL);
  form.append('language', 'pt');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI transcribe ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).text || '';
}

/** Descreve uma imagem (base64) com gpt-4.1-mini. Retorna a descrição em pt. */
async function describeImage(base64, mimetype = 'image/jpeg', prompt) {
  const body = {
    model: VISION_MODEL,
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              prompt ||
              'Descreva esta imagem em português de forma objetiva. Se for um exame, receita, configuração de DBS ou refeição, descreva os dados relevantes (valores, nomes, doses, alimentos).',
          },
          { type: 'image_url', image_url: { url: `data:${mimetype};base64,${base64}` } },
        ],
      },
    ],
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI vision ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).choices?.[0]?.message?.content || '';
}

module.exports = { transcribe, describeImage };
