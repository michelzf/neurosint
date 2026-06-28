#!/usr/bin/env bash
# deploy-cloud-run.example.sh — deploy do assistente no Google Cloud Run (idempotente).
# Copie para deploy-cloud-run.sh e ajuste, OU rode passando as variáveis no ambiente.
#
#   PROJECT=<seu-projeto-gcp> REGION=us-central1 \
#   SECRET_PROJECT=<projeto-dos-segredos> GSM_PREFIX="neurosint--" \
#   bash tools/deploy-cloud-run.sh
#
# Os segredos vivem no Secret Manager (no projeto SECRET_PROJECT). Este script:
#   1. habilita as APIs necessárias no projeto de destino;
#   2. concede ao service account de runtime do Cloud Run acesso de leitura a cada segredo;
#   3. faz o deploy referenciando cada segredo pelo caminho completo.
set -euo pipefail

PROJECT="${PROJECT:?defina PROJECT (id do projeto GCP de destino)}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-neurosint-assistant}"
SECRET_PROJECT="${SECRET_PROJECT:-$PROJECT}"   # onde vivem os segredos no Secret Manager
GSM_PREFIX="${GSM_PREFIX:-}"                    # prefixo dos nomes dos segredos no GSM
MIN_INSTANCES="${MIN_INSTANCES:-0}"
MEMORY="${MEMORY:-512Mi}"

cd "$(dirname "$0")/.."   # -> assistant/

# env_var=nome_no_GSM  (nome = GSM_PREFIX + env var, por padrão)
SECRET_KEYS=(ANTHROPIC_API_KEY OPENAI_API_KEY ELEVENLABS_API_KEY SUPABASE_SERVICE_KEY EVOLUTION_API_KEY OPENEVIDENCE_API_KEY CRON_SECRET)

echo "==> [1/4] Habilitando APIs em ${PROJECT}"
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com \
  --project="${PROJECT}"

PNUM=$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')
RUNTIME_SA="${RUNTIME_SA:-${PNUM}-compute@developer.gserviceaccount.com}"
SECRET_PROJECT_NUM=$(gcloud projects describe "${SECRET_PROJECT}" --format='value(projectNumber)')
echo "==> runtime SA: ${RUNTIME_SA}"

echo "==> [2/4] Concedendo acesso de leitura aos segredos em ${SECRET_PROJECT}"
SET_SECRETS=""
for env_var in "${SECRET_KEYS[@]}"; do
  gsm_name="${GSM_PREFIX}${env_var}"
  gcloud secrets add-iam-policy-binding "${gsm_name}" \
    --project="${SECRET_PROJECT}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --condition=None >/dev/null
  echo "    + ${gsm_name}"
  ref="${env_var}=projects/${SECRET_PROJECT_NUM}/secrets/${gsm_name}:latest"
  SET_SECRETS="${SET_SECRETS:+${SET_SECRETS},}${ref}"
done

echo "==> [3/4] Deploy ${SERVICE} em ${PROJECT}/${REGION}"
gcloud run deploy "${SERVICE}" \
  --quiet --project="${PROJECT}" --region="${REGION}" \
  --source=. --allow-unauthenticated --no-cpu-throttling \
  --memory="${MEMORY}" --min-instances="${MIN_INSTANCES}" --max-instances=3 --timeout=120 \
  --set-env-vars="NODE_ENV=production,ENABLE_INTERNAL_CRON=false,GSM_PROJECT=${SECRET_PROJECT},GSM_PREFIX=${GSM_PREFIX}" \
  --set-secrets="${SET_SECRETS}"

URL=$(gcloud run services describe "${SERVICE}" --project="${PROJECT}" --region="${REGION}" --format='value(status.url)')
echo "==> [4/4] URL: ${URL}"
curl -fsS "${URL}/health" && echo
echo "==> OK. Próximo: provisione os crons ->"
echo "    PROJECT=${PROJECT} REGION=${REGION} SERVICE_URL=${URL} bash tools/setup-cloud-scheduler.sh"
