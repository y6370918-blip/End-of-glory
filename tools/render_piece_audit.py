from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
PIECES = ROOT / "data" / "source" / "pieces.json"
OUTPUT = ROOT / "tmp" / "piece-values-audit.png"


def font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def main() -> None:
    pieces = [
        piece
        for piece in json.loads(PIECES.read_text(encoding="utf-8"))
        if piece["type"] in {"army", "corps"}
    ]
    cell_w, cell_h, columns = 420, 245, 4
    rows = (len(pieces) + columns - 1) // columns
    sheet = Image.new("RGB", (cell_w * columns, cell_h * rows), "#202020")
    draw = ImageDraw.Draw(sheet)
    for index, piece in enumerate(pieces):
        x = (index % columns) * cell_w
        y = (index // columns) * cell_h
        face_path = ROOT / "assets" / piece["image"]
        back_path = ROOT / "assets" / "pieces" / f"{piece['back_hash'][:16]}.webp"
        with Image.open(face_path) as source:
            face = source.convert("RGB").resize((180, 180), Image.Resampling.LANCZOS)
        with Image.open(back_path) as source:
            back = source.convert("RGB").resize((180, 180), Image.Resampling.LANCZOS)
        sheet.paste(face, (x + 15, y + 52))
        sheet.paste(back, (x + 220, y + 52))
        draw.text((x + 12, y + 7), f"{piece['id']}  {piece['name']}  {piece['type']}", font=font(20), fill="white")
        draw.text((x + 65, y + 220), "FULL", font=font(14), fill="#8ee8ff")
        draw.text((x + 272, y + 220), "REDUCED", font=font(14), fill="#ffcf75")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUTPUT)


if __name__ == "__main__":
    main()
