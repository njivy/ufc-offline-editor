/**
 * Structured contenteditable WYSIWYG for Offline UFC Editor.
 * Round-trips CIM section draft fields without TipTap.
 */

import {
  escapeHtml,
  normalizeMediaPath,
  resolveMediaUrl,
  draftFromSection,
} from './content.js';

/** Light sanitize for trusted CIM HTML snippets (no DOM required). */
export function lightSanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<\/?(?:script|iframe|object|embed|link|meta)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/\shref\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, ' href="#"');
}

function ceAttr(editable) {
  return editable ? ' contenteditable="true"' : '';
}

function isBulletSentence(s) {
  if (!s) return false;
  if (s.isBullet) return true;
  const pt = String(s.paragraphType || '');
  if (/list\s*bullet/i.test(pt)) return true;
  const lt = String(s.listType || '').toLowerCase();
  return lt === 'bullet' || lt === 'ul' || lt === 'unordered';
}

function indentOf(s) {
  const n = Number(s?.indentLevel);
  return Number.isFinite(n) && n > 0 ? Math.min(8, Math.floor(n)) : 0;
}

function alignStyle(alignment) {
  const a = String(alignment || '').toLowerCase();
  if (!a || a === 'left') return '';
  if (['center', 'right', 'justify'].includes(a)) return ` style="text-align:${a}"`;
  return '';
}

function alignData(alignment) {
  const a = String(alignment || '').toLowerCase();
  return a ? ` data-align="${escapeHtml(a)}"` : '';
}

function contentDuplicatesTitle(content, heading, label) {
  const t = String(content || '').trim();
  if (!t) return true;
  if (heading && t === String(heading).trim()) return true;
  if (label && t === String(label).trim()) return true;
  return false;
}

/**
 * Group consecutive sentences into paragraph / list runs.
 * @returns {Array<{kind:'p'|'ul', items: object[]}>}
 */
export function groupSentences(sentences) {
  const groups = [];
  for (const s of sentences || []) {
    if (isBulletSentence(s)) {
      const last = groups[groups.length - 1];
      if (last?.kind === 'ul') last.items.push(s);
      else groups.push({ kind: 'ul', items: [s] });
    } else {
      groups.push({ kind: 'p', items: [s] });
    }
  }
  return groups;
}

/**
 * Emit nested &lt;ul&gt;/&lt;li&gt; reflecting indentLevel (0-based).
 */
export function renderBulletListHtml(items, editable) {
  if (!items?.length) return '';

  const root = { children: [], indent: -1 };
  const stack = [root];

  for (const s of items) {
    const ind = indentOf(s);
    while (stack.length > 1 && stack[stack.length - 1].indent >= ind) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    const node = { sentence: s, indent: ind, children: [] };
    parent.children.push(node);
    stack.push(node);
  }

  function renderNodes(nodes) {
    if (!nodes.length) return '';
    const lis = nodes
      .map((n) => {
        const s = n.sentence;
        const nested = n.children.length ? renderNodes(n.children) : '';
        return `<li data-sentence-id="${escapeHtml(s.id)}" data-indent="${indentOf(s)}"${alignData(s.alignment)}${alignStyle(s.alignment)}${ceAttr(editable)}>${escapeHtml(s.text || '')}${nested}</li>`;
      })
      .join('');
    return `<ul class="wysiwyg-list">${lis}</ul>`;
  }

  return renderNodes(root.children);
}

function renderSentencesHtml(sentences, editable) {
  const groups = groupSentences(sentences);
  return groups
    .map((g) => {
      if (g.kind === 'ul') return renderBulletListHtml(g.items, editable);
      const s = g.items[0];
      return `<p class="wysiwyg-p" data-sentence-id="${escapeHtml(s.id)}" data-indent="${indentOf(s)}"${alignData(s.alignment)}${alignStyle(s.alignment)}${ceAttr(editable)}>${escapeHtml(s.text || '')}</p>`;
    })
    .join('');
}

