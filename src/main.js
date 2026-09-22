import './style.css';
import JSZip from 'jszip';
import {
  flattenSections,
  findSectionById,
  findNodeInTree,
  findSectionPath,
  getLockRootId,
  sectionTitle,
  draftFromSection,
  applyDraftToRoot,
  escapeHtml,
  uid,
  nowIso,
  sanitizeTableHtml,
  normalizeMediaPath,
  resolveMediaUrl,
  defaultExpandedIds,
  subtreeMatchesQuery,
  cloneSection,
} from './content.js';
import { hashSection } from './hash.js';
import { importCheckoutPack, buildProposalPack } from './pack.js';

const SAMPLE_ZIP = './fixtures/sample-checkout.zip';
const SAMPLE_IMAGE_ZIP = './fixtures/sample-checkout-image.zip';
const app = document.querySelector('#app');

let state = {
  view: 'home', // home | editor
  content: null,
  rawContent: null,
  manifest: null,
  lockedIds: new Set(),
  warnings: [],
  sourceLabel: '',
  selectedId: null,
  /** @type {Map<string, { afterSection: object, rationale: string, changeId: string, createdAt: string, beforeHash: string }>} */
  changes: new Map(),
  author: { id: '', displayName: '', email: '' },
  authorOverridden: false,
  editDraft: draftFromSection(null),
  editRationale: '',
  tocSearch: '',
  tocExpanded: new Set(),
  /** @type {Map<string, string>} relative path → object URL */
  mediaUrls: new Map(),
  status: '',
  error: '',
  lastExport: null, // { filename, changeCount, proposalId }
};

function setStatus(msg, isError = false) {
  state.status = msg || '';
  state.error = isError ? msg : '';
  render();
}

function lockedSet() {
  return state.lockedIds instanceof Set ? state.lockedIds : new Set(state.lockedIds || []);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function revokeMediaUrls() {
  for (const url of state.mediaUrls.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  state.mediaUrls = new Map();
}

/** Extract media/* blob URLs from a checkout ZIP (best-effort). */
async function extractMediaUrls(file) {
  const map = new Map();
  const name = (file.name || '').toLowerCase();
  if (!name.endsWith('.zip')) return map;
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const norm = path.replace(/\\/g, '/');
      const m = norm.match(/(?:^|\/)media\/(.+)$/i);
      if (!m) continue;
      const rel = m[1].replace(/^\/+/, '');
      const blob = await entry.async('blob');
      const url = URL.createObjectURL(blob);
      map.set(rel, url);
      map.set(`media/${rel}`, url);
    }
  } catch {
    /* no media */
  }
  return map;
}

async function loadPackFromFile(file) {
  state.error = '';
  state.status = `Importing ${file.name}…`;
  render();
  try {
    const result = await importCheckoutPack(file);
    revokeMediaUrls();
    state.mediaUrls = await extractMediaUrls(file);
    state.content = result.content;
    state.rawContent = result.rawContent;
    state.manifest = result.manifest;
    state.lockedIds = result.lockedIds;
    state.warnings = result.warnings || [];
    state.sourceLabel = result.sourceLabel;
    state.changes = new Map();
    state.lastExport = null;
    state.selectedId =
      [...result.lockedIds][0] || flattenSections(result.content.sections)[0]?.id || null;
    const a = result.manifest?.assignee || {};
    state.author = {
      id: a.id || 'unknown-author',
      displayName: a.displayName || '',
      email: a.email || '',
    };
    state.authorOverridden = false;
    state.tocSearch = '';
    state.tocExpanded = defaultExpandedIds(
      result.content.sections,
      result.lockedIds,
      state.selectedId
    );
    syncEditForm();
    state.view = 'editor';
    state.status = `Imported ${result.content.criterion.designation || 'UFC'} (${result.lockedIds.size} locked section(s))`;
    render();
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
}

async function loadSample(url = SAMPLE_ZIP, filename = 'sample-checkout.zip') {
  state.status = 'Fetching sample checkout…';
  render();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch sample: ${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: 'application/zip' });
    await loadPackFromFile(file);
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
}

function workingRootFor(lockRootId) {
  if (!lockRootId || !state.content) return null;
  const existing = state.changes.get(lockRootId);
  if (existing?.afterSection) return existing.afterSection;
  return findSectionById(state.content.sections, lockRootId);
}

