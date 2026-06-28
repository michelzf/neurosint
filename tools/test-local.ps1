# test-local.ps1 — teste E2E automatizado do stack local (Windows). Um comando:
#   garante stack + db reset → sobe o dev-server (echo) → roda o E2E (Deno) → encerra.
# Uso:  pwsh tools/test-local.ps1
$ErrorActionPreference = 'Stop'
$env:DO_NOT_TRACK = '1'

$cli = (Get-Command supabase -ErrorAction SilentlyContinue).Source
if (-not $cli) { $cli = "$env:LOCALAPPDATA\Programs\supabase\supabase.exe" }
$deno = (Get-Command deno -ErrorAction SilentlyContinue).Source
if (-not $deno) { $deno = "$env:LOCALAPPDATA\Programs\deno\deno.exe" }

function Test-Health { try { return (Invoke-RestMethod 'http://127.0.0.1:8000/functions/v1/health' -TimeoutSec 3).ok } catch { return $false } }

$started = $false
if (-not (Test-Health)) {
  if (-not (docker ps --format '{{.Names}}' | Select-String 'supabase_db_neurosint')) {
    Write-Host '==> supabase start' -ForegroundColor Cyan
    & $cli start -x studio,imgproxy,edge-runtime,realtime,logflare,vector,supavisor,mailpit | Out-Null
  }
  Write-Host '==> db reset' -ForegroundColor Cyan
  & $cli db reset | Out-Null

  $st = (& $cli status -o json | ConvertFrom-Json)
  $env:SUPABASE_URL = $st.API_URL; $env:SUPABASE_ANON_KEY = $st.ANON_KEY; $env:SUPABASE_SERVICE_ROLE_KEY = $st.SERVICE_ROLE_KEY
  $env:NEUROSINT_TARGET = 'local'; $env:OFFLINE_STRICT = 'true'
  $env:LLM_PROVIDER = 'echo'; $env:STT_PROVIDER = 'echo'; $env:VISION_PROVIDER = 'echo'; $env:TTS_PROVIDER = 'none'; $env:EVIDENCE_PROVIDER = 'none'

  Write-Host '==> subindo dev-server' -ForegroundColor Cyan
  $proc = Start-Process -FilePath $deno -ArgumentList 'run', '--allow-net', '--allow-env', '--allow-read', 'tools/devkit/server.ts' -PassThru -NoNewWindow
  $started = $true
  for ($i = 0; $i -lt 40 -and -not (Test-Health); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Health)) { if ($started) { Stop-Process -Id $proc.Id -Force }; throw 'dev-server não respondeu' }
}

Write-Host '==> rodando E2E (Deno)' -ForegroundColor Cyan
& $deno test --allow-net --allow-env tools/devkit/e2e_test.ts
$code = $LASTEXITCODE

if ($started) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; Write-Host '==> dev-server encerrado' -ForegroundColor DarkGray }
exit $code
