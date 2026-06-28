# Instalação — passo a passo por camada

> Comece pela Camada 0. Cada camada funciona sozinha. Use dados reais só em repositório
> **privado**. Ver [DISCLAIMER.md](../DISCLAIMER.md) e [PRIVACIDADE.md](PRIVACIDADE.md).

## Pré-requisito comum

- [Claude Code](https://claude.com/claude-code) instalado.
- `git`. (Camada 2 pede Python; Camada 4 pede Node.js 22+.)
- O **produto (preview)** — app + Supabase — pede Node.js 22+, Deno 2, Supabase CLI, Docker
  Desktop e (para o app) Expo. Ver a seção "Produto (preview)" abaixo.

---

## Camada 0 — Conselho de agentes (mínima)

1. Clone o repo e abra a pasta no Claude Code.
2. Os agentes já estão em `.claude/commands/`. Teste contra o caso fictício:
   - `/laboratorio` → tendências nos labs fictícios.
   - `/dbs` → análise da config de DBS fictícia.
   - `/medico` → orquestra os demais.
   - `/preparar-consulta` → briefing a partir da consulta fictícia.
3. Para usar com o seu familiar: `cp CLAUDE.template.md CLAUDE.md`, preencha, e crie as pastas
   de dados (`exames/`, `consultas/`, etc.) — que ficam **só na sua máquina**.

(Opcional) `cp .claude/settings.example.json .claude/settings.local.json` e ajuste permissões.

**Dois modos de invocar os especialistas:**
- **Slash commands** (`.claude/commands/`) — você digita `/neurologista`, `/dbs`, … na conversa.
- **Subagents** (`.claude/agents/`) — especialistas puros (neurologista de movimento, DBS,
  farmacologista, laboratório, diagnóstico, pesquisador de evidência) que o orquestrador (ou o
  Claude) **despacha em paralelo** via a ferramenta de agentes, cada um no seu próprio contexto.
  Devolvem achados estruturados para a síntese — sem foco em nenhuma pessoa específica.

---

## Camada 1 — Organização de exames

Siga a convenção `exames/AAAA-MM-DD_tipo/` descrita em [`../exames/README.md`](../exames/README.md).
Coloque laudos (PDF), dados brutos (DICOM) e, se quiser, um `resumo.md` por evento. Peça ao
`/laboratorio` para montar a tabela longitudinal.

---

## Camada 2 — Fusão DICOM (Python)

```bash
cd tools/dbs_fusion
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python download_mni152.py --all                     # baixa atlas públicos (ver atlas/README.md)
./run_pipeline.sh <RM_pre_op_dicom> <TC_pos_op_dicom> ../../DBS/fusion_$(date +%F)
```

Leia o `README.md` do módulo para o pipeline completo (MNI + VTA + export Lead-DBS) e as
limitações honestas.

---

## Camada 3 — MCPs de evidência

1. `cp .mcp.json.example .mcp.json` e ajuste os **caminhos** para a sua máquina.
2. Instale/builde cada servidor MCP que quiser usar (são projetos open-source separados):

| MCP | Para quê | Como instalar |
|-----|----------|---------------|
| `pubmed` | Busca PubMed | `pip install mcp-simple-pubmed` (pacote no PyPI/GitHub) |
| `medical` | Guidelines, journals, drugs, Scholar | clone `medical-mcp` (Node) → `npm install && npm run build` → `args` apontam para o `build/index.js` |
| `healthcare` | ClinicalTrials.gov, ICD-10, FDA | clone `healthcare-mcp-public` (Node) → `npm install && npm run build` → `args` para `server/index.js` |
| `exams` | Ler/parsear seus exames locais | clone `medical-exams-mcp` (Node) → `npm install && npm run build` → `args` para `build/index.js` + defina `EXAMS_BASE_PATH` |
| `paper-search` | Busca de papers acadêmicos | imagem Docker — `docker run -i --rm mcp/paper-search` |

> Os três MCPs em Node são **clonados e buildados** localmente — o `.mcp.json` aponta para o
> `index.js` **gerado** pelo build, não para o fonte. Confirme o owner/URL e o caminho de build
> exato de cada projeto na sua busca (variam de versão). `EXAMS_BASE_PATH` aponta para a pasta de
> dados do seu familiar (que fica só na sua máquina — **nunca** versione com dados reais).

3. **Carregue no Claude Code:** o `.mcp.json` da raiz é lido ao **(re)abrir** o Claude Code nesta
   pasta. Na primeira vez ele pede para **aprovar** os servidores do projeto — confirme. Use o
   comando `/mcp` para ver o estado de conexão e depurar. (Para pré-aprovar sem prompt, veja
   `enabledMcpjsonServers` / `enableAllProjectMcpServers` em `.claude/settings.local.json`.)

4. **Caveat obrigatório:** o `parse-lab-values` (MCP `exams`) **já falsificou valores**. Sempre
   confira qualquer número contra o texto bruto (`read-exam-pdf`).

---

## Camada 4 — Assistente de WhatsApp (avançada)

Requer: Supabase, uma instância da Evolution API (WhatsApp), chaves Anthropic/OpenAI/ElevenLabs,
e Cloud Run (ou Docker). **Maior risco de vazar segredo — revise antes de qualquer deploy.**

```bash
cd assistant
cp .env.example .env                                  # preencha segredos + identificadores
cp prompts/system-prompt.example.md prompts/system-prompt.md   # personalize o prompt
npm install && npm test                               # smoke (sem rede)
npm start                                             # webhook em :8080
```

Banco: rode `sql/01_create_tables.sql` e `sql/02_create_memory_tables.sql` no SQL Editor do
Supabase; crie a linha do paciente em `assistant_patients` e use o `id` como `PATIENT_ID`.

Deploy: copie e ajuste `tools/deploy-cloud-run.example.sh` e `tools/setup-cloud-scheduler.example.sh`.
Detalhes no [`../assistant/README.md`](../assistant/README.md).

---

## Produto (preview) — app + Supabase

A versão "app + servidor" (100% Supabase, multi-família) vive em `supabase/` (backend) e
`apps/mobile/` (app Expo). Roda em **dois modos**, escolhidos só por variável de ambiente: 100%
local (com guard anti-egress) ou servidor. O runbook completo — toggles de provider, a função
`ask`, ingestão de exames e a suíte de testes — é o **[`EXECUCAO.md`](EXECUCAO.md)**; aqui vão só
os pré-requisitos e o atalho.

**Pré-requisitos:** [Node.js 22+](https://nodejs.org), [Deno 2](https://deno.com),
[Supabase CLI](https://supabase.com/docs/guides/cli),
[Docker Desktop](https://www.docker.com/products/docker-desktop/) e, para o app,
[Expo](https://docs.expo.dev) (via `npx expo`).

```bash
# 1) backend local (Supabase) + Edge Functions, tudo numa origem só (http://127.0.0.1:8000)
#    Windows:       pwsh tools/local-up.ps1
#    Linux/macOS:   bash tools/local-up.sh

# 2) app mobile/web (Expo), apontando para o backend local
cd apps/mobile && npm install && npx expo start
```

Detalhes do backend e das portas (Windows/WinNAT): [`../supabase/README.md`](../supabase/README.md).

---

## Modo local (experimental)

Ver [PRIVACIDADE.md](PRIVACIDADE.md) — Ollama (raciocínio) + whisper.cpp (transcrição), com a
ressalva de que modelos locais pequenos são mais fracos no raciocínio clínico.
