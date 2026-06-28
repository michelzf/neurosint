# Execução — dois modos: 100% local e servidor

O Neurosint roda a **mesma base de código** em dois modos, escolhidos só por **variáveis de
ambiente** (nunca por fork ou branch):

| | **100% Local** | **Servidor** |
|---|---|---|
| Para quem | privacidade total; nada sai da máquina | produto/SaaS; melhor raciocínio clínico |
| Backend | `supabase start` (Docker, na sua máquina) | projeto Supabase hospedado (sa-east-1) |
| Cérebro (LLM) | Ollama (ou `echo` p/ demo) | Anthropic (Claude) |
| Transcrição | faster-whisper / whisper.cpp | OpenAI Whisper |
| Voz (opcional) | Piper / nenhuma | ElevenLabs / nenhuma |
| Egress de PHI | **nenhum** (guard recusa subir se vazar) | a provedores, com consentimento |

> Não é dispositivo médico. Não diagnostica nem prescreve — quem decide é o médico. Ver
> [DISCLAIMER.md](../DISCLAIMER.md) e [PRIVACIDADE.md](PRIVACIDADE.md).

## Toggles (ortogonais — cada dado tem destino explícito)

Definidos em `supabase/functions/.env.local` ou `.env.server` (gitignored). Modelo completo com
3 presets em [`supabase/functions/.env.example`](../supabase/functions/.env.example).

| Variável | Valores | Papel |
|---|---|---|
| `NEUROSINT_TARGET` | `local` \| `server` | só rotula o backend |
| `OFFLINE_STRICT` | `true` \| `false` | **guard**: em `true`, recusa subir se algo não for local |
| `LLM_PROVIDER` | `anthropic` \| `ollama` \| `echo` | o cérebro |
| `STT_PROVIDER` | `openai` \| `faster_whisper` \| `echo` | transcrição |
| `VISION_PROVIDER` | `openai` \| `ollama_vision` \| `none` | descrição de imagem |
| `TTS_PROVIDER` | `elevenlabs` \| `piper` \| `none` | voz (opcional) |
| `EVIDENCE_PROVIDER` | `openevidence` \| `none` | tool de evidência no conselho |

O `echo` não usa rede nem chave — é o atalho para experimentar o fluxo inteiro de graça.

## Modo 100% local

