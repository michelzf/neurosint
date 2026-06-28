# Arquitetura — as 4 camadas

O Neurosint é modular: cada camada agrega valor sozinha e a fricção de instalação cresce
conforme você desce. Comece pela Camada 0.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  VOCÊ (gestor do caso) + o MÉDICO RESPONSÁVEL (decide tudo)                │
└──────────────────────────────────────────────────────────────────────────┘
                │                                            ▲
                ▼                                            │ briefings, relatórios,
┌──────────────────────────────────────────────┐            │ perguntas embasadas
│  CAMADA 0 — Conselho de agentes (Claude Code) │────────────┘
│  9 skills em .claude/commands/                │
│  médico · neurologista · dbs · diagnóstico ·  │
│  laboratório · farmacologista · evidência ·   │
│  consulta · preparar-consulta                 │
└───────┬───────────────┬───────────────┬───────┘
        │ lê            │ usa            │ consulta
        ▼               ▼                ▼
┌───────────────┐ ┌──────────────┐ ┌──────────────────┐
│ CAMADA 1      │ │ CAMADA 2     │ │ CAMADA 3         │
│ exames/       │ │ dbs_fusion   │ │ MCPs de evidência│
│ (convenção +  │ │ (TC+RM →     │ │ (pubmed, exames, │
│  texto)       │ │  eletrodos)  │ │  guidelines…)    │
└───────────────┘ └──────────────┘ └──────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  CAMADA 4 — Assistente de WhatsApp (Node.js → Cloud Run)  [opcional]      │
│  webhook → transcreve → monta contexto (Supabase) → conselho de 6         │
│  especialistas → registra sintomas/medicação/alertas → responde em áudio  │
│  + 8 rotinas agendadas (lembretes, check-ins, resumo e relatório semanal) │
└──────────────────────────────────────────────────────────────────────────┘
```

## Camada 0 — o cérebro

Nove agentes (slash commands do Claude Code) que leem os dados do repositório, raciocinam com
metodologia clínica (escalas, critérios, LEDD) e produzem análises e briefings. **Só precisam
do Claude Code.** O agente orquestrador (`/medico`) conecta os achados entre sistemas e prioriza
o que é acionável. Protocolo obrigatório: **varredura visual das imagens antes de analisar texto**
(`protocolos/00_varredura_visual_inicial.md`).

Os mesmos especialistas também existem como **subagents** em `.claude/agents/` (especialistas
puros, sem foco em pessoa): o orquestrador pode **despachá-los em paralelo** (cada um no seu
contexto) e sintetizar os achados — o padrão "conselho" em fan-out.

## Camada 1 — organização

Uma convenção simples de pastas (`exames/AAAA-MM-DD_tipo/`) transforma uma pilha de PDFs numa
base navegável e cruzável no tempo. Os dados reais ficam **só na sua máquina** (gitignored).

## Camada 2 — imagem

Pipeline Python (SimpleITK) que funde TC pós-operatória com RM pré-operatória, detecta os
eletrodos, mede assimetrias, simula o volume de tecido ativado (VTA) e gera relatório. Triagem
reprodutível — **não substitui** Lead-DBS/Brainlab/Guide XT nem o laudo médico.

## Camada 3 — evidência

Servidores MCP que dão aos agentes acesso a PubMed, guidelines, e leitura estruturada de exames.
**Caveat:** o parser de exames já falsificou valores — sempre confira contra o texto bruto.

## Camada 4 — presença diária

O assistente de WhatsApp leva o sistema para o dia a dia da família: registra remédio, sintomas
e marcha, alerta diante de sinais vermelhos, e gera resumo (áudio) + relatório clínico (PDF)
semanais. Stateless, com o Supabase como fonte da verdade. É a camada de maior fricção e maior
risco de vazar segredo — revisão humana obrigatória antes de deploy.

## Fluxo de dados (Camada 4)

```
WhatsApp ──webhook──▶ normalize → dedup → mídia(transcrição/visão)
   ▲                      │
   │ áudio (TTS)          ▼
   │                 contexto (Supabase: paciente, resumo, histórico, exames)
   │                      │
   │                      ▼
   └── respond ◀── tags/persist ◀── conselho (claude-sonnet + tool de evidência)
                                          │
                                   red-flag? → alerta ao responsável
```
