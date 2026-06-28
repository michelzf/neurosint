'use strict';
/**
 * checkin.js — Check-in diário (3x/dia: 10h/16h/21h BRT).
 * Manda uma pergunta de bem-estar ao grupo, com opções numeradas (o usuário responde
 * 1/2/3 e o webhook trata como botão). Não reenvia se o período de hoje já foi respondido.
 */

const { PATIENT_ID, GROUP_JID } = require('../config');
const supabase = require('../clients/supabase');
const respond = require('../pipeline/respond');
const { brtParts } = require('../util');
const log = require('../logger');

function periodOf(hour) {
  if (hour >= 8 && hour < 13) return { period: 'morning', greeting: 'Bom dia!', question: 'Como você está se sentindo hoje?', opts: ['Bem', 'Mais ou menos', 'Mal'] };
  if (hour >= 13 && hour < 19) return { period: 'afternoon', greeting: 'Boa tarde!', question: 'Como está o movimento agora?', opts: ['Bem', 'Mais ou menos', 'Mal'] };
  return { period: 'evening', greeting: 'Boa noite!', question: 'Como foi o dia?', opts: ['Dia bom', 'Dia difícil', 'Preciso de ajuda'] };
}

async function run({ test = false } = {}) {
  const { hour, ymd } = brtParts();
  const p = periodOf(hour);

  if (!test) {
    const existing = await supabase.select('assistant_daily_checkins', `patient_id=eq.${PATIENT_ID}&checkin_date=eq.${ymd}&checkin_time=eq.${p.period}&select=id&limit=1`);
    if (Array.isArray(existing) && existing.length) {
      log.info('checkin.skip_already_answered', { period: p.period });
      return { skipped: 'already_answered', period: p.period };
    }
  }

  const text = `${p.greeting} ${p.question}\n\n1 - ${p.opts[0]}\n2 - ${p.opts[1]}\n3 - ${p.opts[2]}\n\n(responda com o número)`;
  await respond.sendText(test ? `🧪 (teste) ${text}` : text, GROUP_JID);
  return { ok: true, period: p.period };
}

module.exports = { run };