**Pré-requisitos:** Docker Desktop + [Supabase CLI](https://supabase.com/docs/guides/cli).
Para privacidade-total real (não `echo`): [Ollama](https://ollama.com) com um modelo baixado
e um servidor [faster-whisper](https://github.com/fedirz/faster-whisper-server) na porta 9000.

```bash
# Windows
pwsh tools/local-up.ps1
# Linux/macOS/Git-Bash
bash tools/local-up.sh
```

O script: `supabase start` → `db reset` (11 migrations + seed) → `test db` (pgTAP 31/31 —
15 de isolamento RLS + 16 de RPCs/Storage) → `functions serve` lendo `.env.local`. Na primeira
vez ele copia o `.env.example` (Preset A:
`echo`/offline) para `.env.local`.

**Conferir que nada vaza** (critério de aceite do modo local):

```bash
curl http://127.0.0.1:55321/functions/v1/health   # health é público
# espere: "target":"local", "egress_ok":true, e cada item de "egress" com host local
```

Com `OFFLINE_STRICT=true` há **duas camadas**: (1) no boot, se qualquer provider (ou o
`SUPABASE_URL`) não for loopback/local, a função **recusa subir** (`assertNoPhiEgress`); e (2)
em runtime, um guard embrulha o `fetch` e **bloqueia qualquer requisição a host não-local** —
cobrindo todo provider e qualquer chamada futura. Não é interceptação de pacotes de baixo nível;
é controle no nível de `fetch` da aplicação. Para a prova final: desligue a rede e repita uma
pergunta com providers locais.

> **Trade-off honesto:** modelos locais 7–32B não igualam os de fronteira em raciocínio clínico
> complexo. Bons para organizar/resumir; use com ceticismo no raciocínio diagnóstico.

## Modo servidor

**Pré-requisitos:** projeto Supabase hospedado (recomendado **sa-east-1 / São Paulo** por
LGPD) e CLI logado (`supabase login`).

```bash
cp supabase/functions/.env.example supabase/functions/.env.server   # preencha o Preset C
# Linux/macOS
PROJECT_REF=<ref> bash tools/deploy-server.sh
# Windows
$env:PROJECT_REF='<ref>'; pwsh tools/deploy-server.ps1
```

O script: `link` → `db push` (migrations no remoto) → `secrets set` (chaves no Supabase, nunca
no app) → `functions deploy ask health`. As chaves de provedor ficam só no servidor; o app
recebe apenas a `anon key`.

Recomendado no servidor: `PHI_PSEUDONYMIZE=true` (troca o nome do paciente por token antes de
enviar ao LLM e reidrata na resposta) — mitiga a transferência de PHI a terceiros.

## Chamando a função `ask`

```bash
# 1) logar (obter access_token); local usa a anon key do `supabase status`
TOKEN=$(curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"cuidador@dev.local","password":"neurosint-dev"}' | jq -r .access_token)

# 2) perguntar (patient_id = caso do seed, no modo local)
curl -s "$SUPABASE_URL/functions/v1/ask" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"patient_id":"00000000-0000-0000-0000-0000000000b1","text":"Ele acordou tremendo hoje, é normal?","client_msg_id":"demo-1"}'
```

A resposta é `{ answer, alert, meta }`. A RLS garante que o usuário só fala com casos dos quais
é membro (caso contrário, `403`).

## Enviar e processar um exame (`ingest`)

O Storage é um bucket privado `exams` com RLS por `patient_id` (a primeira pasta do caminho é o
id do caso): **ler** se membro, **escrever** se `can_write`. Fluxo (o app faz 1 e 2 com o JWT do
usuário; a RLS é o porteiro):

```bash
# 1) upload do arquivo para {patient_id}/<nome>  (RLS exige can_write)
curl -s "$SUPABASE_URL/storage/v1/object/exams/$PATIENT_ID/exame.pdf" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/pdf" --data-binary @exame.pdf

# 2) registrar o arquivo (RLS exige can_write) e pegar o id
curl -s "$SUPABASE_URL/rest/v1/exam_files" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"patient_id":"'$PATIENT_ID'","storage_path":"'$PATIENT_ID'/exame.pdf","mime":"application/pdf","status":"uploaded"}'

# 3) processar (extrai texto → cria medical_records → marca processado)
curl -s "$SUPABASE_URL/functions/v1/ingest" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"exam_file_id":"<id-do-passo-2>"}'
```

A `ingest` extrai conforme o tipo **detectado pelos bytes** (não pelo mime declarado): **PDF**→LLM,
**imagem**→Vision, **áudio**→STT, **texto**→direto (no modo local usa Ollama/whisper; com `echo`,
stubs). Resposta: `{ ok, record_id, kind, chars }`.

> **Obrigatório:** o `storage_path` precisa começar com `{patient_id}/` — um `CHECK` no banco
> (`exam_files_path_scoped`) recusa qualquer caminho fora da pasta do próprio caso, e a `ingest`
> revalida + faz claim atômico (anti-reprocessamento) + limite de 20 MiB. Isso impede que um
> membro de um caso aponte para o arquivo de outro caso (isolamento multi-tenant no Storage).

## Atalho: rodar e testar tudo local

Um harness de desenvolvimento (em [`tools/devkit/`](../tools/devkit/)) sobe tudo numa origem só
(`http://127.0.0.1:8000`) — serve um cliente web, roteia as functions em processo e proxia o
Supabase, contornando o bug do `supabase functions serve` no Windows.

```powershell
pwsh tools/local-dev.ps1     # app local em http://127.0.0.1:8000  (login: cuidador@dev.local / neurosint-dev)
pwsh tools/test-all.ps1      # TODA a suíte: unidade (Deno) + banco/RLS (pgTAP) + E2E (HTTP)
pwsh tools/test-local.ps1    # só o E2E (HTTP)
```

Teste de navegador (Playwright com o **Edge do sistema**, sem baixar browser):
`cd tools/devkit/playwright && npm install && npm test`.
Detalhes das 4 camadas de teste em [`tools/devkit/README.md`](../tools/devkit/README.md).

## Notas

- As Edge Functions **não importam pacotes externos** (usam `Deno.serve` + `fetch` puro) — evita
  o erro de certificado TLS atrás de proxy e mantém o build offline.
- `SUPABASE_URL`/chaves são injetados pelo runtime; não precisa defini-los para rodar as funções.
- No Windows, as portas locais foram remapeadas para `553xx` (faixa `543xx` é reservada pelo
  WinNAT) — ver [supabase/README.md](../supabase/README.md).
