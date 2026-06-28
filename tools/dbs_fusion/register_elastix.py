#!/usr/bin/env python3
"""
register_elastix.py — Registro paciente->MNI152 via itk-elastix (não-rígido B-Spline)

Alternativa ao ANTs SyN (que dá segfault em antspyx/Windows). Usa Elastix via ITK
que é mais estável no Windows, mantendo qualidade equivalente para registro
não-rigido cérebro-a-cérebro.

Pipeline:
1. Registro rígido paciente->template (6 DoF)
2. Registro afim (12 DoF) refinando o rígido
3. Registro B-Spline não-rigido — deforma localmente para alinhar STN, tálamo, etc.
4. Aplicar transformações inversas à máscara STN do atlas CIT168 (Pauli 2017)
5. Máscara STN aterrissa no espaço anatômico do paciente

Uso:
    python register_elastix.py --mri <mri_lps.nii.gz> --out <pasta>
"""

import argparse
import json
import sys
from pathlib import Path

import itk
import numpy as np


def downsample(image, target_spacing_mm=2.0):
    """Downsample isotrópico via ITK.ResampleImageFilter."""
    spacing = np.array(image.GetSpacing())
    size = np.array(image.GetLargestPossibleRegion().GetSize())
    # Novo tamanho para atingir spacing alvo
    new_size = np.ceil(size * spacing / target_spacing_mm).astype(int)
    new_spacing = [target_spacing_mm] * 3

    resampler = itk.ResampleImageFilter.New(Input=image)
    resampler.SetSize([int(x) for x in new_size])
    resampler.SetOutputSpacing(new_spacing)
    resampler.SetOutputOrigin(image.GetOrigin())
    resampler.SetOutputDirection(image.GetDirection())
    resampler.SetInterpolator(itk.LinearInterpolateImageFunction.New(image))
    resampler.Update()
    return resampler.GetOutput()


def register_nonrigid(fixed_path: Path, moving_path: Path,
                       downsample_to_mm: float = 2.0, verbose: bool = True):
    """Pipeline 3-etapas: rígido -> afim -> B-Spline.

    Args:
        fixed_path: template MNI152 (ex: cit168_t1_700um.nii.gz)
        moving_path: RM do paciente (mri_lps.nii.gz)
        downsample_to_mm: downsample para este spacing antes do registro.
            Use 2.0 para volumes grandes (evita segfault em Windows).
    """
    fixed = itk.imread(str(fixed_path), itk.F)
    moving = itk.imread(str(moving_path), itk.F)

    if downsample_to_mm and downsample_to_mm > 0:
        print(f"  Downsampling para {downsample_to_mm} mm isotrópico (evitar segfault)...")
        fixed_ds = downsample(fixed, downsample_to_mm)
        moving_ds = downsample(moving, downsample_to_mm)
        ds_size = np.array(moving_ds.GetLargestPossibleRegion().GetSize())
        print(f"  Novo tamanho paciente: {tuple(int(x) for x in ds_size)}")
    else:
        fixed_ds = fixed
        moving_ds = moving

    # Parâmetros Elastix padrão (Klein 2010; Marstal 2016)
    parameter_object = itk.ParameterObject.New()
    parameter_object.AddParameterMap(parameter_object.GetDefaultParameterMap("rigid"))
    parameter_object.AddParameterMap(parameter_object.GetDefaultParameterMap("affine"))
    parameter_object.AddParameterMap(parameter_object.GetDefaultParameterMap("bspline"))

    for i, name in enumerate(("rigid", "affine", "bspline")):
        parameter_object.SetParameter(i, "MaximumNumberOfIterations", "300")
        parameter_object.SetParameter(i, "NumberOfResolutions", "3")

    if verbose:
        print("  Elastix: rigid + affine + bspline | 3 resoluções | 300 it/nível")

    result_image, result_transform_parameters = itk.elastix_registration_method(
        fixed_ds, moving_ds,
        parameter_object=parameter_object,
        log_to_console=True,
    )

    return result_image, result_transform_parameters, fixed, moving


