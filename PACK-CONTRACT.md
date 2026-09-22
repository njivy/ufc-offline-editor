# Offline UFC Editor — Pack Contract (v0 frozen)

**Audience:** Nic Ivy / USACE CoS  
**Date:** 2026-09-21 (PT)  
**Status:** **frozen / greenlit 2026-09-21 (PT)** as **contract v0** — scaffold may proceed; Nic may override defaults later  
**Sibling of:** Offline UFC Reader (`ufc-offline-viewer` v0.9.1)  
**Repo intent:** Separate static browser app; do not mix into reader UX

---

## Purpose and non-goals

**Purpose.** Define the on-disk pack formats and CMS handoff so SME machines can edit UFC sections offline and return **proposals** for CMS merge. Packs travel on disk; no live CMS API is required on SME machines.

**Non-goals (explicit)**

| Non-goal | Why |
|----------|-----|
| Publish / become authority from the editor | Proposals are git-like suggestions; CMS owns published versions |
| Change Offline UFC Reader pack formats without a version bump | Reader must keep importing today’s packs unchanged |
| Conflate editor proposals with reader **local notes** | Notes are private device commentary and do not sync |
| Conflate editor proposals with reader **CCR** | Reader CCR is link-out only to digital.wbdg.org; proposals are a different CMS-merge artifact |
| Whole-document lock | Out of scope; locking is per-section sets per SME |
| Fork `criterion` / `sections` / `metadataFields` field names | Reuse reader `normalizeContent` vocabulary as-is |

---

## Vocabulary alignment with Offline UFC Reader (v0.9.1)

Reuse as-is (do not rename or fork):

| Concept | Reader contract |
|---------|-----------------|
| Content shape | `{ criterion, sections, metadataFields[] }` — API wrapper `{ statusCode, success, data }` **or** unwrapped |
| Required | `criterion.versionId`, `sections[]` |
| Section / sentence identity | Section node `id`; TEXT body via `sentences[].id` + `sentences[].text` |
| IMAGE keys | `mediaAsset.type === "IMAGE"`; relative path from `url` / `sourcePath` |
| Single-doc ZIP | `content.json` + optional `media/<relativePath>` |
| Workspace ZIP | `format: "ufc-offline-workspace-pack"`, `formatVersion: 1` + per-doc folders + `workspace-manifest.json` |

**Read pack today:** no locks, no proposal stream. Reader must continue to ignore unknown sibling files / JSON keys when possible.

**Do not overload** `ufc-offline-workspace-pack` for editor checkout or proposals without a formatVersion bump **and** reader ignore-unknown behavior. Editor packs use distinct format names below.

---

## 1. Proposal pack schema (JSON)

### 1.1 Format names and versions

| Artifact | `format` string | `formatVersion` | Who produces | Who consumes |
|----------|-----------------|-----------------|--------------|--------------|
| Read / export pack (existing) | *(none / reader message)* | — | CMS export, Reader “Export pack” | Reader, Editor (as base content) |
| Workspace pack (existing) | `ufc-offline-workspace-pack` | `1` | Reader | Reader (and tooling) |
| **Checkout pack** (CMS → SME) | `ufc-offline-checkout-pack` | `1` | CMS | Editor only (Reader may open embedded `content.json` — see §1.3) |
| **Proposal pack** (SME → CMS) | `ufc-offline-proposal-pack` | `1` | Editor | CMS |

**Naming (v0 normative):** Use **`ufc-offline-proposal-pack`** + integer `formatVersion` only. Do **not** emit or accept the earlier sketch alias `ufc-proposal/1`.

### 1.2 What the SME imports vs exports

| Direction | Artifact | Contents (summary) |
|-----------|----------|--------------------|
| **Import (checkout)** | Checkout pack ZIP | Lock set for this SME + full read content (`content.json`) + optional `media/` |
| **Export (proposal)** | Proposal pack ZIP | Proposal manifest (`proposal.json`) referencing `baseVersionId` + `changes[]` + **embedded** `content.json` (recommended / v0 default) + optional media deltas |

Editor **never** publishes. Export is always a proposal for CMS accept / reject / partial accept.

