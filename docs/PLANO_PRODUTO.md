# Plano de Produto — Neurosint (app mobile · SaaS multi-família + médicos · 100% Supabase)

> Documento de planejamento. Define a arquitetura-alvo para transformar o template Neurosint
> (4 camadas, mono-paciente, WhatsApp) num **produto único**: um app mobile onde famílias,
> pacientes e médicos acessam, conversam com o copiloto de IA, enviam exames e acompanham a
> evolução — com isolamento por conta, segurança de dado de saúde (LGPD) e escala.
>
> **Não muda a tese clínica:** quem decide é sempre o médico. A IA organiza, cruza e prepara —
> não diagnostica, não prescreve, não reprograma. Ver [DISCLAIMER.md](../DISCLAIMER.md).

## Decisões fixadas (2026-06-27)

| Tema | Decisão |
|------|---------|
| **Interface** | App **mobile nativo** (iOS + Android) — codebase única (Expo / React Native) |
| **Escopo** | **SaaS multi-família + portal do médico** (várias contas isoladas; médico acessa pacientes que o autorizaram) |
| **Stack** | **100% Supabase** — Auth · Postgres (RLS) · Storage · Edge Functions (Deno/TS) · pg_cron · Realtime |
| **Papéis** | paciente · cuidador/família · médico · admin do sistema |

---

## 1. O que muda em relação a hoje

| Hoje (template) | Produto-alvo |
|---|---|
| Mono-paciente (`PATIENT_ID` fixo no `.env`) | Multi-tenant: cada **caso** (paciente) é um tenant isolado por RLS |
| Canal único: WhatsApp (Evolution API) | App mobile nativo (chat + upload + linha do tempo). WhatsApp vira opcional |
| API Node/Express → Cloud Run | **Edge Functions** (Deno) no Supabase |
| Exames em pasta local (`exames/`, gitignored) | **Supabase Storage** com upload, RLS e URLs assinadas |
| Sem login | **Supabase Auth** (e-mail/OTP + social), papéis e convites |
| 8 crons no Cloud Scheduler | **pg_cron** → Edge Functions |
| Segredos no GCP Secret Manager | Segredos do Supabase (env das functions) |

**Reaproveitamento alto:** o schema atual já tem `patient_id` em **todas** as tabelas
([01_create_tables.sql](../assistant/sql/01_create_tables.sql)) — multi-tenancy é
sobretudo **adicionar `case_members` + políticas RLS**, não reescrever o modelo. O pipeline
([handle.js](../assistant/src/pipeline/handle.js)) porta quase 1:1 para Deno.

---

## 2. Arquitetura-alvo

```
┌─────────────────────────────────────────────────────────────────────┐
│  APP MOBILE (Expo / React Native)  — iOS + Android                    │
│  Telas: Login · Caso/Paciente · Chat (perguntar) · Enviar exame ·     │
│         Linha do tempo · Medicação/Check-in · Alertas · Médico(read)  │
│  SDK Supabase (auth + db + storage + realtime) · expo-secure-store    │
└───────────────┬───────────────────────────────────────┬─────────────┘
                │ HTTPS (JWT do usuário)                  │ Realtime / push
                ▼                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SUPABASE (projeto = backend monolítico, região sa-east-1 / BR)       │
│                                                                       │
│  Auth ── JWT, papéis, convites                                        │
│  Postgres + RLS ── isolamento por caso (case_members)                 │
│  Storage ── buckets de exames/áudio (RLS + signed URLs)               │
│  Edge Functions (Deno) ──                                             │
│     • ask       (chat: media→contexto→conselho→tags→persist→resposta) │
│     • ingest    (exame enviado → OCR/extração → registro médico)      │
│     • cron-*    (8 rotinas: lembretes, check-in, resumo, relatório)   │
│     • notify    (push via Expo/FCM-APNs)                              │
│     • whatsapp  (opcional: webhook Evolution → mesma pipeline)        │
│  pg_cron ── dispara as cron-* nos horários (BRT)                      │
│  Realtime ── novas mensagens/alertas em tempo real no app             │
└───────────────┬───────────────────────────────────────────────────┬─┘
                │ fetch (server-side, chaves nunca no client)         │
                ▼                                                     ▼
   ┌────────────────────────┐                         ┌──────────────────────────┐
   │ Anthropic (Claude)      │  conselho/resumo/PDF    │ Storage de objetos        │
   │ OpenAI (Whisper/visão)  │  transcrição/imagem     │ (exames, áudios, laudos)  │
   │ ElevenLabs (TTS)        │  voz (opcional)         └──────────────────────────┘
   │ OpenEvidence (tool)     │  evidência científica
   └────────────────────────┘

   ┌───────────────────────────────────────────────────────────────────┐
   │ Workers fora do caminho de tempo-real (assíncronos, opcionais)      │
   │  • dbs_fusion (Python, TC+RM→eletrodos) — job pesado, sob demanda   │
   │  • Conselho fan-out (subagents Claude Code) — ferramenta de análise │
   └───────────────────────────────────────────────────────────────────┘
```

