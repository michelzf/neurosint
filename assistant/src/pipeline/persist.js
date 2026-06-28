'use strict';
/**
 * persist.js — gravações no Supabase: mensagem de saída, dados clínicos extraídos,
 * registros médicos, alertas e resumo incremental da conversa.
 */

const { PATIENT_ID, HAIKU_MODEL, SUMMARY_EVERY_N_MSGS, SUMMARY_STALE_HOURS, ASSISTANT_NAME, PATIENT_NAME, MANAGER_NAME } = require('../config');
const supabase = require('../clients/supabase');
const anthropic = require('../clients/anthropic');
const { brtParts, fmtBRTStamp } = require('../util');
const log = require('../logger');

/** Persiste a resposta do assistente (linha outgoing, id distinto do incoming). */
async function saveOutgoing(norm, responseText) {
  try {
    await supabase.insert(
      'assistant_message_history',
      {
        patient_id: PATIENT_ID,
        message_id: `${norm.messageId || 'resp'}_resp`,
        sender_name: ASSISTANT_NAME,
        sender_jid: 'assistant',
        direction: 'outgoing',
        message_type: 'text',
        content: responseText,
      },
      'resolution=ignore-duplicates'
    );
  } catch (e) {
    log.warn('persist.outgoing_failed', { err: e.message });
  }
}

function checkinPeriod(hour) {
  if (hour >= 8 && hour < 13) return 'morning';
  if (hour >= 13 && hour < 19) return 'afternoon';
  return 'evening';
}

/** Grava dados clínicos extraídos das tags + fallbacks. */
async function saveExtracted({ symptoms = [], keyFacts = [], medicationChanges = [], medicationConfirm = null }, msgContent) {
  for (const s of symptoms) {
    try {
      await supabase.insert('assistant_symptoms', {
        patient_id: PATIENT_ID,
        symptom_type: s.type,
        severity: s.severity || 'leve',
        context: msgContent?.slice(0, 500) || null,
        on_off_state: s.on_off_state || 'desconhecido',
        reported_by: 'caregiver',
      });
    } catch (e) {
      log.warn('persist.symptom_failed', { err: e.message });
    }
  }
  for (const f of keyFacts) {
    try {
      await supabase.insert('assistant_key_facts', { patient_id: PATIENT_ID, category: f.category, fact_key: f.fact_key, fact_value: f.fact_value, source: f.source || 'relato_paciente' }, 'resolution=merge-duplicates');
    } catch (e) {
      log.warn('persist.keyfact_failed', { err: e.message });
    }
  }
  for (const c of medicationChanges) {
    try {
      const times = (c.novo_horario || '').match(/\d{1,2}/g)?.map((h) => `${h.padStart(2, '0')}:00`) || null;
      await supabase.rpc('assistant_update_medication', {
        p_patient_id: PATIENT_ID,
        p_name: c.medicacao,
        p_action: 'atualizar',
        p_dose: c.nova_dose || null,
        p_frequency: null,
        p_schedule_times: times,
        p_notes: `Alterado via WhatsApp ${fmtBRTStamp(new Date())}`,
      });
    } catch (e) {
      log.warn('persist.medchange_failed', { err: e.message });
    }
  }
  if (medicationConfirm) {
    try {
      await supabase.rpc('assistant_confirm_medication', {
        p_patient_id: PATIENT_ID,
        p_med_name: medicationConfirm.med_name,
        p_reported_by: 'caregiver',
        p_notes: null,
      });
    } catch (e) {
      log.warn('persist.medconfirm_failed', { err: e.message });
    }
  }
}

