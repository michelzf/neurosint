'use strict';
/**
 * media.js — resolve mídia recebida (áudio/imagem/vídeo/documento) em texto.
 * audio → Whisper; image → gpt-4.1-mini; video → Whisper(trilha) + miniatura;
 * document(pdf) → claude-haiku.
 * Retorna { content, originalType } para alimentar o contexto do conselho.
 */

const evolution = require('../clients/evolution');
const openai = require('../clients/openai');
const anthropic = require('../clients/anthropic');
const log = require('../logger');

const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // limite da API de transcrição da OpenAI

/**
 * jpegThumbnail chega em formatos diferentes conforme a serialização: string base64,
 * Buffer serializado em JSON (`{ type:'Buffer', data:[...] }`) ou array de bytes.
 * Normaliza para uma string base64 (ou null se ausente/irreconhecível).
 */
function thumbnailToBase64(thumb) {
  if (!thumb) return null;
  if (typeof thumb === 'string') return thumb;
  if (Array.isArray(thumb)) return Buffer.from(thumb).toString('base64');
  if (thumb.type === 'Buffer' && Array.isArray(thumb.data)) return Buffer.from(thumb.data).toString('base64');
  return null;
}

/**
 * Vídeo → texto, sem depender de ffmpeg: transcreve a trilha de áudio (Whisper aceita mp4)
 * e descreve a miniatura JPEG embutida no payload (frame único). A miniatura funciona mesmo
 * se o download do vídeo completo falhar.
 */
async function resolveVideo(norm, base64) {
  let speech = '';
  let scene = '';

  if (base64) {
    const buf = Buffer.from(base64, 'base64');
    if (buf.length <= WHISPER_MAX_BYTES) {
      try {
        speech = await openai.transcribe(buf, 'video.mp4');
      } catch (e) {
        log.warn('media.video_stt_failed', { err: e.message });
      }
    } else {
      log.warn('media.video_too_large', { bytes: buf.length });
    }
  }

  const thumbB64 = thumbnailToBase64(norm.rawMessage?.videoMessage?.jpegThumbnail);
  if (thumbB64) {
    try {
      scene = await openai.describeImage(
        thumbB64,
        'image/jpeg',
        'Esta é a miniatura (um frame) de um vídeo enviado no grupo de cuidados de um paciente com Parkinson e DBS. Descreva objetivamente o que aparece: pessoa, postura, marcha ou movimento, ambiente, ou se é um exame/documento/configuração de DBS filmado.'
      );
    } catch (e) {
      log.warn('media.video_thumb_failed', { err: e.message });
    }
  }

  const parts = [];
  if (norm.content) parts.push(`Legenda: ${norm.content}.`);
  if (scene) parts.push(`Cena (miniatura): ${scene}.`);
  if (speech) parts.push(`Fala transcrita: ${speech}`);
  // trava anti-alucinação: sem quadro visual, o conselho NÃO deve inventar a cena.
  if (!scene) {
    parts.push(
      '(Não recebi o quadro visual deste vídeo — descreva apenas com base na fala e na legenda; não invente o que aparece na imagem. Se faltar informação, peça uma breve descrição.)'
    );
  }
  return { content: `Vídeo recebido. ${parts.join(' ').trim()}`, originalType: 'video' };
}

async function resolveMedia(norm) {
  // text/button/list não precisam de download
  if (norm.messageType === 'text' || norm.messageType === 'button_response' || norm.messageType === 'list_response') {
    return { content: norm.content, originalType: norm.messageType };
  }

  let base64;
  try {
    const dl = await evolution.getBase64FromMedia(norm.mediaKey);
    base64 = dl?.base64;
  } catch (e) {
    log.warn('media.download_failed', { err: e.message, type: norm.messageType });
  }

  // vídeo é resiliente: a miniatura vem do payload, então tenta interpretar mesmo sem download.
  if (norm.messageType === 'video') {
    return resolveVideo(norm, base64);
  }

  if (!base64) {
    return { content: norm.content || '(mídia recebida, mas não consegui baixar o conteúdo)', originalType: norm.messageType };
  }

  try {
    if (norm.messageType === 'audio') {
      const text = await openai.transcribe(Buffer.from(base64, 'base64'), 'audio.ogg');
      return { content: text || '(áudio sem fala identificável)', originalType: 'audio' };
    }
    if (norm.messageType === 'image') {
      const desc = await openai.describeImage(base64, 'image/jpeg');
      const caption = norm.content ? `Legenda: ${norm.content}. ` : '';
      return { content: `${caption}Imagem: ${desc}`, originalType: 'image' };
    }
    if (norm.messageType === 'document') {
      const extracted = await anthropic.extractPdf(base64);
      const fname = norm.content || 'documento';
      return { content: `Documento PDF (${fname}): ${extracted}`, originalType: 'document', rawText: extracted, fileName: fname };
    }
  } catch (e) {
    log.error('media.process_failed', { err: e.message, type: norm.messageType });
    return { content: norm.content || `(${norm.messageType} recebido — falha ao interpretar)`, originalType: norm.messageType };
  }

  return { content: norm.content, originalType: norm.messageType };
}

module.exports = { resolveMedia, thumbnailToBase64 };
