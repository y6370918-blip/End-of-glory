from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
MAP = ROOT / "assets" / "map.png"
SOURCE = ROOT / "data" / "source"
OUTPUT = ROOT / "tmp" / "map-audit"
LEGACY_SPACES = ROOT / "tmp" / "space-audit.png"
LEGACY_CROPS = ROOT / "tmp" / "space-crops.png"


def font(size: int) -> ImageFont.ImageFont:
    for name in ("arial.ttf", "C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/msyh.ttc"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def edge_key(a: str, b: str) -> str:
    return "|".join(sorted((a, b)))


def proposal_dict(record: dict) -> dict:
    proposal = record.get("proposal")
    return proposal if isinstance(proposal, dict) else {}


def dashed(draw: ImageDraw.ImageDraw, start: tuple[float, float], end: tuple[float, float], fill, width=9, dash=24, gap=14) -> None:
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    if not length:
        return
    ux, uy = dx / length, dy / length
    offset = 0.0
    while offset < length:
        finish = min(length, offset + dash)
        draw.line((start[0] + ux * offset, start[1] + uy * offset, start[0] + ux * finish, start[1] + uy * finish), fill=fill, width=width)
        offset += dash + gap


def arrowhead(draw: ImageDraw.ImageDraw, start: tuple[float, float], end: tuple[float, float], fill) -> None:
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    if not length:
        return
    ux, uy = dx / length, dy / length
    tip = (end[0] - ux * 25, end[1] - uy * 25)
    base = (tip[0] - ux * 42, tip[1] - uy * 42)
    px, py = -uy * 24, ux * 24
    draw.polygon((tip, (base[0] + px, base[1] + py), (base[0] - px, base[1] - py)), fill=fill)


def edge_style(record: dict, exists: bool) -> tuple[tuple[int, int, int, int], bool]:
    decision = record.get("decision", "review")
    if decision == "remove":
        return (230, 35, 35, 220), True
    if decision == "add" or not exists:
        return (30, 210, 90, 220), True
    if decision == "update":
        return (50, 135, 255, 220), False
    if record.get("status") == "confirmed":
        return (35, 190, 95, 180), False
    if record.get("status") == "disputed":
        return (220, 40, 210, 220), True
    return (255, 150, 0, 190), False


def line_semantics(edge: dict) -> str:
    flags = [flag for flag in ("difficult", "alpine", "river", "requires_land_attack_support") if edge.get(flag)]
    if edge.get("river_from"):
        other = edge["b"] if edge["river_from"] == edge["a"] else edge["a"]
        flags.append(f'river:{edge["river_from"]}->{other}')
    modes = ",".join(edge.get("modes", [])) or "—"
    factions = ",".join(edge.get("factions", [])) or "—"
    return f'{edge.get("type", "?")} / {modes} / {factions}' + (f' / {",".join(flags)}' if flags else "")


def bounds_for(region_id: str, manifest: dict, spaces_by_id: dict, edge_records: list[tuple]) -> tuple[int, int, int, int]:
    points = []
    for space_id, record in manifest["spaces"].items():
        if record["region"] == region_id and space_id in spaces_by_id:
            ui = spaces_by_id[space_id]["ui"]
            points.append((ui["x"], ui["y"]))
    for _, edge, record, _ in edge_records:
        if region_id in record.get("regions", []):
            for endpoint in (edge["a"], edge["b"]):
                if endpoint in spaces_by_id:
                    ui = spaces_by_id[endpoint]["ui"]
                    points.append((ui["x"], ui["y"]))
    if not points:
        return 0, 0, 6082, 6000
    margin = 280
    return (
        max(0, math.floor(min(x for x, _ in points) - margin)),
        max(0, math.floor(min(y for _, y in points) - margin)),
        min(6082, math.ceil(max(x for x, _ in points) + margin)),
        min(6000, math.ceil(max(y for _, y in points) + margin)),
    )


def draw_spaces(base: Image.Image, spaces: list[dict], manifest: dict, region_id: str | None = None, mode: str = "proposed") -> Image.Image:
    image = base.convert("RGBA")
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    label_font = font(25)
    for space in spaces:
        record = manifest["spaces"].get(space["id"], {})
        if region_id and record.get("region") != region_id:
            continue
        if mode == "confirmed" and record.get("status") != "confirmed":
            continue
        ui = space.get("ui", {})
        if mode != "formal" and record.get("decision") in ("update", "add"):
            ui = {**ui, **proposal_dict(record).get("ui", {})}
        if not {"x", "y", "w", "h"} <= ui.keys():
            continue
        x, y, w, h = (round(ui[key]) for key in ("x", "y", "w", "h"))
        color = (35, 205, 255, 235) if mode == "formal" else (255, 205, 25, 245)
        if record.get("status") == "confirmed":
            color = (40, 215, 100, 235)
        elif record.get("status") == "disputed":
            color = (235, 45, 210, 235)
        if mode == "proposed" and record.get("decision") in ("update", "add", "remove"):
            color = (255, 205, 25, 245)
        draw.rectangle((x - w // 2, y - h // 2, x + w // 2, y + h // 2), outline=color, width=5)
        draw.ellipse((x - 10, y - 10, x + 10, y + 10), fill=color, outline=(5, 20, 50, 255), width=3)
        draw.text((x + 13, y - 28), space["id"], font=label_font, fill="white", stroke_width=4, stroke_fill="#071b42")
    return Image.alpha_composite(image, layer).convert("RGB")


def draw_edges(base: Image.Image, edge_records: list[tuple], spaces_by_id: dict, region_id: str | None = None, mode: str = "proposed") -> Image.Image:
    image = base.convert("RGBA")
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    number_font = font(22)
    for index, edge, record, exists in edge_records:
        if region_id and region_id not in record.get("regions", []):
            continue
        if mode == "formal" and not exists:
            continue
        if mode == "confirmed" and record.get("status") != "confirmed":
            continue
        if mode != "formal" and record.get("decision") in ("add", "update") and isinstance(record.get("proposal"), dict):
            edge = {**edge, **record["proposal"]}
        if mode == "confirmed" and record.get("decision") == "remove":
            continue
        if edge["a"] not in spaces_by_id or edge["b"] not in spaces_by_id:
            continue
        a, b = spaces_by_id[edge["a"]]["ui"], spaces_by_id[edge["b"]]["ui"]
        color, use_dash = ((255, 226, 43, 190), False) if mode == "formal" else edge_style(record, exists)
        if mode == "confirmed":
            color, use_dash = (35, 210, 95, 220), False
        start, end = (a["x"], a["y"]), (b["x"], b["y"])
        if edge.get("river") or edge.get("river_from"):
            draw.line((*start, *end), fill=(25, 165, 235, 230), width=19)
        if edge.get("river_from") == edge["a"]:
            arrowhead(draw, start, end, (25, 165, 235, 255))
        elif edge.get("river_from") == edge["b"]:
            arrowhead(draw, end, start, (25, 165, 235, 255))
        if use_dash:
            dashed(draw, start, end, color)
        else:
            draw.line((*start, *end), fill=color, width=9)
        mx, my = (start[0] + end[0]) / 2, (start[1] + end[1]) / 2
        label = f"E{index:03d}"
        box = draw.textbbox((0, 0), label, font=number_font, stroke_width=2)
        bw, bh = box[2] - box[0] + 12, box[3] - box[1] + 8
        draw.rounded_rectangle((mx - bw / 2, my - bh / 2, mx + bw / 2, my + bh / 2), radius=5, fill=(15, 15, 15, 220), outline=color, width=3)
        draw.text((mx, my), label, font=number_font, anchor="mm", fill="white")
    return Image.alpha_composite(image, layer).convert("RGB")


def combined_overlay(base: Image.Image, spaces: list[dict], edge_records: list[tuple], spaces_by_id: dict, manifest: dict, region_id: str, mode: str) -> Image.Image:
    with_spaces = draw_spaces(base, spaces, manifest, region_id, mode)
    visual_spaces = {key: {**value, "ui": dict(value["ui"])} for key, value in spaces_by_id.items()}
    if mode != "formal":
        for key, value in visual_spaces.items():
            record = manifest["spaces"].get(key, {})
            if record.get("decision") in ("add", "update"):
                value["ui"].update(proposal_dict(record).get("ui", {}))
    return draw_edges(with_spaces, edge_records, visual_spaces, region_id, mode)


def write_checklist(region: dict, spaces: list[dict], edges: list[tuple], manifest: dict, filename: Path) -> None:
    region_id = region["id"]
    local_spaces = [space for space in spaces if manifest["spaces"][space["id"]]["region"] == region_id]
    local_edges = [entry for entry in edges if region_id in entry[2].get("regions", [])]
    neighbors: dict[str, list[str]] = {space["id"]: [] for space in local_spaces}
    for _, edge, _, exists in local_edges:
        if not exists:
            continue
        if edge["a"] in neighbors:
            neighbors[edge["a"]].append(edge["b"])
        if edge["b"] in neighbors:
            neighbors[edge["b"]].append(edge["a"])
    lines = [f'# {region["name"]} 地图审计清单', "", "> 状态为 pending 的项目尚未获用户确认，不能写入正式地图数据。", "", "## 地块", "", "|ID|名称|当前中心/点击区|地形|港口|补给源|状态|决策|拟议修改|当前邻接|", "|---|---|---|---|---|---|---|---|---|---|"]
    for space in sorted(local_spaces, key=lambda item: (item["ui"]["y"], item["ui"]["x"])):
        record = manifest["spaces"][space["id"]]
        ui = space["ui"]
        proposal = json.dumps(record.get("proposal", {}), ensure_ascii=False, separators=(",", ":")) if record.get("proposal") else "—"
        lines.append(f'|{space["id"]}|{space["name"]}|{ui["x"]},{ui["y"]} / {ui["w"]}×{ui["h"]}|{space.get("terrain", "")}|{"是" if space.get("port") else "否"}|{"是" if space.get("supply") else "否"}|{record["status"]}|{record["decision"]}|`{proposal}`|{", ".join(sorted(neighbors[space["id"]]))}|')
    lines.extend(["", "## 连接", "", "|编号|端点|跨区|当前语义|状态|决策|拟议修改/备注|", "|---|---|---|---|---|---|---|"])
    for index, edge, record, exists in local_edges:
        note = record.get("note", "")
        proposal = json.dumps(record.get("proposal", {}), ensure_ascii=False, separators=(",", ":")) if record.get("proposal") else ""
        detail = "；".join(value for value in (proposal, note) if value) or "—"
        lines.append(f'|E{index:03d}|{edge["a"]} ↔ {edge["b"]}|{"是" if len(record.get("regions", [])) > 1 else "否"}|{line_semantics(edge) if exists else "拟新增"}|{record["status"]}|{record["decision"]}|`{detail}`|')
    lines.extend(["", f'- 地块数：{len(local_spaces)}', f'- 涉及连接数：{len(local_edges)}', f'- 地图SHA-256：`{manifest["map"]["sha256"]}`', ""])
    filename.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    spaces = json.loads((SOURCE / "spaces.json").read_text(encoding="utf-8"))
    current_edges = json.loads((SOURCE / "edges.json").read_text(encoding="utf-8"))
    manifest = json.loads((SOURCE / "map_audit.json").read_text(encoding="utf-8"))
    actual_hash = hashlib.sha256(MAP.read_bytes()).hexdigest()
    if actual_hash != manifest["map"]["sha256"]:
        raise SystemExit("map_audit.json does not match assets/map.png")
    with Image.open(MAP) as source:
        base = source.convert("RGB")
    if base.size != (6082, 6000):
        raise SystemExit(f"Unexpected map size: {base.size}")
    spaces_by_id = {space["id"]: space for space in spaces}
    current_by_key = {edge_key(edge["a"], edge["b"]): edge for edge in current_edges}
    all_keys = sorted(set(current_by_key) | set(manifest["edges"]))
    edge_records = []
    for index, key in enumerate(all_keys, 1):
        exists = key in current_by_key
        record = manifest["edges"][key]
        a, b = key.split("|", 1)
        edge = current_by_key.get(key) or {"a": a, "b": b, **proposal_dict(record)}
        edge_records.append((index, edge, record, exists))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    all_spaces = draw_spaces(base, spaces, manifest)
    all_edges = draw_edges(base, edge_records, spaces_by_id)
    all_spaces.save(LEGACY_SPACES)
    all_edges.save(OUTPUT / "all-edges.png")
    thumbs = []
    for region in manifest["regions"]:
        region_id = region["id"]
        crop_box = bounds_for(region_id, manifest, spaces_by_id, edge_records)
        space_image = draw_spaces(base, spaces, manifest, region_id).crop(crop_box)
        edge_image = draw_edges(base, edge_records, spaces_by_id, region_id).crop(crop_box)
        space_image.save(OUTPUT / f"{region_id}-spaces.png")
        edge_image.save(OUTPUT / f"{region_id}-edges.png")
        for mode in ("formal", "proposed", "confirmed"):
            combined_overlay(base, spaces, edge_records, spaces_by_id, manifest, region_id, mode).crop(crop_box).save(OUTPUT / f"{region_id}-{mode}.png")
        write_checklist(region, spaces, edge_records, manifest, OUTPUT / f"{region_id}-checklist.md")
        thumb = edge_image.copy()
        thumb.thumbnail((1180, 760), Image.Resampling.LANCZOS)
        card = Image.new("RGB", (1200, 820), "#171717")
        card.paste(thumb, ((1200 - thumb.width) // 2, 50))
        ImageDraw.Draw(card).text((20, 10), region["name"], font=font(28), fill="white")
        thumbs.append(card)
    contact = Image.new("RGB", (1200, 820 * len(thumbs)), "#101010")
    for index, card in enumerate(thumbs):
        contact.paste(card, (0, index * 820))
    contact.save(LEGACY_CROPS)
    print(f"Rendered {len(spaces)} spaces and {len(edge_records)} connections in {len(manifest['regions'])} regions at source resolution.")


if __name__ == "__main__":
    main()
