import json
import sys
import urllib.request


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
    print("health:", get(f"{base}/health"))

    payload = {
        "reqSeq": 2,
        "cacheKey": "test-eff-fast",
        "axis": "x",
        "boundaryLoopWorld": [
            {"x": 0, "y": 0},
            {"x": 200, "y": 0},
            {"x": 200, "y": 120},
            {"x": 0, "y": 120},
        ],
        "boundaryPillarMin": 0,
        "boundaryPillarMax": 0,
        "coalPillarMin": 30,
        "coalPillarMax": 30,
        "coalPillarTarget": 30,
        "faceWidthMin": 100,
        "faceWidthMax": 100,
        "topK": 3,
        "searchProfile": "balanced",
        "fast": True,
        "input": {"mode": "efficiency"},
    }

    status, text = post_json(f"{base}/api/planning/smart-efficiency/compute", payload)
    print("compute status:", status)
    print(text[:2000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
