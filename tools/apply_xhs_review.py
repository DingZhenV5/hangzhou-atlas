#!/usr/bin/env python3
"""Apply only explicitly human-approved, fully specified XHS decisions.

Dry-run is the default. Formal data is read-only unless --apply is supplied;
each applied record must also carry a manually authored human_payload.
"""
from __future__ import annotations

import argparse
import copy
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_ACTIONS = {"ACCEPT_ADD", "ACCEPT_MERGE", "ACCEPT_UPDATE"}
ALLOWED_PLACE_FIELDS = {"name", "category", "stay", "see", "why", "coord", "coordinateSystem", "coordinatePrecision", "coordinateNote", "amapId", "sources", "checkedAt", "tags", "description", "recommendIndex", "amapRating", "district"}
ALLOWED_ROUTE_FIELDS = {"name", "type", "region", "duration", "distance", "difficulty", "season", "summary", "reason", "tip", "stops", "path", "coordinateSystem", "lineAccuracy", "lineLabel", "status", "sources", "checkedAt", "experience", "recommendIndex", "amapRatingSummary"}
ALLOWED_EXISTING_COORDINATE_SYSTEMS = {"GCJ-02", "未明确（与高德底图视觉接近）"}


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def validate(places: list[dict], routes: list[dict]) -> None:
    ids = [x.get("id") for x in places + routes]
    if any(not x for x in ids) or len(set(ids)) != len(ids):
        raise ValueError("地点/路线 ID 缺失或重复")
    place_ids = {p["id"] for p in places}
    for place in places:
        if not isinstance(place.get("coord"), list) or len(place["coord"]) != 2 or not all(isinstance(x, (float, int)) for x in place["coord"]):
            raise ValueError(f"地点坐标无效：{place.get('id')}")
        if place.get("coordinateSystem") not in ALLOWED_EXISTING_COORDINATE_SYSTEMS:
            raise ValueError(f"地点坐标系缺失或不受支持：{place.get('id')}")
        if not place.get("sources") or not all(str(s.get("url", "")).startswith("https://") for s in place["sources"]):
            raise ValueError(f"地点来源缺失：{place.get('id')}")
        if not place.get("tags") or not place.get("district") or not place.get("description") or not place.get("why"):
            raise ValueError(f"地点必需描述/标签/区域缺失：{place.get('id')}")
        if not isinstance(place.get("recommendIndex"), int) or not 1 <= place["recommendIndex"] <= 5:
            raise ValueError(f"地点推荐指数无效：{place.get('id')}")
    for route in routes:
        if not route.get("stops") or not all(x in place_ids for x in route["stops"]):
            raise ValueError(f"路线站点缺失/无效：{route.get('id')}")
        if not isinstance(route.get("path"), list) or len(route["path"]) < 2:
            raise ValueError(f"路线 path 至少需要两个经人工确认的点：{route.get('id')}")
        if not route.get("sources") or not all(str(s.get("url", "")).startswith("https://") for s in route["sources"]):
            raise ValueError(f"路线来源缺失：{route.get('id')}")
        if not route.get("reason") or not route.get("experience"):
            raise ValueError(f"路线体验说明缺失：{route.get('id')}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("decisions", type=Path, help="审核页导出的 xhs-human-decisions.json，须为项目外人工补全 human_payload 的副本")
    ap.add_argument("--places", type=Path, default=ROOT / "data/places.json")
    ap.add_argument("--routes", type=Path, default=ROOT / "data/routes.json")
    ap.add_argument("--apply", action="store_true", help="明确启用正式数据写入")
    ap.add_argument("--validate-build", action="store_true", help="写入后运行 tools/build.mjs；失败则从备份恢复")
    args = ap.parse_args()
    data = read(args.decisions)
    decisions = data.get("decisions", [])
    accepted = [d for d in decisions if d.get("human_action") in ALLOWED_ACTIONS]
    if not args.apply:
        print(json.dumps({"mode": "dry-run", "accepted_decisions": len(accepted), "writes": 0, "note": "再次执行时显式添加 --apply，且每项须有 human_payload。"}, ensure_ascii=False, indent=2))
        return 0
    if not accepted:
        print("没有 ACCEPT_ADD / ACCEPT_MERGE / ACCEPT_UPDATE 决定；未修改正式数据。")
        return 0
    missing = [d.get("candidate_id", "?") for d in accepted if not isinstance(d.get("human_payload"), dict)]
    if missing:
        raise ValueError(f"缺少人工完整填写的 human_payload，拒绝写入：{', '.join(missing[:8])}")
    places, routes = read(args.places), read(args.routes)
    next_places, next_routes = copy.deepcopy(places), copy.deepcopy(routes)
    for decision in accepted:
        payload = decision["human_payload"]
        source_url = str(decision.get("source_url", ""))
        collection = payload.get("collection")
        target_id = payload.get("target_id")
        is_place = collection == "places"
        target = next((x for x in (next_places if is_place else next_routes) if x.get("id") == target_id), None) if collection in {"places", "routes"} else None
        fields = ALLOWED_PLACE_FIELDS if is_place else ALLOWED_ROUTE_FIELDS
        changes = payload.get("changes", {})
        if decision["human_action"] == "ACCEPT_ADD":
            record = payload.get("record")
            if collection not in {"places", "routes"} or not isinstance(record, dict):
                raise ValueError("ACCEPT_ADD 必须有 collection=places/routes 和完整人工 record")
            if set(record) - (fields | {"id"}) or not record.get("id"):
                raise ValueError("新增 record 含未知字段或缺少 id")
            if collection == "places":
                # Coordinates must be supplied explicitly in human_payload; never copied from XHS/model output.
                if "coord" not in record or "coordinateSystem" not in record or record.get("coordinateSystem") != "GCJ-02":
                    raise ValueError("新增地点必须人工填写 GCJ-02 coord，pipeline 不提供猜测坐标")
                if not any(s.get("url") == source_url for s in record.get("sources", [])):
                    raise ValueError("新增地点 sources 必须保留该候选的原始 source_url")
                next_places.append(record)
            else:
                if "path" not in record or "stops" not in record:
                    raise ValueError("新增路线必须人工填写 stops 和浏览 path")
                if not any(s.get("url") == source_url for s in record.get("sources", [])):
                    raise ValueError("新增路线 sources 必须保留该候选的原始 source_url")
                next_routes.append(record)
            continue
        if not target:
            raise ValueError(f"MERGE/UPDATE 必须指定已有 target_id：{target_id}")
        if not changes or set(changes) - fields:
            raise ValueError(f"缺少变更内容或含禁止字段：{target_id}")
        if "sources" not in changes or not any(s.get("url") == source_url for s in changes.get("sources", [])):
            raise ValueError("合并/更新必须在 sources 中保留该候选的原始 source_url")
        if any(decision["human_action"] == "ACCEPT_MERGE" and k in {"coord", "path"} for k in changes):
            raise ValueError("合并操作不可修改坐标或路线 geometry")
        target.update(changes)
    validate(next_places, next_routes)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = ROOT / "private/local-only/backups" / f"xhs-apply-{stamp}"
    backup.mkdir(parents=True, exist_ok=False)
    place_backup, route_backup = backup / "places.json", backup / "routes.json"
    shutil.copy2(args.places, place_backup)
    shutil.copy2(args.routes, route_backup)
    try:
        args.places.write_text(json.dumps(next_places, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        args.routes.write_text(json.dumps(next_routes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if args.validate_build:
            subprocess.run(["node", str(ROOT / "tools/build.mjs")], cwd=ROOT, check=True)
    except Exception:
        shutil.copy2(place_backup, args.places)
        shutil.copy2(route_backup, args.routes)
        raise
    print(json.dumps({"mode": "applied", "accepted_decisions": len(accepted), "backup": str(backup), "writes": {"places": len(next_places) - len(places), "routes": len(next_routes) - len(routes)}}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"拒绝应用：{exc}", file=sys.stderr)
        raise SystemExit(2)
