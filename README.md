# Offline UFC Editor

Static browser app for editing Unified Facilities Criteria (UFC) checkout packs on air-gapped machines. Offline edits are **proposals for CMS review and merge**, never published authority.

Sibling app: [Offline UFC Reader](https://github.com/njivy/ufc-offline-viewer). The Editor reuses the Reader content vocabulary and media paths without changing Reader pack formats.

**Status (2026-09-21 PT):** Contract v0 frozen; editor **v0.1.2** adds structured WYSIWYG document editing for locked sections (same visual language for unlocked read-only).

## Run locally

```bash
npm install
npm run build:fixture
npm test
npm run dev
```

Vite prints the local URL, usually `http://localhost:5173`.

## Walkthrough

1. Load **UFC text/table sample** or import a CMS checkout ZIP.
2. Search or expand the hierarchical contents tree.
3. Select a locked section or any descendant of a locked section.
4. Edit on the **document surface** (headings, sentences, lists, tables, callouts, image caption/alt). Enter a required rationale in the sticky sidebar, then **Save tracked change**.
5. Export the proposal ZIP. The confirmation names the file and number of tracked changes.

Use **Load image sample** to verify IMAGE rendering and caption/alternative-text editing.

## WYSIWYG editing (v0.1.2)

Locked sections open as a document-like surface (`contenteditable` structured markup), not raw field grids:

- Heading / label as title
- Sentences as paragraphs or bullet lists (`data-sentence-id` preserved)
- Commentary / explanation as callout blocks
- TABLE as a real HTML table (cells editable in place); caption and alt editable
- IMAGE as a figure when the pack includes the blob; caption and alt editable (binary replace remains out of scope)

A small toolbar supports paragraph vs bullet, indent/outdent, and alignment. Unlocked sections reuse the same renderer with `editable: false`. Draft state is parsed from the DOM before TOC re-renders so edits survive expand/collapse and search.

## Editable content

- CHAPTER and HEADING labels/headings
- TEXT sentence text and formatting (`paragraphType`, `alignment`, bullet/list settings, `indentLevel`)
- Node `content` where present
- `commentary[]` and `explanation[]` headings/content
- TABLE HTML, caption, and alternative text
- IMAGE caption and alternative text (image replacement is not included)

All untouched CIM fields remain in the full lock-root subtree stored in `changes[].after.section`. Sentence, commentary, media, and section identifiers are preserved.

## Lock behavior

CMS checkout packs contain section locks in `meta/checkout-manifest.json`. A lock covers the named section and its descendants. Sections outside all lock roots are rendered read-only and have no edit controls. Every saved tracked change requires a rationale.

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
npm run test:wysiwyg
npm run build
```

The pack round-trip check covers sentence formatting and IDs, TABLE field preservation, commentary IDs, IMAGE media-path loading, required rationales, and proposal ZIP structure. The WYSIWYG check round-trips render → DOM edit → parse for sentence ids, bullets, table cells, commentary, and image caption/alt.

## Explicit separations

- Not the Reader UX; this is a separate editing app.
- Not Reader local notes, which stay private and do not sync.
- Not Reader Criteria Change Request (CCR) link-out.
- No live CMS API is required on the SME machine.
- Exporting a proposal does not publish or establish UFC authority.
- Out of scope for v0.1.2: IMAGE binary replace, Reader changes, live CMS.
