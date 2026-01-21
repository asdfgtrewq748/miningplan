import json
import sys
import urllib.request
from pathlib import Path


def post_json(url: str, payload: dict, timeout: float = 120.0) -> tuple[int, str]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        text = resp.read().decode("utf-8", errors="replace")
        return int(resp.status), text


def get(url: str, timeout: float = 10.0) -> str:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def main() -> int:
    base = "http://localhost:3001"
    try:
        print("health:", get(f"{base}/health"))
    except Exception as e:
        print("health failed:", e)

    if len(sys.argv) < 2:
        print("usage: python tools/test_smart_resource_backend.py <payload.json> [baseline_result.json]")
        return 2

    payload_path = Path(sys.argv[1])
    payload = json.loads(payload_path.read_text(encoding="utf-8"))

    status, text = post_json(f"{base}/api/planning/smart-resource/compute", payload, timeout=150.0)
    print("compute status:", status)
    print(text[:2000])
    data = json.loads(text)
    print("ok:", data.get("ok"), "mode:", data.get("mode"))
    print("candidates:", len(data.get("candidates") or []))

    if len(sys.argv) >= 3:
        baseline_path = Path(sys.argv[2])
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
        status2, text2 = post_json(
            f"{base}/api/planning/l2/compare",
            {
                "baseline": baseline,
                "candidate": data,
                "extract": "plannedWorkfaceLoopsWorld",
            },
            timeout=30.0,
        )
        print("l2 status:", status2)
        print(text2[:2000])

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
