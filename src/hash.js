/**
 * Project canonicalization + SHA-256 for section subtrees (PACK-CONTRACT §1.5).
 * Until CIM defines a shared rule, this is normative for editor ↔ CMS.
 */

/** Recursively sort object keys; arrays keep order. */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = canonicalize(value[key]);
  }
  return out;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function bytesToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** @returns {Promise<string>} sha256:<hex> */
export async function hashSection(sectionNode) {
  const text = canonicalJson(sectionNode);
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return `sha256:${bytesToHex(digest)}`;
}
