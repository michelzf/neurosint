# 🛡️ Neurosint

**An AI copilot for the family and the doctor to care better for someone you love.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-template%20v1.0%20%2B%20product%20preview-brightgreen.svg)](CHANGELOG.md)
[![copilot family + doctor](https://img.shields.io/badge/copilot-family%20%2B%20doctor-009c3b.svg)](DISCLAIMER.md)
[![PT-BR](https://img.shields.io/badge/lang-PT--BR-555.svg)](README.md) [![EN](https://img.shields.io/badge/lang-English-009c3b.svg)](README.en.md)

> 🇧🇷 The main documentation is in **Portuguese** → [README.md](README.md). This is a short summary.

> **Neurosint is a copilot for the family and the doctor.** It organizes and cross-references
> years of health data to support the clinician's decisions and day-to-day care — the doctor
> always decides. (It does not replace medical evaluation; see [DISCLAIMER.md](DISCLAIMER.md).)

## The story

My father has Parkinson's disease and a deep brain stimulator (DBS). Over a decade we piled up
hundreds of exams, reports, consultation transcripts and images. In a 20-minute appointment, no
doctor can cross-reference all of that. So I built a **council of AI agents** that reads everything,
organizes the timeline, tracks markers over years, and prepares questions for the next visit. An
image-fusion tool helped visualize the DBS electrode placement — and the conversation it enabled
with the neurologist led to an important finding (one electrode about **7.1 mm off the motor
target**). A WhatsApp assistant now logs medication, tremor and gait day to day.

**The AI did not diagnose, prescribe, or reprogram anything. The doctors did.** I only shortened
the distance between the data and the decision. Full story: [docs/JORNADA.md](docs/JORNADA.md) (PT).

## What it does

It **organizes and cross-references** years of exams, reports and consultations into searchable
text; **prepares** analyses and briefings the doctor can read in minutes; and **tracks** the day
to day (medication, symptoms, gait). It's a copilot — honest about the limits of AI (which can err
and hallucinate): diagnosis, prescription and adjustments are always the doctor's. See the
[limits and notices](DISCLAIMER.md).

## The 4 layers (start at Layer 0)

- **Layer 0 — Agent council** (`.claude/commands/` + `.claude/agents/`): 9 Claude Code skills
  (neurologist council, DBS, differential, labs, pharmacology, evidence, consult prep…) plus 6
  specialist subagents for parallel fan-out. *Friction: minimal.*
- **Layer 1 — Exam organization** (`exames/`): a predictable `YYYY-MM-DD_type/` folder convention.
- **Layer 2 — DBS image fusion** (`tools/dbs_fusion/`): Python/SimpleITK CT+MRI fusion + electrode
  analysis.
- **Layer 3 — Scientific evidence** (`.mcp.json.example`): PubMed/guidelines MCP servers.
- **Layer 4 — WhatsApp assistant** (`assistant/`): Node.js → Cloud Run; a 6-specialist council, 8
  scheduled routines, TTS, clinical logging. Assistant name is configurable (`ASSISTANT_NAME`).

> **Product (preview):** an "app + server" edition, 100% Supabase and multi-family, is being built
> under `supabase/` (backend) and `apps/mobile/` (Expo/React Native). It runs in **two modes** —
> 100% local with an anti-egress guard, or hosted server — chosen by environment variable. Plan:
> [docs/PLANO_PRODUTO.md](docs/PLANO_PRODUTO.md) (PT); how to run: [docs/EXECUCAO.md](docs/EXECUCAO.md) (PT).

## Quick start (< 10 min — Layer 0)

```bash
git clone https://github.com/michelzf/neurosint
cd neurosint
# Install Claude Code, open this folder, and try the agents against the fictional case:
#   /laboratorio   /dbs   /preparar-consulta
```

Everything in `exemplo-caso-ficticio/` is **fictional** — to explore the flow without real data.

## Privacy

Cloud-first by default (data goes to AI providers); an experimental local mode (Ollama) keeps
data on your machine, at the cost of weaker clinical reasoning. See [docs/PRIVACIDADE.md](docs/PRIVACIDADE.md) (PT).

## License

**[AGPL-3.0-or-later](LICENSE)** — if you offer it as a service, you must open your source.
Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Never commit real patient data
([SECURITY.md](SECURITY.md)).
