#!/usr/bin/env bash
# run_pipeline.sh — Executa o pipeline completo de fusão + análise
#
# Uso:
#   ./run_pipeline.sh <pasta_mri> <pasta_ct> <pasta_saida>

set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Uso: $0 <pasta_mri_dicom> <pasta_ct_dicom> <pasta_saida>"
  echo ""
  echo "Exemplo:"
  echo "  $0 \\"
  echo "    ../../exames/AAAA-MM-DD_RM_planejamento_DBS/DICOM \\"
  echo "    ../../exames/AAAA-MM-DD_TC_cranio_volumetrica/DICOM \\"
  echo "    ../../DBS/fusion_$(date +%Y-%m-%d)"
  exit 1
fi

MRI="$1"
CT="$2"
OUT="$3"

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "===================================================================="
echo "  DBS Fusion Pipeline"
echo "  MRI: $MRI"
echo "  CT:  $CT"
echo "  OUT: $OUT"
echo "===================================================================="
echo ""

echo ">>> Etapa 1/3: Fusão TC→RM"
python "$SCRIPT_DIR/fuse_ct_mri.py" --mri "$MRI" --ct "$CT" --out "$OUT"
echo ""

echo ">>> Etapa 2/3: Detecção de eletrodos (no volume LPS canônico)"
python "$SCRIPT_DIR/detect_electrodes.py" --ct "$OUT/ct_lps.nii.gz" --out "$OUT"
echo ""

echo ">>> Etapa 3/3: Geração de relatório"
python "$SCRIPT_DIR/generate_report.py" --out "$OUT"
echo ""

echo "===================================================================="
echo "  Pipeline concluído. Arquivos em: $OUT/"
echo "===================================================================="
