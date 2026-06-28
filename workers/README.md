# `workers/` — jobs assíncronos pesados (fora do caminho de tempo-real) · Fase F8

Placeholder. Trabalho que **não cabe** no teto de tempo das Edge Functions e não deve
bloquear o chat:

- **`dbs_fusion/`** — pipeline Python de fusão TC+RM → eletrodos (hoje em
  [`tools/dbs_fusion/`](../tools/dbs_fusion/)). Vira um job sob demanda que lê do Storage,
  processa e grava o relatório de volta.
- **Conselho fan-out** (subagents do Claude Code) — análise profunda como "modo pro".

Acionados por fila/agendamento, entregam o resultado de forma assíncrona. Detalhes na Fase F8
do [plano de produto](../docs/PLANO_PRODUTO.md).