function renderNotesHtml(kind, items, editable) {
  if (!items?.length) return '';
  return items
    .map((item, i) => {
      const heading = `<div class="wysiwyg-callout-heading" data-note-field="heading"${ceAttr(editable)}>${escapeHtml(item.heading || '')}</div>`;
      const raw = item.content || '';
      const looksHtml = /<[a-z][\s\S]*>/i.test(raw);
      const bodyInner = looksHtml ? lightSanitizeHtml(raw) : escapeHtml(raw);
      const content = `<div class="wysiwyg-callout-content" data-note-field="content"${ceAttr(editable)}>${bodyInner}</div>`;
      return `<aside class="wysiwyg-callout wysiwyg-${escapeHtml(kind)}" data-note-kind="${escapeHtml(kind)}" data-note-idx="${i}">
        <div class="wysiwyg-callout-label">${escapeHtml(kind)}</div>
        ${heading}
        ${content}
      </aside>`;
    })
    .join('');
}

function makeTableCellsEditable(html, editable) {
  const clean = lightSanitizeHtml(html);
  if (!editable) return clean;
  return clean.replace(/<(td|th)(\s[^>]*?)?>/gi, (match, tag, attrs = '') => {
    if (/\bcontenteditable\s*=/i.test(attrs || '')) return match;
    return `<${tag}${attrs || ''} contenteditable="true">`;
  });
}

function renderMediaHtml(media, mediaUrls, editable) {
  if (!media || typeof media !== 'object') return '';
  const type = String(media.type || '').toUpperCase();
  if (type === 'TABLE') {
    const cap = `<figcaption class="wysiwyg-caption" data-field="caption"${ceAttr(editable)}>${escapeHtml(media.caption || '')}</figcaption>`;
    const alt = `<p class="wysiwyg-alt" data-field="altText"${ceAttr(editable)}>${escapeHtml(media.altText || '')}</p>`;
    const table = makeTableCellsEditable(media.content || '', editable);
    return `<figure class="wysiwyg-media wysiwyg-table" data-media-type="TABLE">
      ${cap}
      <div class="wysiwyg-table-wrap" data-field="media-content">${table || '<p class="muted">No table HTML</p>'}</div>
      ${alt}
    </figure>`;
  }
  if (type === 'IMAGE') {
    const path = normalizeMediaPath(media.url || media.sourcePath || '');
    const url = resolveMediaUrl(mediaUrls, media.url || media.sourcePath || '');
    const altText = media.altText || media.caption || 'Image';
    const cap = `<figcaption class="wysiwyg-caption" data-field="caption"${ceAttr(editable)}>${escapeHtml(media.caption || '')}</figcaption>`;
    const alt = `<p class="wysiwyg-alt" data-field="altText"${ceAttr(editable)}>${escapeHtml(media.altText || '')}</p>`;
    let body;
    if (url) {
      body = `<img src="${escapeHtml(url)}" alt="${escapeHtml(altText)}" />`;
    } else {
      body = `<div class="media-placeholder"><p class="media-missing-msg">Image not in pack</p>${
        path ? `<p class="muted media-path"><code>${escapeHtml(path)}</code></p>` : ''
      }</div>`;
    }
    return `<figure class="wysiwyg-media wysiwyg-image" data-media-type="IMAGE">
      ${cap}
      ${body}
      ${alt}
      ${path ? `<p class="muted media-path"><code>${escapeHtml(path)}</code></p>` : ''}
    </figure>`;
  }
  return '';
}

/**
 * Produce document-like HTML for a CIM section (or draft-applied view).
 * @param {object} section CIM section node
 * @param {{ mediaUrls?: Map|null, editable?: boolean }} opts
 */
