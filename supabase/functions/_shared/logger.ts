// logger.ts — log JSON estruturado (porte de assistant/src/logger.js).
// REGRA: nunca logar PHI (conteúdo clínico). Só metadados (ids, tipos, tamanhos, status).

type Fields = Record<string, unknown>;

function emit(level: string, msg: string, fields: Fields = {}) {
  try {
    console.log(JSON.stringify({ level, msg, ...fields, ts: new Date().toISOString() }));
  } catch {
    console.log(JSON.stringify({ level, msg, ts: new Date().toISOString() }));
  }
}

export const log = {
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};
