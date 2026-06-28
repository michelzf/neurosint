# atlas/ — templates de neuroimagem (NÃO versionados)

Esta pasta guarda os templates de referência usados pelas etapas de registro para MNI152
e segmentação do STN. **Os arquivos `.nii.gz` NÃO são versionados** (são grandes e públicos —
o `.gitignore` ignora `atlas/*.nii.gz`).

## Como obter

Rode o downloader incluído, que busca os templates dos repositórios públicos do Lead-DBS:

```bash
cd tools/dbs_fusion
python download_mni152.py          # só o brainmask MNI152 (leve)
python download_mni152.py --all    # + atlas CIT168 (STN, SN, RN, GPi)
```

## O que será baixado

| Arquivo | Conteúdo | Fonte |
|---------|----------|-------|
| `mni152_brainmask.nii.gz` | Máscara cerebral MNI152NLin2009bAsym | Lead-DBS |
| `cit168_t1_700um.nii.gz` | Template T1 700 µm | CIT168 (Pauli 2018) |
| `cit168_stn_bilateral.nii.gz` | STN bilateral | CIT168 |
| `cit168_snc_/snr_/rn_/gpi_bilateral.nii.gz` | SNc, SNr, núcleo rubro, GPi | CIT168 |

Opcionalmente, o atlas **DISTAL** (Ewert 2018) pode ser colocado aqui como
`distal_minimal.nii.gz` — ver https://www.lead-dbs.org/about-distal-atlas/. O módulo
`stn_atlas.py` o usa automaticamente se presente; senão, cai nas coordenadas teóricas
de Hamani 2004.

> Estes são dados de referência **públicos e impessoais** — nada de paciente.
