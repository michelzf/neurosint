#!/usr/bin/env python3
"""
anatomical_targets.py — Coordenadas anatômicas de referência e modelo de eletrodo

Fornece:
1. Coordenadas padrão do STN motor em espaço MNI/estereotáxico (midpoint AC-PC)
2. Modelo do eletrodo Boston Scientific Cartesia DB-2202 (direcional segmentado)
3. Funções para calcular distância dos tips aos alvos STN esperados
4. Classificação do posicionamento: "dentro do STN motor" vs "associativo/límbico" vs "fora"

Referências:
- STN center coordinates: Schaltenbrand & Wahren (1977), Hamani et al. (2004)
- MNI coordinates of STN motor: ~(±12, -13, -5) no espaço MNI152
- Boston Cartesia DB-2202 geometry: manual do fabricante
- Setores do STN: Haynes & Haber (2013) - tripartite STN (motor, associative, limbic)
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Tuple, List


# ===== COORDENADAS ANATÔMICAS =====

# Coordenadas do STN motor em espaço AC-PC (origem no midpoint, eixos LPS-like):
# X = lateral (negativo = direito em RAS, positivo = esquerda)
# Y = anterior-posterior (negativo = posterior ao MCP)
# Z = superior-inferior (negativo = inferior à linha AC-PC)
STN_MOTOR_MCP_COORDINATES = {
    # MCP = midpoint commissural (midpoint entre AC e PC)
    # Valores típicos (Hamani 2004, Bejjani 2000)
    "center_motor_lps": (11.5, -2.0, -4.0),  # centro do STN motor (lado esquerdo em LPS)
    "center_associative_lps": (9.0, 0.5, -3.0),  # STN associativo
    "center_limbic_lps": (7.0, 3.0, -2.5),  # STN límbico (mais medial+anterior)
    # Dimensões do núcleo subtalâmico (aproximação)
    "stn_semiaxes_mm": (4.5, 3.5, 4.0),  # semieixo lateral, AP, SI
}


# ===== MODELO DO ELETRODO BOSTON CARTESIA DB-2202 =====

@dataclass
class CartesiaElectrode:
    """Modelo do eletrodo direcional segmentado Boston Cartesia DB-2202.

    Geometria (da distal ao proximal):
    - Contato 1 (tip): anel, 1.5 mm altura, na ponta
    - Espaço: 0.5 mm
    - Contato 2: 3 segmentos direcionais (2A, 2B, 2C), 1.5 mm altura total
    - Espaço: 0.5 mm
    - Contato 3: 3 segmentos direcionais (3A, 3B, 3C), 1.5 mm altura
    - Espaço: 0.5 mm
    - Contato 4: anel, 1.5 mm altura
    - Total do arranjo de contatos: ~8 mm
    """
    diameter_mm: float = 1.3
    contact_1_center_from_tip: float = 0.75
    contact_2_center_from_tip: float = 2.75
    contact_3_center_from_tip: float = 4.75
    contact_4_center_from_tip: float = 6.75

    def contact_positions_on_axis(self, tip_mm: np.ndarray,
                                  axis_unit: np.ndarray) -> dict:
        """Dado o tip e o eixo do eletrodo, devolve coordenadas dos 4 contatos."""
        return {
            "1 (tip)": tip_mm + self.contact_1_center_from_tip * axis_unit,
            "2 (direcional)": tip_mm + self.contact_2_center_from_tip * axis_unit,
            "3 (direcional)": tip_mm + self.contact_3_center_from_tip * axis_unit,
            "4 (ring proximal)": tip_mm + self.contact_4_center_from_tip * axis_unit,
        }


# ===== FUNÇÕES DE ANÁLISE =====

def stn_motor_center(side: str, midpoint_commissural_lps: np.ndarray = None) -> np.ndarray:
    """Devolve o centro do STN motor em LPS para o lado pedido.

    Args:
        side: "left" ou "right"
        midpoint_commissural_lps: se None, usa origem (0,0,0) — assume
            que o volume já foi centrado no MCP.

    Notas:
        - Em LPS: X+ = esquerda do paciente, então lado esquerdo usa X positivo.
        - Para lado direito, inverter o sinal de X.
    """
    base = np.array(STN_MOTOR_MCP_COORDINATES["center_motor_lps"])  # (x, y, z) esquerdo
    if midpoint_commissural_lps is None:
        midpoint_commissural_lps = np.zeros(3)

    if side == "left":
        return midpoint_commissural_lps + base
    elif side == "right":
        return midpoint_commissural_lps + np.array([-base[0], base[1], base[2]])
    else:
        raise ValueError(f"side deve ser 'left' ou 'right', recebi {side!r}")


def classify_tip_position(tip_lps: np.ndarray, side: str,
                          midpoint_commissural_lps: np.ndarray = None) -> dict:
    """Classifica a posição do tip como dentro do STN motor, associativo, límbico, ou fora.

    Devolve dicionário com distâncias (mm) aos 3 subsetores e classificação.
    """
    if midpoint_commissural_lps is None:
        midpoint_commissural_lps = np.zeros(3)

    centers = {}
    for sector in ("motor", "associative", "limbic"):
        base = np.array(STN_MOTOR_MCP_COORDINATES[f"center_{sector}_lps"])
        if side == "right":
            base = np.array([-base[0], base[1], base[2]])
        centers[sector] = midpoint_commissural_lps + base

    distances = {
        sector: float(np.linalg.norm(tip_lps - c))
        for sector, c in centers.items()
    }

    nearest = min(distances, key=distances.get)
    d_nearest = distances[nearest]

    semiaxes = STN_MOTOR_MCP_COORDINATES["stn_semiaxes_mm"]
    # Considerar "dentro do STN" se estiver dentro do elipsóide do setor mais próximo
    center_nearest = centers[nearest]
    offset = tip_lps - center_nearest
    normalized_distance = np.sqrt(sum(
        (offset[i] / semiaxes[i]) ** 2 for i in range(3)
    ))

    if normalized_distance <= 1.0:
        classification = f"dentro do STN {nearest}"
    elif normalized_distance <= 1.5:
        classification = f"borda do STN {nearest}"
    else:
        classification = "fora do STN"

    return {
        "tip_lps": tip_lps.tolist(),
        "side": side,
        "mcp_reference_lps": midpoint_commissural_lps.tolist(),
        "stn_sector_centers_lps": {k: v.tolist() for k, v in centers.items()},
        "distances_to_sectors_mm": distances,
        "nearest_sector": nearest,
        "distance_to_nearest_mm": d_nearest,
        "normalized_distance_to_nearest": float(normalized_distance),
        "classification": classification,
    }


def estimate_mcp_from_electrode_tips(tip_left_lps, tip_right_lps):
    """Estimativa robusta do MCP a partir das posições dos tips dos eletrodos.

    Assume posicionamento bilateral aproximadamente simétrico. É muito mais
    confiável que a heurística do crânio quando há dois eletrodos válidos.

    STN motor esperado: X=±12, Y=-2, Z=-4 em relação ao MCP.
    Portanto MCP ≈ midpoint(tip_L, tip_R) + (0, +2, +4).
    """
    tip_l = np.array(tip_left_lps)
    tip_r = np.array(tip_right_lps)
    midpoint = (tip_l + tip_r) / 2.0
    # Offset inverso do STN motor esperado em relação ao MCP
    offset_back = np.array([0.0, 2.0, 4.0])
    return midpoint + offset_back


def estimate_mcp_from_midline_and_skull(ct_array, spacing, origin_lps):
    """Estimativa heurística do MCP (midpoint commissural) em LPS.

    Args:
        ct_array: numpy array (z, y, x) da TC (após reamostragem LPS canônica)
        spacing: tupla (sx, sy, sz) ou escalar (se isotrópico)
        origin_lps: tupla (ox, oy, oz) da origem em LPS

    Retorna: array (x, y, z) em LPS com coordenadas aproximadas do MCP.

    Heurísticas (paciente em LPS canônico axial):
      - X = centroide lateral do crânio (linha média)
      - Y = ~65% da extensão AP (MCP fica posterior ao centro geométrico)
      - Z = ~45% da extensão SI (MCP está abaixo do plano médio)

    ATENÇÃO: estimativa grosseira. Para precisão clínica, use registro com
    template MNI152 ou marcação manual de AC e PC por radiologista.
    """
    if np.isscalar(spacing):
        sx = sy = sz = float(spacing)
    else:
        sx, sy, sz = float(spacing[0]), float(spacing[1]), float(spacing[2])

    skull = (ct_array > 300) & (ct_array < 1500)
    if not skull.any():
        return None

    # numpy array shape (z, y, x)
    zs, ys, xs = np.where(skull)

    # No volume LPS canônico axial:
    # eixo 0 imagem (x_voxel) = X_LPS (lateral)
    # eixo 1 imagem (y_voxel) = Y_LPS (AP)
    # eixo 2 imagem (z_voxel) = Z_LPS (SI)
    # Porém numpy inverte para (z, y, x), então xs = coluna (X_LPS)
    x_mean = xs.mean()
    y_min, y_max = ys.min(), ys.max()
    y_mcp = y_min + 0.65 * (y_max - y_min)
    z_min, z_max = zs.min(), zs.max()
    z_mcp = z_min + 0.45 * (z_max - z_min)

    x_lps = origin_lps[0] + x_mean * sx
    y_lps = origin_lps[1] + y_mcp * sy
    z_lps = origin_lps[2] + z_mcp * sz

    return np.array([x_lps, y_lps, z_lps])


if __name__ == "__main__":
    # Demo
    electrode = CartesiaElectrode()
    tip = np.array([11.5, -2.0, -4.0])  # STN motor esquerdo ideal
    axis = np.array([0.0, 0.3, 1.0])  # trajetória oblíqua (dorsal-lateral)
    axis /= np.linalg.norm(axis)
    print("Contatos do eletrodo Cartesia DB-2202:")
    for name, pos in electrode.contact_positions_on_axis(tip, axis).items():
        print(f"  {name:20s}: {pos}")

    print("\nClassificação de um tip ideal no STN motor esquerdo:")
    result = classify_tip_position(tip, "left")
    print(f"  Classificação: {result['classification']}")
    print(f"  Distância ao setor motor: {result['distances_to_sectors_mm']['motor']:.2f} mm")
