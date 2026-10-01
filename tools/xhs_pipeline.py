#!/usr/bin/env python3
"""Conservative XHS candidate audit. Reads the official map database; never edits it."""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from xhs_pipeline.reviewers.rule_reviewer import review as review_rules

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BATCH = ROOT / "private/local-only/research/xhs/2026-09-30/xhs-batch-2026-09-30.csv"
DEFAULT_PLACES_REVIEW = ROOT / "private/local-only/research/xhs/2026-09-30/xhs-places-review.csv"
DEFAULT_ROUTES_REVIEW = ROOT / "private/local-only/research/xhs/2026-09-30/xhs-routes-review.csv"
DEFAULT_OUTPUT = ROOT / "private/local-only/research/xhs-audit"

# Centralized, explainable weights. Geometry is disabled for overview_only routes.
WEIGHTS = {"node": 0.50, "sequence": 0.30, "geo": 0.20}
THRESHOLDS = {"poi_probable": 0.86, "poi_possible": 0.62, "route_high": 0.72, "route_partial": 0.25}
MARKETING = re.compile(r"保姆级|宝藏|小众|封神|神仙|攻略|超详细|新手必看|最美|秘境|治愈|必冲|天花板|绝美")
COLLECTION = re.compile(r"(?:\d+|[一二三四五六七八九十百]+)\s*条(?:徒步|路线|古道|线路)|路线合集|合集|多条路线|路线推荐合集|整理了.{0,4}条")
ARROW = re.compile(r"(?:→|➡|➜|➝|->|—|–|－|~>)")
NON_ENTITY = re.compile(r"^(?:上午|下午|早上|晚上|下山|上山|建议|注意|出发前|沿路继续|继续向前|沿越王路|地铁或打车|转\s*\d|步行约|约?\d+[分小时公里]|全程|游玩路线|路线导航|信息$|​​+$|一路都是|下山超级难打车|上午\d+点前出发|徒步天花板|整理了\d+条|窒息|前半段|风景必须美|不想走还可以坐车)")


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path or not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return [dict(row) for row in csv.DictReader(f)]


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v for k, v in row.items()})


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", str(value or "")).lower()
    value = re.sub(r"[\u200b-\u200f\ufeff\ufe0e\ufe0f\u20e3]", "", value)
    value = re.sub(r"[\s\u3000·•,，.。!！?？:：;；'\"“”‘’()（）\[\]【】{}<>《》/\\|_—–-]+", "", value)
    return value