function syncEditForm() {
  const id = state.selectedId;
  if (!id || !state.content) {
    state.editDraft = draftFromSection(null);
    state.editRationale = '';
    return;
  }
  const locks = lockedSet();
  const lockRootId = getLockRootId(id, state.content.sections, locks);
  if (!lockRootId) {
    state.editDraft = draftFromSection(null);
    state.editRationale = '';
    return;
  }
  const root = workingRootFor(lockRootId);
  const node = findNodeInTree(root, id);
  state.editDraft = draftFromSection(node);
  const existing = state.changes.get(lockRootId);
  state.editRationale = existing?.rationale || '';
}

function selectSection(id) {
  state.selectedId = id;
  const path = findSectionPath(state.content?.sections || [], id);
  if (path) {
    for (const n of path) state.tocExpanded.add(n.id);
  }
  syncEditForm();
  render();
}

function readDraftFromDom() {
  const draft = cloneSection(state.editDraft);
  const heading = document.getElementById('edit-heading');
  const label = document.getElementById('edit-label');
  const content = document.getElementById('edit-content');
  if (heading) draft.heading = heading.value;
  if (label) draft.label = label.value;
  if (content && draft.content !== null) draft.content = content.value;

  draft.sentences = (draft.sentences || []).map((s) => {
    const textEl = document.querySelector(`[data-sentence-id="${CSS.escape(s.id)}"][data-sent-field="text"]`);
    const pt = document.querySelector(`[data-sentence-id="${CSS.escape(s.id)}"][data-sent-field="paragraphType"]`);
    const al = document.querySelector(`[data-sentence-id="${CSS.escape(s.id)}"][data-sent-field="alignment"]`);
    const bullet = document.querySelector(`[data-sentence-id="${CSS.escape(s.id)}"][data-sent-field="isBullet"]`);
    const lt = document.querySelector(`[data-sentence-id="${CSS.escape(s.id)}"][data-sent-field="listType"]`);
    const ind = document.querySelector(`[data-sentence-id="${CSS.escape(s.id)}"][data-sent-field="indentLevel"]`);
    return {
      ...s,
      text: textEl ? textEl.value : s.text,
      paragraphType: pt ? pt.value : s.paragraphType,
      alignment: al ? al.value : s.alignment,
      isBullet: bullet ? bullet.checked : s.isBullet,
      listType: lt ? lt.value : s.listType,
      indentLevel: ind ? Number(ind.value) || 0 : s.indentLevel,
    };
  });

  draft.commentary = (draft.commentary || []).map((item, i) => {
    const h = document.querySelector(`[data-note-kind="commentary"][data-note-idx="${i}"][data-note-field="heading"]`);
    const c = document.querySelector(`[data-note-kind="commentary"][data-note-idx="${i}"][data-note-field="content"]`);
    return {
      heading: h ? h.value : item.heading,
      content: c ? c.value : item.content,
    };
  });

  draft.explanation = (draft.explanation || []).map((item, i) => {
    const h = document.querySelector(`[data-note-kind="explanation"][data-note-idx="${i}"][data-note-field="heading"]`);
    const c = document.querySelector(`[data-note-kind="explanation"][data-note-idx="${i}"][data-note-field="content"]`);
    return {
      heading: h ? h.value : item.heading,
      content: c ? c.value : item.content,
    };
  });

  if (draft.mediaAsset) {
    const mc = document.getElementById('edit-media-content');
    const cap = document.getElementById('edit-media-caption');
    const alt = document.getElementById('edit-media-alt');
    if (mc) draft.mediaAsset.content = mc.value;
    if (cap) draft.mediaAsset.caption = cap.value;
    if (alt) draft.mediaAsset.altText = alt.value;
  }

  const rationaleEl = document.getElementById('edit-rationale');
  const rationale = rationaleEl ? rationaleEl.value : state.editRationale;
  return { draft, rationale };
}


function persistDraftIfEditing() {
  if (!document.getElementById('edit-rationale') && !document.getElementById('edit-heading')) return;
  try {
    const { draft, rationale } = readDraftFromDom();
    state.editDraft = draft;
    state.editRationale = rationale;
  } catch {
    /* ignore */
  }
}

