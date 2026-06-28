'use strict';
/**
 * index.js — registro dos 8 jobs agendados.
 * `crons` em horário de Brasília (TZ America/Sao_Paulo) — usado tanto pelo node-cron
 * interno (scheduler.js) quanto pela referência de provisionamento do Cloud Scheduler.
 */

const checkin = require('./checkin');
const medication = require('./medication');
const weeklySummary = require('./weekly-summary');
const dualReport = require('./dual-report');
const dbsBattery = require('./dbs-battery');
const dbsProgram = require('./dbs-program');
const caregiver = require('./caregiver');
const morning = require('./morning');

const JOBS = {
  checkin: { run: checkin.run, crons: ['0 10 * * *', '0 16 * * *', '0 21 * * *'], label: 'Check-in Diário' },
  medication: { run: medication.run, crons: ['0 8 * * *', '0 11 * * *', '0 14 * * *', '0 17 * * *', '0 20 * * *'], label: 'Lembrete de Medicação' },
  morning: { run: morning.run, crons: ['0 8 * * *'], label: 'Check-in Matinal Proativo (áudio)' },
  caregiver: { run: caregiver.run, crons: ['0 15 * * 3'], label: 'Check-in do Cuidador' },
  'dbs-battery': { run: dbsBattery.run, crons: ['0 9 * * *'], label: 'Lembrete Bateria DBS (a cada 2 dias)' },
  'dbs-program': { run: dbsProgram.run, crons: ['0 9 * * *'], label: 'Lembrete Troca Programa DBS (data-driven)' },
  'weekly-summary': { run: weeklySummary.run, crons: ['0 20 * * 0'], label: 'Resumo Semanal (texto)' },
  'dual-report': { run: dualReport.run, crons: ['0 17 * * 0'], label: 'Relatório Semanal Duplo (áudio + PDF)' },
};

module.exports = { JOBS };
