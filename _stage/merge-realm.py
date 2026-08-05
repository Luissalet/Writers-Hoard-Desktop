# -*- coding: utf-8 -*-
import io, json
KEYS = json.load(io.open("_stage/realm-keys.json", encoding="utf-8"))

def merge(path, lang):
    s = io.open(path, encoding="utf-8").read()
    tail = "} as const;"
    assert tail in s, path
    idx = s.rindex(tail)
    added, skipped, lines = [], [], []
    for k in KEYS:
        key = k["key"]
        if ("'" + key + "'") in s:
            skipped.append(key); continue
        val = k[lang].replace("\\", "\\\\").replace("'", "\\'")
        lines.append("  '%s': '%s'," % (key, val))
        added.append(key)
    if lines:
        s = s[:idx] + "\n".join(lines) + "\n" + s[idx:]
        io.open(path, "w", encoding="utf-8").write(s)
    print("%s: +%d  (ya estaban: %d)" % (path, len(added), len(skipped)))
    return added

a = merge("src/locales/es.ts", "es")
b = merge("src/locales/en.ts", "en")
print("paridad:", "OK" if sorted(a) == sorted(b) else "DESCUADRE " + str(set(a) ^ set(b)))
