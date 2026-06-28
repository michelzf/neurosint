'use strict';
/** _shared.js — helpers comuns aos schedules (resumo compacto do contexto p/ prompts haiku). */

/** Monta um blurb curto a partir do retorno de assistant_get_patient_context. */
function contextBlurb(ctx = {}) {
  const parts = [];
  const checkins = (ctx.recent_checkins || []).slice(0, 3);
  if (checkins.length) parts.push('Check-ins recentes: ' + checkins.map((c) => `${c.checkin_date} ${c.motor_state || '?'}/humor ${c.mood_score || '?'}`).join('; '));
  const symptoms = (ctx.recent_symptoms || []).slice(0, 4);
  if (symptoms.length) parts.push('Sintomas recentes: ' + symptoms.map((s) => `${s.symptom_type}(${s.severity || '?'})`).join(', '));
  const alerts = (ctx.recent_alerts || []).slice(0, 2);
  if (alerts.length) parts.push('Alertas ativos: ' + alerts.map((a) => a.title).join('; '));
  const meds = (ctx.medications || []).filter((m) => m.is_taking !== false).slice(0, 6);
  if (meds.length) parts.push('Medicações: ' + meds.map((m) => m.name).join(', '));
  return parts.join('\n') || '(sem dados recentes relevantes)';
}

module.exports = { contextBlurb };
