#!/usr/bin/env python3
"""
detect_electrodes.py — Detecção de eletrodos DBS em TC registrada à RM

Abordagem robusta a orientações arbitrárias da imagem (axial/sagital/coronal):
todas as análises geométricas são feitas em coordenadas LPS FÍSICAS (mm),
usando TransformIndexToPhysicalPoint do SimpleITK.

Pipeline:
1. Threshold HU (padrão 2000; pode ser ajustado).
2. Para cada voxel positivo, converter para LPS físico.
3. Estimar linha média anatômica pelo centroide do crânio (HU 300-1500).
4. Clustering espacial em LPS (DBSCAN) — agrupa pontos próximos.
5. Para cada cluster, calcular propriedades geométricas em LPS (extensão
   lateral, AP, SI) e filtrar por forma tubular vertical fina.
6. Classificar eletrodo esquerdo/direito por X_lps.
7. Calcular assimetria AP e lateral entre os tips.

LPS canônico: X+ = esquerda do paciente, Y+ = posterior, Z+ = superior.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from scipy import ndimage
from sklearn.cluster import DBSCAN

try:
    from anatomical_targets import (
        classify_tip_position,
        estimate_mcp_from_midline_and_skull,
        estimate_mcp_from_electrode_tips,
        CartesiaElectrode,
    )
    HAS_ANATOMICAL = True
except ImportError:
    HAS_ANATOMICAL = False

try:
    from stn_atlas import generate_stn_mask_image, tip_in_stn_mask
    HAS_STN_ATLAS = True
except ImportError:
    HAS_STN_ATLAS = False

try:
    from vta_simulation import StimulationSettings, simulate_vta_for_electrode
    HAS_VTA = True
except ImportError:
    HAS_VTA = False


ELECTRODE_HU_THRESHOLD = 2000
MIN_CLUSTER_POINTS = 20


def all_voxels_to_lps(ct: sitk.Image, mask: np.ndarray) -> np.ndarray:
    """Converte todos os voxels ativos da máscara para coordenadas LPS físicas.

    Retorna array (N, 3) com cada linha = (x_lps, y_lps, z_lps) em mm.
    """
    # np.argwhere(mask) retorna em ordem (z, y, x), que é como numpy indexa SITK
    zyx = np.argwhere(mask)  # shape (N, 3)
    # SimpleITK TransformIndexToPhysicalPoint espera (x, y, z)
    xyz = zyx[:, ::-1]

    # Vetorização: usar direction matrix e origin diretamente
    origin = np.array(ct.GetOrigin())
    spacing = np.array(ct.GetSpacing())
    direction = np.array(ct.GetDirection()).reshape(3, 3)
    # LPS = origin + direction @ (voxel * spacing)
    lps = origin + (xyz * spacing) @ direction.T
    return lps


def estimate_midline_x_lps(ct: sitk.Image, ct_array: np.ndarray,
                            hu_low=300, hu_high=1500) -> float:
    """Estima linha média anatômica (X_LPS = 0) pela simetria do crânio.

    Devolve X_LPS médio dos voxels de osso — aproximação da linha média.
    """
    skull = (ct_array > hu_low) & (ct_array < hu_high)
    # Amostrar (muito voxel de osso => subamostrar)
    zyx = np.argwhere(skull)
    if len(zyx) == 0:
        return 0.0
    if len(zyx) > 200_000:
        idx = np.random.default_rng(42).choice(len(zyx), 200_000, replace=False)
        zyx = zyx[idx]
    xyz = zyx[:, ::-1]
    origin = np.array(ct.GetOrigin())
    spacing = np.array(ct.GetSpacing())
    direction = np.array(ct.GetDirection()).reshape(3, 3)
    lps = origin + (xyz * spacing) @ direction.T
    return float(np.mean(lps[:, 0]))


def cluster_in_lps(points_lps: np.ndarray, eps_mm: float = 3.0,
                   min_samples: int = MIN_CLUSTER_POINTS):
    """Clustering DBSCAN em LPS físico. eps_mm = distância máxima entre vizinhos.

    eps=3mm une fragmentos do mesmo eletrodo quebrado por artefato streak,
    sem agregar eletrodos bilaterais (espaçados ~25mm na linha média).
    """
    clustering = DBSCAN(eps=eps_mm, min_samples=min_samples).fit(points_lps)
    return clustering.labels_


def crop_to_brain_roi(points_lps: np.ndarray, midline_x_lps: float,
                      lateral_limit_mm: float = 35,
                      ap_limit_mm: float = 40,
                      si_low_mm: float = -15,
                      si_high_mm: float = 60) -> np.ndarray:
    """Retorna máscara booleana selecionando pontos dentro da ROI cerebral profunda.

    Exclui: IPG torácico, cabos de extensão laterais ao couro cabeludo, pele,
    grampos cirúrgicos externos. Inclui: trajetória dos eletrodos + STN.

    Limites (podem ser ajustados por argumento):
    - |X_LPS - midline| < lateral_limit_mm — perto da linha média anatômica
    - |Y_LPS| < ap_limit_mm — plano médio antero-posterior
    - si_low < Z_LPS < si_high — do topo do crânio até o núcleo subtalâmico
    """
    x, y, z = points_lps[:, 0], points_lps[:, 1], points_lps[:, 2]
    mask = (
        (np.abs(x - midline_x_lps) < lateral_limit_mm) &
        (np.abs(y) < ap_limit_mm) &
        (z > si_low_mm) &
        (z < si_high_mm)
    )
    return mask


def cluster_properties(points_lps: np.ndarray):
    """Calcula propriedades geométricas do cluster em LPS (mm)."""
    x, y, z = points_lps[:, 0], points_lps[:, 1], points_lps[:, 2]
    centroid = points_lps.mean(axis=0)
    extent = {
        "x_lps_mm": float(x.max() - x.min()),  # lateral
        "y_lps_mm": float(y.max() - y.min()),  # AP
        "z_lps_mm": float(z.max() - z.min()),  # SI
    }
    # Um "eletrodo" é: fino em lateral, fino em AP, comprido em SI
    # (estimulação DBS tem trajetória oblíqua pelo cérebro)
    return {
        "n_points": int(len(points_lps)),
        "centroid_lps": centroid.tolist(),
        "extent_lps_mm": extent,
        "x_range": [float(x.min()), float(x.max())],
        "y_range": [float(y.min()), float(y.max())],
        "z_range": [float(z.min()), float(z.max())],
    }


def is_likely_electrode(props, midline_x_lps: float,
                        max_lateral_distance_mm: float = 35,
                        min_si_extent_mm: float = 25,
                        min_aspect_ratio: float = 1.5):
    """Heurística: eletrodo DBS é estrutura tubular alongada verticalmente,
    dentro da cabeça, próxima da linha média.

    Em vez de limite absoluto de espessura (falha quando streak artifact
    expande o diâmetro aparente), usa aspect ratio SI/max(X,Y).
    """
    centroid = props["centroid_lps"]
    lateral_dist = abs(centroid[0] - midline_x_lps)
    ext = props["extent_lps_mm"]
    max_thickness = max(ext["x_lps_mm"], ext["y_lps_mm"])
    aspect_ratio = ext["z_lps_mm"] / max(max_thickness, 0.1)

    reasons = []
    if lateral_dist > max_lateral_distance_mm:
        reasons.append(f"lateral demais ({lateral_dist:.1f} mm)")
    if ext["z_lps_mm"] < min_si_extent_mm:
        reasons.append(f"SI curto ({ext['z_lps_mm']:.1f} mm)")
    if aspect_ratio < min_aspect_ratio:
        reasons.append(f"não-tubular (AR={aspect_ratio:.1f})")

    return (len(reasons) == 0, reasons)


def build_trajectory(points_lps: np.ndarray, n_points: int = 20):
    """Trajetória do eletrodo: amostragem por Z_LPS, com centroide XY em cada bin.

    Para cada bin vertical, toma os pontos na faixa de Z e calcula o
    centroide XY. Isso filtra streak artifact lateral — em cada altura,
    o centroide concentra no eixo do eletrodo.
    """
    z = points_lps[:, 2]
    z_min, z_max = z.min(), z.max()
    bins = np.linspace(z_min, z_max, n_points + 1)
    trajectory = []
    for i in range(n_points):
        mask = (z >= bins[i]) & (z < bins[i + 1])
        if mask.sum() == 0:
            continue
        pt = points_lps[mask].mean(axis=0)
        trajectory.append({"physical_mm": pt.tolist()})
    return trajectory


def extract_electrode_axis_pca(points_lps: np.ndarray):
    """Extrai o eixo principal do eletrodo via PCA e mede quão 'reto' é.

    Retorna:
        direction: vetor unitário do eixo principal
        variance_explained: % da variância explicada pelo eixo principal
        length_mm: comprimento do eletrodo ao longo do eixo
    """
    centroid = points_lps.mean(axis=0)
    centered = points_lps - centroid
    cov = np.cov(centered.T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    # eigvalues em ordem crescente
    idx = np.argsort(eigvals)[::-1]
    eigvals = eigvals[idx]
    eigvecs = eigvecs[:, idx]

    main_axis = eigvecs[:, 0]
    variance_explained = float(eigvals[0] / eigvals.sum())

    # Projetar pontos no eixo principal para medir comprimento
    projections = centered @ main_axis
    length_mm = float(projections.max() - projections.min())

    return {
        "direction": main_axis.tolist(),
        "variance_explained": variance_explained,
        "length_mm": length_mm,
        "centroid_lps": centroid.tolist(),
    }


def classify_left_right(electrodes):
    """Esquerdo/direito por X_LPS do centroide. LPS: X+ = esquerda do paciente."""
    if len(electrodes) < 2:
        return None, f"Apenas {len(electrodes)} eletrodo(s) detectado(s)."

    electrodes = sorted(electrodes, key=lambda e: e["props"]["centroid_lps"][0])
    right = electrodes[0]  # X_LPS menor = direita do paciente
    left = electrodes[-1]  # X_LPS maior = esquerda do paciente
    others = electrodes[1:-1]

    result = {
        "left": left["trajectory"],
        "right": right["trajectory"],
    }
    for i, o in enumerate(others):
        result[f"other_{i}"] = o["trajectory"]
    return result, None


def compute_summary(classified, mcp_lps=None):
    summary = {}
    for side, traj in classified.items():
        if not traj:
            continue
        # Tip = ponto com Z_LPS mínimo (mais inferior = mais profundo no cérebro)
        tip = min(traj, key=lambda p: p["physical_mm"][2])
        top = max(traj, key=lambda p: p["physical_mm"][2])
        tip_arr = np.array(tip["physical_mm"])
        top_arr = np.array(top["physical_mm"])
        length = float(np.linalg.norm(top_arr - tip_arr))
        axis = (top_arr - tip_arr) / max(length, 1e-6)

        entry = {
            "tip_physical_mm": tip["physical_mm"],
            "top_physical_mm": top["physical_mm"],
            "length_mm": length,
            "axis_unit": axis.tolist(),
            "n_points": len(traj),
        }

        # Modelo Cartesia + classificação anatômica (se disponível)
        if HAS_ANATOMICAL and side in ("left", "right"):
            model = CartesiaElectrode()
            entry["cartesia_contacts_lps"] = {
                name: pos.tolist()
                for name, pos in model.contact_positions_on_axis(tip_arr, axis).items()
            }
            entry["anatomical_classification"] = classify_tip_position(
                tip_arr, side, midpoint_commissural_lps=mcp_lps
            )

        summary[side] = entry

    if "left" in summary and "right" in summary:
        tip_l = summary["left"]["tip_physical_mm"]
        tip_r = summary["right"]["tip_physical_mm"]
        summary["asymmetry"] = {
            "ap_diff_mm_left_minus_right": float(tip_l[1] - tip_r[1]),
            "lateral_diff_mm_left_minus_right": float(tip_l[0] - tip_r[0]),
            "si_diff_mm_left_minus_right": float(tip_l[2] - tip_r[2]),
            "note": (
                "LPS: X+=esquerda do paciente, Y+=posterior, Z+=superior. "
                "ap_diff < 0 => esquerdo mais anterior que direito."
            ),
        }
    return summary


def _parse_lps_triple(s: str):
    """Parse 'x,y,z' em mm LPS para np.array."""
    parts = [float(p.strip()) for p in s.split(",")]
    if len(parts) != 3:
        raise argparse.ArgumentTypeError(f"Esperado x,y,z, recebi {s!r}")
    return np.array(parts)


def main():
    parser = argparse.ArgumentParser(description="Detecção de eletrodos DBS em CT fusionada com RM")
    parser.add_argument("--ct", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--threshold", type=int, default=ELECTRODE_HU_THRESHOLD)
    parser.add_argument("--debug", action="store_true")
    # Referencial anatômico manual — elimina circularidade da classificação
    parser.add_argument("--mcp", type=_parse_lps_triple, default=None,
                        metavar="x,y,z",
                        help="MCP (midpoint commissural) em LPS mm. Se fornecido, usa este valor "
                             "em vez da heurística do midpoint dos tips (que é circular).")
    parser.add_argument("--ac", type=_parse_lps_triple, default=None, metavar="x,y,z",
                        help="Anterior Commissure em LPS mm. Usado com --pc para calcular MCP.")
    parser.add_argument("--pc", type=_parse_lps_triple, default=None, metavar="x,y,z",
                        help="Posterior Commissure em LPS mm. Usado com --ac para calcular MCP.")
    args = parser.parse_args()

    # Resolver MCP manual se fornecido
    manual_mcp = None
    if args.mcp is not None:
        manual_mcp = args.mcp
    elif args.ac is not None and args.pc is not None:
        manual_mcp = (args.ac + args.pc) / 2.0
        print(f"[INFO] MCP calculado de AC+PC fornecidos: "
              f"({manual_mcp[0]:+.1f}, {manual_mcp[1]:+.1f}, {manual_mcp[2]:+.1f}) LPS")
    args.manual_mcp = manual_mcp

    args.out.mkdir(parents=True, exist_ok=True)

    print(f"[1/5] Lendo CT {args.ct}...")
    ct = sitk.ReadImage(str(args.ct))
    ct_array = sitk.GetArrayFromImage(ct)

    print(f"[2/5] Estimando linha média anatômica (X_LPS do crânio)...")
    midline_x_lps = estimate_midline_x_lps(ct, ct_array)
    print(f"  Linha média X_LPS = {midline_x_lps:+.2f} mm")

    print(f"[3/5] Thresholding HU > {args.threshold} e conversão para LPS...")
    mask = ct_array > args.threshold
    n_voxels = int(mask.sum())
    print(f"  {n_voxels} voxels positivos")
    if n_voxels == 0:
        print("ERRO: nenhum voxel acima do threshold.")
        sys.exit(1)

    points_lps = all_voxels_to_lps(ct, mask)
    print(f"  Bbox LPS (antes do ROI): "
          f"X=[{points_lps[:, 0].min():.1f}, {points_lps[:, 0].max():.1f}]  "
          f"Y=[{points_lps[:, 1].min():.1f}, {points_lps[:, 1].max():.1f}]  "
          f"Z=[{points_lps[:, 2].min():.1f}, {points_lps[:, 2].max():.1f}]")

    # ROI cerebral profunda — remove IPG, cabos laterais, pele
    roi_mask = crop_to_brain_roi(points_lps, midline_x_lps)
    points_lps = points_lps[roi_mask]
    print(f"  Após ROI cerebral: {len(points_lps)} pontos")
    print(f"  Bbox LPS (pós ROI): "
          f"X=[{points_lps[:, 0].min():.1f}, {points_lps[:, 0].max():.1f}]  "
          f"Y=[{points_lps[:, 1].min():.1f}, {points_lps[:, 1].max():.1f}]  "
          f"Z=[{points_lps[:, 2].min():.1f}, {points_lps[:, 2].max():.1f}]")

    print(f"[4/5] Clustering DBSCAN (eps=3 mm, min_samples=20)...")
    labels = cluster_in_lps(points_lps)
    unique_labels = set(labels) - {-1}
    print(f"  {len(unique_labels)} clusters (+ {(labels == -1).sum()} pontos de ruído)")

    print(f"[5/5] Filtrando e classificando...")
    electrodes = []
    all_clusters = []
    for lab in sorted(unique_labels):
        pts = points_lps[labels == lab]
        props = cluster_properties(pts)
        all_clusters.append({"lab": lab, "props": props, "points": pts})
        ok, reasons = is_likely_electrode(props, midline_x_lps)
        tag = "ELETRODO" if ok else f"rejeitado ({'; '.join(reasons)})"
        if args.debug or not ok or len(unique_labels) <= 15:
            c = props["centroid_lps"]
            e = props["extent_lps_mm"]
            print(f"    cluster {lab}: n={props['n_points']:5d}  "
                  f"centro_LPS=({c[0]:+7.1f},{c[1]:+7.1f},{c[2]:+7.1f})  "
                  f"extent=(X={e['x_lps_mm']:5.1f}, Y={e['y_lps_mm']:5.1f}, "
                  f"Z={e['z_lps_mm']:5.1f})  [{tag}]")
        if ok:
            electrodes.append({
                "lab": lab, "props": props, "points": pts,
                "trajectory": build_trajectory(pts),
            })

    print(f"\n  >>> {len(electrodes)} cluster(s) classificado(s) como eletrodo <<<")

    classified, warning = classify_left_right(electrodes)
    if warning:
        print(f"  AVISO: {warning}")

    # Estimar MCP (midpoint commissural) para referência anatômica
    # Prioridade: (1) MCP manual via --mcp ou --ac/--pc; (2) midpoint dos tips (circular);
    # (3) heurística do crânio (grosseira).
    mcp_lps = None
    mcp_method = None
    if args.manual_mcp is not None:
        mcp_lps = args.manual_mcp
        mcp_method = "manual (AC/PC marcados por radiologista ou valor fornecido)"
    elif HAS_ANATOMICAL and classified:
        if "left" in classified and "right" in classified:
            tip_l = min(classified["left"], key=lambda p: p["physical_mm"][2])["physical_mm"]
            tip_r = min(classified["right"], key=lambda p: p["physical_mm"][2])["physical_mm"]
            mcp_lps = estimate_mcp_from_electrode_tips(tip_l, tip_r)
            mcp_method = "midpoint dos tips + offset STN-MCP (CIRCULAR — use --mcp se possível)"
        else:
            mcp_lps = estimate_mcp_from_midline_and_skull(
                ct_array, ct.GetSpacing()[0], ct.GetOrigin()
            )
            mcp_method = "heurística do crânio (grosseira)"
    if mcp_lps is not None:
        print(f"  MCP ({mcp_method}): "
              f"({mcp_lps[0]:+.1f}, {mcp_lps[1]:+.1f}, {mcp_lps[2]:+.1f}) LPS")

    summary = compute_summary(classified, mcp_lps=mcp_lps) if classified else {}
    if mcp_lps is not None:
        summary["_mcp_estimation"] = {
            "mcp_lps": mcp_lps.tolist(),
            "method": mcp_method,
            "note": (
                "MCP estimado heuristicamente. Para análise estereotáxica de precisão, "
                "marcar AC e PC manualmente por radiologista."
            ),
        }

    # Máscara STN (atlas elipsoidal MNI-referenced) + verificação dos tips
    if HAS_STN_ATLAS and mcp_lps is not None and classified:
        print(f"\n[+] Gerando máscara STN elipsoidal (MNI-referenced)...")
        try:
            for sector in ("motor", "associative", "limbic"):
                mask = generate_stn_mask_image(ct, mcp_lps, sector)
                sitk.WriteImage(mask, str(args.out / f"stn_mask_{sector}.nii.gz"))
                print(f"  stn_mask_{sector}.nii.gz salvo")

            # Verificar cada tip contra a máscara motor
            mask_motor = sitk.ReadImage(str(args.out / "stn_mask_motor.nii.gz"))
            for side in ("left", "right"):
                if side in classified:
                    tip_lps = np.array(
                        min(classified[side], key=lambda p: p["physical_mm"][2])["physical_mm"]
                    )
                    check = tip_in_stn_mask(tip_lps, mask_motor)
                    print(f"  Tip {side}: {check['interpretation']}  "
                          f"(d={check['signed_distance_mm']:+.2f} mm)")
                    if side in summary:
                        summary[side]["stn_mask_check"] = check
        except Exception as e:
            print(f"  (pulando máscara STN: {e})")

    # Simulação de VTA — usa parâmetros de exemplo (ajuste ao programa ativo real)
    if HAS_VTA and classified:
        print(f"\n[+] Simulando VTA (Kuncel 2004 simplificado)...")
        default_stim = {
            "left": StimulationSettings(
                side="left", contact="2A",
                amplitude_mA=5.8, pulse_width_us=60, frequency_Hz=119,
                impedance_ohm=2880,
            ),
            "right": StimulationSettings(
                side="right", contact="2C",
                amplitude_mA=6.6, pulse_width_us=70, frequency_Hz=119,
                impedance_ohm=1024,
            ),
        }

        # STN centers em LPS relativos ao MCP
        from anatomical_targets import STN_MOTOR_MCP_COORDINATES
        stn_centers_lps = {}
        for side in ("left", "right"):
            if side not in classified:
                continue
            sign = 1 if side == "left" else -1
            stn_centers_lps[side] = {
                "motor": (mcp_lps + np.array([sign * 11.5, -2.0, -4.0])).tolist(),
                "associative": (mcp_lps + np.array([sign * 9.0, 0.5, -3.0])).tolist(),
                "limbic": (mcp_lps + np.array([sign * 7.0, 3.0, -2.5])).tolist(),
            }

        for side in ("left", "right"):
            if side not in summary:
                continue
            tip_lps = np.array(summary[side]["tip_physical_mm"])
            axis = np.array(summary[side]["axis_unit"])
            stim = default_stim[side]
            vta = simulate_vta_for_electrode(
                tip_lps, axis, stim.contact, stim,
                stn_centers_lps[side], np.array([4.5, 3.5, 4.0]),
            )
            summary[side]["vta_simulation"] = vta
            overlaps = vta["overlap_with_stn"]
            print(f"  {side.upper()} {stim.contact}: raio VTA = {vta['vta_radius_mm']:.2f} mm")
            for sector in ("motor", "associative", "limbic"):
                frac = overlaps[sector]["fraction_of_vta_hitting_target"]
                print(f"    overlap STN {sector}: {frac*100:.1f}%")

    # Salvar máscara: reconstruir voxel de cada ponto LPS aceito
    # ATENÇÃO: 'mask' original (boolean) foi sobrescrito acima; reconstruir a partir do ct_array.
    threshold_mask = ct_array > args.threshold
    electrode_mask = np.zeros(ct_array.shape, dtype=np.uint8)
    zyx_original = np.argwhere(threshold_mask)
    zyx_after_roi = zyx_original[roi_mask]
    for i, e in enumerate(electrodes, start=1):
        cluster_id = e["lab"]
        cluster_pts_idx = np.where(labels == cluster_id)[0]
        for idx in cluster_pts_idx:
            z, y, x = zyx_after_roi[idx]
            electrode_mask[z, y, x] = i

    labels_sitk = sitk.GetImageFromArray(electrode_mask)
    labels_sitk.CopyInformation(ct)
    sitk.WriteImage(labels_sitk, str(args.out / "electrode_labels.nii.gz"))

    output = {
        "threshold_hu": args.threshold,
        "n_voxels_above_threshold": n_voxels,
        "n_clusters_total": len(unique_labels),
        "n_electrodes_accepted": len(electrodes),
        "midline_x_lps_mm": midline_x_lps,
        "coordinate_system": "DICOM LPS (x=esquerda do paciente, y=posterior, z=superior)",
        "trajectories": {
            side: [p["physical_mm"] for p in traj]
            for side, traj in (classified or {}).items()
        },
        "summary": summary,
    }

    with open(args.out / "electrodes.json", "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nSaída: {args.out / 'electrodes.json'}")
    if "asymmetry" in summary:
        a = summary["asymmetry"]
        print(f"\n========== ASSIMETRIA DETECTADA ==========")
        print(f"  Diferença AP   (esq - dir): {a['ap_diff_mm_left_minus_right']:+.2f} mm")
        print(f"  Diferença lat  (esq - dir): {a['lateral_diff_mm_left_minus_right']:+.2f} mm")
        print(f"  Diferença SI   (esq - dir): {a['si_diff_mm_left_minus_right']:+.2f} mm")
        if abs(a["ap_diff_mm_left_minus_right"]) > 3:
            print(f"\n  [!] ASSIMETRIA AP SIGNIFICATIVA (>3 mm)")
            if a['ap_diff_mm_left_minus_right'] < -3:
                print(f"      Eletrodo ESQUERDO está MAIS ANTERIOR.")
            else:
                print(f"      Eletrodo DIREITO está MAIS ANTERIOR.")


if __name__ == "__main__":
    sys.exit(main() or 0)
