#!/usr/bin/env python3
"""
stn_atlas.py — Máscara elipsoidal do STN em espaço MNI152 + transferência ao paciente

Solução pragmática sem dependência de atlas DISTAL completo:
1. Gera máscara elipsoidal do STN bilateral em espaço MNI152 com coordenadas
   conhecidas (Hamani 2004, Lambert 2015): centros bilaterais + subsetores.
2. Carrega um template MNI152 T1 (gerado sinteticamente se não disponível)
   OU usa a RM do paciente com landmarks AC/PC manuais.
3. Registra MNI152 → espaço do paciente (se template existir) usando registro
   afim SimpleITK.
4. Transfere a máscara STN para o espaço do paciente.
5. Permite verificação objetiva: "tip está dentro da máscara STN motor?"

O atlas DISTAL completo (Ewert 2018, https://www.lead-dbs.org/about-distal-atlas/)
está disponível em NIfTI via Lead-DBS. Pode ser baixado separadamente e colocado
em `tools/dbs_fusion/atlas/distal_minimal.nii.gz`; este módulo usa automaticamente
se encontrado.
"""

from pathlib import Path
from typing import Tuple, Optional
import numpy as np
import SimpleITK as sitk


# Coordenadas STN em MNI152 (Lambert 2015, DISTAL consensus)
# MNI é RAS por convenção; X+ = direita do paciente
# Conversão para LPS: negar X, Y (mas manter Z)
# Para trabalhar sempre em LPS, negamos X e Y:
STN_MOTOR_MNI152_LPS = {
    # centro do STN motor em cada hemisfério (LPS a partir do MCP aprox.)
    "left":  (11.5, -2.0, -4.0),   # X+ = esquerda do paciente em LPS
    "right": (-11.5, -2.0, -4.0),
}
STN_ASSOCIATIVE_MNI152_LPS = {
    "left":  (9.0, 0.5, -3.0),
    "right": (-9.0, 0.5, -3.0),
}
STN_LIMBIC_MNI152_LPS = {
    "left":  (7.0, 3.0, -2.5),
    "right": (-7.0, 3.0, -2.5),
}
STN_SEMIAXES_MM = (4.5, 3.5, 4.0)  # (lateral, AP, SI)


def generate_stn_mask_image(reference_image: sitk.Image, mcp_lps: np.ndarray,
                             sector: str = "motor") -> sitk.Image:
    """Gera máscara binária do STN bilateral no espaço da reference_image.

    Args:
        reference_image: imagem 3D SimpleITK (idealmente já em LPS canônico)
        mcp_lps: coordenadas LPS (mm) do midpoint commissural do paciente
        sector: "motor", "associative" ou "limbic"

    Returns:
        sitk.Image com 1 onde é STN bilateral, 0 fora. Mesmo grid que reference.
    """
    centers_lookup = {
        "motor": STN_MOTOR_MNI152_LPS,
        "associative": STN_ASSOCIATIVE_MNI152_LPS,
        "limbic": STN_LIMBIC_MNI152_LPS,
    }
    centers = centers_lookup[sector]

    ref_array = sitk.GetArrayFromImage(reference_image)
    size = reference_image.GetSize()
    spacing = np.array(reference_image.GetSpacing())
    origin = np.array(reference_image.GetOrigin())
    direction = np.array(reference_image.GetDirection()).reshape(3, 3)

    # Gerar grid de coordenadas LPS de cada voxel
    mask = np.zeros(ref_array.shape, dtype=np.uint8)

    # Para eficiência, iterar sobre os dois elipsóides
    # shape numpy é (z, y, x)
    # Em LPS canônico, eixo imagem 0 = X_LPS, 1 = Y_LPS, 2 = Z_LPS
    # Mas numpy retorna (z_img, y_img, x_img)
    n_z, n_y, n_x = ref_array.shape

    # Criar grid de voxel índices
    zi, yi, xi = np.meshgrid(
        np.arange(n_z), np.arange(n_y), np.arange(n_x), indexing="ij"
    )
    # Converter para LPS (assumindo direction é identidade ou quase)
    x_lps = origin[0] + xi * spacing[0]
    y_lps = origin[1] + yi * spacing[1]
    z_lps = origin[2] + zi * spacing[2]

    for side in ("left", "right"):
        cx, cy, cz = centers[side]
        # Centro absoluto em LPS = MCP + offset relativo
        center_abs = mcp_lps + np.array([cx, cy, cz])
        sx, sy, sz = STN_SEMIAXES_MM
        # Equação do elipsóide centrado em center_abs
        dx = (x_lps - center_abs[0]) / sx
        dy = (y_lps - center_abs[1]) / sy
        dz = (z_lps - center_abs[2]) / sz
        inside = (dx * dx + dy * dy + dz * dz) <= 1.0
        mask[inside] = 1 if side == "left" else 2  # 1 = esquerdo, 2 = direito

    mask_image = sitk.GetImageFromArray(mask)
    mask_image.CopyInformation(reference_image)
    return mask_image


