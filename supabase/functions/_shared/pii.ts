// pii.ts — pseudonimização leve para o modo CLOUD (PHI_PSEUDONYMIZE=true): troca NOMES PRÓPRIOS
// conhecidos do caso (paciente + remetentes) por tokens ANTES de enviar ao provedor de IA e
// reidrata na resposta.
//
// ESCOPO (seja honesto): MITIGA, não elimina. NÃO higieniza:
//   - texto livre que cite nomes não cadastrados (conteúdo de mensagens, notas, resumos);
//   - dados clínicos re-identificáveis (idade exata, diagnóstico, doses, parâmetros de DBS, datas);
//   - mídia bruta enviada a STT/Vision cloud (áudio/imagem) — sem redação possível.
// Para privacidade real, use o modo 100% local (OFFLINE_STRICT). No modo local isto nem roda.

export interface PiiMap {
  toToken: Map<string, string>;
  toName: Map<string, string>;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Substitui nomes (e seus primeiros nomes) por tokens [PESSOA_n]. */
export function pseudonymize(text: string, names: string[]): { text: string; map: PiiMap } {
  const map: PiiMap = { toToken: new Map(), toName: new Map() };
  let out = text;
  let n = 0;
  const seen = new Set<string>();
  // 1) Coleta TODOS os alvos (nome completo + primeiro nome de cada pessoa), associando cada um
  //    ao token da sua pessoa. Token é alocado uma vez por nome completo, na ordem de inserção.
  const targets: { name: string; token: string }[] = [];
  for (const full of names) {
    if (!full) continue;
    const token = map.toToken.get(full.toLowerCase()) ?? `[PESSOA_${++n}]`;
    map.toToken.set(full.toLowerCase(), token);
    map.toName.set(token, full);
    // o nome completo e o primeiro nome viram alvos
    const parts = [full, full.split(/\s+/)[0]].filter((p) => p && p.length >= 2);
    for (const name of parts) {
      const lower = name.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      targets.push({ name, token });
    }
  }
  // 2) Aplica do mais LONGO para o mais CURTO: assim um nome composto ("Ana Paula") é redigido
  //    antes do primeiro nome que o contém ("Ana"), evitando sobrenome órfão vazando ao LLM.
  targets.sort((a, b) => b.name.length - a.name.length);
  for (const { name, token } of targets) {
    out = out.replace(new RegExp(`\\b${escapeRegex(name)}\\b`, "gi"), token);
  }
  return { text: out, map };
}

/** Reidrata os tokens de volta para os nomes reais na resposta. */
export function rehydrate(text: string, map: PiiMap): string {
  let out = text;
  for (const [token, name] of map.toName) {
    out = out.replaceAll(token, name);
  }
  return out;
}
