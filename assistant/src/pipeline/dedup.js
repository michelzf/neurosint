'use strict';
/**
 * dedup.js — 3 camadas (idade, memória do processo, UNIQUE no banco).
 * Insere a mensagem recebida em assistant_message_history; se o INSERT não retornar
 * linha (constraint UNIQUE em message_id), é duplicata → ignora.
 */

const { PATIENT_ID, DEDUP_MAX_AGE_SEC } = require('../config');
const supabase = require('../clients/supabase');
const log = require('../logger');

const seen = new Map(); // messageId -> ts (ms) — guard in-process, GC > 600s

function gc() {
  const cutoff = Date.now() - 600000;
  for (const [id, ts] of seen) if (ts < cutoff) seen.delete(id);
}

/**
 * @returns {Promise<boolean>} true se é mensagem nova (deve processar), false se dup/velha.
 */
async function isNewMessage(norm) {
  const ageSec = Math.floor(Date.now() / 1000) - (norm.timestamp || 0);
  if (ageSec > DEDUP_MAX_AGE_SEC) {
    log.info('dedup.skip_old', { messageId: norm.messageId, ageSec });
    return false;
  }
  if (norm.messageId && seen.has(norm.messageId)) return false;
  if (norm.messageId) {
    seen.set(norm.messageId, Date.now());
    gc();
  }

  try {
    const rows = await supabase.insert(
      'assistant_message_history',
      {
        message_id: norm.messageId,
        patient_id: PATIENT_ID,
        sender_name: norm.senderName,
        sender_jid: norm.participant || norm.senderJid,
        direction: 'incoming',
        message_type: norm.messageType,
        content: norm.content,
        button_id: norm.buttonId,
      },
      'return=representation,resolution=ignore-duplicates'
    );
    // duplicata → array vazio
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    // em erro de insert, processa mesmo assim (melhor duplicar resposta que silenciar)
    log.warn('dedup.insert_error_proceeding', { err: e.message });
    return true;
  }
}

module.exports = { isNewMessage };