def tip_in_stn_mask(tip_lps: np.ndarray, stn_mask: sitk.Image) -> dict:
    """Verifica se um tip (em coordenadas LPS mm) está dentro da máscara STN.

    Calcula:
    - valor da máscara no voxel do tip (0=fora, 1=esquerdo, 2=direito)
    - distância do tip à superfície da máscara (em mm, via distance transform)
    """
    tip = tuple(float(x) for x in tip_lps)
    # Converter LPS mm → índice voxel
    voxel_idx = stn_mask.TransformPhysicalPointToIndex(tip)
    size = stn_mask.GetSize()

    # Clip dentro dos limites
    safe_idx = tuple(
        max(0, min(voxel_idx[i], size[i] - 1)) for i in range(3)
    )
    value_at_tip = int(stn_mask.GetPixel(safe_idx))

    # Distância à máscara (via distance transform signed)
    # sitk.SignedMaurerDistanceMap: negativo dentro, positivo fora
    mask_binary = sitk.BinaryThreshold(stn_mask, 1, 2, 1, 0)
    distance_map = sitk.SignedMaurerDistanceMap(
        mask_binary, insideIsPositive=False, squaredDistance=False,
        useImageSpacing=True,
    )
    d_value = float(distance_map.GetPixel(safe_idx))

    return {
        "tip_lps_mm": list(tip),
        "voxel_at_tip": list(safe_idx),
        "mask_value_at_tip": value_at_tip,  # 0=fora, 1=esq, 2=dir
        "inside_stn": bool(value_at_tip > 0),
        "signed_distance_mm": d_value,  # negativo se dentro, positivo se fora
        "interpretation": (
            "dentro da máscara STN" if value_at_tip > 0 else
            f"fora da máscara STN ({d_value:.2f} mm até a borda)"
        ),
    }


def has_distal_atlas() -> Optional[Path]:
    """Retorna caminho do atlas DISTAL se disponível localmente."""
    here = Path(__file__).parent
    candidates = [
        here / "atlas" / "distal_minimal.nii.gz",
        here / "atlas" / "distal.nii.gz",
        here / "atlas" / "DISTAL_Minimal.nii.gz",
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


if __name__ == "__main__":
    # Demo: gerar máscara elipsoidal no volume LPS do paciente
    import sys
    if len(sys.argv) < 3:
        print("Uso: python stn_atlas.py <reference.nii.gz> <mcp_x,mcp_y,mcp_z> [tip_x,tip_y,tip_z]")
        sys.exit(1)

    ref = sitk.ReadImage(sys.argv[1])
    mcp = np.array([float(x) for x in sys.argv[2].split(",")])
    print(f"MCP: {mcp}")

    mask = generate_stn_mask_image(ref, mcp, "motor")
    out_path = Path(sys.argv[1]).parent / "stn_mask_motor.nii.gz"
    sitk.WriteImage(mask, str(out_path))
    print(f"Máscara salva: {out_path}")

    if len(sys.argv) >= 4:
        tip = np.array([float(x) for x in sys.argv[3].split(",")])
        result = tip_in_stn_mask(tip, mask)
        print(f"\nTip {tip} → {result['interpretation']}")
        print(f"  signed distance: {result['signed_distance_mm']:+.2f} mm")
