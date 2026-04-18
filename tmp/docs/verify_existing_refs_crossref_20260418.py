import csv
import json
import re
import sys
import time
from pathlib import Path

import requests
from docx import Document


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", (s or "").lower())


def main():
    docx_path = Path(sys.argv[1])
    out_csv = Path("docs/plans/coal_sci_reference_verification_existing_20260418.csv")
    out_json = Path("docs/plans/coal_sci_reference_verification_existing_20260418.json")
    doc = Document(str(docx_path))
    refs = []
    for p in doc.paragraphs:
        t = p.text.strip()
        if re.match(r"^\[\d+\]", t):
            num = int(re.match(r"^\[(\d+)\]", t).group(1))
            doi_m = re.search(r"DOI:\s*([^\s。；;]+)", t, flags=re.I)
            doi = doi_m.group(1).rstrip(".") if doi_m else ""
            refs.append((num, t, doi))

    rows = []
    session = requests.Session()
    for num, ref, doi in refs:
        status = "NO_DOI"
        title = ""
        authors = ""
        container = ""
        year = ""
        type_ = ""
        url = ""
        title_match = ""
        error = ""
        if doi:
            try:
                api = f"https://api.crossref.org/works/{doi}"
                r = session.get(api, timeout=20, headers={"User-Agent": "Codex reference verification (mailto:example@example.com)"})
                if r.status_code == 200:
                    msg = r.json().get("message", {})
                    title = (msg.get("title") or [""])[0]
                    container = (msg.get("container-title") or [""])[0]
                    type_ = msg.get("type", "")
                    url = msg.get("URL", "")
                    issued = msg.get("issued", {}).get("date-parts", [[]])
                    year = str(issued[0][0]) if issued and issued[0] else ""
                    aus = []
                    for a in (msg.get("author") or [])[:6]:
                        family = a.get("family", "")
                        given = a.get("given", "")
                        aus.append((family + " " + given).strip())
                    authors = "; ".join(aus)
                    title_match = "YES" if norm(title) and norm(title)[:30] in norm(ref) else "CHECK"
                    status = "VERIFIED"
                else:
                    status = f"HTTP_{r.status_code}"
            except Exception as e:
                status = "ERROR"
                error = str(e)
            time.sleep(0.12)
        rows.append({
            "ref_no": num,
            "doi": doi,
            "status": status,
            "crossref_title": title,
            "crossref_authors_first6": authors,
            "crossref_container": container,
            "crossref_year": year,
            "crossref_type": type_,
            "crossref_url": url,
            "title_match": title_match,
            "error": error,
            "original_ref": ref,
        })

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with out_csv.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    out_json.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(out_csv)
    print("verified", sum(1 for r in rows if r["status"] == "VERIFIED"), "of", len(rows))
    print("needs_check", [r["ref_no"] for r in rows if r["status"] != "VERIFIED" or r["title_match"] == "CHECK"])


if __name__ == "__main__":
    main()
