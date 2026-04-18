from __future__ import annotations

import sys
import zipfile
from pathlib import Path

from docx import Document


RISKY_PHRASES = {
    "mainly_proves": "\u4e3b\u8981\u8bc1\u660e",
    "stable_reduce": "\u7a33\u5b9a\u964d\u4f4e",
    "engineering_finalization_tool": "\u53ef\u7528\u4e8e\u5de5\u7a0b\u5b9a\u6848",
    "object_chain_effectiveness": "\u5bf9\u8c61\u94fe\u6709\u6548\u6027",
    "method_effectiveness_validation": "\u65b9\u6cd5\u6709\u6548\u6027\u4e0e\u5185\u90e8\u5bf9\u7167\u9a8c\u8bc1",
    "can_prove_method_chain": "\u80fd\u591f\u8bc1\u660e\u65b9\u6cd5\u94fe",
    "proved_by_sensitivity": "\u6240\u8bc1\u660e\u7684\u662f",
    "universal_engineering_constant": "\u666e\u9002\u5de5\u7a0b\u5e38\u6570",
    "direct_generalize": "\u76f4\u63a5\u5916\u63a8",
}

EXPECTED_PHRASES = {
    "method_chain_operability": "\u65b9\u6cd5\u94fe\u53ef\u8fd0\u884c\u6027\u4e0e\u5185\u90e8\u5bf9\u7167\u9a8c\u8bc1",
    "mainly_indicates": "\u4e3b\u8981\u8868\u660e",
    "decision_support_tool": "\u53ef\u8f85\u52a9\u5de5\u7a0b\u65b9\u6848\u8bba\u8bc1\u7684\u51b3\u7b56\u5de5\u5177",
    "object_chain_transferability": "\u5bf9\u8c61\u94fe\u53ef\u4f20\u9012\u6027",
}


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: check_claim_tone_20260418.py <docx>")
        return 2

    path = Path(sys.argv[1])
    with zipfile.ZipFile(path) as zf:
        bad = zf.testzip()
    if bad is not None:
        raise RuntimeError(f"Bad DOCX zip member: {bad}")

    doc = Document(str(path))
    text = "\n".join(p.text for p in doc.paragraphs)
    for name, phrase in RISKY_PHRASES.items():
        print(f"risky_{name}={text.count(phrase)}")
    for name, phrase in EXPECTED_PHRASES.items():
        print(f"expected_{name}={text.count(phrase)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
