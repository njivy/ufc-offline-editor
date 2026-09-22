#!/usr/bin/env node
/**
 * WYSIWYG serialize ↔ parse round-trip (linkedom) + pack round-trip still green via separate script.
 */
import fs from 'node:fs';
import { parseHTML } from 'linkedom';
import JSZip from 'jszip';
import { importCheckoutPack } from '../src/pack.js';
import {
  applyDraftToRoot,
  draftFromSection,
  findSectionById,
} from '../src/content.js';
import {
  renderWysiwygHtml,
  parseWysiwygDom,
  renderWysiwygFromDraft,
  groupSentences,
} from '../src/wysiwyg.js';

function assert(value, message) {
  if (!value) throw new Error(`Assertion failed: ${message}`);
}

function domFromHtml(html) {
  const { document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  return { document, root: wrap.querySelector('[data-wysiwyg]') || wrap.firstElementChild };
}

const path = new URL('../public/fixtures/sample-checkout.zip', import.meta.url);
const bytes = fs.readFileSync(path);
const file = new File([bytes], 'sample-checkout.zip', { type: 'application/zip' });
const imported = await importCheckoutPack(file);

const sentenceId = 'e561eeb7-68da-49a6-a711-20f2b0fab281';
const tableId = 'eb262894-f406-4b6c-905c-1bd602a27265';
const commentaryId = 'cc629512-43f5-4990-9b50-d981a592ba21';

// --- Sentence TEXT: ids survive text + bullet toggle ---
{
  const base = findSectionById(imported.content.sections, sentenceId);
  assert(base, 'sentence section');
  const draft0 = draftFromSection(base);
  const firstId = draft0.sentences[0].id;
  const paragraphId = base.sentences[0].formatting?.paragraphId;
  assert(firstId, 'first sentence id');

  const html = renderWysiwygFromDraft(base, draft0, { editable: true });
  assert(html.includes(`data-sentence-id="${firstId}"`), 'render emits sentence id');
  assert(/<ul[\s>]/.test(html), 'fixture bullets render as list');

  const { root, document } = domFromHtml(html);
  const host = root.querySelector(`[data-sentence-id="${firstId}"]`);
  assert(host, 'host in DOM');
  host.textContent = `${draft0.sentences[0].text} [wysiwyg]`;

  // Toggle a Normal sentence into a bullet via DOM: find a non-li sentence if first is p
  // First sentence is Normal — convert to bullet list item structure
  if (host.tagName === 'P') {
    const ul = document.createElement('ul');
    ul.className = 'wysiwyg-list';
    const li = document.createElement('li');
    li.setAttribute('data-sentence-id', firstId);
    li.setAttribute('data-indent', '0');
    li.setAttribute('contenteditable', 'true');
    li.textContent = host.textContent;
    ul.appendChild(li);
    host.replaceWith(ul);
  } else {
    // already li — leave as bullet and bump indent
    host.setAttribute('data-indent', '2');
  }

  const parsed = parseWysiwygDom(root, draft0);
  assert(parsed.sentences[0].id === firstId, 'sentence id survives parse');
  assert(parsed.sentences[0].text.includes('[wysiwyg]'), 'text edit survives');
  assert(parsed.sentences[0].isBullet === true, 'bullet toggle survives');
  assert(parsed.sentences.length === draft0.sentences.length, 'sentence count preserved');

  const after = applyDraftToRoot(base, sentenceId, parsed);
  assert(after.sentences[0].id === firstId, 'apply preserves id');
  assert(after.sentences[0].formatting.paragraphId === paragraphId, 'paragraphId preserved');
  assert(after.sentences[0].formatting.isBullet === true, 'isBullet applied');
}

// --- TABLE: cell text + caption round-trip ---
{
  const base = findSectionById(imported.content.sections, tableId);
  assert(base?.mediaAsset?.type === 'TABLE', 'table section');
  const draft0 = draftFromSection(base);
  const html = renderWysiwygFromDraft(base, draft0, { editable: true });
  assert(html.includes('data-media-type="TABLE"'), 'table figure');
  assert(html.includes('contenteditable="true"'), 'editable cells');

  const { root } = domFromHtml(html);
  const cap = root.querySelector('[data-field="caption"]');
  assert(cap, 'caption');
  cap.textContent = `${draft0.mediaAsset.caption} (wysiwyg)`;
  const td = root.querySelector('td');
  assert(td, 'table cell');
  const beforeCell = td.textContent;
  td.textContent = `${beforeCell} *`;

  const parsed = parseWysiwygDom(root, draft0);
  assert(parsed.mediaAsset.caption.includes('(wysiwyg)'), 'caption edit');
  assert(parsed.mediaAsset.content.includes('*'), 'cell text in content HTML');
  // contenteditable attrs should be stripped from serialized content
  assert(!/contenteditable/i.test(parsed.mediaAsset.content), 'no contenteditable leak');

  const after = applyDraftToRoot(base, tableId, parsed);
  assert(after.mediaAsset.caption.includes('(wysiwyg)'), 'caption applied');
  assert(after.id === base.id, 'section id preserved');
}

// --- Commentary callout ---
{
  const base = findSectionById(imported.content.sections, commentaryId);
  assert(base?.commentary?.length, 'commentary section');
  const commentaryIdBefore = base.commentary[0].id;
  const draft0 = draftFromSection(base);
  const html = renderWysiwygFromDraft(base, draft0, { editable: true });
  assert(html.includes('data-note-kind="commentary"'), 'commentary callout');

  const { root } = domFromHtml(html);
  const heading = root.querySelector('[data-note-kind="commentary"] [data-note-field="heading"]');
  const content = root.querySelector('[data-note-kind="commentary"] [data-note-field="content"]');
  heading.textContent = 'Reviewed heading';
  content.textContent = 'Reviewed offline commentary.';

  const parsed = parseWysiwygDom(root, draft0);
  assert(parsed.commentary[0].heading === 'Reviewed heading', 'commentary heading');
  assert(parsed.commentary[0].content.includes('Reviewed offline'), 'commentary content');

  const after = applyDraftToRoot(base, commentaryId, parsed);
  assert(after.commentary[0].id === commentaryIdBefore, 'commentary id preserved');
}

// --- Readonly render has no contenteditable ---
{
  const base = findSectionById(imported.content.sections, sentenceId);
  const html = renderWysiwygHtml(base, { editable: false });
  assert(!/contenteditable="true"/i.test(html), 'readonly has no contenteditable');
}

// --- groupSentences helper ---
{
  const groups = groupSentences([
    { id: 'a', text: 'x', isBullet: false, paragraphType: 'Normal' },
    { id: 'b', text: 'y', isBullet: true, paragraphType: 'List Bullet' },
    { id: 'c', text: 'z', isBullet: true, paragraphType: 'List Bullet' },
    { id: 'd', text: 'w', isBullet: false, paragraphType: 'Normal' },
  ]);
  assert(groups.length === 3, 'three groups');
  assert(groups[1].kind === 'ul' && groups[1].items.length === 2, 'bullet run');
}

// --- IMAGE caption/alt (image fixture) ---
{
  const imgBytes = fs.readFileSync(new URL('../public/fixtures/sample-checkout-image.zip', import.meta.url));
  const imgFile = new File([imgBytes], 'sample-checkout-image.zip', { type: 'application/zip' });
  const imgImported = await importCheckoutPack(imgFile);
  const img = findSectionById(imgImported.content.sections, 'sec-demo-img-present');
  assert(img?.mediaAsset?.type === 'IMAGE', 'image section');
  const draft0 = draftFromSection(img);
  const mediaUrls = new Map();
  // Simulate resolved blob path
  mediaUrls.set('demo/images/sample-figure.png', 'blob:test');
  const html = renderWysiwygFromDraft(img, draft0, { mediaUrls, editable: true });
  assert(html.includes('blob:test') || html.includes('Image not in pack') || html.includes('wysiwyg-image'), 'image figure');
  const { root } = domFromHtml(html);
  const cap = root.querySelector('[data-field="caption"]');
  const alt = root.querySelector('[data-field="altText"]');
  if (cap) cap.textContent = 'Caption edited';
  if (alt) alt.textContent = 'Alt edited';
  const parsed = parseWysiwygDom(root, draft0);
  assert(parsed.mediaAsset.caption === 'Caption edited', 'image caption');
  assert(parsed.mediaAsset.altText === 'Alt edited', 'image alt');
}

console.log(JSON.stringify({
  ok: true,
  checks: [
    'sentence-id-text-bullet',
    'table-cell-caption',
    'commentary-callout',
    'readonly-no-ce',
    'groupSentences',
    'image-caption-alt',
  ],
}, null, 2));
