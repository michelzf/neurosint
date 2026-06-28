'use strict';
/**
 * morning.js — Check-in matinal proativo (8h BRT, diário).
 * Mensagem de bom dia gerada por haiku com base no contexto. Enviada como ÁUDIO (TTS).
 */

const { PATIENT_ID, HAIKU_MODEL, ASSISTANT_NAME, PATIENT_NAME, PRIMARY_MED_NAME } = require('../config');
const supabase = require('../clients/supabase');
const anthropic = require('../clients/anthropic');
const respond = require('../pipeline/respond');
const { contextBlurb } = require('./_shared');
const { stripBracketTags } = require('../util');
const log = require('../logger');

const SYSTEM =
  `Você é o ${ASSISTANT_NAME}, assistente de cuidado de um paciente com Parkinson. ` +
  'Escreva uma mensagem de bom dia curta (3 a 4 frases), calorosa e natural em português falado. ' +
  'Esta mensagem será CONVERTIDA EM ÁUDIO: nada de markdown, asteriscos, abreviações ou emojis; ' +
  `escreva números e horários por extenso. Inclua, de forma leve, o lembrete da ${PRIMARY_MED_NAME} da manhã. ` +
  'Adapte o tom ao estado recente do paciente. Sem tom de coach.';

async function run({ test = false } = {}) {
  let blurb = '';
  try {
    const ctx = (await supabase.rpc('assistant_get_patient_context', { p_patient_id: PATIENT_ID })) || {};
    blurb = contextBlurb(ctx);
  } catch (e) {
    log.warn('morning.context_failed', { err: e.message });
  }

  let msg = `Bom dia! Espero que tenha descansado bem. Não esqueça da ${PRIMARY_MED_NAME} da manhã, tá? Qualquer coisa estou aqui.`;
  try {
    const gen = await anthropic.complete({ model: HAIKU_MODEL, system: SYSTEM, prompt: `Paciente: ${PATIENT_NAME}.\nContexto recente:\n${blurb}\n\nEscreva o bom dia.`, max_tokens: 400, temperature: 0.5 });
    if (gen) msg = stripBracketTags(gen);
  } catch (e) {
    log.warn('morning.gen_failed', { err: e.message });
  }

  if (test) await respond.sendText(`🧪 (teste matinal) ${msg}`);
  else await respond.speak(msg);
  return { ok: true };
}

module.exports = { run };
