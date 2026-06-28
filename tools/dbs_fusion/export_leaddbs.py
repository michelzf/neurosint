#!/usr/bin/env python3
"""
export_leaddbs.py — Exporta resultados compatíveis com Lead-DBS

Lead-DBS guarda o estado do caso em `reconstruction.mat` com estrutura MATLAB
específica. Este script gera um arquivo `.mat` (scipy.io) que pode ser carregado
no Lead-DBS para visualização cruzada.

Estrutura Lead-DBS reconstruction.mat (simplificada):
    reco.native.coords_mm   -- [2x4 cells] -- coordenadas dos 4 contatos de cada lado
    reco.native.markers(2)  -- struct com .head (tip) e .tail (topo) por lado
    reco.props              -- propriedades do eletrodo (elmodel, manually_corrected)
    reco.electrode          -- modelo de eletrodo ("Boston Vercise Cartesia"...)

Uso:
    python export_leaddbs.py --in fusion_AAAA-MM-DD --out reconstruction.mat
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from scipy.io import savemat


# Nomes de modelo Lead-DBS para cada hardware Boston Scientific
LEADDBS_ELECTRODE_MODEL = {
    "DB-2201": "Boston Vercise",
    "DB-2202": "Boston Vercise Cartesia",
    "DB-2301": "Medtronic 3387",
    "DB-2302": "Medtronic 3389",
}


def coords_for_cartesia(tip: np.ndarray, axis_unit: np.ndarray) -> list:
    """Coordenadas dos 4 contatos ao longo do eixo, Boston Cartesia DB-2202."""
    # Distâncias do tip até centro de cada contato (mm)
    distances = [0.75, 2.75, 4.75, 6.75]
    return [(tip + d * axis_unit).tolist() for d in distances]


def export_reconstruction_mat(electrodes_json_path: Path, output_mat: Path,
                               electrode_model: str = "Boston Vercise Cartesia"):
    """Gera .mat compatível com Lead-DBS a partir de electrodes.json."""
    with open(electrodes_json_path) as f:
        data = json.load(f)

    summary = data.get("summary", {})
    if "left" not in summary or "right" not in summary:
        print("ERRO: electrodes.json não tem ambos left+right")
        sys.exit(1)

    # Estrutura Lead-DBS: lados ordenados [right, left]
    # reco.native.coords_mm{side} = [4x3] array de coordenadas dos contatos
    # reco.native.markers(side).head = tip (1x3)
    # reco.native.markers(side).tail = topo (1x3)
    coords_native = []
    markers_native = []
    trajectory_native = []

    for side_idx, side in enumerate(("right", "left")):
        sm = summary[side]
        tip = np.array(sm["tip_physical_mm"])
        top = np.array(sm["top_physical_mm"])
        axis = (top - tip)
        length = np.linalg.norm(axis)
        axis_unit = axis / max(length, 1e-6)

        contacts = np.array(coords_for_cartesia(tip, axis_unit))
        coords_native.append(contacts)

        markers_native.append({
            "head": tip.reshape(1, 3),
            "tail": top.reshape(1, 3),
            "x": np.array([1.0, 0.0, 0.0]).reshape(1, 3),  # placeholder (orientação radial)
            "y": np.array([0.0, 1.0, 0.0]).reshape(1, 3),
        })

        # Trajetória como 2 pontos (tip e topo) — Lead-DBS aceita mais pontos também
        trajectory_native.append(np.vstack([tip, top]))

    # Montar struct reco
    reco = {
        "native": {
            "coords_mm": np.array(coords_native, dtype=object),
            "markers": np.array(markers_native, dtype=object),
            "trajectory": np.array(trajectory_native, dtype=object),
        },
        "props": {
            "elmodel": electrode_model,
            "manually_corrected": 1,  # Sinalizar que veio de análise automatizada + validação
            "source": "dbs_fusion pipeline v1.7.0",
        },
        "electrode": electrode_model,
        "asymmetry_between_tips": summary.get("asymmetry", {}),
    }

    # Adicionar classificação anatômica e VTA se houver (nomes truncados <=31 chars)
    for side_idx, side in enumerate(("right", "left")):
        if "anatomical_classification" in summary.get(side, {}):
            reco.setdefault("anatomical", {})[side] = summary[side]["anatomical_classification"]
        if "vta_simulation" in summary.get(side, {}):
            reco.setdefault("vta", {})[side] = summary[side]["vta_simulation"]

    # Sanitizar dict para MATLAB: field names <=31 chars, conversão recursiva
    def sanitize(obj, depth=0):
        if isinstance(obj, dict):
            return {
                (k[:31] if isinstance(k, str) else str(k)[:31]): sanitize(v, depth+1)
                for k, v in obj.items()
            }
        if isinstance(obj, list):
            return [sanitize(x, depth+1) for x in obj]
        if isinstance(obj, tuple):
            return tuple(sanitize(x, depth+1) for x in obj)
        return obj

    reco_sanitized = sanitize(reco)
    savemat(str(output_mat), {"reco": reco_sanitized})
    print(f"Exportado: {output_mat}")
    print(f"  Lado(s): right (idx 0), left (idx 1)")
    print(f"  Modelo: {electrode_model}")
    print(f"  Carregar no Lead-DBS: ea_load_reconstruction()")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="input_dir", required=True, type=Path,
                        help="Pasta com electrodes.json (saída de detect_electrodes)")
    parser.add_argument("--out", type=Path, default=None,
                        help="Arquivo .mat de saída (default: <in>/reconstruction.mat)")
    parser.add_argument("--model", default="Boston Vercise Cartesia",
                        help="Modelo de eletrodo Lead-DBS")
    args = parser.parse_args()

    electrodes_json = args.input_dir / "electrodes.json"
    if not electrodes_json.exists():
        print(f"ERRO: {electrodes_json} não encontrado")
        sys.exit(1)

    out = args.out or (args.input_dir / "reconstruction.mat")
    export_reconstruction_mat(electrodes_json, out, args.model)


if __name__ == "__main__":
    sys.exit(main() or 0)
