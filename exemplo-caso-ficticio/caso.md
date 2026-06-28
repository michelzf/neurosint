# Caso fictício — Resumo do paciente

> ⚠️ **FICTÍCIO.** Dados inventados para demonstração. Ver `LEIA-ME_CASO_FICTICIO.md`.

## Identificação (inventada)

- **Nome:** Paciente Exemplo (referido como "J. D." nos exemplos)
- **Nascimento:** 12/02/1958 (67 anos)
- **Sexo:** Masculino
- **CPF:** (omitido — no exemplo não usamos nenhum identificador, real ou no formato real)
- **Cuidador(a):** filha "A." (gestora da saúde no exemplo)

## Diagnóstico

**Doença de Parkinson idiopática.**
- Início dos sintomas: ~2016 (tremor de repouso em mão direita).
- Tempo de doença: ~9 anos.
- **DBS bilateral do núcleo subtalâmico (STN)** implantado em **03/2019**.
- Lado mais afetado no início: direito (sintomas iniciaram à direita do corpo → STN esquerdo).

## Medicações atuais

| Medicação | Dose | Horários | Notas |
|-----------|------|----------|-------|
| Levodopa/carbidopa 100/25 | 1 cp | 07:00, 11:00, 15:00, 19:00 | 30 min antes das refeições |
| Pramipexol ER | 1,5 mg | 08:00 | Agonista dopaminérgico |
| Amantadina | 100 mg | 08:00, 14:00 | Para discinesia de pico de dose |
| Rasagilina | 1 mg | 08:00 | IMAO-B |

**LEDD estimado (fictício):** ~720 mg/dia.

## Queixas atuais (nov/2025)

- *Wearing-off* leve: rigidez retorna ~30 min antes da próxima dose de levodopa.
- Discinesia leve no pico da dose (movimentos involuntários discretos de tronco).
- Constipação crônica.
- Sono fragmentado, acorda 2–3x/noite.
- Cuidadora nota leve lentificação cognitiva nas últimas semanas.

## Hipóteses a explorar (deixadas em aberto para os agentes)

1. Ajuste fino de DBS + fracionamento de levodopa para reduzir *wearing-off*.
2. Vitamina B12 baixa-normal + homocisteína elevada → impacto cognitivo/neuropático?
3. Pré-diabetes emergente (glicose/HbA1c subindo).
4. Insuficiência de vitamina D.

## Estrutura de dados deste caso

- Exames laboratoriais: `exames/` (dois pontos no tempo, para análise longitudinal).
- Consulta: `consultas/2025-11-18_consulta_neurologista.md`.
- DBS: `dbs/configuracao_dbs.md`.
