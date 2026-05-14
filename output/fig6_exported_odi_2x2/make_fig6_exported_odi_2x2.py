from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


WORKSPACE = Path(__file__).resolve().parents[2]
OUT_DIR = Path(__file__).resolve().parent
DOWNLOADS = Path("D:/Downloads")

ORDER_TOKENS = [
    "08-40-22-949Z",
    "08-40-13-104Z",
    "08-39-55-497Z",
    "10-26-46-122Z",
]


def locate_images() -> list[Path]:
    candidates = [p for p in DOWNLOADS.glob("*.png") if "2026-05-14T" in p.name]
    images: list[Path] = []
    for token in ORDER_TOKENS:
        matches = [p for p in candidates if token in p.name]
        if not matches:
            raise FileNotFoundError(f"Cannot locate exported ODI image containing {token}.")
        images.append(matches[0])
    return images


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in [
        Path(r"C:/Windows/Fonts/simhei.ttf"),
        Path(r"C:/Windows/Fonts/simsun.ttc"),
        Path(r"C:/Windows/Fonts/times.ttf"),
    ]:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def paste_grid(images: list[Image.Image], labeled: bool) -> Image.Image:
    tile_w, tile_h = images[0].size
    margin = 34
    gutter = 30
    out_w = tile_w * 2 + gutter + margin * 2
    out_h = tile_h * 2 + gutter + margin * 2
    canvas = Image.new("RGB", (out_w, out_h), "white")
    draw = ImageDraw.Draw(canvas)
    font = load_font(26)
    labels = ["（a）", "（b）", "（c）", "（d）"]

    positions = [
        (margin, margin),
        (margin + tile_w + gutter, margin),
        (margin, margin + tile_h + gutter),
        (margin + tile_w + gutter, margin + tile_h + gutter),
    ]
    for idx, (image, pos) in enumerate(zip(images, positions)):
        canvas.paste(image.convert("RGB"), pos)
        if labeled:
            x, y = pos
            label = labels[idx]
            bbox = draw.textbbox((0, 0), label, font=font)
            box_w = bbox[2] - bbox[0] + 18
            box_h = bbox[3] - bbox[1] + 14
            draw.rounded_rectangle(
                [x + 14, y + 12, x + 14 + box_w, y + 12 + box_h],
                radius=6,
                fill=(255, 255, 255),
                outline=(210, 220, 232),
                width=1,
            )
            draw.text((x + 23, y + 18), label, fill=(0, 0, 0), font=font)
    return canvas


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    paths = locate_images()
    images = [Image.open(path).convert("RGBA") for path in paths]
    if len({image.size for image in images}) != 1:
        raise ValueError(f"Input image sizes are not identical: {[image.size for image in images]}")

    plain = paste_grid(images, labeled=False)
    labeled = paste_grid(images, labeled=True)

    scale = 2
    resample = Image.Resampling.LANCZOS
    plain_2x = plain.resize((plain.width * scale, plain.height * scale), resample=resample)
    labeled_2x = labeled.resize((labeled.width * scale, labeled.height * scale), resample=resample)

    plain_path = OUT_DIR / "fig6_exported_odi_2x2.png"
    labeled_path = OUT_DIR / "fig6_exported_odi_2x2_labeled.png"
    plain_2x.save(plain_path, dpi=(600, 600))
    labeled_2x.save(labeled_path, dpi=(600, 600))
    plain_2x.save(OUT_DIR / "fig6_exported_odi_2x2.pdf", "PDF", resolution=600)
    labeled_2x.save(OUT_DIR / "fig6_exported_odi_2x2_labeled.pdf", "PDF", resolution=600)

    manifest = OUT_DIR / "fig6_exported_odi_2x2_sources.txt"
    manifest.write_text("\n".join(path.as_posix() for path in paths), encoding="utf-8")
    print(labeled_path)


if __name__ == "__main__":
    main()
