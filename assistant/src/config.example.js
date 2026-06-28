'use strict';
/**
 * config.example.js — configuração do assistente (Camada 4 do Neurosint).
 *
 * COMO USAR:
 *   1. Copie para config.js   →   cp config.example.js config.js
 *   2. Preencha com os dados do SEU caso. O config.js fica IGNORADO pelo .gitignore.
 *   3. Valores SENSÍVEIS (chaves/tokens) NÃO ficam aqui — vêm de secrets.js (.env / Secret Manager).
 *
 * ⚠️ Nada de dado real neste arquivo de exemplo. Identificadores (JID, telefone, UUID,
 *    URLs, voice id) vêm de variáveis de ambiente; aqui só há placeholders.
 */

module.exports = {
  // --- Identidade do assistente ---------------------------------------------
  ASSISTANT_NAME: process.env.ASSISTANT_NAME || 'Neurosint',

  // --- Pessoas (nomes/apelidos para o assistente usar nas falas) ------------
  // Mantenha neutro no repo; o nome real você define no SEU config.js privado.
  PATIENT_NAME: process.env.PATIENT_NAME || 'o paciente',
  CAREGIVER_NAME: process.env.CAREGIVER_NAME || 'a cuidadora',
  MANAGER_NAME: process.env.MANAGER_NAME || 'o responsável', // quem recebe os alertas

  // --- Destinos WhatsApp (preencher via .env na sua instância) --------------
  PATIENT_ID: process.env.PATIENT_ID || '00000000-0000-0000-0000-000000000000',
  GROUP_JID: process.env.GROUP_JID || '000000000000000000@g.us', // grupo de cuidado: TODAS as respostas vão aqui
  ALERT_NUMBER: process.env.ALERT_NUMBER || '550000000000000',   // recebe red-flag alerts
  CAREGIVER_JID: process.env.CAREGIVER_JID || '550000000000000@s.whatsapp.net', // @mention nos lembretes

  // --- Evolution API (WhatsApp) ---------------------------------------------
  EVOLUTION_BASE: process.env.EVOLUTION_BASE || 'https://sua-evolution-api.exemplo.com',
  EVOLUTION_INSTANCE: process.env.EVOLUTION_INSTANCE || 'sua-instancia',

  // --- Supabase -------------------------------------------------------------
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://SEU-PROJETO.supabase.co',
  SUPABASE_AUDIO_BUCKET: process.env.SUPABASE_AUDIO_BUCKET || 'audio-files',

  // --- Modelos --------------------------------------------------------------
  COUNCIL_MODEL: 'claude-sonnet-4-6',          // conselho de especialistas (resposta principal)
  COUNCIL_MAX_TOKENS: 1500,
  COUNCIL_TEMPERATURE: 0.4,
  HAIKU_MODEL: 'claude-haiku-4-5-20251001',    // PDF/resumo/relatórios
  VISION_MODEL: 'gpt-4.1-mini',                // descrição de imagem
  WHISPER_MODEL: 'whisper-1',                  // transcrição de áudio (pt)
  ANTHROPIC_VERSION: '2023-06-01',
  OPENEVIDENCE_MODEL: 'oe-v2',

  // --- ElevenLabs TTS -------------------------------------------------------
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || 'SUA_VOICE_ID',
  ELEVENLABS_MODEL: 'eleven_flash_v2_5',
  ELEVENLABS_VOICE_SETTINGS: { stability: 0.8, similarity_boost: 0.9, style: 0.6, use_speaker_boost: true },

  // --- Comportamento --------------------------------------------------------
  TZ: process.env.TZ || 'America/Sao_Paulo',
  DEDUP_MAX_AGE_SEC: 120,
  TTS_CHUNK_SOFT: 1500,
  TTS_CHUNK_HARD: 1900,
  SUMMARY_EVERY_N_MSGS: 10,
  SUMMARY_STALE_HOURS: 48,
  RECENT_MESSAGES_LIMIT: 50,
  RESPONSE_MAX_CHARS: 6000,

  // --- Medicações (data-driven: o lembrete sai nos horários abaixo, em BRT) --
  // Edite para o esquema do seu familiar. `say` é o texto falado do lembrete.
  MEDICATIONS: [
    { name: 'Levodopa', hours: [8, 11, 14, 17, 20], say: 'um comprimido de levodopa. Tomar trinta minutos antes da refeição.' },
    { name: 'Anti-hipertensivo', hours: [8], say: 'o comprimido da pressão.' },
  ],
  // Medicação "principal" usada no contexto ("próxima dose em X minutos").
  PRIMARY_MED_NAME: 'Levodopa',
  PRIMARY_MED_HOURS: [8, 11, 14, 17, 20],

  /**
   * Troca de programa do DBS (data-driven — evita o bug de datas fixas vencidas).
   * Edite quando o médico definir um novo ciclo. chave = YYYY-MM-DD (BRT).
   * Vazio = nenhuma troca programada.
   */
  DBS_PROGRAM_SCHEDULE: {
    // '2026-06-11': { program: 3, kind: 'switch', text: '...' },
  },
};
