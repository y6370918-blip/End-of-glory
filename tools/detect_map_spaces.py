from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
MAP = ROOT / "assets" / "map.png"
OUTPUT = ROOT / "data" / "generated" / "detected-spaces.json"
SCALE = 4
COLORS = {
    "ap": (0, 0, 145),
    "br": (200, 16, 46),
    "cp": (0, 0, 0),
    "be": (255, 205, 0),
    "it": (0, 146, 70),
    "ah": (190, 216, 230),
}


def components(mask: list[list[bool]], minimum: int, maximum: int) -> list[dict[str, int | float]]:
    height = len(mask)
    width = len(mask[0])
    visited = [bytearray(width) for _ in range(height)]
    result: list[dict[str, int | float]] = []
    for y in range(height):
        for x in range(width):
            if not mask[y][x] or visited[y][x]:
                continue
            queue = deque([(x, y)])
            visited[y][x] = 1
            count = 0
            min_x = max_x = x
            min_y = max_y = y
            sum_x = sum_y = 0
            while queue:
                current_x, current_y = queue.popleft()
                count += 1
                sum_x += current_x
                sum_y += current_y
                min_x = min(min_x, current_x)
                max_x = max(max_x, current_x)
                min_y = min(min_y, current_y)
                max_y = max(max_y, current_y)
                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    if (
                        0 <= next_x < width
                        and 0 <= next_y < height
                        and mask[next_y][next_x]
                        and not visited[next_y][next_x]
                    ):
                        visited[next_y][next_x] = 1
                        queue.append((next_x, next_y))
            box_area = (max_x - min_x + 1) * (max_y - min_y + 1)
            fill = count / box_area
            if minimum <= count <= maximum and fill >= 0.28:
                result.append(
                    {
                        "x": round(sum_x / count * SCALE),
                        "y": round(sum_y / count * SCALE),
                        "w": (max_x - min_x + 1) * SCALE,
                        "h": (max_y - min_y + 1) * SCALE,
                        "area": count * SCALE * SCALE,
                        "fill": round(fill, 3),
                    }
                )
    return result


def main() -> None:
    with Image.open(MAP) as original:
        image = original.convert("RGB").resize(
            (original.width // SCALE, original.height // SCALE), Image.Resampling.NEAREST
        )
    pixels = image.load()
    detected: dict[str, list[dict[str, int | float]]] = {}
    for faction, color in COLORS.items():
        mask = [[pixels[x, y] == color for x in range(image.width)] for y in range(image.height)]
        # At 1/4 scale, normal spaces contain roughly 900-2,500 fill pixels.
        items = components(mask, minimum=240, maximum=18_000)
        detected[faction] = sorted(items, key=lambda item: (item["y"], item["x"]))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(detected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: len(value) for key, value in detected.items()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
