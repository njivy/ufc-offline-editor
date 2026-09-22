/**
 * Content helpers aligned with Offline UFC Reader normalizeContent vocabulary.
 */

export function normalizeContent(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid JSON: expected an object');
  }
  let data = raw;
  if (raw.data && (raw.data.criterion || raw.data.sections)) {
    data = raw.data;
  }
  if (!data.criterion || !Array.isArray(data.sections)) {
    throw new Error('JSON must include criterion and sections[] (API wrapper or unwrapped data)');
  }
  const c = data.criterion;
  if (!c.versionId) {
    throw new Error('criterion.versionId is required');
  }
  return {
    criterion: c,
    sections: data.sections,
    metadataFields: data.metadataFields || [],
    raw,
  };
}

/** Deep-clone via JSON (CIM trees are JSON-safe). */
export function cloneSection(section) {
  return JSON.parse(JSON.stringify(section));
}

export function findSectionById(sections, id) {
  if (!Array.isArray(sections)) return null;
  for (const s of sections) {
    if (s && s.id === id) return s;
    const child = findSectionById(s.children || [], id);
    if (child) return child;
  }
  return null;
}

/** Flatten sections for TOC / list (depth-first). */
export function flattenSections(sections, depth = 0, out = []) {
  for (const s of sections || []) {
    const title =
      s.heading ||
      (typeof s.content === 'string' ? s.content.slice(0, 80) : '') ||
      s.type ||
      s.id;
    out.push({ id: s.id, title, type: s.type || '', depth, section: s });
    if (s.children?.length) flattenSections(s.children, depth + 1, out);
  }
  return out;
}

/** Plain-text snippet from a section for before.snippet */
export function sectionSnippet(section, maxLen = 160) {
  if (!section) return '';
  const parts = [];
  if (section.heading) parts.push(section.heading);
  if (typeof section.content === 'string' && section.content.trim()) {
    parts.push(section.content.trim());
  }
  if (Array.isArray(section.sentences)) {
    for (const sent of section.sentences) {
      if (sent?.text) parts.push(sent.text);
    }
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

/**
 * Apply a text edit to a section for the spike UX.
 * Prefer sentences[].text; else content string; always keep structure.
 */
export function applyTextEdit(section, newText) {
  const next = cloneSection(section);
  const text = String(newText ?? '');
  if (Array.isArray(next.sentences) && next.sentences.length > 0) {
    // Collapse to a single sentence for spike simplicity; keep first sentence id.
    const first = next.sentences[0];
    next.sentences = [
      {
        ...first,
        text,
      },
    ];
    next.content = text;
  } else if (typeof next.content === 'string' || next.content == null) {
    next.content = text;
  } else {
    next.content = text;
  }
  return next;
}

/** Extract editable text body from a section. */
export function getEditableText(section) {
  if (!section) return '';
  if (Array.isArray(section.sentences) && section.sentences.length) {
    return section.sentences.map((s) => s.text || '').join('');
  }
  if (typeof section.content === 'string') return section.content;
  return '';
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function uid(prefix = 'id') {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso() {
  return new Date().toISOString();
}
