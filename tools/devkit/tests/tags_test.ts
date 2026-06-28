// Testes da lógica determinística de tags/red-flags (porte de assistant/src/pipeline/tags.js).
import { assert, eq } from "./_assert.ts";
import { detectConfirmation, detectRedFlag, keywordSymptom, parseTags, strip } from "../../../supabase/functions/_shared/pipeline/tags.ts";

Deno.test("parseTags — [REGISTRO]", () => {
  const p = parseTags("Texto. [REGISTRO: tipo=tremor, severidade=severo]");
  eq(p.symptoms.length, 1, "1 sintoma");
  eq(p.symptoms[0].type, "tremor");
  eq(p.symptoms[0].severity, "severo");
});

Deno.test("parseTags — [MUDANCA] gera mudança + fato-chave", () => {
  const p = parseTags("[MUDANCA: medicacao=Prolopa, nova_dose=250mg, novo_horario=8h]");
  eq(p.medicationChanges.length, 1);
  eq(p.medicationChanges[0].medicacao, "Prolopa");
  eq(p.medicationChanges[0].nova_dose, "250mg");
  assert(p.keyFacts.length === 1 && p.keyFacts[0].category === "medicacao", "fato-chave de medicação");
});

Deno.test("parseTags — [MEDICACAO]", () => {
  const p = parseTags("[MEDICACAO: nome=Levodopa, status=tomado]");
  assert(p.medicationConfirm, "confirmação");
  eq(p.medicationConfirm!.med_name, "Levodopa");
});

Deno.test("strip remove todas as tags", () => {
  const out = strip("Bom dia. [REGISTRO: tipo=tremor] [MEDICACAO: nome=x]");
  assert(!out.includes("["), "sem colchetes restantes: " + out);
  assert(out.startsWith("Bom dia"), "mantém o texto");
});

Deno.test("keywordSymptom — severidade por intensidade", () => {
  eq(keywordSymptom("ele estava tremendo muito")!.type, "tremor");
  eq(keywordSymptom("ele estava tremendo muito")!.severity, "severo");
  eq(keywordSymptom("ele caiu hoje")!.type, "queda");
  eq(keywordSymptom("conversa normal sem sintoma"), null);
});

Deno.test("detectConfirmation — só com medicação real", () => {
  eq(detectConfirmation("ele já tomou levodopa", ["Levodopa"])!.med_name, "Levodopa");
  eq(detectConfirmation("ele tomou o remédio", []), null, "sem lista de meds → null");
  eq(detectConfirmation("bom dia, tudo certo", ["Levodopa"]), null, "sem frase de confirmação → null");
});

Deno.test("detectRedFlag — gatilhos e negação", () => {
  eq(detectRedFlag("ele está com febre agora").severity, "urgent");
  eq(detectRedFlag("não teve febre hoje").shouldAlert, false, "negação não dispara");
  eq(detectRedFlag("o DBS parou sozinho").severity, "emergency");
  eq(detectRedFlag("ele caiu da cama").severity, "warning");
  eq(detectRedFlag("dia tranquilo, tudo bem").shouldAlert, false);
});

Deno.test("detectRedFlag — negação ligada à oração, não janela cega", () => {
  // Negação de OUTRA oração não pode suprimir uma emergência real.
  eq(detectRedFlag("ele não quis comer e desmaiou na cama").severity, "emergency", "desmaio não é negado por 'não quis comer'");
  eq(detectRedFlag("ele não quis comer e desmaiou na cama").shouldAlert, true);
  // Negação antes de vírgula/conjunção não engole o sintoma urgente seguinte.
  eq(detectRedFlag("estava sem apetite, mas teve febre de 39 graus").shouldAlert, true, "febre não é negada por 'sem apetite'");
  // "febre" negada corretamente, mas "caiu" é evento separado e real → alerta de queda.
  assert(/queda/i.test(detectRedFlag("não tinha febre mas caiu da escada").reason), "queda detectada apesar de 'não tinha febre'");
  // Negação adjacente ao gatilho continua suprimindo (regressão).
  eq(detectRedFlag("não teve febre hoje").shouldAlert, false, "negação adjacente ainda suprime");
});

Deno.test("detectRedFlag — 1ª ocorrência negada não suprime 2ª real do MESMO gatilho", () => {
  // Mesma palavra-gatilho duas vezes: a 1ª negada, a 2ª real → tem de disparar.
  eq(detectRedFlag("ele não caiu ontem, mas caiu hoje e se machucou").severity, "warning", "queda real de hoje dispara");
  eq(detectRedFlag("ele não caiu ontem, mas caiu hoje e se machucou").shouldAlert, true);
  eq(detectRedFlag("não teve febre de manhã, mas teve febre de 39 graus à noite").severity, "urgent", "febre real da noite dispara");
  eq(detectRedFlag("ele não desmaiou na consulta, depois desmaiou em casa").severity, "emergency", "desmaio real em casa dispara");
  // Regressões: negação única (todas as ocorrências negadas) continua suprimindo.
  eq(detectRedFlag("não teve febre hoje").shouldAlert, false, "única ocorrência negada não dispara");
  assert(/queda/i.test(detectRedFlag("não tinha febre mas caiu da escada").reason), "caso do loop 1 ainda detecta queda");
});
