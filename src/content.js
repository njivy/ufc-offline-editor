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

/** Find a node in a single rooted tree (root may match). */
export function findNodeInTree(root, id) {
  if (!root || !id) return null;
  if (root.id === id) return root;
  return findSectionById(root.children || [], id);
}

/**
 * Path from top-level section down to id (inclusive), or null.
 * @returns {object[]|null}
 */
export function findSectionPath(sections, id, path = []) {
  for (const s of sections || []) {
    const next = [...path, s];
    if (s.id === id) return next;
    const found = findSectionPath(s.children || [], id, next);
    if (found) return found;
  }
  return null;
}

/**
 * Nearest locked ancestor/root for a section id (self if locked), or null if outside all locks.
 */
export function getLockRootId(sectionId, sections, lockedIds) {
  if (!sectionId || !lockedIds || lockedIds.size === 0) return null;
  const path = findSectionPath(sections, sectionId);
  if (!path) return null;
  for (let i = path.length - 1; i >= 0; i--) {
    if (lockedIds.has(path[i].id)) return path[i].id;
  }
  return null;
}

export function isEditableSection(sectionId, sections, lockedIds) {
  return getLockRootId(sectionId, sections, lockedIds) != null;
}

export function sectionTitle(section) {
  if (!section) return '';
  const parts = [];
  if (section.label) parts.push(section.label);
  if (section.heading) parts.push(section.heading);
  if (parts.length) return parts.join(': ');
  if (typeof section.content === 'string' && section.content.trim()) {
    const t = section.content.trim().replace(/\s+/g, ' ');
    return t.length > 80 ? t.slice(0, 79) + '…' : t;
  }
  return section.type || section.id || 'Section';
}