**v0 scope:** **One UFC per checkout ZIP** (no multi-UFC workspace-style checkout).

### 1.3 Checkout pack (CMS → SME) — editor/CMS extension

Checkout is **not** a reader format change. It wraps the existing read pack and adds locks.

**ZIP layout (v0 normative)**

```text
checkout-pack.zip
├── content.json                    # same normalizeContent contract as reader
├── meta/
│   └── checkout-manifest.json      # format ufc-offline-checkout-pack
└── media/                          # optional; same relative path keys as reader
    └── ces/.../images/foo.png
```

Do **not** place `checkout-manifest.json` at ZIP root (older sketch). Root placement risks Offline UFC Reader picking the wrong first `.json`.

**`meta/checkout-manifest.json` (v0)**

```json
{
  "format": "ufc-offline-checkout-pack",
  "formatVersion": 1,
  "exportedAt": "2026-09-21T17:00:00-07:00",
  "baseVersionId": "a093a449-9220-45e0-866a-67d3139af067",
  "designation": "UFC 1-200-01",
  "marking": null,
  "assignee": {
    "id": "sme-uuid-or-cms-user-id",
    "displayName": "J. Smith",
    "email": "j.smith@example.mil"
  },
  "locks": [
    {
      "sectionId": "5730e874-909d-4c1c-9ed2-4bc1fed3ac8e",
      "assigneeId": "sme-uuid-or-cms-user-id",
      "lockedAt": "2026-09-21T16:00:00-07:00",
      "expiresAt": "2026-10-21T16:00:00-07:00"
    }
  ],
  "contentPath": "content.json",
  "mediaRoot": "media/"
}
```

**Locks fields**

| Field | Required | Notes |
|-------|----------|-------|
| `sectionId` | yes | Must match a section node `id` in `content.json` |
| `assigneeId` | yes | SME this lock is granted to; multi-SME = disjoint lock sets |
| `lockedAt` | yes | ISO-8601 |
| `expiresAt` | no | ISO-8601 when CMS has one. **Missing / omitted = no expiry in pack.** CMS hard-rejects proposals citing expired locks on the CMS ledger; editor soft-warns if `expiresAt` is in the past (best-effort clock). |

**Optional `marking`:** string on checkout (and proposal) manifests for CUI / banner text later. May be `null` or omitted in v0.

**Authorship (v0 default):** Checkout embeds CMS user `assignee.id` plus `displayName` / `email`. Editor copies that into proposal `author` by default. Free-text override offline is allowed with a **warning** (no live auth to prevent spoofing).

**Editor enforcement:** SME may edit only sections listed in `locks[]` for their assignee. Attempts to edit other section ids are blocked in UI. Whole-doc lock is out of scope.

**Reader compatibility:** Root `content.json` + `meta/checkout-manifest.json` so Offline UFC Reader continues to import the pack as a read pack without format changes. Editor requires the manifest; if missing, treat as read-only import (no locks → no edits).

### 1.4 Proposal pack (SME → CMS)

**ZIP layout (v0)**

```text
proposal-pack.zip
├── proposal.json             # format ufc-offline-proposal-pack
├── content.json              # recommended (v0 default): base snapshot (same shape as reader)
└── media/                    # optional: only blobs referenced by changes (add/replace IMAGE)
    └── ces/.../images/new.png
```

**`proposal.json` (v0)**

