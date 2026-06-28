'use strict';
/**
 * tags.js — parsing das tags que o conselho emite ([REGISTRO]/[MUDANCA]/[MEDICACAO]),
 * detecção determinística de red-flags na mensagem recebida, e fallbacks por palavra-chave.
 * Porta a lógica do node "Process Response" + "Extract Data to Save".
 */

const { stripBracketTags } = require('../util');
const { MEDICATIONS } = require('../config');

/** Extrai os campos `chave=valor` de dentro de uma tag. */
function parseKV(inner) {
  const out = {};
  for (const part of inner.split(',')) {
    const m = part.split('=');
    if (m.length >= 2) out[m[0].trim().toLowerCase()] = m.slice(1).join('=').trim();
  }
  return out;
}

/** Lê todas as tags do texto de resposta do conselho. */
function parseTags(replyText) {
  const text = replyText || '';
  const symptoms = [];
  const medicationChanges = [];
  const keyFacts = [];
  let medicationConfirm = null;

  for (const m of text.matchAll(/\[REGISTRO:([^\]]*)\]/gi)) {
    const kv = parseKV(m[1]);
    if (kv.tipo) symptoms.push({ type: kv.tipo, severity: kv.severidade || 'leve', on_off_state: 'desconhecido' });
  }
  for (const m of text.matchAll(/\[MUDANCA:([^\]]*)\]/gi)) {
    const kv = parseKV(m[1]);
    if (kv.medicacao) {
      medicationChanges.push({ medicacao: kv.medicacao, nova_dose: kv.nova_dose || null, novo_horario: kv.novo_horario || null });
      keyFacts.push({ category: 'medicacao', fact_key: `mudanca_${kv.medicacao}`.toLowerCase(), fact_value: m[1].trim(), source: 'relato_paciente' });
    }
  }
  for (const m of text.matchAll(/\[MEDICACAO:([^\]]*)\]/gi)) {
    const kv = parseKV(m[1]);
    if (kv.nome) medicationConfirm = { med_name: kv.nome, horario: kv.horario || null, status: kv.status || 'tomado' };
  }
  return { symptoms, medicationChanges, keyFacts, medicationConfirm };
}

/** Remove todas as tags para que não cheguem ao TTS. */
function strip(replyText) {
  return stripBracketTags(replyText);
}

// fallback por palavra-chave: 1 sintoma por mensagem
const SYMPTOM_MAP = [
  [/\bsonolen|\bsono\b|dormindo demais/i, 'sonolencia'],
  [/tremor|tremen/i, 'tremor'],
  [/freezing|congel|travou|travad/i, 'freezing'],
  [/rigidez|rigido|duro/i, 'rigidez'],
  [/caiu|queda|tombo/i, 'queda'],
  [/ansie|nervos|agitad/i, 'ansiedade'],
  [/confus|desorienta/i, 'confusao'],
  [/alucin|viu coisas/i, 'alucinacao'],
  [/engol|engasg|disfagia/i, 'disfagia'],
  [/\bdor\b|dolorid/i, 'dor'],
  [/discinesia|movimento involunt/i, 'discinesia'],
  [/saliva|babando|sialorr/i, 'sialorreia'],
  [/triste|deprim|apati|desanim/i, 'humor_baixo'],
  [/bem|otim|melhor|feliz|tranquil/i, 'estado_positivo'],
];

function keywordSymptom(content) {
  const c = (content || '').toLowerCase();
  for (const [re, type] of SYMPTOM_MAP) {
    if (re.test(c)) {
      const severity = /sever|muito|forte|grave|demais|intens/.test(c) ? 'severo' : /modera|mais ou menos/.test(c) ? 'moderado' : 'leve';
      return { type, severity, on_off_state: 'desconhecido' };
    }
  }
  return null;
}

/** Detecta confirmação de medicação tomada. */
function detectConfirmation(content) {
  const c = (content || '').toLowerCase();
  if (/\b(tomou|tomei|deu o rem[eé]dio|j[aá] tomou|j[aá] tomei|tomado)\b/.test(c)) {
    // qual medicação? deriva de config.MEDICATIONS (não hardcode); genérico se nenhuma casar.
    const match = (MEDICATIONS || []).find((m) => m.name && c.includes(m.name.toLowerCase()));
    return { med_name: match ? match.name : 'medicação' };
  }
  return null;
}

/**
 * Red-flag determinístico na mensagem recebida (negation-aware).
 * Tira @mentions e números longos (telefones) p/ evitar falso positivo.
 */
function detectRedFlag(content) {
  let c = (content || '').toLowerCase().replace(/@\d+/g, ' ').replace(/\d{10,}/g, ' ');
  const negated = (re) => {
    const m = c.match(re);
    if (!m) return false;
    const before = c.slice(Math.max(0, m.index - 25), m.index);
    return !/\b(n[aã]o|sem|nenhum|nada de)\b/.test(before);
  };
  const flag = (severity, reason) => ({ shouldAlert: true, severity, reason });

  if (negated(/febre|temperatura|3[89]\s*grau|40\s*grau/)) return flag('urgent', 'Possível febre relatada');
  if (negated(/dbs (parou|desligou)|estimulador (parou|desligou)|desligou sozinho/)) return flag('emergency', 'DBS pode ter parado');
  if (negated(/desmai|perdeu a consci|n[aã]o acorda/)) return flag('emergency', 'Possível desmaio/perda de consciência');
  if (negated(/caiu|queda|tombo/)) return flag('warning', 'Queda relatada');
  if (negated(/confus|desorienta|alucin/)) return flag('urgent', 'Confusão/alucinação relatada');
  if (negated(/engasg|engol|sufoc/)) return flag('urgent', 'Dificuldade para engolir/engasgo');
  if (negated(/muito r[ií]gido|travou tudo|n[aã]o consegue andar|n[aã]o anda/)) return flag('warning', 'Rigidez severa / não anda');
  if (negated(/dor no peito|falta de ar|fraqueza de um lado|n[aã]o mexe o bra[cç]o/)) return flag('emergency', 'Sinais de AVC/IAM (antecedente)');

  return { shouldAlert: false, severity: 'info', reason: '' };
}

module.exports = { parseTags, strip, keywordSymptom, detectConfirmation, detectRedFlag };
