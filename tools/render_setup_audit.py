from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "tmp" / "historical-setup-audit.png"


def main() -> None:
    spaces = {
        space["id"]: space
        for space in json.loads((ROOT / "data" / "source" / "spaces.json").read_text(encoding="utf-8"))
    }
    pieces = {
        piece["id"]: piece
        for piece in json.loads((ROOT / "data" / "source" / "pieces.json").read_text(encoding="utf-8"))
    }
    setup = json.loads((ROOT / "data" / "source" / "setup.json").read_text(encoding="utf-8"))["historical"]
    stacks: dict[str, list[dict[str, object]]] = defaultdict(list)
    for unit in setup["objects"]:
        piece = pieces.get(unit.get("component"))
        if unit.get("zone") != "map" or not unit.get("location") or piece is None:
            continue
        if piece["type"] not in {"army", "corps", "hq"} or piece["nation"] == "it":
            continue
        stacks[unit["location"]].append(unit)

    with Image.open(ROOT / "assets" / "map.webp") as source:
        image = source.convert("RGBA")
    for space_id, units in stacks.items():
        space = spaces[space_id]
        centre_x = round(space["ui"]["x"] / 2)
        centre_y = round(space["ui"]["y"] / 2)
        for index, unit in enumerate(units):
            piece = pieces[unit["component"]]
            size = 75 if piece["type"] == "army" else 60 if piece["type"] == "corps" else 50
            image_name = piece["back_hash"][:16] if unit.get("reduced") else piece["face_hash"][:16]
            with Image.open(ROOT / "assets" / "pieces" / f"{image_name}.webp") as source:
                counter = source.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
            x = centre_x + index * 3 - size // 2
            y = centre_y - index * 3 - size // 2
            image.alpha_composite(counter, (x, y))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(OUTPUT)


if __name__ == "__main__":
    main()
