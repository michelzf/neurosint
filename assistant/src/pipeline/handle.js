'use strict';
/**
 * handle.js — orquestra o fluxo de mensagem recebida:
 *   normalize → dedup → (botão) | (mídia → contexto → conselho → tags → persist → fala)
 */

const { ALERT_NUMBER, GROUP_JID, ASSISTANT_NAME, MANAGER_NAME } = require('../config');
const { normalize } = require('./normalize');
const dedup = require('./dedup');
const { handleButton } = require('./button');
const { resolveMedia } = require('./media');
const { buildContext } = require('./context');
const council = require('./council');
const tags = require('./tags');
const persist = require('./persist');
const respond = require('./respond');
const evolution = require('../clients/evolution');
const log = require('../logger');

const FALLBACK_REPLY = `Recebi sua mensagem. Vou acompanhar e, se precisar, aviso ${MANAGER_NAME}.`;

async function handleIncoming(rawPayload) {
  const norm = normalize(rawPayload);
  if (norm.skip) return { skipped: norm.reason };

  // defesa: só processa o grupo configurado (ou DMs diretas em teste); ignora outros grupos
  if (norm.isGroup && norm.senderJid !== GROUP_JID) {
    return { skipped: 'wrong_group', jid: norm.senderJid };
  }

  // reação removida (emoji vazio) → nada a registrar
  if (norm.messageType === 'reaction' && !norm.reactionEmoji) {
    return { skipped: 'reaction_removed' };
  }

  const isNew = await dedup.isNewMessage(norm);
  if (!isNew) return { duplicate: true };

  log.info('handle.start', { type: norm.messageType, sender: norm.senderName, msgId: norm.messageId });

  // reação (emoji): o dedup insert já a gravou no histórico, então serve de contexto para o
  // conselho na próxima mensagem. Não geramos resposta em áudio — evitar uma nota de voz a
  // cada emoji no grupo de cuidados. (Para responder a reações, remover este short-circuit.)
  if (norm.messageType === 'reaction') {
    log.info('handle.reaction', { emoji: norm.reactionEmoji, target: norm.reactionTargetId, sender: norm.senderName });
    return { ok: true, reaction: norm.reactionEmoji };
  }

  if (norm.messageType === 'button_response') {
    return handleButton(norm);
  }

  // 1) Mídia → texto
  const media = await resolveMedia(norm);
  const current = {
    content: media.content,
    messageType: norm.messageType,
    originalType: media.originalType,
    buttonId: norm.buttonId,
    senderName: norm.senderName,
  };

  // 2) Contexto
  const { context } = await buildContext(current);

  // 3) Conselho
  let reply = '';
  try {
    reply = await council.ask(context);
  } catch (e) {
    log.error('handle.council_failed', { err: e.message });
  }
  if (!reply) reply = FALLBACK_REPLY;

  // 4) Tags + fallbacks + red-flag
  const parsed = tags.parseTags(reply);
  const clean = tags.strip(reply) || FALLBACK_REPLY;
  if (parsed.symptoms.length === 0) {
    const kw = tags.keywordSymptom(media.content);
    if (kw) parsed.symptoms.push(kw);
  }
  if (!parsed.medicationConfirm) {
    const conf = tags.detectConfirmation(media.content);
    if (conf) parsed.medicationConfirm = conf;
  }
  const redflag = tags.detectRedFlag(media.content);

  // 5) Persistência (best-effort, não bloqueia a resposta)
  await persist.saveOutgoing(norm, clean);
  await persist.saveExtracted(parsed, media.content);
  await persist.saveMedicalRecord(media, clean);

  if (redflag.shouldAlert && redflag.severity !== 'info') {
    const alertText = `🚨 ALERTA ${ASSISTANT_NAME.toUpperCase()} [${redflag.severity.toUpperCase()}]\nMotivo: ${redflag.reason}\nMensagem: ${media.content?.slice(0, 300)}\nReportado por: ${norm.senderName}`;
    await persist.saveAlert(redflag.severity, redflag.reason, alertText);
    try {
      await evolution.sendText(ALERT_NUMBER, alertText);
    } catch (e) {
      log.error('handle.alert_send_failed', { err: e.message });
    }
  }

  // 6) Resposta em áudio ao grupo
  await respond.speak(clean);

  // 7) Resumo incremental (best-effort)
  await persist.maybeSummarize();

  log.info('handle.done', { msgId: norm.messageId, alerted: redflag.shouldAlert });
  return { ok: true, alerted: redflag.shouldAlert };
}

module.exports = { handleIncoming };
