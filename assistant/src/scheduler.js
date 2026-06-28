'use strict';
/**
 * scheduler.js — agendador interno via node-cron (TZ America/Sao_Paulo).
 * Uso: em VM/local com `node src/scheduler.js`, ou embutido no server quando
 * ENABLE_INTERNAL_CRON=true. Em Cloud Run o agendamento canônico é o Cloud Scheduler
 * batendo nos endpoints /cron/<job> — não ligue os dois ao mesmo tempo.
 */

const cron = require('node-cron');
const { JOBS } = require('./schedules');
const { TZ } = require('./config');
const log = require('./logger');

function start() {
  let count = 0;
  for (const [name, job] of Object.entries(JOBS)) {
    for (const expr of job.crons) {
      cron.schedule(
        expr,
        () => {
          log.info('cron.fire', { job: name, expr });
          Promise.resolve(job.run()).catch((e) => log.error('cron.run_error', { job: name, err: e.message }));
        },
        { timezone: TZ }
      );
      count++;
    }
  }
  log.info('scheduler.started', { jobs: Object.keys(JOBS).length, schedules: count, tz: TZ });
}

if (require.main === module) start();
module.exports = { start };
