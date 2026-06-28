# Camada 4 — Assistente de cuidado por WhatsApp (Node.js → Cloud Run)

> O nome que o assistente usa nas conversas é configurável — `ASSISTANT_NAME`, default **"Neurosint"**.
>
> ⚠️ A camada de MAIOR fricção e MAIOR risco de vazar segredo. Exige Supabase + Evolution
> API (WhatsApp) + chaves (Anthropic/OpenAI/ElevenLabs) + Cloud Run/Docker. **Revisão humana
> obrigatória antes de qualquer deploy/commit.** Não é dispositivo médico — ver `DISCLAIMER.md`.

## O que faz

- **Conversa** (webhook): a família manda texto/áudio/imagem/PDF no grupo do WhatsApp →
  transcreve/interpreta → monta o contexto clínico do Supabase → **conselho de 6 especialistas**
  (6 personas dentro de **um único** prompt `claude-sonnet` + tool de evidência opcional — não é o
  fan-out de subagents reais da Camada 0) → registra sintomas/medicação/alertas →
  responde em **áudio** (TTS). Red-flags (febre, queda, DBS parado…) disparam alerta.
- **8 rotinas agendadas**: check-in diário, lembrete de medicação, check-in matinal (áudio),
  check-in do cuidador, lembrete de bateria do DBS, lembrete de troca de programa do DBS,
  resumo semanal (texto) e relatório semanal duplo (áudio + PDF clínico).

## Estrutura

```
assistant/
├── src/
│   ├── config.example.js   # configuração (copie p/ config.js; tudo env-driven)
│   ├── config.js           # reexport seguro de config.example (versionado)
│   ├── secrets.js          # env-first + fallback GCP Secret Manager
│   ├── logger.js  util.js  # log JSON; tempo BRT, expandForTTS, chunkText
│   ├── clients/            # supabase, evolution, anthropic, openai, elevenlabs, openevidence
│   ├── pipeline/           # normalize→dedup→media→context→council→tags→persist→respond (+button, handle)
│   ├── schedules/          # 8 jobs + index (crons em BRT)
│   ├── server.js           # Express: /webhook/evolution, /cron/:job, /health
│   └── scheduler.js        # node-cron interno (VM/local)
├── prompts/system-prompt.example.md  # template do prompt do conselho (copie p/ system-prompt.md)
├── sql/                    # schema Supabase (rode no SQL Editor)
├── tools/                  # deploy + cloud scheduler (*.example.sh)
└── test/smoke.test.js      # smoke sem rede
```

## Rodar local

```bash
cp .env.example .env                     # preencha os segredos e identificadores
cp prompts/system-prompt.example.md prompts/system-prompt.md   # e personalize o prompt
# config.js já vem pronto e lê tudo do .env; só copie o exemplo por cima p/ editar defaults
# (opcional) não-secretos no código (MEDICATIONS, horários, ASSISTANT_NAME):
#            cp src/config.example.js src/config.js
npm install
npm test                                 # smoke (sem rede) — deve passar out of the box
npm start                                # webhook em :8080
# cron interno opcional: ENABLE_INTERNAL_CRON=true npm start
```

## Banco (Supabase)

Rode os scripts de `sql/` no SQL Editor do seu projeto Supabase (tabelas + RPCs com prefixo
`assistant_`). Crie uma linha em `assistant_patients` com os dados do paciente e use o `id` (UUID)
como `PATIENT_ID` no `.env`.

## Deploy (Cloud Run + Cloud Scheduler)

```bash
cp tools/deploy-cloud-run.example.sh      tools/deploy-cloud-run.sh
cp tools/setup-cloud-scheduler.example.sh tools/setup-cloud-scheduler.sh
# ajuste e rode num gcloud nativo (Cloud Shell é o caminho mais simples):
PROJECT=<seu-projeto> REGION=us-central1 GSM_PREFIX="neurosint--" bash tools/deploy-cloud-run.sh
PROJECT=<seu-projeto> REGION=us-central1 SERVICE_URL=<url> bash tools/setup-cloud-scheduler.sh
```

Os segredos ficam no Secret Manager; o serviço os referencia em runtime (nunca no código).

## Segredos esperados (no Secret Manager / `.env`)

`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (áudio/imagem), `ELEVENLABS_API_KEY` (voz),
`SUPABASE_SERVICE_KEY`, `EVOLUTION_API_KEY`, `OPENEVIDENCE_API_KEY` (opcional),
`CRON_SECRET` (protege `/cron/*`).

## Notas de design

- **Stateless**: o Supabase é a fonte da verdade (Cloud Run não guarda estado entre requests).
- **Chamadas diretas** aos provedores (sem proxy, sem Redis).
- **Não substitui avaliação médica.** Toda análise deve ser validada pelos médicos responsáveis.
