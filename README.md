# Offline UFC Editor

Static browser app for editing Unified Facilities Criteria (UFC) checkout packs on air-gapped machines. Offline edits are **proposals for CMS review and merge**, never published authority.

Sibling app: [Offline UFC Reader](https://github.com/njivy/ufc-offline-viewer). The Editor reuses the Reader content vocabulary and media paths without changing Reader pack formats.

**Status (2026-09-21 PT):** Contract v0 frozen; editor v0.1.1 supports section-lock-scoped proposals across the content elements demonstrated in current export fixtures.

## Run locally

```bash
npm install
npm run build:fixture
npm run test:roundtrip
npm run dev
```

Vite prints the local URL, usually `http://localhost:5173`.

## Walkthrough

1. Load **UFC text/table sample** or import a CMS checkout ZIP.
2. Search or expand the hierarchical contents tree.
3. Select a locked section or any descendant of a locked section.
4. Edit the available fields, enter a required rationale, and save the tracked change.
5. Export the proposal ZIP. The confirmation names the file and number of tracked changes.

Use **Load image sample** to verify IMAGE rendering and caption/alternative-text editing.

## Editable content in v0.1.1

- CHAPTER and HEADING labels/headings
- TEXT sentence text and formatting (`paragraphType`, `alignment`, bullet/list settings, `indentLevel`)
- Node `content` where present
- `commentary[]` and `explanation[]` headings/content
- TABLE HTML, caption, and alternative text
- IMAGE caption and alternative text (image replacement is not yet included)

All untouched CIM fields remain in the full lock-root subtree stored in `changes[].after.section`. Sentence, commentary, media, and section identifiers are preserved.

## Lock behavior

CMS checkout packs contain section locks in `meta/checkout-manifest.json`. A lock covers the named section and its descendants. Sections outside all lock roots are rendered read-only and have no edit form. Every saved tracked change requires a rationale.

## Pack layout

Checkout ZIP:

```text
content.json
meta/checkout-manifest.json
media/<relativePath>        # optional
```

Proposal ZIP:

```text
proposal.json               # ufc-offline-proposal-pack v1
content.json                # embedded base snapshot
```

See [PACK-CONTRACT.md](./PACK-CONTRACT.md) and the JSON Schemas under [`schemas/`](./schemas/).

## Verification

```bash
npm run test:roundtrip
npm run build
```

The round-trip check covers sentence formatting and IDs, TABLE field preservation, commentary IDs, IMAGE media-path loading, required rationales, and proposal ZIP structure.

## Explicit separations

- Not the Reader UX; this is a separate editing app.
- Not Reader local notes, which stay private and do not sync.
- Not Reader Criteria Change Request (CCR) link-out.
- No live CMS API is required on the SME machine.
- Exporting a proposal does not publish or establish UFC authority.
