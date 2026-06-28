#!/usr/bin/env python3
"""
download_mni152.py — Baixa o template MNI152NLin2009bAsym do repositório Lead-DBS.

Uso:
    python download_mni152.py
    # Salva em tools/dbs_fusion/atlas/mni152_brainmask.nii.gz
"""

import sys
from pathlib import Path
import urllib.request
import ssl


# URLs raw do GitHub Lead-DBS (template MNI152 NLin 2009b Asym)
# + CIT168/Pauli 2017 atlas via NeuroVault (público, probabilístico real)
URLS = {
    # Template MNI152 brainmask (pequeno, Lead-DBS)
    "mni152_brainmask.nii.gz": (
        "https://raw.githubusercontent.com/netstim/leaddbs/master/"
        "templates/space/MNI152NLin2009bAsym/brainmask.nii.gz"
    ),
    # Template T1 700µm (CIT168, Pauli 2017) — referência para registro
    "cit168_t1_700um.nii.gz": (
        "https://neurovault.org/media/images/3145/CIT168_T1w_700um.nii.gz"
    ),
    # Atlas STN probabilístico bilateral (CIT168 volume 16) — Pauli 2017
    "cit168_stn_bilateral.nii.gz": (
        "https://neurovault.org/media/images/3145/"
        "CIT168toMNI152_prob_atlas_bilat_1mm__%28volume%2016%29.nii.gz"
    ),
    # Substância Nigra (volumes 7 SNc e 9 SNr)
    "cit168_snc_bilateral.nii.gz": (
        "https://neurovault.org/media/images/3145/"
        "CIT168toMNI152_prob_atlas_bilat_1mm__%28volume%207%29.nii.gz"
    ),
    "cit168_snr_bilateral.nii.gz": (
        "https://neurovault.org/media/images/3145/"
        "CIT168toMNI152_prob_atlas_bilat_1mm__%28volume%209%29.nii.gz"
    ),
    # Núcleo Rubro
    "cit168_rn_bilateral.nii.gz": (
        "https://neurovault.org/media/images/3145/"
        "CIT168toMNI152_prob_atlas_bilat_1mm__%28volume%208%29.nii.gz"
    ),
    # Globo Pálido interno (alvo DBS de Parkinson + Distonia)
    "cit168_gpi_bilateral.nii.gz": (
        "https://neurovault.org/media/images/3145/"
        "CIT168toMNI152_prob_atlas_bilat_1mm__%28volume%206%29.nii.gz"
    ),
}


def download(url: str, dest: Path):
    """Baixa arquivo com SSL relaxado (Windows cert issues)."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    print(f"  {url}")
    print(f"  -> {dest}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, context=ctx) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length", 0))
        downloaded = 0
        chunk_size = 1 << 16
        while True:
            chunk = r.read(chunk_size)
            if not chunk:
                break
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = 100 * downloaded / total
                print(f"    {downloaded/1e6:.1f}/{total/1e6:.1f} MB ({pct:.0f}%)", end="\r")
    print()


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true",
                        help="Baixa atlas completo CIT168 (STN, SN, RN, GPi) em vez de só brainmask")
    args = parser.parse_args()

    atlas_dir = Path(__file__).parent / "atlas"
    atlas_dir.mkdir(exist_ok=True)

    to_download = ["mni152_brainmask.nii.gz"]
    if args.all:
        to_download += [
            "cit168_t1_700um.nii.gz",
            "cit168_stn_bilateral.nii.gz",
            "cit168_snc_bilateral.nii.gz",
            "cit168_snr_bilateral.nii.gz",
            "cit168_rn_bilateral.nii.gz",
            "cit168_gpi_bilateral.nii.gz",
        ]

    errors = 0
    for name in to_download:
        url = URLS[name]
        dest = atlas_dir / name
        if dest.exists() and dest.stat().st_size > 50_000:
            print(f"[OK] {dest.name} já existe ({dest.stat().st_size/1e6:.1f} MB).")
            continue
        print(f"[*] Baixando {name}...")
        try:
            download(url, dest)
            print(f"[OK] Salvo em {dest}")
        except Exception as e:
            print(f"[ERRO] {e}")
            print(f"       Baixe manualmente de {url}")
            print(f"       e coloque em {dest}")
            errors += 1
    return errors


if __name__ == "__main__":
    sys.exit(main())
