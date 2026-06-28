# `packages/shared/` — código TypeScript compartilhado

Placeholder. Pacote de código comum entre o app ([`apps/mobile`](../../apps/mobile/)) e as
Edge Functions (`supabase/functions/`):

- **Tipos do banco** (gerados via `supabase gen types typescript`).
- **Prompts** do conselho (portados de [`assistant/prompts/`](../../assistant/prompts/)).
- **Parsers de tags** e utilitários (portados de [`assistant/src/pipeline/tags.js`](../../assistant/src/pipeline/tags.js)).

Entra em uso a partir da Fase F2/F3 do [plano de produto](../../docs/PLANO_PRODUTO.md).
