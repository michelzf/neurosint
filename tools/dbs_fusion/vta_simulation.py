#!/usr/bin/env python3
"""
vta_simulation.py — Simulação simplificada de Volume de Tecido Ativado (VTA)

Modelo usado: Mädler & Coenen (2012) + Astrom et al. (2015), versão simplificada.

Mädler propõe fórmula analítica para o raio de ativação a partir de:
    r(V) = -0.010*V^2 + 0.22*V + 0.07 * ln(pw/90)  [em mm; V em volts; pw em µs]

Para corrente-controlada (como Boston Scientific Vercise), converter mA→V
usando impedância (V = I * Z).

Este modelo é uma aproximação ESFÉRICA do VTA — ignora:
- Orientação de fibras
- Anisotropia (DTI)
- Contatos direcionais (simplifica para anel)
- Efeitos de encapsulamento fibrótico não-uniforme

Para análise clínica precisa, usar FieldTrip (Lead-DBS) ou OSS-DBS.

Referências:
- Mädler B, Coenen VA. "Explaining clinical effects of DBS through sim of VTA."
  Am J Neuroradiol 2012;33(6):1072-80. DOI: 10.3174/ajnr.A2906
- Astrom M et al. "Relationship between neural activation and electric field
  distribution during DBS." IEEE Trans Biomed Eng 2015;62(2):664-72.
"""

from dataclasses import dataclass, field
from typing import List, Optional
import numpy as np


# Direções radiais unitárias dos 3 segmentos direcionais (120° apart) em sistema
# local do eletrodo (perpendicular ao eixo). Convenção Boston Cartesia:
# Segmento A aponta para 0°, B para 120°, C para 240°. Isso é RELATIVO à rotação
# do eletrodo no crânio — a orientação absoluta depende do implante.
# Assumimos que A aponta para +Y_LPS (anterior) como estimativa default; a
# orientação real requer marker radiológico no IPG ou fluoroscopia rotacional.
CARTESIA_SEGMENT_ANGLES = {
    "A": 0.0,    # 0°
    "B": 120.0,  # 120°
    "C": 240.0,  # 240°
}


# Fórmula Mädler 2012, eq. 6 (fitted): r(mm) = a*V² + b*V + c*ln(pw/90)
MADLER_A = -0.0100
MADLER_B = +0.2216
MADLER_C = +0.0687
MADLER_PW_REF = 90.0  # µs de referência

# Impedância típica de contato em tecido cerebral (Ω)
DEFAULT_IMPEDANCE_OHM = 1000.0


@dataclass
class StimulationSettings:
    """Parâmetros de estimulação de um contato."""
    side: str                    # "left" ou "right"
    contact: str                 # ex: "2A" ou "2C"
    amplitude_mA: float          # corrente
    pulse_width_us: float        # largura do pulso
    frequency_Hz: float          # frequência
    impedance_ohm: float = DEFAULT_IMPEDANCE_OHM

    @property
    def voltage_equiv(self) -> float:
        """Conversão mA para V equivalente (V = I*Z, com Z em ohms, I em A)."""
        return self.amplitude_mA * 1e-3 * self.impedance_ohm

    def vta_radius_mm(self, model: str = "kuncel") -> float:
        """Raio esférico do VTA em mm.

        Modelos disponíveis:
        - "madler": Mädler & Coenen 2012 (voltage-based, válido V≤5). Satura em
          correntes altas × impedância alta (V_equiv >5V).
        - "kuncel": Kuncel & Grill 2004 simplificado (current-based), mais
          apropriado para sistemas current-controlled como Boston Vercise.
          r(mm) ≈ 0.5 + 0.33 × I_mA × (pw/60)^0.5.
        """
        model = model.lower()
        if model == "madler":
            v = min(self.voltage_equiv, 6.0)  # clip fora da faixa válida
            pw = self.pulse_width_us
            r = MADLER_A * v * v + MADLER_B * v + MADLER_C * np.log(pw / MADLER_PW_REF)
        elif model == "kuncel":
            # Simplificação current-based — mais realista para Vercise
            r = 0.5 + 0.33 * self.amplitude_mA * np.sqrt(self.pulse_width_us / 60.0)
        else:
            raise ValueError(f"Modelo desconhecido: {model}. Use 'madler' ou 'kuncel'.")
        return max(r, 0.0)

    def teed_uw(self) -> float:
        """Total Electrical Energy Delivered em µW (Koss 2005).

        TEED = I² × Z × pw × f  (em Watts se todas as unidades SI;
        aqui: mA→A, µs→s, Ω mantém).
        """
        I_A = self.amplitude_mA * 1e-3
        pw_s = self.pulse_width_us * 1e-6
        return float((I_A ** 2) * self.impedance_ohm * pw_s * self.frequency_Hz * 1e6)


