# local-dev.ps1 — sobe TUDO local (Windows) e serve o cliente web de teste num só endereço.
#   supabase start (se preciso) → db reset → dev-server em http://127.0.0.1:8000
#
# Providers: se existir `supabase/functions/.env.local`, ele é carregado (escolha o preset no
# supabase/functions/.env.example — A=echo, B=ollama/local, C=nuvem). Sem o arquivo, usa echo.
# Uso:  pwsh tools/local-dev.ps1     (Ctrl+C para parar)
$ErrorActionPreference = 'Stop'
$env:DO_NOT_TRACK = '1'

$cli = (Get-Command supabase -ErrorAction SilentlyContinue).Source
if (-not $cli) { $cli = "$env:LOCALAPPDATA\Programs\supabase\supabase.exe" }
$deno = (Get-Command deno -ErrorAction SilentlyContinue).Source
if (-not $deno) { $deno = "$env:LOCALAPPDATA\Programs\deno\deno.exe" }

# 1) garante o stack de pé (db, auth, rest, storage, kong)
$up = (docker ps --format '{{.Names}}' | Select-String 'supabase_db_neurosint')
if (-not $up) {
  Write-Host '==> supabase start' -ForegroundColor Cyan
  & $cli start -x studio,imgproxy,edge-runtime,realtime,logflare,vector,supavisor,mailpit
}
Write-Host '==> db reset (migrations + seed)' -ForegroundColor Cyan
& $cli db reset

# 2) providers: carrega .env.local se existir; senão, preset echo (sem chave/rede)
$envFile = 'supabase/functions/.env.local'
if (Test-Path $envFile) {
  Write-Host "==> carregando providers de $envFile" -ForegroundColor Cyan
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
      $k, $v = $line -split '=', 2
      Set-Item -Path "env:$($k.Trim())" -Value $v.Trim()
    }
  }
} else {
  Write-Host '==> sem .env.local — preset echo (sem chave/rede)' -ForegroundColor Yellow
  $env:NEUROSINT_TARGET = 'local'; $env:OFFLINE_STRICT = 'true'
  $env:LLM_PROVIDER = 'echo'; $env:STT_PROVIDER = 'echo'; $env:VISION_PROVIDER = 'echo'
  $env:TTS_PROVIDER = 'none'; $env:EVIDENCE_PROVIDER = 'none'
}

# 3) chaves locais do Supabase (sempre do `status`, sobrescrevem o que vier do .env)
$st = (& $cli status -o json | ConvertFrom-Json)
$env:SUPABASE_URL = $st.API_URL
$env:SUPABASE_ANON_KEY = $st.ANON_KEY
$env:SUPABASE_SERVICE_ROLE_KEY = $st.SERVICE_ROLE_KEY

Write-Host "`n==> cliente web em http://127.0.0.1:8000  (Ctrl+C para parar)" -ForegroundColor Green
Write-Host "    login dev: cuidador@dev.local / neurosint-dev   ·   LLM=$($env:LLM_PROVIDER)" -ForegroundColor Green
& $deno run --allow-net --allow-env --allow-read tools/devkit/server.ts