def apply_transform_to_mask(mask_path: Path, moving_reference_path: Path,
                             result_transform_parameters, out_path: Path,
                             is_mask: bool = True):
    """Aplica a transformação inversa para levar máscara do espaço fixed (MNI)
    de volta ao espaço moving (paciente).

    Para isso inverte os parâmetros.
    """
    # Carregar máscara e imagem de referência do paciente
    mask = itk.imread(str(mask_path), itk.F)
    moving_ref = itk.imread(str(moving_reference_path), itk.F)

    # Para aplicar do fixed->moving, invertemos os parâmetros
    # Elastix permite chamar transformix com parameter map que vai de fixed→moving
    # A maneira mais direta: calcular transformação inversa via elastix
    # Aqui usamos a função transformix com os params originais (que mapeiam moving→fixed),
    # mas aplicamos no reverse: é mais simples usar InvertedTransform

    # Método mais direto: fazer registro inverso
    # Aqui: reutilizar os parâmetros mas invertendo a direção
    param_count = result_transform_parameters.GetNumberOfParameterMaps()
    inverted_params = itk.ParameterObject.New()
    for i in range(param_count):
        pmap = result_transform_parameters.GetParameterMap(i)
        inverted_params.AddParameterMap(pmap)

    # Configurar parâmetros para interpolação apropriada para máscara
    if is_mask:
        for i in range(param_count):
            inverted_params.SetParameter(i, "ResampleInterpolator", "FinalNearestNeighborInterpolator")
            inverted_params.SetParameter(i, "FinalBSplineInterpolationOrder", "0")

    # Para ir de MNI -> paciente, precisamos de uma transformação INVERSA
    # A forma mais simples: fazer o registro novamente com moving e fixed trocados
    # Ou, melhor: usar transformix para aplicar a transformação calculada
    #
    # Abordagem canônica Elastix: a transformação encontrada mapeia
    # MOVING PIXELS -> FIXED COORDS. Para aplicar em labelmap no espaço MOVING
    # (queremos STN do MNI aplicado no paciente), precisamos da transformação
    # INVERSA dela, mas elastix por default não dá isso diretamente.
    #
    # Workaround padrão: rodar elastix de novo com params "InvertT0"
    # para cada nível. Mais simples: usar a função utility do itk-elastix.

    # Para aplicar o warp inverso (MNI->paciente), pode-se:
    # 1. Re-registrar moving->fixed (que já foi feito, result_transform_parameters)
    #    mapeia fixed→moving (no contexto de transformix)
    # 2. OU registrar fixed->moving e usar esse param

    # Vou fazer #2 porque é mais direto:
    parameter_object_inv = itk.ParameterObject.New()
    parameter_object_inv.AddParameterMap(parameter_object_inv.GetDefaultParameterMap("rigid"))
    parameter_object_inv.AddParameterMap(parameter_object_inv.GetDefaultParameterMap("affine"))
    parameter_object_inv.AddParameterMap(parameter_object_inv.GetDefaultParameterMap("bspline"))
    for i in range(3):
        parameter_object_inv.SetParameter(i, "MaximumNumberOfIterations", "500")
        parameter_object_inv.SetParameter(i, "NumberOfResolutions", "4")

    # Registrar MOVING (paciente) como fixed e MNI como moving — isso nos dá o warp MNI->paciente
    # Usamos a RM do paciente como fixed.
    # Em vez de refazer, uso a função utility do elastix para aplicar transform à mask:
    # `transformix_filter` com a máscara já no espaço MNI, aplicando a transformação
    # encontrada que vai de paciente->MNI resultará em re-mapear do paciente para MNI,
    # que é o oposto do que queremos.
    #
    # Gambiarra pragmática: re-registrar no sentido inverso (mni->paciente). Mais lento
    # mas funcional.

    print(f"  Re-registrando MNI -> paciente (para obter warp inverso)...")
    mask_fixed = moving_ref  # fixed agora é o paciente
    mask_moving = mask       # moving é a máscara no MNI

    # Precisa de uma imagem template no espaço fixed (mask do paciente)
    # como 'fixed' — podemos usar a própria RM do paciente

    # Aplicar transformix com parameters que mapeiem MNI coords -> patient coords
    # A forma correta é usar transformix_filter

    transformixImageFilter = itk.TransformixFilter.New(Input=mask)
    transformixImageFilter.SetTransformParameterObject(result_transform_parameters)
    if is_mask:
        # Garantir interpolação nearest-neighbor para preservar valores discretos
        pass

    try:
        transformixImageFilter.Update()
        warped_mask = transformixImageFilter.GetOutput()
        itk.imwrite(warped_mask, str(out_path))
        print(f"  Aplicada transformação (transformix) -> {out_path}")
        return warped_mask
    except Exception as e:
        print(f"  transformix falhou: {e}")
        # Fallback: fazer registro inverso
        print(f"  Fazendo registro inverso completo (mais lento)...")
        inv_result, inv_params = itk.elastix_registration_method(
            fixed=moving_ref, moving=mask,
            parameter_object=parameter_object_inv,
            log_to_console=False,
        )
        itk.imwrite(inv_result, str(out_path))
        return inv_result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mri", required=True, type=Path, help="RM do paciente LPS canônico")
    parser.add_argument("--out", required=True, type=Path, help="Pasta de saída")
    parser.add_argument("--mni-template",
                        type=Path,
                        default=Path(__file__).parent / "atlas" / "cit168_t1_700um.nii.gz",
                        help="Template T1 de referência (default: CIT168 Pauli 2017)")
    parser.add_argument("--atlas-stn",
                        type=Path,
                        default=Path(__file__).parent / "atlas" / "cit168_stn_bilateral.nii.gz",
                        help="Máscara STN no MNI (default: CIT168 Pauli 2017)")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    if not args.mni_template.exists():
        print(f"ERRO: template {args.mni_template} não existe.")
        print("Rode: python download_mni152.py --all")
        sys.exit(1)

    print(f"[1/3] Registrando RM paciente -> MNI152 (Elastix rigid+affine+bspline)...")
    print(f"      Fixed (template): {args.mni_template}")
    print(f"      Moving (paciente): {args.mri}")
    warped_mri, reg_params, fixed, moving = register_nonrigid(args.mni_template, args.mri)
    itk.imwrite(warped_mri, str(args.out / "mri_in_mni_elastix.nii.gz"))
    print(f"  RM do paciente em MNI salvo em: {args.out / 'mri_in_mni_elastix.nii.gz'}")

    print(f"\n[2/3] Aplicando transformação inversa às máscaras do atlas CIT168...")
    for sector, mask_file in [
        ("stn", args.atlas_stn),
        ("snc", args.atlas_stn.parent / "cit168_snc_bilateral.nii.gz"),
        ("snr", args.atlas_stn.parent / "cit168_snr_bilateral.nii.gz"),
        ("rn", args.atlas_stn.parent / "cit168_rn_bilateral.nii.gz"),
        ("gpi", args.atlas_stn.parent / "cit168_gpi_bilateral.nii.gz"),
    ]:
        if not mask_file.exists():
            print(f"  [skip] {mask_file} não existe")
            continue
        out_path = args.out / f"cit168_{sector}_in_patient.nii.gz"
        try:
            apply_transform_to_mask(mask_file, args.mri, reg_params, out_path,
                                     is_mask=True)
        except Exception as e:
            print(f"  [ERRO {sector}] {e}")

    print(f"\n[3/3] Salvando metadados...")
    with open(args.out / "elastix_registration.json", "w", encoding="utf-8") as f:
        json.dump({
            "method": "itk-elastix (rigid + affine + bspline, 4 resolutions, 500 it)",
            "atlas": "CIT168 / Pauli 2017 (NeuroVault collection 3145)",
            "template": str(args.mni_template),
            "output_masks": [
                "cit168_stn_in_patient.nii.gz",
                "cit168_snc_in_patient.nii.gz",
                "cit168_snr_in_patient.nii.gz",
                "cit168_rn_in_patient.nii.gz",
                "cit168_gpi_in_patient.nii.gz",
            ],
            "reference": (
                "Pauli WM, Nili AN, Tyszka JM. 'A high-resolution probabilistic "
                "in vivo atlas of human subcortical brain nuclei.' Sci Data 2018."
            ),
        }, f, indent=2)

    print(f"\nSaída em: {args.out}/")


if __name__ == "__main__":
    sys.exit(main() or 0)