**Monolítico na prática:** *um* projeto Supabase é o backend inteiro; *um* app Expo é o
cliente. Tudo num **monorepo**, um pipeline de deploy. As peças pesadas e não-interativas
(fusão de imagem DBS, conselho fan-out de subagents) ficam como **ferramentas assíncronas/pro**,
fora do caminho crítico do app.

---

## 3. Modelo de dados multi-tenant

O **tenant é o caso (paciente)**. Uma pessoa pode gerenciar vários casos; um caso tem vários
membros (cuidadores, o paciente, médicos). Novas tabelas em cima do schema atual:

```sql
-- Perfil do usuário autenticado (1:1 com auth.users)
profiles(id PK = auth.uid, full_name, avatar_url, created_at)

-- Vínculo usuário ↔ caso, com papel (núcleo do multi-tenant + RBAC)
case_members(
  id, patient_id FK→patients, user_id FK→profiles,
  role TEXT CHECK (role IN ('owner','caregiver','patient','doctor')),
  status TEXT DEFAULT 'active',     -- active | invited | revoked
  can_write BOOLEAN,                -- médico costuma ser read-only
  created_at
)
UNIQUE(patient_id, user_id)

-- Convites por token (cuidador convida família/médico)
invitations(id, patient_id, email, role, token, expires_at, accepted_at)

-- Consentimento LGPD (sensível: dado de saúde)
consents(id, patient_id, user_id, kind, granted_at, revoked_at, text_version)

-- Trilha de auditoria (quem viu/alterou o quê)
audit_log(id, patient_id, actor_user_id, action, target_table, target_id, meta JSONB, created_at)

-- Tokens de push por dispositivo
push_tokens(id, user_id, expo_token, platform, last_seen_at)

-- Metadados de arquivo no Storage (1 registro por objeto enviado)
exam_files(id, patient_id, uploaded_by, storage_path, mime, bytes, status, record_id FK→medical_records)
```

As tabelas atuais (`assistant_patients`, `_medications`, `_symptoms`, `_medical_records`,
`_message_history`, `_alerts`, `_daily_checkins`, `_dbs_configs`, `_key_facts`,
`_weekly_summaries`, `_conversation_summaries`) **permanecem** — renomeadas sem o prefixo
`assistant_` e já scopadas por `patient_id`. `assistant_patients` vira `patients` (a raiz do
tenant; ganha `owner_id`).

### RLS — isolamento por caso

Função auxiliar + política padrão aplicada a **todas** as tabelas com `patient_id`:

```sql
-- membro ativo do caso?
CREATE FUNCTION is_member(p UUID) RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM case_members
    WHERE patient_id = p AND user_id = auth.uid() AND status = 'active');
$$;

-- pode escrever? (médico geralmente não)
CREATE FUNCTION can_write(p UUID) RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM case_members
    WHERE patient_id = p AND user_id = auth.uid() AND status='active' AND can_write);
$$;

ALTER TABLE symptoms ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel ON symptoms FOR SELECT USING (is_member(patient_id));
CREATE POLICY ins ON symptoms FOR INSERT WITH CHECK (can_write(patient_id));
-- ...repetido por tabela (gerado por migration).
```

- **Cliente** usa sempre o **JWT do usuário** (anon key) → RLS protege tudo.
- A **service_role key** existe só dentro das Edge Functions (server-side), nunca no app.
- **Admin do sistema**: claim/role separada (`app_metadata.role = 'admin'`) com políticas
  próprias ou acesso só via funções administrativas auditadas.

---

## 4. Papéis e permissões

| Papel | Pode | Não pode |
|---|---|---|
| **Cuidador/família (owner)** | criar caso, convidar membros, enviar exames, perguntar, ver tudo, receber alertas | — |
| **Cuidador (membro)** | enviar exames, perguntar, ver tudo | gerir membros do caso |
| **Paciente** | registrar sintomas/medicação, conversar, ver o próprio caso | gerir membros |
| **Médico** | **leitura** de briefings, linha do tempo, exames do(s) caso(s) que o autorizaram; anotações | escrever em dados clínicos / gerir caso |
| **Admin do sistema** | gerir contas, monitorar uso, suporte | ler conteúdo clínico sem necessidade (acesso minimizado + auditado) |

