import './style.css';
import {
  flattenSections,
  findSectionById,
  getEditableText,
  applyTextEdit,
  escapeHtml,
  uid,
  nowIso,
} from './content.js';
import { hashSection } from './hash.js';
import { importCheckoutPack, buildProposalPack } from './pack.js';

const SAMPLE_ZIP = './fixtures/sample-checkout.zip';
const app = document.querySelector('#app');

/** @type {import('./pack.js').importCheckoutPack extends Function ? any : never} */
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
  editText: '',
  editRationale: '',
  status: '',
  error: '',
};

function setStatus(msg, isError = false) {
  state.status = msg || '';
  state.error = isError ? msg : '';
  render();
}

function lockedSet() {
  return state.lockedIds instanceof Set ? state.lockedIds : new Set(state.lockedIds || []);
}

function isLocked(id) {
  return lockedSet().has(id);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function loadPackFromFile(file) {
  state.error = '';
  state.status = `Importing ${file.name}…`;
  render();
  try {
    const result = await importCheckoutPack(file);
    state.content = result.content;
    state.rawContent = result.rawContent;
    state.manifest = result.manifest;
    state.lockedIds = result.lockedIds;
    state.warnings = result.warnings || [];
    state.sourceLabel = result.sourceLabel;
    state.changes = new Map();
    state.selectedId = [...result.lockedIds][0] || flattenSections(result.content.sections)[0]?.id || null;
    const a = result.manifest?.assignee || {};
    state.author = {
      id: a.id || 'unknown-author',
      displayName: a.displayName || '',
      email: a.email || '',
    };
    state.authorOverridden = false;
    syncEditForm();
    state.view = 'editor';
    state.status = `Imported ${result.content.criterion.designation || 'UFC'} (${result.lockedIds.size} locked section(s))`;
    render();
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
}

async function loadSample() {
  state.status = 'Fetching sample checkout…';
  render();
  try {
    const res = await fetch(SAMPLE_ZIP);
    if (!res.ok) throw new Error(`Failed to fetch sample: ${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], 'sample-checkout.zip', { type: 'application/zip' });
    await loadPackFromFile(file);
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
}

function syncEditForm() {
  const id = state.selectedId;
  if (!id || !state.content) {
    state.editText = '';
    state.editRationale = '';
    return;
  }
  const existing = state.changes.get(id);
  if (existing) {
    state.editText = getEditableText(existing.afterSection);
    state.editRationale = existing.rationale || '';
  } else {
    const sec = findSectionById(state.content.sections, id);
    state.editText = getEditableText(sec);
    state.editRationale = '';
  }
}

function selectSection(id) {
  state.selectedId = id;
  syncEditForm();
  render();
}

async function saveTrackedChange() {
  const id = state.selectedId;
  if (!id) return;
  if (!isLocked(id)) {
    setStatus('Section is read-only (not in lock set).', true);
    return;
  }
  const rationale = (state.editRationale || '').trim();
  if (!rationale) {
    setStatus('Rationale is required for every tracked change.', true);
    return;
  }
  const base = findSectionById(state.content.sections, id);
  if (!base) {
    setStatus('Section not found.', true);
    return;
  }
  try {
    const beforeHash = await hashSection(base);
    const afterSection = applyTextEdit(base, state.editText);
    // Keep section id stable
    afterSection.id = base.id;
    const prev = state.changes.get(id);
    state.changes.set(id, {
      afterSection,
      rationale,
      changeId: prev?.changeId || uid('chg'),
      createdAt: prev?.createdAt || nowIso(),
      beforeHash,
    });
    state.status = `Tracked change saved for section ${id.slice(0, 8)}…`;
    state.error = '';
    render();
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
}

function discardChange() {
  const id = state.selectedId;
  if (!id) return;
  state.changes.delete(id);
  syncEditForm();
  state.status = 'Discarded tracked change for selected section.';
  render();
}

async function exportProposal() {
  if (!state.content || state.changes.size === 0) {
    setStatus('Add at least one tracked change (with rationale) before export.', true);
    return;
  }
  // Ensure every change has rationale
  for (const [sid, ch] of state.changes) {
    if (!(ch.rationale || '').trim()) {
      setStatus(`Missing rationale for section ${sid}`, true);
      return;
    }
  }
  try {
    state.status = 'Building proposal pack…';
    render();
    const author = { ...state.author };
    const { blob, proposal } = await buildProposalPack({
      content: state.content,
      rawContent: state.rawContent,
      manifest: state.manifest,
      changesBySectionId: state.changes,
      author,
    });
    const desig = (state.content.criterion.designation || 'ufc').replace(/\s+/g, '-');
    downloadBlob(blob, `${desig}-proposal.zip`);
    state.status = `Exported proposal ${proposal.proposalId} (${proposal.changes.length} change(s)). ZIP includes proposal.json + content.json.`;
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
      <span class="meta">Contract v0 frozen · scaffold</span>
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
          <button type="button" class="primary" id="btn-sample">Load sample checkout (UFC 1-200-01)</button>
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

function renderEditor() {
  const c = state.content.criterion;
  const flat = flattenSections(state.content.sections);
  const locks = lockedSet();
  const selected = state.selectedId
    ? findSectionById(state.content.sections, state.selectedId)
    : null;
  const selectedLocked = state.selectedId && locks.has(state.selectedId);
  const hasChange = state.selectedId && state.changes.has(state.selectedId);

  const toc = flat
    .map((item) => {
      const locked = locks.has(item.id);
      const changed = state.changes.has(item.id);
      const pad = '&nbsp;'.repeat(Math.min(item.depth, 6) * 2);
      const badge = locked
        ? `<span class="badge locked">locked</span>`
        : `<span class="badge readonly">read-only</span>`;
      const chBadge = changed ? `<span class="badge changed">edited</span>` : '';
      const active = item.id === state.selectedId ? 'active' : '';
      return `<li class="${active}" data-section-id="${escapeHtml(item.id)}" title="${escapeHtml(item.id)}">
        ${badge}${chBadge}
        <span><span class="pad">${pad}</span>${escapeHtml(item.title || item.type || item.id)}</span>
      </li>`;
    })
    .join('');

  const warnBlock =
    state.warnings?.length > 0
      ? `<div class="warnings"><strong>Warnings</strong><ul>${state.warnings
          .map((w) => `<li>${escapeHtml(w)}</li>`)
          .join('')}</ul></div>`
      : '';

  const changeRows = [...state.changes.entries()]
    .map(([sid, ch]) => {
      const sec = findSectionById(state.content.sections, sid);
      const title = sec?.heading || sec?.type || sid;
      return `<tr>
        <td><code>${escapeHtml(ch.changeId)}</code></td>
        <td>${escapeHtml(title)}<br/><code style="font-size:0.7rem">${escapeHtml(sid)}</code></td>
        <td>${escapeHtml(ch.rationale)}</td>
      </tr>`;
    })
    .join('');

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
        <ul class="section-list">${toc}</ul>
      </aside>
      <main class="main">
        ${warnBlock}
        ${state.error ? `<p class="status error">${escapeHtml(state.error)}</p>` : ''}
        ${state.status && !state.error ? `<p class="status">${escapeHtml(state.status)}</p>` : ''}

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

        <div class="card">
          <h3>
            ${selected ? escapeHtml(selected.heading || selected.type || selected.id) : 'Select a section'}
            ${
              selected
                ? selectedLocked
                  ? '<span class="badge locked">locked — editable</span>'
                  : '<span class="badge readonly">read-only</span>'
                : ''
            }
            ${hasChange ? '<span class="badge changed">tracked change</span>' : ''}
          </h3>
          ${
            selected
              ? `
            <p class="meta" style="color:var(--muted);font-size:0.8rem;margin:0 0 0.75rem">
              id: <code>${escapeHtml(selected.id)}</code> · type: ${escapeHtml(selected.type || '—')}
            </p>
            <div class="field">
              <label for="edit-text">Section text (spike — full section replace)</label>
              <textarea id="edit-text" ${selectedLocked ? '' : 'readonly'}>${escapeHtml(state.editText)}</textarea>
            </div>
            <div class="field">
              <label for="edit-rationale">Rationale (required)</label>
              <textarea id="edit-rationale" ${selectedLocked ? '' : 'readonly'} placeholder="Why is this change proposed?">${escapeHtml(state.editRationale)}</textarea>
              <div class="hint">Every tracked change must include a non-empty rationale before export.</div>
            </div>
            <div class="actions">
              <button type="button" class="primary" id="btn-save-change" ${selectedLocked ? '' : 'disabled'}>
                Save tracked change
              </button>
              <button type="button" id="btn-discard" ${hasChange ? '' : 'disabled'}>Discard change</button>
            </div>
          `
              : '<p class="empty">Pick a section from the list. Locked sections can be edited; others are view-only.</p>'
          }
        </div>

        <div class="card changes-panel">
          <h3>Tracked changes (${state.changes.size})</h3>
          ${
            state.changes.size
              ? `<table>
            <thead><tr><th>changeId</th><th>Section</th><th>Rationale</th></tr></thead>
            <tbody>${changeRows}</tbody>
          </table>`
              : '<p class="empty">No changes yet. Edit a locked section, enter a rationale, and save.</p>'
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
  document.getElementById('btn-sample')?.addEventListener('click', () => loadSample());
  document.getElementById('btn-home')?.addEventListener('click', () => {
    state.view = 'home';
    state.content = null;
    state.changes = new Map();
    state.status = '';
    state.error = '';
    render();
  });
  document.getElementById('btn-export')?.addEventListener('click', () => exportProposal());
  document.getElementById('btn-save-change')?.addEventListener('click', () => saveTrackedChange());
  document.getElementById('btn-discard')?.addEventListener('click', () => discardChange());

  document.querySelectorAll('[data-section-id]').forEach((el) => {
    el.addEventListener('click', () => selectSection(el.getAttribute('data-section-id')));
  });

  const editText = document.getElementById('edit-text');
  if (editText) {
    editText.addEventListener('input', () => {
      state.editText = editText.value;
    });
  }
  const editRationale = document.getElementById('edit-rationale');
  if (editRationale) {
    editRationale.addEventListener('input', () => {
      state.editRationale = editRationale.value;
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
      // Light re-render of hint only would be nicer; full render is OK for spike
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
