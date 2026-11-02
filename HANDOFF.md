# HANDOFF: Offline UFC Editor

Handoff date: 2026-11-02 (PT). This doc is meant to be read on its own: it assumes no access to the machine or tools the earlier work was done on.

## 1. What it is and current state

- **What:** A static browser app (Vite + vanilla JS) for editing Unified Facilities Criteria (UFC) **checkout packs** on air-gapped machines. A subject-matter expert (SME) imports a checkout ZIP from the content management system (CMS) and edits only the sections locked to them. Each tracked change needs a rationale. The SME then exports a **proposal pack** for the CMS to review and merge. Output is a **proposal, never published authority**.
- **For:** air-gapped contractor SMEs who edit assigned UFC sections and hand proposals back to the CMS owners.
- **Version:** `0.1.3` (`package.json`). The latest tag and GitHub release is **v0.1.3**, published 2026-09-22. Its release asset is `ufc-offline-editor-0.1.3-dist.zip`.
- **Latest commit on `main` before this doc:** `315c442` "v0.1.3: Bold/italic + add/delete sentences in locked WYSIWYG" (2026-09-22).
- **Open PRs:** none. **Issues:** none, in any state. **Branch protection on main:** none. The repo is **public**.
- **Sibling app:** [ufc-offline-viewer](https://github.com/njivy/ufc-offline-viewer), the read-only Reader, which has its own HANDOFF.md. The Editor reuses the Reader's content vocabulary and media paths without changing Reader formats.

## 2. Build, run, test

Use Node `^20.19.0 || >=22.12.0`, as required by Vite 8.3. Tests and the build were checked on Node 20.19.2 on 2026-11-02, and both passed.

```bash
npm ci
npm run build:fixture   # node scripts/build-sample-checkout.mjs -> public/fixtures/sample-checkout*.zip
npm test                # test:roundtrip && test:wysiwyg
npm run dev             # http://localhost:5173
npm run build           # vite build -> dist/
```

- `npm run test:roundtrip` (`scripts/roundtrip-check.mjs`) imports `public/fixtures/sample-checkout.zip`, edits a TABLE, a sentence, and a commentary section, and builds a proposal. It asserts that IDs and untouched fields are preserved, that rationales are required, and that the proposal ZIP has the right structure.
- `npm run test:wysiwyg` (`scripts/wysiwyg-roundtrip-check.mjs`, using `linkedom`) round-trips render → DOM edit → parse. It covers sentence IDs, bullets, bold/italic HTML, adding and deleting sentences, table cells, commentary, and image caption/alt.
- **`dist/` is committed.** The build is an IIFE single chunk with `base: './'` and assets inlined, so `dist/index.html` opens from disk. Rebuild and commit `dist/` with source changes.
- **Release zip:** each GitHub release attaches `ufc-offline-editor-X.Y.Z-dist.zip`, the contents of `dist/`. The exact zip command wasn't recorded. Upload the zip as a release asset (`gh release create`). Every release should carry a runnable dist zip.
- Walkthrough screenshots were taken with headless Chrome against `vite preview`. `walk-shots-formatting/` is committed. The other `walk-shots*` folders are git-ignored or untracked.

## 3. Architecture and key files

| File | Role |
|---|---|
| `src/main.js` | UI: contents tree and search, lock display, sticky rationale sidebar, author fields (with a spoofing warning when overridden), export |
| `src/wysiwyg.js` | `contenteditable` document surface for locked sections. The toolbar has bold/italic, paragraph or bullet, indent, alignment, and add/delete sentence. Parses the DOM back to a draft |
| `src/content.js` | Section tree helpers: `findSectionById`, `draftFromSection`, `applyDraftToRoot`, `uid`, `nowIso` |
| `src/pack.js` | `importCheckoutPack` (ZIP → content, manifest, locks, media) and `buildProposalPack` |
| `src/hash.js` | Canonical SHA-256 section hash (`sha256:<hex>`) |
| `PACK-CONTRACT.md` | **Source of truth** for formats and CMS handoff. Contract **v0, frozen 2026-09-21** |
| `schemas/checkout-manifest.schema.json`, `schemas/proposal.schema.json` | JSON Schema (2020-12) stubs for CMS implementers |
| `public/fixtures/` | `sample-checkout.zip`, `sample-checkout-image.zip`, `checkout-manifest*.json`, `ufc-1-200-01-content.json`, image demo |

**Pack formats (summary; see PACK-CONTRACT.md)**
- **Checkout ZIP (CMS → SME):** `content.json`, `meta/checkout-manifest.json` (`format: "ufc-offline-checkout-pack"`, `formatVersion: 1`, `baseVersionId`, `assignee`, `locks[]` with `sectionId`/`assigneeId`/`lockedAt`/optional `expiresAt`), and optional `media/`. The manifest must sit under `meta/`, never at the ZIP root. There is **one UFC per ZIP**.
- **Proposal ZIP (SME → CMS):**
  - `proposal.json`: `format: "ufc-offline-proposal-pack"`, `formatVersion: 1`, plus `changes[]`. Each change carries `target.sectionId` with `granularity: "section"`, `before.contentHash`, `after.section` (the full lock-root subtree), `rationale`, and `author`.
  - The embedded base `content.json`.
- **Decision pack** (`ufc-offline-proposal-decision`): specified as "optional later". **Not implemented.**
- A lock covers a section and all its descendants. Sections outside the locks are read-only.
- **Hash rule (§1.5):** SHA-256 over canonical JSON (keys sorted recursively, arrays kept in order, compact) of the target section subtree.
- **Content vocabulary** is shared with the Reader: `{ criterion, sections, metadataFields[] }`, section `id`, `sentences[].id/text`, IMAGE `url`/`sourcePath`. Don't rename or fork these fields.
- Sentence `text` round-trips a sanitized HTML subset only: `strong|b|em|i|br`.

## 4. History (all on `main`; no PRs were used)

All dates are 2026.

- **Contract v0** frozen and greenlit by Nic on 09-21. Its §4 lists the v0 defaults Nic may override.
- **v0.1.0 (09-21):** scaffold for checkout → proposal.
- **v0.1.1:** UX polish, and coverage of the exported content elements.
- **v0.1.2:** WYSIWYG editing of locked sections, with a CIM round-trip.
- **v0.1.3 (09-22):** bold/italic, plus add and delete sentence.

## 5. Open work

- **Open PRs or issues:** none.
- **Known bugs:** none recorded.
- **Out of scope as of v0.1.3, per README and release notes:**
  - replacing IMAGE binaries (`media[]` ops exist in the schema, but the UX is text-first)
  - nested rich blocks beyond inline bold/italic
  - underline, links, and colors
  - a live CMS connection
- **Not built yet, per the contract:**
  - the decision pack round trip
  - a shared npm/TS schema package ("after CMS alignment")
  - a CMS-side importer (CMS owns this; the contract §2 describes the required validation)
- **Prioritized backlog:** **unknown.** No written next-step list was found after v0.1.3, and the project has had no commits since 2026-09-22.
- **Pending decisions for Nic:**
  - Whether to override any contract v0 default in §4. Examples: author override policy, lock-expiry handling, section-only granularity, `marking`/CUI banner.
  - Whether to start any new scope. The working rule was: no big build without Nic's go.

## 6. Gotchas and constraints

- **Proposals are not authority.** Exporting never publishes. Proposals are also **not** Reader local notes and **not** a Criteria Change Request (CCR); in the Reader, CCR is a link-out to digital.wbdg.org.
- **Format discipline:**
  - Never change a pack format without a `formatVersion` bump.
  - Never emit or accept the old `ufc-proposal/1` alias.
  - Never overload `ufc-offline-workspace-pack`.
  - The Reader must keep importing today's packs unchanged.
  - When a change touches the contract, update `PACK-CONTRACT.md` and both apps together.
- **Offline only:** no live CMS API on the SME machine, no backend, and no binary.
- **Respect locks:** the editor enforces the checkout lock set and never creates locks. Identity is not authenticated offline. An author override is allowed, but it shows a warning that the CMS may treat the identity as unverified.
- **Content rules:**
  - Use UNCLASSIFIED public sources and the public API and docs only (https://digital.wbdg.org/llms.txt).
  - Don't push anything to the CMS or contact the CMS owners unless Nic asks.
  - Keep this app separate from SpecsIntact / SI Offline formats; [si-offline](https://github.com/njivy/si-offline) has its own contract.
- `npm test` needs `npm ci` first (`jszip` and `linkedom`). Rerun `npm run build:fixture` if you change the fixture builder.

## 7. Former workflow

Earlier work was done by Nic's AI assistant bots. A dedicated "Offline UFC" bot owned the Reader, the Editor, and the pack contract between them. It built each version, walked through it in headless Chrome, released it, and sent go/no-go decisions to Nic. That bot has since been retired. Across Nic's projects, the bot roles were dev (Juno), review (Grimwald), QA (Margo), and ops (Orrin). **Nic now picks up this work directly.** None of the bots, their notes, or the build machine are available in the new environment. Everything needed should be in this repo.
