'use strict';
/**
 * dbs-program.js — Lembrete de troca de programa do DBS (data-driven, 9h BRT diário).
 * Só envia se HOJE estiver em config.DBS_PROGRAM_SCHEDULE. Corrige o bug original de datas
 * fixas vencidas — basta atualizar o schedule no config quando o médico definir novo ciclo.
 */

const { GROUP_JID, CAREGIVER_JID, DBS_PROGRAM_SCHEDULE, ASSISTANT_NAME, PATIENT_NAME } = require('../config');
const respond = require('../pipeline/respond');
const { greeting, brtParts } = require('../util');

const TAIL =
  '\n\nLembrando: não precisa mexer na amperagem, é só trocar o programa no controle. É normal ' +
  'piorar um pouquinho logo depois da troca e ir melhorando com os dias. Vá anotando como a pessoa fica ' +
  '(andar, fala, tremor, sono, confusão) — isso ajuda o médico a escolher o melhor programa depois. ' +
  'Qualquer dúvida me chama. Obrigado pelo cuidado de sempre. 🙏';

async function run({ test = false } = {}) {
  const { ymd, hour } = brtParts();
  const mention = '@' + CAREGIVER_JID.split('@')[0];
  const entry = DBS_PROGRAM_SCHEDULE[ymd];

  if (!entry && !test) {
    return { skipped: 'no_switch_today', ymd };
  }

  if (!entry) {
    const upcoming = Object.keys(DBS_PROGRAM_SCHEDULE).sort().join(', ') || '(nenhuma agendada)';
    await respond.sendText(`🧪 (teste) Lembrete de troca de programa do DBS ativo. Próximas trocas: ${upcoming}.`, GROUP_JID);
    return { ok: true, test: true };
  }

  const head = `${greeting(hour)}, ${mention} 💙\n\n`;
  const body = entry.text || `É o ${ASSISTANT_NAME} — hoje é dia de mudar para o *Programa ${entry.program}* do DBS de ${PATIENT_NAME}, conforme o plano do médico.`;
  const text = head + body + (entry.kind === 'switch' ? TAIL : '');
  await respond.sendText(test ? `🧪 (teste)\n${text}` : text, GROUP_JID, { mentions: [CAREGIVER_JID] });
  return { ok: true, ymd, program: entry.program };
}

module.exports = { run };
