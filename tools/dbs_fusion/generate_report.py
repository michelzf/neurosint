#!/usr/bin/env python3
"""
generate_report.py — Relatório visual e textual da análise DBS

Produz:
    comparison.png  — visualizações anatômicas (axial/coronal/sagital no LPS canônico)
    stn_target.png  — close-up axial no nível do STN com tips sobrepostos
    report.md       — relatório textual com assimetrias e classificação anatômica
"""

import argparse
import json
import os
import sys
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import Ellipse, Circle
import numpy as np
import SimpleITK as sitk


def lps_to_voxel_lps_canonical(lps_xyz, origin_lps, spacing_mm):
    """Converte LPS (mm) para índice de voxel num volume LPS canônico axial.

    Assume direction = identidade.
    """
    x, y, z = lps_xyz
    ox, oy, oz = origin_lps
    if np.isscalar(spacing_mm):
        sx = sy = sz = spacing_mm
    else:
        sx, sy, sz = spacing_mm
    return (
        int(round((x - ox) / sx)),
        int(round((y - oy) / sy)),
        int(round((z - oz) / sz)),
    )


def plot_comparison(ct_path, labels_path, mri_path, electrodes_json, output):
    """Visualizações axial/coronal/sagital centradas no tip do eletrodo esquerdo."""
    ct = sitk.ReadImage(str(ct_path))
    labels = sitk.ReadImage(str(labels_path))
    ct_arr = sitk.GetArrayFromImage(ct)
    lbl_arr = sitk.GetArrayFromImage(labels)

    mri_arr = None
    if mri_path and mri_path.exists():
        mri = sitk.ReadImage(str(mri_path))
        mri_arr = sitk.GetArrayFromImage(mri)

    with open(electrodes_json) as f:
        data = json.load(f)

    summary = data.get("summary", {})
    origin = np.array(ct.GetOrigin())
    spacing = np.array(ct.GetSpacing())

    # Centro da visualização: nível do tip esquerdo (se houver), senão centro do volume
    if "left" in summary:
        center_lps = np.array(summary["left"]["tip_physical_mm"])
    elif lbl_arr.any():
        zs, ys, xs = np.where(lbl_arr > 0)
        center_voxel = (int(xs.mean()), int(ys.mean()), int(zs.mean()))
        # converter para LPS (canônico)
        center_lps = origin + np.array(center_voxel) * spacing
    else:
        center_voxel = (ct_arr.shape[2] // 2, ct_arr.shape[1] // 2, ct_arr.shape[0] // 2)
        center_lps = origin + np.array(center_voxel) * spacing

    ix, iy, iz = lps_to_voxel_lps_canonical(center_lps, origin, spacing)
    # Limitar dentro do array
    iz = int(np.clip(iz, 0, ct_arr.shape[0] - 1))
    iy = int(np.clip(iy, 0, ct_arr.shape[1] - 1))
    ix = int(np.clip(ix, 0, ct_arr.shape[2] - 1))

    # Plot 3x3: linhas = axial/coronal/sagital; colunas = RM / TC bone / TC+eletrodos
    fig, axes = plt.subplots(3, 3, figsize=(14, 14))

    slices = {
        "axial": {
            "ct": ct_arr[iz, :, :],
            "lbl": lbl_arr[iz, :, :],
            "mri": mri_arr[iz, :, :] if mri_arr is not None else None,
            "title": f"Axial (Z={center_lps[2]:+.1f} mm LPS, voxel idx {iz})",
        },
        "coronal": {
            "ct": ct_arr[:, iy, :],
            "lbl": lbl_arr[:, iy, :],
            "mri": mri_arr[:, iy, :] if mri_arr is not None else None,
            "title": f"Coronal (Y={center_lps[1]:+.1f} mm LPS, voxel idx {iy})",
        },
        "sagittal": {
            "ct": ct_arr[:, :, ix],
            "lbl": lbl_arr[:, :, ix],
            "mri": mri_arr[:, :, ix] if mri_arr is not None else None,
            "title": f"Sagital (X={center_lps[0]:+.1f} mm LPS, voxel idx {ix})",
        },
    }

    for row, (view, slc) in enumerate(slices.items()):
        # RM
        ax = axes[row, 0]
        if slc["mri"] is not None:
            ax.imshow(slc["mri"], cmap="gray", origin="lower")
        ax.set_title(f"RM — {slc['title']}")
        ax.axis("off")

        # TC bone
        ax = axes[row, 1]
        ax.imshow(slc["ct"], cmap="gray", vmin=-400, vmax=1000, origin="lower")
        ax.set_title(f"TC — {slc['title']}")
        ax.axis("off")

        # TC + eletrodos
        ax = axes[row, 2]
        ax.imshow(slc["ct"], cmap="gray", vmin=-400, vmax=1000, origin="lower")
        overlay = np.ma.masked_where(slc["lbl"] == 0, slc["lbl"])
        ax.imshow(overlay, cmap="autumn", alpha=0.8, origin="lower")
        ax.set_title(f"TC + eletrodos — {slc['title']}")
        ax.axis("off")

    # Adicionar esquema de orientação
    fig.suptitle(
        "Fusão TC+RM em espaço LPS canônico (X=LR, Y=AP, Z=SI)\n"
        "Axial: lado DIREITO da imagem = lado DIREITO do paciente",
        fontsize=12, fontweight="bold", y=0.99,
    )
    fig.tight_layout()
    fig.savefig(output, dpi=100, bbox_inches="tight")
    plt.close(fig)
    print(f"  Visualização anatômica: {output}")


def plot_stn_target(ct_path, labels_path, electrodes_json, output):
    """Close-up axial no nível do tip com anotações anatômicas."""
    ct = sitk.ReadImage(str(ct_path))
    labels = sitk.ReadImage(str(labels_path))
    ct_arr = sitk.GetArrayFromImage(ct)
    lbl_arr = sitk.GetArrayFromImage(labels)
    origin = np.array(ct.GetOrigin())
    spacing = np.array(ct.GetSpacing())

    with open(electrodes_json) as f:
        data = json.load(f)

    summary = data.get("summary", {})
    if "left" not in summary or "right" not in summary:
        print("  (pulando stn_target.png — sem left+right)")
        return

    fig, axes = plt.subplots(1, 2, figsize=(14, 7))

    for col, side in enumerate(("left", "right")):
        tip_lps = np.array(summary[side]["tip_physical_mm"])
        ix, iy, iz = lps_to_voxel_lps_canonical(tip_lps, origin, spacing)
        iz = int(np.clip(iz, 0, ct_arr.shape[0] - 1))

        ax = axes[col]
        ax.imshow(ct_arr[iz], cmap="gray", vmin=-400, vmax=1000, origin="lower")
        overlay = np.ma.masked_where(lbl_arr[iz] == 0, lbl_arr[iz])
        ax.imshow(overlay, cmap="autumn", alpha=0.8, origin="lower")

        # Anatomical classification
        cls = summary[side].get("anatomical_classification")
        if cls:
            stn_motor = cls["stn_sector_centers_lps"]["motor"]
            motor_voxel = lps_to_voxel_lps_canonical(stn_motor, origin, spacing)
            ax.scatter([motor_voxel[0]], [motor_voxel[1]],
                       s=180, marker="+", color="cyan", linewidth=3,
                       label="STN motor (teórico)")
            assoc_lps = cls["stn_sector_centers_lps"]["associative"]
            assoc_voxel = lps_to_voxel_lps_canonical(assoc_lps, origin, spacing)
            ax.scatter([assoc_voxel[0]], [assoc_voxel[1]],
                       s=120, marker="x", color="yellow", linewidth=2,
                       label="STN associativo")
            limbic_lps = cls["stn_sector_centers_lps"]["limbic"]
            limbic_voxel = lps_to_voxel_lps_canonical(limbic_lps, origin, spacing)
            ax.scatter([limbic_voxel[0]], [limbic_voxel[1]],
                       s=120, marker="^", color="magenta", linewidth=2,
                       label="STN límbico")

            ax.scatter([ix], [iy], s=150, marker="o",
                       facecolor="none", edgecolor="red", linewidth=3,
                       label="Tip detectado")

            class_str = cls["classification"]
            d_motor = cls["distances_to_sectors_mm"]["motor"]
            ax.set_title(
                f"{side.upper()} — tip em ({tip_lps[0]:+.1f}, {tip_lps[1]:+.1f}, {tip_lps[2]:+.1f}) mm LPS\n"
                f"{class_str}  |  distância ao STN motor: {d_motor:.2f} mm",
                fontsize=10,
            )
            ax.legend(loc="upper right", fontsize=8)
        else:
            ax.set_title(f"{side.upper()} tip")

        # Zoom na região STN (~40x40 mm)
        zoom_half_voxels = int(40 / spacing[0])
        x_lo = max(0, ix - zoom_half_voxels)
        x_hi = min(ct_arr.shape[2], ix + zoom_half_voxels)
        y_lo = max(0, iy - zoom_half_voxels)
        y_hi = min(ct_arr.shape[1], iy + zoom_half_voxels)
        ax.set_xlim(x_lo, x_hi)
        ax.set_ylim(y_lo, y_hi)

    fig.suptitle(
        "Comparação: tips detectados vs alvos STN teóricos (MCP-referenced)",
        fontsize=12, fontweight="bold",
    )
    fig.tight_layout()
    fig.savefig(output, dpi=120, bbox_inches="tight")
    plt.close(fig)
    print(f"  Visualização STN: {output}")


def write_markdown_report(electrodes_json, report_path):
    with open(electrodes_json) as f:
        data = json.load(f)

    lines = []
    lines.append("# Relatório de Análise de Eletrodos DBS")
    lines.append("")
    lines.append(f"**Sistema de coordenadas:** {data['coordinate_system']}")
    lines.append(f"**Threshold HU:** {data['threshold_hu']}")
    n_total = data.get("n_clusters_total", data.get("n_components", "?"))
    n_accepted = data.get("n_electrodes_accepted", "?")
    lines.append(f"**Clusters detectados:** {n_total}")
    lines.append(f"**Clusters aceitos como eletrodos:** {n_accepted}")
    if "midline_x_lps_mm" in data:
        lines.append(f"**Linha média X_LPS estimada:** {data['midline_x_lps_mm']:+.2f} mm")
    lines.append("")

    summary = data.get("summary", {})

    if "left" in summary and "right" in summary:
        lines.append("## Posicionamento do Contato Distal (tip)")
        lines.append("")
        lines.append("| Lado | X (mm) | Y (mm) | Z (mm) | Comprimento detectado |")
        lines.append("|------|--------|--------|--------|------------------------|")
        for side in ("left", "right"):
            tip = summary[side]["tip_physical_mm"]
            length = summary[side]["length_mm"]
            lines.append(
                f"| {side.capitalize()} | {tip[0]:+.2f} | {tip[1]:+.2f} | "
                f"{tip[2]:+.2f} | {length:.1f} mm |"
            )
        lines.append("")

        # Classificação anatômica
        cls_l = summary["left"].get("anatomical_classification")
        cls_r = summary["right"].get("anatomical_classification")
        mcp_info = summary.get("_mcp_estimation", {})
        if cls_l or cls_r:
            lines.append("## Classificação Anatômica (vs STN teórico)")
            lines.append("")
            if mcp_info.get("method"):
                lines.append(f"**Método de estimativa do MCP:** {mcp_info['method']}")
                if mcp_info.get("mcp_lps"):
                    m = mcp_info["mcp_lps"]
                    lines.append(f"**MCP estimado:** ({m[0]:+.1f}, {m[1]:+.1f}, {m[2]:+.1f}) mm LPS")
                lines.append("")
            lines.append("| Lado | Classificação | d(motor) | d(associativo) | d(límbico) |")
            lines.append("|------|---------------|----------|----------------|-----------|")
            for side, cls in (("left", cls_l), ("right", cls_r)):
                if not cls:
                    continue
                d = cls["distances_to_sectors_mm"]
                lines.append(
                    f"| {side.capitalize()} | {cls['classification']} | "
                    f"{d['motor']:.2f} mm | {d['associative']:.2f} mm | {d['limbic']:.2f} mm |"
                )
            lines.append("")
            lines.append(
                "> Distâncias do tip detectado aos centros teóricos dos subsetores STN "
                "(Hamani 2004, Haynes & Haber 2013)."
            )
            if "tips" in (mcp_info.get("method") or ""):
                lines.append("")
                lines.append(
                    "> ⚠️ **Atenção:** quando o MCP é estimado a partir dos próprios tips, "
                    "a classificação anatômica é **parcialmente circular** — ambos os tips "
                    "tendem a ficar próximos do STN por construção. Use este valor apenas "
                    "como sanity check, não como validação independente. "
                    "Para validação real, marcar AC e PC manualmente ou fazer registro "
                    "para template MNI152."
                )
            lines.append("")

        # Contatos do eletrodo Cartesia
        cart_l = summary["left"].get("cartesia_contacts_lps")
        if cart_l:
            lines.append("## Contatos do Eletrodo Cartesia DB-2202 (esquerdo)")
            lines.append("")
            lines.append("| Contato | X (mm) | Y (mm) | Z (mm) |")
            lines.append("|---------|--------|--------|--------|")
            for name, pos in cart_l.items():
                lines.append(f"| {name} | {pos[0]:+.2f} | {pos[1]:+.2f} | {pos[2]:+.2f} |")
            lines.append("")

    # Verificação vs atlas CIT168 REAL (não elipsoidal, não circular)
    # Deriva a pasta do electrodes_json para achar cit168_registration.json
    out_dir = Path(electrodes_json).parent
    cit168_registration = out_dir / "cit168_registration.json"
    if cit168_registration.exists():
        with open(cit168_registration) as f:
            cit168_data = json.load(f)
        tips_check = cit168_data.get("results", {}).get("tips_vs_cit168_stn", {})
        if tips_check:
            lines.append("## Validação vs Atlas CIT168 Real (Pauli 2017, NeuroVault 3145)")
            lines.append("")
            lines.append("**Método:** registro SimpleITK rigid+affine paciente→CIT168 (templates T1 700µm) + "
                         "warping inverso da máscara STN probabilística para espaço do paciente.")
            lines.append("")
            lines.append("| Lado | Dentro do STN? | Distância assinada | Interpretação |")
            lines.append("|------|-----------------|---------------------|---------------|")
            for side in ("left", "right"):
                c = tips_check.get(side)
                if not c:
                    continue
                inside = "✅ SIM" if c.get("inside") else "❌ NÃO"
                lines.append(
                    f"| {side.capitalize()} | {inside} | "
                    f"{c.get('signed_distance_mm', 0):+.2f} mm | {c.get('interpretation', '')} |"
                )
            lines.append("")
            lines.append("> Este é o achado **mais independente** possível com os recursos disponíveis: "
                         "não é circular (MCP vem do atlas, não dos tips) e usa atlas probabilístico real "
                         "derivado de 168 voluntários (Pauli 2017).")
            lines.append("")

    # Verificação vs máscara STN (atlas elipsoidal MNI-referenced)
    has_mask_check = any(
        "stn_mask_check" in summary.get(s, {}) for s in ("left", "right")
    )
    if has_mask_check:
        lines.append("## Verificação vs Máscara STN (elipsoidal MNI-referenced)")
        lines.append("")
        lines.append("| Lado | Dentro da máscara STN? | Distância assinada | Interpretação |")
        lines.append("|------|-------------------------|---------------------|---------------|")
        for side in ("left", "right"):
            chk = summary.get(side, {}).get("stn_mask_check")
            if not chk:
                continue
            inside = "✅ SIM" if chk["inside_stn"] else "❌ NÃO"
            lines.append(
                f"| {side.capitalize()} | {inside} | "
                f"{chk['signed_distance_mm']:+.2f} mm | {chk['interpretation']} |"
            )
        lines.append("")
        lines.append("> Distância assinada: NEGATIVA = dentro da máscara; POSITIVA = fora. "
                     "Máscara é elipsóide semieixos (4.5, 3.5, 4.0) mm centrado em "
                     "coordenadas Hamani 2004 a partir do MCP estimado.")
        lines.append("")

    # Simulação de VTA
    has_vta = any("vta_simulation" in summary.get(s, {}) for s in ("left", "right"))
    if has_vta:
        lines.append("## Simulação de Volume de Tecido Ativado (VTA)")
        lines.append("")
        lines.append("Modelo Kuncel & Grill 2004 simplificado (current-based).")
        lines.append("Parâmetros: programa ativo do paciente (informe os valores reais ao usar).")
        lines.append("")
        lines.append("| Lado | Contato | Corrente | Pulso | TEED | Raio VTA | STN motor | STN assoc | STN límbico |")
        lines.append("|------|---------|----------|-------|------|----------|-----------|-----------|-------------|")
        for side in ("left", "right"):
            vta = summary.get(side, {}).get("vta_simulation")
            if not vta:
                continue
            ov = vta["overlap_with_stn"]
            lines.append(
                f"| {side.capitalize()} | {vta['active_contact']} | "
                f"{vta['amplitude_mA']} mA | {vta['pulse_width_us']} µs | "
                f"{vta['teed_uW']:.0f} µW | "
                f"{vta['vta_radius_mm']:.2f} mm | "
                f"{ov['motor']['fraction_of_vta_hitting_target']*100:.1f}% | "
                f"{ov['associative']['fraction_of_vta_hitting_target']*100:.1f}% | "
                f"{ov['limbic']['fraction_of_vta_hitting_target']*100:.1f}% |"
            )
        lines.append("")
        lines.append("> **Leitura:** cada % indica qual fração do VTA está DENTRO de cada setor do STN. "
                     "Um eletrodo bem posicionado no STN motor teria >40% de overlap motor. "
                     "Overlap baixo em motor com overlap alto em associativo/límbico sugere posicionamento "
                     "subótimo que explica efeitos colaterais (sialorreia, alucinação, disfunção cognitiva).")
        lines.append("")

    asym = summary.get("asymmetry")
    if asym:
        lines.append("## Assimetria Entre Tips")
        lines.append("")
        ap = asym["ap_diff_mm_left_minus_right"]
        lat = asym["lateral_diff_mm_left_minus_right"]
        si = asym.get("si_diff_mm_left_minus_right", 0)
        lines.append(f"- **Ântero-posterior (esq - dir):** {ap:+.2f} mm")
        lines.append(f"- **Lateral (esq - dir):** {lat:+.2f} mm")
        lines.append(f"- **Súpero-inferior (esq - dir):** {si:+.2f} mm")
        lines.append("")
        if abs(ap) > 3:
            direction = "ANTERIOR" if ap < 0 else "POSTERIOR"
            lines.append(
                f"> ⚠️ **Assimetria AP significativa (>3 mm).** "
                f"Eletrodo esquerdo está **{abs(ap):.1f} mm mais {direction}** que o direito."
            )
            lines.append("")

    lines.append("## Limitações desta Análise")
    lines.append("")
    lines.append(
        "- **Registro rígido (6 DoF)** — não corrige brain shift entre RM pré-op e TC pós-op."
    )
    lines.append(
        "- **MCP estimado heuristicamente** — precisão estereotáxica exige marcação manual de AC/PC por radiologista. "
        "Com apenas dois eletrodos, o midpoint dos tips é a estimativa mais robusta disponível, "
        "mas é *por construção* simétrica e não valida posicionamento individual."
    )
    lines.append(
        "- **Coordenadas STN teóricas** usam valores médios de Hamani 2004; "
        "podem diferir da anatomia individual em até 3-4 mm."
    )
    lines.append(
        "- **Sem atlas probabilístico (DISTAL/MNI152)** — não diferencia subsetores STN "
        "com precisão clínica."
    )
    lines.append(
        "- **Sem simulação de VTA** — não prediz efeito clínico da estimulação."
    )
    lines.append(
        "- **Triagem automatizada** — NÃO substitui Lead-DBS/Brainlab/Guide XT nem o laudo médico."
    )
    lines.append("")
    lines.append("## O que é robusto nesta análise")
    lines.append("")
    lines.append(
        "- **Detecção dos 2 eletrodos** e suas trajetórias 3D completas."
    )
    lines.append(
        "- **Assimetria entre tips** (medida relativa, não depende de MCP): "
        "o achado mais clinicamente acionável se >3 mm em qualquer eixo."
    )
    lines.append(
        "- **Coordenadas absolutas em LPS físico** dos tips — reprodutíveis e "
        "comparáveis entre estudos do mesmo paciente ao longo do tempo."
    )
    lines.append("")

    lines.append("## Arquivos Gerados")
    lines.append("")
    lines.append("- `mri.nii.gz` / `mri_lps.nii.gz` — RM (original e LPS canônico)")
    lines.append("- `ct_in_mri_space.nii.gz` / `ct_lps.nii.gz` — TC alinhada")
    lines.append("- `ct_to_mri.tfm` — transformação rígida")
    lines.append("- `electrode_labels.nii.gz` — máscara dos eletrodos detectados")
    lines.append("- `electrodes.json` — coordenadas + classificação anatômica")
    lines.append("- `comparison.png` — visualizações axial/coronal/sagital")
    lines.append("- `stn_target.png` — close-up nos tips vs STN teórico")

    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  Relatório textual: {report_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--ct-name", default="ct_lps.nii.gz",
                        help="Nome do arquivo CT a usar (padrão: ct_lps.nii.gz)")
    parser.add_argument("--mri-name", default="mri_lps.nii.gz")
    args = parser.parse_args()

    ct_path = args.out / args.ct_name
    mri_path = args.out / args.mri_name
    labels_path = args.out / "electrode_labels.nii.gz"
    electrodes_json = args.out / "electrodes.json"

    for p in (ct_path, labels_path, electrodes_json):
        if not p.exists():
            print(f"ERRO: arquivo não encontrado: {p}")
            print("Rode primeiro fuse_ct_mri.py e detect_electrodes.py.")
            sys.exit(1)

    plot_comparison(ct_path, labels_path, mri_path, electrodes_json,
                    args.out / "comparison.png")
    plot_stn_target(ct_path, labels_path, electrodes_json,
                    args.out / "stn_target.png")
    write_markdown_report(electrodes_json, args.out / "report.md")
    print(f"\nRelatório completo em: {args.out}/")


if __name__ == "__main__":
    sys.exit(main() or 0)
