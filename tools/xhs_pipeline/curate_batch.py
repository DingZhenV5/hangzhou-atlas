#!/usr/bin/env python3
"""Conservative second-pass triage for a generated XHS candidate audit.

This creates decisions and a short uncertainty queue. It does not write the
formal places/routes database; accepted source-only merges are exported for the
separate explicit apply_xhs_review.py command.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DEFAULT = ROOT / "private/local-only/research/xhs-audit/2026-10-01"
OUT_SCOPE = ("START星美术馆", "station1907", "油罐艺术中心", "徐汇滨江绿地", "西岸美术馆", "西岸艺术中心", "龙美术馆", "麦当劳中国汉堡大学", "电影字幕框", "台州·水桶岙", "台州水桶岙", "宁波·", "嘉兴南北湖", "温州雁荡山", "诸暨·", "绍兴·", "徽杭古道", "绩溪")
NON_ENTITY = re.compile(r"(?:仪式感|拉满|多样的自然景观|历史文化的熏陶|宝石般的水库风光|山里绿植多|巨多蚊子|路况对娃|有吃有玩|定位$|最后一段|时间不够|精简版|桥数不胜数|湘湖总面积大|步道包含部分|全程无小卖部|山林蚊虫|停车场$|古道石阶$|山脊漫步$|小瑞士$|整条山路|观景亭$|观景台$|景观亭$|石栈道$|茶园段$|竹林小径$|山顶行走|入口和出口|返回大洋坞水库$|返回横渡村$|俯瞰湘湖$|越王路$|直达$)")
ROUTE_AS_POI = re.compile(r"(?:→|➡|➜|->|环线$|路线$|线路$|city\s*walk|citywalk|小猪线$|小猫线$|小松鼠线$|爱心线$|标毅线$|Q马线$)", re.I)
PLACE_SUFFIX = re.compile(r"(?:村|寺|山|湖|塔|桥|馆|公园|古道|水库|景区|街|巷|亭|岩|遗址|湿地|瀑布|书院|古镇|古村|河|岛|峰|岭|道院|广场|步道|洞|湾|潭|井|阁|台|祠|庙|路|站|渡|窑|廊|坞|关|坡|庐|殿|堤|田|泉|溪|坝|栈道|牌坊|尖|池|村落)$")
SAFE_ALIASES = {
    "城山广场": ("yuewang-hill", "place"),
    "径山寺(余杭区)": ("jingshan-temple", "place"),
    "杭州西湖风景名胜区-理安寺": ("lian-temple", "place"),
    "杨梅岭|茶山小村落": ("yangmeiling", "place"),
}
UNCERTAIN_NAMES = {
    "汤屋", "竹坞探幽", "午潮山小金刚", "天池", "真迹院",
    "石门村·猷溪谷(进阶溯溪",
}
REJECT_UNRESOLVED_LABELS = {
    "九溪", "临安·大树王国", "临安）\u200b", "临安)\u200b", "圣寿无疆",
    "一览亭先照寺牌坊", "湖心云影(湖中央水鸟+云影)", "湖桥拾梦(各式古桥)",
    "湘堤卧波(湘湖长堤六桥)", "越堤夕照(越堤落日)", "杭州小哀牢山徒步攻略来了！！",
}
ROUTE_MERGE_MIN_NODE = 0.50
ROUTE_MERGE_MIN_SEQUENCE = 0.60
MAP_NAME_OVERRIDES = {
    "上满觉陇", "下满觉陇", "九溪公交车站", "九溪公交站", "九溪(公交站)", "九溪(公交站)", "上天竺公交车站",
    "四眼井公交站", "郭庄公交车站", "地铁 3 号线黄龙洞站 B 口", "三分叉", "凤凰山", "宝石山",
    "满觉陇", "大垟坞水库(杭州小九寨)", "临安·太子尖", "白蛇飞渡木栈道", "飞凤岩观景台",
    "东坡洗砚池", "点将台", "三台山路", "石屋洞", "石梯古村落", "石梯峡谷", "石梯弄口",
    "翠竹千竿", "越王祠", "茅家坞", "荷花庄", "里黄弹", "野猫路古道", "钟塔岭古道", "钟塔村",
    "黛色参天亭", "白鹤峰秋千|山顶荡个秋千", "白鹤峰", "龙上村·龙鳞坝(亲子首选", "临安·太子尖", "东坡洗砚池",
}


def has_body_evidence(candidate: dict) -> bool:
    """Require an extracted name to occur outside title/legacy place-list fields."""
    name = re.sub(r"\([^)]*区\)$", "", str(candidate.get("title", "")))
    eligible = [line for line in str(candidate.get("raw_text", "")).splitlines() if not line.startswith("[title]") and not line.startswith("[place_candidates]")]
    body = "".join(eligible)
    return bool(name and len(name) >= 2 and name in body)


def read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        path.write_text("\ufeff", encoding="utf-8")
        return
    fields = list(dict.fromkeys(k for row in rows for k in row))
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v for k, v in row.items()})


def decide(c: dict) -> tuple[str, str, str]:
    kind, name = c.get("type", "UNKNOWN"), str(c.get("title", ""))
    mt = c.get("match_type", "")
    if kind == "INVALID":
        return "REJECT", "地点/路线提取明显是提示语、营销句或非地图实体", "REJECT"
    if kind == "COLLECTION":
        return "COLLECTION_ARCHIVE", "合集标题不是单条路线；保留原笔记并只审核拆出的子候选", "REJECT"
    if kind == "UNKNOWN":
        if name in REJECT_UNRESOLVED_LABELS:
            return "REJECT", "合集中的营销标签、损坏文本或无法独立地图化的概念；原始笔记保留", "REJECT"
        if name in MAP_NAME_OVERRIDES:
            return "NEW_POI_MAP_PENDING", "路线起终点/地名可辨认；仍需高德核点后才能入正式库", "UNDECIDED"
        if name == "观景台" or name == "梯田观景台":
            return "REJECT", "名称过于泛化，无法稳定定位", "REJECT"
        if name == "临安)\u200b":
            return "REJECT", "截断/损坏的地点文本", "REJECT"
        if name == "杭州小哀牢山徒步攻略来了！！":
            return "UNCERTAIN", "“小哀牢山”是营销/俗称，原文没有足够路线节点确认对应实体", "UNDECIDED"
        return "UNCERTAIN", "类型或地图实体边界仍不明确", "UNDECIDED"
    if kind == "POI":
        if name in REJECT_UNRESOLVED_LABELS:
            return "REJECT", "合集中的营销标签、损坏文本或无法独立地图化的概念；原始笔记保留", "REJECT"
        if mt == "EXACT_MATCH" and name == c.get("matched_existing_name"):
            return "MERGED_POI_SOURCE", "名称与主库完全一致；只归并来源链接，不改地点事实或坐标", "ACCEPT_MERGE"
        if name in SAFE_ALIASES:
            return "MERGED_POI_SOURCE", f"名称可明确归一到主库地点 {SAFE_ALIASES[name][0]}；只归并来源链接", "ACCEPT_MERGE"
        if name in UNCERTAIN_NAMES or mt in {"POSSIBLE_MATCH", "PROBABLE_MATCH"}:
            if name in {"九溪十八涧环线", "九溪公交车站九溪烟树", "六和塔→大华山→虎跑公园", "杭州九溪十八涧环线", "水澄桥→八卦田→福星观→万松书院", "黄龙洞→翠竹千竿→宝石山→抱朴道院", "老和云起→老和山→北高峰→法华寺", "鼓楼→城隍阁→江湖汇观亭→大马弄", "六和塔-虎跑", "花港观鱼南门→太子湾→九曜阁→南山路"}:
                return "REJECT_WRONG_TYPE", "这是路线/复合节点，被旧地点表误标为 POI；路线候选另行保留", "REJECT"
            if name in MAP_NAME_OVERRIDES:
                return "NEW_POI_MAP_PENDING", "实体名称可辨认，但主库无对应点；待高德核点后再新增", "UNDECIDED"
            return "UNCERTAIN", "别名/实体边界无法仅凭当前 CSV 可靠确认", "UNDECIDED"
        if name in MAP_NAME_OVERRIDES:
            return "NEW_POI_MAP_PENDING", "明确地名/路线节点；目前未在主库中，等待高德坐标核验", "UNDECIDED"
        if any(token in name for token in OUT_SCOPE) or NON_ENTITY.search(name):
            return "REJECT", "明显不是杭州周末地图地点或为描述/营销文本", "REJECT"
        if ROUTE_AS_POI.search(name):
            return "REJECT_WRONG_TYPE", "路线名称/路线节点串被旧地点表误标为 POI", "REJECT"
        if (name in MAP_NAME_OVERRIDES or PLACE_SUFFIX.search(name)) and has_body_evidence(c):
            return "NEW_POI_MAP_PENDING", "具体地名可作为新地点候选；坐标未核实，暂不写正式库", "UNDECIDED"
        return "REJECT", "名称缺少原文正文/路线摘录证据，或无法确认是稳定地点；原始笔记仍保留在私有 CSV", "REJECT"
    if kind == "ROUTE":
        relation = c.get("route_relation")
        node_score = c.get("node_similarity")
        sequence_score = c.get("sequence_similarity")
        strong_route_match = (
            relation in {"PARTIAL_OVERLAP", "SUBSET", "SUPERSET", "SAME_ROUTE", "VARIANT"}
            and c.get("existing_route_id")
            and node_score is not None and sequence_score is not None
            and float(node_score) >= ROUTE_MERGE_MIN_NODE
            and float(sequence_score) >= ROUTE_MERGE_MIN_SEQUENCE
        )
        if strong_route_match:
            return "MERGED_ROUTE_SOURCE", f"路线节点与主库 {c.get('existing_route_name')} 重叠；只附加明确标注为参考的来源，不改 stops/path", "ACCEPT_UPDATE"
        if any(token in name for token in OUT_SCOPE):
            return "REJECT_OUT_OF_SCOPE", "路线地点不在本项目杭州及近郊范围", "REJECT"
        stops = c.get("candidate_stop_names") or []
        raw = str(c.get("raw_route_text", ""))
        if relation and c.get("existing_route_id") and len(stops) >= 2:
            return "NEW_ROUTE_MAP_PENDING", f"与主库 {c.get('existing_route_name')} 有交集但相似度不足以安全合并；先人工核节点、判断是否变体", "UNDECIDED"
        if len(stops) >= 3 and any(mark in raw for mark in ("→", "➡", "➜", "—", "-", "；")):
            return "NEW_ROUTE_MAP_PENDING", "原文含明确线路/节点；可保留为新路线候选，先匹配节点与核实轨迹", "UNDECIDED"
        if name == "杭州小哀牢山徒步攻略来了！！":
            return "UNCERTAIN", "路线俗称和实际入口均不明确，暂不地图化", "UNDECIDED"
        return "REJECT_LOW_EVIDENCE", "原文未提供可核验节点链，暂不进入地图候选；原始笔记仍保留", "REJECT"
    return "UNCERTAIN", "待人工判定", "UNDECIDED"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input-dir", type=Path, default=OUT_DEFAULT)
    ap.add_argument("--output-dir", type=Path, default=OUT_DEFAULT)
    ap.add_argument("--places", type=Path, default=ROOT / "data/places.json")
    ap.add_argument("--routes", type=Path, default=ROOT / "data/routes.json")
    args = ap.parse_args()
    audit = json.loads((args.input_dir / "xhs-candidates-review.json").read_text(encoding="utf-8"))
    places = json.loads(args.places.read_text(encoding="utf-8"))
    routes = json.loads(args.routes.read_text(encoding="utf-8"))
    place_by_id = {p["id"]: p for p in places}
    route_by_id = {r["id"]: r for r in routes}
    rows, pending_place_rows, pending_route_rows, uncertain = [], [], [], []
    merge_decisions, source_seen = [], set()
    for original in audit["candidates"]:
        c = dict(original)
        status, reason, human_action = decide(c)
        c["triage_decision"], c["triage_reason"] = status, reason
        c["human_action"] = human_action
        c["human_note"] = reason
        c["review_status"] = "REVIEWED" if status not in {"UNCERTAIN", "NEW_POI_MAP_PENDING", "NEW_ROUTE_MAP_PENDING"} else "PENDING_MAP_DATA" if status.endswith("MAP_PENDING") else "UNDECIDED"
        rows.append(c)
        source_url = c.get("source_url", "")
        source_title = (c.get("title", "") or c.get("raw_place_names", "")).replace("（", "(").replace("）", ")")[:50]
        if status == "MERGED_POI_SOURCE":
            target_id = c.get("matched_existing_id") or (SAFE_ALIASES.get(c.get("title", "")) or ("", ""))[0]
            target = place_by_id.get(target_id)
            if target and source_url and (target_id, source_url) not in source_seen:
                source_seen.add((target_id, source_url))
                sources = list(target.get("sources", []))
                if not any(s.get("url") == source_url for s in sources):
                    new_source = {"label": f"小红书地点候选参考（名称匹配，内容待核）｜{source_title}", "url": source_url}
                    changes = {"sources": sources + [new_source]}
                    merge_decisions.append({"candidate_id": c["candidate_id"], "human_action": "ACCEPT_MERGE", "reviewed_at": datetime.now().isoformat(timespec="seconds"), "source_url": source_url, "human_note": reason, "human_payload": {"collection": "places", "target_id": target_id, "changes": changes}})
        elif status == "MERGED_ROUTE_SOURCE":
            target_id = c.get("existing_route_id")
            target = route_by_id.get(target_id)
            if target and source_url and (target_id, source_url) not in source_seen:
                source_seen.add((target_id, source_url))
                sources = list(target.get("sources", []))
                if not any(s.get("url") == source_url for s in sources):
                    new_source = {"label": f"小红书路线候选参考（节点有重叠，非轨迹依据）｜{source_title}", "url": source_url}
                    merge_decisions.append({"candidate_id": c["candidate_id"], "human_action": "ACCEPT_UPDATE", "reviewed_at": datetime.now().isoformat(timespec="seconds"), "source_url": source_url, "human_note": reason, "human_payload": {"collection": "routes", "target_id": target_id, "changes": {"sources": sources + [new_source]}}})
        elif status == "NEW_POI_MAP_PENDING":
            pending_place_rows.append({"candidate_id": c["candidate_id"], "name": c.get("title", ""), "canonical_name_suggestion": "大垟坞水库" if c.get("title") == "大垟坞水库(杭州小九寨)" else c.get("title", ""), "source_url": source_url, "source_note_ids": c.get("source_note_ids", []), "match_type": c.get("match_type"), "matched_existing_name": c.get("matched_existing_name"), "triage_reason": reason, "raw_text": c.get("raw_text", "")})
        elif status == "NEW_ROUTE_MAP_PENDING":
            pending_route_rows.append({"candidate_id": c["candidate_id"], "title": c.get("title", ""), "source_url": source_url, "candidate_stops": c.get("candidate_stop_names", []), "canonical_stops": c.get("canonical_stops", []), "unmapped_stops": c.get("unmapped_stops", []), "existing_route_name": c.get("existing_route_name", ""), "route_relation": c.get("route_relation", ""), "triage_reason": reason, "raw_route_text": c.get("raw_route_text", "")})
        elif status == "UNCERTAIN":
            c["suggested_action"] = "HUMAN_REVIEW"
            uncertain.append(c)
    summary = Counter(c["triage_decision"] for c in rows)
    merge_file = {"schema_version": 1, "created_at": datetime.now().isoformat(timespec="seconds"), "decisions": merge_decisions}
    (args.output_dir / "xhs-approved-merges.json").write_text(json.dumps(merge_file, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.output_dir / "xhs-curated-decisions.json").write_text(json.dumps({"schema_version": 1, "summary": dict(summary), "decisions": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_csv(args.output_dir / "xhs-curated-decisions.csv", [{k: c.get(k, "") for k in ("candidate_id", "type", "title", "source_url", "source_note_id", "triage_decision", "triage_reason", "human_action", "review_status", "matched_existing_id", "matched_existing_name", "existing_route_id", "existing_route_name", "route_relation", "overall_similarity", "candidate_stop_names", "existing_stops")} for c in rows])
    write_csv(args.output_dir / "xhs-new-map-candidates.csv", pending_place_rows)
    write_csv(args.output_dir / "xhs-pending-route-mapping.csv", pending_route_rows)
    write_csv(args.output_dir / "xhs-final-uncertain.csv", [{k: c.get(k, "") for k in ("candidate_id", "type", "title", "source_url", "source_note_ids", "raw_text", "raw_place_names", "raw_route_text", "candidate_stop_names", "unmapped_stops", "matched_existing_name", "existing_route_name", "route_relation", "triage_reason")} for c in uncertain])
    original_html = args.output_dir / "review.html"
    all_html = args.output_dir / "review-all.html"
    if original_html.exists() and not all_html.exists():
        shutil.copy2(original_html, all_html)
    if all_html.exists():
        html_text = all_html.read_text(encoding="utf-8")
        slim_summary = dict(audit.get("summary", {}))
        slim_summary["candidate_count"] = len(uncertain)
        slim_summary["curation_pending_count"] = len(uncertain)
        slim_data = json.dumps({"summary": slim_summary, "candidates": uncertain}, ensure_ascii=False).replace("</", "<\\/")
        html_text, count = re.subn(r"(?<=const DATA=).*?(?=;const KEY=)", lambda _: slim_data, html_text, count=1, flags=re.S)
        if not count:
            raise ValueError("无法生成精简审核页：未找到 DATA payload")
        original_html.write_text(html_text, encoding="utf-8")
    lines = ["# 小红书第二轮人工式筛选", "", "此次把明显错误项和有可靠对应关系的项先处理；原始 CSV、旧提取 CSV 和全量机器审核结果保留。正式库只会附加可追溯来源，不改变名称、坐标、路线 stops/path。", "", "## 结果", ""]
    lines.extend(f"- {key}: {value}" for key, value in sorted(summary.items()))
    lines += [f"- 现有地点/路线来源归并计划：{len(merge_decisions)} 条（已对目标/source_url 去重）", f"- 可进入后续核点的新地点候选：{len(pending_place_rows)} 条；坐标未核，不写正式库。", f"- 可进入后续节点核对的新路线候选：{len(pending_route_rows)} 条；未生成 geometry。", f"- 仍需你看一眼的高不确定项：{len(uncertain)} 条。", "", "## 重要边界", "", "REJECT 指从地图候选层移除，不删除原始笔记或 CSV；合集父标题归档为来源，不映射为路线；来源归并只记录参考 URL，并明确标注内容/轨迹未核；新候选待高德坐标与节点匹配后再决定是否加入正式数据。", "", "打开 `review.html` 只看待定项；`review-all.html` 保留原来的全量审核页。", ""]
    (args.output_dir / "xhs-curation-summary.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"triage_counts": dict(summary), "source_merge_decisions": len(merge_decisions), "new_place_map_candidates": len(pending_place_rows), "new_route_mapping_candidates": len(pending_route_rows), "uncertain_for_user": len(uncertain), "uncertain_titles": [x.get("title") for x in uncertain]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
