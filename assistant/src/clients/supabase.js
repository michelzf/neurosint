'use strict';
/**
 * supabase.js — cliente REST/RPC/Storage do Supabase (projeto vem de config.SUPABASE_URL).
 * Usa a service role key (header apikey + Authorization Bearer).
 */

const { SUPABASE_URL, SUPABASE_AUDIO_BUCKET } = require('../config');
const secrets = require('../secrets');

function key() {
  return secrets.get('SUPABASE_SERVICE_KEY', { required: true });
}

function authHeaders(extra = {}) {
  const k = key();
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...extra };
}

/** GET /rest/v1/<table>?<query>. `query` é a query string já montada (sem '?'). */
async function select(table, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const res = await fetch(url, { headers: authHeaders() });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase select ${table} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}

/**
 * POST /rest/v1/<table>. `prefer` controla retorno/conflito.
 * Ex: 'return=representation,resolution=ignore-duplicates'
 */
async function insert(table, rows, prefer = 'return=minimal') {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ Prefer: prefer }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase insert ${table} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}

/** POST /rest/v1/rpc/<fn> com body de parâmetros. */
async function rpc(fn, params = {}) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(params) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase rpc ${fn} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Upload de áudio (mp3) para o bucket de storage. Retorna a URL pública. */
async function uploadAudio(path, buffer) {
  const url = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_AUDIO_BUCKET}/${path}`;
  const k = key();
  const res = await fetch(url, {
    method: 'POST',
    headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'audio/mpeg', 'x-upsert': 'true' },
    body: buffer,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase upload ${path} ${res.status}: ${t.slice(0, 200)}`);
  }
  return publicUrl(path);
}

function publicUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_AUDIO_BUCKET}/${path}`;
}

module.exports = { select, insert, rpc, uploadAudio, publicUrl };