```json
{
  "format": "ufc-offline-proposal-pack",
  "formatVersion": 1,
  "proposalId": "prop-8f3c2a1b-…",
  "createdAt": "2026-09-21T18:30:00-07:00",
  "updatedAt": "2026-09-21T18:30:00-07:00",
  "baseVersionId": "a093a449-9220-45e0-866a-67d3139af067",
  "designation": "UFC 1-200-01",
  "marking": null,
  "author": {
    "id": "sme-uuid-or-cms-user-id",
    "displayName": "J. Smith",
    "email": "j.smith@example.mil"
  },
  "checkout": {
    "assigneeId": "sme-uuid-or-cms-user-id",
    "lockSectionIds": [
      "5730e874-909d-4c1c-9ed2-4bc1fed3ac8e"
    ],
    "lockExpiresAt": "2026-10-21T16:00:00-07:00"
  },
  "contentPath": "content.json",
  "changes": [
    {
      "changeId": "chg-1",
      "target": {
        "sectionId": "5730e874-909d-4c1c-9ed2-4bc1fed3ac8e",
        "granularity": "section"
      },
      "before": {
        "contentHash": "sha256:…",
        "snippet": "Optional short plain-text excerpt of prior section body for CMS review UI"
      },
      "after": {
        "section": { "id": "5730e874-909d-4c1c-9ed2-4bc1fed3ac8e", "type": "CHAPTER", "heading": "…", "children": [] }
      },
      "rationale": "Align threshold language with UFC 3-xxx cross-ref.",
      "author": {
        "id": "sme-uuid-or-cms-user-id",
        "displayName": "J. Smith"
      },
      "createdAt": "2026-09-21T18:10:00-07:00",
      "updatedAt": "2026-09-21T18:25:00-07:00"
    }
  ],
  "media": []
}
```

**`changes[]` fields**

| Field | Required | Notes |
|-------|----------|-------|
| `changeId` | yes | Stable within the proposal; CMS partial-accept addresses by `changeId` |
| `target.sectionId` | yes | Must be in the SME’s lock set |
| `target.granularity` | yes | **v1 / v0: `"section"` only** (full section replace). Paragraph/sentence targeting deferred |
| `before.contentHash` | yes | Hash of the **base** section subtree (canonical JSON) at checkout time — CMS rejects if base moved |
| `before.snippet` | no | Human review aid |
| `after.section` | yes (v1) | Full replacement section node using the **same** CIM field names as reader (`id`, `type`, `heading`, `children`, `sentences`, `mediaAsset`, …) |
| `rationale` | yes | Per-change rationale (tracked-change semantics); editor must require non-empty |
| `author` | yes | May equal pack-level author; retained per change for multi-pass edits |
| `createdAt` / `updatedAt` | yes | ISO-8601 |

**Tracked changes model (v1):** one change record = one locked section’s full subtree replacement + rationale. Diff UI (CMS or editor) derives from `before` hash/snippet vs `after.section`. No separate inline mark-up stream in v1.

**`media[]` (schema present in v0):** Prefer `op`: `add` | `replace` | `delete` with `path`, optional `packPath`, optional `contentHash`. Text-first UX is OK for the spike; media ops may be unused in the editor UI while remaining valid in the schema. Same `media/<relativePath>` layout as reader when blobs are included.

**Relation to reader packs:** Embedded `content.json` is the same `{criterion, sections, metadataFields}` (or wrapper) the reader already understands. Proposal payloads live only in `proposal.json`. Reader must not treat `proposal.json` as content; editor/CMS look for `format: "ufc-offline-proposal-pack"`.

### 1.5 Hashing (v0 normative — project rule until CIM defines one)

CIM does not yet define a shared canonicalization for section subtrees. Until it does, this contract is normative for editor + CMS agreement:

1. Algorithm: **SHA-256**, hex digest prefixed `sha256:`.
2. Input: the section subtree object as stored under `content.json` (the node whose `id` equals `target.sectionId`, including nested `children`).
3. Canonical JSON (UTF-8):
   - Recursively sort object keys lexicographically (Unicode code point order).
   - Arrays keep element order (do not sort arrays).
   - Emit compact JSON: no insignificant whitespace; use JSON number/string/boolean/null encoding as in `JSON.stringify` after key sort.
   - Do not transform string contents; preserve CIM field values as-is.
4. Used to detect “base version moved” / concurrent CMS edits under the same `sectionId`.

Reference implementation: editor `src/hash.js` (and any future shared package).

---

## 2. CMS contract

### 2.1 Ownership

| Concern | Owner | Editor role |
|---------|-------|-------------|
| Published UFC version authority | **CMS** | None — proposals only |
| Creating lock sets / assignees | **CMS** | Enforces lock set from checkout pack; does not mint new locks |
| Unlock after merge or abandon | **CMS** | May show lock status from pack; cannot unlock server-side |
| Accept / reject / partial accept | **CMS** | Exports proposal pack; does not apply to published store |
| Pack bytes on SME disk | **SME / Editor** | Import checkout, export proposal |
| Reader notes / CCR link-out | **Reader** | Out of scope for editor |

