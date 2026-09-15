import { MINIMUM_AGE } from './age';
import { PRODUCT_NAME } from './product';

/**
 * The privacy policy and the terms of service, as the one copy of each.
 *
 * `UNCONSIDERED.md` `[1]` and `[2]`. `docs/PRIVACY-FACTS.md` is what they were
 * drafted from; this is the result, and it is the **only** copy.
 *
 * ## Why they are structured data rather than two markdown files
 *
 * They have to be readable in two quite different places, and a copy in each
 * would drift — with nothing to notice, because nobody reads a policy twice:
 *
 * - **In the app, with no network.** A farm with no account and no server
 *   configured (D14) must still be able to read what it agreed to. That rules
 *   out "link to a web page" as the only answer.
 * - **At a URL.** Google Play requires a privacy policy address in the store
 *   listing, and it has to work with nothing installed.
 *
 * So the text lives here, in the package both the app and the server already
 * import, and each renders it its own way. One edit, both surfaces.
 *
 * ## Blocks rather than markdown, and no parser
 *
 * A markdown string would need a renderer on each side, and on the app side
 * that means a dependency for a document with four kinds of element in it.
 * Style asks what a dependency replaces and why the primitive is not enough;
 * here the primitive is a discriminated union of four cases, and the React
 * screen and the HTML page each handle all four exhaustively — so a block kind
 * added later fails the compiler on both instead of silently rendering as
 * nothing on one.
 */

export type LegalBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: readonly string[] }
  /**
   * An address, kept apart from a paragraph so each surface can do the right
   * thing: the web page makes it a `mailto:` and the app draws it as text it
   * does not pretend is tappable.
   */
  | { kind: 'contact'; label: string; email: string };

export interface LegalDocument {
  /** What it is called, on screen and in the browser tab. */
  title: string;
  /** Shown as written. A policy with no date is one nobody can reason about. */
  effective: string;
  blocks: readonly LegalBlock[];
}

/**
 * Who operates the service, in one place.
 *
 * Named here because both documents say it, the store listing says it, and a
 * policy naming a different operator from the terms is the kind of mismatch a
 * reviewer notices and a farm cannot resolve.
 */
export const OPERATOR = 'Steve Weed';

/** Where privacy questions and requests go. */
export const CONTACT_EMAIL = 'steve@swbuild.dev';

/** The paths the documents are served at. One constant, three callers. */
export const PRIVACY_PATH = '/privacy';
export const TERMS_PATH = '/terms';