def sphere_overlap_with_ellipsoid(
    sphere_center: np.ndarray, sphere_radius_mm: float,
    ellipsoid_center: np.ndarray, ellipsoid_semiaxes_mm: np.ndarray,
    n_samples: int = 20000, seed: int = 42,
) -> dict:
    """Estima volume de overlap entre esfera (VTA) e elipsóide (alvo anatômico)
    por Monte Carlo.

    Útil para perguntar: 'qual % do VTA atinge o STN motor?'
    """
    rng = np.random.default_rng(seed)
    # Amostrar dentro da esfera uniformly
    # Gera pontos em caixa e filtra pelos que estão na esfera
    samples = rng.uniform(-1, 1, size=(n_samples, 3))
    inside_sphere = (samples ** 2).sum(axis=1) <= 1.0
    sphere_points = sphere_center + samples[inside_sphere] * sphere_radius_mm

    # Verificar quantos desses pontos caem no elipsóide alvo
    rel = (sphere_points - ellipsoid_center) / ellipsoid_semiaxes_mm
    in_target = (rel ** 2).sum(axis=1) <= 1.0

    n_in_sphere = len(sphere_points)
    n_in_both = int(in_target.sum())

    vol_sphere = (4.0 / 3.0) * np.pi * (sphere_radius_mm ** 3)
    # fração: n_in_both / n_in_sphere
    frac_vta_in_target = float(n_in_both / n_in_sphere) if n_in_sphere else 0.0

    return {
        "sphere_radius_mm": float(sphere_radius_mm),
        "sphere_volume_mm3": float(vol_sphere),
        "n_samples_in_sphere": int(n_in_sphere),
        "n_samples_in_target": int(n_in_both),
        "fraction_of_vta_hitting_target": frac_vta_in_target,
        "vta_in_target_volume_mm3": float(vol_sphere * frac_vta_in_target),
    }


def directional_vta_overlap(
    contact_center: np.ndarray, contact_axis: np.ndarray,
    direction_unit: Optional[np.ndarray], radius_mm: float,
    ellipsoid_center: np.ndarray, ellipsoid_semiaxes_mm: np.ndarray,
    asymmetry_factor: float = 1.5, n_samples: int = 30000, seed: int = 42,
) -> dict:
    """VTA anisotrópico para contatos direcionais Cartesia.

    Modela o VTA como elipsóide com eixo maior na direção do segmento direcional
    (apontando radialmente para fora do eletrodo) e eixos menores perpendiculares.

    Args:
        contact_center: centro físico do contato em LPS (mm)
        contact_axis: vetor unitário do eixo DO ELETRODO (tip->topo)
        direction_unit: vetor unitário da direção do segmento direcional
            (perpendicular ao eixo do eletrodo, apontando radialmente).
            Se None, VTA é anel isotrópico (esférico) como em contatos ring.
        radius_mm: raio esférico equivalente (VTA energy radius)
        ellipsoid_center: centro do alvo (STN motor)
        ellipsoid_semiaxes_mm: semieixos do alvo
        asymmetry_factor: quanto o VTA é mais extenso na direção do segmento
            vs perpendicular (1.5 = 50% mais em 1 direção, 50% menos nas outras
            para preservar volume)
    """
    from numpy.random import default_rng
    rng = default_rng(seed)

    if direction_unit is None:
        # Caso isotrópico (anel): usa a função esférica simples
        return sphere_overlap_with_ellipsoid(
            contact_center, radius_mm,
            ellipsoid_center, ellipsoid_semiaxes_mm,
            n_samples=n_samples, seed=seed,
        )

    # Normalizar direção e garantir ortogonalidade com axis
    direction_unit = np.asarray(direction_unit, dtype=float)
    direction_unit /= max(np.linalg.norm(direction_unit), 1e-9)
    contact_axis = np.asarray(contact_axis, dtype=float)
    contact_axis /= max(np.linalg.norm(contact_axis), 1e-9)

    # Corrigir direction para ser perpendicular ao axis (projeção)
    dir_perp = direction_unit - np.dot(direction_unit, contact_axis) * contact_axis
    n = np.linalg.norm(dir_perp)
    if n < 1e-6:
        # direction colinear com axis — cair para isotrópico
        return sphere_overlap_with_ellipsoid(
            contact_center, radius_mm, ellipsoid_center, ellipsoid_semiaxes_mm,
            n_samples=n_samples, seed=seed,
        )
    dir_perp /= n

    # Terceiro eixo (perpendicular a ambos)
    third = np.cross(contact_axis, dir_perp)
    third /= max(np.linalg.norm(third), 1e-9)

    # Base ortonormal: [dir_perp, third, contact_axis]
    # Semieixos do VTA elipsoidal (preservando volume esférico equivalente):
    # a = radius * asymmetry_factor (na direção do segmento)
    # b = c = radius / sqrt(asymmetry_factor) (perpendicular)
    # Volume = (4/3) π abc = (4/3) π r³ * (asym * 1/asym) = preservado
    a = radius_mm * asymmetry_factor
    b = radius_mm / np.sqrt(asymmetry_factor)
    c = radius_mm / np.sqrt(asymmetry_factor)

    # Amostrar pontos uniforme dentro do elipsóide VTA
    samples = rng.uniform(-1, 1, size=(n_samples, 3))
    inside_ell = (samples ** 2).sum(axis=1) <= 1.0
    local = samples[inside_ell]
    local[:, 0] *= a
    local[:, 1] *= b
    local[:, 2] *= c

    # Rotacionar do referencial local para LPS
    # rotation matrix: colunas são os eixos da base
    R = np.column_stack([dir_perp, third, contact_axis])
    vta_points_lps = contact_center + local @ R.T

    # Verificar overlap com alvo
    rel = (vta_points_lps - ellipsoid_center) / ellipsoid_semiaxes_mm
    in_target = (rel ** 2).sum(axis=1) <= 1.0

    vol_vta = (4.0 / 3.0) * np.pi * a * b * c
    frac = float(in_target.sum() / len(local)) if len(local) else 0.0

    return {
        "model": "anisotropic_directional",
        "vta_semiaxes_mm": [float(a), float(b), float(c)],
        "sphere_radius_mm": float(radius_mm),
        "asymmetry_factor": float(asymmetry_factor),
        "sphere_volume_mm3": float(vol_vta),
        "n_samples_in_sphere": int(len(local)),
        "n_samples_in_target": int(in_target.sum()),
        "fraction_of_vta_hitting_target": frac,
        "vta_in_target_volume_mm3": float(vol_vta * frac),
    }


