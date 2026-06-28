// tags.ts — parsing das tags do conselho + detecção determinística de red-flags + fallbacks.
// Porte fiel de assistant/src/pipeline/tags.js (lógica pura, sem dependências).

export interface Symptom { type: string; severity: string; on_off_state: string }
export interface MedChange { medicacao: string; nova_dose: string | null; novo_horario: string | null }
export interface KeyFact { category: string; fact_key: string; fact_value: string; source: string }
export interface MedConfirm { med_name: string; horario?: string | null; status?: string }
export interface ParsedTags { symptoms: Symptom[]; medicationChanges: MedChange[]; keyFacts: KeyFact[]; medicationConfirm: MedConfirm | null }
export interface RedFlag { shouldAlert: boolean; severity: "info" | "warning" | "urgent" | "emergency"; reason: string }

function parseKV(inner: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of inner.split(",")) {
    const m = part.split("=");
    if (m.length >= 2) out[m[0].trim().toLowerCase()] = m.slice(1).join("=").trim();
  }
  return out;
}

export function parseTags(replyText: string): ParsedTags {
  const text = replyText || "";
  const symptoms: Symptom[] = [];
  const medicationChanges: MedChange[] = [];
  const keyFacts: KeyFact[] = [];
  let medicationConfirm: MedConfirm | null = null;

  for (const m of text.matchAll(/\[REGISTRO:([^\]]*)\]/gi)) {
    const kv = parseKV(m[1]);
    if (kv.tipo) symptoms.push({ type: kv.tipo, severity: kv.severidade || "leve", on_off_state: "desconhecido" });
  }
  for (const m of text.matchAll(/\[MUDANCA:([^\]]*)\]/gi)) {
    const kv = parseKV(m[1]);
    if (kv.medicacao) {
      medicationChanges.push({ medicacao: kv.medicacao, nova_dose: kv.nova_dose || null, novo_horario: kv.novo_horario || null });
      keyFacts.push({ category: "medicacao", fact_key: `mudanca_${kv.medicacao}`.toLowerCase(), fact_value: m[1].trim(), source: "relato_paciente" });
    }
  }
  for (const m of text.matchAll(/\[MEDICACAO:([^\]]*)\]/gi)) {
    const kv = parseKV(m[1]);
    if (kv.nome) medicationConfirm = { med_name: kv.nome, horario: kv.horario || null, status: kv.status || "tomado" };
  }
  return { symptoms, medicationChanges, keyFacts, medicationConfirm };
}

/** Remove as tags [CHAVE: ...] para não chegarem ao usuário/TTS. */
export function strip(replyText: string): string {
  return (replyText || "").replace(/\[(REGISTRO|MUDANCA|MEDICACAO):[^\]]*\]/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

const SYMPTOM_MAP: [RegExp, string][] = [
  [/\bsonolen|\bsono\b|dormindo demais/i, "sonolencia"],
  [/tremor|tremen/i, "tremor"],
  [/freezing|congel|travou|travad/i, "freezing"],
  [/rigidez|rigido|duro/i, "rigidez"],
  [/caiu|queda|tombo/i, "queda"],
  [/ansie|nervos|agitad/i, "ansiedade"],
  [/confus|desorienta/i, "confusao"],
  [/alucin|viu coisas/i, "alucinacao"],
  [/engol|engasg|disfagia/i, "disfagia"],
  [/\bdor\b|dolorid/i, "dor"],
  [/discinesia|movimento involunt/i, "discinesia"],
  [/saliva|babando|sialorr/i, "sialorreia"],
  [/triste|deprim|apati|desanim/i, "humor_baixo"],
];

export function keywordSymptom(content: string): Symptom | null {
  const c = (content || "").toLowerCase();
  for (const [re, type] of SYMPTOM_MAP) {
    if (re.test(c)) {
      const severity = /sever|muito|forte|grave|demais|intens/.test(c)
        ? "severo"
        : /modera|mais ou menos/.test(c)
        ? "moderado"
        : "leve";
      return { type, severity, on_off_state: "desconhecido" };
    }
  }
  return null;
}

// Detecta a INTENÇÃO de confirmação de dose, mas só retorna se houver um nome de medicação real
// (passado em `meds`, ex.: as medicações ativas do paciente). Sem nome real → null: não gravamos
// um log de dose órfão (medication_id NULL). O caminho confiável é a tag [MEDICACAO: nome=...].
export function detectConfirmation(content: string, meds: string[] = []): MedConfirm | null {
  const c = (content || "").toLowerCase();
  if (!/\b(tomou|tomei|deu o rem[eé]dio|j[aá] tomou|j[aá] tomei|tomado)\b/.test(c)) return null;
  const match = meds.find((m) => m && c.includes(m.toLowerCase()));
  return match ? { med_name: match } : null;
}

/** Red-flag determinístico (negation-aware). Porte de tags.js. */
export function detectRedFlag(content: string): RedFlag {
  const c = (content || "").toLowerCase().replace(/@\d+/g, " ").replace(/\d{10,}/g, " ");
  const negated = (re: RegExp) => {
    // Inspeciona TODAS as ocorrências do gatilho, não só a 1ª: se QUALQUER uma
    // for não-negada, o alerta dispara. Caso contrário, um sintoma real depois de
    // uma negação do mesmo gatilho ("não caiu ontem, mas caiu hoje") seria suprimido.
    const reG = new RegExp(re.source, "gi");
    for (const m of c.matchAll(reG)) {
      if (m.index == null) continue;
      // Liga a negação ao gatilho: olha só a oração atual, não uma janela cega.
      // O início da oração é o último delimitador ([.,;:!?]) ou conjunção (" e ",
      // " mas ", " porém ", " entretanto ", " contudo ", " todavia ") antes do match.
      const lo = Math.max(0, m.index - 25);
      const ctx = c.slice(lo, m.index);
      let cut = 0;
      for (const cm of ctx.matchAll(/[.,;:!?]|\s(?:e|mas|por[eé]m|entretanto|contudo|todavia)\s/g)) {
        cut = Math.max(cut, cm.index! + cm[0].length);
      }
      const before = ctx.slice(cut);
      if (!/\b(n[aã]o|sem|nenhum|nada de)\b/.test(before)) return true;
    }
    // Sem ocorrência, ou todas negadas → não dispara.
    return false;
  };
  const flag = (severity: RedFlag["severity"], reason: string): RedFlag => ({ shouldAlert: true, severity, reason });

  if (negated(/febre|temperatura|3[89]\s*grau|40\s*grau/)) return flag("urgent", "Possível febre relatada");
  if (negated(/dbs (parou|desligou)|estimulador (parou|desligou)|desligou sozinho/)) return flag("emergency", "DBS pode ter parado");
  if (negated(/desmai|perdeu a consci|n[aã]o acorda/)) return flag("emergency", "Possível desmaio/perda de consciência");
  if (negated(/caiu|queda|tombo/)) return flag("warning", "Queda relatada");
  if (negated(/confus|desorienta|alucin/)) return flag("urgent", "Confusão/alucinação relatada");
  if (negated(/engasg|engol|sufoc/)) return flag("urgent", "Dificuldade para engolir/engasgo");
  if (negated(/muito r[ií]gido|travou tudo|n[aã]o consegue andar|n[aã]o anda/)) return flag("warning", "Rigidez severa / não anda");
  if (negated(/dor no peito|falta de ar|fraqueza de um lado|n[aã]o mexe o bra[cç]o/)) return flag("emergency", "Sinais de AVC/IAM");

  return { shouldAlert: false, severity: "info", reason: "" };
}
