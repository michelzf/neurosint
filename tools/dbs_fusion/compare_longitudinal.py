#!/usr/bin/env python3
"""
compare_longitudinal.py — Comparação de posicionamento de eletrodos entre 2 estudos

Útil para detectar migração de eletrodo ao longo do tempo. Usa os electrodes.json
de dois pipelines diferentes e calcula deslocamento dos tips em mm.

Exemplo:
    python compare_longitudinal.py \\
        --old ../../DBS/fusion_AAAA-MM-DD_antigo \\
        --new ../../DBS/fusion_AAAA-MM-DD_novo \\
        --out ../../DBS/longitudinal_comparison.md

Critério clínico:
    - Deslocamento < 1 mm = dentro da precisão do método, sem migração
    - 1-2 mm = possível migração, confirmar
    - > 2 mm = migração provável, avaliação cirúrgica
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np


def load_electrodes(folder: Path) -> dict:
    json_path = folder / "electrodes.json"
    if not json_path.exists():
        raise FileNotFoundError(f"electrodes.json não encontrado em {folder}")
    with open(json_path) as f:
        return json.load(f)


def compare_tips(old_data: dict, new_data: dict) -> dict:
    """Compara os tips em old vs new e calcula deslocamento."""
    comparison = {}
    old_summary = old_data.get("summary", {})
    new_summary = new_data.get("summary", {})

    for side in ("left", "right"):
        if side not in old_summary or side not in new_summary:
            comparison[side] = {"error": f"Side {side} ausente em um dos estudos"}
            continue
        tip_old = np.array(old_summary[side]["tip_physical_mm"])
        tip_new = np.array(new_summary[side]["tip_physical_mm"])
        delta = tip_new - tip_old
        distance = float(np.linalg.norm(delta))

        # Classificação clínica
        if distance < 1.0:
            status = "sem migração significativa"
        elif distance < 2.0:
            status = "possível migração — verificar"
        else:
            status = "MIGRAÇÃO PROVÁVEL — avaliação cirúrgica"

        comparison[side] = {
            "tip_old_lps_mm": tip_old.tolist(),
            "tip_new_lps_mm": tip_new.tolist(),
            "delta_xyz_mm": delta.tolist(),
            "displacement_mm": distance,
            "displacement_components": {
                "lateral_mm": float(delta[0]),
                "ap_mm": float(delta[1]),
                "si_mm": float(delta[2]),
            },
            "status": status,
        }

    # Comparar assimetrias entre tips
    if "asymmetry" in old_summary and "asymmetry" in new_summary:
        old_asym = old_summary["asymmetry"]
        new_asym = new_summary["asymmetry"]
        comparison["asymmetry_trend"] = {
            "old": old_asym,
            "new": new_asym,
            "ap_change_mm": new_asym["ap_diff_mm_left_minus_right"]
                            - old_asym["ap_diff_mm_left_minus_right"],
            "lateral_change_mm": new_asym["lateral_diff_mm_left_minus_right"]
                                 - old_asym["lateral_diff_mm_left_minus_right"],
        }
    return comparison


def write_markdown(old_folder: Path, new_folder: Path, comparison: dict,
                   output_path: Path):
    lines = []
    lines.append("# Comparação Longitudinal de Eletrodos DBS")
    lines.append("")
    lines.append(f"**Estudo antigo:** `{old_folder}`")
    lines.append(f"**Estudo novo:**   `{new_folder}`")
    lines.append("")

    lines.append("## Deslocamento dos Tips")
    lines.append("")
    lines.append("| Lado | Tip antigo (mm LPS) | Tip novo (mm LPS) | Δ total | Δ lat | Δ AP | Δ SI | Status |")
    lines.append("|------|---------------------|-------------------|---------|-------|------|------|--------|")
    for side in ("left", "right"):
        entry = comparison.get(side, {})
        if "error" in entry:
            lines.append(f"| {side.capitalize()} | — | — | — | — | — | — | {entry['error']} |")
            continue
        old_tip = entry["tip_old_lps_mm"]
        new_tip = entry["tip_new_lps_mm"]
        dist = entry["displacement_mm"]
        d = entry["displacement_components"]
        lines.append(
            f"| {side.capitalize()} | "
            f"({old_tip[0]:+.1f}, {old_tip[1]:+.1f}, {old_tip[2]:+.1f}) | "
            f"({new_tip[0]:+.1f}, {new_tip[1]:+.1f}, {new_tip[2]:+.1f}) | "
            f"**{dist:.2f} mm** | "
            f"{d['lateral_mm']:+.2f} | {d['ap_mm']:+.2f} | {d['si_mm']:+.2f} | "
            f"{entry['status']} |"
        )
    lines.append("")

    trend = comparison.get("asymmetry_trend")
    if trend:
        lines.append("## Evolução da Assimetria Inter-eletrodo")
        lines.append("")
        lines.append("| Métrica | Antigo | Novo | Variação |")
        lines.append("|---------|--------|------|----------|")
        lines.append(
            f"| AP (esq - dir) | {trend['old']['ap_diff_mm_left_minus_right']:+.2f} mm | "
            f"{trend['new']['ap_diff_mm_left_minus_right']:+.2f} mm | "
            f"{trend['ap_change_mm']:+.2f} mm |"
        )
        lines.append(
            f"| Lateral (esq - dir) | {trend['old']['lateral_diff_mm_left_minus_right']:+.2f} mm | "
            f"{trend['new']['lateral_diff_mm_left_minus_right']:+.2f} mm | "
            f"{trend['lateral_change_mm']:+.2f} mm |"
        )
        lines.append("")
        if abs(trend["ap_change_mm"]) > 1.5 or abs(trend["lateral_change_mm"]) > 1.5:
            lines.append("> ⚠️ **Mudança de assimetria >1.5 mm** — pode indicar migração de um ou ambos os eletrodos, OU mudança na fusão de imagens (erro de registro). Verificar qualidade dos registros em cada estudo.")
            lines.append("")

    lines.append("## Interpretação Clínica")
    lines.append("")
    lines.append("- **< 1 mm:** dentro da precisão do método (incluindo registro rígido + reamostragem). Sem migração.")
    lines.append("- **1–2 mm:** possível migração. Repetir análise com parâmetros de registro mais rigorosos. Considerar marcação manual AC/PC idêntica em ambos os estudos.")
    lines.append("- **> 2 mm:** migração provável. Encaminhar ao neurocirurgião.")
    lines.append("")

    lines.append("## ⚠️ Limitações e validação de confiança")
    lines.append("")
    lines.append("- **Erro típico de registro rígido: 1-3 mm.** Deslocamentos nessa faixa podem ser ruído.")
    lines.append("- **Se a métrica de registro dos dois estudos divergir significativamente** (ex: -0.33 vs -0.05), "
                 "a comparação direta **NÃO é confiável** — um dos registros convergiu em ótimo local. "
                 "Solução: refinar parâmetros de registro e aumentar iterações, OU usar marcação manual "
                 "de landmarks (AC, PC, pontos do crânio) para inicializar o registro.")
    lines.append("- Deslocamentos **>5 mm entre estudos próximos** quase sempre indicam problema de registro, "
                 "não migração real. Hardware DBS não migra centimetros em poucos meses.")
    lines.append("- A reamostragem para LPS canônico introduz pequena interpolação (<0.5 mm).")
    lines.append("- Comparação assume que a RM de planejamento é a mesma em ambos os estudos (referencial fixo).")
    lines.append("- Se MCPs foram estimados diferentemente em cada estudo, classificação anatômica pode "
                 "divergir mesmo sem migração real.")
    lines.append("")
    lines.append("**Sanity checks antes de aceitar um achado de migração:**")
    lines.append("1. Ambas as fusões convergiram com métricas similares? (ver log do fuse_ct_mri.py)")
    lines.append("2. Ambos os MCPs estão próximos (<5 mm)? Se não, refinar.")
    lines.append("3. A assimetria inter-eletrodo mudou de forma coerente? Se Δ_left ≠ Δ_right com mesmo sinal, provavelmente é erro de registro.")
    lines.append("4. Os componentes de deslocamento (lat/AP/SI) têm sentido mecânico? Um eletrodo não migra perpendicularmente ao seu eixo.")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--old", required=True, type=Path, help="Pasta com o resultado antigo (fusion_YYYY-MM-DD)")
    parser.add_argument("--new", required=True, type=Path, help="Pasta com o resultado novo")
    parser.add_argument("--out", type=Path, default=None, help="Caminho do .md de saída (default: <new>/longitudinal_vs_<old_name>.md)")
    args = parser.parse_args()

    old_data = load_electrodes(args.old)
    new_data = load_electrodes(args.new)

    comparison = compare_tips(old_data, new_data)

    out_path = args.out or (args.new / f"longitudinal_vs_{args.old.name}.md")
    write_markdown(args.old, args.new, comparison, out_path)

    # JSON também
    json_out = out_path.with_suffix(".json")
    with open(json_out, "w", encoding="utf-8") as f:
        json.dump(comparison, f, indent=2)

    print(f"Relatório: {out_path}")
    print(f"JSON:      {json_out}")
    print()
    for side in ("left", "right"):
        entry = comparison.get(side, {})
        if "displacement_mm" in entry:
            print(f"  {side.capitalize()}: deslocamento {entry['displacement_mm']:.2f} mm — {entry['status']}")


if __name__ == "__main__":
    sys.exit(main() or 0)
