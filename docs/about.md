# About LUX

## Why use LUX?

- **Operators and builders** who prefer visual workflows, shared UIs, and fewer copy-paste errors across SSH sessions.
- **Training and lab leads** who need impersonation, group-based access, blueprint sharing, and inventory visibility in one place.
- **Red/blue/purple teams** who want Ludus features (isolation, snapshots, range YAML) with extra glue: GOAD task history, admin range overview, shared-service helpers, and more.

## Ludus Pro vs LUX

Ludus ships a first-party **Pro Web UI** with a commercial license. Teams can request a **Pro NFR (Not For Resale)** license at no cost for qualified use — see [Ludus pricing](https://ludus.cloud/#pricing). That path gives you the native supported UI and Pro capabilities under Bad Sector Labs’ terms.

**LUX** is **Apache-2.0**, community-driven, and overlaps many Pro-style workflows (range design, consoles, templates, blueprints, GOAD, admin tooling) while adding its own features and integrations. Pick official Pro if you want vendor-supported closed-source plugins and SLAs; pick **LUX** if you want open source, forkability, and the feature set described in [Features](features.md) (you can even run both in parallel for comparison).

## Future enhancements

**Multi-extension batch install** — Install multiple GOAD extensions in a single queued session. Each extension would get its own Ludus deploy + GOAD task, with a progress indicator and the ability to cancel remaining items. Deferred until the single-extension flow is proven stable.
