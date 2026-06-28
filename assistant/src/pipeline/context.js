'use strict';
/**
 * context.js — monta a string de contexto (turno "user") que vai ao conselho.
 * Lê do Supabase (fonte da verdade): patient_context, latest_summary, recent_messages.
 * Porta a lógica do node "Build Context" (memory Supabase-first, FIX 2026-06-09).
 */

const { PATIENT_ID, PRIMARY_MED_HOURS, PRIMARY_MED_NAME, ASSISTANT_NAME, RECENT_MESSAGES_LIMIT } = require('../config');
const supabase = require('../clients/supabase');
const { brtParts, fmtBRTStamp } = require('../util');
const log = require('../logger');

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.data)) return v.data;
  return [];
}

function primaryMedInfo() {
  const med = PRIMARY_MED_NAME || 'medicação';
  const hours = PRIMARY_MED_HOURS || [];
  if (!hours.length) return '';
  const { hour, minute } = brtParts();
  const nowMin = hour * 60 + minute;
  const doses = hours.map((h) => h * 60);
  const next = doses.find((d) => d > nowMin);
  const last = [...doses].reverse().find((d) => d <= nowMin);
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  if (next != null) {
    const mins = next - nowMin;
    return `Próxima dose de ${med} às ${fmt(next)} (em ${mins} minutos). Última prevista: ${last != null ? fmt(last) : '—'}.`;
  }
  return `Doses de ${med} de hoje concluídas (última às ${fmt(doses[doses.length - 1])}). Próxima amanhã às ${fmt(doses[0])}.`;
}

async function buildContext(current) {
  // current: { content, messageType, buttonId, senderName, originalType }
  let summary = null;
  let ctx = {};
  let recent = [];

  try {
    summary = await supabase.rpc('assistant_get_latest_summary', { p_patient_id: PATIENT_ID });
  } catch (e) {
    log.warn('context.summary_failed', { err: e.message });
  }
  try {
    ctx = (await supabase.rpc('assistant_get_patient_context', { p_patient_id: PATIENT_ID })) || {};
  } catch (e) {
    log.warn('context.patient_failed', { err: e.message });
  }
  try {
    recent = asArray(await supabase.rpc('assistant_get_recent_messages', { p_patient_id: PATIENT_ID, p_limit: RECENT_MESSAGES_LIMIT }));
  } catch (e) {
    log.warn('context.recent_failed', { err: e.message });
  }

  const now = brtParts();
  const blocks = [];

  blocks.push(`== AGORA ==\nData e hora (Brasília): ${now.ymd} ${now.hhmm}.\n${primaryMedInfo()}`);

  if (summary?.summary_text) {
    blocks.push(`== RESUMO DAS CONVERSAS ANTERIORES ==\n${summary.summary_text}`);
  }

  const p = ctx.patient || {};
  if (p.name) {
    blocks.push(`== PACIENTE ==\nNome: ${p.name}${p.age ? `, ${p.age} anos` : ''}.\nDiagnóstico: ${p.diagnosis || 'Parkinson'}.`);
  }

  const meds = (ctx.medications || []).filter((m) => m.is_taking !== false);
  if (meds.length) {
    blocks.push(
      '== MEDICAÇÕES ATIVAS ==\n' +
        meds.map((m) => `- ${m.name}${m.dose ? ` ${m.dose}` : ''}${m.frequency ? ` (${m.frequency})` : ''}${m.schedule_times?.length ? ` às ${m.schedule_times.join(', ')}` : ''}${m.notes ? ` — ${m.notes}` : ''}`).join('\n')
    );
  }

  const records = ctx.recent_records || [];
  if (records.length) {
    blocks.push('== EXAMES E REGISTROS MÉDICOS ==\n' + records.map((r) => `- ${r.record_date || ''} ${r.record_type || ''}: ${r.title || ''}${r.summary ? ` — ${r.summary}` : ''}`).join('\n'));
  }

  const checkins = (ctx.recent_checkins || []).slice(0, 7);
  if (checkins.length) {
    blocks.push('== CHECK-INS RECENTES ==\n' + checkins.map((c) => `- ${c.checkin_date} ${c.checkin_time}: motor ${c.motor_state || '?'}, humor ${c.mood_score || '?'}/5${c.extra_notes ? ` (${c.extra_notes})` : ''}`).join('\n'));
  }

  const symptoms = (ctx.recent_symptoms || []).slice(0, 10);
  if (symptoms.length) {
    blocks.push('== SINTOMAS RECENTES ==\n' + symptoms.map((s) => `- ${fmtBRTStamp(s.symptom_date)} ${s.symptom_type} (${s.severity || '?'})${s.context ? ` — ${s.context}` : ''}`).join('\n'));
  }

  const facts = ctx.key_facts || [];
  if (facts.length) {
    blocks.push('== FATOS-CHAVE ==\n' + facts.map((f) => `- [${f.category}] ${f.fact_key}: ${f.fact_value}`).join('\n'));
  }

  const alerts = ctx.recent_alerts || [];
  if (alerts.length) {
    blocks.push('== ALERTAS ATIVOS ==\n' + alerts.map((a) => `- (${a.severity}) ${a.title}${a.description ? `: ${a.description}` : ''}`).join('\n'));
  }

  // histórico recente em ordem cronológica, removendo 1 incoming inicial == mensagem atual (já inserido no dedup)
  let history = recent.slice().reverse();
  const idx = history.findIndex((m) => m.direction === 'incoming' && (m.content || '').trim() === (current.content || '').trim());
  if (idx >= 0) history.splice(idx, 1);
  if (history.length) {
    blocks.push(
      `== HISTÓRICO RECENTE DA CONVERSA (${history.length}) ==\n` +
        history.map((m) => `${fmtBRTStamp(m.created_at)} ${m.direction === 'incoming' ? m.sender_name || 'Família' : ASSISTANT_NAME}: ${m.content}`).join('\n')
    );
  }

  blocks.push(`== REMETENTE ATUAL ==\n${current.senderName || 'Família'}`);
  blocks.push(`== MENSAGEM ATUAL ==\nTipo: ${current.originalType || current.messageType || 'text'}\nConteúdo: ${current.content}`);

  return { context: blocks.join('\n\n'), historyCount: history.length };
}

module.exports = { buildContext };