export const PRIVACY_POLICY: LegalDocument = {
  title: `${PRODUCT_NAME} Privacy Policy`,
  effective: 'September 15, 2026',
  blocks: [
    {
      kind: 'paragraph',
      text: `${PRODUCT_NAME} is operated by ${OPERATOR} ("${PRODUCT_NAME}," "we," "us," or "our"). This Privacy Policy explains how ${PRODUCT_NAME} handles information when you use the ${PRODUCT_NAME} Android app and related services.`,
    },

    { kind: 'heading', text: 'The short version' },
    {
      kind: 'paragraph',
      text: `${PRODUCT_NAME} is built to work on your phone without an account or a server. If you never create an account, your farm records stay on your device. The only ordinary network request is an optional, coarse weather lookup.`,
    },
    {
      kind: 'paragraph',
      text: `If you create an account and use synchronization, your farm records are stored on ${PRODUCT_NAME}'s server so you can use them across devices or with farm hands.`,
    },
    {
      kind: 'paragraph',
      text: 'We do not use advertising, analytics, tracking, or crash-reporting tools. We do not sell personal information or share it for advertising.',
    },

    { kind: 'heading', text: 'Information stored on your device' },
    {
      kind: 'paragraph',
      text: `${PRODUCT_NAME} stores your farm records in its private app storage on your device. This can include livestock and treatment records, production and harvest records, tasks, inventory, notes, photographs, cached weather information, and locally queued sync changes.`,
    },
    {
      kind: 'paragraph',
      text: "Photos are resized on your device before storage. Login tokens are stored separately in your device's secure storage.",
    },
    {
      kind: 'paragraph',
      text: `Android's automatic cloud backup is disabled for ${PRODUCT_NAME}. We do not send your local records to a server unless you create an account and use entitled synchronization.`,
    },

    { kind: 'heading', text: 'Weather' },
    {
      kind: 'paragraph',
      text: `If you use weather, ${PRODUCT_NAME} sends rounded coordinates to the U.S. National Weather Service. Coordinates are rounded to two decimal places, roughly one kilometer, before they are stored or sent. We do not collect or retain precise location.`,
    },
    {
      kind: 'paragraph',
      text: 'If you choose to type an address instead of sharing location, that address is sent to the U.S. Census Bureau geocoder to find weather coordinates. The result is rounded before use.',
    },

    { kind: 'heading', text: 'Accounts and synchronization' },
    {
      kind: 'paragraph',
      text: `If you create an account and use synchronization, ${PRODUCT_NAME} stores the following on its server:`,
    },
    {
      kind: 'list',
      items: [
        'Your email address, display name, account role, account-creation date, app version, and latest sync time.',
        'A password hash if you use email-and-password sign-in.',
        'A Google account identifier, email address, and name if you choose Google Sign-In.',
        'Your synchronized farm records and photos.',
        'Sync history, invitations, join codes, hashed refresh tokens, and hashed account-verification or password-reset codes.',
        /**
         * Named because it is a device identifier, which is its own category on
         * the Play Data Safety form. "Sync history" would technically have
         * covered it and would have been the wrong level of detail to leave a
         * reviewer to infer.
         */
        'An identifier for each device that syncs, recorded with the changes it sent.',
        /**
         * Removal keeps the row so a farm can still say who wrote a record —
         * see `disableUser`. That is personal data surviving the end of
         * somebody's access, so it is disclosed rather than left to be found.
         */
        'If someone is removed from a farm, their display name and previous email address are kept with that farm so its records can still show who entered them.',
        'IP addresses and request paths in rotating infrastructure access logs, used for security and rate limiting.',
      ],
    },
    {
      kind: 'paragraph',
      text: `${PRODUCT_NAME}'s application-level request logging is disabled. Infrastructure access logs are retained in a rolling set of five 10 MiB log files.`,
    },

    { kind: 'heading', text: 'Support reports' },
    {
      kind: 'paragraph',
      text: 'If you deliberately send a support report, it becomes a GitHub issue. The report can include app and device details, sync-status information, error messages, a hashed farm identifier, and one free-text line that you choose to write.',
    },
    {
      kind: 'paragraph',
      text: `GitHub issues for this project are public. Do not include farm records, passwords, addresses, or other sensitive information in a support report. ${PRODUCT_NAME} does not send your farm records to GitHub through its current support-report process.`,
    },

    { kind: 'heading', text: 'Who receives information' },
    {
      kind: 'paragraph',
      text: 'We use the following recipients or service providers only as described above:',
    },
    {
      kind: 'list',
      items: [
        `Oracle Cloud, which hosts ${PRODUCT_NAME}'s server, database, and synchronized photo storage.`,
        'The U.S. National Weather Service, for weather lookups.',
        'The U.S. Census Bureau geocoder, when you choose typed-address weather setup.',
        'GitHub, for support reports you choose to send.',
        'Google, when you choose Google Sign-In and it is enabled.',
      ],
    },
    {
      kind: 'paragraph',
      text: 'We do not currently process Google Play purchases in production, send account email, or maintain off-site server backups.',
    },

    { kind: 'heading', text: 'Retention and deletion' },
    {
      kind: 'paragraph',
      text: 'Your local data stays on your device until you delete it, uninstall the app, or choose to clear it.',
    },
    {
      kind: 'paragraph',
      text: `You can request account deletion from within the service or through ${PRODUCT_NAME}'s account-deletion page. Account deletion immediately removes the applicable account and server-side farm data, including records, photo bytes, sync history, invitations, join codes, and sessions. It does not erase records stored on your device unless you separately choose that option.`,
    },
    {
      kind: 'paragraph',
      text: "If you are leaving a shared farm, your own account information is removed while the farm's records remain for its other owner or owners.",
    },
    /**
     * The other direction, which the first draft did not say and which matters
     * most to the people it happens to: a farm's last owner deleting takes
     * every other account on that farm with it. See `deleteFarmOn`.
     */
    {
      kind: 'paragraph',
      text: "If you are a farm's only owner, deleting your account also deletes the farm itself and the accounts of everyone else on it. The app tells you how many accounts that is before you confirm.",
    },
    {
      kind: 'paragraph',
      text: 'Deleting an account does not remove support reports already submitted to GitHub. It also does not cancel any Google Play subscription.',
    },
    {
      kind: 'paragraph',
      text: 'Before deleting an account, export any records you need to retain. You are responsible for retaining records required for your operation, including Veterinary Feed Directive, organic-certification, tax, or other legal and operational records.',
    },

    { kind: 'heading', text: 'Security' },
    {
      kind: 'paragraph',
      text: 'We use reasonable safeguards designed to protect information, including HTTPS encryption in transit, password hashing, hashed server-side tokens, Android secure storage for device credentials, and access controls that scope records to the relevant farm.',
    },
    {
      kind: 'paragraph',
      text: `No method of storage or transmission is completely secure, and we cannot guarantee absolute security. ${PRODUCT_NAME} does not currently maintain off-site backups of server data.`,
    },

    { kind: 'heading', text: 'Children' },
    {
      kind: 'paragraph',
      text: `${PRODUCT_NAME} is not directed to children under ${MINIMUM_AGE}. You must be at least ${MINIMUM_AGE} to create an ${PRODUCT_NAME} account, and the app asks you to confirm it.`,
    },
    {
      kind: 'paragraph',
      text: `A child under ${MINIMUM_AGE} may use the offline app only with a parent or guardian's supervision and may not create an account. If you believe a child under ${MINIMUM_AGE} has provided us personal information through an account, contact us and we will address the request.`,
    },

    { kind: 'heading', text: 'Your choices and questions' },
    {
      kind: 'paragraph',
      text: `You can use ${PRODUCT_NAME} without an account, decline optional location permission, use a typed address for weather, export your records, and request account deletion.`,
    },
    { kind: 'contact', label: 'For privacy questions or requests, contact Steve at', email: CONTACT_EMAIL },

    { kind: 'heading', text: 'Changes to this policy' },
    {
      kind: 'paragraph',
      text: `We may update this Privacy Policy when ${PRODUCT_NAME} changes. We will post the updated version with a new effective date. Material changes will be communicated through the app or service when appropriate.`,
    },
  ],
};

