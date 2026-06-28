'use strict';
/**
 * logger.js — log estruturado (JSON) p/ Cloud Logging, com redação de PII/segredos.
 * Cloud Run captura stdout/stderr como entradas de log.
 */

const SECRET_RE = /\b(sk-[A-Za-z0-9_-]{12,}|sk_[A-Za-z0-9]{24,}|AIza[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9._-]{20,})\b/g;

function redact(v) {
  if (typeof v === 'string') return v.replace(SECRET_RE, '[REDACTED]');
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = redact(val);
    return out;
  }
  return v;
}

function emit(severity, msg, fields) {
  const entry = { severity, message: msg, ts: new Date().toISOString(), ...redact(fields || {}) };
  const line = JSON.stringify(entry);
  if (severity === 'ERROR' || severity === 'CRITICAL') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  info: (msg, fields) => emit('INFO', msg, fields),
  warn: (msg, fields) => emit('WARNING', msg, fields),
  error: (msg, fields) => emit('ERROR', msg, fields),
  debug: (msg, fields) => {
    if (process.env.DEBUG) emit('DEBUG', msg, fields);
  },
};
