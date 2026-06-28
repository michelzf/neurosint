'use strict';
/** Smoke tests puros (sem rede): module graph + lógica de normalize/tags/util/schedules. */

const { test } = require('node:test');
const assert = require('node:assert');

const { normalize } = require('../src/pipeline/normalize');
const { thumbnailToBase64 } = require('../src/pipeline/media');
const tags = require('../src/pipeline/tags');
const util = require('../src/util');
const { JOBS } = require('../src/schedules');
require('../src/pipeline/handle'); // garante que o grafo de require carrega sem erro
require('../src/pipeline/council'); // carrega o system prompt do disco

test('normalize: mensagem de texto do grupo', () => {
  const n = normalize({ body: { data: { key: { remoteJid: '120363000000000000@g.us', id: 'ABC', fromMe: false }, message: { conversation: 'meu pai está com febre' }, pushName: 'Cuidador' } } });
  assert.equal(n.skip, false);
  assert.equal(n.messageType, 'text');
  assert.match(n.content, /febre/);
  assert.equal(n.senderName, 'Cuidador');
});

test('normalize: fromMe é ignorado', () => {
  const n = normalize({ data: { key: { remoteJid: 'x@g.us', id: 'y', fromMe: true }, message: { conversation: 'oi' } } });
  assert.equal(n.skip, true);
});

test('normalize: "2" vira resposta de check-in', () => {
  const n = normalize({ data: { key: { remoteJid: 'x@g.us', id: 'z', fromMe: false }, message: { conversation: '2' } } });
  assert.equal(n.messageType, 'button_response');
  assert.equal(n.buttonId, 'checkin_maisOuMenos');
});

test('normalize: reação vira tipo reaction com emoji e alvo', () => {
  const n = normalize({ data: { key: { remoteJid: '120363000000000000@g.us', id: 'R1', fromMe: false }, message: { reactionMessage: { text: '❤️', key: { id: 'TARGET123' } } }, pushName: 'Cuidador' } });
  assert.equal(n.skip, false);
  assert.equal(n.messageType, 'reaction');
  assert.equal(n.reactionEmoji, '❤️');
  assert.equal(n.reactionTargetId, 'TARGET123');
  assert.match(n.content, /❤️/);
});

test('normalize: reação removida tem emoji vazio', () => {
  const n = normalize({ data: { key: { remoteJid: 'x@g.us', id: 'R2', fromMe: false }, message: { reactionMessage: { text: '', key: { id: 'T' } } } } });
  assert.equal(n.messageType, 'reaction');
  assert.equal(n.reactionEmoji, '');
});

test('normalize: vídeo vira tipo video com legenda e mediaKey', () => {
  const n = normalize({ data: { key: { remoteJid: '120363000000000000@g.us', id: 'V1', fromMe: false }, message: { videoMessage: { caption: 'pai andando hoje' } }, pushName: 'Cuidador' } });
  assert.equal(n.messageType, 'video');
  assert.match(n.content, /andando/);
  assert.ok(n.mediaKey, 'mediaKey definido p/ download');
});

test('media: thumbnailToBase64 aceita string, Buffer-JSON e array', () => {
  assert.equal(thumbnailToBase64('YWJj'), 'YWJj');
  assert.equal(thumbnailToBase64({ type: 'Buffer', data: [97, 98, 99] }), Buffer.from('abc').toString('base64'));
  assert.equal(thumbnailToBase64([97, 98, 99]), Buffer.from('abc').toString('base64'));
  assert.equal(thumbnailToBase64(null), null);
  assert.equal(thumbnailToBase64({ foo: 'bar' }), null);
});

test('tags: parse [REGISTRO] e strip', () => {
  const reply = 'Vou ficar atento. [REGISTRO: tipo=tremor, severidade=moderado]';
  const parsed = tags.parseTags(reply);
  assert.equal(parsed.symptoms.length, 1);
  assert.equal(parsed.symptoms[0].type, 'tremor');
  assert.equal(parsed.symptoms[0].severity, 'moderado');
  assert.ok(!tags.strip(reply).includes('[REGISTRO'));
});

test('tags: parse [MUDANCA]', () => {
  const parsed = tags.parseTags('Anotado. [MUDANCA: medicacao=Levodopa, nova_dose=1 comprimido, novo_horario=8h e 14h]');
  assert.equal(parsed.medicationChanges.length, 1);
  assert.equal(parsed.medicationChanges[0].medicacao, 'Levodopa');
});

test('red-flag: queda alerta; negação não alerta', () => {
  assert.equal(tags.detectRedFlag('ele caiu agora no banheiro').shouldAlert, true);
  assert.equal(tags.detectRedFlag('ele não está com febre hoje').shouldAlert, false);
  assert.equal(tags.detectRedFlag('o DBS desligou sozinho').severity, 'emergency');
});

test('util: expandForTTS remove markdown e expande abreviações', () => {
  const out = util.expandForTTS('Toma 100 mg de **Levodopa** e ver o DBS.');
  assert.ok(!out.includes('**'));
  assert.match(out, /miligramas/);
  assert.match(out, /estimulação cerebral profunda/);
});

test('util: chunkText respeita o limite', () => {
  const big = 'Frase de teste. '.repeat(400); // ~6400 chars
  const chunks = util.chunkText(big, 1500, 1900);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 1900, `chunk ${c.length} > 1900`);
});

test('schedules: 8 jobs registrados com run()', () => {
  const names = Object.keys(JOBS);
  assert.equal(names.length, 8);
  for (const n of names) {
    assert.equal(typeof JOBS[n].run, 'function', `${n}.run`);
    assert.ok(Array.isArray(JOBS[n].crons) && JOBS[n].crons.length >= 1, `${n}.crons`);
  }
});