export function renderWysiwygHtml(section, opts = {}) {
  const editable = !!opts.editable;
  const mediaUrls = opts.mediaUrls || null;
  if (!section) {
    return `<article class="wysiwyg-doc empty"><p class="muted">No section selected.</p></article>`;
  }

  const label = section.label != null ? String(section.label) : '';
  const heading = section.heading != null ? String(section.heading) : '';
  const hasTitle = !!(label || heading);

  let titleHtml = '';
  if (hasTitle || editable) {
    titleHtml = `<header class="wysiwyg-title">
      <span class="wysiwyg-label" data-field="label"${ceAttr(editable)}>${escapeHtml(label)}</span>
      <h2 class="wysiwyg-heading" data-field="heading"${ceAttr(editable)}>${escapeHtml(heading)}</h2>
    </header>`;
  }

  let contentHtml = '';
  if (typeof section.content === 'string') {
    const hideDup = contentDuplicatesTitle(section.content, heading, label) && !editable;
    if (!hideDup) {
      contentHtml = `<p class="wysiwyg-content" data-field="content"${ceAttr(editable)}>${escapeHtml(section.content)}</p>`;
    }
  }

  // Prefer already-flattened draft sentences when present.
  let sentences;
  if (
    Array.isArray(section.sentences) &&
    section.sentences.length &&
    section.sentences[0] &&
    Object.prototype.hasOwnProperty.call(section.sentences[0], 'paragraphType')
  ) {
    sentences = section.sentences;
  } else {
    sentences = draftFromSection(section).sentences;
  }

  const commentaryItems = Array.isArray(section.commentary)
    ? section.commentary.map((c) => ({ heading: c?.heading || '', content: c?.content || '' }))
    : [];
  const explanationItems = Array.isArray(section.explanation)
    ? section.explanation.map((c) => ({ heading: c?.heading || '', content: c?.content || '' }))
    : [];

  return `<article class="wysiwyg-doc" data-wysiwyg="1" data-editable="${editable ? '1' : '0'}">
    ${titleHtml}
    <div class="wysiwyg-body">
      ${contentHtml}
      ${renderSentencesHtml(sentences, editable)}
      ${renderNotesHtml('commentary', commentaryItems, editable)}
      ${renderNotesHtml('explanation', explanationItems, editable)}
      ${renderMediaHtml(section.mediaAsset, mediaUrls, editable)}
    </div>
  </article>`;
}

function textOf(el) {
  if (!el) return '';
  return (el.textContent || '').replace(/\u00a0/g, ' ').trimEnd();
}

function plainTextPrefer(el) {
  if (!el) return '';
  // Prefer textContent so nested list markup inside li does not pollute sentence text.
  // For callout content that held HTML, callers may use innerHTML intentionally.
  const clone = el.cloneNode(true);
  clone.querySelectorAll('ul, ol').forEach((n) => n.remove());
  return (clone.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+\n/g, '\n').trim();
}

function listDepth(el, root) {
  let depth = 0;
  let n = el.parentElement;
  while (n && n !== root) {
    if (n.tagName === 'UL' || n.tagName === 'OL') depth += 1;
    n = n.parentElement;
  }
  return Math.max(0, depth - 1);
}

function readAlignment(el) {
  const data = (el.getAttribute('data-align') || '').toLowerCase();
  if (data) return data;
  const style = (el.getAttribute('style') || '').toLowerCase();
  const m = style.match(/text-align\s*:\s*(left|center|right|justify)/);
  if (m) return m[1];
  return '';
}

/**
 * Parse a rendered WYSIWYG root back into a draft compatible with applyDraftToRoot.
 * Merges formatting onto baseSection / baseDraft so paragraphId and extras survive.
 *
 * @param {Element} rootEl article.wysiwyg-doc or wrapper containing it
 * @param {object} baseSection CIM section OR draft-shaped object (for id merge)
 */
function isDraftShape(obj) {
  if (!obj || typeof obj !== 'object') return false;
  // Draft sentences carry paragraphType at top level; CIM sentences use formatting.
  if (Array.isArray(obj.sentences) && obj.sentences[0]) {
    const s0 = obj.sentences[0];
    if (Object.prototype.hasOwnProperty.call(s0, 'paragraphType') && !s0.formatting) return true;
  }
  // Empty draft / media-only draft
  if (
    Object.prototype.hasOwnProperty.call(obj, 'heading') &&
    Object.prototype.hasOwnProperty.call(obj, 'sentences') &&
    !Object.prototype.hasOwnProperty.call(obj, 'type') &&
    !Object.prototype.hasOwnProperty.call(obj, 'children')
  ) {
    return true;
  }
  return false;
}

