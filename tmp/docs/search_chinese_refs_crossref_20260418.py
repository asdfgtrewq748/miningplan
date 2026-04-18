import csv
import json
import re
import time
from pathlib import Path

import requests


QUERIES = [
    "采区 规划 工作面 布置 煤矿",
    "采区规划 工作面布置 优化 煤矿",
    "覆岩 扰动 采区规划 煤矿",
    "覆岩 导水裂隙带 含水层 扰动 煤矿",
    "导水裂隙带 发育 预测 煤层 开采",
    "地表沉陷 采煤 沉陷 预测 煤矿",
    "上行开采 覆岩 采动 煤层",
    "煤矿 智能化 采区 规划",
    "煤矿 多目标 优化 采区",
    "煤矿 经济评价 风险 净现值",
    "煤矿 覆岩破坏 导水裂隙带",
    "煤矿 采掘接续 优化",
    "煤矿 巷道布置 采区 优化",
]


def main():
    out_csv = Path("docs/plans/coal_sci_chinese_reference_candidates_crossref_20260418.csv")
    out_json = Path("docs/plans/coal_sci_chinese_reference_candidates_crossref_20260418.json")
    session = requests.Session()
    seen = set()
    rows = []
    for q in QUERIES:
        params = {
            "query.bibliographic": q,
            "rows": 20,
            "select": "DOI,title,author,container-title,issued,type,URL,score,publisher",
        }
        r = session.get("https://api.crossref.org/works", params=params, timeout=30,
                        headers={"User-Agent": "Codex reference search (mailto:example@example.com)"})
        print(q, r.status_code)
        if r.status_code != 200:
            continue
        for item in r.json().get("message", {}).get("items", []):
            doi = (item.get("DOI") or "").strip()
            title = (item.get("title") or [""])[0].strip()
            container = (item.get("container-title") or [""])[0].strip()
            issued = item.get("issued", {}).get("date-parts", [[]])
            year = issued[0][0] if issued and issued[0] else ""
            if not doi or not title or doi.lower() in seen:
                continue
            # Keep Chinese-language metadata or China-relevant journal titles.
            has_cjk = bool(re.search(r"[\u4e00-\u9fff]", title + container))
            if not has_cjk:
                continue
            seen.add(doi.lower())
            authors = []
            for a in (item.get("author") or [])[:8]:
                family = a.get("family", "")
                given = a.get("given", "")
                authors.append((family + given).strip() or family or given)
            rows.append({
                "query": q,
                "doi": doi,
                "title": title,
                "authors_first8": "; ".join(authors),
                "container": container,
                "year": year,
                "type": item.get("type", ""),
                "publisher": item.get("publisher", ""),
                "url": item.get("URL", ""),
                "score": item.get("score", ""),
            })
        time.sleep(0.2)
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    if rows:
        with out_csv.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
    out_json.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(out_csv, "rows", len(rows))


if __name__ == "__main__":
    main()
