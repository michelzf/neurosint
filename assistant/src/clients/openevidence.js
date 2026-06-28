'use strict';
/**
 * openevidence.js — tool de evidência científica (Parkinson/DBS/medicação).
 * O conselho (anthropic) pode chamar isto via tool-use. A pergunta deve ir em INGLÊS.
 */

const { OPENEVIDENCE_MODEL } = require('../config');
const secrets = require('../secrets');

/** @param {string} questionEnglish  pergunta clínica em inglês. @returns {Promise<string>} */
async function analysis(questionEnglish) {
  const token = secrets.get('OPENEVIDENCE_API_KEY');
  if (!token) return 'Evidência científica indisponível no momento.';
  try {
    const res = await fetch('https://api.openevidence.com/analysis', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ text: questionEnglish, model: OPENEVIDENCE_MODEL }),
    });
    const text = await res.text();
    if (!res.ok) return `Evidência indisponível (status ${res.status}).`;
    return text;
  } catch (e) {
    return `Evidência indisponível (${e.message.slice(0, 80)}).`;
  }
}

module.exports = { analysis };
