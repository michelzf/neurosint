# Contribuindo com o Neurosint

Obrigado por querer ajudar! Este projeto nasceu de uma necessidade real: reduzir a
distância entre os dados de saúde de quem amamos e a decisão médica. Contribuições que
tornem o template mais útil, mais seguro e mais honesto são muito bem-vindas.

## ⚠️ Regra de ouro: zero dado real

**Nunca** envie em issues, PRs, commits, logs ou prints qualquer dado de paciente real
(nomes, CPF, datas, laudos, exames, imagens, telefones, JIDs). Use sempre o
`exemplo-caso-ficticio/` ou dados claramente fictícios. Veja `SECURITY.md`.

## Antes de abrir um PR

1. Instale os hooks de segurança: `pip install pre-commit && pre-commit install`.
2. Rode os testes do módulo que tocou (ex.: `cd assistant && npm test`).
3. Confirme que **gitleaks** e `tools/check-pii.sh` passam (rodam no pre-commit e na CI).
4. Mantenha a documentação em **PT-BR** (idioma principal); resumos em EN são bem-vindos.

## Princípios do projeto (não negociáveis)

- **Não é dispositivo médico.** Nada que o projeto faça pode soar como diagnóstico,
  prescrição ou substituto do médico. Mantenha os disclaimers.
- **Honestidade técnica.** Documente limitações reais (a IA alucina; parsers erram;
  modelos locais são mais fracos). Não venda capacidade que não existe.
- **Privacidade primeiro.** Toda mudança deve preservar (ou reforçar) as defesas anti-PII
  e anti-segredo. Nada de telemetria silenciosa.

## Tipos de contribuição valiosos

- Melhorar a metodologia dos agentes (Camada 0) sem acoplar a um caso específico.
- Tornar o módulo do assistente (Camada 4) mais portável (outros idiomas, outros provedores).
- Suporte a outros sistemas de DBS / outras condições neurológicas.
- Traduções, exemplos fictícios adicionais, melhorias de documentação.
- Modo local (Ollama / whisper.cpp) — ainda experimental.

## Fluxo

1. Abra uma issue descrevendo a proposta (sem dado real).
2. Faça um fork e um branch descritivo.
3. Commits pequenos e claros; mensagens em PT ou EN.
4. Abra o PR referenciando a issue. Descreva o que mudou e por quê.

## Código de conduta

Ao participar, você concorda com o `CODE_OF_CONDUCT.md`.
