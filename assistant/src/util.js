'use strict';
/** util.js — helpers de tempo (BRT), preparo de texto p/ TTS e chunking. */

const { TZ } = require('./config');

/** Date com o "wall clock" de São Paulo (para extrair hora/dia locais). */
function brtNow(d = new Date()) {
  return new Date(d.toLocaleString('en-US', { timeZone: TZ }));
}

function brtParts(d = new Date()) {
  const b = brtNow(d);
  return {
    hour: b.getHours(),
    minute: b.getMinutes(),
    dow: b.getDay(), // 0=domingo
    ymd: `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, '0')}-${String(b.getDate()).padStart(2, '0')}`,
    hhmm: `${String(b.getHours()).padStart(2, '0')}:${String(b.getMinutes()).padStart(2, '0')}`,
  };
}

/** "[dd/mm hh:mm]" em BRT para timestampar o histórico no contexto. */
function fmtBRTStamp(isoOrDate) {
  const b = brtNow(new Date(isoOrDate));
  const dd = String(b.getDate()).padStart(2, '0');
  const mm = String(b.getMonth() + 1).padStart(2, '0');
  const hh = String(b.getHours()).padStart(2, '0');
  const mi = String(b.getMinutes()).padStart(2, '0');
  return `[${dd}/${mm} ${hh}:${mi}]`;
}

function greeting(hour) {
  return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
}

/** Remove qualquer tag [TIPO: ...] do texto (não devem chegar ao TTS). */
function stripBracketTags(text) {
  return (text || '')
    .replace(/\[REGISTRO:[^\]]*\]/gi, '')
    .replace(/\[MUDANCA:[^\]]*\]/gi, '')
    .replace(/\[MEDICACAO:[^\]]*\]/gi, '')
    .replace(/\[[A-Z]+:[^\]]*\]/g, '')
    .trim();
}

const TTS_ABBR = [
  [/\bkcal\b/gi, 'quilocalorias'],
  [/\bmg\b/gi, 'miligramas'],
  [/\bml\b/gi, 'mililitros'],
  [/\bDBS\b/g, 'estimulação cerebral profunda'],
  [/\bDr\.\s/g, 'Doutor '],
  [/\bDra\.\s/g, 'Doutora '],
  [/\bHz\b/g, 'hertz'],
  [/\bmA\b/g, 'miliamperes'],
  [/\bµs\b/g, 'microssegundos'],
  [/\bhrs?\b/gi, 'horas'],
  [/\bmin\b/gi, 'minutos'],
];

/** Prepara o texto para TTS: tira markdown/símbolos e expande abreviações médicas. */
function expandForTTS(text) {
  let t = stripBracketTags(text || '');
  t = t
    .replace(/\*\*/g, '')
    .replace(/[*_#`>]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // links markdown
    .replace(/^\s*[-•]\s+/gm, '') // bullets
    .replace(/\r/g, '');
  for (const [re, rep] of TTS_ABBR) t = t.replace(re, rep);
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/** Quebra texto longo em pedaços <= soft (hard máximo), em fronteiras de parágrafo/frase. */
function chunkText(text, soft = 1500, hard = 1900) {
  const clean = (text || '').trim();
  if (clean.length <= hard) return [clean];
  const chunks = [];
  let buf = '';
  const paras = clean.split(/\n\n+/);
  const flush = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = '';
  };
  for (const para of paras) {
    if ((buf + '\n\n' + para).length <= soft) {
      buf = buf ? buf + '\n\n' + para : para;
      continue;
    }
    if (buf) flush();
    if (para.length <= hard) {
      buf = para;
    } else {
      // parágrafo gigante: quebra por frase
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if ((buf + ' ' + s).length <= soft) buf = buf ? buf + ' ' + s : s;
        else {
          if (buf) flush();
          buf = s.slice(0, hard);
        }
      }
    }
  }
  flush();
  return chunks.length ? chunks : [clean.slice(0, hard)];
}

module.exports = { brtNow, brtParts, fmtBRTStamp, greeting, stripBracketTags, expandForTTS, chunkText };
