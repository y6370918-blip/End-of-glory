from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "游戏地图和卡牌和表格"
PIECE_SOURCE = ROOT / "算子单位图标"
ASSETS = ROOT / "assets"


def save_webp(source: Path, target: Path, size: tuple[int, int] | None = None, quality: int = 88) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = image.convert("RGBA")
        if size:
            image.thumbnail(size, Image.Resampling.LANCZOS)
        image.save(target, "WEBP", quality=quality, method=6)


def save_webp_exact(source: Path, target: Path, size: tuple[int, int], quality: int = 90) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = image.convert("RGBA").resize(size, Image.Resampling.LANCZOS)
        image.save(target, "WEBP", quality=quality, method=6)


def save_jpeg_cover(source: Path, target: Path, size: tuple[int, int], quality: int = 90) -> None:
    with Image.open(source) as image:
        image = ImageOps.fit(image.convert("RGB"), size, Image.Resampling.LANCZOS)
        image.save(target, "JPEG", quality=quality, optimize=True)


def split_cards(source: Path, faction: str) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    with Image.open(source) as sheet:
        sheet = sheet.convert("RGB")
        for index in range(59):
            row, col = divmod(index, 10)
            left = round(col * sheet.width / 10)
            right = round((col + 1) * sheet.width / 10)
            top = round(row * sheet.height / 6)
            bottom = round((row + 1) * sheet.height / 6)
            crop = sheet.crop((left, top, right, bottom))
            card_id = (600 if faction == "ap" else 700) + index
            rel_1x = Path("cards") / faction / f"{card_id}.webp"
            rel_2x = Path("cards") / faction / f"{card_id}@2x.webp"
            target_2x = ASSETS / rel_2x
            target_1x = ASSETS / rel_1x
            target_2x.parent.mkdir(parents=True, exist_ok=True)
            crop.save(target_2x, "WEBP", quality=92, method=6)
            one = crop.copy()
            one.thumbnail((400, 544), Image.Resampling.LANCZOS)
            one.save(target_1x, "WEBP", quality=86, method=6)
            output.append(
                {
                    "id": card_id,
                    "faction": faction,
                    "grid": {"row": row, "column": col},
                    "image": rel_1x.as_posix(),
                    "image_2x": rel_2x.as_posix(),
                }
            )
    return output


def build_piece_assets() -> list[dict[str, object]]:
    pieces = json.loads((ROOT / "data" / "source" / "pieces.json").read_text(encoding="utf-8"))
    mo = json.loads((ROOT / "data" / "source" / "mo.json").read_text(encoding="utf-8"))
    explicit_sources = {
        str(marker["image_source"]).replace("\\", "/")
        for markers in mo.values()
        for marker in markers
        if marker.get("image_source")
    }
    required_hashes = {
        digest
        for piece in pieces
        if piece.get("source")
        for digest in (piece.get("face_hash"), piece.get("back_hash"))
        if digest
    }
    output: list[dict[str, object]] = []
    sources = sorted(PIECE_SOURCE.rglob("*.png"), key=lambda p: p.as_posix())
    by_hash: dict[str, Path] = {}
    for source in sources:
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        by_hash.setdefault(digest, source)
    missing_hashes = sorted(required_hashes - by_hash.keys())
    if missing_hashes:
        raise RuntimeError(f"Missing formal piece artwork for hashes: {', '.join(missing_hashes)}")

    selected = {by_hash[digest] for digest in required_hashes}
    selected.update(ROOT / source for source in explicit_sources)
    for source in sorted(selected, key=lambda p: p.as_posix()):
        if not source.is_file():
            raise RuntimeError(f"Missing formal piece artwork: {source.relative_to(ROOT).as_posix()}")
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        relative_source = source.relative_to(ROOT).as_posix()
        target_name = f"{digest[:16]}.webp"
        target = ASSETS / "pieces" / target_name
        save_webp(source, target, (256, 256))
        output.append(
            {
                "id": digest[:16],
                "source": relative_source,
                "name": source.stem,
                "image": f"pieces/{target_name}",
                "sha256": digest,
            }
        )
    return output


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    map_source = SOURCE / "End_of_Glory_NewMap.png"
    shutil.copyfile(map_source, ASSETS / "map.png")
    save_webp_exact(map_source, ASSETS / "map.webp", (4562, 4500), 92)
    save_webp(map_source, ASSETS / "cover.webp", (1200, 1200), 88)
    save_jpeg_cover(map_source, ROOT / "cover.1x.jpg", (150, 200))
    save_jpeg_cover(map_source, ROOT / "cover.2x.jpg", (300, 400), 92)
    save_jpeg_cover(map_source, ROOT / "thumbnail.jpg", (108, 144))
    save_webp(SOURCE / "CRT.png", ASSETS / "crt.webp", (1600, 1600), 90)

    cards = []
    cards.extend(split_cards(SOURCE / "协约卡牌(59).png", "ap"))
    cards.extend(split_cards(SOURCE / "同盟卡牌(59).png", "cp"))
    pieces = build_piece_assets()

    generated = ROOT / "data" / "generated"
    generated.mkdir(parents=True, exist_ok=True)
    (generated / "asset-manifest.json").write_text(
        json.dumps({"schema": 1, "cards": cards, "pieces": pieces}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"cards": len(cards), "pieces": len(pieces)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