/** Flatten sections for TOC / list (depth-first). */
export function flattenSections(sections, depth = 0, out = []) {
  for (const s of sections || []) {
    out.push({
      id: s.id,
      title: sectionTitle(s),
      type: s.type || '',
      depth,
      section: s,
    });
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
 * Build a draft form object from a CIM section node (editable fields only).
 */
export function draftFromSection(section) {
  if (!section) {
    return {
      heading: '',
      label: '',
      content: null,
      sentences: [],
      commentary: [],
      explanation: [],
      mediaAsset: null,
    };
  }
  const sentences = Array.isArray(section.sentences)
    ? section.sentences.map((s) => {
        const f = s.formatting || {};
        return {
          id: s.id,
          text: s.text || '',
          paragraphType: f.paragraphType ?? '',
          alignment: f.alignment ?? '',
          isBullet: !!f.isBullet,
          listType: f.listType ?? '',
          indentLevel: f.indentLevel ?? 0,
        };
      })
    : [];
  const mapNotes = (arr) =>
    Array.isArray(arr)
      ? arr.map((item) => ({
          heading: item?.heading || '',
          content: item?.content || '',
        }))
      : [];
  let mediaAsset = null;
  const ma = section.mediaAsset;
  if (ma && typeof ma === 'object') {
    mediaAsset = {
      type: ma.type || '',
      content: ma.content || '',
      caption: ma.caption || '',
      altText: ma.altText || '',
    };
  }
  return {
    heading: section.heading || '',
    label: section.label || '',
    content: typeof section.content === 'string' ? section.content : null,
    sentences,
    commentary: mapNotes(section.commentary),
    explanation: mapNotes(section.explanation),
    mediaAsset,
  };
}

/**
 * Deep-clone root, locate targetId, apply draft form values only.
 * Preserves untouched keys, children, media, sentence ids, and formatting extras.
 */
export function applyDraftToRoot(rootSection, targetId, draft) {
  const root = cloneSection(rootSection);
  const node = findNodeInTree(root, targetId);
  if (!node) {
    throw new Error(`Target section ${targetId} not found under lock root`);
  }
  applyDraftToNode(node, draft);
  return root;
}

function applyDraftToNode(node, draft) {
  if (!draft) return;

  if (typeof draft.heading === 'string') node.heading = draft.heading;
  if (typeof draft.label === 'string') node.label = draft.label;

  if (draft.content !== null && draft.content !== undefined && typeof node.content === 'string') {
    node.content = String(draft.content);
  }

  if (Array.isArray(draft.sentences) && Array.isArray(node.sentences)) {
    const byId = new Map(draft.sentences.map((s) => [s.id, s]));
    for (const sent of node.sentences) {
      const d = byId.get(sent.id);
      if (!d) continue;
      sent.text = String(d.text ?? '');
      const prev = sent.formatting && typeof sent.formatting === 'object' ? { ...sent.formatting } : {};
      if (d.paragraphType !== undefined) prev.paragraphType = d.paragraphType;
      if (d.alignment !== undefined) prev.alignment = d.alignment;
      if (d.isBullet !== undefined) prev.isBullet = !!d.isBullet;
      if (d.listType !== undefined) prev.listType = d.listType;
      if (d.indentLevel !== undefined) {
        const n = Number(d.indentLevel);
        prev.indentLevel = Number.isFinite(n) ? n : 0;
      }
      sent.formatting = prev;
    }
  }

  if (Array.isArray(draft.commentary) && Array.isArray(node.commentary)) {
    draft.commentary.forEach((d, i) => {
      if (!node.commentary[i]) return;
      if (d.heading !== undefined) node.commentary[i].heading = d.heading;
      if (d.content !== undefined) node.commentary[i].content = d.content;
    });
  }

  if (Array.isArray(draft.explanation) && Array.isArray(node.explanation)) {
    draft.explanation.forEach((d, i) => {
      if (!node.explanation[i]) return;
      if (d.heading !== undefined) node.explanation[i].heading = d.heading;
      if (d.content !== undefined) node.explanation[i].content = d.content;
    });
  }

  if (draft.mediaAsset && node.mediaAsset && typeof node.mediaAsset === 'object') {
    const d = draft.mediaAsset;
    const type = String(node.mediaAsset.type || '').toUpperCase();
    if (type === 'TABLE' && d.content !== undefined) {
      node.mediaAsset.content = d.content;
    }
    if (d.caption !== undefined) node.mediaAsset.caption = d.caption;
    if (d.altText !== undefined) node.mediaAsset.altText = d.altText;
  }
}

/** Normalize url | sourcePath to a relative storage key. */
export function normalizeMediaPath(urlOrPath) {
  if (!urlOrPath || typeof urlOrPath !== 'string') return '';
  let p = urlOrPath.trim();
  if (!p) return '';
  const prefixes = [
    'https://api.digital.wbdg.org/v1/storage/files/',
    'http://api.digital.wbdg.org/v1/storage/files/',
    '/v1/storage/files/',
    'v1/storage/files/',
  ];
  for (const pre of prefixes) {
    if (p.toLowerCase().startsWith(pre.toLowerCase())) {
      p = p.slice(pre.length);
      break;
    }
  }
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep raw */
  }
  return p.replace(/^\/+/, '');
}

/**
 * Light sanitize for trusted CIM table HTML (preview only).
 */
export function sanitizeTableHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('script, iframe, object, embed, link, meta').forEach((el) => el.remove());
  tpl.content.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const n = attr.name.toLowerCase();
      if (n.startsWith('on') || n === 'srcdoc' || (n === 'href' && /^\s*javascript:/i.test(attr.value))) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return tpl.innerHTML;
}

/** Resolve a media blob URL from an imported pack map, if present. */
export function resolveMediaUrl(mediaUrls, urlOrPath) {
  const path = normalizeMediaPath(urlOrPath);
  if (!path || !mediaUrls) return null;
  if (mediaUrls.has(path)) return mediaUrls.get(path);
  if (mediaUrls.has(`media/${path}`)) return mediaUrls.get(`media/${path}`);
  const base = path.split('/').pop();
  if (base) {
    for (const [k, v] of mediaUrls) {
      if (k === base || k.endsWith(`/${base}`)) return v;
    }
  }
  return null;
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

/** Ids that should start expanded: ancestors of locked roots and of selected. */
export function defaultExpandedIds(sections, lockedIds, selectedId) {
  const exp = new Set();
  const addPath = (id) => {
    const path = findSectionPath(sections, id);
    if (!path) return;
    for (const n of path) exp.add(n.id);
  };
  for (const lid of lockedIds || []) addPath(lid);
  if (selectedId) addPath(selectedId);
  return exp;
}

export function sectionMatchesQuery(section, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const title = sectionTitle(section).toLowerCase();
  const type = String(section.type || '').toLowerCase();
  const id = String(section.id || '').toLowerCase();
  return title.includes(q) || type.includes(q) || id.includes(q);
}

export function subtreeMatchesQuery(section, query) {
  if (!query) return true;
  if (sectionMatchesQuery(section, query)) return true;
  return (section.children || []).some((c) => subtreeMatchesQuery(c, query));
}
