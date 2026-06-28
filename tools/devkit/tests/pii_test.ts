// Testes da pseudonimização (pii.ts) — modo cloud.
import { assert, eq } from "./_assert.ts";
import { pseudonymize, rehydrate } from "../../../supabase/functions/_shared/pii.ts";

Deno.test("pseudonymize troca nome completo e primeiro nome por token", () => {
  const { text, map } = pseudonymize("João Silva caiu. João está bem.", ["João Silva"]);
  assert(!/João/.test(text), "nome removido: " + text);
  assert(/\[PESSOA_\d\]/.test(text), "token inserido");
  eq(rehydrate(text, map), "João Silva caiu. João Silva está bem.", "rehydrate restaura (1º nome → nome completo)");
});

Deno.test("pseudonymize — várias pessoas", () => {
  const { text } = pseudonymize("Maria levou João ao médico.", ["João", "Maria"]);
  assert(!/João|Maria/.test(text), "ambos removidos: " + text);
});

Deno.test("pseudonymize não pega substring (word boundary)", () => {
  const { text } = pseudonymize("Joãozinho é o apelido.", ["João"]);
  eq(text, "Joãozinho é o apelido.", "não substitui dentro de outra palavra");
});

Deno.test("pseudonymize ignora nomes vazios", () => {
  const { text } = pseudonymize("texto qualquer", ["", "  "]);
  eq(text, "texto qualquer");
});

// Regressão: prefixo compartilhado (primeiro nome cadastrado ANTES do nome composto que o contém).
// O sobrenome não pode vazar ao LLM e o rehydrate deve reproduzir o texto original sem corromper.
Deno.test("pseudonymize — prefixo compartilhado não vaza sobrenome (paciente primeiro)", () => {
  const original = "Paciente Bob. Ana avisou. Ana Paula confirmou.";
  const { text, map } = pseudonymize(original, ["Paciente Bob", "Ana", "Ana Paula"]);
  assert(!/Paula/.test(text), "sobrenome não pode vazar: " + text);
  assert(!/Ana|Bob/.test(text), "nomes redigidos: " + text);
  eq(rehydrate(text, map), original, "rehydrate reproduz o texto original sem duplicar tokens");
});

Deno.test("pseudonymize — prefixo compartilhado sem paciente", () => {
  const { text } = pseudonymize("Ana Paula é a médica. Ana ligou.", ["Ana", "Ana Paula"]);
  assert(!/Paula/.test(text), "sobrenome não pode vazar: " + text);
  assert(!/\bAna\b/.test(text), "primeiro nome redigido: " + text);
});