Fluxo de **compartilhamento com médico**: cuidador gera convite → médico aceita (cria conta)
→ vira `case_member(role='doctor', can_write=false)` → enxerga só aquele caso. Revogável a
qualquer momento (status='revoked'), com registro em `consents` + `audit_log`.

---

## 5. Pipeline de IA (porta para Edge Functions)

O fluxo de hoje mapeia direto; muda só a borda de entrada/saída:

| Etapa atual (Node) | No produto (Edge Function `ask`) |
|---|---|
| `normalize` (payload WhatsApp) | envelope do app (`{ patient_id, text?, file_id? }`) + auth |
| `dedup` (message_id) | idempotência por `client_msg_id` |
| `media` (Whisper/visão/PDF) | mídia vem do **Storage** (não do download WhatsApp) |
| `context` (RPCs Supabase) | igual — RPC já existe, agora scopada por `patient_id` do JWT |
| `council` (Claude + tool evidência) | **igual** (fetch para Anthropic/OpenEvidence em Deno) |
| `tags` (parse de sintomas/red-flag) | **igual** |
| `persist` (writes Supabase) | **igual** (com RLS via service_role na function) |
| `respond` (TTS → WhatsApp) | resposta **texto** ao app (+ TTS opcional como áudio anexo) |

**Streaming:** a Edge Function `ask` pode responder em *stream* (SSE) para o chat aparecer
"digitando" — boa UX. Resposta também é gravada em `messages` e o app recebe via Realtime.

**Ingestão de exame** (`ingest`): app faz upload no Storage → trigger/registro em `exam_files`
→ function extrai texto (PDF via Claude, imagem via visão, áudio via Whisper) → cria
`medical_records` com `summary`, `raw_text`, `file_url` e dispara reanálise do contexto.
Reusa [media.js](../assistant/src/pipeline/media.js) e [persist.js](../assistant/src/pipeline/persist.js).

**Limites do runtime:** Edge Functions têm teto de tempo (~150s). O **conselho single-prompt**
(claude-sonnet) cabe folgado. O **fan-out de subagents** (camada 0) e a **fusão DBS** (Python)
são pesados/demorados → ficam como **jobs assíncronos** (worker dedicado) ou recurso "pro",
acionados sob demanda e entregando resultado depois — não no caminho de tempo-real.

---

## 6. Storage de exames e arquivos

- **Buckets privados** (ex.: `exams`, `audio`), objeto sob prefixo `patient_id/...` →
  política RLS por caminho casando com `is_member()`.
- Upload direto do app via **signed upload URL** (não passa bytes pela function).
- Leitura via **signed URL** de TTL curto (minutos).
- Limites de tamanho/tipo no cliente e na function; antivírus/validação de MIME na ingestão.
- DICOM/imagens grandes (DBS) → bucket próprio; processamento pesado vai pro worker assíncrono.
- Retenção/expurgo configurável por caso (LGPD: direito de eliminação).

---

## 7. App mobile (Expo / React Native)

**Por que Expo/RN:** codebase única iOS+Android, SDK Supabase de 1ª classe (auth/db/storage/
realtime), OTA updates (corrige sem passar pela loja toda vez), e **TypeScript compartilhado**
com as Edge Functions (tipos, prompts, parsers — pacote `shared`).

Telas (v1):
1. **Onboarding/Login** — e-mail OTP/magic link + social; aceite de termos/consentimento.
2. **Meus casos** — lista de pacientes que o usuário acessa; criar novo caso.
3. **Caso (home)** — resumo, próximos lembretes, alertas ativos.
4. **Chat** — perguntar (texto/áudio), receber resposta (texto + áudio opcional), streaming.
5. **Enviar exame** — câmera/arquivo → upload → status de processamento → vira registro.
6. **Linha do tempo** — exames, consultas, sintomas, mudanças de medicação no tempo.
7. **Medicação & Check-in** — confirmar dose, check-in motor/humor (substitui os botões WhatsApp).
8. **Membros & convites** — convidar família/médico, definir papel, revogar.
9. **Visão do médico** — modo leitura: briefing, linha do tempo, exames (sem escrever).

UX/cuidado: tipografia grande e alto contraste (pacientes idosos / com tremor), entrada por
**voz** em destaque, ações de uma toque, feedback claro de "enviado/processando", funciona com
conexão ruim (fila offline para upload e mensagens).

