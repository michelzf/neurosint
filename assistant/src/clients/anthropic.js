'use strict';
/**
 * anthropic.js — cliente da Anthropic Messages API (direto, sem litellm).
 * Usado pelo conselho (claude-sonnet-4-6, com tool OpenEvidence) e pelo haiku
 * (extração de PDF, resumo de conversa, relatórios).
 */

const { HAIKU_MODEL, ANTHROPIC_VERSION } = require('../config');
const secrets = require('../secrets');

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

function headers() {
  return {
    'x-api-key': secrets.get('ANTHROPIC_API_KEY', { required: true }),
    'anthropic-version': ANTHROPIC_VERSION,
    'Content-Type': 'application/json',
  };
}

/**
 * Chamada crua à Messages API. Retorna o objeto de resposta completo
 * (inclui content[], stop_reason, etc.) para suportar tool-use loop.
 */
async function messages({ model, system, messages: msgs, tools, max_tokens, temperature }, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = { model, max_tokens, messages: msgs };
    if (system) body.system = system;
    if (tools) body.tools = tools;
    if (typeof temperature === 'number') body.temperature = temperature;
    const res = await fetch(ENDPOINT, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`Anthropic ${model} ${res.status}: ${text.slice(0, 400)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

/** Helper: extrai o texto concatenado dos blocos `text` de uma resposta. */
function textOf(resp) {
  return (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/** Convenience: 1 turno user → string de texto (haiku por padrão). */
async function complete({ model = HAIKU_MODEL, system, prompt, max_tokens = 800, temperature = 0.2 }, timeoutMs) {
  const resp = await messages(
    { model, system, messages: [{ role: 'user', content: prompt }], max_tokens, temperature },
    timeoutMs
  );
  return textOf(resp);
}

/** Extrai todo o conteúdo de um PDF (base64) — receita/exame/laudo. */
async function extractPdf(base64, instruction) {
  const resp = await messages(
    {
      model: HAIKU_MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: instruction || 'Extraia TODO o conteúdo clínico relevante deste documento (exames, receitas, laudos, datas, médicos). Responda em português.' },
          ],
        },
      ],
    },
    30000
  );
  return textOf(resp);
}

module.exports = { messages, complete, extractPdf, textOf };
