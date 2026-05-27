import re
import urllib.request


url = "https://link.cnki.net/doi/10.13199/j.cnki.cst.2020.09.001"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
text = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "ignore")

for pattern in ["英文", "Title", "title", "作者", "Keywords", "abstract", "<h1"]:
    print("---", pattern)
    pos = text.lower().find(pattern.lower())
    if pos >= 0:
        print(text[max(0, pos - 120) : pos + 500].replace("\n", " "))
print("len", len(text))
