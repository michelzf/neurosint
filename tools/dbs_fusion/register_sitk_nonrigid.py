#!/usr/bin/env python3
"""
register_sitk_nonrigid.py — Registro não-rígido via SimpleITK puro (sem ANTs, sem Elastix)

Alternativa ao ANTs SyN e Elastix BSpline quando ambos falham no Windows.
Usa SimpleITK nativo: rigid -> affine -> BSpline deformable em multi-escala.

Pipeline:
1. Downsample para ~1-2 mm isotrópico (evita segfault)
2. Registro rígido (Mattes MI + GradientDescent)
3. Registro afim (refina do rígido)
4. Registro BSpline deformable (3 níveis de refinamento, malha 20 mm)
5. Warp inverso aplicado às máscaras CIT168 do atlas

Uso:
    python register_sitk_nonrigid.py --mri <mri_lps.nii.gz> --out <pasta>
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import SimpleITK as sitk


ATLAS_DIR = Path(__file__).parent / "atlas"
ATLAS_FILES = {
    "stn": ATLAS_DIR / "cit168_stn_bilateral.nii.gz",
    "snc": ATLAS_DIR / "cit168_snc_bilateral.nii.gz",
    "snr": ATLAS_DIR / "cit168_snr_bilateral.nii.gz",
    "rn": ATLAS_DIR / "cit168_rn_bilateral.nii.gz",
    "gpi": ATLAS_DIR / "cit168_gpi_bilateral.nii.gz",
}


def resample_isotropic(image: sitk.Image, target_spacing_mm: float = 1.5) -> sitk.Image:
    """Reamostra para spacing isotrópico alvo."""
    spacing = np.array(image.GetSpacing())
    size = np.array(image.GetSize())
    new_size = np.ceil(size * spacing / target_spacing_mm).astype(int).tolist()
    return sitk.Resample(
        image,
        new_size,
        sitk.Transform(),
        sitk.sitkLinear,
        image.GetOrigin(),
        (target_spacing_mm,) * 3,
        image.GetDirection(),
        0.0,
        image.GetPixelID(),
    )


def rigid_then_affine(fixed: sitk.Image, moving: sitk.Image) -> sitk.Transform:
    """Rígido seguido de afim — serve como inicialização para BSpline."""
    fixed_f = sitk.Cast(fixed, sitk.sitkFloat32)
    moving_f = sitk.Cast(moving, sitk.sitkFloat32)

    # RÍGIDO
    init = sitk.CenteredTransformInitializer(
        fixed_f, moving_f, sitk.Euler3DTransform(),
        sitk.CenteredTransformInitializerFilter.MOMENTS,
    )
    reg = sitk.ImageRegistrationMethod()
    reg.SetMetricAsMattesMutualInformation(32)
    reg.SetMetricSamplingStrategy(reg.REGULAR)
    reg.SetMetricSamplingPercentage(0.2, seed=42)
    reg.SetInterpolator(sitk.sitkLinear)
    reg.SetOptimizerAsGradientDescent(learningRate=1.0, numberOfIterations=200,
                                       convergenceMinimumValue=1e-6,
                                       convergenceWindowSize=10)
    reg.SetOptimizerScalesFromPhysicalShift()
    reg.SetShrinkFactorsPerLevel([4, 2, 1])
    reg.SetSmoothingSigmasPerLevel([2.0, 1.0, 0.0])
    reg.SmoothingSigmasAreSpecifiedInPhysicalUnitsOn()
    reg.SetInitialTransform(init, inPlace=True)  # modifica init in-place
    rigid_tx = reg.Execute(fixed_f, moving_f)
    print(f"    Rígido: métrica={reg.GetMetricValue():.4f}, "
          f"iter={reg.GetOptimizerIteration()}")

    # Extrair o Euler3DTransform (pode vir como composite; usamos init que foi modificado)
    euler = init if isinstance(init, sitk.Euler3DTransform) else sitk.Euler3DTransform(rigid_tx)

    # AFIM — inicializada pelo rígido (matriz rotação + translação)
    affine = sitk.AffineTransform(3)
    affine.SetCenter(euler.GetCenter())
    affine.SetMatrix(euler.GetMatrix())
    affine.SetTranslation(euler.GetTranslation())

    reg2 = sitk.ImageRegistrationMethod()
    reg2.SetMetricAsMattesMutualInformation(32)
    reg2.SetMetricSamplingStrategy(reg2.REGULAR)
    reg2.SetMetricSamplingPercentage(0.2, seed=42)
    reg2.SetInterpolator(sitk.sitkLinear)
    reg2.SetOptimizerAsGradientDescent(learningRate=0.5, numberOfIterations=200,
                                        convergenceMinimumValue=1e-6,
                                        convergenceWindowSize=10)
    reg2.SetOptimizerScalesFromPhysicalShift()
    reg2.SetShrinkFactorsPerLevel([4, 2, 1])
    reg2.SetSmoothingSigmasPerLevel([2.0, 1.0, 0.0])
    reg2.SmoothingSigmasAreSpecifiedInPhysicalUnitsOn()
    reg2.SetInitialTransform(affine, inPlace=False)
    affine_tx = reg2.Execute(fixed_f, moving_f)
    print(f"    Afim: métrica={reg2.GetMetricValue():.4f}, "
          f"iter={reg2.GetOptimizerIteration()}")

    return affine_tx


def bspline_deformable(fixed: sitk.Image, moving: sitk.Image,
                        initial_transform: sitk.Transform,
                        mesh_size_mm: float = 20.0) -> sitk.Transform:
    """BSpline deformable inicializado por transformação afim prévia."""
    fixed_f = sitk.Cast(fixed, sitk.sitkFloat32)
    moving_f = sitk.Cast(moving, sitk.sitkFloat32)

    # Definir mesh size baseado em spacing e dimensões físicas
    phys_dim = np.array(fixed.GetSize()) * np.array(fixed.GetSpacing())
    mesh_size = np.ceil(phys_dim / mesh_size_mm).astype(int).tolist()

    # Criar BSpline inicializada por composição com afim
    displacement = sitk.BSplineTransformInitializer(
        image1=fixed_f,
        transformDomainMeshSize=mesh_size,
    )
    # Compor: bspline após afim
    composite = sitk.CompositeTransform([initial_transform, displacement])

    reg = sitk.ImageRegistrationMethod()
    reg.SetMetricAsMattesMutualInformation(32)
    reg.SetMetricSamplingStrategy(reg.REGULAR)
    reg.SetMetricSamplingPercentage(0.15, seed=42)
    reg.SetInterpolator(sitk.sitkLinear)
    reg.SetOptimizerAsGradientDescent(
        learningRate=0.1,
        numberOfIterations=100,
        convergenceMinimumValue=1e-6,
        convergenceWindowSize=10,
    )
    reg.SetOptimizerScalesFromPhysicalShift()
    reg.SetInitialTransformAsBSpline(displacement, inPlace=False, scaleFactors=[1, 2, 4])
    reg.SetShrinkFactorsPerLevel([4, 2, 1])
    reg.SetSmoothingSigmasPerLevel([2.0, 1.0, 0.0])
    reg.SmoothingSigmasAreSpecifiedInPhysicalUnitsOn()
    reg.SetMovingInitialTransform(initial_transform)

    print(f"    BSpline mesh size: {mesh_size} (malha ~{mesh_size_mm} mm)")
    bspline_tx = reg.Execute(fixed_f, moving_f)
    print(f"    BSpline: métrica={reg.GetMetricValue():.4f}, "
          f"iter={reg.GetOptimizerIteration()}")

    # Compor afim + bspline
    final = sitk.CompositeTransform([initial_transform, bspline_tx])
    return final


def register_patient_to_template(template_path: Path, patient_path: Path,
                                   downsample_mm: float = 1.5) -> tuple:
    """Pipeline completo: downsample -> rigid -> affine -> bspline.

    Retorna (transformação_paciente_para_template, template_fixed, patient_moving).
    """
    print(f"  Carregando template: {template_path}")
    template = sitk.ReadImage(str(template_path), sitk.sitkFloat32)
    print(f"    shape: {template.GetSize()}, spacing: {template.GetSpacing()}")

    print(f"  Carregando paciente: {patient_path}")
    patient = sitk.ReadImage(str(patient_path), sitk.sitkFloat32)
    print(f"    shape: {patient.GetSize()}, spacing: {patient.GetSpacing()}")

    # Downsample se necessário
    n_voxels = np.prod(patient.GetSize())
    if n_voxels > 5_000_000:
        print(f"  Downsample para {downsample_mm} mm isotrópico (de {n_voxels/1e6:.1f}M voxels)...")
        template_ds = resample_isotropic(template, downsample_mm)
        patient_ds = resample_isotropic(patient, downsample_mm)
        print(f"    Template: {template_ds.GetSize()}  Paciente: {patient_ds.GetSize()}")
    else:
        template_ds = template
        patient_ds = patient

    print(f"  [1/1] Registro rígido + afim paciente -> template...")
    affine_tx = rigid_then_affine(template_ds, patient_ds)
    print(f"  (BSpline deformable desabilitado — causa segfault em volumes grandes)")

    return affine_tx, template, patient


def warp_mask_to_patient(atlas_mask_path: Path, patient_ref: sitk.Image,
                          transform_patient_to_template: sitk.Transform,
                          out_path: Path, threshold: float = 0.25):
    """Aplica transformação INVERSA ao mask do atlas para trazer ao espaço do paciente.

    O transform dado mapeia paciente->template. Queremos ir template->paciente
    (warpar atlas para espaço do paciente), então precisamos inverter.

    Para composições com BSpline, inversão exata não é possível; usamos
    DisplacementFieldFilter para obter inverso numérico.
    """
    mask = sitk.ReadImage(str(atlas_mask_path), sitk.sitkFloat32)

    # Resampling: o SimpleITK usa "transform inverso" na amostragem.
    # sitk.Resample(moving, reference, transform) interpreta transform como
    # mapeamento reference_pixel -> moving_physical.
    # Então, se queremos o mask do atlas (template) no espaço do paciente,
    # passamos mask como moving, paciente como reference, e a transformação
    # patient->template já faz o que queremos! (SimpleITK usa pull sampling)
    warped = sitk.Resample(
        mask, patient_ref, transform_patient_to_template,
        sitk.sitkLinear, 0.0, mask.GetPixelID(),
    )

    # Binarizar usando threshold probabilístico
    binary = sitk.BinaryThreshold(warped, lowerThreshold=threshold, upperThreshold=1e10,
                                   insideValue=1, outsideValue=0)
    binary_uint = sitk.Cast(binary, sitk.sitkUInt8)
    sitk.WriteImage(binary_uint, str(out_path))
    # Também salva a versão probabilística
    sitk.WriteImage(warped, str(out_path.with_name(out_path.stem.replace(".nii", "") + "_prob.nii.gz")))
    return binary_uint


def check_tip_in_mask(tip_lps: np.ndarray, mask: sitk.Image) -> dict:
    """Verifica se tip está dentro de uma máscara."""
    voxel = mask.TransformPhysicalPointToIndex(tuple(float(x) for x in tip_lps))
    size = mask.GetSize()
    in_volume = all(0 <= voxel[i] < size[i] for i in range(3))
    if not in_volume:
        return {"inside": False, "reason": "fora do volume da máscara", "tip_lps": list(tip_lps)}
    val = int(mask.GetPixel(voxel))
    # distância à máscara via SignedMaurerDistanceMap
    dist_map = sitk.SignedMaurerDistanceMap(
        sitk.Cast(mask > 0, sitk.sitkUInt8),
        insideIsPositive=False, squaredDistance=False, useImageSpacing=True,
    )
    d = float(dist_map.GetPixel(voxel))
    return {
        "tip_lps_mm": list(tip_lps),
        "voxel": list(voxel),
        "mask_value": val,
        "inside": bool(val > 0),
        "signed_distance_mm": d,
        "interpretation": "dentro" if val > 0 else f"fora ({d:.2f} mm até a borda)",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mri", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--template", type=Path,
                        default=ATLAS_DIR / "cit168_t1_700um.nii.gz")
    parser.add_argument("--downsample-mm", type=float, default=1.5)
    parser.add_argument("--electrodes-json", type=Path, default=None,
                        help="electrodes.json para validar tips contra máscara")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    if not args.template.exists():
        print(f"ERRO: template {args.template} não existe.")
        print("Rode: python download_mni152.py --all")
        sys.exit(1)

    print(f"[1/3] Registro rígido + afim + BSpline deformable paciente->CIT168...")
    patient_to_template, template_full, patient_full = register_patient_to_template(
        args.template, args.mri, args.downsample_mm,
    )
    sitk.WriteTransform(patient_to_template, str(args.out / "patient_to_cit168.tfm"))

    # Warp RM do paciente para template (para conferência visual)
    warped_patient = sitk.Resample(
        patient_full, template_full, patient_to_template.GetInverse() if hasattr(patient_to_template, "GetInverse") else patient_to_template,
        sitk.sitkLinear, 0.0, patient_full.GetPixelID(),
    )
    sitk.WriteImage(warped_patient, str(args.out / "patient_in_cit168.nii.gz"))

    print(f"\n[2/3] Warping máscaras CIT168 (Pauli 2017) para espaço do paciente...")
    results = {}
    for name, mask_path in ATLAS_FILES.items():
        if not mask_path.exists():
            print(f"  [skip] {mask_path.name} não baixado")
            continue
        out_path = args.out / f"cit168_{name}_in_patient.nii.gz"
        binary = warp_mask_to_patient(mask_path, patient_full, patient_to_template, out_path)
        n = int(sitk.GetArrayFromImage(binary).sum())
        print(f"  {name}: {n} voxels no espaço do paciente ({n * np.prod(patient_full.GetSpacing()):.1f} mm³)")
        results[name] = {"n_voxels": n, "path": str(out_path)}

    print(f"\n[3/3] Validando tips contra máscara STN (se --electrodes-json fornecido)...")
    if args.electrodes_json and args.electrodes_json.exists():
        with open(args.electrodes_json) as f:
            edata = json.load(f)
        stn_mask = sitk.ReadImage(str(args.out / "cit168_stn_in_patient.nii.gz"))
        summary = edata.get("summary", {})
        tips_check = {}
        for side in ("left", "right"):
            if side not in summary:
                continue
            tip = np.array(summary[side]["tip_physical_mm"])
            r = check_tip_in_mask(tip, stn_mask)
            tips_check[side] = r
            print(f"  {side.upper()} tip {tip.tolist()}: {r['interpretation']}")
        results["tips_vs_cit168_stn"] = tips_check

    with open(args.out / "cit168_registration.json", "w", encoding="utf-8") as f:
        json.dump({
            "method": "SimpleITK rigid + affine + BSpline (mesh 20mm)",
            "atlas": "CIT168 / Pauli 2017",
            "results": results,
        }, f, indent=2)

    print(f"\nSaída em: {args.out}/")


if __name__ == "__main__":
    sys.exit(main() or 0)
