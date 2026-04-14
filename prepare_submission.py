"""
Phase 4: Convert all figures to TIF/EPS + package final submission ZIP.

Outputs:
  data/output/tif_figures/       - TIF format (300 DPI, LZW compressed)
  data/output/eps_figures/       - EPS format (vector)
  data/output/submission_package/mining_disturbance_submission.zip
"""

import os
import shutil
import zipfile
from pathlib import Path
from PIL import Image
import subprocess

BASE = Path(r"D:\xiangmu\miningplan\data\output")
PNG_DIR = BASE / "all_png"
SUPP_DIR = BASE / "supplementary_figures"
TIF_DIR = BASE / "tif_figures"
EPS_DIR = BASE / "eps_figures"
TABLE_DIR = BASE / "word_tables"
CAPTION_FILE = BASE / "submission_package" / "Figure_Table_Captions.docx"
ZIP_PATH = BASE / "submission_package" / "mining_disturbance_submission.zip"


def convert_png_to_tif():
    """Convert all PNG figures to TIF (300 DPI, LZW compression)."""
    TIF_DIR.mkdir(parents=True, exist_ok=True)

    count = 0
    for png_file in sorted(PNG_DIR.glob("*.png")):
        tif_file = TIF_DIR / png_file.with_suffix(".tif").name
        img = Image.open(png_file)
        img.save(tif_file, format="TIFF", compression="tiff_lzw", dpi=(300, 300))
        count += 1

    for png_file in sorted(SUPP_DIR.glob("*.png")):
        tif_file = TIF_DIR / png_file.with_suffix(".tif").name
        img = Image.open(png_file)
        img.save(tif_file, format="TIFF", compression="tiff_lzw", dpi=(300, 300))
        count += 1

    print(f"  [OK] {count} TIF files in {TIF_DIR}")


