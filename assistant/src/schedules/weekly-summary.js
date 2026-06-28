'use strict';
/**
 * weekly-summary.js — Resumo semanal (domingo 20h BRT). Estatísticas dos check-ins,
 * sintomas, alertas e aderência da semana. Enviado UMA vez ao grupo e salvo em
 * assistant_weekly_summaries.
 */

const { PATIENT_ID, GROUP_JID, PATIENT_NAME } = require('../config');
const supabase = require('../clients/supabase');
const respond = require('../pipeline/respond');
const { brtParts } = require('../util');
const log = require('../logger');

function trendFromCheckins(checkins) {
  const score = { good: 1, moderate: 0, bad: -1 };
  const vals = checkins.map((c) => score[c.motor_state] ?? 0);
  if (vals.length < 2) return 'stable';
  const firstHalf = vals.slice(0, Math.floor(vals.length / 2));
  const secondHalf = vals.slice(Math.floor(vals.length / 2));
  const avg = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const diff = avg(secondHalf) - avg(firstHalf);
  return diff > 0.3 ? 'improving' : diff < -0.3 ? 'declining' : 'stable';
}

async function run({ test = false } = {}) {
  const weekAgoIso = new Date(Date.now() - 7 * 86400000).toISOString();
  const { ymd } = brtParts();

  let checkins = [];
  let symptoms = [];
  let alerts = [];
  let adherence = {};
  try {
    checkins = (await supabase.rpc('assistant_get_weekly_checkins', { p_patient_id: PATIENT_ID })) || [];
    symptoms = await supabase.select('assistant_symptoms', `patient_id=eq.${PATIENT_ID}&symptom_date=gte.${encodeURIComponent(weekAgoIso)}&order=symptom_date.desc&select=symptom_type,severity`);
    alerts = await supabase.select('assistant_alerts', `patient_id=eq.${PATIENT_ID}&created_at=gte.${encodeURIComponent(weekAgoIso)}&select=title,severity`);
    adherence = (await supabase.rpc('assistant_get_medication_adherence', { p_patient_id: PATIENT_ID, p_days: 7 })) || {};
  } catch (e) {
    log.warn('weekly.read_failed', { err: e.message });
  }

  const goodDays = checkins.filter((c) => c.motor_state === 'good').length;
  const badDays = checkins.filter((c) => c.motor_state === 'bad').length;
  const motorTrend = trendFromCheckins(checkins);
  const trendPt = { improving: 'melhorando', stable: 'estável', declining: 'em queda' }[motorTrend];

  const symptomCounts = {};
  for (const s of symptoms || []) symptomCounts[s.symptom_type] = (symptomCounts[s.symptom_type] || 0) + 1;
  const topSymptoms = Object.entries(symptomCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => `${t} (${n}x)`);

  const lines = [
    `📋 Resumo da semana — ${PATIENT_NAME}`,
    '',
    `Check-ins registrados: ${checkins.length} (${goodDays} dias bons, ${badDays} dias difíceis).`,
    `Tendência motora: ${trendPt}.`,
    adherence.adherence_pct != null ? `Aderência à medicação: ${adherence.adherence_pct}%.` : null,
    topSymptoms.length ? `Sintomas mais relatados: ${topSymptoms.join(', ')}.` : 'Nenhum sintoma relevante relatado.',
    (alerts || []).length ? `Alertas na semana: ${alerts.length}.` : 'Sem alertas na semana.',
    '',
    'Qualquer dúvida, estou por aqui. Bom descanso. 💙',
  ].filter(Boolean);
  const text = lines.join('\n');

  await respond.sendText(test ? `🧪 (teste)\n${text}` : text, GROUP_JID);

  if (!test) {
    try {
      await supabase.insert(
        'assistant_weekly_summaries',
        {
          patient_id: PATIENT_ID,
          week_start: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
          week_end: ymd,
          summary_text: text,
          motor_trend: motorTrend,
          medication_adherence_pct: adherence.adherence_pct ?? null,
          checkin_count: checkins.length,
          alert_count: (alerts || []).length,
          good_days: goodDays,
          bad_days: badDays,
          sent_to: ['grupo'],
        },
        'return=minimal'
      );
    } catch (e) {
      log.warn('weekly.save_failed', { err: e.message });
    }
  }
  return { ok: true, checkins: checkins.length };
}

module.exports = { run };
