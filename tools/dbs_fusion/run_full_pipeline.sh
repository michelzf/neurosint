#!/usr/bin/env bash
# run_full_pipeline.sh — Pipeline completo v1.7.0
#
# Inclui:
#   1. Fusão TC+RM (registro rígido com inicialização por momentos, 4 níveis)
#   2. Reamostragem para LPS canônico axial isotrópico
#   3. Detecção de eletrodos (DBSCAN em LPS + aspect ratio tubular)
#   4. Simulação de VTA (Kuncel & Grill)
#   5. Máscara STN elipsoidal MCP-referenced
#   6. Registro ANTs paciente→MNI152 (Affine por padrão, SyN se disponível)
#   7. Máscara STN MNI-derivada warped para paciente
#   8. Export Lead-DBS compatível (.mat)
#   9. Geração de relatório e visualizações
#
# Uso: ./run_full_pipeline.sh <mri_dicom_dir> <ct_dicom_dir> <out_dir> [--mcp x,y,z]

set -euo pipefail

if [ "$#" -lt 3 ]; then
    echo "Uso: $0 <mri_dicom_dir> <ct_dicom_dir> <out_dir> [--mcp x,y,z] [--mni-type Affine|SyN]"
    exit 1
fi

MRI_DIR="$1"
CT_DIR="$2"
OUT_DIR="$3"
shift 3

MCP_ARG=""
MNI_TYPE="Affine"
while [ "$#" -gt 0 ]; do
    case "$1" in
        --mcp)   MCP_ARG="--mcp $2"; shift 2 ;;
        --mni-type) MNI_TYPE="$2"; shift 2 ;;
        *) echo "Argumento desconhecido: $1"; exit 1 ;;
    esac
done

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
export PYTHONIOENCODING=utf-8

echo "================================================================"
echo "  DBS Fusion Pipeline v1.7.0"
echo "  MRI: $MRI_DIR"
echo "  CT:  $CT_DIR"
echo "  OUT: $OUT_DIR"
echo "  MCP manual: ${MCP_ARG:-(automatic)}"
echo "  MNI transform: $MNI_TYPE"
echo "================================================================"

echo ""
echo ">>> Etapa 1/6: Fusão TC+RM + reamostragem LPS canônico"
python "$SCRIPT_DIR/fuse_ct_mri.py" --mri "$MRI_DIR" --ct "$CT_DIR" --out "$OUT_DIR"

echo ""
echo ">>> Etapa 2/6: Baixar MNI152 template (se necessário)"
if [ ! -f "$SCRIPT_DIR/atlas/mni152_brainmask.nii.gz" ]; then
    python "$SCRIPT_DIR/download_mni152.py"
fi

echo ""
echo ">>> Etapa 3a/6: Registro paciente -> MNI152 ANTs ($MNI_TYPE)"
python "$SCRIPT_DIR/register_to_mni.py" \
    --mri "$OUT_DIR/mri_lps.nii.gz" \
    --out "$OUT_DIR" \
    --transform-type "$MNI_TYPE" || echo "[AVISO] Registro MNI via ANTs falhou — seguindo"

echo ""
echo ">>> Etapa 3b/6: Registro paciente -> CIT168 (SimpleITK) + warp atlas real"
if [ -f "$SCRIPT_DIR/atlas/cit168_stn_bilateral.nii.gz" ]; then
    python "$SCRIPT_DIR/register_sitk_nonrigid.py" \
        --mri "$OUT_DIR/mri_lps.nii.gz" \
        --out "$OUT_DIR" \
        --electrodes-json "$OUT_DIR/electrodes.json" 2>/dev/null || echo "[INFO] CIT168 warp pode rodar depois de detect_electrodes"
else
    echo "[INFO] CIT168 atlas não baixado — pule com: python download_mni152.py --all"
fi

echo ""
echo ">>> Etapa 4/6: Detecção de eletrodos + VTA + classificação anatômica"
python "$SCRIPT_DIR/detect_electrodes.py" \
    --ct "$OUT_DIR/ct_lps.nii.gz" \
    --out "$OUT_DIR" \
    $MCP_ARG

echo ""
echo ">>> Etapa 4b/6: CIT168 warp pós-deteção (valida tips contra atlas real)"
if [ -f "$SCRIPT_DIR/atlas/cit168_stn_bilateral.nii.gz" ] && [ ! -f "$OUT_DIR/cit168_stn_in_patient.nii.gz" ]; then
    python "$SCRIPT_DIR/register_sitk_nonrigid.py" \
        --mri "$OUT_DIR/mri_lps.nii.gz" \
        --out "$OUT_DIR" \
        --electrodes-json "$OUT_DIR/electrodes.json" || echo "[AVISO] CIT168 warp falhou"
fi

echo ""
echo ">>> Etapa 5/6: Export Lead-DBS"
python "$SCRIPT_DIR/export_leaddbs.py" \
    --in "$OUT_DIR" \
    --out "$OUT_DIR/reconstruction.mat"

echo ""
echo ">>> Etapa 6/6: Relatório visual e textual"
python "$SCRIPT_DIR/generate_report.py" --out "$OUT_DIR"

echo ""
echo "================================================================"
echo "  Pipeline concluído."
echo "  Resultados em: $OUT_DIR/"
echo "    - report.md            (análise textual completa)"
echo "    - comparison.png       (RM+TC+eletrodos 3x3)"
echo "    - stn_target.png       (close-up STN)"
echo "    - electrodes.json      (coords + VTA + classificação)"
echo "    - reconstruction.mat   (compatível Lead-DBS)"
echo "    - stn_mask_*_patient.nii.gz  (máscara STN MNI-derivada)"
echo "================================================================"
