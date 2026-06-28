'use strict';
/**
 * server.js — Express. Recebe o webhook do WhatsApp (Evolution API) e expõe os endpoints
 * de cron (acionados pelo Cloud Scheduler). Opcionalmente roda node-cron interno
 * (ENABLE_INTERNAL_CRON=true) para VM/local.
 */

const express = require('express');
const { JOBS } = require('./schedules');
const handle = require('./pipeline/handle');
const secrets = require('./secrets');
const log = require('./logger');

const app = express();
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'assistant', ts: new Date().toISOString() }));

// Webhook do WhatsApp — ACK imediato (forward tem timeout curto) + processa async.
app.post('/webhook/evolution', (req, res) => {
  res.status(200).json({ received: true });
  handle.handleIncoming(req.body).catch((e) => log.error('webhook.handle_error', { err: e.message, stack: e.stack }));
});

// Endpoints de cron (Cloud Scheduler). Protegidos por header X-Cron-Secret.
app.post('/cron/:job', async (req, res) => {
  const secret = secrets.get('CRON_SECRET');
  if (secret && req.get('X-Cron-Secret') !== secret) return res.status(403).json({ error: 'forbidden' });
  const job = JOBS[req.params.job];
  if (!job) return res.status(404).json({ error: 'unknown job', available: Object.keys(JOBS) });
  try {
    const result = await job.run({ test: req.query.test === '1' });
    log.info('cron.done', { job: req.params.job, result });
    res.json({ ok: true, result });
  } catch (e) {
    log.error('cron.error', { job: req.params.job, err: e.message });
    res.status(500).json({ error: e.message });
  }
});

function presence() {
  const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'SUPABASE_SERVICE_KEY', 'EVOLUTION_API_KEY', 'OPENEVIDENCE_API_KEY', 'CRON_SECRET'];
  const p = {};
  for (const k of keys) p[k] = Boolean(secrets.get(k));
  return p;
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  log.info('assistant.up', { port: PORT, secrets: presence(), jobs: Object.keys(JOBS) });
  if (process.env.ENABLE_INTERNAL_CRON === 'true') {
    require('./scheduler').start();
    log.info('assistant.internal_cron_enabled');
  }
});

module.exports = app;
