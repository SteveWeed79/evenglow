import { describe, expect, it } from 'vitest';
import {
  CONTACT_EMAIL,
  type LegalDocument,
  OPERATOR,
  PRIVACY_PATH,
  PRIVACY_POLICY,
  PRODUCT_NAME,
  TERMS_OF_SERVICE,
  TERMS_PATH,
} from '@homefarm/contracts';

/**
 * The privacy policy and the terms, as documents.
 *
 * **These are the two files in the repository whose accuracy is an enforcement
 * matter rather than a defect.** An inaccurate Data Safety declaration is not a
 * rejection, it is something a regulator acts on — so what is tested here is not
 * prose quality, which no test can judge, but the handful of facts that would
 * make the documents *wrong* if the code moved underneath them.
 *
 * `docs/PRIVACY-FACTS.md` is what they were drafted from and names each source
 * file. This is the subset that can be checked mechanically.
 */

const documents: [string, LegalDocument][] = [
  ['privacy policy', PRIVACY_POLICY],
  ['terms of service', TERMS_OF_SERVICE],
];

describe('both documents', () => {
  it.each(documents)('%s names itself, its operator and a date', (_name, document) => {
    expect(document.title).toContain(PRODUCT_NAME);
    // A policy with no date is one nobody can reason about — "is this the
    // version I agreed to" has no answer without it.
    expect(document.effective).not.toBe('');
    expect(document.blocks.length).toBeGreaterThan(5);
  });

  /**
   * The operator has to be the same person in both. A policy naming one and
   * terms naming another is a mismatch a reviewer notices and a farm cannot
   * resolve.
   */
  it.each(documents)('%s names the same operator', (_name, document) => {
    expect(text(document)).toContain(OPERATOR);
  });

  /** Somewhere to send a request, or the rights described are not exercisable. */
  it.each(documents)('%s gives a way to make contact', (_name, document) => {
    const contact = document.blocks.filter((block) => block.kind === 'contact');
    expect(contact).toHaveLength(1);
    expect(contact[0]).toMatchObject({ email: CONTACT_EMAIL });
  });

  /**
   * Every block is one of the four kinds both renderers handle. A kind neither
   * knows would render as nothing on the one page a store reviewer reads.
   */
  it.each(documents)('%s uses only renderable blocks', (_name, document) => {
    for (const block of document.blocks) {
      expect(['heading', 'paragraph', 'list', 'contact']).toContain(block.kind);
    }
  });

  /** An empty heading or paragraph is a rendering bug that reads as an omission. */
  it.each(documents)('%s has no empty block', (_name, document) => {
    for (const block of document.blocks) {
      if (block.kind === 'heading' || block.kind === 'paragraph') {
        expect(block.text.trim()).not.toBe('');
      }
      if (block.kind === 'list') {
        expect(block.items.length).toBeGreaterThan(0);
        for (const item of block.items) expect(item.trim()).not.toBe('');
      }
    }
  });
});

describe('the privacy policy says what the code actually does', () => {
  /**
   * Each of these is a claim `docs/PRIVACY-FACTS.md` verified against a named
   * source file. They are asserted here so that deleting the sentence is a
   * failing test rather than a silent change to what a farm was told.
   */
  const policy = text(PRIVACY_POLICY);

  it('says there is no advertising, analytics or tracking', () => {
    expect(policy).toContain('We do not use advertising, analytics, tracking, or crash-reporting tools');
    expect(policy).toContain('We do not sell personal information');
  });

  it('says location is coarse and never precise', () => {
    expect(policy).toContain('two decimal places');
    expect(policy).toContain('We do not collect or retain precise location');
  });

  it('names every recipient the app can reach', () => {
    for (const recipient of [
      'Oracle Cloud',
      'National Weather Service',
      'Census Bureau',
      'GitHub',
      'Google',
    ]) {
      expect(policy, `${recipient} is missing`).toContain(recipient);
    }
  });

  /**
   * The database moved onto the box and that cluster was deleted. Naming a
   * processor that holds nothing is the error that survives review and fails an
   * audit, so it is asserted absent rather than trusted to stay absent.
   */
  it('does not name a processor that holds nothing', () => {
    expect(policy).not.toContain('Atlas');
    expect(policy).not.toContain('MongoDB');
  });

  /**
   * Backups do not exist yet. Until the bucket and its lifecycle rule are
   * configured, a retention promise would describe something that is not
   * happening — so the policy says the honest thing instead.
   *
   * **When backups are configured this test is the reminder**: it fails, and
   * whoever configured them writes the 30-day sentence.
   */
  it('says there are no off-site backups, because there are none', () => {
    expect(policy).toContain('do not currently');
    expect(policy).toContain('off-site');
  });

  /**
   * The free-text line is the one place a person can put anything, and the
   * issues are public. Describing the bundle as harmless without saying so
   * would be the policy being wrong in the farm's disfavour.
   */
  it('warns that support reports become public issues', () => {
    expect(policy).toContain('GitHub issues for this project are public');
  });

  /**
   * The half the first draft did not carry, and the one that matters most to
   * the people it happens to: a last owner's deletion takes every other account
   * on that farm. See `deleteFarmOn`.
   */
  it('says a last owner deleting takes everyone else on the farm', () => {
    expect(policy).toContain("If you are a farm's only owner");
    expect(policy).toContain('the accounts of everyone else on it');
  });

  /**
   * Removal keeps the row so a farm can still say who wrote a record, which is
   * personal data outliving somebody's access. Disclosed rather than left to be
   * discovered.
   */
  it('discloses what is kept about somebody removed from a farm', () => {
    expect(policy).toContain('removed from a farm');
    expect(policy).toContain('previous email address');
  });

  /** A device identifier is its own Data Safety category. */
  it('discloses the per-device identifier', () => {
    expect(policy).toContain('identifier for each device');
  });
});

describe('the terms', () => {
  const terms = text(TERMS_OF_SERVICE);

  /** It must match the line the app itself shows beside a withdrawal. */
  it('disclaims veterinary advice in the same terms the app does', () => {
    expect(terms).toContain('does not provide veterinary');
    expect(terms).toContain('depend on what was entered');
  });

  /** The farm owns its records; anything else would contradict the export. */
  it('says the farm owns its records', () => {
    expect(terms).toContain('You own the farm records');
  });

  /** Retention is the farmer's obligation, which is how the app can delete on request. */
  it('puts the retention obligation where the app cannot carry it', () => {
    expect(terms).toContain('Veterinary Feed Directive');
    expect(terms).toContain('export the records you need to keep');
  });
});

describe('the addresses the store listing will use', () => {
  it('are absolute paths and distinct', () => {
    expect(PRIVACY_PATH.startsWith('/')).toBe(true);
    expect(TERMS_PATH.startsWith('/')).toBe(true);
    expect(PRIVACY_PATH).not.toBe(TERMS_PATH);
  });
});

/** Every word in a document, for the assertions above. */
function text(document: LegalDocument): string {
  return document.blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading':
        case 'paragraph':
          return block.text;
        case 'list':
          return block.items.join(' ');
        case 'contact':
          return `${block.label} ${block.email}`;
      }
    })
    .join('\n');
}