def convert_pdf_to_eps():
    """Convert PDF figures to EPS using Ghostscript (if available), else skip."""
    EPS_DIR.mkdir(parents=True, exist_ok=True)

    # Check for ghostscript
    gs_cmd = None
    for cmd in ["gswin64c", "gswin32c", "gs"]:
        try:
            result = subprocess.run([cmd, "--version"], capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                gs_cmd = cmd
                break
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue

    if not gs_cmd:
        print("  [SKIP] Ghostscript not found, EPS conversion skipped (PDF is vector format)")
        return

    count = 0
    pdf_dirs = [
        ("main", Path(r"D:\xiangmu\miningplan\data\export_package\sci_figures")),
        ("supp", SUPP_DIR),
    ]

    for label, pdf_dir in pdf_dirs:
        # Find latest ZIP for main figures
        if label == "main":
            zips = sorted(pdf_dir.glob("*.zip"))
            if not zips:
                continue
            import zipfile as zf_mod
            with zf_mod.ZipFile(zips[-1], "r") as zf:
                pdf_files_in_zip = [n for n in zf.namelist() if n.endswith(".pdf")]
                for pdf_name in pdf_files_in_zip:
                    # Extract to temp, convert, save EPS
                    data = zf.read(pdf_name)
                    tmp_pdf = EPS_DIR / "__tmp.pdf"
                    tmp_pdf.write_bytes(data)
                    eps_name = Path(pdf_name).stem + ".eps"
                    eps_path = EPS_DIR / eps_name
                    try:
                        subprocess.run([
                            gs_cmd, "-dNOPAUSE", "-dBATCH", "-sDEVICE=eps2write",
                            f"-sOutputFile={eps_path}", str(tmp_pdf)
                        ], capture_output=True, timeout=30)
                        count += 1
                    except Exception:
                        pass
                    tmp_pdf.unlink(missing_ok=True)
        else:
            for pdf_file in sorted(pdf_dir.glob("*.pdf")):
                eps_path = EPS_DIR / pdf_file.with_suffix(".eps").name
                try:
                    subprocess.run([
                        gs_cmd, "-dNOPAUSE", "-dBATCH", "-sDEVICE=eps2write",
                        f"-sOutputFile={eps_path}", str(pdf_file)
                    ], capture_output=True, timeout=30)
                    count += 1
                except Exception:
                    pass

    print(f"  [OK] {count} EPS files in {EPS_DIR}")


def build_submission_zip():
    """Build the final submission ZIP package."""
    ZIP_PATH.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1. Main figures (TIF)
        for tif in sorted(TIF_DIR.glob("*.tif")):
            zf.write(tif, f"figures/{tif.name}")

        # 2. PDF vector figures (from supplementary)
        for pdf in sorted(SUPP_DIR.glob("*.pdf")):
            zf.write(pdf, f"figures/pdf/{pdf.name}")

        # 3. Main PDFs from SCI export
        sci_dir = Path(r"D:\xiangmu\miningplan\data\export_package\sci_figures")
        zips = sorted(sci_dir.glob("*.zip"))
        if zips:
            import zipfile as zf_mod
            with zf_mod.ZipFile(zips[-1], "r") as sci_zf:
                for name in sci_zf.namelist():
                    if name.endswith(".pdf"):
                        data = sci_zf.read(name)
                        flat = name.replace("/", "_")
                        zf.writestr(f"figures/pdf/{flat}", data)

        # 4. Supplementary figures (TIF)
        for tif in sorted(TIF_DIR.glob("figS*.tif")):
            zf.write(tif, f"supplementary/{tif.name}")

        # 5. Tables
        for docx in sorted(TABLE_DIR.rglob("*.docx")):
            zf.write(docx, f"tables/{docx.name}")

        # 6. Captions
        if CAPTION_FILE.exists():
            zf.write(CAPTION_FILE, "Figure_Table_Captions.docx")

        # 7. CSV data files from SCI export
        if zips:
            import zipfile as zf_mod
            with zf_mod.ZipFile(zips[-1], "r") as sci_zf:
                for name in sci_zf.namelist():
                    if name.endswith(".csv"):
                        data = sci_zf.read(name)
                        zf.writestr(f"data/{name.replace('/', '_')}", data)

        # 8. README
        readme = (
            "Mining Disturbance Assessment - SCI Submission Package\n"
            "=" * 55 + "\n\n"
            "Contents:\n"
            "  figures/          - All figures in TIF (300 DPI) format\n"
            "  figures/pdf/      - All figures in PDF (vector) format\n"
            "  supplementary/    - Supplementary figures (Fig. S1-S4)\n"
            "  tables/           - Tables 1-5 in Word (.docx) format\n"
            "  data/             - Raw data tables (CSV)\n"
            "  Figure_Table_Captions.docx - All captions (Word + LaTeX)\n\n"
            "Figure format: TIF (LZW compressed, 300 DPI, Times New Roman)\n"
            "Table format: DOCX (Times New Roman, three-line style)\n"
            "Generated: 2024-04-14\n"
        )
        zf.writestr("README.txt", readme)

    size_mb = ZIP_PATH.stat().st_size / (1024 * 1024)

    with zipfile.ZipFile(ZIP_PATH, "r") as zf:
        names = zf.namelist()
        tif_count = sum(1 for n in names if n.endswith(".tif"))
        pdf_count = sum(1 for n in names if n.endswith(".pdf"))
        docx_count = sum(1 for n in names if n.endswith(".docx"))
        csv_count = sum(1 for n in names if n.endswith(".csv"))

    print(f"  [OK] {ZIP_PATH.name} ({size_mb:.1f} MB)")
    print(f"       TIF: {tif_count}, PDF: {pdf_count}, DOCX: {docx_count}, CSV: {csv_count}")
    print(f"       Total: {len(names)} files")


def main():
    print("Phase 4: Submission Package Preparation\n")

    print("Step 1: Convert PNG -> TIF...")
    convert_png_to_tif()

    print("\nStep 2: Convert PDF -> EPS...")
    convert_pdf_to_eps()

    print("\nStep 3: Build submission ZIP...")
    build_submission_zip()

    print(f"\nDone! Submission package: {ZIP_PATH}")


if __name__ == "__main__":
    main()
