# Política de Segurança

## ⚠️ NUNCA abra issue ou PR com dado real de paciente

Este projeto lida com dados de saúde. **Jamais** inclua em issues, pull requests, logs,
prints ou discussões: nomes reais, CPF, datas de nascimento, registros hospitalares,
endereços, laudos, exames, imagens DICOM, telefones, JIDs de WhatsApp ou qualquer
informação que identifique uma pessoa. Use sempre dados fictícios ou redigidos.

## Reportar uma vulnerabilidade

Se você encontrar uma vulnerabilidade de segurança (vazamento de segredo, exposição de
dados, falha de autenticação nos endpoints, etc.):

1. **Não** abra uma issue pública.
2. Use o **GitHub Security Advisories** (aba *Security* → *Report a vulnerability*) deste
   repositório, ou contate o mantenedor em privado.
3. Inclua passos de reprodução **sem** dados reais.

Faremos o possível para responder rapidamente e creditar quem reportar (se desejado).

## Se um segredo vazou

1. **Rotacione/revogue a credencial imediatamente** — depois disso ela não serve mais,
   independentemente do histórico do git.
2. Avise o mantenedor.
3. Lembre: deletar o arquivo **não** apaga o segredo do histórico do git. Por isso o
   template usa **repo novo sem histórico** e scanners de segredo (ver abaixo).

## Defesas embutidas no template

- **`.gitignore` agressivo** — bloqueia dados de saúde (`exames/`, `consultas/`, `*.dcm`,
  `*.pdf`…) e segredos (`.env`, `*secret*`, `service-account*.json`…).
- **gitleaks** — em `pre-commit` (local) e em CI (`.github/workflows/secret-scan.yml`).
- **`tools/check-pii.sh`** — varredura anti-PII (CPF, telefone, JID) em pre-commit e CI.
- **`.env.example`** — só nomes de variáveis; valores reais ficam no `.env` (gitignored).

Instale os hooks locais:

```bash
pip install pre-commit && pre-commit install
```

## Versões suportadas

Por ser um template, a recomendação é sempre usar a versão mais recente do `main`.
