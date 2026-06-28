# local-up.ps1 — sobe o Neurosint 100% LOCAL (Windows). Um comando: start → migrations+seed
# → testes RLS → serve as Edge Functions com o .env.local.
# Uso:  pwsh tools/local-up.ps1     (Ctrl+C para parar o serve)
$ErrorActionPreference = 'Stop'
$env:DO_NOT_TRACK = '1'

$cli = (Get-Command supabase -ErrorAction SilentlyContinue).Source
if (-not $cli) { $cli = "$env:LOCALAPPDATA\Programs\supabase\supabase.exe" }
if (-not (Test-Path $cli)) { throw "Supabase CLI nao encontrado. Instale (scoop install supabase) ou baixe o binario do GitHub." }

$envFile = "supabase/functions/.env.local"
if (-not (Test-Path $envFile)) {
  Copy-Item "supabase/functions/.env.example" $envFile
  Write-Host "Criei $envFile a partir do exemplo (Preset A: echo/offline). Edite para Ollama/whisper se quiser privacidade-total real." -ForegroundColor Yellow
}

Write-Host "==> supabase start" -ForegroundColor Cyan
& $cli start
Write-Host "==> db reset (migrations + seed)" -ForegroundColor Cyan
& $cli db reset
Write-Host "==> test db (RLS pgTAP)" -ForegroundColor Cyan
& $cli test db
& $cli status
Write-Host "`n==> functions serve (Ctrl+C para parar)" -ForegroundColor Cyan
& $cli functions serve --env-file $envFile