def simulate_vta_for_electrode(
    tip_lps: np.ndarray, axis_unit: np.ndarray, active_contact: str,
    stim: StimulationSettings, stn_centers: dict, stn_semiaxes: np.ndarray,
) -> dict:
    """Gera VTA no contato ativo e calcula overlap com cada setor do STN.

    Args:
        tip_lps: coordenada do tip em LPS (mm)
        axis_unit: vetor unitário do eixo do eletrodo (do tip para topo)
        active_contact: "1", "2A", "2B", "2C", "3A", "3B", "3C", "4"
        stim: parâmetros de estimulação
        stn_centers: dict com chaves 'motor', 'associative', 'limbic' e coord LPS
        stn_semiaxes: np.array([4.5, 3.5, 4.0]) mm

    Devolve: dict com centro do VTA, raio, overlaps com cada setor.
    """
    # Mapear nome do contato para distância do tip
    contact_dist = {
        "1": 0.75,
        "2A": 2.75, "2B": 2.75, "2C": 2.75, "2": 2.75,
        "3A": 4.75, "3B": 4.75, "3C": 4.75, "3": 4.75,
        "4": 6.75,
    }
    d = contact_dist.get(active_contact.upper(), 2.75)
    center = tip_lps + d * axis_unit
    r = stim.vta_radius_mm()

    overlaps = {}
    for sector, c_lps in stn_centers.items():
        overlap = sphere_overlap_with_ellipsoid(
            center, r, np.array(c_lps), stn_semiaxes,
        )
        overlaps[sector] = overlap

    return {
        "side": stim.side,
        "active_contact": active_contact,
        "amplitude_mA": stim.amplitude_mA,
        "pulse_width_us": stim.pulse_width_us,
        "frequency_Hz": stim.frequency_Hz,
        "impedance_ohm": stim.impedance_ohm,
        "voltage_equiv_V": stim.voltage_equiv,
        "teed_uW": stim.teed_uw(),
        "vta_center_lps_mm": center.tolist(),
        "vta_radius_mm": r,
        "overlap_with_stn": overlaps,
    }


def example_stim_settings() -> List[StimulationSettings]:
    """Parâmetros de estimulação de EXEMPLO (valores ilustrativos para a demo do VTA).

    Substitua pelos parâmetros reais do programa ativo do paciente ao usar de verdade.
    """
    return [
        StimulationSettings(
            side="left", contact="2A",
            amplitude_mA=5.8, pulse_width_us=60, frequency_Hz=119,
            impedance_ohm=2880,  # Impedância medida (alta)
        ),
        StimulationSettings(
            side="right", contact="2C",
            amplitude_mA=6.6, pulse_width_us=70, frequency_Hz=119,
            impedance_ohm=1024,
        ),
    ]


if __name__ == "__main__":
    # Demo com parâmetros do paciente
    for s in example_stim_settings():
        print(f"\n{s.side.upper()} {s.contact}: {s.amplitude_mA} mA × {s.pulse_width_us} µs × {s.frequency_Hz} Hz")
        print(f"  Impedância: {s.impedance_ohm} Ω")
        print(f"  Voltage equivalente: {s.voltage_equiv:.1f} V")
        print(f"  Raio VTA (Kuncel):  {s.vta_radius_mm('kuncel'):.2f} mm")
        print(f"  Raio VTA (Mädler, clipado):  {s.vta_radius_mm('madler'):.2f} mm")
        print(f"  TEED: {s.teed_uw():.0f} µW")
