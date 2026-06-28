// evidence/openevidence.ts — tool de evidência científica CLOUD. Porte de openevidence.js.
// A pergunta deve ir em INGLÊS. Degrada gracioso (string) em qualquer falha.
import { cfg } from "../../config.ts";
import { type Evidence } from "../types.ts";

async function analysis(questionEnglish: string): Promise<string> {
  if (!cfg.openevidenceKey) return "Evidência científica indisponível no momento.";
  try {
    const res = await fetch("https://api.openevidence.com/analysis", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.openevidenceKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ text: questionEnglish, model: cfg.openevidenceModel }),
    });
    const text = await res.text();
    if (!res.ok) return `Evidência indisponível (status ${res.status}).`;
    return text;
  } catch (e) {
    return `Evidência indisponível (${(e as Error).message.slice(0, 80)}).`;
  }
}

export const openevidence: Evidence = { analysis };