**Push:** Expo Notifications (FCM/APNs) — lembretes de medicação, alertas red-flag, "exame
processado". Token em `push_tokens`; disparo pela function `notify`/`cron-*`.

---

## 8. Segurança & conformidade (dado de saúde / LGPD)

Dado de saúde é **dado pessoal sensível** (LGPD art. 11). Postura mínima do produto:

- **Residência de dados:** projeto Supabase na região **São Paulo (sa-east-1)**.
- **Em trânsito e em repouso:** TLS ponta a ponta; criptografia em repouso (padrão Supabase).
  Avaliar criptografia de campo para os textos mais sensíveis.
- **Isolamento:** RLS em 100% das tabelas; service_role só server-side; tokens no
  `expo-secure-store` (Keychain/Keystore), nunca em `AsyncStorage` plano.
- **Consentimento:** registro versionado em `consents` (coleta, finalidade,
  compartilhamento com médico, uso de provedores de IA). Revogável.
- **Direitos do titular:** exportar dados do caso (JSON/PDF) e **eliminar** caso/conta
  (cascata + expurgo no Storage).
- **Auditoria:** `audit_log` para acessos e alterações sensíveis (especialmente acesso do médico
  e do admin).
- **Provedores de IA = suboperadores:** enviar PHI para Anthropic/OpenAI/ElevenLabs é
  compartilhamento. Mitigações: **minimização de dado** (mandar o mínimo necessário ao prompt),
  considerar **pseudonimização** (trocar nome do paciente por id antes do LLM), usar opções de
  **no-training / retenção zero** dos provedores, e listar todos no aviso de privacidade + DPA.
- **Segredos:** só em env das Edge Functions; CI continua com o gitleaks/secret-scan já existente
  ([secret-scan.yml](../.github/workflows/secret-scan.yml)).
- **Não é dispositivo médico:** manter o disclaimer visível no app (e no onboarding).
- **Licença:** AGPL-3.0 — oferecer como serviço exige abrir o código (já é o caso).

---

## 9. Escalabilidade & custos

- **Stateless por request** (já é a filosofia atual): escala horizontal das Edge Functions é do
  Supabase. Postgres é o gargalo natural → índices por `patient_id` (vários já existem) e
  connection pooling (Supavisor).
- **Custo dominante = LLM**, não infra. Controles: limite de tokens por resposta (já há
  `COUNCIL_MAX_TOKENS`), cache de contexto, resumo incremental (já existe `maybeSummarize`),
  e *rate limiting* por usuário/caso.
- **Quotas por plano** (se houver monetização): nº de casos, exames/mês, perguntas/mês.
- **Trabalho pesado assíncrono:** ingestão de exame e fusão DBS fora do request do usuário
  (fila + worker), para não estourar o teto da function nem degradar o chat.

---

## 10. Observabilidade & operação

- **Logs estruturados** (já há [logger.js](../assistant/src/logger.js) em JSON) → logs do Supabase.
- **Métricas:** latência da `ask`, taxa de erro por provedor, custo de token por caso, alertas
  red-flag disparados, falhas de ingestão.
- **Alarmes** de erro e de custo. Health checks por function.
- **Backups** do Postgres (PITR do Supabase) + teste de restauração.
- **Feature flags** para liberar gradualmente (médico, push, TTS).

---

## 11. Estrutura do monorepo (consolidação)

```
neurosint/
├── apps/
│   └── mobile/            # Expo / React Native (o "app")
├── supabase/
│   ├── migrations/        # schema + RLS + pg_cron (fonte da verdade do banco)
│   ├── functions/         # Edge Functions Deno: ask, ingest, notify, cron-*, whatsapp
│   └── seed/              # caso fictício para dev (reaproveita exemplo-caso-ficticio/)
├── packages/
│   └── shared/            # TS: tipos do banco, prompts, parsers de tags, clients
├── workers/
│   └── dbs_fusion/        # Python pesado (atual tools/dbs_fusion) — job assíncrono
├── tools/                 # CI, scripts, gitleaks, check-pii
└── docs/                  # este plano, arquitetura, privacidade, jornada
```

Camada 0 (conselho de subagents do Claude Code) permanece como **ferramenta de análise
profunda** para o gestor do caso / médico — não some, vira o "modo pro" offline.

---

## 12. Roadmap em fases (incremental, cada fase entrega valor)

