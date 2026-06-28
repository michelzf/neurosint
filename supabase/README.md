# `supabase/` — backend do produto Neurosint (Fase F0)

Backend **100% Supabase** do produto: Postgres + RLS (multi-tenant), Auth, Storage e
(nas próximas fases) Edge Functions. Esta pasta é a **fonte da verdade do banco**.

> Substitui o esquema mono-paciente de [`assistant/sql/`](../assistant/sql/) (que fica como
> referência do template WhatsApp). Aqui as tabelas perdem o prefixo `assistant_` e ganham
> **isolamento por caso (tenant) via RLS**. Plano completo em [`docs/PLANO_PRODUTO.md`](../docs/PLANO_PRODUTO.md).

## Estrutura

```
supabase/
├── migrations/                             # 11 migrations (ordem por timestamp)
│   ├── 20260627000100_core_clinical.sql    # paciente (raiz do tenant) + tabelas clínicas
│   ├── 20260627000200_memory.sql           # resumos de conversa (memória longa)
│   ├── 20260627000300_tenancy.sql          # profiles, case_members, convites, consentimento, auditoria, push, exam_files
│   ├── 20260627000400_rls.sql              # funções is_member/can_write/is_owner + RLS em TODAS as tabelas
│   ├── 20260627000500_rpcs.sql             # RPCs portados (contexto, resumo, medicação) — scopados por RLS
│   ├── 20260627000600_grants.sql           # GRANTs na Data API (tabela nova não é exposta automaticamente)
│   ├── 20260627000700_confirm_medication_guard.sql  # recusa logar dose sem medicação correspondente
│   ├── 20260627000800_storage.sql          # bucket privado `exams` + policies de Storage por caso
│   ├── 20260627000900_examfiles_path_check.sql      # CHECK: storage_path tem de começar com {patient_id}/
│   ├── 20260627001000_create_case_definer.sql       # RPC para criar caso (SECURITY DEFINER)
│   └── 20260627001100_accept_invitation_email_bind.sql  # amarra aceite de convite ao e-mail convidado
├── functions/                              # Edge Functions (Deno) — backend de runtime
│   ├── _shared/                            #   config, guard(assertNoPhiEgress), supabase, logger, pii
│   │   ├── providers/                      #   abstração llm/stt/tts/vision/evidence (cloud|local|echo)
│   │   └── pipeline/                       #   context, council, tags, persist + prompts
│   ├── ask/                                #   chat: auth→contexto(RLS)→conselho→persist
│   ├── ingest/                             #   exame: download Storage→extrai→medical_records
│   ├── health/                             #   reporta modo/egress (público)
│   └── .env.example                        #   presets: A=echo/offline, B=local-privado, C=server
├── seed.sql                                # caso 100% fictício + usuários dev (login local)
├── tests/
│   ├── 0001_rls_isolation.test.sql         # pgTAP: prova que um caso não vê o outro (15 testes)
│   └── 0002_rpcs_and_storage.test.sql      # pgTAP: RPCs, constraints e Storage (16 testes)
├── config.toml                             # portas 553xx (Windows/WinNAT); verify_jwt por função
└── README.md
```

> **Dois modos de execução** (100% local vs servidor) e como chamar a função `ask`:
> ver [`docs/EXECUCAO.md`](../docs/EXECUCAO.md).

## Modelo multi-tenant (resumo)

- **Tenant = caso (paciente).** Toda tabela clínica tem `patient_id`.
- `case_members(patient_id, user_id, role, can_write)` liga usuários autenticados a um caso.
  Papéis: `owner`, `caregiver`, `patient`, `doctor` (médico entra com `can_write = false`).
- RLS padrão por tabela: **ler** se `is_member(patient_id)`, **escrever** se `can_write(patient_id)`.
- O app usa sempre o **JWT do usuário** (a `anon key`) → RLS protege tudo.
  A `service_role` só existe dentro das Edge Functions (server-side), nunca no cliente.

## Como rodar localmente

Pré-requisito: [Supabase CLI](https://supabase.com/docs/guides/cli) e Docker.

```bash
# 1) inicializa o projeto local (gera config.toml na primeira vez)
supabase init        # só na primeira vez; responda 'N' para não sobrescrever migrations

# 2) sobe o stack local e aplica migrations + seed
supabase start
supabase db reset    # aplica migrations/ na ordem + roda seed.sql

# 3) roda os testes de isolamento RLS (pgTAP)
supabase test db
```

## Como aplicar num projeto remoto (quando for a hora)

> ⚠️ Criar projeto remoto tem custo e é decisão sua. Região recomendada: **São Paulo
> (`sa-east-1`)** por LGPD/residência de dados.

```bash
supabase link --project-ref <ref-do-projeto>
supabase db push        # aplica as migrations pendentes no remoto
```

## Status da validação (local)

Validado em Postgres 17 local: as 11 migrations + seed aplicam limpo e o pgTAP passa **31/31**
(15 de isolamento RLS + 16 de RPCs/Storage, via `supabase test db`). Os papéis da Data API
recebem `GRANT` na migration `…600_grants.sql`
(no padrão novo do Supabase, tabela nova NÃO é exposta automaticamente — a RLS filtra linhas,
mas o privilégio de tabela precisa ser concedido).

## Notas

- **Windows — portas:** as portas padrão `543xx` caem em faixas reservadas pelo Windows/WinNAT
  (veja `netsh interface ipv4 show excludedportrange protocol=tcp`), o que faz o `supabase start`
  falhar com *"bind: forbidden by its access permissions"*. Por isso o `config.toml` usa o bloco
  livre `553xx` (DB em `127.0.0.1:55322`, API em `:55321`). Em Linux/macOS isso não é necessário.
- O warning `failed to cache migrations catalog … @supabase/pg-delta … invalid peer certificate`
  no `start`/`db reset` é só o motor de diff tentando baixar do npm atrás de um proxy de TLS —
  **não afeta** as migrations nem o banco.
- `gen_random_uuid()` é nativo (PG 13+); não dependemos de pgcrypto para os tokens.
- As funções auxiliares de RLS são `SECURITY DEFINER` de propósito: assim consultam
  `case_members` **sem** disparar a própria RLS (evita recursão infinita na política).
- Os RPCs de leitura/escrita são `SECURITY INVOKER` (padrão): rodam sob a RLS de quem chama,
  então um usuário só enxerga/edita casos dos quais é membro.
