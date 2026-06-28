'use strict';
/**
 * medication.js — Lembrete de medicação (data-driven a partir de config.MEDICATIONS).
 * Determina o que vence na hora atual (BRT); se nada, não envia. Loga em assistant_medication_logs.
 */

const { PATIENT_ID, GROUP_JID, MEDICATIONS } = require('../config');
const supabase = require('../clients/supabase');
const respond = require('../pipeline/respond');
const { brtParts, greeting } = require('../util');
const log = require('../logger');

async function run({ test = false } = {}) {
  const { hour, hhmm } = brtParts();
  const due = (MEDICATIONS || []).filter((m) => Array.isArray(m.hours) && m.hours.includes(hour));

  if (due.length === 0 && !test) {
    return { skipped: 'no_med_due', hour };
  }

  const sayList = due.length ? due.map((m) => m.say || m.name) : ['(teste) Nenhum remédio previsto para esta hora.'];
  const text = `${greeting(hour)}! ${due.length === 1 ? 'Hora do remédio: ' : 'Hora dos remédios: '}${sayList.join(' ')}`;
  await respond.sendText(test ? `🧪 (teste) ${text}` : text, GROUP_JID);

  if (!test) {
    try {
      await supabase.insert('assistant_medication_logs', {
        patient_id: PATIENT_ID,
        scheduled_time: new Date().toISOString(),
        status: 'pending',
        reported_by: 'auto',
        notes: `Lembrete enviado ${hhmm} BRT — ${due.length} medicação(ões)`,
      });
    } catch (e) {
      log.warn('medication.log_failed', { err: e.message });
    }
  }
  return { ok: true, hour, medCount: due.length };
}

module.exports = { run };