/** Grava um registro médico extraído de um PDF. */
async function saveMedicalRecord(mediaInfo, summaryText) {
  if (!mediaInfo || mediaInfo.originalType !== 'document') return;
  const fname = mediaInfo.fileName || 'documento';
  const raw = mediaInfo.rawText || '';
  let record_type = 'documento';
  if (/exame|laborat|hemograma|resultado/i.test(raw + fname)) record_type = 'exame';
  else if (/receita|prescri/i.test(raw + fname)) record_type = 'prescricao';
  else if (/consulta|laudo/i.test(raw + fname)) record_type = 'consulta';
  const dateMatch = (raw + fname).match(/(\d{2})[/.-](\d{2})[/.-](\d{4})/);
  const record_date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;
  try {
    await supabase.insert('assistant_medical_records', {
      patient_id: PATIENT_ID,
      record_date,
      record_type,
      title: fname.slice(0, 200),
      summary: (summaryText || raw).slice(0, 2000),
      raw_text: raw.slice(0, 50000),
      file_type: 'pdf',
    });
  } catch (e) {
    log.warn('persist.record_failed', { err: e.message });
  }
}

/** Insere alerta no banco (o envio WhatsApp é feito por quem chama). */
async function saveAlert(severity, reason, description) {
  try {
    await supabase.insert('assistant_alerts', {
      patient_id: PATIENT_ID,
      alert_type: 'red_flag',
      severity,
      title: reason,
      description,
      notified_caregivers: [MANAGER_NAME],
    });
  } catch (e) {
    log.warn('persist.alert_failed', { err: e.message });
  }
}

/** Salva check-in (vindo de botão). */
async function saveCheckin({ motorState, moodScore }) {
  const { ymd, hour } = brtParts();
  try {
    await supabase.insert('assistant_daily_checkins', {
      patient_id: PATIENT_ID,
      checkin_date: ymd,
      checkin_time: checkinPeriod(hour),
      motor_state: motorState,
      mood_score: moodScore,
      reported_by: 'patient',
    });
  } catch (e) {
    log.warn('persist.checkin_failed', { err: e.message });
  }
}

/**
 * Resumo incremental: se há >= N mensagens novas desde o último resumo (ou nenhum
 * resumo e há histórico), gera via haiku e salva. Best-effort, Supabase-only.
 */
async function maybeSummarize() {
  try {
    const latest = await supabase.rpc('assistant_get_latest_summary', { p_patient_id: PATIENT_ID });
    const since = latest?.period_end || new Date(Date.now() - SUMMARY_STALE_HOURS * 3600000).toISOString();
    const newMsgs = await supabase.select(
      'assistant_message_history',
      `patient_id=eq.${PATIENT_ID}&created_at=gt.${encodeURIComponent(since)}&select=sender_name,direction,content,created_at&order=created_at.asc&limit=200`
    );
    if (!Array.isArray(newMsgs) || newMsgs.length < SUMMARY_EVERY_N_MSGS) return;

    const lines = newMsgs.map((m) => `${fmtBRTStamp(m.created_at)} ${m.direction === 'incoming' ? m.sender_name || 'Família' : ASSISTANT_NAME}: ${m.content}`).join('\n');
    const prompt = `Resumo anterior:\n${latest?.summary_text || '(nenhum)'}\n\nNovas mensagens:\n${lines}\n\nProduza um resumo clínico ATUALIZADO e conciso (até 400 palavras) da situação do paciente (${PATIENT_NAME}). Converta datas relativas (hoje/ontem) em datas reais. Mantenha: sintomas, mudanças de medicação, estados ON/OFF, decisões e perguntas pendentes. Responda só com o resumo, sem preâmbulo.`;
    const summaryText = await anthropic.complete({ model: HAIKU_MODEL, prompt, max_tokens: 800, temperature: 0.2 });
    if (!summaryText) return;

    await supabase.insert(
      'assistant_conversation_summaries',
      {
        patient_id: PATIENT_ID,
        summary_text: summaryText,
        period_start: newMsgs[0].created_at,
        period_end: newMsgs[newMsgs.length - 1].created_at,
        message_count: newMsgs.length,
        source: 'auto',
      },
      'return=minimal'
    );
    log.info('persist.summary_saved', { msgs: newMsgs.length });
  } catch (e) {
    log.warn('persist.summary_failed', { err: e.message });
  }
}

module.exports = { saveOutgoing, saveExtracted, saveMedicalRecord, saveAlert, saveCheckin, maybeSummarize };
