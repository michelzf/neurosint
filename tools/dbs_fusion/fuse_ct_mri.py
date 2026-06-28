#!/usr/bin/env python3
"""
fuse_ct_mri.py — Pipeline de fusão TC+RM para DBS

Lê séries DICOM de TC pós-operatória e RM pré-operatória, faz registro rígido
TC->RM pelo método de otimização de informação mútua, e salva os volumes
alinhados em NIfTI.

Uso:
    python fuse_ct_mri.py --mri <pasta_mri_dicom> --ct <pasta_ct_dicom> --out <pasta_saida>

Limitações:
    Registro rígido simples (6 DoF). Sem deformação não-linear. Sem atlas.
    É uma triagem automatizada, não substitui Lead-DBS/Brainlab/Guide XT.

Requisitos: SimpleITK, pydicom, numpy.

Referências:
    - SimpleITK registration: https://simpleitk.readthedocs.io/en/master/registrationOverview.html
    - Metric: Mattes Mutual Information (padrão para multi-modalidade CT-MR)
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import SimpleITK as sitk


def _find_dicom_leaf_folders(root: Path):
    """Varre recursivamente procurando subpastas que contenham arquivos DICOM."""
    leaf_folders = set()
    for path in root.rglob("*"):
        if path.is_file():
            leaf_folders.add(path.parent)
    return sorted(leaf_folders)


def read_dicom_series(folder: Path) -> sitk.Image:
    """Lê uma série DICOM (recursivamente) e devolve SimpleITK Image 3D.

    A maior série (mais cortes) encontrada em qualquer subpasta é escolhida.
    """
    reader = sitk.ImageSeriesReader()
    folder = Path(folder)

    candidates = [folder] + _find_dicom_leaf_folders(folder)

    best_series = None
    best_count = 0
    best_folder = None

    for cand in candidates:
        try:
            series_ids = reader.GetGDCMSeriesIDs(str(cand))
        except Exception:
            continue
        for sid in series_ids:
            try:
                filenames = reader.GetGDCMSeriesFileNames(str(cand), sid)
            except Exception:
                continue
            if len(filenames) > best_count:
                best_count = len(filenames)
                best_series = filenames
                best_folder = cand

    if not best_series:
        raise RuntimeError(f"Nenhuma série DICOM encontrada em {folder} (varrido recursivamente)")

    print(f"  Série escolhida: {best_folder} ({best_count} cortes)")
    reader.SetFileNames(best_series)
    image = reader.Execute()
    print(f"  Carregado: {len(best_series)} cortes, tamanho {image.GetSize()}, "
          f"spacing {tuple(round(s, 2) for s in image.GetSpacing())}")
    return image


def register_rigid(fixed: sitk.Image, moving: sitk.Image,
                   max_iterations: int = 500) -> sitk.Transform:
    """Registra moving para fixed usando transformação rígida (6 DoF).

    Pipeline robusto:
    1. Inicialização por MOMENTOS (centroide de intensidade) — mais robusta
       que geometria quando as imagens têm FOVs diferentes.
    2. Multi-escala com 4 níveis (shrink 8, 4, 2, 1) — começa grosso e refina.
    3. Otimizador LBFGSB (mais rápido e preciso que gradient descent simples
       para problemas convexos como registro rígido multi-modal).
    4. 500 iterações máximo por nível (até converger automaticamente).
    5. Sampling percentage de 20% com estratégia REGULAR (menos ruidoso).
    """
    fixed_f = sitk.Cast(fixed, sitk.sitkFloat32)
    moving_f = sitk.Cast(moving, sitk.sitkFloat32)

    initial = sitk.CenteredTransformInitializer(
        fixed_f, moving_f,
        sitk.Euler3DTransform(),
        sitk.CenteredTransformInitializerFilter.MOMENTS,  # era GEOMETRY
    )

    reg = sitk.ImageRegistrationMethod()
    reg.SetMetricAsMattesMutualInformation(numberOfHistogramBins=64)
    reg.SetMetricSamplingStrategy(reg.REGULAR)  # era RANDOM
    reg.SetMetricSamplingPercentage(0.20, seed=42)

    reg.SetInterpolator(sitk.sitkLinear)
    # Gradient descent com linha search automática — mais robusto que RegularStep
    reg.SetOptimizerAsGradientDescent(
        learningRate=1.0,
        numberOfIterations=max_iterations,
        convergenceMinimumValue=1e-6,
        convergenceWindowSize=10,
    )
    reg.SetOptimizerScalesFromPhysicalShift()

    # 4 níveis multi-escala (era 3)
    reg.SetShrinkFactorsPerLevel([8, 4, 2, 1])
    reg.SetSmoothingSigmasPerLevel([3.0, 2.0, 1.0, 0.0])
    reg.SmoothingSigmasAreSpecifiedInPhysicalUnitsOn()

    reg.SetInitialTransform(initial, inPlace=False)

    final = reg.Execute(fixed_f, moving_f)
    print(f"  Registro rígido: métrica final = {reg.GetMetricValue():.4f}, "
          f"iterações = {reg.GetOptimizerIteration()}, "
          f"razão parada: {reg.GetOptimizerStopConditionDescription()}")
    return final


def resample_to_reference(moving: sitk.Image, reference: sitk.Image,
                          transform: sitk.Transform) -> sitk.Image:
    """Reamostra moving para o espaço de reference usando a transformação."""
    return sitk.Resample(
        moving, reference, transform,
        sitk.sitkLinear, 0, moving.GetPixelID(),
    )


def resample_to_canonical_lps(image: sitk.Image, spacing_mm: float = 0.5,
                              default_value: float = -1024) -> sitk.Image:
    """Reamostra a imagem para um grid isotrópico alinhado aos eixos LPS canônicos.

    Saída:
      - Direction = identidade (eixos 0,1,2 da imagem alinhados a LPS X, Y, Z)
      - Spacing = (spacing_mm, spacing_mm, spacing_mm) — isotrópico
      - Origin e tamanho calculados para cobrir o mesmo bounding box físico
        da imagem original.

    Vantagens:
      - Eixo 0 do array = LR (lateral)
      - Eixo 1 do array = AP (ântero-posterior)
      - Eixo 2 do array = SI (súpero-inferior)
      - Visualizações "axial" / "coronal" / "sagital" ficam anatomicamente corretas
      - Coordenadas voxel linearmente mapeáveis para LPS físico
    """
    # Calcular o bounding box físico da imagem original em LPS
    size = image.GetSize()
    corners_voxel = [
        (0, 0, 0), (size[0]-1, 0, 0), (0, size[1]-1, 0), (0, 0, size[2]-1),
        (size[0]-1, size[1]-1, 0), (size[0]-1, 0, size[2]-1),
        (0, size[1]-1, size[2]-1), (size[0]-1, size[1]-1, size[2]-1),
    ]
    corners_lps = np.array([
        image.TransformIndexToPhysicalPoint(c) for c in corners_voxel
    ])
    lps_min = corners_lps.min(axis=0)
    lps_max = corners_lps.max(axis=0)

    new_origin = tuple(lps_min.tolist())
    new_size = tuple(int(np.ceil((lps_max[i] - lps_min[i]) / spacing_mm)) + 1
                     for i in range(3))
    new_spacing = (spacing_mm, spacing_mm, spacing_mm)
    new_direction = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)

    resampler = sitk.ResampleImageFilter()
    resampler.SetOutputOrigin(new_origin)
    resampler.SetOutputSpacing(new_spacing)
    resampler.SetOutputDirection(new_direction)
    resampler.SetSize(new_size)
    resampler.SetInterpolator(sitk.sitkLinear)
    resampler.SetDefaultPixelValue(default_value)

    return resampler.Execute(image)


def main():
    parser = argparse.ArgumentParser(description="Fusão rígida TC->RM para DBS")
    parser.add_argument("--mri", required=True, type=Path,
                        help="Pasta com DICOMs da RM pré-operatória (referência)")
    parser.add_argument("--ct", required=True, type=Path,
                        help="Pasta com DICOMs da TC pós-operatória (móvel)")
    parser.add_argument("--out", required=True, type=Path,
                        help="Pasta de saída")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    print(f"[1/4] Lendo RM de {args.mri}...")
    mri = read_dicom_series(args.mri)

    print(f"[2/4] Lendo TC de {args.ct}...")
    ct = read_dicom_series(args.ct)

    print(f"[3/4] Registrando TC -> RM...")
    transform = register_rigid(mri, ct)

    print(f"[4/5] Reamostrando TC no espaço da RM...")
    ct_in_mri_space = resample_to_reference(ct, mri, transform)

    print(f"[5/5] Reamostrando para LPS canônico axial isotrópico (0.5 mm)...")
    mri_lps = resample_to_canonical_lps(mri, spacing_mm=0.5, default_value=0)
    ct_lps = resample_to_canonical_lps(ct_in_mri_space, spacing_mm=0.5, default_value=-1024)

    print(f"  RM canônica:  size={mri_lps.GetSize()}  origin={tuple(round(o,1) for o in mri_lps.GetOrigin())}")
    print(f"  TC canônica:  size={ct_lps.GetSize()}  origin={tuple(round(o,1) for o in ct_lps.GetOrigin())}")

    mri_out = args.out / "mri.nii.gz"
    ct_out = args.out / "ct_in_mri_space.nii.gz"
    mri_lps_out = args.out / "mri_lps.nii.gz"
    ct_lps_out = args.out / "ct_lps.nii.gz"
    tfm_out = args.out / "ct_to_mri.tfm"

    sitk.WriteImage(mri, str(mri_out))
    sitk.WriteImage(ct_in_mri_space, str(ct_out))
    sitk.WriteImage(mri_lps, str(mri_lps_out))
    sitk.WriteImage(ct_lps, str(ct_lps_out))
    sitk.WriteTransform(transform, str(tfm_out))

    print(f"\nSaída:")
    print(f"  RM (original):      {mri_out}")
    print(f"  TC alinhada à RM:   {ct_out}")
    print(f"  RM em LPS canônico: {mri_lps_out}")
    print(f"  TC em LPS canônico: {ct_lps_out}  <-- usar para detecção")
    print(f"  Transformação:      {tfm_out}")
    print(f"\nPróximo: python detect_electrodes.py --ct {ct_lps_out} --out {args.out}")


if __name__ == "__main__":
    sys.exit(main() or 0)
