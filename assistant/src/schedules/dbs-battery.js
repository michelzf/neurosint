'use strict';
/**
 * dbs-battery.js — Lembrete de recarga da bateria do DBS, para o cuidador (a cada 2 dias, 9h BRT).
 * Cloud Scheduler dispara diariamente; usamos a paridade do dia (epochDay % 2) p/ "a cada 2 dias".
 * (Só faz sentido se o IPG do paciente for recarregável.)
 */

const { GROUP_JID, CAREGIVER_JID, ASSISTANT_NAME, PATIENT_NAME } = require('../config');
const respond = require('../pipeline/respond');
const { greeting, brtParts } = require('../util');

async function run({ test = false } = {}) {
  const epochDay = Math.floor(Date.now() / 86400000);
  if (!test && epochDay % 2 !== 0) {
    return { skipped: 'not_battery_day' };
  }

  const { hour } = brtParts();
  const mention = '@' + CAREGIVER_JID.split('@')[0];
  const text =
    `${greeting(hour)}, ${mention} 💙\n\n` +
    `É o ${ASSISTANT_NAME} passando rapidinho — hoje é dia de recarregar a bateria do DBS de ${PATIENT_NAME}.\n\n` +
    'Se puder, posicione o carregador indutivo sobre o gerador (perto da clavícula) e deixe a recarga rodar pelo tempo recomendado. Pode ser enquanto a pessoa assiste TV, toma café ou descansa.\n\n' +
    'Quando terminar, me avisa aqui no grupo que eu anoto. Muito obrigado pelo cuidado de sempre. 🙏';

  await respond.sendText(test ? `🧪 (teste)\n${text}` : text, GROUP_JID, { mentions: [CAREGIVER_JID] });
  return { ok: true };
}

module.exports = { run };
