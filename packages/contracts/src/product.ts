/**
 * What the product is called, in one place.
 *
 * ## Why this is a constant and not twenty string literals
 *
 * The name was Steading until 19 August 2026, when `UNCONSIDERED.md` §13 found
 * `brechy.com/apps/steading` — the same word, the same product, and the same
 * *"Scottish for farmstead"* argument, published by somebody else. Renaming
 * meant editing twenty sentences scattered across two apps and the contracts
 * package, and finding all twenty took an audit.
 *
 * **The farm reads the server's words more often than the app's**, which was the
 * part that surprised everybody: three of those strings are in `apps/mobile`
 * and fifteen are on the server — six copies of one sentence about a taken
 * email, two mail subjects and their bodies, the operations page, the support
 * gist. A rename that stopped at the app would have left the old name in every
 * message the product sends.
 *
 * So it is a constant. The next one is this line.
 *
 * ## What it deliberately does not rename
 *
 * Nothing internal. The `@steading/*` workspace names, the `steading-{orgId}.db`
 * filename, the `steading://` scheme, the `steading-<version>-<code>.apk`
 * artefact, the systemd units and `/opt/steading` all stay — no farmer, no
 * reviewer and no store listing ever sees them, and each one is a migration
 * rather than an edit. Two are actively load-bearing: the APK stem is how
 * `deploy.sh` decides the shelf is current, and the slug is bound to the EAS
 * project id.
 *
 * **The Android package is `dev.swbuild.homefarm`, which names the publisher
 * and the category rather than the brand.** A package name is permanent from
 * the first Play upload, so it is the one identifier that must survive a change
 * of name — and this project has already had one name taken out from under it
 * by somebody who reached it independently. Putting the brand inside the
 * permanent thing would mean the next collision costs the install base rather
 * than a display name.
 */
export const PRODUCT_NAME = 'Evenglow';
