'use strict';
/**
 * secrets.js — carregador de segredos.
 *
 * Ordem de resolução:
 *   1. process.env (Cloud Run injeta via --set-secrets; dev local via .env + dotenv)
 *   2. GCP Secret Manager via `gcloud secrets versions access` (fallback p/ Linux/CI)
 *
 * Em produção (Cloud Run) sempre cai no passo 1. O passo 2 é conveniência de dev em
 * ambientes onde o gcloud funciona.
 *
 * Configure o projeto e o prefixo dos segredos via env:
 *   GSM_PROJECT   — id do projeto GCP onde vivem os segredos
 *   GSM_PREFIX    — prefixo opcional dos nomes no Secret Manager (ex.: "neurosint--")
 */

const { execFileSync } = require('node:child_process');

// Carrega .env se existir (dev local). Silencioso se dotenv não estiver instalado.
try {
  require('dotenv').config();
} catch (_) {
  /* dotenv ausente em prod slim — ok, usa process.env direto */
}

const GSM_PROJECT = process.env.GSM_PROJECT || '';
const GSM_PREFIX = process.env.GSM_PREFIX || '';
const CACHE = new Map();

// Lista de segredos esperados. O nome no GSM = GSM_PREFIX + env var (sobrescreva
// individualmente com env GSM_NAME_<ENV_VAR> se a sua convenção for outra).
const SECRET_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'SUPABASE_SERVICE_KEY',
  'EVOLUTION_API_KEY',
  'OPENEVIDENCE_API_KEY',
  'CRON_SECRET',
];

const GSM_NAMES = Object.fromEntries(
  SECRET_KEYS.map((k) => [k, process.env[`GSM_NAME_${k}`] || `${GSM_PREFIX}${k}`])
);

function fromGcloud(gsmName) {
  if (!GSM_PROJECT || !gsmName) return null;
  try {
    return execFileSync(
      'gcloud',
      ['secrets', 'versions', 'access', 'latest', `--secret=${gsmName}`, `--project=${GSM_PROJECT}`],
      { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} key  nome da env var (ex: 'ANTHROPIC_API_KEY')
 * @param {{ required?: boolean }} [opts]
 * @returns {string|undefined}
 */
function get(key, { required = false } = {}) {
  if (CACHE.has(key)) return CACHE.get(key);

  let val = process.env[key];
  if (!val && GSM_NAMES[key]) val = fromGcloud(GSM_NAMES[key]);

  if (!val) {
    if (required) {
      throw new Error(`Secret ausente: ${key}. Defina em .env (dev) ou injete via Secret Manager.`);
    }
    return undefined;
  }
  CACHE.set(key, val);
  return val;
}

/** Valida na inicialização que os segredos obrigatórios existem. */
function requireAll(keys) {
  const missing = keys.filter((k) => !get(k));
  if (missing.length) {
    throw new Error(`Segredos obrigatórios ausentes: ${missing.join(', ')}`);
  }
}

module.exports = { get, requireAll, GSM_NAMES };
