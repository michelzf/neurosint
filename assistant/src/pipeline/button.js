'use strict';
/**
 * button.js — respostas de check-in (botões "Bem/Mais ou menos/Mal/Preciso de ajuda").
 * Resposta vai como TEXTO ao grupo (não áudio).
 */

const { GROUP_JID, ALERT_NUMBER, ASSISTANT_NAME, PATIENT_NAME, CAREGIVER_NAME, MANAGER_NAME } = require('../config');
const evolution = require('../clients/evolution');
const persist = require('./persist');
const log = require('../logger');

const MAP = {
  checkin_bem: { motorState: 'good', mood: 4, reply: 'Que bom saber que está bem! Continue assim. Qualquer coisa, estou por aqui.' },
  good: { motorState: 'good', mood: 4, reply: 'Que bom saber que está bem! Continue assim.' },
  checkin_maisOuMenos: { motorState: 'moderate', mood: 3, reply: 'Entendi, mais ou menos. Vamos de olho. Se piorar, me avise.' },
  moderate: { motorState: 'moderate', mood: 3, reply: 'Entendi, mais ou menos. Vamos de olho.' },
  checkin_mal: { motorState: 'bad', mood: 2, shouldAlert: true, severity: 'warning', reply: `Sinto muito que não esteja bem. Vou registrar e ficar atento. Se precisar, chame ${CAREGIVER_NAME}.` },
  bad: { motorState: 'bad', mood: 2, shouldAlert: true, severity: 'warning', reply: 'Sinto muito que não esteja bem. Vou registrar e ficar atento.' },
  checkin_ajuda: { motorState: 'bad', mood: 1, shouldAlert: true, severity: 'urgent', reply: `Entendi que precisa de ajuda. Vou avisar ${MANAGER_NAME} agora mesmo.` },
  help: { motorState: 'bad', mood: 1, shouldAlert: true, severity: 'urgent', reply: `Entendi que precisa de ajuda. Vou avisar ${MANAGER_NAME} agora.` },
};

async function handleButton(norm) {
  const def = MAP[norm.buttonId] || { motorState: 'moderate', mood: 3, reply: 'Anotado, obrigado por responder.' };

  await persist.saveCheckin({ motorState: def.motorState, moodScore: def.mood });
  await persist.saveOutgoing(norm, def.reply);

  try {
    await evolution.sendText(GROUP_JID, def.reply);
  } catch (e) {
    log.error('button.send_failed', { err: e.message });
  }

  if (def.shouldAlert) {
    const alertText = `🚨 ALERTA ${ASSISTANT_NAME.toUpperCase()} [${def.severity.toUpperCase()}]\n${PATIENT_NAME} respondeu o check-in.\nEstado motor: ${def.motorState}\nHumor: ${def.mood}/5`;
    await persist.saveAlert(def.severity, `Check-in: ${def.motorState}`, alertText);
    try {
      await evolution.sendText(ALERT_NUMBER, alertText);
    } catch (e) {
      log.error('button.alert_failed', { err: e.message });
    }
  }
  return { ok: true, kind: 'button', buttonId: norm.buttonId };
}

module.exports = { handleButton };