### 2.2 CMS → SME: export checkout pack

1. CMS selects UFC `versionId` (published or working base — product choice stays with CMS).
2. CMS assigns **disjoint** `locks[]` section id sets to one or more SMEs.
3. CMS writes checkout ZIP per SME: `content.json` (+ `media/`) + `meta/checkout-manifest.json` (§1.3). **One UFC per ZIP.**
4. Handoff is offline (fileshare, encrypted media, etc.). No live API required on the SME laptop.

### 2.3 SME → CMS: import proposal

1. CMS receives `ufc-offline-proposal-pack` ZIP (`format` must be exactly that string — no `ufc-proposal/1` alias).
2. Validate `format` / `formatVersion`, `baseVersionId`, author, and that every `changes[].target.sectionId` was locked to that assignee at export time (CMS lock ledger is source of truth).
3. **Reject entire proposal** if:
   - `baseVersionId` is no longer the CMS base for those sections (version moved / superseded), **or**
   - any referenced lock is **expired** on the CMS ledger (when expiry is in use), **or**
   - `before.contentHash` does not match current CMS section hash, **or**
   - a change targets a section not locked to this author.
4. Otherwise present for review (PR analogy — §3).

### 2.4 Accept / reject / partial accept

| Decision | CMS behavior | Lock behavior |
|----------|--------------|---------------|
| **Accept all** | Apply all `changes[]` to working/published pipeline per CMS rules; record proposal id / authors / rationales in audit | Unlock accepted section ids for that assignee (or hold until publish — CMS policy) |
| **Reject all** | No content apply; store rejection reason | Unlock or keep locked for rework — CMS policy |
| **Partial accept** | Apply subset of `changeId`s; reject the rest with per-change reasons | Unlock accepted ids; keep or unlock rejected ids per policy |

**v0:** Packs **must** support per-`changeId` addressing so CMS can partial-accept. A decision pack returned to the SME is **optional later** (not required for v0 scaffold):

```json
{
  "format": "ufc-offline-proposal-decision",
  "formatVersion": 1,
  "proposalId": "prop-8f3c2a1b-…",
  "decidedAt": "2026-09-22T09:00:00-07:00",
  "results": [
    { "changeId": "chg-1", "decision": "accept" },
    { "changeId": "chg-2", "decision": "reject", "reason": "Conflicts with legal review" }
  ]
}
```

### 2.5 Unlock rules (summary)

- Locks are **created and released by CMS**.
- Editor only **reads** locks from checkout and refuses edits outside the set.
- On successful accept of a section change, CMS should release that section’s lock (default recommendation).
- Expired locks: CMS **hard-rejects** inbound proposals that cite them; editor **soft-warns** if `expiresAt` is in the past while offline (best-effort clock).

---

## 3. Multi-SME workflow

### 3.1 Happy path (two SMEs, one UFC)

1. **CMS** freezes base `versionId` V for UFC X and partitions sections: SME-A locks `{S1, S2}`, SME-B locks `{S3, S4}` (disjoint).
2. **CMS** exports checkout pack A and checkout pack B (same `content.json`, different `locks[]`).
3. **SME-A** imports pack A in Offline UFC Editor; edits only S1/S2 with tracked full-section changes + rationale; exports proposal pack A.
4. **SME-B** likewise for S3/S4 → proposal pack B.
5. **CMS** imports both proposals. Because lock sets were disjoint and `before.contentHash` matches V, both can be reviewed like **two PRs against the same base branch**.
6. CMS merges (accept) in any order; resulting published/working version W contains both section sets. Locks released.

```text
Base V ──┬── checkout A (locks S1,S2) ── proposal A ──┐
         │                                              ├── CMS merge → W
         └── checkout B (locks S3,S4) ── proposal B ──┘
```

### 3.2 Conflicts that must not happen if locks hold

