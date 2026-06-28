# test-all.ps1 — roda TODA a suíte local (Windows): unidade + banco/RLS + integração E2E.
#   1) UNIT   — testes Deno da lógica pura (tags, pii, hosts, files, providers)
#   2) pgTAP  — RLS/RPC/constraints no Postgres (supabase test db)
#   3) E2E    — fluxo HTTP ponta a ponta contra o dev-server (echo)
# Teste de navegador (Playwright) é separado: tools/devkit/playwright (npm test).
# Uso:  pwsh tools/test-all.ps1
$ErrorActionPreference = 'Stop'
$env:DO_NOT_TRACK = '1'
$cli = (Get-Command supabase -ErrorAction SilentlyContinue).Source
if (-not $cli) { $cli = "$env:LOCALAPPDATA\Programs\supabase\supabase.exe" }
$deno = (Get-Command deno -ErrorAction SilentlyContinue).Source
if (-not $deno) { $deno = "$env:LOCALAPPDATA\Programs\deno\deno.exe" }
$fail = 0
function Test-Health { try { return (Invoke-RestMethod 'http://127.0.0.1:8000/functions/v1/health' -TimeoutSec 3).ok } catch { return $false } }

Write-Host "`n===== 1/3 · UNIT (Deno) =====" -ForegroundColor Cyan
& $deno test --allow-env tools/devkit/tests/
if ($LASTEXITCODE -ne 0) { $fail++ }

# garante stack + schema limpo
if (-not (docker ps --format '{{.Names}}' | Select-String 'supabase_db_neurosint')) {
  Write-Host '==> supabase start' -ForegroundColor DarkGray
  & $cli start -x studio,imgproxy,edge-runtime,realtime,logflare,vector,supavisor,mailpit | Out-Null
}
& $cli db reset | Out-Null

Write-Host "`n===== 2/3 · pgTAP (RLS / RPC / constraints) =====" -ForegroundColor Cyan
& $cli test db
if ($LASTEXITCODE -ne 0) { $fail++ }

Write-Host "`n===== 3/3 · E2E (HTTP, dev-server echo) =====" -ForegroundColor Cyan
$st = (& $cli status -o json | ConvertFrom-Json)
$env:SUPABASE_URL = $st.API_URL; $env:SUPABASE_ANON_KEY = $st.ANON_KEY; $env:SUPABASE_SERVICE_ROLE_KEY = $st.SERVICE_ROLE_KEY
$env:NEUROSINT_TARGET = 'local'; $env:OFFLINE_STRICT = 'true'
$env:LLM_PROVIDER = 'echo'; $env:STT_PROVIDER = 'echo'; $env:VISION_PROVIDER = 'echo'; $env:TTS_PROVIDER = 'none'; $env:EVIDENCE_PROVIDER = 'none'
$proc = $null
if (-not (Test-Health)) {
  $proc = Start-Process -FilePath $deno -ArgumentList 'run', '--allow-net', '--allow-env', '--allow-read', 'tools/devkit/server.ts' -PassThru -NoNewWindow
  for ($i = 0; $i -lt 40 -and -not (Test-Health); $i++) { Start-Sleep -Milliseconds 500 }
}
if (-not (Test-Health)) { Write-Host 'dev-server não subiu' -ForegroundColor Red; $fail++ }
else {
  & $deno test --allow-net --allow-env tools/devkit/e2e_test.ts
  if ($LASTEXITCODE -ne 0) { $fail++ }
}
if ($proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }

Write-Host ''
if ($fail -gt 0) { Write-Host "===== FALHOU ($fail suíte(s)) =====" -ForegroundColor Red; exit 1 }
Write-Host '===== TUDO VERDE: unit + pgTAP + E2E =====' -ForegroundColor Green
