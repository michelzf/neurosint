#!/usr/bin/env python3
"""
register_to_mni.py — Registro não-rígido da RM do paciente para MNI152

Usa ANTs SyN (Symmetric Normalization) via antspyx. Produz:
- warp direto (paciente -> MNI) e inverso (MNI -> paciente)
- RM transformada para MNI
- Máscara STN gerada em MNI e trazida de volta ao paciente

Isso resolve a circularidade do MCP: coordenadas STN conhecidas em MNI
(Hamani 2004, DISTAL consensus) são projetadas no cérebro do paciente
através do warp inverso, sem depender dos próprios tips.

Uso:
    python register_to_mni.py --mri <mri_lps.nii.gz> --out <pasta>
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Optional
import numpy as np
import SimpleITK as sitk

try:
    import ants
    HAS_ANTS = True
except ImportError:
    HAS_ANTS = False


# Coordenadas STN em MNI152 (Hamani 2004 / Lambert 2015, convenção LPS)
STN_MNI_LPS = {
    "motor":       {"left": ( 11.5, -2.0, -4.0), "right": (-11.5, -2.0, -4.0)},
    "associative": {"left": (  9.0,  0.5, -3.0), "right": ( -9.0,  0.5, -3.0)},
    "limbic":      {"left": (  7.0,  3.0, -2.5), "right": ( -7.0,  3.0, -2.5)},
}
STN_SEMIAXES = (4.5, 3.5, 4.0)


def sitk_to_ants(sitk_image):
    """Converte SimpleITK para ANTsImage via numpy (menos perda de info que via disco)."""
    arr = sitk.GetArrayFromImage(sitk_image).astype(np.float32)
    # ants.from_numpy usa origin/spacing/direction no formato ANTs
    origin = sitk_image.GetOrigin()
    spacing = sitk_image.GetSpacing()
    direction = np.array(sitk_image.GetDirection()).reshape(3, 3)
    # ANTs espera arr em ordem (x, y, z); SimpleITK devolve (z, y, x)
    arr_xyz = arr.transpose(2, 1, 0)
    return ants.from_numpy(arr_xyz, origin=origin, spacing=spacing, direction=direction)


def ants_to_sitk(ants_image):
    arr_xyz = ants_image.numpy()
    arr_zyx = arr_xyz.transpose(2, 1, 0)
    img = sitk.GetImageFromArray(arr_zyx)
    img.SetOrigin(tuple(float(x) for x in ants_image.origin))
    img.SetSpacing(tuple(float(x) for x in ants_image.spacing))
    img.SetDirection(tuple(float(x) for x in ants_image.direction.flatten()))
    return img


def estimate_mcp_in_template(reference: "ants.ANTsImage") -> np.ndarray:
    """Estima o MCP no template (MNI ou similar) pelo centroide do cérebro.

    Para template MNI152 ICBM standard, MCP está próximo de (0,0,0) LPS por
    convenção, mas Lead-DBS redefine o origin em alguns templates. Usamos o
    centroide da máscara cerebral como proxy do MCP (apenas ~5 mm de erro
    comparado ao MCP anatômico verdadeiro).
    """
    arr = reference.numpy()
    # Máscara cerebral: tudo > 0 no brainmask
    mask = arr > 0.1
    if not mask.any():
        # Fallback: centro geométrico do volume
        shape = np.array(arr.shape)
        voxel_center = shape / 2.0
    else:
        xs, ys, zs = np.where(mask)
        voxel_center = np.array([xs.mean(), ys.mean(), zs.mean()])
    origin = np.array(reference.origin)
    spacing = np.array(reference.spacing)
    lps = origin + voxel_center * spacing
    return lps


def generate_stn_mask_in_mni(mni_reference: "ants.ANTsImage",
                              sector: str = "motor",
                              mcp_lps: Optional[np.ndarray] = None) -> "ants.ANTsImage":
    """Gera máscara elipsoidal bilateral no espaço do template.

    Se mcp_lps não for fornecido, estima automaticamente pelo centroide cerebral.
    As coordenadas STN Hamani são relativas ao MCP; o MCP do template provê o
    offset para coordenadas absolutas no volume.
    """
    centers = STN_MNI_LPS[sector]
    semiaxes = STN_SEMIAXES

    if mcp_lps is None:
        mcp_lps = estimate_mcp_in_template(mni_reference)

    arr = mni_reference.numpy()
    mask = np.zeros_like(arr, dtype=np.uint8)
    origin = mni_reference.origin
    spacing = mni_reference.spacing

    nx, ny, nz = arr.shape
    xi, yi, zi = np.meshgrid(np.arange(nx), np.arange(ny), np.arange(nz), indexing="ij")
    x_lps = origin[0] + xi * spacing[0]
    y_lps = origin[1] + yi * spacing[1]
    z_lps = origin[2] + zi * spacing[2]

    for side, center_rel in centers.items():
        # Coordenada absoluta em LPS = MCP + offset Hamani
        cx = mcp_lps[0] + center_rel[0]
        cy = mcp_lps[1] + center_rel[1]
        cz = mcp_lps[2] + center_rel[2]
        sx, sy, sz = semiaxes
        dx = (x_lps - cx) / sx
        dy = (y_lps - cy) / sy
        dz = (z_lps - cz) / sz
        inside = (dx*dx + dy*dy + dz*dz) <= 1.0
        value = 1 if side == "left" else 2
        mask[inside] = value

    out = ants.from_numpy(
        mask.astype(np.float32),
        origin=origin, spacing=spacing,
        direction=mni_reference.direction,
    )
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mri", required=True, type=Path,
                        help="MRI do paciente em LPS canônico (mri_lps.nii.gz)")
    parser.add_argument("--out", required=True, type=Path, help="Pasta de saída")
    parser.add_argument("--mni-template", type=Path,
                        default=Path(__file__).parent / "atlas" / "mni152_brainmask.nii.gz",
                        help="Template MNI152 (default: atlas/mni152_brainmask.nii.gz)")
    parser.add_argument("--transform-type", default="SyN",
                        choices=["Rigid", "Affine", "SyN", "SyNRA"],
                        help="Tipo de transformação (SyN = deformável, default)")
    args = parser.parse_args()

    if not HAS_ANTS:
        print("ERRO: antspyx não instalado. Instale com: pip install antspyx")
        sys.exit(1)

    args.out.mkdir(parents=True, exist_ok=True)

    if not args.mni_template.exists():
        print(f"ERRO: template MNI não encontrado em {args.mni_template}")
        print("Rode: python download_mni152.py")
        sys.exit(1)

    print(f"[1/4] Carregando RM do paciente: {args.mri}")
    mri_sitk = sitk.ReadImage(str(args.mri))
    mri_ants = sitk_to_ants(mri_sitk)
    print(f"  shape: {mri_ants.numpy().shape}, spacing: {mri_ants.spacing}")

    print(f"[2/4] Carregando template MNI: {args.mni_template}")
    mni = ants.image_read(str(args.mni_template))
    print(f"  shape: {mni.numpy().shape}, spacing: {mni.spacing}")

    # Downsample para evitar segfault em volumes grandes (>100M voxels)
    if np.prod(mri_ants.numpy().shape) > 100_000_000:
        print(f"  [INFO] Volume grande — downsampling para 1mm isotrópico antes do registro")
        mri_ds = ants.resample_image(mri_ants, (1.0, 1.0, 1.0), use_voxels=False, interp_type=1)
        mni_ds = ants.resample_image(mni, (1.0, 1.0, 1.0), use_voxels=False, interp_type=1)
    else:
        mri_ds = mri_ants
        mni_ds = mni

    print(f"[3/4] Registrando paciente -> MNI152 ({args.transform_type})...")
    print(f"      MRI downsampled shape: {mri_ds.numpy().shape}")
    print(f"      MNI downsampled shape: {mni_ds.numpy().shape}")
    print(f"      (pode levar 2-10 minutos)")
    reg = ants.registration(
        fixed=mni_ds, moving=mri_ds,
        type_of_transform=args.transform_type,
    )
    print(f"  forward transforms: {reg['fwdtransforms']}")
    print(f"  inverse transforms: {reg['invtransforms']}")

    warped_mri = reg["warpedmovout"]
    ants.image_write(warped_mri, str(args.out / "mri_in_mni.nii.gz"))
    print(f"  RM do paciente em MNI: {args.out / 'mri_in_mni.nii.gz'}")

    print(f"[4/4] Gerando máscaras STN em MNI e transformando para paciente...")
    mcp_in_template = estimate_mcp_in_template(mni)
    print(f"  MCP estimado no template (centroide cerebral): "
          f"({mcp_in_template[0]:+.1f}, {mcp_in_template[1]:+.1f}, {mcp_in_template[2]:+.1f}) LPS")

    for sector in ("motor", "associative", "limbic"):
        mask_mni = generate_stn_mask_in_mni(mni, sector, mcp_lps=mcp_in_template)
        n_in_mni = int((mask_mni.numpy() > 0).sum())
        mask_path_mni = args.out / f"stn_mask_{sector}_mni.nii.gz"
        ants.image_write(mask_mni, str(mask_path_mni))

        # Aplicar warp inverso: de MNI para paciente
        mask_patient = ants.apply_transforms(
            fixed=mri_ants, moving=mask_mni,
            transformlist=reg["invtransforms"],
            interpolator="nearestNeighbor",
        )
        mask_path_patient = args.out / f"stn_mask_{sector}_patient.nii.gz"
        ants.image_write(mask_patient, str(mask_path_patient))
        n_voxels = int((mask_patient.numpy() > 0).sum())
        print(f"  {sector}: MNI ({n_in_mni} voxels) -> paciente ({n_voxels} voxels)")

    # Salvar resumo
    summary = {
        "mni_template": str(args.mni_template),
        "transform_type": args.transform_type,
        "forward_transforms": [str(t) for t in reg["fwdtransforms"]],
        "inverse_transforms": [str(t) for t in reg["invtransforms"]],
        "stn_masks_generated": ["motor", "associative", "limbic"],
        "coordinate_system_note": (
            "Máscaras em espaço do paciente (mri_lps.nii.gz) geradas por warp "
            "inverso SyN de máscaras MNI152 baseadas em coordenadas Hamani 2004."
        ),
    }
    with open(args.out / "mni_registration.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"\nSaída em: {args.out}/")
    print(f"  - mri_in_mni.nii.gz — RM do paciente no espaço MNI")
    print(f"  - stn_mask_*_mni.nii.gz — máscaras STN em MNI")
    print(f"  - stn_mask_*_patient.nii.gz — máscaras STN trazidas de volta ao paciente (usar para análise)")
    print(f"  - mni_registration.json — metadados")


if __name__ == "__main__":
    sys.exit(main() or 0)
