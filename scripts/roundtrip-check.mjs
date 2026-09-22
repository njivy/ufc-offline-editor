#!/usr/bin/env node
import fs from 'node:fs';
import JSZip from 'jszip';
import {
  importCheckoutPack,
  buildProposalPack,
} from '../src/pack.js';
import {
  applyDraftToRoot,
  draftFromSection,
  findSectionById,
  uid,
  nowIso,
} from '../src/content.js';
import { hashSection } from '../src/hash.js';

function assert(value, message) {
  if (!value) throw new Error(`Assertion failed: ${message}`);
}

const path = new URL('../public/fixtures/sample-checkout.zip', import.meta.url);
const bytes = fs.readFileSync(path);
const file = new File([bytes], 'sample-checkout.zip', { type: 'application/zip' });
const imported = await importCheckoutPack(file);

const tableId = 'eb262894-f406-4b6c-905c-1bd602a27265';
const sentenceId = 'e561eeb7-68da-49a6-a711-20f2b0fab281';
const commentaryId = 'cc629512-43f5-4990-9b50-d981a592ba21';
const ids = [tableId, sentenceId, commentaryId];
const changes = new Map();

for (const id of ids) {
  const base = findSectionById(imported.content.sections, id);
  assert(base, `fixture has ${id}`);
  assert(imported.lockedIds.has(id), `${id} is locked`);
  const draft = draftFromSection(base);
  if (id === tableId) {
    assert(base.mediaAsset?.type === 'TABLE', 'table mediaAsset present');
    const keysBefore = Object.keys(base.mediaAsset).sort().join('|');
    draft.mediaAsset.caption = `${draft.mediaAsset.caption} (reviewed)`;
    draft.mediaAsset.altText = 'Accessible table summary';
    draft.mediaAsset.content = `${draft.mediaAsset.content}<p data-editor-check="true">reviewed</p>`;
    const after = applyDraftToRoot(base, id, draft);
    assert(Object.keys(after.mediaAsset).sort().join('|') === keysBefore, 'table media keys preserved');
    changes.set(id, { afterSection: after, rationale: 'Verify table HTML, caption, and alt edits.', changeId: uid('chg'), createdAt: nowIso(), beforeHash: await hashSection(base) });
  } else if (id === sentenceId) {
    assert(base.sentences?.length > 1, 'multi-sentence fixture present');
    const firstId = base.sentences[0].id;
    const paragraphId = base.sentences[0].formatting?.paragraphId;
    draft.sentences[0].text += ' [reviewed]';
    draft.sentences[0].alignment = 'center';
    draft.sentences[0].isBullet = true;
    draft.sentences[0].listType = 'bullet';
    draft.sentences[0].indentLevel = 2;
    const after = applyDraftToRoot(base, id, draft);
    assert(after.sentences[0].id === firstId, 'sentence id preserved');
    assert(after.sentences[0].formatting.paragraphId === paragraphId, 'uncontrolled formatting preserved');
    assert(after.sentences.length === base.sentences.length, 'all sentences preserved');
    changes.set(id, { afterSection: after, rationale: 'Verify sentence text and formatting edits.', changeId: uid('chg'), createdAt: nowIso(), beforeHash: await hashSection(base) });
  } else {
    assert(base.commentary?.length, 'commentary fixture present');
    const commentaryIdBefore = base.commentary[0].id;
    draft.commentary[0].heading += ' (reviewed)';
    draft.commentary[0].content += ' Reviewed offline.';
    const after = applyDraftToRoot(base, id, draft);
    assert(after.commentary[0].id === commentaryIdBefore, 'commentary id preserved');
    changes.set(id, { afterSection: after, rationale: 'Verify commentary editing.', changeId: uid('chg'), createdAt: nowIso(), beforeHash: await hashSection(base) });
  }
}

const { blob, proposal } = await buildProposalPack({
  content: imported.content,
  rawContent: imported.rawContent,
  manifest: imported.manifest,
  changesBySectionId: changes,
  author: imported.manifest.assignee,
});
const out = new Uint8Array(await blob.arrayBuffer());
const zip = await JSZip.loadAsync(out);
assert(proposal.format === 'ufc-offline-proposal-pack', 'proposal format');
assert(proposal.formatVersion === 1, 'proposal formatVersion');
assert(proposal.changes.length === 3, 'three changes exported');
assert(zip.file('proposal.json'), 'proposal.json embedded');
assert(zip.file('content.json'), 'content.json embedded');
for (const c of proposal.changes) assert(c.rationale?.trim(), `${c.changeId} has rationale`);

// IMAGE fixture import and blob path check.
const imgBytes = fs.readFileSync(new URL('../public/fixtures/sample-checkout-image.zip', import.meta.url));
const imgFile = new File([imgBytes], 'sample-checkout-image.zip', { type: 'application/zip' });
const imgImported = await importCheckoutPack(imgFile);
const img = findSectionById(imgImported.content.sections, 'sec-demo-img-present');
assert(img?.mediaAsset?.type === 'IMAGE', 'image mediaAsset present');
assert(imgImported.lockedIds.has('sec-demo-img-present'), 'image section locked');
assert(imgImported.mediaBlobs?.has('demo/images/sample-figure.png'), 'image blob imported under stable path');

console.log(JSON.stringify({
  ok: true,
  versionId: proposal.baseVersionId,
  changes: proposal.changes.map((c) => ({ sectionId: c.target.sectionId, rationale: c.rationale })),
  entries: Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort(),
  imagePath: img.mediaAsset.sourcePath,
}, null, 2));
