"""Small deterministic reviewer helpers; intentionally conservative."""
from __future__ import annotations

import re

PROMO = re.compile(r"保姆级|宝藏|小众|封神|攻略|绝美|治愈|天花板|必冲")
ACTION_TEXT = re.compile(r"(?:上午\d+点前出发|下山超级难打车|一路都是.*风景|转\s*\d+\s*路|地铁或打车)")


def review(candidate: dict) -> dict:
    """Return an explainable rule-only result without changing candidate records."""
    title = str(candidate.get("title", ""))
    raw = " ".join(str(candidate.get(k, "")) for k in ("raw_text", "raw_place_names", "raw_route_text"))
    stops = candidate.get("candidate_stops") or []
    if not title.strip() and not raw.strip():
        return {"type": "INVALID", "confidence": 0.99, "reason": "候选无标题及有效原文"}
    if ACTION_TEXT.search(title):
        return {"type": "INVALID", "confidence": 0.97, "reason": "标题是行动提示而非地图实体"}
    if len(stops) >= 2:
        return {"type": "ROUTE", "confidence": 0.75, "reason": "存在多个提取节点；需结合原文确认顺序"}
    if PROMO.search(title) or PROMO.search(raw):
        return {"type": candidate.get("type", "UNKNOWN"), "confidence": min(float(candidate.get("type_confidence", 0.5)), 0.68), "reason": "营销表达降低文本可信度，但不单独作为拒绝依据"}
    return {"type": candidate.get("type", "UNKNOWN"), "confidence": float(candidate.get("type_confidence", 0.5)), "reason": "未触发额外确定性规则"}