export const TERMS_OF_SERVICE: LegalDocument = {
  title: `${PRODUCT_NAME} Terms of Service`,
  effective: 'September 15, 2026',
  blocks: [
    {
      kind: 'paragraph',
      text: `These Terms of Service govern your use of the ${PRODUCT_NAME} Android app and related services. ${PRODUCT_NAME} is operated by ${OPERATOR} ("${PRODUCT_NAME}," "we," "us," or "our").`,
    },
    { kind: 'paragraph', text: `By using ${PRODUCT_NAME}, you agree to these Terms.` },

    { kind: 'heading', text: `What ${PRODUCT_NAME} does` },
    {
      kind: 'paragraph',
      text: `${PRODUCT_NAME} is an offline-first farm record book. It helps you record farm activity such as livestock, treatments, production, harvests, tasks, inventory, notes, and photographs.`,
    },
    {
      kind: 'paragraph',
      text: 'You can use the app without an account. An account may enable server synchronization, use across devices, and shared access with farm hands when those features are available to your farm.',
    },

    { kind: 'heading', text: 'Accounts' },
    {
      kind: 'paragraph',
      text: `You must be at least ${MINIMUM_AGE} years old to create an account, and you confirm it when you make one. You are responsible for providing accurate account information, safeguarding your credentials, and promptly notifying us if you believe your account has been accessed without authorization.`,
    },
    {
      kind: 'paragraph',
      text: "You may not share your credentials or use another person's account without permission.",
    },

    { kind: 'heading', text: 'Your farm records' },
    {
      kind: 'paragraph',
      text: `You own the farm records, notes, and photos you enter into ${PRODUCT_NAME}.`,
    },
    {
      kind: 'paragraph',
      text: 'If you use synchronization, you give us the limited permission needed to store, process, transmit, and display your records solely to provide and secure the service for you and the people you authorize to access your farm.',
    },
    {
      kind: 'paragraph',
      text: 'You are responsible for ensuring that you have the rights and permissions needed to enter, share, and synchronize your records.',
    },

    { kind: 'heading', text: 'Your responsibility for records and compliance' },
    {
      kind: 'paragraph',
      text: `${PRODUCT_NAME} is a recordkeeping tool. It does not replace your obligation to retain records required by law, your certifier, your veterinarian, your buyer, or your operation.`,
    },
    {
      kind: 'paragraph',
      text: 'Before deleting an account or local data, export the records you need to keep. This may include Veterinary Feed Directive records, organic-certification records, tax records, animal-health records, or other records subject to a retention requirement.',
    },
    {
      kind: 'paragraph',
      text: `${PRODUCT_NAME} does not provide veterinary, medical, legal, tax, food-safety, or regulatory advice. Withdrawal dates and other calculations depend on what was entered. Follow the product label, your veterinarian's instructions, and applicable law.`,
    },

    { kind: 'heading', text: 'Acceptable use' },
    { kind: 'paragraph', text: `You may not use ${PRODUCT_NAME} to:` },
    {
      kind: 'list',
      items: [
        "Break the law or violate another person's rights.",
        'Interfere with, damage, reverse engineer, or disrupt the service.',
        "Attempt to access another farm's records without authorization.",
        'Upload malware or harmful code.',
        'Use the service to distribute unlawful, infringing, or abusive material.',
      ],
    },
    {
      kind: 'paragraph',
      text: 'We may suspend or end access that violates these Terms or creates a security risk.',
    },

    { kind: 'heading', text: 'Availability and changes' },
    {
      kind: 'paragraph',
      text: `We work to keep ${PRODUCT_NAME} available and useful, but it is provided as available. Features may change, be improved, or be discontinued. Internet access, third-party services, device compatibility, and other factors can affect operation.`,
    },
    {
      kind: 'paragraph',
      text: `You should keep your own exports of important records. ${PRODUCT_NAME} does not currently maintain off-site server backups.`,
    },

    { kind: 'heading', text: 'Privacy' },
    {
      kind: 'paragraph',
      text: `Our handling of personal information is described in the ${PRODUCT_NAME} Privacy Policy. By using ${PRODUCT_NAME}, you acknowledge that information may be handled as described there.`,
    },

    { kind: 'heading', text: 'Intellectual property' },
    {
      kind: 'paragraph',
      text: `${PRODUCT_NAME}, its software, design, and branding are protected by applicable intellectual-property laws. These Terms give you a personal, limited, non-transferable right to use the service as intended. They do not transfer ownership of ${PRODUCT_NAME} to you.`,
    },

    { kind: 'heading', text: 'Disclaimer of warranties' },
    {
      kind: 'paragraph',
      text: `To the maximum extent allowed by law, ${PRODUCT_NAME} is provided "as is" and "as available," without warranties of any kind, whether express, implied, or statutory. We do not guarantee that the service will be uninterrupted, error-free, secure, or suitable for every purpose.`,
    },

    { kind: 'heading', text: 'Limitation of liability' },
    {
      kind: 'paragraph',
      text: `To the maximum extent allowed by law, ${PRODUCT_NAME} and ${OPERATOR} will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost data, profits, goodwill, or business opportunities arising from your use of the service.`,
    },
    {
      kind: 'paragraph',
      text: `Our total liability for any claim related to the service will not exceed the greater of $100 or the amount you paid us for ${PRODUCT_NAME} during the 12 months before the event giving rise to the claim.`,
    },
    {
      kind: 'paragraph',
      text: 'Some jurisdictions do not allow certain limitations, so some of these limits may not apply to you.',
    },

    { kind: 'heading', text: 'Ending use' },
    {
      kind: 'paragraph',
      text: `You may stop using ${PRODUCT_NAME} at any time. You may delete your account using the available deletion process. We may suspend or terminate access when reasonably necessary to protect the service, users, or others, or if you materially violate these Terms.`,
    },
    {
      kind: 'paragraph',
      text: 'Sections that by their nature should continue after termination, including ownership, disclaimers, liability limits, and governing law, will continue.',
    },

    { kind: 'heading', text: 'Governing law and venue' },
    {
      kind: 'paragraph',
      text: 'Kansas law governs these Terms, without regard to conflict-of-law rules. Any dispute arising from these Terms or the service must be brought in the state or federal courts with jurisdiction in Crawford County, Kansas, unless applicable law requires otherwise.',
    },

    { kind: 'heading', text: 'Changes to these Terms' },
    {
      kind: 'paragraph',
      text: `We may update these Terms as ${PRODUCT_NAME} changes. We will post the updated Terms with a new effective date. Continuing to use the service after the effective date means you accept the updated Terms.`,
    },

    { kind: 'contact', label: 'For questions about these Terms, contact Steve at', email: CONTACT_EMAIL },
  ],
};
