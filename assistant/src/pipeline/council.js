'use strict';
/**
 * council.js — chama o "Conselho de Especialistas" (claude-sonnet-4-6) com o system
 * prompt externalizado + tool OpenEvidence (tool-use loop). Retorna a resposta em texto.
 */

const fs = require('node:fs');
const path = require('node:path');
const { COUNCIL_MODEL, COUNCIL_MAX_TOKENS, COUNCIL_TEMPERATURE } = require('../config');
const anthropic = require('../clients/anthropic');
const openevidence = require('../clients/openevidence');
const log = require('../logger');

// Usa o seu prompt privado (system-prompt.md, gitignored) se existir; senão, o exemplo genérico.
const PROMPTS_DIR = path.join(__dirname, '..', '..', 'prompts');
const PROMPT_PATH = fs.existsSync(path.join(PROMPTS_DIR, 'system-prompt.md'))
  ? path.join(PROMPTS_DIR, 'system-prompt.md')
  : path.join(PROMPTS_DIR, 'system-prompt.example.md');
const SYSTEM_PROMPT = fs.readFileSync(PROMPT_PATH, 'utf8');

const TOOLS = [
  {
    name: 'buscar_evidencia_cientifica',
    description:
      'Busca evidência científica peer-reviewed (NEJM, JAMA, Lancet, NCCN, Cochrane, Movement Disorders) sobre Parkinson, DBS, medicações e diretrizes clínicas. Use quando precisar confirmar um dado clínico. A pergunta DEVE ser feita em INGLÊS.',
    input_schema: {
      type: 'object',
      properties: { question: { type: 'string', description: 'Pergunta clínica objetiva, em inglês.' } },
      required: ['question'],
    },
  },
];

/** @param {string} context  bloco de contexto (turno user) @returns {Promise<string>} */
async function ask(context) {
  const messages = [{ role: 'user', content: context }];

  for (let i = 0; i < 3; i++) {
    let resp;
    try {
      resp = await anthropic.messages({
        model: COUNCIL_MODEL,
        system: SYSTEM_PROMPT,
        messages,
        tools: TOOLS,
        max_tokens: COUNCIL_MAX_TOKENS,
        temperature: COUNCIL_TEMPERATURE,
      });
    } catch (e) {
      log.error('council.call_failed', { err: e.message, iter: i });
      if (i === 0) throw e;
      break;
    }

    if (resp.stop_reason === 'tool_use') {
      const toolUses = (resp.content || []).filter((b) => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: resp.content });
      const results = [];
      for (const tu of toolUses) {
        const q = tu.input?.question || '';
        log.info('council.tool_call', { tool: tu.name, q: q.slice(0, 120) });
        const evidence = tu.name === 'buscar_evidencia_cientifica' ? await openevidence.analysis(q) : 'Tool desconhecida.';
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(evidence).slice(0, 6000) });
      }
      messages.push({ role: 'user', content: results });
      continue; // próxima volta o modelo redige a resposta final
    }

    return anthropic.textOf(resp);
  }

  // se esgotou o loop em tool_use, faz uma última chamada sem tools forçando texto
  try {
    const final = await anthropic.messages({
      model: COUNCIL_MODEL,
      system: SYSTEM_PROMPT,
      messages,
      max_tokens: COUNCIL_MAX_TOKENS,
      temperature: COUNCIL_TEMPERATURE,
    });
    return anthropic.textOf(final);
  } catch (e) {
    log.error('council.final_failed', { err: e.message });
    return '';
  }
}

module.exports = { ask, SYSTEM_PROMPT };
