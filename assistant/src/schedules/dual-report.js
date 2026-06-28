'use strict';
/**
 * dual-report.js — Relatório semanal duplo (domingo 17h BRT).
 *   (a) Resumo para a família, em ÁUDIO (haiku, linguagem falada).
 *   (b) Relatório CLÍNICO em PDF (sonnet) enviado como documento ao grupo.
 */

const PDFDocument = require('pdfkit');
const { PATIENT_ID, GROUP_JID, HAIKU_MODEL, COUNCIL_MODEL, ASSISTANT_NAME, PATIENT_NAME } = require('../config');
const supabase = require('../clients/supabase');
const anthropic = require('../clients/anthropic');
const evolution = require('../clients/evolution');
const respond = require('../pipeline/respond');
const { contextBlurb } = require('./_shared');
const { brtParts, stripBracketTags } = require('../util');
const log = require('../logger');

const FAMILY_SYSTEM =
  `Você é o ${ASSISTANT_NAME}. Faça um resumo semanal CURTO (cerca de 8 frases) sobre o paciente para a família, ` +
  'em português falado e acolhedor. Será convertido em ÁUDIO: sem markdown, sem abreviações, números por extenso. ' +
  'Destaque como foi a semana (humor, movimento, sintomas, medicação) de forma simples e gentil.';

const CLINICAL_SYSTEM =
  `Você é o ${ASSISTANT_NAME}, gerando um relatório CLÍNICO semanal estruturado sobre um paciente com ` +
  'Parkinson (DBS, se aplicável) para o médico assistente. ' +
  'Use linguagem técnica objetiva, organizada em seções: Resumo da semana, Estado motor (ON/OFF), Sintomas, ' +
  'Aderência medicamentosa, Alertas, Pontos de atenção/recomendações para a consulta. Pode usar markdown leve.';

function buildPdf(title, subtitle, body) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).fillColor('#1a1a1a').text(title);
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#666').text(subtitle);
    doc.moveDown();
    doc.fontSize(11).fillColor('#000').text(stripBracketTags(body).replace(/\*\*/g, ''), { align: 'left', lineGap: 2 });
    doc.end();
  });
}

async function run({ test = false } = {}) {
  const { ymd } = brtParts();
  let blurb = '';
  let recentMsgs = [];
  try {
    const ctx = (await supabase.rpc('assistant_get_patient_context', { p_patient_id: PATIENT_ID })) || {};
    blurb = contextBlurb(ctx);
    recentMsgs = (await supabase.rpc('assistant_get_recent_messages', { p_patient_id: PATIENT_ID, p_limit: 50 })) || [];
  } catch (e) {
    log.warn('dual.context_failed', { err: e.message });
  }
  const msgsText = (Array.isArray(recentMsgs) ? recentMsgs : [])
    .slice(0, 40)
    .reverse()
    .map((m) => `${m.direction === 'incoming' ? m.sender_name || 'Família' : ASSISTANT_NAME}: ${m.content}`)
    .join('\n');
  const dataBlock = `Paciente: ${PATIENT_NAME}.\nContexto:\n${blurb}\n\nConversas da semana:\n${msgsText}`;

  // (a) Áudio para a família
  try {
    const family = await anthropic.complete({ model: HAIKU_MODEL, system: FAMILY_SYSTEM, prompt: dataBlock, max_tokens: 700, temperature: 0.4 });
    if (family) {
      if (test) await respond.sendText(`🧪 (teste — resumo família)\n${stripBracketTags(family)}`);
      else await respond.speak(family);
    }
  } catch (e) {
    log.warn('dual.family_failed', { err: e.message });
  }

  // (b) PDF clínico
  try {
    const clinical = await anthropic.complete({ model: COUNCIL_MODEL, system: CLINICAL_SYSTEM, prompt: dataBlock, max_tokens: 1800, temperature: 0.3 });
    if (clinical) {
      const pdf = await buildPdf(`Relatório Clínico Semanal — ${PATIENT_NAME}`, `Gerado pelo ${ASSISTANT_NAME} em ${ymd}`, clinical);
      const fileName = `Relatorio_Clinico_${ymd}.pdf`;
      await evolution.sendMedia(GROUP_JID, {
        mediatype: 'document',
        media: pdf.toString('base64'),
        fileName,
        mimetype: 'application/pdf',
        caption: test ? '🧪 (teste) Relatório clínico semanal' : 'Relatório clínico semanal — para levar ao médico',
      });
    }
  } catch (e) {
    log.error('dual.clinical_failed', { err: e.message });
  }
  return { ok: true };
}

module.exports = { run };
