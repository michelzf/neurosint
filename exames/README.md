# Camada 1 — Organização de exames em texto pesquisável

> ⚠️ **Esta pasta é para os exames do SEU familiar — que ficam SÓ na sua máquina.**
> O `.gitignore` da raiz ignora todo o conteúdo de `exames/` (exceto este README e o
> `.gitkeep`). Trabalhe num repositório **privado**. Nunca commite laudo, DICOM ou PDF
> de um ente querido num repo público.

A ideia desta camada é simples e poderosa: **um esquema de pastas previsível** transforma
uma pilha de PDFs e CDs de exame numa base que os agentes de IA (Camada 0) conseguem
navegar, cruzar no tempo e analisar.

## Convenção de nomenclatura

Uma pasta por evento de coleta/exame, no formato:

```
exames/AAAA-MM-DD_tipo[_origem]/
```

- **`AAAA-MM-DD`** — data da coleta/exame (ordena cronologicamente sozinho).
- **`tipo`** — `laboratorio`, `RM_cranio`, `TC_cranio`, `coprologico`, `urina`,
  `cintilografia`, `polissonografia`, `radiografia`, `ecocardiograma`, etc.
- **`_origem`** (opcional) — laboratório/hospital, p/ desambiguar (`_Dasa`, `_HC`).

### Exemplos

```
exames/
├── 2021-03-10_laboratorio/
├── 2021-08-24_RM_planejamento_DBS/
├── 2022-09-13_coprologico/
├── 2023-01-07_urina_cultura/
└── 2023-04-13_TC_cranio_volumetrica/
    ├── DICOM/                 # série DICOM original (do CD)
    ├── jpeg/                  # cortes exportados (para o Read abrir visualmente)
    └── laudo.pdf              # laudo do radiologista
```

## O que colocar em cada pasta

- O **laudo** (PDF ou foto).
- Os **dados brutos** quando houver (série DICOM de RM/TC, export do programador de DBS).
- Opcional: um `resumo.md` que você (ou o agente) escreve destacando os valores-chave.

## Dica: tabela longitudinal

O maior ganho clínico vem de **cruzar o mesmo marcador ao longo dos anos**. Mantenha (ou
peça ao skill `/laboratorio` para gerar) uma tabela longitudinal — um marcador por linha,
uma coleta por coluna. Veja um exemplo fictício pronto em
[`../exemplo-caso-ficticio/exames/`](../exemplo-caso-ficticio/exames/), com dois pontos no
tempo (03/2024 e 09/2025) que demonstram a detecção de tendências.

## Como os agentes leem isto

- Direto, com o tool `Read` (PDF, imagem, texto).
- Ou via **MCP `exams`** (Camada 3) — esta é a lista canônica das ferramentas; cada agente usa
  o subconjunto que faz sentido para o seu papel: `list-exams`, `exam-timeline`, `read-exam-pdf`,
  `read-exam-text`, `parse-lab-values`, `compare-lab-values`, `view-medical-image`,
  `read-dicom-series`, `read-dicom-metadata`.

> ⚠️ Valores extraídos automaticamente por `parse-lab-values` **devem ser conferidos
> contra o texto bruto** do laudo — parsers de PDF erram. Honestidade técnica acima de tudo.
