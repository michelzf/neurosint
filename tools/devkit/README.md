# devkit — rodar e testar TUDO local (harness de desenvolvimento)

Harness para rodar o Neurosint 100% local e testar, sem o app Expo (que é a Fase F4).
Contorna o bug do `supabase functions serve` no Windows servindo tudo numa **origem única**.

- **`server.ts`** — servidor Deno (`:8000`): serve o cliente web, roteia as Edge Functions
  (`/functions/v1/{ask,ingest,health}`) **em processo** e faz **proxy** de `/auth`, `/rest`,
  `/storage` para o Supabase local (`:55321`). Sem CORS, uma origem só.
- **`index.html`** — cliente web mínimo (login, perguntar, enviar exame, linha do tempo).
- **`e2e_test.ts`** — teste E2E (Deno, nível HTTP): login → ask (+red-flag) → upload → ingest →
  timeline + checagens de segurança (cross-tenant bloqueado, UUID). Determinístico no preset echo.
- **`playwright/`** — teste de navegador (`@playwright/test`) usando o **Edge do sistema**
  (`channel: msedge`, sem baixar browser — o download é bloqueado pelo proxy TLS desta máquina).

## Rodar o app local

```powershell
pwsh tools/local-dev.ps1     # sobe stack + db reset + dev-server em http://127.0.0.1:8000
# login dev: cuidador@dev.local / neurosint-dev
```

Para trocar o provider (echo → ollama/nuvem), copie `supabase/functions/.env.example` para
`supabase/functions/.env.local` e escolha o preset; o `local-dev.ps1` carrega automaticamente.

## Testar

Quatro camadas de teste:

| Camada | O que cobre | Como rodar |
|---|---|---|
| **Unidade** (Deno) | lógica pura: tags/red-flag, pseudonimização, isLocalHost, sniff de arquivo, providers | `deno test --allow-env tools/devkit/tests/` |
| **Banco/RLS** (pgTAP) | isolamento por caso, CHECK de caminho, RPCs (create_case, medicação) | `supabase test db` |
| **E2E** (HTTP) | fluxo inteiro contra o dev-server (login→ask→upload→ingest→timeline + segurança) | `pwsh tools/test-local.ps1` |
| **Navegador** (Playwright) | mesmo fluxo no Edge do sistema | `cd tools/devkit/playwright && npm install && npm test` |

**Tudo de uma vez (unidade + pgTAP + E2E):**

```powershell
pwsh tools/test-all.ps1
```

O Playwright fica fora do `test-all` porque precisa do `npm install` (o **pacote** instala; o
**browser** do Playwright é bloqueado pelo proxy TLS, então usamos o **Edge do sistema** via
`channel: msedge`). Roda em separado com o dev-server no ar.

> Não é produção. O app de produto é o Expo (F4) — este cliente web reaproveita os mesmos
> endpoints e serve de base/validação.
