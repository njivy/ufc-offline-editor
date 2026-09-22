import JSZip from 'jszip';
import { normalizeContent, findSectionById, sectionSnippet, uid, nowIso } from './content.js';
import { hashSection } from './hash.js';

const CHECKOUT_FORMAT = 'ufc-offline-checkout-pack';
const PROPOSAL_FORMAT = 'ufc-offline-proposal-pack';

function findZipEntry(zip, predicate) {
  return Object.keys(zip.files).find((p) => !zip.files[p].dir && predicate(p));
}

/**
 * Import a checkout pack ZIP (or bare content.json for read-only).
 * @returns {Promise<{ content, rawContent, manifest, lockedIds: Set<string>, warnings: string[] }>}
 */
export async function importCheckoutPack(file) {
  const name = (file.name || '').toLowerCase();
  const warnings = [];

  if (name.endsWith('.json')) {
    const raw = JSON.parse(await file.text());
    const content = normalizeContent(raw);
    warnings.push('No checkout manifest — imported as read-only (no locks).');
    return {
      content,
      rawContent: raw,
      manifest: null,
      lockedIds: new Set(),
      warnings,
      sourceLabel: file.name,
      mediaBlobs: new Map(),
    };
  }

  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  // Prefer content.json by name; else first non-meta .json that isn't a manifest
  let contentEntry =
    findZipEntry(zip, (p) => /(^|\/)content\.json$/i.test(p)) ||
    findZipEntry(
      zip,
      (p) =>
        p.toLowerCase().endsWith('.json') &&
        !/checkout-manifest\.json$/i.test(p) &&
        !/proposal\.json$/i.test(p)
    );
  if (!contentEntry) {
    throw new Error('Checkout ZIP has no content.json');
  }

  const rawContent = JSON.parse(await zip.files[contentEntry].async('string'));
  const content = normalizeContent(rawContent);

  const manifestEntry =
    findZipEntry(zip, (p) => /(^|\/)meta\/checkout-manifest\.json$/i.test(p)) ||
    findZipEntry(zip, (p) => /(^|\/)checkout-manifest\.json$/i.test(p));

  let manifest = null;
  const lockedIds = new Set();

  if (!manifestEntry) {
    warnings.push('No meta/checkout-manifest.json — read-only (no locks).');
  } else {
    manifest = JSON.parse(await zip.files[manifestEntry].async('string'));
    if (manifest.format !== CHECKOUT_FORMAT) {
      throw new Error(
        `Unexpected checkout format "${manifest.format}" (expected ${CHECKOUT_FORMAT})`
      );
    }
    if (manifest.formatVersion !== 1) {
      throw new Error(`Unsupported checkout formatVersion ${manifest.formatVersion}`);
    }
    if (
      manifest.baseVersionId &&
      manifest.baseVersionId !== content.criterion.versionId
    ) {
      warnings.push(
        `Manifest baseVersionId (${manifest.baseVersionId}) ≠ content versionId (${content.criterion.versionId}).`
      );
    }
    for (const lock of manifest.locks || []) {
      if (!lock.sectionId) continue;
      if (!findSectionById(content.sections, lock.sectionId)) {
        warnings.push(`Lock references unknown sectionId ${lock.sectionId}`);
        continue;
      }
      lockedIds.add(lock.sectionId);
      if (lock.expiresAt) {
        const exp = Date.parse(lock.expiresAt);
        if (!Number.isNaN(exp) && exp < Date.now()) {
          warnings.push(
            `Lock on ${lock.sectionId} expired at ${lock.expiresAt} (editor soft-warn; CMS will hard-reject).`
          );
        }
      }
    }
  }

  // Optional media/ blobs for IMAGE display / proposal media ops
  const mediaBlobs = new Map();
  for (const p of Object.keys(zip.files)) {
    if (zip.files[p].dir) continue;
    const m = p.match(/(?:^|\/)media\/(.+)$/i);
    if (!m) continue;
    const rel = m[1].replace(/^\/+/, '');
    const bytes = await zip.files[p].async('uint8array');
    const lower = rel.toLowerCase();
    let mime = 'application/octet-stream';
    if (lower.endsWith('.png')) mime = 'image/png';
    else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg';
    else if (lower.endsWith('.gif')) mime = 'image/gif';
    else if (lower.endsWith('.webp')) mime = 'image/webp';
    else if (lower.endsWith('.svg')) mime = 'image/svg+xml';
    mediaBlobs.set(rel, new Blob([bytes], { type: mime }));
    // Also index without leading folders variants by basename path as stored
    mediaBlobs.set(rel.replace(/^\.\//, ''), new Blob([bytes], { type: mime }));
  }

  return {
    content,
    rawContent,
    manifest,
    lockedIds,
    warnings,
    sourceLabel: file.name,
    mediaBlobs,
  };
}

/**
 * Build proposal.json + ZIP from session state.
 * @param {object} opts
 * @param {object} opts.content - normalized content
 * @param {object} opts.rawContent - original content.json bytes shape
 * @param {object|null} opts.manifest
 * @param {Map<string, { afterSection, rationale, changeId?, createdAt?, beforeHash }>} opts.changesBySectionId
 * @param {object} opts.author - { id, displayName?, email? }
 * @param {boolean} [opts.authorOverridden]
 */
export async function buildProposalPack({
  content,
  rawContent,
  manifest,
  changesBySectionId,
  author,
}) {
  const changes = [];
  const now = nowIso();

  for (const [sectionId, ch] of changesBySectionId.entries()) {
    const rationale = (ch.rationale || '').trim();
    if (!rationale) {
      throw new Error(`Change for section ${sectionId} is missing required rationale`);
    }
    const baseSection = findSectionById(content.sections, sectionId);
    if (!baseSection) {
      throw new Error(`Section ${sectionId} not found in base content`);
    }
    const beforeHash = ch.beforeHash || (await hashSection(baseSection));
    changes.push({
      changeId: ch.changeId || uid('chg'),
      target: {
        sectionId,
        granularity: 'section',
      },
      before: {
        contentHash: beforeHash,
        snippet: sectionSnippet(baseSection),
      },
      after: {
        section: ch.afterSection,
      },
      rationale,
      author: {
        id: author.id,
        displayName: author.displayName,
        email: author.email,
      },
      createdAt: ch.createdAt || now,
      updatedAt: now,
    });
  }

  if (!changes.length) {
    throw new Error('No tracked changes to export');
  }

  const lockSectionIds = (manifest?.locks || []).map((l) => l.sectionId).filter(Boolean);
  const earliestExpiry = (manifest?.locks || [])
    .map((l) => l.expiresAt)
    .filter(Boolean)
    .sort()[0];

  const proposal = {
    format: PROPOSAL_FORMAT,
    formatVersion: 1,
    proposalId: uid('prop'),
    createdAt: now,
    updatedAt: now,
    baseVersionId: content.criterion.versionId,
    designation: content.criterion.designation || manifest?.designation || '',
    marking: manifest?.marking ?? null,
    author: {
      id: author.id,
      displayName: author.displayName,
      email: author.email,
    },
    checkout: {
      assigneeId: manifest?.assignee?.id || author.id,
      lockSectionIds,
      lockExpiresAt: earliestExpiry || null,
    },
    contentPath: 'content.json',
    changes,
    media: [],
  };

  const zip = new JSZip();
  zip.file('proposal.json', JSON.stringify(proposal, null, 2));
  // Embed base content.json (recommended / v0 default)
  zip.file(
    'content.json',
    typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent, null, 2)
  );

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, proposal };
}

export { CHECKOUT_FORMAT, PROPOSAL_FORMAT };
