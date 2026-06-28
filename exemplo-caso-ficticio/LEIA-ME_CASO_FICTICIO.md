# ⚠️ CASO 100% FICTÍCIO — NÃO É UMA PESSOA REAL

**Tudo nesta pasta é INVENTADO** para demonstrar como o Neurosint funciona.
Nomes, datas, CPF, exames, valores laboratoriais, configuração de DBS e falas de
consulta **não correspondem a nenhuma pessoa real** e **não têm validade clínica**.

O objetivo é único: permitir que você rode o conselho de agentes de IA e veja o
fluxo completo (análise laboratorial longitudinal, revisão de DBS, farmacologia,
diagnóstico diferencial, preparação de consulta) **sem precisar inserir dados
reais de um ente querido** logo de cara.

## Como usar

1. Tenha o Claude Code instalado e os skills da Camada 0 ativos (ver README principal).
2. Aponte os agentes para esta pasta como se fosse o repositório do paciente.
3. Exemplos para experimentar:
   - `/laboratorio` → deve detectar a tendência de glicose subindo, vitamina D e B12 caindo, potássio no limite.
   - `/dbs` → deve comentar a configuração de estimulação e o TEED.
   - `/farmacologista` → deve revisar o esquema de levodopa + agonista + amantadina.
   - `/preparar-consulta` → deve montar um briefing a partir da consulta de 18/11/2025.
4. Quando estiver confortável, **substitua esta pasta** pela estrutura com os dados
   reais do seu familiar (que ficam **só na sua máquina** — ver `.gitignore`).

## Conteúdo

```
exemplo-caso-ficticio/
├── caso.md                                   # resumo do paciente fictício
├── exames/
│   ├── 2024-03-12_laboratorio.md             # baseline
│   └── 2025-09-22_laboratorio.md             # 18 meses depois (mostra tendências)
├── consultas/
│   └── 2025-11-18_consulta_neurologista.md   # transcrição fictícia
└── dbs/
    └── configuracao_dbs.md                   # parâmetros de estimulação fictícios
```