export function parseWysiwygDom(rootEl, baseSection) {
  let draft;
  if (isDraftShape(baseSection)) {
    draft = {
      heading: baseSection.heading || '',
      label: baseSection.label || '',
      content: baseSection.content ?? null,
      sentences: (baseSection.sentences || []).map((s) => ({ ...s })),
      commentary: (baseSection.commentary || []).map((c) => ({ ...c })),
      explanation: (baseSection.explanation || []).map((c) => ({ ...c })),
      mediaAsset: baseSection.mediaAsset ? { ...baseSection.mediaAsset } : null,
    };
  } else {
    draft = draftFromSection(baseSection);
  }

  const root = rootEl?.matches?.('[data-wysiwyg]')
    ? rootEl
    : rootEl?.querySelector?.('[data-wysiwyg]') || rootEl;
  if (!root) return draft;

  const labelEl = root.querySelector('[data-field="label"]');
  const headingEl = root.querySelector('[data-field="heading"]');
  const contentEl = root.querySelector('[data-field="content"]');
  if (labelEl) draft.label = textOf(labelEl);
  if (headingEl) draft.heading = textOf(headingEl);
  if (contentEl && draft.content !== null) draft.content = textOf(contentEl);

  const byId = new Map((draft.sentences || []).map((s) => [s.id, { ...s }]));
  const order = [];

  root.querySelectorAll('[data-sentence-id]').forEach((el) => {
    const id = el.getAttribute('data-sentence-id');
    if (!id) return;
    // Only leaf sentence hosts: skip if this element contains nested [data-sentence-id]
    // Wait — nested li each have their own id; parent li text includes child text unless we strip.
    const prev = byId.get(id);
    if (!prev) return;

    const inList = !!el.closest('ul, ol');
    const tag = el.tagName;
    const isLi = tag === 'LI';
    const bullet = inList || isLi;
    const indentAttr = el.getAttribute('data-indent');
    let indentLevel = indentAttr != null && indentAttr !== '' ? Number(indentAttr) : listDepth(el, root);
    if (!Number.isFinite(indentLevel)) indentLevel = 0;

    const alignment = readAlignment(el) || prev.alignment || '';

    let paragraphType = prev.paragraphType || '';
    let listType = prev.listType || '';
    let isBullet = bullet;

    if (bullet) {
      isBullet = true;
      if (!listType) listType = 'bullet';
      if (!paragraphType || /^normal$/i.test(paragraphType)) {
        paragraphType = 'List Bullet';
      }
    } else {
      isBullet = false;
      listType = listType && !/^bullet$/i.test(listType) ? listType : '';
      if (/list\s*bullet/i.test(paragraphType)) paragraphType = 'Normal';
    }

    const text = plainTextPrefer(el);

    byId.set(id, {
      ...prev,
      text,
      paragraphType,
      alignment,
      isBullet,
      listType,
      indentLevel,
    });
    if (!order.includes(id)) order.push(id);
  });

  // Preserve original sentence order from draft.
  draft.sentences = (draft.sentences || []).map((s) => byId.get(s.id) || s);

  draft.commentary = (draft.commentary || []).map((item, i) => {
    const box = root.querySelector(`[data-note-kind="commentary"][data-note-idx="${i}"]`);
    if (!box) return item;
    const h = box.querySelector('[data-note-field="heading"]');
    const c = box.querySelector('[data-note-field="content"]');
    return {
      heading: h ? textOf(h) : item.heading,
      content: c ? (c.innerHTML || '').trim() : item.content,
    };
  });

  draft.explanation = (draft.explanation || []).map((item, i) => {
    const box = root.querySelector(`[data-note-kind="explanation"][data-note-idx="${i}"]`);
    if (!box) return item;
    const h = box.querySelector('[data-note-field="heading"]');
    const c = box.querySelector('[data-note-field="content"]');
    return {
      heading: h ? textOf(h) : item.heading,
      content: c ? (c.innerHTML || '').trim() : item.content,
    };
  });

  if (draft.mediaAsset) {
    const fig = root.querySelector('figure.wysiwyg-media');
    if (fig) {
      const cap = fig.querySelector('[data-field="caption"]');
      const alt = fig.querySelector('[data-field="altText"]');
      if (cap) draft.mediaAsset.caption = textOf(cap);
      if (alt) draft.mediaAsset.altText = textOf(alt);
      const type = String(draft.mediaAsset.type || '').toUpperCase();
      if (type === 'TABLE') {
        const wrap = fig.querySelector('[data-field="media-content"]');
        if (wrap) {
          // Serialize table HTML; strip contenteditable attrs we added for editing.
          const clone = wrap.cloneNode(true);
          clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
          draft.mediaAsset.content = (clone.innerHTML || '').trim();
        }
      }
    }
  }

  return draft;
}

