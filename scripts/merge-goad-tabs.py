#!/usr/bin/env python3
"""Inline GOAD tab components back into goad-instance-page (fixes missing context vars)."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "src/app/goad/[id]/goad-instance/goad-instance-page.tsx"
TABS = ROOT / "src/app/goad/[id]/goad-instance/tabs"

TAB_ORDER = [
    ("deploy-tab.tsx", "DeployTab"),
    ("terminal-tab.tsx", "TerminalTab"),
    ("info-tab.tsx", "InfoTab"),
    ("inventories-tab.tsx", "InventoriesTab"),
    ("extensions-tab.tsx", "ExtensionsTab"),
    ("history-tab.tsx", "HistoryTab"),
]


def extract_tabscontent_inner(tab_file: Path) -> str:
    text = tab_file.read_text(encoding="utf-8")
    m = re.search(r"<TabsContent[^>]*>\s*(.*?)\s*</TabsContent>", text, re.DOTALL)
    if not m:
        raise RuntimeError(f"No TabsContent in {tab_file}")
    return m.group(1)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")

    for fname, component in TAB_ORDER:
        inner = extract_tabscontent_inner(TABS / fname)
        # Match opening tag from tab file for className fidelity
        tab_text = (TABS / fname).read_text(encoding="utf-8")
        open_m = re.search(r"(<TabsContent value=\"[^\"]+\"[^>]*>)", tab_text)
        if not open_m:
            raise RuntimeError(f"No TabsContent open tag in {fname}")
        block = f"{open_m.group(1)}\n{inner}\n        </TabsContent>"
        page, n = re.subn(
            rf"\s*<{component}\s*/>\s*",
            f"\n        {block}\n",
            page,
            count=1,
        )
        if n != 1:
            raise RuntimeError(f"Could not replace <{component} />")

    # Remove tab imports and provider wrapper
    for _, component in TAB_ORDER:
        page = re.sub(rf'import \{{ {component} \}} from "\./tabs/[^"]+"\n', "", page)
    page = re.sub(
        r'import \{ GoadInstanceProvider, type GoadInstanceContextValue \} from "\./goad-instance-context"\n',
        "",
        page,
    )

    # Remove goadCtx block and provider tags
    page = re.sub(
        r"\n  const goadCtx: GoadInstanceContextValue = \{.*?\}\n\n",
        "\n",
        page,
        count=1,
        flags=re.DOTALL,
    )
    page = page.replace("      <GoadInstanceProvider value={goadCtx}>\n      <Tabs ", "      <Tabs ")
    page = page.replace("      </Tabs>\n      </GoadInstanceProvider>", "      </Tabs>")

    PAGE.write_text(page, encoding="utf-8")
    print("Merged tabs into goad-instance-page.tsx")


if __name__ == "__main__":
    main()