async function saveTrackedChange() {
  const id = state.selectedId;
  if (!id || !state.content) return;
  const locks = lockedSet();
  const lockRootId = getLockRootId(id, state.content.sections, locks);
  if (!lockRootId) {
    setStatus('Section is read-only (outside lock roots).', true);
    return;
  }
  const { draft, rationale } = readDraftFromDom();
  const rationaleTrim = (rationale || '').trim();
  if (!rationaleTrim) {
    setStatus('Rationale is required for every tracked change.', true);
    return;
  }
  const baseRoot = findSectionById(state.content.sections, lockRootId);
  if (!baseRoot) {
    setStatus('Lock root section not found.', true);
    return;
  }
  try {
    const beforeHash = await hashSection(baseRoot);
    const prev = state.changes.get(lockRootId);
    const startRoot = prev?.afterSection ? cloneSection(prev.afterSection) : cloneSection(baseRoot);
    const afterSection = applyDraftToRoot(startRoot, id, draft);
    afterSection.id = baseRoot.id;
    state.changes.set(lockRootId, {
      afterSection,
      rationale: rationaleTrim,
      changeId: prev?.changeId || uid('chg'),
      createdAt: prev?.createdAt || nowIso(),
      beforeHash,
    });
    state.editDraft = draft;
    state.editRationale = rationaleTrim;
    state.status = `Tracked change saved (${state.changes.size} total). Root ${lockRootId.slice(0, 8)}…`;
    state.error = '';
    render();
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
}

function discardChange() {
  const id = state.selectedId;
  if (!id || !state.content) return;
  const lockRootId = getLockRootId(id, state.content.sections, lockedSet());
  if (!lockRootId) return;
  state.changes.delete(lockRootId);
  syncEditForm();
  state.status = 'Discarded tracked change for lock root.';
  render();
}

async function exportProposal() {
  if (!state.content || state.changes.size === 0) {
    setStatus('Add at least one tracked change (with rationale) before export.', true);
    return;
  }
  for (const [sid, ch] of state.changes) {
    if (!(ch.rationale || '').trim()) {
      setStatus(`Missing rationale for section ${sid}`, true);
      return;
    }
  }
  const desig = (state.content.criterion.designation || 'ufc').replace(/\s+/g, '-');
  const filename = `${desig}-proposal.zip`;
  try {
    state.status = 'Building proposal pack…';
    state.error = '';
    render();
    const author = { ...state.author };
    const { blob, proposal } = await buildProposalPack({
      content: state.content,
      rawContent: state.rawContent,
      manifest: state.manifest,
      changesBySectionId: state.changes,
      author,
    });
    downloadBlob(blob, filename);
    state.lastExport = {
      filename,
      changeCount: proposal.changes.length,
      proposalId: proposal.proposalId,
    };
    state.view = 'editor';
    state.status = `Exported ${filename} with ${proposal.changes.length} tracked change(s).`;
    state.error = '';
    render();
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
}

function renderHome() {
  return `
    <div class="proposal-banner">
      Offline UFC Editor — packs are <strong>proposals</strong> for CMS merge, not live / published UFC authority.
    </div>
    <header class="topbar">
      <h1>Offline UFC Editor</h1>
      <span class="meta">Contract v0 frozen</span>
    </header>
    <main class="main">
      <div class="card empty">
        <h3>Import a checkout pack</h3>
        <p>
          Open a CMS checkout ZIP (<code>content.json</code> + <code>meta/checkout-manifest.json</code>),
          edit only locked sections with a required rationale, then export a
          <code>ufc-offline-proposal-pack</code> ZIP.
        </p>
        <div class="home-actions">
          <label class="btn primary file-btn">
            Import checkout ZIP
            <input type="file" id="file-import" accept=".zip,application/zip,.json,application/json" />
          </label>
          <button type="button" class="primary" id="btn-sample">Load UFC text/table sample</button>
          <button type="button" id="btn-sample-image">Load image sample</button>
        </div>
        ${state.error ? `<p class="status error">${escapeHtml(state.error)}</p>` : ''}
        ${state.status && !state.error ? `<p class="status">${escapeHtml(state.status)}</p>` : ''}
        <p class="hint" style="color:var(--muted);font-size:0.85rem">
          See <code>PACK-CONTRACT.md</code> and <code>README.md</code> for the frozen contract and walkthrough.
        </p>
      </div>
    </main>
  `;
}

function renderNotesReadonly(kind, items) {
  if (!Array.isArray(items) || !items.length) return '';
  const rows = items
    .map((item) => {
      const h = item?.heading ? `<div class="note-heading">${escapeHtml(item.heading)}</div>` : '';
      const c = item?.content
        ? `<div class="note-content">${escapeHtml(item.content)}</div>`
        : '';
      return `<div class="note-item">${h}${c}</div>`;
    })
    .join('');
  return `<div class="readonly-block"><div class="readonly-label">${escapeHtml(kind)}</div>${rows}</div>`;
}

function renderMediaReadonly(media) {
  if (!media || typeof media !== 'object') return '';
  const type = String(media.type || '').toUpperCase();
  if (type === 'TABLE') {
    const cap = media.caption
      ? `<figcaption>${escapeHtml(media.caption)}</figcaption>`
      : '';
    const alt = media.altText
      ? `<p class="muted">Alt: ${escapeHtml(media.altText)}</p>`
      : '';
    const html = media.content ? sanitizeTableHtml(media.content) : '<p class="muted">No table HTML</p>';
    return `<div class="readonly-block"><div class="readonly-label">TABLE</div><figure class="media-table">${cap}${alt}<div class="table-wrap">${html}</div></figure></div>`;
  }
  if (type === 'IMAGE') {
    const path = normalizeMediaPath(media.url || media.sourcePath || '');
    const url = resolveMediaUrl(state.mediaUrls, media.url || media.sourcePath || '');
    const cap = media.caption ? `<figcaption>${escapeHtml(media.caption)}</figcaption>` : '';
    const alt = media.altText || media.caption || 'Image';
    if (url) {
      return `<div class="readonly-block"><div class="readonly-label">IMAGE</div><figure class="media-image">${cap}<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" /><p class="muted media-path"><code>${escapeHtml(path)}</code></p></figure></div>`;
    }
    return `<div class="readonly-block"><div class="readonly-label">IMAGE</div><figure class="media-image media-missing">${cap}<div class="media-placeholder"><p class="media-missing-msg">Image not in pack</p>${path ? `<p class="muted media-path"><code>${escapeHtml(path)}</code></p>` : '<p class="muted">No storage path on mediaAsset</p>'}<p class="muted">Alt: ${escapeHtml(alt)}</p></div></figure></div>`;
  }
  return '';
}

function renderReadonlyPane(section) {
  if (!section) return '<p class="empty">Pick a section from the list.</p>';
  const title = sectionTitle(section);
  const labelLine =
    section.label || section.heading
      ? `<h3 class="readonly-title">${escapeHtml(title)}</h3>`
      : `<h3 class="readonly-title">${escapeHtml(section.type || section.id)}</h3>`;

  let sentencesHtml = '';
  if (Array.isArray(section.sentences) && section.sentences.length) {
    sentencesHtml = `<div class="readonly-block"><div class="readonly-label">Sentences</div><div class="readonly-sentences">${section.sentences
      .map((s) => `<p class="readonly-sentence">${escapeHtml(s.text || '')}</p>`)
      .join('')}</div></div>`;
  }

  let contentHtml = '';
  if (typeof section.content === 'string' && section.content.trim()) {
    contentHtml = `<div class="readonly-block"><div class="readonly-label">Content</div><div class="readonly-content">${escapeHtml(section.content)}</div></div>`;
  }

  return `
    ${labelLine}
    <p class="meta-line">id: <code>${escapeHtml(section.id)}</code> · type: ${escapeHtml(section.type || '—')}
      <span class="badge readonly">read-only</span>
    </p>
    ${sentencesHtml}
    ${contentHtml}
    ${renderNotesReadonly('Commentary', section.commentary)}
    ${renderNotesReadonly('Explanation', section.explanation)}
    ${renderMediaReadonly(section.mediaAsset)}
  `;
}


function alignmentOptions(current) {
  const opts = ['left', 'center', 'right', 'justify'];
  if (current && !opts.includes(current)) opts.push(current);
  return opts
    .map((v) => `<option value="${escapeHtml(v)}" ${current === v ? 'selected' : ''}>${escapeHtml(v)}</option>`)
    .join('');
}

function renderSentenceEditors(sentences) {
  if (!sentences?.length) return '';
  return `
    <div class="field-group">
      <h4>Sentences</h4>
      ${sentences
        .map(
          (s, i) => `
        <div class="sentence-editor" data-sentence-wrap="${escapeHtml(s.id)}">
          <div class="field">
            <label>Sentence ${i + 1} <code class="tiny">${escapeHtml(s.id)}</code></label>
            <textarea data-sentence-id="${escapeHtml(s.id)}" data-sent-field="text" rows="3">${escapeHtml(s.text)}</textarea>
          </div>
          <div class="fmt-grid">
            <div class="field">
              <label>paragraphType</label>
              <input data-sentence-id="${escapeHtml(s.id)}" data-sent-field="paragraphType" value="${escapeHtml(s.paragraphType)}" />
            </div>
            <div class="field">
              <label>alignment</label>
              <select data-sentence-id="${escapeHtml(s.id)}" data-sent-field="alignment">
                ${alignmentOptions(s.alignment)}
              </select>
            </div>
            <div class="field check-field">
              <label><input type="checkbox" data-sentence-id="${escapeHtml(s.id)}" data-sent-field="isBullet" ${s.isBullet ? 'checked' : ''}/> isBullet</label>
            </div>
            <div class="field">
              <label>listType</label>
              <input data-sentence-id="${escapeHtml(s.id)}" data-sent-field="listType" value="${escapeHtml(s.listType)}" />
            </div>
            <div class="field">
              <label>indentLevel</label>
              <input type="number" data-sentence-id="${escapeHtml(s.id)}" data-sent-field="indentLevel" value="${escapeHtml(String(s.indentLevel ?? 0))}" />
            </div>
          </div>
        </div>`
        )
        .join('')}
    </div>`;
}

function renderNoteEditors(kind, items) {
  if (!items?.length) return '';
  return `
    <div class="field-group">
      <h4>${escapeHtml(kind)}</h4>
      ${items
        .map(
          (item, i) => `
        <div class="note-editor">
          <div class="field">
            <label>${escapeHtml(kind)} ${i + 1} heading</label>
            <input data-note-kind="${escapeHtml(kind.toLowerCase())}" data-note-idx="${i}" data-note-field="heading" value="${escapeHtml(item.heading)}" />
          </div>
          <div class="field">
            <label>${escapeHtml(kind)} ${i + 1} content</label>
            <textarea data-note-kind="${escapeHtml(kind.toLowerCase())}" data-note-idx="${i}" data-note-field="content" rows="3">${escapeHtml(item.content)}</textarea>
          </div>
        </div>`
        )
        .join('')}
    </div>`;
}

function renderMediaEditors(media) {
  if (!media) return '';
  const type = String(media.type || '').toUpperCase();
  if (type === 'TABLE') {
    return `
      <div class="field-group">
        <h4>TABLE mediaAsset</h4>
        <div class="field">
          <label for="edit-media-content">HTML content</label>
          <textarea id="edit-media-content" rows="8">${escapeHtml(media.content || '')}</textarea>
        </div>
        <div class="field">
          <label for="edit-media-caption">Caption</label>
          <input id="edit-media-caption" value="${escapeHtml(media.caption || '')}" />
        </div>
        <div class="field">
          <label for="edit-media-alt">Alt text</label>
          <input id="edit-media-alt" value="${escapeHtml(media.altText || '')}" />
        </div>
        <div class="table-wrap preview">${sanitizeTableHtml(media.content || '')}</div>
      </div>`;
  }
  if (type === 'IMAGE') {
    // path resolution uses live section mediaAsset; draft may lack url — handled in pane with section
    return `
      <div class="field-group">
        <h4>IMAGE mediaAsset</h4>
        <div class="field">
          <label for="edit-media-caption">Caption</label>
          <input id="edit-media-caption" value="${escapeHtml(media.caption || '')}" />
        </div>
        <div class="field">
          <label for="edit-media-alt">Alt text</label>
          <input id="edit-media-alt" value="${escapeHtml(media.altText || '')}" />
        </div>
        <div id="image-preview-slot"></div>
      </div>`;
  }
  return '';
}

function renderLockedPane(section, lockRootId, hasChange) {
  const draft = state.editDraft;
  const title = sectionTitle(section);
  let imagePreview = '';
  if (section.mediaAsset && String(section.mediaAsset.type || '').toUpperCase() === 'IMAGE') {
    const path = normalizeMediaPath(section.mediaAsset.url || section.mediaAsset.sourcePath || '');
    const url = resolveMediaUrl(state.mediaUrls, section.mediaAsset.url || section.mediaAsset.sourcePath || '');
    const alt = draft.mediaAsset?.altText || section.mediaAsset.altText || section.mediaAsset.caption || 'Image';
    if (url) {
      imagePreview = `<figure class="media-image"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" /><p class="muted media-path"><code>${escapeHtml(path)}</code></p></figure>`;
    } else {
      imagePreview = `<div class="media-placeholder"><p class="media-missing-msg">Image not in pack</p>${path ? `<p class="muted"><code>${escapeHtml(path)}</code></p>` : ''}</div>`;
    }
  }

  return `
    <h3>
      ${escapeHtml(title)}
      <span class="badge locked">locked — editable</span>
      ${hasChange ? '<span class="badge changed">tracked change</span>' : ''}
    </h3>
    <p class="meta-line">
      id: <code>${escapeHtml(section.id)}</code> · type: ${escapeHtml(section.type || '—')}
      · change root: <code>${escapeHtml(lockRootId)}</code>
    </p>
    <p class="hint-inline">Edits save against the nearest locked root; the full root subtree is exported as <code>afterSection</code>.</p>

    <div class="field">
      <label for="edit-heading">Heading</label>
      <input id="edit-heading" value="${escapeHtml(draft.heading)}" />
    </div>
    <div class="field">
      <label for="edit-label">Label</label>
      <input id="edit-label" value="${escapeHtml(draft.label)}" />
    </div>
    ${
      draft.content !== null
        ? `<div class="field">
        <label for="edit-content">Content</label>
        <textarea id="edit-content" rows="4">${escapeHtml(draft.content)}</textarea>
      </div>`
        : ''
    }
    ${renderSentenceEditors(draft.sentences)}
    ${renderNoteEditors('Commentary', draft.commentary)}
    ${renderNoteEditors('Explanation', draft.explanation)}
    ${renderMediaEditors(draft.mediaAsset)}
    ${imagePreview}

    <div class="field">
      <label for="edit-rationale">Rationale (required)</label>
      <textarea id="edit-rationale" placeholder="Why is this change proposed?">${escapeHtml(state.editRationale)}</textarea>
      <div class="hint">Every tracked change must include a non-empty rationale before export.</div>
    </div>
    <div class="actions">
      <button type="button" class="primary" id="btn-save-change">Save tracked change</button>
      <button type="button" id="btn-discard" ${hasChange ? '' : 'disabled'}>Discard change</button>
    </div>
  `;
}

function renderTocTree(sections, query) {
  const locks = lockedSet();
  const q = (query || '').trim().toLowerCase();

  const renderNode = (section) => {
    if (q && !subtreeMatchesQuery(section, q)) return '';
    const id = section.id;
    const children = section.children || [];
    const visibleChildren = q ? children.filter((c) => subtreeMatchesQuery(c, q)) : children;
    const hasKids = visibleChildren.length > 0;
    const expanded = q ? true : state.tocExpanded.has(id);
    const lockRoot = getLockRootId(id, state.content.sections, locks);
    const editable = !!lockRoot;
    const isLockRoot = locks.has(id);
    const changed = lockRoot ? state.changes.has(lockRoot) : false;
    const badge = editable
      ? `<span class="badge locked">${isLockRoot ? 'locked' : 'locked'}</span>`
      : `<span class="badge readonly">read-only</span>`;
    const chBadge = changed ? `<span class="badge changed">edited</span>` : '';
    const active = id === state.selectedId ? 'active' : '';
    const toggle = hasKids
      ? `<button type="button" class="toc-toggle" data-toggle-id="${escapeHtml(id)}" aria-label="${expanded ? 'Collapse' : 'Expand'}">${expanded ? '▾' : '▸'}</button>`
      : `<span class="toc-spacer"></span>`;
    const childList =
      hasKids && expanded
        ? `<ul class="toc-children">${visibleChildren.map(renderNode).join('')}</ul>`
        : '';
    return `<li class="toc-item">
      <div class="toc-row ${active}" data-section-id="${escapeHtml(id)}" title="${escapeHtml(id)}">
        ${toggle}
        ${badge}${chBadge}
        <span class="toc-title">${escapeHtml(sectionTitle(section))}</span>
      </div>
      ${childList}
    </li>`;
  };

  const top = (sections || []).filter((s) => !q || subtreeMatchesQuery(s, q));
  if (!top.length) {
    return `<li class="toc-empty muted">No matching sections</li>`;
  }
  return top.map(renderNode).join('');
}

function renderEditor() {
  const c = state.content.criterion;
  const locks = lockedSet();
  const selected = state.selectedId
    ? findSectionById(state.content.sections, state.selectedId)
    : null;
  const lockRootId = state.selectedId
    ? getLockRootId(state.selectedId, state.content.sections, locks)
    : null;
  const editable = !!lockRootId;
  const hasChange = lockRootId ? state.changes.has(lockRootId) : false;

  let paneSection = selected;
  if (editable && lockRootId) {
    const root = workingRootFor(lockRootId);
    paneSection = findNodeInTree(root, state.selectedId) || selected;
  }

  const warnBlock =
    state.warnings?.length > 0
      ? `<div class="warnings"><strong>Warnings</strong><ul>${state.warnings
          .map((w) => `<li>${escapeHtml(w)}</li>`)
          .join('')}</ul></div>`
      : '';

  const changeRows = [...state.changes.entries()]
    .map(([sid, ch]) => {
      const sec = findSectionById(state.content.sections, sid);
      const title = sectionTitle(sec) || sid;
      return `<tr>
        <td><code>${escapeHtml(ch.changeId)}</code></td>
        <td>${escapeHtml(title)}<br/><code style="font-size:0.7rem">${escapeHtml(sid)}</code></td>
        <td>${escapeHtml(ch.rationale)}</td>
      </tr>`;
    })
    .join('');

  const paneBody = !paneSection
    ? '<p class="empty">Pick a section from the list. Locked roots and their descendants are editable; others are view-only.</p>'
    : editable
      ? renderLockedPane(paneSection, lockRootId, hasChange)
      : renderReadonlyPane(paneSection);

  return `
    <div class="proposal-banner">
      Offline UFC Editor — exports are <strong>proposals</strong> (format <code>ufc-offline-proposal-pack</code>), not live UFC.
    </div>
    <header class="topbar">
      <h1>Offline UFC Editor</h1>
      <span class="meta">${escapeHtml(c.designation || '')} · ${escapeHtml(c.versionId || '')}</span>
      <button type="button" id="btn-home">Close pack</button>
      <button type="button" class="primary" id="btn-export" ${state.changes.size ? '' : 'disabled'}>
        Export proposal ZIP (${state.changes.size})
      </button>
    </header>
    <div class="layout">
      <aside class="sidebar">
        <h2>Sections · ${locks.size} locked</h2>
        <div class="toc-search-wrap">
          <input type="search" id="toc-search" placeholder="Filter sections…" value="${escapeHtml(state.tocSearch)}" />
        </div>
        <ul class="section-list toc-root">${renderTocTree(state.content.sections, state.tocSearch)}</ul>
      </aside>
      <main class="main">
        ${warnBlock}
        ${state.error ? `<p class="status error">${escapeHtml(state.error)}</p>` : ''}
        ${state.status && !state.error ? `<p class="status">${escapeHtml(state.status)}</p>` : ''}
        ${
          state.lastExport
            ? `<div class="card export-confirm" id="export-confirm">
          <h3>Proposal exported</h3>
          <p><strong>File:</strong> <code>${escapeHtml(state.lastExport.filename)}</code></p>
          <p><strong>Tracked changes:</strong> ${state.lastExport.changeCount}</p>
          <p><strong>Proposal id:</strong> <code>${escapeHtml(state.lastExport.proposalId)}</code></p>
          <p class="hint">The ZIP includes <code>proposal.json</code> (<code>ufc-offline-proposal-pack</code> v1) and embedded <code>content.json</code>. This is a proposal for CMS merge, not published UFC.</p>
          <div class="actions">
            <button type="button" id="btn-dismiss-export">Dismiss</button>
          </div>
        </div>`
            : ''
        }

        <div class="card">
          <h3>Author</h3>
          <div class="field">
            <label for="author-id">CMS user id</label>
            <input id="author-id" value="${escapeHtml(state.author.id)}" />
          </div>
          <div class="field">
            <label for="author-name">Display name</label>
            <input id="author-name" value="${escapeHtml(state.author.displayName || '')}" />
          </div>
          <div class="field">
            <label for="author-email">Email</label>
            <input id="author-email" value="${escapeHtml(state.author.email || '')}" />
            ${
              state.authorOverridden
                ? `<div class="hint warn">Author fields overridden offline — CMS may treat identity as unverified.</div>`
                : `<div class="hint">Defaults from checkout assignee. Changing fields shows a spoofing warning.</div>`
            }
          </div>
        </div>

        <div class="card section-pane">
          ${paneBody}
        </div>

        <div class="card changes-panel">
          <h3>Tracked changes (${state.changes.size})</h3>
          ${
            state.changes.size
              ? `<table>
            <thead><tr><th>changeId</th><th>Section</th><th>Rationale</th></tr></thead>
            <tbody>${changeRows}</tbody>
          </table>`
              : '<p class="empty">No changes yet. Edit a locked section (or descendant), enter a rationale, and save.</p>'
          }
        </div>
      </main>
    </div>
  `;
}

function render() {
  if (state.view === 'home') {
    app.innerHTML = renderHome();
  } else {
    app.innerHTML = renderEditor();
  }
  bind();
}

function bind() {
  const fileInput = document.getElementById('file-import');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) loadPackFromFile(f);
    });
  }
  document.getElementById('btn-sample')?.addEventListener('click', () => loadSample(SAMPLE_ZIP, 'sample-checkout.zip'));
  document.getElementById('btn-sample-image')?.addEventListener('click', () => loadSample(SAMPLE_IMAGE_ZIP, 'sample-checkout-image.zip'));
  document.getElementById('btn-home')?.addEventListener('click', () => {
    state.view = 'home';
    state.content = null;
    state.changes = new Map();
    state.lastExport = null;
    revokeMediaUrls();
    state.status = '';
    state.error = '';
    render();
  });
  document.getElementById('btn-export')?.addEventListener('click', () => exportProposal());
  document.getElementById('btn-save-change')?.addEventListener('click', () => saveTrackedChange());
  document.getElementById('btn-discard')?.addEventListener('click', () => discardChange());
  document.getElementById('btn-dismiss-export')?.addEventListener('click', () => {
    state.lastExport = null;
    render();
  });

  document.querySelectorAll('.toc-row[data-section-id]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.toc-toggle')) return;
      selectSection(el.getAttribute('data-section-id'));
    });
  });

  document.querySelectorAll('.toc-toggle').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const tid = btn.getAttribute('data-toggle-id');
      if (!tid) return;
      persistDraftIfEditing();
      if (state.tocExpanded.has(tid)) state.tocExpanded.delete(tid);
      else state.tocExpanded.add(tid);
      render();
    });
  });

  const tocSearch = document.getElementById('toc-search');
  if (tocSearch) {
    tocSearch.addEventListener('input', () => {
      persistDraftIfEditing();
      state.tocSearch = tocSearch.value;
      render();
      const again = document.getElementById('toc-search');
      if (again) {
        again.focus();
        const len = again.value.length;
        again.setSelectionRange(len, len);
      }
    });
  }

  const authorDefaults = state.manifest?.assignee || {};
  const wireAuthor = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      state.author[key] = el.value;
      const changed =
        state.author.id !== (authorDefaults.id || 'unknown-author') ||
        state.author.displayName !== (authorDefaults.displayName || '') ||
        state.author.email !== (authorDefaults.email || '');
      state.authorOverridden = changed;
      const hint = el.parentElement?.querySelector('.hint');
      if (hint && changed) {
        hint.classList.add('warn');
        hint.textContent =
          'Author fields overridden offline — CMS may treat identity as unverified.';
      }
    });
  };
  wireAuthor('author-id', 'id');
  wireAuthor('author-name', 'displayName');
  wireAuthor('author-email', 'email');
}

render();
