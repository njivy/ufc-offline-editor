# Offline UFC Editor

Sibling static browser app to [Offline UFC Reader](https://github.com/njivy/ufc-offline-viewer) (v0.9.1). Offline edits are **proposals** for CMS merge — never published authority.

**Status (2026-09-21 PT):** Pack contract **v0 frozen / greenlit**. Scaffold in progress (walkable spike).

## Start here

1. **[PACK-CONTRACT.md](./PACK-CONTRACT.md)** — frozen pack schema, CMS contract, multi-SME workflow, applied defaults.
2. **JSON Schema stubs:** [`schemas/checkout-manifest.schema.json`](./schemas/checkout-manifest.schema.json), [`schemas/proposal.schema.json`](./schemas/proposal.schema.json).

## Run locally

```bash
cd /workspace/ufc-offline-editor
npm install
npm run build:fixture   # builds public/fixtures/sample-checkout.zip
npm run dev             # Vite → http://localhost:5173 (or next free port)
```

Optional: `npm run build` then `npm run preview`.

## Walkthrough (success path)

1. Open the app → click **Load sample checkout (UFC 1-200-01)** (or **Import checkout ZIP** and choose `public/fixtures/sample-checkout.zip`).
2. Sidebar shows **locked** vs **read-only** sections (locks from `meta/checkout-manifest.json`: *Background.* and *PURPOSE AND SCOPE.*).
3. Select a **locked** section → edit text → enter a **required rationale** → **Save tracked change**.
4. Click **Export proposal ZIP**.
5. Verify the ZIP contains:
   - `proposal.json` with `"format": "ufc-offline-proposal-pack"`, `formatVersion: 1`, `changes[]` with rationale
   - `content.json` (embedded base snapshot)

Quick check:

```bash
unzip -l ~/Downloads/UFC-1-200-01-proposal.zip
unzip -p ~/Downloads/UFC-1-200-01-proposal.zip proposal.json | head -40
```

Rebuild the sample checkout anytime:

```bash
npm run build:fixture
```

Fixture sources: `public/fixtures/ufc-1-200-01-content.json` + `public/fixtures/checkout-manifest.json`.

## Explicit separations

- **Not** the Reader UX — separate app (banner states packs are proposals).
- **Not** Reader local notes (private, no sync).
- **Not** Reader CCR (link-out only to digital.wbdg.org).
- Proposals use format `ufc-offline-proposal-pack` only (no `ufc-proposal/1` alias).
- Checkout layout: `content.json` + `meta/checkout-manifest.json`.

## Spike gaps vs contract

| Contract item | Spike status |
|---------------|--------------|
| Full-section replace + rationale | Done |
| Lock enforcement UI | Done |
| Proposal ZIP + embedded `content.json` | Done |
| SHA-256 project canonicalization | Done (`src/hash.js`) |
| `media[]` ops | Schema only — no media edit UX |
| Partial-accept decision pack | Not in editor (CMS-side / later) |
| Authorship override warning | Done (soft warn) |
| Lock expiry soft-warn | Done on import |

No GitHub push / remote release from this workspace by design.
