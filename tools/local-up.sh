#!/usr/bin/env bash
# local-up.sh — sobe o Neurosint 100% LOCAL (Linux/macOS/Git-Bash). Um comando:
# start → migrations+seed → testes RLS → serve as Edge Functions com o .env.local.
# Uso:  bash tools/local-up.sh     (Ctrl+C para parar o serve)
set -euo pipefail
export DO_NOT_TRACK=1

ENV_FILE="supabase/functions/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  cp "supabase/functions/.env.example" "$ENV_FILE"
  echo ">> Criei $ENV_FILE (Preset A: echo/offline). Edite para Ollama/whisper se quiser privacidade-total real."
fi

echo "==> supabase start";            supabase start
echo "==> db reset (migrations+seed)"; supabase db reset
echo "==> test db (RLS pgTAP)";        supabase test db
supabase status
echo ""
echo "==> functions serve (Ctrl+C para parar)"
supabase functions serve --env-file "$ENV_FILE"