/** Toolbar HTML for locked editing. */
export function renderWysiwygToolbarHtml() {
  return `<div class="wysiwyg-toolbar" role="toolbar" aria-label="Formatting">
    <button type="button" data-wy-cmd="paragraph" title="Paragraph">¶ Paragraph</button>
    <button type="button" data-wy-cmd="bullet" title="Bullet list">• Bullet</button>
    <button type="button" data-wy-cmd="indent" title="Indent">Indent</button>
    <button type="button" data-wy-cmd="outdent" title="Outdent">Outdent</button>
    <span class="wysiwyg-toolbar-sep"></span>
    <button type="button" data-wy-cmd="align-left" title="Align left">Left</button>
    <button type="button" data-wy-cmd="align-center" title="Align center">Center</button>
    <button type="button" data-wy-cmd="align-right" title="Align right">Right</button>
  </div>`;
}

function sentenceHostFromSelection(root) {
  const sel = root.ownerDocument?.getSelection?.() || (typeof window !== 'undefined' ? window.getSelection() : null);
  if (!sel || !sel.rangeCount) return null;
  let node = sel.anchorNode;
  if (!node) return null;
  if (node.nodeType === 3) node = node.parentElement;
  if (!node || !root.contains(node)) return null;
  return node.closest('[data-sentence-id]');
}

function setAlignment(el, align) {
  if (!el) return;
  el.setAttribute('data-align', align);
  if (!align || align === 'left') {
    el.style.textAlign = '';
    el.removeAttribute('data-align');
  } else {
    el.style.textAlign = align;
  }
}

/**
 * Bind toolbar buttons to mutate sentence hosts inside rootEl.
 * @returns {() => void} unbind
 */
export function bindWysiwygToolbar(toolbarEl, rootEl) {
  if (!toolbarEl || !rootEl) return () => {};

  const onClick = (ev) => {
    const btn = ev.target.closest('[data-wy-cmd]');
    if (!btn) return;
    ev.preventDefault();
    const cmd = btn.getAttribute('data-wy-cmd');
    const host = sentenceHostFromSelection(rootEl);
    if (!host) return;

    if (cmd === 'align-left') setAlignment(host, 'left');
    else if (cmd === 'align-center') setAlignment(host, 'center');
    else if (cmd === 'align-right') setAlignment(host, 'right');
    else if (cmd === 'bullet') convertSentenceHost(host, 'bullet');
    else if (cmd === 'paragraph') convertSentenceHost(host, 'paragraph');
    else if (cmd === 'indent') bumpIndent(host, 1);
    else if (cmd === 'outdent') bumpIndent(host, -1);
  };

  toolbarEl.addEventListener('click', onClick);
  return () => toolbarEl.removeEventListener('click', onClick);
}

function bumpIndent(host, delta) {
  const cur = Number(host.getAttribute('data-indent') || 0) || 0;
  const next = Math.max(0, Math.min(8, cur + delta));
  host.setAttribute('data-indent', String(next));
  // Visual hint via margin when not in nested list
  if (host.tagName === 'P') {
    host.style.marginLeft = next ? `${next * 1.25}rem` : '';
  }
}

