#!/usr/bin/env bash
# setup-cloud-scheduler.example.sh — provisiona os Cloud Scheduler jobs (cria ou atualiza).
# Copie para setup-cloud-scheduler.sh e ajuste. Cada job faz POST em SERVICE_URL/cron/<job>
# com o header X-Cron-Secret. Crons em horário de Brasília.
#
#   PROJECT=<seu-projeto> REGION=us-central1 SERVICE_URL=<cloud-run-url> \
#   GSM_PROJECT=<projeto-dos-segredos> GSM_PREFIX="neurosint--" \
#   bash tools/setup-cloud-scheduler.sh
set -euo pipefail

PROJECT="${PROJECT:?defina PROJECT}"
REGION="${REGION:-us-central1}"
SERVICE_URL="${SERVICE_URL:?defina SERVICE_URL (https://...run.app)}"
TZ="${TZ:-America/Sao_Paulo}"
GSM_PROJECT="${GSM_PROJECT:-$PROJECT}"
GSM_PREFIX="${GSM_PREFIX:-}"

# Segredo dos endpoints /cron. Lê do GSM se CRON_SECRET não vier no env.
CRON_SECRET="${CRON_SECRET:-$(gcloud secrets versions access latest --secret="${GSM_PREFIX}CRON_SECRET" --project="${GSM_PROJECT}" 2>/dev/null || true)}"
[ -z "${CRON_SECRET}" ] && echo "AVISO: CRON_SECRET vazio — endpoints /cron ficarão sem proteção."

# job|cron (BRT). Múltiplas linhas do mesmo job = múltiplos horários.
JOBS=$(cat <<'EOF'
checkin|0 10 * * *
checkin|0 16 * * *
checkin|0 21 * * *
medication|0 8 * * *
medication|0 11 * * *
medication|0 14 * * *
medication|0 17 * * *
medication|0 20 * * *
morning|0 8 * * *
caregiver|0 15 * * 3
dbs-battery|0 9 * * *
dbs-program|0 9 * * *
weekly-summary|0 20 * * 0
dual-report|0 17 * * 0
EOF
)

i=0
while IFS='|' read -r job cron; do
  [ -z "$job" ] && continue
  name="neurosint-${job}-${i}"
  uri="${SERVICE_URL}/cron/${job}"
  echo "==> ${name}  '${cron}'  -> ${uri}"
  if gcloud scheduler jobs describe "${name}" --project="${PROJECT}" --location="${REGION}" >/dev/null 2>&1; then
    cmd=update
  else
    cmd=create
  fi
  gcloud scheduler jobs ${cmd} http "${name}" \
    --project="${PROJECT}" --location="${REGION}" \
    --schedule="${cron}" --time-zone="${TZ}" \
    --uri="${uri}" --http-method=POST \
    --headers="X-Cron-Secret=${CRON_SECRET},Content-Type=application/json" \
    --message-body='{}' \
    --attempt-deadline=300s
  i=$((i+1))
done <<< "$JOBS"

echo "==> ${i} jobs provisionados."
