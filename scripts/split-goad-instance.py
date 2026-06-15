#!/usr/bin/env python3
"""Split _goad-instance.tsx into physical modules under goad-instance/."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "app" / "goad" / "[id]"
SOURCE = SRC / "_goad-instance.tsx"
OUT_DIR = SRC / "goad-instance"

TAB_SPECS = [
    ("deploy", "DeployTab", "mt-4 flex flex-col min-h-0 flex-1 overflow-hidden"),
    ("terminal", "TerminalTab", "mt-4 flex flex-col min-h-0 flex-1 overflow-hidden"),
    ("info", "InfoTab", "mt-4 flex flex-col min-h-0 flex-1 overflow-y-auto"),
    ("inventories", "InventoriesTab", "mt-4 flex flex-col min-h-0 flex-1 overflow-y-auto"),
    ("extensions", "ExtensionsTab", "mt-4 flex flex-col min-h-0 flex-1 overflow-y-auto"),
    ("history", "HistoryTab", "mt-4 flex flex-col min-h-0 flex-1"),
]

SKIP_IDS = {
    "className", "variant", "size", "type", "key", "value", "true", "false", "null",
    "undefined", "return", "const", "let", "var", "if", "else", "async", "await",
    "void", "new", "typeof", "instanceof", "in", "of", "from", "as", "div", "span",
    "p", "strong", "code", "button", "onClick", "disabled", "title", "side", "map",
    "filter", "length", "sort", "reduce", "find", "some", "every", "includes", "has",
    "trim", "slice", "push", "set", "get", "then", "catch", "finally", "try", "case",
    "switch", "default", "break", "continue", "function", "class", "import", "export",
    "cn", "formatDuration", "formatTaskInstant", "aggregateDeployStatuses",
    "correlateHistoryEntries", "formatLogHistoryLocalRange", "formatLogHistoryDuration",
}


def extract_tabs(text: str) -> dict[str, str]:
    tabs: dict[str, str] = {}
    for tab_id, _, _ in TAB_SPECS:
        m = re.search(
            rf'<TabsContent value="{tab_id}"[^>]*>\s*(.*?)\s*</TabsContent>',
            text,
            re.DOTALL,
        )
        if not m:
            raise RuntimeError(f"Missing tab: {tab_id}")
        tabs[tab_id] = m.group(1)
    return tabs


def scan_bindings(page_fn: str) -> list[str]:
    names: set[str] = set()
    for m in re.finditer(r"^\s{2}const (\w+)", page_fn, re.MULTILINE):
        names.add(m.group(1))
    for m in re.finditer(r"^\s{2}const \[(\w+)", page_fn, re.MULTILINE):
        names.add(m.group(1))
    for m in re.finditer(r"^\s{2}const \{([^}]+)\}", page_fn, re.MULTILINE):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            if ":" in part:
                part = part.split(":")[0].strip()
            names.add(part)
    return sorted(names)


def scan_tab_ids(inner: str) -> list[str]:
    ids = set(re.findall(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\b", inner))
    return sorted(i for i in ids if i not in SKIP_IDS and not i.startswith("on"))


def tab_imports(inner: str) -> str:
    blocks: list[str] = []
    if re.search(r"\bCard\b", inner):
        blocks.append('import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"')
    if re.search(r"\bButton\b", inner):
        blocks.append('import { Button } from "@/components/ui/button"')
    if re.search(r"\bBadge\b", inner):
        blocks.append('import { Badge } from "@/components/ui/badge"')
    if re.search(r"\bAlert\b", inner):
        blocks.append('import { Alert, AlertDescription } from "@/components/ui/alert"')
    if re.search(r"\bInput\b", inner):
        blocks.append('import { Input } from "@/components/ui/input"')
    if re.search(r"\bLabel\b", inner):
        blocks.append('import { Label } from "@/components/ui/label"')
    if re.search(r"\bLoader2\b", inner):
        blocks.append('import { Loader2 } from "lucide-react"')
    if re.search(r"\bGoadTerminal\b", inner):
        blocks.append('import GoadTerminal from "@/components/goad/goad-terminal"')
    if re.search(r"\bGoadLogSplitPane\b", inner):
        blocks.append('import { GoadLogSplitPane } from "@/components/goad/goad-log-split-pane"')
    if re.search(r"\bCorrelatedHistoryRow\b", inner):
        blocks.append(
            'import { CorrelatedHistoryRow, formatLogHistoryLocalRange, formatLogHistoryDuration } from "@/components/range/log-history-list"'
        )
    if re.search(r"\bTemplateChips\b", inner):
        blocks.append('import { TemplateChips } from "../template-chips"')
    if re.search(r"\bcn\b", inner):
        blocks.append('import { cn } from "@/lib/utils"')
    if re.search(r"\bformatDuration\b", inner):
        blocks.append('import { formatDuration } from "@/components/goad/goad-instance-tab-utils"')
    if re.search(r"\bformatTaskInstant\b", inner):
        blocks.append('import { formatTaskInstant } from "@/components/goad/goad-instance-tab-utils"')
    if re.search(r"\baggregateDeployStatuses\b", inner):
        blocks.append('import { aggregateDeployStatuses } from "@/lib/goad-deploy-history-correlation"')
    if re.search(r"\bcorrelateHistoryEntries\b", inner):
        blocks.append('import { correlateHistoryEntries } from "@/lib/goad-deploy-history-correlation"')
    # lucide icons used as components
    icons = sorted(set(re.findall(r"<([A-Z][a-zA-Z0-9]+)\s", inner)))
    lucide = [i for i in icons if i not in {
        "Card", "CardContent", "CardHeader", "CardTitle", "Button", "Badge", "Alert",
        "AlertDescription", "Input", "Label", "TabsContent", "GoadTerminal", "GoadLogSplitPane",
        "CorrelatedHistoryRow", "TemplateChips", "Tooltip", "TooltipTrigger", "TooltipContent",
        "TooltipProvider", "ConfirmBar",
    }]
    if lucide:
        blocks.append(f'import {{ {", ".join(lucide)} }} from "lucide-react"')
    return "\n".join(blocks) + ("\n" if blocks else "")


def indent(text: str, n: int) -> str:
    pad = " " * n
    return "\n".join(pad + line if line.strip() else line for line in text.splitlines())


def main() -> None:
    raw = SOURCE.read_text(encoding="utf-8")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "tabs").mkdir(exist_ok=True)

    chips_start = raw.index("function TemplateChips(")
    page_start = raw.index("function GoadInstancePage()")
    client_start = raw.index("export function GoadInstancePageClient()")

    chips_fn = raw[chips_start:page_start].strip()
    page_and_client = raw[page_start:]

    (OUT_DIR / "template-chips.tsx").write_text(
        '"use client"\n\n'
        'import { Check, CircleAlert, PackageX } from "lucide-react"\n'
        'import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"\n'
        'import { cn } from "@/lib/utils"\n\n'
        f"export {chips_fn}\n",
        encoding="utf-8",
    )

    (OUT_DIR / "goad-instance-context.tsx").write_text(
        '"use client"\n\n'
        'import { createContext, useContext } from "react"\n\n'
        "export type GoadInstanceContextValue = Record<string, unknown>\n\n"
        "const GoadInstanceContext = createContext<GoadInstanceContextValue | null>(null)\n\n"
        "export function GoadInstanceProvider({\n"
        "  value,\n"
        "  children,\n"
        "}: {\n"
        "  value: GoadInstanceContextValue\n"
        "  children: React.ReactNode\n"
        "}) {\n"
        "  return <GoadInstanceContext.Provider value={value}>{children}</GoadInstanceContext.Provider>\n"
        "}\n\n"
        "export function useGoadInstance(): GoadInstanceContextValue {\n"
        "  const ctx = useContext(GoadInstanceContext)\n"
        "  if (!ctx) throw new Error(\"useGoadInstance requires GoadInstanceProvider\")\n"
        "  return ctx\n"
        "}\n",
        encoding="utf-8",
    )

    tabs = extract_tabs(page_and_client)
    tab_import_lines: list[str] = []

    for tab_id, component, cls in TAB_SPECS:
        inner = tabs[tab_id]
        used = scan_tab_ids(inner)
        destructure = ",\n    ".join(used)
        imp = tab_imports(inner)
        (OUT_DIR / "tabs" / f"{tab_id}-tab.tsx").write_text(
            '"use client"\n\n'
            'import { TabsContent } from "@/components/ui/tabs"\n'
            'import { useGoadInstance } from "../goad-instance-context"\n'
            f"{imp}"
            f"\nexport function {component}() {{\n"
            "  const {\n"
            f"    {destructure},\n"
            "  } = useGoadInstance()\n\n"
            f'  return (\n'
            f'    <TabsContent value="{tab_id}" className="{cls}">\n'
            f"{indent(inner, 6)}\n"
            f"    </TabsContent>\n"
            f"  )\n"
            f"}}\n",
            encoding="utf-8",
        )
        tab_import_lines.append(f'import {{ {component} }} from "./tabs/{tab_id}-tab"')

    page_fn, client_export = page_and_client.split("export function GoadInstancePageClient()", 1)

    for tab_id, component, _ in TAB_SPECS:
        page_fn, n = re.subn(
            rf"\s*<TabsContent value=\"{tab_id}\"[^>]*>.*?</TabsContent>",
            f"\n        <{component} />\n",
            page_fn,
            count=1,
            flags=re.DOTALL,
        )
        if n != 1:
            raise RuntimeError(f"Tab replace failed: {tab_id}")

    bindings = scan_bindings(page_fn.split("  return (", 1)[0])
    ctx_block = "  const goadCtx: GoadInstanceContextValue = {\n" + "".join(
        f"    {b},\n" for b in bindings
    ) + "  }\n\n"

    head, tail = page_fn.rsplit("  return (", 1)
    page_fn = head + ctx_block + "  return (" + tail

    page_fn = page_fn.replace(
        "      <Tabs ",
        "      <GoadInstanceProvider value={goadCtx}>\n      <Tabs ",
        1,
    )
    page_fn = page_fn.replace(
        "      </Tabs>\n    </div>\n  )\n}",
        "      </Tabs>\n      </GoadInstanceProvider>\n    </div>\n  )\n}",
        1,
    )

    header = raw[:chips_start]
    extra_imports = (
        'import { TemplateChips } from "./goad-instance/template-chips"\n'
        'import { GoadInstanceProvider, type GoadInstanceContextValue } from "./goad-instance/goad-instance-context"\n'
        + "\n".join(tab_import_lines)
        + "\n"
    )
    header = header.replace(
        'from "@/components/goad/goad-instance-tab-utils"\n',
        'from "@/components/goad/goad-instance-tab-utils"\n' + extra_imports,
    )

    (OUT_DIR / "goad-instance-page.tsx").write_text(
        header + page_fn + "export function GoadInstancePageClient()" + client_export,
        encoding="utf-8",
    )

    SOURCE.write_text(
        '"use client"\n\nexport { GoadInstancePageClient } from "./goad-instance/goad-instance-page"\n',
        encoding="utf-8",
    )
    print("GOAD split OK:", OUT_DIR)


if __name__ == "__main__":
    main()