| Fase | Entrega | Núcleo técnico |
|---|---|---|
| **F0 — Fundação** | Projeto Supabase (BR), monorepo, migrations do schema atual renomeado, Auth | migrations, `profiles`, `case_members`, RLS base, seed do caso fictício |
| **F1 — Multi-tenant + RLS** | Isolamento por caso provado (testes de acesso), convites, papéis | políticas RLS em todas as tabelas, `invitations`, `consents`, `audit_log` |
| **F2 — Storage + ingestão** | Upload de exame → vira registro com resumo | buckets + signed URLs, function `ingest` (porta `media`+`persist`) |
| **F3 — Chat (ask)** | Perguntar e receber resposta no servidor | function `ask` (porta `context`+`council`+`tags`+`persist`), streaming |
| **F4 — App mobile** | App utilizável: login, casos, chat, upload, linha do tempo, medicação | Expo + telas 1–7, push básico |
| **F5 — Portal do médico** | Médico acessa caso autorizado (leitura) + briefings | tela 9, RBAC read-only, geração de briefing |
| **F6 — Rotinas + notificações** | 8 rotinas (lembrete, check-in, resumo, relatório) + push | pg_cron → `cron-*`, function `notify` |
| **F7 — Conformidade & launch** | Exportar/eliminar dados, auditoria, observabilidade, termos | LGPD hardening, métricas, alarmes, billing (opcional) |
| **F8 — Pro (opcional)** | Fusão DBS assíncrona, conselho fan-out sob demanda, WhatsApp opcional | worker assíncrono, function `whatsapp` |

Sugestão de MVP comercializável: **F0→F4** (app que loga, conversa, guarda exame e mostra a
linha do tempo, multi-família). F5–F7 endurecem para escala e venda.

### Progresso (atualizado)

- **F0/F1 — feito e testado local:** 11 migrations (`supabase/migrations/`) com schema
  multi-tenant + RLS + RPCs + grants + Storage; **pgTAP 31/31** (15 de isolamento por caso +
  16 de RPCs/Storage).
- **F3 (parcial) — feito e testado local:** Edge Function **`ask`** (Deno) + **`health`**,
  com o pipeline portado (`context`→`council`→`tags`→`persist`). Verificado: login real
  (GoTrue), resposta do conselho, red-flag → alerta, persistência e RLS (403 p/ não-membro).
- **F2 — feito e testado local:** Storage (bucket privado `exams`) com **RLS por `patient_id`**
  (ler=membro, escrever=`can_write`) + Edge Function **`ingest`** (download → extrai PDF/imagem/
  áudio via provider → cria `medical_records` → marca `exam_files`). Verificado: upload do membro
  OK, médico read-only **bloqueado** (HTTP 400/403), ingest cria o registro.
- **Novo eixo — 2 modos de execução** (ver [EXECUCAO.md](EXECUCAO.md)): a mesma base roda
  **100% local** (privacidade total, Ollama/whisper, guard `assertNoPhiEgress` + guard de `fetch`
  em runtime) ou **servidor** (nuvem), escolhidos só por ENV (toggles ortogonais + `echo` p/ demo).
- **Pendente:** F4 (app Expo), F5 (portal médico), F6 (rotinas/push), F7 (conformidade), F8 (pro).

---

## 13. Riscos & decisões em aberto

- **PHI para provedores de IA:** confirmar postura (minimização vs. pseudonimização vs. modelo
  local para os passos sensíveis). Impacta privacidade e custo.
- **Teto de tempo das Edge Functions** para análises profundas → desenhar fila/worker desde a F2.
- **Push em iOS** exige conta Apple Developer + APNs; Android via FCM. Planejar credenciais.
- **Monetização:** se houver cobrança, definir planos/quotas (afeta F7) — ou manter gratuito.
- **WhatsApp:** mantido como canal opcional (F8) ou aposentado? Hoje: opcional.
- **Migração de dados** do uso atual (se houver caso real em produção) → script de import com
  consentimento.

---

## 14. Próximos passos concretos

1. Validar este plano (ajustes nas fases/escopo).
2. **F0:** criar projeto Supabase em sa-east-1, montar o monorepo e portar o schema
   (`assistant_*` → tabelas sem prefixo + `profiles`/`case_members`) como migrations.
3. Escrever os **testes de RLS** primeiro (provam o isolamento entre casos antes de subir UI).
4. Portar a primeira Edge Function (`ingest` ou `ask`) reusando o pipeline atual.
5. Furo vertical no app: login → criar caso → enviar 1 exame → fazer 1 pergunta → ver resposta.

> Este documento é vivo. Atualize a tabela de decisões e o roadmap conforme o produto evolui.
```