def clean_name(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip()
    text = re.sub(r"^\[[一二三四五六七八九十零百0-9]+R\]", "", text)
    text = re.sub(r"^\d+\ufe0f?\u20e3?", "", text)
    text = re.sub(r"^[\s\u200b-\u200f\ufe0f📍🚶🌿💡✅🔁✨☁️🌊⛰️🏔️]+", "", text)
    text = re.sub(r"^(?:路线|徒步路线|推荐路线|起点|终点|第[一二三四五六七八九十\d]+站)\s*[:：\-—]?\s*", "", text)
    text = re.split(r"[：:]", text, 1)[0].strip()
    text = re.sub(r"[🌿🍃⛰️🏔️✨✅📍🚶]+$", "", text).strip(" ：:，,。.!！?？ '“”‘’")
    text = re.sub(r"（(?:西湖区|萧山区|余杭区|临安区|富阳区|桐庐县|淳安县|拱墅区|滨江区)[^）]*）$", "", text)
    return text[:80]


def stable_id(source: str, url: str, kind: str, text: str, suffix: str = "") -> str:
    digest = hashlib.sha1("\0".join((source, url, kind, normalize(text), suffix)).encode("utf-8")).hexdigest()[:12]
    return f"xhs-{kind.lower()}-{digest}"


def valid_xhs_url(value: str) -> bool:
    return bool(re.match(r"^https://(?:www\.)?xiaohongshu\.com/(?:explore|discovery/item)/[A-Za-z0-9]+", value or ""))


def split_urls(value: str) -> list[str]:
    return [x.strip() for x in re.split(r"\s*\|\s*", value or "") if x.strip()]


def note_id_from_url(value: str) -> str:
    m = re.search(r"/(?:explore|discovery/item)/([A-Za-z0-9]+)", value or "")
    return m.group(1) if m else ""


def note_raw(note: dict) -> str:
    parts = []
    for field in ("title", "description_excerpt", "route_excerpt", "place_candidates"):
        v = (note.get(field) or "").strip()
        if v and v not in parts:
            parts.append(f"[{field}] {v}")
    return "\n".join(parts)


def char_dice(a: str, b: str) -> float:
    a, b = normalize(a), normalize(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    def grams(s):
        return {s[i:i + 2] for i in range(max(1, len(s) - 1))} if len(s) > 1 else {s}
    ga, gb = grams(a), grams(b)
    score = 2 * len(ga & gb) / (len(ga) + len(gb))
    if a in b or b in a:
        containment = min(len(a), len(b)) / max(len(a), len(b))
        # Short geographic nicknames are possible matches only; they are never exact aliases.
        score = max(score, 0.70 if min(len(a), len(b)) <= 3 else containment * 0.95)
    return score


def poi_similarity(candidate: str, place: dict, context: str = "") -> tuple[float, str]:
    n = normalize(candidate)
    existing = normalize(place.get("name", ""))
    if n and n == existing:
        return 1.0, "EXACT_MATCH"
    # Qualified official names often contain a canonical sub-place name.
    if n and existing and (n in existing or existing in n):
        ratio = min(len(n), len(existing)) / max(len(n), len(existing))
        score = max(0.68 if min(len(n), len(existing)) <= 3 else 0.86, min(0.94, ratio + 0.1))
        return score, "PROBABLE_MATCH" if score >= THRESHOLDS["poi_probable"] else "POSSIBLE_MATCH"
    score = char_dice(candidate, place.get("name", ""))
    # Context can support a textual alias, but cannot manufacture coordinates.
    ctx = normalize(context)
    if existing and existing in ctx and n and n in ctx:
        score = min(0.94, score + 0.16)
    if score >= THRESHOLDS["poi_probable"]:
        return score, "PROBABLE_MATCH"
    if score >= THRESHOLDS["poi_possible"]:
        return score, "POSSIBLE_MATCH"
    return score, "UNRESOLVED"


def match_poi(name: str, places: list[dict], context: str = "") -> dict:
    ranked = sorted(((poi_similarity(name, p, context)[0], p) for p in places), key=lambda x: x[0], reverse=True)
    if not ranked:
        return {"match_type": "UNRESOLVED", "match_score": 0.0, "matched_existing_id": "", "matched_existing_name": "", "second_match_score": 0.0}
    best_score, best = ranked[0]
    second = ranked[1][0] if len(ranked) > 1 else 0.0
    _, category = poi_similarity(name, best, context)
    if category in {"PROBABLE_MATCH", "POSSIBLE_MATCH"} and best_score - second < 0.08:
        category = "POSSIBLE_MATCH"
    return {"match_type": category, "match_score": round(best_score, 3), "matched_existing_id": best["id"], "matched_existing_name": best["name"], "second_match_score": round(second, 3)}


def extract_nodes(raw: str) -> list[str]:
    """Parse only explicit ordered chains. Never infer a route from prose or coordinates."""
    text = unicodedata.normalize("NFKC", str(raw or ""))
    # Keep an explicit sub-chain, not distances/marketing descriptions following it.
    chunks = re.split(r"\s*[|\n;；]\s*", text)
    for chunk in chunks:
        chunk = re.sub(r"^(?:\[[^]]+\]|\d+[️⃣.)、]?|【?路线(?:详情|全程)?】?\s*[:：]?)\s*", "", chunk.strip())
        if not ARROW.search(chunk):
            continue
        pieces = ARROW.split(chunk)
        names = []
        for piece in pieces:
            item = clean_name(piece)
            if not item:
                continue
            # Route notes commonly append explanatory prose to the last node.
            item = re.split(r"[，,。；;\s]{2,}|(?:新手|入门|路线|全程|约\d|约|公里|小时)", item, 1)[0].strip()
            item = clean_name(item)
            if len(normalize(item)) >= 2 and not NON_ENTITY.search(item) and not MARKETING.search(item) and item not in names:
                names.append(item)
        if len(names) >= 2:
            return names[:40]
    return []


def split_stop_field(raw: str) -> list[str]:
    names = []
    for token in re.split(r"\s*\|\s*|\s*[、,，]\s*", raw or ""):
        item = clean_name(token)
        if len(normalize(item)) >= 2 and not NON_ENTITY.search(item) and item not in names:
            names.append(item)
    return names[:40]


def classify_poi(name: str, raw_text: str) -> tuple[str, float, list[str]]:
    n = normalize(name)
    reasons = []
    if not n or len(n) < 2:
        return "INVALID", 0.0, ["空值、不可见字符或名称过短"]
    if NON_ENTITY.search(name) or re.search(r"(?:公里|分钟|小时|打车|出发|步数|蚊虫|施工|别走错|必冲|闭眼冲)$", name):
        return "INVALID", 0.12, ["名称是行动提示、体验描述或路线说明，不是稳定地图实体"]
    if re.search(r"(?:路线合集|\d+条.*路线|周末去哪|最美拍照地|隐藏仙境)$", name) or re.search(r"(?:徒步|路线|city\s*walk|citywalk|攻略).{0,18}(?:杭州|西湖|徒步|路线)|(?:杭州|西湖).{0,18}(?:徒步|路线|攻略)$", name, re.I):
        return "INVALID", 0.18, ["名称是合集标题或泛化营销概念"]
    if re.search(r"(?:感|拉满|绝美|治愈|小众|天花板|宝藏|氛围|秘境|出片|必冲|闭眼冲|新手友好|轻松拿捏)$", name):
        return "INVALID", 0.18, ["名称是体验描述或营销概念，不是明确地图实体"]
    if re.search(r"(?:观景台|公交车站|公交站|入口|山路|步道)$", name) and len(n) <= 5:
        reasons.append("名称过于泛化，需确认具体实体")
        return "UNKNOWN", 0.48, reasons
    conf = 0.72 if len(n) >= 3 else 0.58
    if re.search(r"(?:村|寺|山|湖|塔|桥|馆|公园|古道|水库|景区|街|巷|亭|岩|遗址|湿地|瀑布|书院)$", name):
        conf = min(0.90, conf + 0.12)
    if MARKETING.search(raw_text) or MARKETING.search(name):
        reasons.append("包含营销表达；仅降低质量分，不据此拒绝")
        conf = max(0.4, conf - 0.08)
    return "POI", conf, reasons


def score_dimensions(candidate: dict, match_score: float = 0.0, duplicate_probability: float = 0.0) -> dict:
    has_url = valid_xhs_url(candidate.get("source_url", ""))
    raw = candidate.get("raw_text", "")
    source_quality = 88 if has_url and candidate.get("source_note_id") else 55 if has_url else 25
    if not candidate.get("source_note_id"):
        source_quality -= 15
    if MARKETING.search(raw):
        source_quality -= 8
    entity = int(float(candidate.get("type_confidence", 0)) * 100)
    mapability = 90 if candidate.get("type") == "POI" and match_score >= THRESHOLDS["poi_probable"] else 65 if candidate.get("type") == "POI" and match_score >= THRESHOLDS["poi_possible"] else 35 if candidate.get("type") == "POI" else 72 if candidate.get("type") == "ROUTE" and len(candidate.get("canonical_stops", [])) >= 2 else 20
    completeness = 25 + (25 if raw else 0) + (20 if candidate.get("raw_place_names") else 0) + (20 if candidate.get("raw_route_text") else 0) + (10 if candidate.get("source_note_id") else 0)
    if candidate.get("type") == "ROUTE" and len(candidate.get("canonical_stops", [])) < 2:
        completeness = min(completeness, 48)
    overall = round(0.30 * entity + 0.25 * source_quality + 0.25 * completeness + 0.20 * mapability)
    return {"mapability_score": mapability, "entity_confidence": entity, "source_quality": max(0, source_quality), "information_completeness": min(100, completeness), "duplicate_probability": round(duplicate_probability * 100), "overall_quality": overall, "quality_score": overall}


def popularity(likes: str, saves: str, comments: str) -> int | None:
    vals = []
    for value in (likes, saves, comments):
        try:
            vals.append(max(0, int(str(value).replace(",", ""))))
        except (ValueError, TypeError):
            vals.append(0)
    total = vals[0] + vals[1] * 1.3 + vals[2] * 0.5
    return min(100, round(100 * math.log1p(total) / math.log1p(10000))) if total else 0


def empty_candidate(source: str, url: str, note_id: str, title: str, raw_text: str, raw_places: str, raw_route: str, ctype: str, confidence: float, reason: str) -> dict:
    candidate = {
        "candidate_id": stable_id(source, url, ctype, title + raw_places + raw_route), "source": source,
        "source_url": url, "source_urls": [url] if url else [], "source_note_id": note_id, "source_note_ids": [note_id] if note_id else [],
        "title": title, "raw_text": raw_text, "raw_place_names": raw_places, "raw_route_text": raw_route,
        "type": ctype, "type_confidence": round(confidence, 3), "quality_score": 0,
        "mapability_score": 0, "existing_match": {}, "suggested_action": "HUMAN_REVIEW", "reason": reason,
        "review_status": "UNDECIDED", "human_action": "UNDECIDED", "human_note": "", "reviewed_at": "", "popularity_score": 0,
        "matched_existing_id": "", "matched_existing_name": "", "match_type": "UNRESOLVED", "match_score": 0.0,
        "canonical_stops": [], "candidate_stop_names": [], "existing_stop_names": [], "unmapped_stops": [], "route_relation": "UNCERTAIN",
        "node_similarity": None, "sequence_similarity": None, "geo_similarity": None, "overall_similarity": None,
        "existing_route_id": "", "existing_route_name": "", "existing_stops": [], "candidate_stops": [],
        "added_nodes": [], "missing_nodes": [], "proposed_changes": {}, "ai_review": {"status": "not_run", "reason": "AI 审核器可插拔，本轮先运行确定性规则"},
    }
    return candidate


def classify_route_title(title: str, row: dict) -> tuple[str, bool, str]:
    text = f"{title} {row.get('kind','')}"
    if COLLECTION.search(text) or "合集待拆分" in text:
        return "COLLECTION", True, "标题或旧标记明确包含多条路线；合集不作为单条路线入库"
    return "ROUTE", False, "路线候选；须结合已映射节点与现有路线匹配"


def route_compare(canonical: list[str], routes: list[dict], route_titles: dict[str, str]) -> dict:
    if len(canonical) < 2:
        return {"route_relation": "UNCERTAIN", "node_similarity": None, "sequence_similarity": None, "geo_similarity": None, "overall_similarity": None, "existing_route_id": "", "existing_route_name": "", "existing_stops": [], "added_nodes": [], "missing_nodes": [], "duplicate_probability": 0.0}
    best = None
    cset = set(canonical)
    for route in routes:
        ex = route.get("stops", [])
        eset = set(ex)
        if len(eset) < 2:
            continue
        common = cset & eset
        node = len(common) / len(cset | eset) if cset | eset else 0.0
        forward = lcs(canonical, ex) / max(len(canonical), len(ex))
        backward = lcs(list(reversed(canonical)), ex) / max(len(canonical), len(ex))
        seq = max(forward, backward)
        # All current routes are overview_only, so geometric similarity is deliberately unavailable.
        geo = None if route.get("lineAccuracy") == "overview_only" or not route.get("path") else None
        weights = {"node": WEIGHTS["node"], "sequence": WEIGHTS["sequence"]}
        score = (node * weights["node"] + seq * weights["sequence"]) / sum(weights.values())
        if not best or score > best["overall_similarity"]:
            if common and cset == eset:
                relation = "SAME_ROUTE" if seq >= 0.80 else "VARIANT"
            elif len(cset) >= 2 and cset < eset:
                relation = "SUBSET"
            elif len(eset) >= 2 and eset < cset:
                relation = "SUPERSET"
            elif len(common) >= 2 and node >= THRESHOLDS["route_partial"]:
                relation = "PARTIAL_OVERLAP"
            elif len(common) >= 2 and score >= THRESHOLDS["route_high"]:
                relation = "VARIANT"
            elif len(common) == 1:
                relation = "UNCERTAIN"
            else:
                relation = "DIFFERENT"
            best = {"route_relation": relation, "node_similarity": round(node, 3), "sequence_similarity": round(seq, 3), "geo_similarity": geo, "overall_similarity": round(score, 3), "existing_route_id": route["id"], "existing_route_name": route["name"], "existing_stops": ex, "added_nodes": [x for x in canonical if x not in eset], "missing_nodes": [x for x in ex if x not in cset], "duplicate_probability": score}
    return best or {"route_relation": "UNCERTAIN", "node_similarity": None, "sequence_similarity": None, "geo_similarity": None, "overall_similarity": None, "existing_route_id": "", "existing_route_name": "", "existing_stops": [], "added_nodes": [], "missing_nodes": [], "duplicate_probability": 0.0}


def lcs(a: list[str], b: list[str]) -> int:
    prev = [0] * (len(b) + 1)
    for x in a:
        cur = [0]
        for j, y in enumerate(b, 1):
            cur.append(prev[j - 1] + 1 if x == y else max(prev[j], cur[-1]))
        prev = cur
    return prev[-1]


def to_flat(candidate: dict) -> dict:
    fields = ("candidate_id", "source", "source_url", "source_urls", "source_note_id", "source_note_ids", "title", "raw_text", "raw_place_names", "raw_route_text", "type", "type_confidence", "quality_score", "mapability_score", "entity_confidence", "source_quality", "information_completeness", "duplicate_probability", "popularity_score", "match_type", "matched_existing_id", "matched_existing_name", "match_score", "route_relation", "node_similarity", "sequence_similarity", "geo_similarity", "overall_similarity", "existing_route_id", "existing_route_name", "suggested_action", "reason", "review_status", "human_action", "human_note", "reviewed_at", "candidate_stops", "candidate_stop_names", "existing_stops", "existing_stop_names", "added_nodes", "missing_nodes", "proposed_changes")
    return {k: candidate.get(k, "") for k in fields}


def generate_review_html(candidates: list[dict], summary: dict, output: Path) -> None:
    payload = json.dumps({"candidates": candidates, "summary": summary}, ensure_ascii=False).replace("</", "<\\/")
    document = r'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小红书候选审核</title>
<style>*{box-sizing:border-box}body{margin:0;font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:#27362d;background:#f4f5f0}header{position:sticky;top:0;z-index:3;background:#f4f5f0ee;backdrop-filter:blur(12px);padding:16px max(18px,calc((100vw - 1160px)/2));border-bottom:1px solid #dce2d7}h1{font-size:22px;margin:0 0 8px}.tools{display:flex;gap:8px;flex-wrap:wrap}.tools input,.tools select,button{font:inherit;border:1px solid #d4ddd3;border-radius:8px;background:#fff;padding:8px 10px;color:inherit}.tools input{flex:1;min-width:220px}.tools button,.action{cursor:pointer}.stats{font-size:13px;color:#657666;margin:8px 0}.wrap{max-width:1160px;margin:18px auto;padding:0 14px}.card{background:white;border:1px solid #dfe5dc;border-radius:14px;padding:16px;margin:12px 0;box-shadow:0 3px 12px #233b2208}.title{font-size:18px;font-weight:700}.meta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.pill{font-size:12px;padding:2px 8px;border-radius:99px;background:#edf2ea}.pill.warn{background:#fff2df;color:#8b602c}details{margin:9px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f8f4;padding:10px;border-radius:8px;font:13px/1.6 inherit}.reason{color:#8a5b2e}.actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.actions button{font-size:13px}.actions button:hover{background:#e9f1e8}.actions button.active{background:#426b4b;color:white}.small{font-size:12px;color:#7c897c}.diff .add{color:#197342;font-weight:700}.diff .miss{color:#a44e3e}.empty{padding:30px;color:#78867a;text-align:center}a{color:#356b85}@media(max-width:700px){header{padding:12px}.wrap{margin:10px auto}.card{padding:13px}}</style>
<header><h1>小红书候选审核 · 仅本地</h1><div class="stats" id="stats"></div><div class="tools"><input id="q" placeholder="搜索名称、路线节点、原始文本"><select id="type"><option value="">全部类型</option><option>POI</option><option>ROUTE</option><option>COLLECTION</option><option>INVALID</option><option>UNKNOWN</option></select><select id="action"><option value="">全部建议</option><option>HUMAN_REVIEW</option><option>MERGE</option><option>UPDATE_EXISTING</option><option>ADD</option><option>REJECT</option></select><button id="export">导出人工决定 JSON</button><button id="reset">清除本机决定</button></div><div class="small">决定保存在此浏览器 localStorage。导出后再交给 apply-review 显式应用；本页不会改正式数据。</div></header><main class="wrap" id="list"></main>
<script>const DATA=__DATA__;const KEY='hangzhou-atlas-xhs-review-v1';let decisions={};try{decisions=JSON.parse(localStorage.getItem(KEY)||'{}')}catch{};const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const $=s=>document.querySelector(s);const textStops=x=>(x||[]).map(esc).join(' → ')||'（尚未可靠识别）';function save(){localStorage.setItem(KEY,JSON.stringify(decisions))}function card(c){let d=decisions[c.candidate_id]||{};let act=d.human_action||'UNDECIDED';let url=c.source_url?`<a target="_blank" rel="noopener" href="${esc(c.source_url)}">打开原笔记</a>`:'来源链接缺失';let route=c.type==='ROUTE'||c.type==='COLLECTION';return `<article class="card"><div class="title">${esc(c.title||c.raw_place_names||'（无标题）')}</div><div class="meta"><span class="pill">${esc(c.type)}</span><span class="pill">建议 ${esc(c.suggested_action)}</span><span class="pill">质量 ${c.quality_score??0}</span><span class="pill">可地图化 ${c.mapability_score??0}</span><span class="pill">匹配 ${esc(c.match_type||c.route_relation||'')}</span><span class="pill">人工 ${esc(act)}</span></div><div>${url} · ${esc(c.source_note_id||'无 note_id')} · ${(c.source_note_ids||[]).length} 个关联笔记</div><p class="reason">${esc(c.reason||'')}</p>${c.matched_existing_name?`<div>匹配地点：${esc(c.matched_existing_name)} (${esc(c.matched_existing_id)}) · ${Math.round((c.match_score||0)*100)}%</div>`:''}${c.existing_route_name?`<div>最相似路线：${esc(c.existing_route_name)} (${esc(c.existing_route_id)}) · 关系 ${esc(c.route_relation)} · 节点 ${esc(c.node_similarity)} / 顺序 ${esc(c.sequence_similarity)} / 综合 ${esc(c.overall_similarity)}</div>`:''}${route?`<div class="diff"><b>候选站点：</b>${textStops(c.candidate_stops)}<br><b>已有站点：</b>${textStops(c.existing_stops)}<br><span class="add">新增：${textStops(c.added_nodes)}</span><br><span class="miss">已有路线中候选未包含：${textStops(c.missing_nodes)}</span></div>`:''}<details><summary>原始内容 / 来源 / AI状态</summary><pre>${esc(c.raw_text)}</pre><div class="small">原始地点：${esc(c.raw_place_names)}<br>原始路线：${esc(c.raw_route_text)}<br>来源备注：${esc(c.source_note||'')}<br>关联来源：${esc((c.source_urls||[]).join(' | '))}<br>AI：${esc(c.ai_review?.status)} — ${esc(c.ai_review?.reason)}</div></details><label class="small">审核备注 <input data-note="${esc(c.candidate_id)}" value="${esc(d.human_note||'')}" placeholder="补充核实理由 / 修改目标" style="width:min(100%,600px)"></label><div class="actions">${['ACCEPT_ADD','ACCEPT_MERGE','ACCEPT_UPDATE','REJECT','EDIT','UNDECIDED'].map(a=>`<button class="${act===a?'active':''}" data-action="${a}" data-id="${esc(c.candidate_id)}">${a==='UNDECIDED'?'跳过':a==='EDIT'?'编辑候选':a}</button>`).join('')}</div></article>`}function render(){let q=$('#q').value.trim().toLowerCase(),t=$('#type').value,a=$('#action').value;let rows=DATA.candidates.filter(c=>(!t||c.type===t)&&(!a||c.suggested_action===a)&&(!q||[c.title,c.raw_text,c.raw_place_names,c.raw_route_text,c.matched_existing_name,c.existing_route_name].join(' ').toLowerCase().includes(q)));$('#stats').textContent=`${DATA.summary.raw_note_count} 篇来源笔记 · ${DATA.candidates.length} 个候选 · 当前 ${rows.length} 个 · 已审 ${Object.values(decisions).filter(x=>x.human_action&&x.human_action!=='UNDECIDED').length}`;$('#list').innerHTML=rows.map(card).join('')||'<div class="empty">没有匹配候选</div>'}document.addEventListener('click',e=>{let b=e.target.closest('[data-action]');if(!b)return;let id=b.dataset.id,a=b.dataset.action;if(a==='EDIT'){let d=decisions[id]||{};d.edited_title=prompt('修改候选名称（只进入审核决定，不改正式数据）',d.edited_title||DATA.candidates.find(c=>c.candidate_id===id)?.title||'');if(d.edited_title===null)return;d.human_action='EDIT';decisions[id]=d}else{decisions[id]={...(decisions[id]||{}),human_action:a,reviewed_at:new Date().toISOString()}}save();render()});document.addEventListener('input',e=>{if(!e.target.matches('[data-note]'))return;let d=decisions[e.target.dataset.note]||{};d.human_note=e.target.value;decisions[e.target.dataset.note]=d;save()});$('#q').oninput=render;$('#type').onchange=render;$('#action').onchange=render;$('#reset').onclick=()=>{if(confirm('清空此浏览器保存的所有审核决定？')){decisions={};save();render()}};$('#export').onclick=()=>{let out={schema_version:1,created_at:new Date().toISOString(),decisions:Object.entries(decisions).map(([candidate_id,v])=>{const c=DATA.candidates.find(x=>x.candidate_id===candidate_id)||{};return {candidate_id,...v,source_url:c.source_url||'',source_urls:c.source_urls||[],source_note_id:c.source_note_id||''}})};let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}));a.download='xhs-human-decisions.json';a.click();URL.revokeObjectURL(a.href)};render();</script></html>'''
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(document.replace("__DATA__", payload), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path, default=DEFAULT_BATCH)
    parser.add_argument("--places-review", type=Path, default=DEFAULT_PLACES_REVIEW)
    parser.add_argument("--routes-review", type=Path, default=DEFAULT_ROUTES_REVIEW)
    parser.add_argument("--places", type=Path, default=ROOT / "data/places.json")
    parser.add_argument("--routes", type=Path, default=ROOT / "data/routes.json")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT / date.today().isoformat())
    parser.add_argument("--ai-review", choices=("none", "llm"), default="none", help="llm 为显式联网选项，会把候选原文发送到配置的外部兼容接口")
    args = parser.parse_args()

    notes = read_csv(args.input)
    place_rows = read_csv(args.places_review)
    route_rows = read_csv(args.routes_review)
    places = read_json(args.places)
    routes = read_json(args.routes)
    note_by_id = {n.get("note_id", ""): n for n in notes if n.get("note_id")}
    candidates: list[dict] = []
    rejected: list[dict] = []
    poi_report: list[dict] = []
    route_report: list[dict] = []
    seen = set()
    covered_note_ids = {r.get("note_id", "") for r in route_rows if r.get("note_id")}

    def add_candidate(c: dict) -> None:
        if c["candidate_id"] in seen:
            c["suggested_action"] = "REJECT"
            c["reason"] = (c.get("reason", "") + "；确定性重复候选，保留首条并记录重复来源").strip("；")
            rejected.append(to_flat(c))
            return
        seen.add(c["candidate_id"])
        candidates.append(c)
        if c["suggested_action"] == "REJECT":
            rejected.append(to_flat(c))

    # POI candidates are taken from the prior aggregation but reclassified from source evidence.
    for row in place_rows:
        name = clean_name(row.get("place_name", ""))
        urls = split_urls(row.get("source_note_urls", ""))
        source_ids = list(dict.fromkeys([note_id_from_url(u) for u in urls if note_id_from_url(u)]))
        evidence_notes = [note_by_id[i] for i in source_ids if i in note_by_id]
        matching_notes = []
        for n in notes:
            tokens = [clean_name(t) for t in (n.get("place_candidates", "") or "").split("|")]
            route_tokens = extract_nodes(n.get("route_excerpt", ""))
            if name and (normalize(name) in {normalize(t) for t in tokens if t} or normalize(name) in {normalize(t) for t in route_tokens if t}):
                matching_notes.append(n)
        source_ids = list(dict.fromkeys(source_ids + [n.get("note_id", "") for n in matching_notes if n.get("note_id")]))
        for n in matching_notes:
            if n not in evidence_notes:
                evidence_notes.append(n)
        covered_note_ids.update(source_ids)
        raw = "\n\n".join(note_raw(n) for n in evidence_notes[:5]) or f"CSV 提取名称：{row.get('place_name','')}；支持笔记数：{row.get('supporting_notes','')}"
        primary = evidence_notes[0] if evidence_notes else {}
        source_url = urls[0] if urls else (primary.get("note_url", ""))
        ctype, conf, reasons = classify_poi(name, raw)
        c = empty_candidate("xiaohongshu", source_url, source_ids[0] if source_ids else "", name or row.get("place_name", ""), raw, row.get("place_name", ""), "", ctype, conf, "；".join(reasons) or "从地点提取表重新分类")
        c["source_note_ids"] = source_ids
        c["source_note_url_count"] = len(urls)
        c["source_urls"] = list(dict.fromkeys(urls + [n.get("note_url", "") for n in evidence_notes if n.get("note_url")]))
        c["supporting_notes"] = int(row.get("supporting_notes") or 0)
        c["popularity_score"] = popularity(row.get("max_note_likes", ""), row.get("max_note_saves", ""), "")
        match = match_poi(name, places, raw)
        c.update(match)
        c["existing_match"] = match
        c["matched_existing_id"] = match["matched_existing_id"]
        c["matched_existing_name"] = match["matched_existing_name"]
        if ctype in {"INVALID"}:
            c["suggested_action"] = "REJECT"
            c["reason"] = "明显不是稳定地点实体；" + c["reason"]
        elif match["match_type"] in {"EXACT_MATCH", "PROBABLE_MATCH"}:
            c["suggested_action"] = "UPDATE_EXISTING" if len(raw) > 80 and re.search(r"(?:季节|开放|门票|小时|公里|入口|注意|建议|适合|沿途|路线)", raw) else "MERGE"
            c["reason"] = f"匹配主库地点 {match['matched_existing_name']} ({match['matched_existing_id']})；优先补来源/信息，不创建同名 POI。"
        elif match["match_type"] == "POSSIBLE_MATCH":
            c["suggested_action"] = "HUMAN_REVIEW"
            c["reason"] = f"可能对应主库 {match['matched_existing_name']}，但名称/语义不足以自动合并；需人工核实，禁止猜坐标。"
        elif ctype == "UNKNOWN":
            c["suggested_action"] = "HUMAN_REVIEW"
            c["reason"] = "名称泛化或实体边界不清，需核验原文和具体 POI；不自动定位。"
        else:
            c["suggested_action"] = "HUMAN_REVIEW"
            c["reason"] = "主库无可靠匹配；候选无可验证坐标，先人工核实实体与位置，不自动 ADD。"
        c.update(score_dimensions(c, match["match_score"], match["match_score"]))
        add_candidate(c)
        poi_report.append({**to_flat(c), "exact_hint_from_old_csv": row.get("existing_place_id_exact", ""), "source_urls": urls, "source_note_ids": source_ids})

    # Route candidates; collections remain visible as parent records and only explicit chains split out.
    route_inputs = []
    for row in route_rows:
        note_id = row.get("note_id", "")
        note = note_by_id.get(note_id, {})
        title = row.get("route_title", "") or note.get("title", "")
        route_sources = list(dict.fromkeys(x.strip() for x in (row.get("route_excerpt", ""), note.get("route_excerpt", "")) if x and x.strip()))
        raw_route = "\n[other extraction]\n".join(route_sources)
        parse_route = max(route_sources, key=len) if route_sources else ""
        collection_type, is_collection, collection_reason = classify_route_title(title, row)
        parent_url = row.get("note_url", "") or note.get("note_url", "")
        parent_raw = note_raw(note) if note else raw_route
        chunks = [x.strip() for x in re.split(r"\s*[|\n;；]\s*", parse_route) if x.strip()]
        explicit_chains = []
        chain_keys = set()
        for chunk in chunks:
            nodes = extract_nodes(chunk)
            key = tuple(normalize(x) for x in nodes)
            if nodes and key not in chain_keys:
                explicit_chains.append((chunk, nodes))
                chain_keys.add(key)
        if is_collection:
            parent = empty_candidate("xiaohongshu", parent_url, note_id, title, parent_raw, row.get("place_names", ""), raw_route, "COLLECTION", 0.97, collection_reason)
            parent["source_note_ids"] = [note_id] if note_id else []
            parent["suggested_action"] = "HUMAN_REVIEW" if explicit_chains else "HUMAN_REVIEW"
            parent["reason"] += f"；原笔记声称多条路线，已提取 {len(explicit_chains)} 条显式节点链；摘要可能不完整，不将标题当路线。"
            parent.update(score_dimensions(parent))
            add_candidate(parent)
            if explicit_chains:
                for idx, (chain_text, nodes) in enumerate(explicit_chains, 1):
                    route_inputs.append((row, note, f"{title} · 可见路线 {idx}", chain_text, " | ".join(nodes), nodes, idx, "集合拆分子路线，来源摘要不保证完整"))
            continue

        raw_names = row.get("place_names", "")
        nodes = extract_nodes(parse_route) or split_stop_field(raw_names)
        # Multiple explicit route chains under a non-collection title indicate a flattened collection.
        if len(explicit_chains) > 1:
            parent = empty_candidate("xiaohongshu", parent_url, note_id, title, parent_raw, raw_names, raw_route, "COLLECTION", 0.92, "原抽取误标单路线：原文包含多段独立节点链，重分类为合集")
            parent["suggested_action"] = "HUMAN_REVIEW"
            parent.update(score_dimensions(parent))
            add_candidate(parent)
            for idx, (chain_text, chain_nodes) in enumerate(explicit_chains, 1):
                route_inputs.append((row, note, f"{title} · 可见路线 {idx}", chain_text, " | ".join(chain_nodes), chain_nodes, idx, "多段路线需拆分和逐条核验"))
        else:
            route_inputs.append((row, note, title, raw_route, raw_names, nodes, 0, ""))

    # Notes not covered by either old extraction CSV stay in the queue as UNKNOWN/INVALID source candidates.
    covered = covered_note_ids | {note_id_from_url(u) for r in place_rows for u in split_urls(r.get("source_note_urls", ""))}
    for note in notes:
        if note.get("note_id", "") in covered:
            continue
        raw = note_raw(note)
        title = note.get("title", "")
        has_content = bool((note.get("description_excerpt") or "").strip() or (note.get("route_excerpt") or "").strip() or (note.get("place_candidates") or "").strip())
        ctype = "COLLECTION" if COLLECTION.search(title + raw) else "ROUTE" if len(extract_nodes(note.get("route_excerpt", ""))) >= 2 else "UNKNOWN" if has_content else "INVALID"
        reason = "來源筆記未被舊 POI/Route 拆分表覆蓋；保留原文待判断" if has_content else "原始笔记核心字段为空"
        c = empty_candidate("xiaohongshu", note.get("note_url", ""), note.get("note_id", ""), title, raw, note.get("place_candidates", ""), note.get("route_excerpt", ""), ctype, 0.55 if has_content else 0.05, reason)
        c["popularity_score"] = popularity(note.get("likes", ""), note.get("saves", ""), note.get("comments", ""))
        c["suggested_action"] = "REJECT" if ctype == "INVALID" else "HUMAN_REVIEW"
        c.update(score_dimensions(c))
        add_candidate(c)

    for row, note, title, raw_route, raw_names, raw_nodes, child_index, split_note in route_inputs:
        note_id = row.get("note_id", "")
        url = row.get("note_url", "") or note.get("note_url", "")
        raw = note_raw(note) if note else raw_route
        nodes = raw_nodes or extract_nodes(raw_route) or split_stop_field(raw_names)
        c = empty_candidate("xiaohongshu", url, note_id, title, raw, raw_names, raw_route, "ROUTE", 0.78 if len(nodes) >= 2 else 0.48, split_note or ("识别到显式节点顺序" if len(nodes) >= 2 else "未识别到可靠的两个以上有序节点"))
        c["source_note_ids"] = [note_id] if note_id else []
        c["candidate_stops"] = nodes
        c["candidate_stop_names"] = nodes
        c["popularity_score"] = popularity(row.get("likes", ""), row.get("saves", ""), note.get("comments", "") if note else "")
        mapped, unmapped = [], []
        for name in nodes:
            m = match_poi(name, places, raw)
            if m["match_type"] in {"EXACT_MATCH", "PROBABLE_MATCH"}:
                mapped.append(m["matched_existing_id"])
            else:
                unmapped.append({"name": name, **m})
        # Repair fused stop labels only when they contain multiple exact canonical
        # names from the Ground Truth catalog; never infer a new name or coordinate.
        expanded = []
        for name in nodes:
            fused_stop = re.match(r"^(.*?)公交车站(.+)$", name)
            if fused_stop:
                suffix_match = match_poi(fused_stop.group(2), places, raw)
                if suffix_match["match_type"] in {"EXACT_MATCH", "PROBABLE_MATCH"}:
                    expanded.extend([fused_stop.group(1) + "公交车站", suffix_match["matched_existing_name"]])
                    continue
            contained = [p for p in places if normalize(p.get("name", "")) and normalize(p["name"]) in normalize(name)]
            if len(contained) >= 2:
                contained.sort(key=lambda p: normalize(name).find(normalize(p["name"])))
                expanded.extend(p["name"] for p in contained)
            else:
                expanded.append(name)
        nodes = list(dict.fromkeys(expanded))
        c["candidate_stops"] = nodes
        c["candidate_stop_names"] = nodes
        mapped, unmapped = [], []
        for name in nodes:
            m = match_poi(name, places, raw)
            if m["match_type"] in {"EXACT_MATCH", "PROBABLE_MATCH"}:
                mapped.append(m["matched_existing_id"])
            else:
                unmapped.append({"name": name, **m})
        c["canonical_stops"] = list(dict.fromkeys(mapped))
        existing_route = next((r for r in routes if r["id"] == c.get("existing_route_id")), None)
        place_names = {p["id"]: p["name"] for p in places}
        c["unmapped_stops"] = unmapped
        comparison = route_compare(c["canonical_stops"], routes, {r["id"]: r["name"] for r in routes})
        c.update(comparison)
        c["existing_route_id_list"] = list(c.get("existing_stops", []))
        c["existing_stop_ids"] = list(c.get("existing_stops", []))
        c["existing_stop_names"] = [place_names.get(i, i) for i in c.get("existing_stops", [])]
        c["existing_stops"] = c["existing_stop_names"]
        c["added_nodes"] = [place_names.get(i, i) for i in c.get("added_nodes", [])]
        c["missing_nodes"] = [place_names.get(i, i) for i in c.get("missing_nodes", [])]
        if len(c["canonical_stops"]) < 2:
            c["suggested_action"] = "HUMAN_REVIEW"
            c["reason"] = "候选站点不足两个可靠映射；" + c["reason"] + f"。原始节点 {len(nodes)}，可靠映射 {len(c['canonical_stops'])}，未映射 {len(unmapped)}；不得猜坐标或路线。"
        elif c["route_relation"] in {"SAME_ROUTE", "SUBSET", "SUPERSET", "VARIANT", "PARTIAL_OVERLAP"}:
            c["suggested_action"] = "UPDATE_EXISTING" if c["added_nodes"] or c["route_relation"] in {"SUPERSET", "PARTIAL_OVERLAP", "VARIANT"} else "MERGE"
            c["reason"] = f"与主库路线 {c['existing_route_name']} ({c['existing_route_id']}) 为 {c['route_relation']}；节点重合 {c['node_similarity']}、顺序相似 {c['sequence_similarity']}、综合 {c['overall_similarity']}。优先增补现有路线。"
        else:
            c["suggested_action"] = "HUMAN_REVIEW"
            c["reason"] = f"最高节点对照为 {c['existing_route_name']}，关系 {c['route_relation']}，综合 {c['overall_similarity']}；仍需人工确认是否是真正新路线。"
        if c.get("existing_route_id"):
            c["existing_match"] = {"id": c["existing_route_id"], "name": c["existing_route_name"], "relation": c["route_relation"], "node_similarity": c["node_similarity"], "sequence_similarity": c["sequence_similarity"], "geo_similarity": None, "overall_similarity": c["overall_similarity"]}
            c["proposed_changes"] = {"source_urls_to_review": c.get("source_urls", []), "candidate_nodes_to_verify": nodes, "added_nodes_to_verify": c.get("added_nodes", []), "raw_route_text": raw_route, "human_verification_required": True}
        c["geo_similarity"] = None
        c.update(score_dimensions(c, 0.0, float(c.get("duplicate_probability") or 0)))
        # Scores for route comparison are distinct from POI name match fields.
        c["quality_score"] = c["overall_quality"]
        add_candidate(c)
        route_report.append(to_flat(c))

    # Every candidate receives a transparent deterministic pass. Optional LLM
    # review is a separate, explicit, networked opt-in and cannot write data.
    if args.ai_review == "llm":
        from xhs_pipeline.reviewers.llm_reviewer import review as review_llm
    else:
        review_llm = None
    place_by_id = {p["id"]: p for p in places}
    route_by_id = {r["id"]: r for r in routes}
    for c in candidates:
        c["rule_review"] = review_rules(c)
        if review_llm:
            context = {}
            if c.get("matched_existing_id") in place_by_id:
                context["matched_place"] = place_by_id[c["matched_existing_id"]]
            if c.get("existing_route_id") in route_by_id:
                context["matched_route"] = route_by_id[c["existing_route_id"]]
            ai = review_llm(c, context)
            c["ai_review"] = ai
            if ai.get("status") == "completed":
                confidence = float(ai.get("type_confidence", 0))
                if confidence < 0.8 or ai.get("suggested_action") != c.get("suggested_action"):
                    c["suggested_action"] = "HUMAN_REVIEW"
                    c["reason"] += "；AI 与规则低置信或结论不一致，转人工审核"
    # Refresh tabular reports after the optional review overlay.
    poi_extras = {r.get("candidate_id"): {k: r.get(k) for k in ("exact_hint_from_old_csv", "source_urls", "source_note_ids")} for r in poi_report}
    poi_report = [to_flat(c) | poi_extras.get(c["candidate_id"], {}) for c in candidates if c["candidate_id"] in poi_extras]
    route_report = [to_flat(c) for c in candidates if c.get("type") == "ROUTE"]

    type_counts = Counter(c["type"] for c in candidates)
    actions = Counter(c["suggested_action"] for c in candidates)
    poi_exact = sum(c.get("type") == "POI" and c.get("match_type") == "EXACT_MATCH" for c in candidates)
    poi_probable = sum(c.get("type") == "POI" and c.get("match_type") == "PROBABLE_MATCH" for c in candidates)
    poi_possible = sum(c.get("type") == "POI" and c.get("match_type") == "POSSIBLE_MATCH" for c in candidates)
    poi_new = sum(c.get("type") == "POI" and c.get("match_type") == "UNRESOLVED" for c in candidates)
    route_rels = Counter(c.get("route_relation") for c in candidates if c.get("type") == "ROUTE")
    summary = {
        "run_date": date.today().isoformat(), "raw_note_count": len(notes), "place_rows_in_legacy_review": len(place_rows),
        "route_rows_in_legacy_review": len(route_rows), "candidate_count": len(candidates), "type_counts": dict(type_counts),
        "action_counts": dict(actions), "poi_exact_match_count": poi_exact, "poi_probable_match_count": poi_probable, "poi_possible_match_count": poi_possible,
        "poi_new_candidate_count": poi_new, "poi_unresolved_count": sum(c.get("type") == "POI" and c.get("match_type") == "UNRESOLVED" for c in candidates),
        "route_relation_counts": dict(route_rels), "rejected_count": len(rejected), "weights": WEIGHTS,
        "route_add_candidate_count": sum(c.get("type") == "ROUTE" and c.get("route_relation") == "DIFFERENT" and len(c.get("canonical_stops", [])) >= 2 for c in candidates),
        "route_unresolved_count": sum(c.get("type") == "ROUTE" and c.get("route_relation") == "UNCERTAIN" for c in candidates),
        "all_existing_route_geometries_overview_only": all(r.get("lineAccuracy") == "overview_only" for r in routes),
        "ai_review_mode": args.ai_review,
        "human_confirmation_required": True,
    }
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    (out / "xhs-candidates-review.json").write_text(json.dumps({"schema_version": 1, "summary": summary, "candidates": candidates}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    candidate_fields = list(to_flat(candidates[0]).keys()) if candidates else []
    write_csv(out / "xhs-candidates-review.csv", candidate_fields, [to_flat(c) for c in candidates])
    write_csv(out / "poi-match-report.csv", list(poi_report[0].keys()) if poi_report else candidate_fields, poi_report)
    write_csv(out / "route-match-report.csv", list(route_report[0].keys()) if route_report else candidate_fields, route_report)
    write_csv(out / "rejected-candidates.csv", list(rejected[0].keys()) if rejected else candidate_fields, rejected)
    generate_review_html(candidates, summary, out / "review.html")
    (out / "xhs-audit-summary.md").write_text(make_summary(summary, notes, place_rows, route_rows, candidates, poi_report, route_report), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\n审核文件：{out}")


def make_summary(summary: dict, notes: list[dict], place_rows: list[dict], route_rows: list[dict], candidates: list[dict], poi_report: list[dict], route_report: list[dict]) -> str:
    types, actions, rels = summary["type_counts"], summary["action_counts"], summary["route_relation_counts"]
    missing = {field: sum(not (n.get(field) or "").strip() for n in notes) for field in ("title", "description_excerpt", "route_excerpt", "place_candidates")}
    note_ids = [n.get("note_id", "") for n in notes if n.get("note_id")]
    note_urls = [n.get("note_url", "") for n in notes if n.get("note_url")]
    duplicate_note_ids = len(note_ids) - len(set(note_ids))
    duplicate_note_urls = len(note_urls) - len(set(note_urls))
    route_high = [x for x in route_report if x.get("route_relation") in {"SAME_ROUTE", "SUBSET", "SUPERSET", "VARIANT", "PARTIAL_OVERLAP"}]
    poi_invalid = [x.get("raw_place_names", "") for x in poi_report if x.get("type") == "INVALID"][:12]
    collections = [x.get("title", "") for x in candidates if x.get("type") == "COLLECTION"][:12]
    lines = [
        "# 小红书候选审核摘要", "", f"运行日期：{summary['run_date']}。本报告仅用于审核，正式 places/routes 未修改。", "",
        "## 数据规模", "", f"- 原始笔记：{len(notes)}", f"- 旧地点提取行：{len(place_rows)}", f"- 旧路线提取行：{len(route_rows)}", f"- 统一候选：{summary['candidate_count']}",
        f"- POI / ROUTE / COLLECTION / INVALID / UNKNOWN：{types.get('POI',0)} / {types.get('ROUTE',0)} / {types.get('COLLECTION',0)} / {types.get('INVALID',0)} / {types.get('UNKNOWN',0)}", "",
        "## 建议处置", "", *(f"- {k}: {actions.get(k,0)}" for k in ("REJECT", "MERGE", "UPDATE_EXISTING", "ADD", "HUMAN_REVIEW")), "",
        "## 主库匹配", "", f"- POI EXACT_MATCH：{summary['poi_exact_match_count']}", f"- POI PROBABLE_MATCH：{summary['poi_probable_match_count']}", f"- POI POSSIBLE_MATCH：{summary.get('poi_possible_match_count',0)}", f"- 新候选/未匹配 POI（不等于可新增）：{summary['poi_new_candidate_count']}", f"- 无可靠匹配：{summary['poi_unresolved_count']}",
        f"- 路线关系：" + ", ".join(f"{k}={v}" for k,v in sorted(rels.items())), f"- 有至少两个可靠映射节点且与主库不同的路线候选：{summary.get('route_add_candidate_count',0)}；节点不足或对照不确定：{summary.get('route_unresolved_count',0)}。路线 geometry 分数全部为 N/A，因为正式路线均标记 overview_only。", "",
        "## 旧 CSV 质量判断", "", f"1. 笔记级 CSV 共 {len(notes)} 条，note_id/URL 在本批无重复；{sum(not (n.get('title') or '').strip() and not (n.get('description_excerpt') or '').strip() and not (n.get('route_excerpt') or '').strip() and not (n.get('place_candidates') or '').strip() for n in notes)} 条字段全空。",
        f"   字段缺失：title {missing['title']}，description_excerpt {missing['description_excerpt']}，route_excerpt {missing['route_excerpt']}，place_candidates {missing['place_candidates']}；重复 note_id {duplicate_note_ids}，重复 URL {duplicate_note_urls}。",
        f"2. 地点提取表 {len(place_rows)} 行、旧脚本仅 {sum(bool(r.get('existing_place_id_exact')) for r in place_rows)} 行 exact 命中；混有行动/感受句，示例：" + ("、".join(poi_invalid[:6]) or "待人工核验的泛化名称") + "。营销词不作为硬拒绝条件。",
        f"3. 路线提取表 {len(route_rows)} 行，其中旧分类标记的合集有 {sum('合集待拆分' in (r.get('kind') or '') for r in route_rows)} 行；标题如：" + ("、".join(collections[:6]) or "无") + "。合集父项不会直接作为 Route。",
        f"4. 与正式路线的节点关系检测找到 {len(route_high)} 个至少有可比节点的相似/包含候选。优先逐项检查 `route-match-report.csv`，其中 `SAME_ROUTE/SUBSET/SUPERSET/PARTIAL_OVERLAP/VARIANT` 会给出站点差异。",
        "5. 同名/别名 POI 与成熟路线证据建议 MERGE / UPDATE_EXISTING；不新增重复的九溪、龙井、十里琅珰等主库实体。候选没有可靠坐标，不能自动 ADD。",
        "6. 需要优先人工判断：小哀牢山/小九寨等营销别名是否能落到确定实体；只出现一两个节点的路线；合集摘要是否遗漏路线；九溪公交站、亭/观景点的实体边界。", "",
        "## 缺失数据与算法限制", "", "- 原始批次没有可靠 GPS/GPX 路线轨迹、准确起终点坐标、路线方向/闭环标记、每个节点的精确 note_id 引用，以及图片 OCR/截图轨迹。互动值只代表热度。",
        "- 旧地点 review 表把多条来源聚合为 supporting_notes、最多三个 URL 和互动最大值，丢失逐笔记出处对应关系；统一候选尽量从原始批次按 note_id 回连，未回连到的来源明示为空。",
        "- 旧路线 review 的 `place_names` 有时把提示、形容词当成节点；本流程优先显式箭头链，旧节点列表只作为回退证据并单独保留原文。",
        "- 41 条正式路线全部为 `overview_only`，语义是人工绘制浏览线而非导航轨迹。因此 `geo_similarity` 一律 N/A，不伪造 Hausdorff/缓冲区交并比。综合路线分数只对已映射节点和顺序重新归一化：" + json.dumps(WEIGHTS, ensure_ascii=False),
        "- 当前 AI reviewer 是可插拔但本次未调用；所有 AI 状态为 `not_run`。低置信候选继续 HUMAN_REVIEW。", "",
        "## 安全与使用", "", "- 数据、审核页与导出位于 private/local-only；不要推送原始笔记。", "- Pipeline 只读正式 places/routes。审核页面决定先保存在浏览器 localStorage，导出的 JSON 仍不改正式数据。", "- 正式写入必须另行运行 `apply_xhs_review.py --apply`，只接受人工 ACCEPT 项；写前备份、校验失败回滚。本轮未执行 apply。", "- 打开同目录 `review.html` 开始审核；用 `xhs-human-decisions.json` 作为 apply 的输入。", ""
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