| Case | If locks held | If locks violated / ignored |
|------|---------------|-----------------------------|
| Both SMEs edit same `sectionId` | Impossible: CMS never issues overlapping locks | CMS must reject second lock or reject proposal |
| Proposal targets unlocked section | Editor blocks; CMS rejects | Treat as hard error |
| Base moves under a locked section while SME offline | Detected via `baseVersionId` / `before.contentHash` mismatch on import | SME re-checkouts |
| Two proposals touch different sections | Merge is mechanical union of section replacements | N/A |

### 3.3 What CMS merge looks like (PR analogy)

| Git / PR concept | UFC editor / CMS |
|------------------|------------------|
| Base commit | `baseVersionId` (+ per-section content hashes) |
| Branch | SME checkout with lock set |
| Commits / PR diff | `changes[]` (section replacements + rationales) |
| Reviewers | CMS editors / criteria owners |
| Merge | Accept (full or partial) into CMS working tree |
| Close without merge | Reject |
| Protected paths | `locks[]` — only assignee may propose |

Multi-SME merge is **section-scoped**, not line-scoped, in v1. Ordering of accepts should not matter when section ids are disjoint; if CMS later allows overlapping locks, that is a new contract version.

---

## 4. Defaults applied (Nic may override later)

Greenlit 2026-09-21 (PT). These are **normative for contract v0** unless Nic overrides:

| # | Topic | v0 default |
|---|-------|------------|
| 1 | **Authorship** | CMS user id + `displayName` / `email` from checkout pack; free-text override offline allowed with warning |
| 2 | **Lock expiry** | Emit `expiresAt` when CMS has one; missing = no expiry; CMS hard-rejects expired; editor soft-warns if past |
| 3 | **Granularity** | **Full section only** (`"section"`) |
| 4 | **Media** | Include `media[]` ops in schema; text-first UX OK for spike |
| 5 | **Partial accept** | Support per-`changeId`; decision pack optional later |
| 6 | **Shared types** | Docs + JSON Schema stubs in **this editor repo** first; shared package later |
| 7 | **Canonical hash** | Project rule in §1.5 until CIM defines one |
| 8 | **Checkout ZIP layout** | `content.json` + `meta/checkout-manifest.json` |
| 9 | **Embedded `content.json` in proposals** | **Recommended** (v0 editor always embeds) |
| 10 | **Alias** | Drop `ufc-proposal/1` — prefer `ufc-offline-proposal-pack` only |
| 11 | **Workspace / multi-UFC checkout** | **One UFC per checkout ZIP** for v1 |
| 12 | **Classification / CUI** | Optional `marking` string on manifests for banner later |

---

## 5. Shared schemas (editor repo first)

Minimal JSON Schema stubs live under `schemas/` in this repo:

- `schemas/checkout-manifest.schema.json`
- `schemas/proposal.schema.json`

These document the on-disk shapes for CMS implementers. A shared npm/TS package may follow after CMS alignment.

---

## Appendix A — Quick reference: pack comparison

| | Read pack | Checkout pack | Proposal pack |
|--|-----------|---------------|---------------|
| `format` | (reader export message / none) | `ufc-offline-checkout-pack` | `ufc-offline-proposal-pack` |
| Primary JSON | `content.json` | `content.json` + `meta/checkout-manifest.json` | `proposal.json` (+ recommended `content.json`) |
| `locks[]` | no | yes | echoed under `checkout` for audit |
| `changes[]` | no | no | yes |
| `media[]` | no | no | yes (may be `[]`) |
| `marking` | no | optional | optional |
| Reader imports? | yes | yes for `content.json` (manifest under `meta/`) | **no** as authority; ignore `proposal.json` |
| Editor | base for view | **import** | **export** |
| CMS | export source | **export** | **import** |

## Appendix B — Separation from Reader notes and CCR

| Artifact | App | Sync / authority |
|----------|-----|------------------|
| Local notes | Offline UFC Reader | Device-private; do not sync; not CCR |
| CCR | Live digital.wbdg.org (link-out from Reader) | Formal change request on first-party site |
| Proposal pack | Offline UFC Editor | Offline proposal for **CMS merge**; not published until CMS accepts |

Do not reuse notes export JSON as a proposal. Do not teach the Reader to open proposals as editable authority.

---

*End of pack contract v0 (frozen / greenlit 2026-09-21 PT). Scaffold proceeds under this contract.*
