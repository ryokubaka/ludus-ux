#!/usr/bin/env python3
import re
from pathlib import Path

PAGE = Path("src/app/goad/[id]/goad-instance/goad-instance-page.tsx")
page_fn = PAGE.read_text(encoding="utf-8")
idx = page_fn.index("const goadCtx")
head = page_fn[:idx]
names = set()
for m in re.finditer(r"^\s{2}const (\w+)", head, re.MULTILINE):
    names.add(m.group(1))
for m in re.finditer(r"^\s{2}const \[(\w+)(?:,\s*(\w+))?", head, re.MULTILINE):
    names.add(m.group(1))
    if m.group(2):
        names.add(m.group(2))
for m in re.finditer(r"^\s{2}const \{([^}]+)\}", head, re.MULTILINE):
    for part in m.group(1).split(","):
        part = part.strip()
        if ":" in part:
            part = part.split(":")[0].strip()
        if part:
            names.add(part)
for m in re.finditer(r"^\s{2}function (\w+)", head, re.MULTILINE):
    names.add(m.group(1))
bindings = sorted(names)

tabs_dir = Path("src/app/goad/[id]/goad-instance/tabs")
for tab in sorted(tabs_dir.glob("*-tab.tsx")):
    text = tab.read_text(encoding="utf-8")
    m = re.search(r"<TabsContent[^>]*>\s*(.*?)\s*</TabsContent>", text, re.DOTALL)
    if not m:
        continue
    inner = m.group(1)
    no_strings = re.sub(r'"[^"\\]*(?:\\.[^"\\]*)*"', "", inner)
    no_strings = re.sub(r"'[^'\\]*(?:\\.[^'\\]*)*'", "", no_strings)
    used = [
        b for b in bindings
        if re.search(rf"(?<![\w$]){re.escape(b)}(?![\w$])", no_strings)
    ]
    for comp in ("GoadTerminal", "GoadLogSplitPane", "CorrelatedHistoryRow", "TemplateChips", "cn", "getTaskStatusBadge"):
        if comp in inner and comp not in used:
            used.append(comp)
    used = sorted(set(used))
    start = text.index("const {")
    end = text.index("} = useGoadInstance()") + len("} = useGoadInstance()")
    new_block = "const {\n    " + ",\n    ".join(used) + ",\n  } = useGoadInstance()"
    text = text[:start] + new_block + text[end:]
    tab.write_text(text, encoding="utf-8")
    print(tab.name, len(used))
