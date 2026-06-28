# Changelog

Todas as mudanças notáveis deste projeto serão documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento semântico ([SemVer](https://semver.org/lang/pt-BR/)).

## [Não lançado] — produto (preview)

Em construção, fora do escopo da v1.0.0 (template). Disponível no repositório para acompanhar e
contribuir; ainda não é um release versionado.

- **Backend do produto** (`supabase/`): backend 100% Supabase, multi-tenant. 11 migrations com
  schema clínico + RLS por caso + RPCs + grants + Storage; **pgTAP 31/31** (15 de isolamento +
  16 de RPCs/Storage). Edge Functions (Deno) `ask` / `ingest` / `health`.
- **Dois modos de execução** (ver [docs/EXECUCAO.md](docs/EXECUCAO.md)): 100% local (Ollama/whisper,
  guard anti-egress) ou servidor (nuvem), escolhidos só por variável de ambiente.
- **App** (`apps/mobile/`): cliente Expo/React Native (preview).
- **Devkit** (`tools/devkit/`): harness de dev/teste local (Deno + Playwright).
- Plano completo: [docs/PLANO_PRODUTO.md](docs/PLANO_PRODUTO.md).

## [1.0.0] — 2026-06-28

### Release inicial

Primeira versão pública do **Neurosint**, extraída e higienizada de um sistema real de
cuidado familiar (Parkinson + DBS). **Sem nenhum dado de paciente e sem nenhuma credencial.**

#### Adicionado

- **Camada 0 — Conselho de agentes** (`.claude/commands/`): 9 skills (médico orquestrador,
  conselho neurológico, DBS, diagnóstico, laboratório, farmacologista, evidências, consulta
  rápida, preparar-consulta) + **6 subagents especialistas** (`.claude/agents/`, para fan-out
  em paralelo) + `CLAUDE.template.md` + `protocolos/` (varredura visual).
- **Caso fictício** (`exemplo-caso-ficticio/`): paciente "J. D." (Parkinson + DBS), 2 labs
  longitudinais, 1 consulta, 1 config de DBS — 100% inventado, para experimentar o fluxo.
- **Camada 1 — Organização de exames** (`exames/README.md`): convenção `AAAA-MM-DD_tipo/`.
- **Camada 2 — Fusão DICOM** (`tools/dbs_fusion/`): pipeline Python (SimpleITK) de fusão
  TC+RM, detecção de eletrodos, simulação de VTA, relatório. Atlas via download público.
- **Camada 3 — Evidência científica** (`.mcp.json.example`): integração com MCPs de PubMed,
  guidelines e leitura de exames, com caveat de validação de parser.
- **Camada 4 — Assistente WhatsApp** (`assistant/`): Node.js + Cloud Run, conselho de 6
  especialistas, 8 rotinas agendadas, TTS, registro clínico no Supabase. Nome do assistente
  configurável (`ASSISTANT_NAME`, default "Neurosint").
- **Segurança/higiene**: `.gitignore` agressivo, `.gitleaks.toml`, `pre-commit`,
  `tools/check-pii.sh`, workflow de CI de varredura de segredos.
- **Documentos**: `README.md` (PT) + `README.en.md`, `DISCLAIMER.md`, `SECURITY.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, e `docs/` (jornada, arquitetura, privacidade, instalação).

#### Notas

- Licenciado sob **AGPL-3.0-or-later**.
- Não é dispositivo médico. Não diagnostica nem prescreve. Ver `DISCLAIMER.md`.