function convertSentenceHost(host, mode) {
  const doc = host.ownerDocument;
  const id = host.getAttribute('data-sentence-id');
  const text = plainTextPrefer(host);
  const align = readAlignment(host);
  const indent = host.getAttribute('data-indent') || '0';

  if (mode === 'bullet' && host.tagName !== 'LI') {
    const ul = doc.createElement('ul');
    ul.className = 'wysiwyg-list';
    const li = doc.createElement('li');
    li.setAttribute('data-sentence-id', id);
    li.setAttribute('data-indent', indent);
    if (align) {
      li.setAttribute('data-align', align);
      li.style.textAlign = align;
    }
    li.setAttribute('contenteditable', 'true');
    li.textContent = text;
    ul.appendChild(li);
    host.replaceWith(ul);
  } else if (mode === 'paragraph' && host.tagName === 'LI') {
    const p = doc.createElement('p');
    p.className = 'wysiwyg-p';
    p.setAttribute('data-sentence-id', id);
    p.setAttribute('data-indent', '0');
    if (align) {
      p.setAttribute('data-align', align);
      p.style.textAlign = align;
    }
    p.setAttribute('contenteditable', 'true');
    p.textContent = text;
    const ul = host.parentElement;
    if (ul && ul.tagName === 'UL' && ul.children.length === 1) {
      ul.replaceWith(p);
    } else {
      host.replaceWith(p);
      // If we left an empty ul, remove it
      if (ul && ul.tagName === 'UL' && !ul.querySelector('[data-sentence-id]')) ul.remove();
    }
  }
}

/**
 * Build a display section by overlaying a draft onto a CIM section clone.
 * Keeps media url/sourcePath from the live section for IMAGE resolution.
 */
export function sectionViewFromDraft(section, draft) {
  if (!section) return null;
  const view = JSON.parse(JSON.stringify(section));
  if (!draft) return view;
  if (typeof draft.heading === 'string') view.heading = draft.heading;
  if (typeof draft.label === 'string') view.label = draft.label;
  if (draft.content !== null && draft.content !== undefined && typeof view.content === 'string') {
    view.content = draft.content;
  }
  if (Array.isArray(draft.sentences) && Array.isArray(view.sentences)) {
    const byId = new Map(draft.sentences.map((s) => [s.id, s]));
    view.sentences = view.sentences.map((sent) => {
      const d = byId.get(sent.id);
      if (!d) return sent;
      return {
        ...sent,
        text: d.text,
        formatting: {
          ...(sent.formatting || {}),
          paragraphType: d.paragraphType,
          alignment: d.alignment,
          isBullet: d.isBullet,
          listType: d.listType,
          indentLevel: d.indentLevel,
        },
      };
    });
    // Also expose draft-shaped sentences for render shortcut
    view._draftSentences = draft.sentences;
  }
  if (Array.isArray(draft.commentary) && Array.isArray(view.commentary)) {
    view.commentary = view.commentary.map((c, i) => ({
      ...c,
      heading: draft.commentary[i]?.heading ?? c.heading,
      content: draft.commentary[i]?.content ?? c.content,
    }));
  }
  if (Array.isArray(draft.explanation) && Array.isArray(view.explanation)) {
    view.explanation = view.explanation.map((c, i) => ({
      ...c,
      heading: draft.explanation[i]?.heading ?? c.heading,
      content: draft.explanation[i]?.content ?? c.content,
    }));
  }
  if (draft.mediaAsset && view.mediaAsset) {
    view.mediaAsset = {
      ...view.mediaAsset,
      content: draft.mediaAsset.content ?? view.mediaAsset.content,
      caption: draft.mediaAsset.caption ?? view.mediaAsset.caption,
      altText: draft.mediaAsset.altText ?? view.mediaAsset.altText,
    };
  }
  return view;
}

/** Prefer draft sentences when rendering a view built by sectionViewFromDraft. */
export function renderWysiwygFromDraft(section, draft, opts = {}) {
  const view = sectionViewFromDraft(section, draft);
  if (view && draft?.sentences) {
    // Force draft-shaped sentences into render path
    view.sentences = draft.sentences;
  }
  return renderWysiwygHtml(view, opts);
}
