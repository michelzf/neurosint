'use strict';
/**
 * caregiver.js — Check-in com o cuidador principal (semanal).
 * Mensagem calorosa de cuidado com quem cuida (prevenção de burnout), gerada por haiku
 * com base no contexto. Enviada como TEXTO ao grupo, com @mention do cuidador.
 */

const { PATIENT_ID, GROUP_JID, CAREGIVER_JID, HAIKU_MODEL, ASSISTANT_NAME, PATIENT_NAME, CAREGIVER_NAME } = require('../config');
const supabase = require('../clients/supabase');
const anthropic = require('../clients/anthropic');
const respond = require('../pipeline/respond');
const { contextBlurb } = require('./_shared');
const { stripBracketTags } = require('../util');
const log = require('../logger');

const SYSTEM =
  `Você é o ${ASSISTANT_NAME}, assistente de cuidado de uma família. ` +
  `Escreva uma mensagem curta (no máximo 4 frases), calorosa e natural em português, dirigida a ${CAREGIVER_NAME}, o cuidador principal. ` +
  'O objetivo é cuidar do bem-estar DE QUEM CUIDA (prevenir sobrecarga), não dar tarefas. Pergunte como a pessoa está, reconheça o esforço. ' +
  'Sem markdown, sem asteriscos, sem emojis em excesso, sem tom de coach.';

async function run({ test = false } = {}) {
  let blurb = '';
  try {
    const ctx = (await supabase.rpc('assistant_get_patient_context', { p_patient_id: PATIENT_ID })) || {};
    blurb = contextBlurb(ctx);
  } catch (e) {
    log.warn('caregiver.context_failed', { err: e.message });
  }

  let msg = `Oi, é o ${ASSISTANT_NAME} passando pra saber como você está essa semana. Sei que cuidar todos os dias é cansativo. Como tem se sentido? Estou aqui se precisar de qualquer coisa.`;
  try {
    const gen = await anthropic.complete({ model: HAIKU_MODEL, system: SYSTEM, prompt: `Paciente: ${PATIENT_NAME}.\nContexto recente:\n${blurb}\n\nEscreva a mensagem para ${CAREGIVER_NAME}.`, max_tokens: 400, temperature: 0.5 });
    if (gen) msg = stripBracketTags(gen);
  } catch (e) {
    log.warn('caregiver.gen_failed', { err: e.message });
  }

  const mention = '@' + CAREGIVER_JID.split('@')[0];
  await respond.sendText(test ? `🧪 (teste) ${mention} ${msg}` : `${mention} ${msg}`, GROUP_JID, { mentions: [CAREGIVER_JID] });
  return { ok: true };
}

module.exports = { run };
