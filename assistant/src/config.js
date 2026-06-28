'use strict';
/**
 * config.js — configuração efetiva do assistente.
 *
 * Por padrão, reexporta config.example.js (que lê tudo de variáveis de ambiente, com
 * placeholders seguros). Para customizar:
 *   - valores SECRETOS e identificadores (JID, telefone, UUID, URLs) → use o .env
 *   - defaults não-secretos (ASSISTANT_NAME, MEDICATIONS, horários) → edite config.example.js
 *     ou substitua este arquivo por uma cópia editada (cp config.example.js config.js).
 *
 * ⚠️ NUNCA coloque dado pessoal real (nomes, telefone, JID) hardcoded aqui. Use o .env.
 */
module.exports = require('./config.example');
