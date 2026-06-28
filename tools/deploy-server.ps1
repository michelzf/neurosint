# deploy-server.ps1 — publica o Neurosint num projeto Supabase hospedado (Windows).
# Pré: projeto criado (recomendado sa-east-1 / São Paulo) e Supabase CLI logado.
# Uso:  $env:PROJECT_REF='<ref>'; pwsh tools/deploy-server.ps1
$ErrorActionPreference = 'Stop'
$env:DO_NOT_TRACK = '1'

if (-not $env:PROJECT_REF) { throw "Defina `$env:PROJECT_REF = '<ref-do-projeto>'" }
$envFile = if ($env:ENV_FILE) { $env:ENV_FILE } else { 'supabase/functions/.env.server' }
if (-not (Test-Path $envFile)) { throw "Falta $envFile. Copie supabase/functions/.env.example e preencha o Preset C (server)." }

$cli = (Get-Command supabase -ErrorAction SilentlyContinue).Source
if (-not $cli) { $cli = "$env:LOCALAPPDATA\Programs\supabase\supabase.exe" }

Write-Host "==> link $($env:PROJECT_REF)" -ForegroundColor Cyan; & $cli link --project-ref $env:PROJECT_REF
Write-Host "==> db push (migrations)" -ForegroundColor Cyan;     & $cli db push
Write-Host "==> secrets set" -ForegroundColor Cyan;              & $cli secrets set --env-file $envFile
Write-Host "==> deploy functions" -ForegroundColor Cyan;         & $cli functions deploy ask; & $cli functions deploy health

Write-Host "`nDeploy concluido. Smoke (health e publico):" -ForegroundColor Green
Write-Host "  curl https://$($env:PROJECT_REF).supabase.co/functions/v1/health"
