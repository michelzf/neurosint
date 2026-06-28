'use strict';
/**
 * normalize.js — converte o payload bruto da Evolution (messages.upsert) num objeto
 * normalizado. Porta a lógica do node "Normalize Message" do workflow original.
 */

const { PATIENT_ID } = require('../config');

const NUMBER_TO_BUTTON = {
  1: { id: 'checkin_bem', text: 'Bem' },
  2: { id: 'checkin_maisOuMenos', text: 'Mais ou menos' },
  3: { id: 'checkin_mal', text: 'Mal' },
};

function normalize(input) {
  // o payload pode chegar como {body:{data}}, {body:{body:{data}}} ou {data}
  const root = input || {};
  const data = root.data || root.body?.data || root.body?.body?.data || {};
  const key = data.key || {};
  const msg = data.message || {};

  if (key.fromMe === true) return { skip: true, reason: 'own_message' };
  if (!data.key && !data.message) return { skip: true, reason: 'no_data_found' };

  let messageType = 'text';
  let content = '';
  let buttonId = null;
  let mediaKey = null;
  let reactionEmoji = null;
  let reactionTargetId = null;

  if (msg.conversation) {
    content = msg.conversation;
  } else if (msg.extendedTextMessage?.text) {
    content = msg.extendedTextMessage.text;
  } else if (msg.audioMessage) {
    messageType = 'audio';
    mediaKey = key;
  } else if (msg.imageMessage) {
    messageType = 'image';
    content = msg.imageMessage.caption || '';
    mediaKey = key;
  } else if (msg.videoMessage) {
    messageType = 'video';
    content = msg.videoMessage.caption || '';
    mediaKey = key;
  } else if (msg.documentMessage) {
    messageType = 'document';
    content = msg.documentMessage.fileName || '';
    mediaKey = key;
  } else if (msg.reactionMessage) {
    // reação (emoji) a uma mensagem anterior. text vazio = reação removida.
    messageType = 'reaction';
    reactionEmoji = msg.reactionMessage.text || '';
    reactionTargetId = msg.reactionMessage.key?.id || null;
    content = reactionEmoji ? `Reagiu com ${reactionEmoji}` : '';
  } else if (msg.buttonsResponseMessage) {
    messageType = 'button_response';
    buttonId = msg.buttonsResponseMessage.selectedButtonId || '';
    content = msg.buttonsResponseMessage.selectedDisplayText || '';
  } else if (msg.templateButtonReplyMessage) {
    messageType = 'button_response';
    buttonId = msg.templateButtonReplyMessage.selectedId || '';
    content = msg.templateButtonReplyMessage.selectedDisplayText || '';
  } else if (msg.interactiveResponseMessage) {
    // Evolution v2 nativeFlow
    messageType = 'button_response';
    try {
      const params = JSON.parse(msg.interactiveResponseMessage.nativeFlowResponseMessage?.paramsJson || '{}');
      buttonId = params.id || '';
    } catch {
      buttonId = '';
    }
  } else if (msg.listResponseMessage) {
    messageType = 'list_response';
    buttonId = msg.listResponseMessage.singleSelectReply?.selectedRowId || '';
    content = msg.listResponseMessage.title || '';
  }

  // atalho: "1"/"2"/"3" como texto → resposta de check-in
  const trimmed = (content || '').trim();
  if (messageType === 'text' && NUMBER_TO_BUTTON[trimmed]) {
    messageType = 'button_response';
    buttonId = NUMBER_TO_BUTTON[trimmed].id;
    content = NUMBER_TO_BUTTON[trimmed].text;
  }

  const senderJid = key.remoteJid || '';
  return {
    skip: false,
    messageId: key.id || '',
    messageType,
    content,
    buttonId,
    mediaKey,
    reactionEmoji,
    reactionTargetId,
    senderJid,
    senderName: data.pushName || 'Desconhecido',
    participant: key.participant || senderJid,
    isGroup: senderJid.includes('@g.us'),
    instance: root.instance || root.body?.instance || '',
    timestamp: Number(data.messageTimestamp) || Math.floor(Date.now() / 1000),
    rawMessage: msg,
    patientId: PATIENT_ID,
  };
}

module.exports = { normalize };
