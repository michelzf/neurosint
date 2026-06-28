# dbs_fusion — Fusão TC+RM e Análise de Posicionamento de Eletrodos DBS

Pipeline em Python (SimpleITK) que faz **triagem automatizada e reprodutível** do
posicionamento de eletrodos de DBS, a partir de uma RM pré-operatória e uma TC
pós-operatória em DICOM.

> ⚠️ **Não é laudo clínico nem substitui Lead-DBS / Brainlab / Guide XT.** É uma ferramenta
> de triagem para você levar perguntas embasadas ao médico. Veja o `DISCLAIMER.md` do projeto.
> **Não versione DICOM de paciente** — as entradas são caminhos locais; a saída é ignorada
> pelo `.gitignore`.

## Por que existe

Software de reconstrução de DBS de padrão-ouro (Lead-DBS em MATLAB, Brainlab, Boston Guide XT)
é caro, proprietário ou dependente de analista. Este pipeline dá ao projeto a capacidade
**reprodutível, automatizável e versionável** de gerar uma análise comparativa dos eletrodos
sempre que novos DICOMs forem obtidos — sem depender de software proprietário.

Num caso real (anonimizado), ele detectou a **mesma assimetria ântero-posterior** entre os
eletrodos que um neurologista de movimento havia identificado por software especializado —
reproduzindo numericamente a observação qualitativa de que um lado estava fora do alvo motor.

## O que faz

1. Lê séries DICOM recursivamente (TC pós-op + RM pré-op), escolhe a maior série por modalidade.
2. Registra TC→RM com transformação rígida 6-DoF (SimpleITK, Mattes Mutual Information).
3. Reamostra para LPS canônico axial isotrópico (0,5 mm) — corrige protocolos sagital/coronal.
4. Detecta eletrodos (threshold HU >2000, ROI cerebral profunda, clustering DBSCAN, filtro tubular).
5. Classifica esquerdo/direito por coordenada X_LPS (convenção DICOM).
6. Modela os contatos do eletrodo projetando-os no eixo detectado.
7. Estima o MCP automaticamente ou aceita marcação manual (`--mcp` ou `--ac`/`--pc`).
8. Gera máscara STN setorial (motor/associativo/límbico) — coordenadas de Hamani 2004
   ou, opcionalmente, atlas CIT168/DISTAL registrado para MNI152.
9. Verifica se cada tip está dentro da máscara STN (distância assinada).
10. Simula o VTA (Volume de Tecido Ativado) por contato (Kuncel & Grill 2004 / Mädler 2012).
11. Calcula o overlap do VTA com cada setor do STN (Monte Carlo) — o achado mais acionável.
12. Calcula assimetrias entre tips (AP, lateral, SI) — medida independente de MCP.
13. Gera relatório visual (`comparison.png` + `stn_target.png`) + JSON + Markdown.
14. Suporta comparação longitudinal entre 2 estudos (`compare_longitudinal.py`).

## O que NÃO faz (limitações honestas)

- Não substitui Lead-DBS / Brainlab / Boston Guide XT.
- Sem atlas individualmente deformado por padrão — usa coordenadas teóricas (Hamani 2004).
  Erro esperado: 3–4 mm. O atlas CIT168/MNI152 melhora isso (ver `atlas/README.md`).
- MCP estimado heuristicamente — precisão estereotáxica exige marcação manual de AC/PC.
- A classificação anatômica é parcialmente circular quando o MCP é derivado dos tips.
  O que é **robusto** é a **assimetria relativa** entre os dois eletrodos.
- Registro rígido apenas — não corrige *brain shift* entre RM pré-op e TC pós-op.

## Instalação

```bash
cd tools/dbs_fusion
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Dependências: SimpleITK, pydicom, numpy, scipy, matplotlib, nibabel, scikit-image,
scikit-learn, antspyx (já no `requirements.txt`).

Para a etapa MNI/atlas, baixe os templates públicos (Lead-DBS):
```bash
python download_mni152.py --all     # ver atlas/README.md
```

## Uso (pipeline rápido)

```bash
./run_pipeline.sh \
  ../../exames/AAAA-MM-DD_RM_planejamento_DBS/DICOM \
  ../../exames/AAAA-MM-DD_TC_cranio_volumetrica/DICOM \
  ../../DBS/fusion_$(date +%F)
```

Saída (em `DBS/fusion_.../`): `mri.nii.gz`, `ct_in_mri_space.nii.gz`, `ct_to_mri.tfm`,
`electrode_labels.nii.gz`, `electrodes.json`, `comparison.png`, `report.md`.

### Pipeline completo (com MNI + VTA + export Lead-DBS)

```bash
./run_full_pipeline.sh <RM_dicom> <TC_dicom> <saida> [--mcp 0,-5,-3] [--mni-type Affine]
```

### Passo a passo

```bash
python fuse_ct_mri.py     --mri <RM_dicom> --ct <TC_dicom> --out <saida>
python detect_electrodes.py --ct <saida>/ct_lps.nii.gz --out <saida> [--mcp 0,-5,-3]
python generate_report.py --out <saida>
python compare_longitudinal.py --old <fusao_antiga> --new <fusao_nova> --out <saida>/longitudinal.md
```

## Como interpretar a saída (`report.md`)

| Flag | Significado |
|------|-------------|
| `ap_diff_mm_left_minus_right` < −3 mm | Eletrodo esquerdo mais anterior que o direito |
| `ap_diff_mm_left_minus_right` > +3 mm | Eletrodo direito mais anterior que o esquerdo |
| `lateral_diff_mm_left_minus_right` assimétrico | Entrada cutânea / trajetória divergente |

**Sistema de coordenadas:** DICOM padrão é LPS (X+ = esquerda do paciente, Y+ = posterior,
Z+ = superior). Se o DICOM estiver em RAS, inverter os sinais de X e Y.

## Referências

- SimpleITK: https://simpleitk.readthedocs.io/
- Lead-DBS (padrão-ouro MATLAB, referência conceitual): https://www.lead-dbs.org/
- Atlas DISTAL: Ewert et al. 2018 — https://www.lead-dbs.org/about-distal-atlas/
- Atlas CIT168: Pauli et al. 2018 (subcortical, MNI152).
- Mattes Mutual Information: Mattes et al. 2003 (registro multimodal CT-MR).
- Coordenadas do STN: Hamani et al. 2004.
- Modelo de VTA: Kuncel & Grill 2004; Mädler & Coenen 2012.
