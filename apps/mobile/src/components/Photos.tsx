import { useCallback, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { newId } from '@steading/contracts';
import { listPhotos, type Photo } from '@steading/core/read/photos';
import { localStore } from '@steading/core/db/store';
import { capture, forgetBytes, hasBytes, photoUri } from '../photos/store';
import { Confirm, Failure, Secondary } from './Form';
import { Icon } from './Icon';
import { Body, Panel } from './Panel';
import { Touch } from './Touch';
import { useLive } from '../hooks/useLive';
import { useLog } from '../hooks/useSync';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * The photos kept against one thing.
 *
 * Offered where a picture is the record and words are not: **a receipt or a
 * manual on a machine**, and **evidence** — a wound, a kill, a diseased leaf.
 * Not on animals as portraits; see `photos/store.ts` and the roadmap for why
 * that case was refused rather than forgotten.
 *
 * ## A strip, not a grid
 *
 * These are attachments to a record rather than an album. A grid says "browse
 * me" and invites a farm to treat the app as a photo library, which is the
 * thing that would actually cost the space. A strip says "there are three of
 * these" and gets out of the way.
 *
 * ## Tapping one opens it, and that is where Remove lives
 *
 * Two problems, one shape — the same one the notes thread had. Every thumbnail
 * carried a permanent "Remove" button underneath it, so a strip of three drew
 * three destructive controls for an action nobody takes often; and the
 * thumbnail itself did nothing at all when pressed. A receipt at 128px cannot
 * be read, and the one thing somebody wants from it — see it bigger — was the
 * one thing there was no way to ask for.
 *
 * So the photo is the control. Tapping one opens it below the strip at a size
 * a receipt can actually be read at, with the date it was taken and the way to
 * remove it. Tapping it again folds it away. One at a time, so the panel stays
 * the size of a panel.
 *
 * Larger in place rather than a full-screen viewer: a modal is a route you
 * have to get out of, and this is an attachment on a screen somebody came to
 * for something else.
 *
 * ## A photo this device does not have yet, and it says so
 *
 * The record syncs before the bytes do — that is the design, not a fault — so
 * a second phone knows a photo exists for a while before it can show it.
 * Rather than a grey box that reads as a bug, the frame says what is
 * happening. See `sync/photos.ts` for the transfer that closes the gap.
 *
 * **This copy is load-bearing and was rewritten when upload landed.** It used
 * to say the picture would arrive "when they are both on the same network",
 * which described a peer-to-peer transfer this app has never done and now
 * definitely does not — the bytes go via the server like everything else.
 */

/** How many thumbnails the closed row shows before the badge does the talking. */
const PREVIEW = 3;

export function Photos({
  subjectId,
  what,
}: {
  subjectId: string;
  /** The farm's word for the thing — "the tractor", "these hens". */
  what: string;
}): React.ReactElement {
  const all = useLive(listPhotos, 'your photos');
  const log = useLog();
  const { colors } = useTheme();

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Which photo is open, at most one — see the note above. */
  const [open, setOpen] = useState<string | null>(null);

  const add = useCallback(
    async (source: 'camera' | 'library'): Promise<void> => {
      setProblem(null);
      setBusy(true);

      try {
        // Minted first, because the id is the filename — see `photoFile`.
        const id = newId();

        /**
         * Written down before the camera opens, because the camera is where
         * this app stops being in control.
         *
         * Android can destroy the activity while the camera is in front of it,
         * and the app that comes back is a new one — reported as "Steading
         * takes the pic then restarts and the pic is lost". The id and the
         * subject lived in this closure, which is the first thing to go.
         *
         * Only for the camera. The library picker hands back an image without
         * the same lifecycle, and a pending note left by it would be a
         * recovery attempt for something that never went missing.
         */
        if (source === 'camera') {
          await localStore()
            .setPendingPhoto({ id, subjectId, at: Date.now() })
            .catch(() => undefined);
        }

        const taken = await capture(id, source);

        // Cancelled, or the camera refused. Not a failure and not a message.
        if (taken === null) return;

        await log({
          entity: 'photo',
          op: 'create',
          targetId: id,
          payload: {
            subjectId,
            contentType: 'image/jpeg',
            byteSize: taken.byteSize,
            capturedAt: taken.capturedAt,
          },
        });
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'That photo could not be kept.');
      } finally {
        setBusy(false);
      }
    },
    [log, subjectId],
  );

  const remove = useCallback(
    (photo: Photo) => {
      // The record is archived, never deleted (P13). The bytes genuinely go —
      // they are not the audit trail, they are the weight.
      forgetBytes(photo.id);
      void log({ entity: 'photo', op: 'delete', targetId: photo.id, payload: {} });
      // Nothing left to have open. Without this the panel keeps a slot for a
      // photo that is no longer in the list.
      setOpen(null);
    },
    [log],
  );

  /**
   * `null` is "not read yet", and it must not be drawn as "there are none".
   *
   * This shipped as `(all ?? []).filter(...)`, so a group with photos showed
   * *"A receipt, a manual, or something you want to remember…"* for the beat
   * before the store answered — telling somebody their photos were gone, every
   * time they opened the group, and then contradicting itself.
   *
   * The same mistake as My Farm's blank screen, which is why it is worth
   * naming rather than just fixing: `useLive` returns `null` for a read in
   * flight, and any component that flattens that into an empty list has
   * promised something it does not know. The buttons are safe to show either
   * way — they are right before and after — so only the *claim* waits.
   */
  const read = all !== null;
  const mine = (all ?? []).filter((photo) => photo.subjectId === subjectId);

  /**
   * Closed until asked for, which is a ranking rather than a preference.
   *
   * This panel was the only attachment on the screen that stayed open, and it
   * was **largest when it had nothing in it** — an empty well plus two buttons,
   * roughly 200px, sitting above `Log a feed`, `Log a job done` and `Record a
   * treatment`. Three of the four daily acts pushed toward the fold by an
   * occasional one.
   *
   * `GroupScreen`'s own comment already sets the rule this now follows: the
   * split is "by how often a thing is done", which is why weighing, produce,
   * the named animals and the breeding book sit behind one tap. Photographs are
   * evidence — a wound, a kill, a receipt — and evidence is occasional by
   * definition. Notes, directly above, has been a single row all along; this is
   * the same shape for the same reason.
   *
   * The cost is one tap before the camera, and R1 is untouched by it: the
   * five-second rule is about a daily *log*, and a photograph is not one.
   */
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    // Only the ones this device can actually draw. A frame that says the bytes
    // are absent is worth a panel and is not worth a thumbnail.
    const shown = mine.filter((photo) => hasBytes(photo.id)).slice(0, PREVIEW);

    /**
     * The closed row is a third place this fact gets stated, and it inherited
     * the sentence the other two had already been corrected out of.
     *
     * Reaching this line means `mine` is non-empty and *none* of it has bytes
     * here, so "not on this phone" is unconditionally true of every one of
     * them. "Still coming" is the stronger claim and is only made when the
     * server holds all of them — one photo with no `uploadedAt` in the set is
     * one that may be gone, and a summary line has no room to say which.
     */
    const coming = mine.every((photo) => photo.uploadedAt !== undefined);

    return (
      <Touch
        affordance="disclose"
        onPress={() => setExpanded(true)}
        accessibilityRole="button"
        accessibilityLabel={
          mine.length === 0
            ? `Add a photo of ${what}`
            : `${mine.length} photos of ${what}. Tap to open them.`
        }
        testID={`photos-open-${subjectId}`}
        style={({ pressed }) => [
          styles.collapsed,
          {
            backgroundColor: colors.raised,
            borderColor: colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <View style={styles.collapsedWords}>
          <View style={styles.head}>
            <Text style={[styles.label, { color: colors.muted }]}>Photos</Text>
            {mine.length > 0 ? (
              <View style={[styles.badge, { backgroundColor: colors.lantern }]}>
                <Text style={[styles.badgeCount, { color: colors.lanternOn }]}>{mine.length}</Text>
              </View>
            ) : null}
          </View>

          {/* Silent until the store answers, for the reason above: a row that
              says "add a photo" to a group that has four is a lie told every
              time the screen opens. */}
          {!read ? null : shown.length > 0 ? (
            <View style={styles.previewStrip}>
              {shown.map((photo) => (
                <Image
                  key={photo.id}
                  source={{ uri: photoUri(photo.id) }}
                  style={[styles.thumb, { borderColor: colors.border }]}
                />
              ))}
            </View>
          ) : (
            <Text style={[styles.preview, { color: colors.ink }]} numberOfLines={1}>
              {mine.length === 0
                ? 'A receipt, a manual, or evidence'
                : coming
                  ? 'Still coming'
                  : 'Not on this phone'}
            </Text>
          )}
        </View>

        <Icon name="forward" size={20} color={colors.muted} />
      </Touch>
    );
  }

  return (
    <Panel label={mine.length === 0 ? 'Photos' : `Photos (${mine.length})`}>
      {/* The empty state used to promise every photo was "shared with the
          farm's other phones when there is signal" — unconditionally, to a
          farm that may have no account at all and whose bytes therefore never
          leave the handset. The same overpromise the tile made, in the one
          place somebody reads before deciding to rely on it. */}
      {!read ? null : mine.length === 0 ? (
        <Body>
          A receipt, a manual, or something you want to remember the look of — a wound, a kill,
          a leaf. Shrunk to save space, and copied to the farm server once this farm is
          syncing — until then this phone holds the only one.
        </Body>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
          >
            {mine.map((photo) => (
              <Touch affordance="disclose"
                key={photo.id}
                onPress={() => setOpen(open === photo.id ? null : photo.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open === photo.id }}
                accessibilityLabel={`Photo of ${what}, ${taken(photo)}. Tap to open it.`}
                testID={`photo-${photo.id}`}
                style={({ pressed }) => [styles.item, { opacity: pressed ? 0.7 : 1 }]}
              >
                {hasBytes(photo.id) ? (
                  <Image
                    source={{ uri: photoUri(photo.id) }}
                    style={[
                      styles.shot,
                      { borderColor: open === photo.id ? colors.lanternInk : colors.border },
                    ]}
                  />
                ) : (
                  /* Said rather than shown as a grey square, which reads as a
                     bug. The record travelled; the image has not, yet. */
                  <View
                    style={[
                      styles.missing,
                      { borderColor: open === photo.id ? colors.lanternInk : colors.border },
                    ]}
                  >
                    {/**
                      * "On the other phone" - and there was not another phone.
                      *
                      * Reported from a one-handset farm looking at a photo it
                      * had taken itself. The label asserted a second device
                      * that has never existed on that farm, which is not a
                      * thing this app can know: what it knows is that the
                      * bytes are not here.
                      *
                      * `uploadedAt` separates the two real cases and the
                      * opened row below already branches on it correctly. The
                      * thumbnail did not, so the tile and the sentence under
                      * it disagreed.
                      */}
                    <Text style={[styles.label, { color: colors.muted }]}>
                      {photo.uploadedAt === undefined ? 'Not on this phone' : 'Still coming'}
                    </Text>
                  </View>
                )}
              </Touch>
            ))}
          </ScrollView>

          {mine
            .filter((photo) => photo.id === open)
            .map((photo) => (
              <View key={photo.id} style={styles.opened} testID={`photo-open-${photo.id}`}>
                {hasBytes(photo.id) ? (
                  <>
                    {/* Full width and square-ish: a receipt at 128px is not a
                        receipt, it is a thumbnail of one. `contain` because
                        these are documents as often as they are pictures, and
                        cropping a receipt loses the total. */}
                    <Image
                      source={{ uri: photoUri(photo.id) }}
                      resizeMode="contain"
                      style={[styles.large, { borderColor: colors.border }]}
                      accessibilityLabel={`Photo of ${what}, ${taken(photo)}`}
                    />
                    {/**
                      * Said while the picture still exists, which is the only
                      * time saying it is any use.
                      *
                      * A photograph is the one thing in this app that can be
                      * lost for good. Records are safe three ways over — they
                      * are in SQLite, they go to the server as mutations, and
                      * the backup file carries them. Bytes have exactly one
                      * copy until they upload, and `BACKUP_EXCLUDES` means a
                      * backup will not save them: `buildBackup` writes records,
                      * and twenty megabytes of JPEG in a JSON file is not a
                      * backup anybody can send anywhere.
                      *
                      * So a farm with no account, or one that has not synced
                      * since taking this, is holding the only copy and had no
                      * way to know. That is how a picture goes missing and the
                      * app looks perfectly healthy — reported exactly that way,
                      * from a phone that had wiped its own storage between the
                      * photo being taken and being looked for.
                      *
                      * `uploadedAt` is set by `sync/photos.ts` once the bytes
                      * are on the server, so its absence is precisely "this is
                      * the only copy". Muted, one line, no colour: it is a fact
                      * worth knowing, not an alarm, and the alarming version
                      * would be a badge on every photo of a farm that has
                      * chosen to stay on one phone.
                      */}
                    {photo.uploadedAt === undefined ? (
                      <Text style={[styles.label, { color: colors.muted }]}>
                        Only on this phone — a backup file will not carry it
                      </Text>
                    ) : null}
                  </>
                ) : (
                  /**
                   * Two different facts wore one sentence, and a restore is
                   * what made the difference matter.
                   *
                   * *"The picture is still coming"* is true of a photo the
                   * server has: another phone uploaded it, this one fetches it
                   * on the next pass. It is **false** of a photo whose bytes
                   * were only ever on the handset that took them — which is
                   * every photo in a farm that restored from a backup, because
                   * a backup carries records and not bytes.
                   *
                   * `uploadedAt` is exactly that distinction and it has been on
                   * the record since it was written. Telling somebody a
                   * photograph is on its way when it is gone is the worst
                   * version of this screen being wrong.
                   *
                   * **Neither sentence may claim a second phone.** Both did,
                   * and a farm with one handset reported it: "there is not
                   * another phone." Whether one exists is not something this
                   * app can know — a record with no `uploadedAt` is a picture
                   * the server never received, and where it is now depends on
                   * which device took it, which is exactly the fact that is
                   * absent. So the copy says what is true of this phone and
                   * names the loss as conditional, rather than inventing a
                   * handset to put the blame on.
                   */
                  <Body>
                    {photo.uploadedAt === undefined
                      ? 'This picture never reached the farm server, so it only ever existed on the handset that took it. If that was this phone, the photograph is gone and this record is what is left of it — a backup file carries records, not pictures.'
                      : 'The record is here and the picture is still coming — it arrives the next time this phone has signal and a moment spare.'}
                  </Body>
                )}

                <Text style={[styles.label, { color: colors.muted }]}>{taken(photo)}</Text>

                <Confirm
                  label="Remove"
                  armedLabel="Tap again"
                  testID={`photo-remove-${photo.id}`}
                  onConfirm={() => remove(photo)}
                />
              </View>
            ))}
        </>
      )}

      <Failure message={problem} />

      {/**
        * Two halves of one row, rather than two buttons that happened to be
        * adjacent.
        *
        * They were shrink-wrapped: each sized to its own words, so "Take one"
        * and "Choose one" came out different widths and sat huddled against
        * the left edge under a full-width thumbnail. Nothing else on these
        * screens does that — every other control is either the panel's width
        * or a row spanning it — so the pair read as the one thing on the
        * screen nobody had laid out.
        *
        * `flex: 1` on the wrappers rather than a prop on `Secondary`, because
        * the button has no business knowing how wide its container wants it.
        */}
      <View style={styles.actions}>
        <View style={styles.action}>
          <Secondary
            label={busy ? 'Working…' : 'Take one'}
            onPress={() => void add('camera')}
            testID="photo-camera"
          />
        </View>
        <View style={styles.action}>
          <Secondary
            label="Choose one"
            onPress={() => void add('library')}
            testID="photo-library"
          />
        </View>
      </View>
    </Panel>
  );
}

/** "4 August", which is all anybody wants from a photo's date. */
function taken(photo: Photo): string {
  return new Date(photo.capturedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
}

const styles = StyleSheet.create({
  // The closed row, shaped exactly like `Notes` — two attachments to the same
  // record should not be two different kinds of thing on the same screen.
  collapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: TAP.min,
    padding: SPACE.md,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  collapsedWords: { flex: 1, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.xs,
  },
  badgeCount: { fontFamily: FONTS.data, fontSize: TYPE.label, fontVariant: ['tabular-nums'] },
  preview: { fontFamily: FONTS.body, fontSize: TYPE.body },
  previewStrip: { flexDirection: 'row', gap: SPACE.xs, paddingTop: 2 },
  // Small enough that the row stays a row. The strip inside the open panel is
  // 128 and is for looking at; these are for knowing there is something there.
  thumb: { width: 32, height: 32, borderRadius: RADII.softHead, borderWidth: StyleSheet.hairlineWidth },
  strip: { gap: SPACE.md, paddingVertical: SPACE.xs },
  opened: { gap: SPACE.sm, marginTop: SPACE.sm },
  large: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
  },
  item: { gap: SPACE.xs, width: 128 },
  shot: { width: 128, height: 128, borderRadius: RADII.softHead, borderWidth: StyleSheet.hairlineWidth },
  missing: {
    width: 128,
    height: 128,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs,
    padding: SPACE.sm,
  },
  // No `flexWrap`: the two below share the row equally, so there is nothing
  // left to wrap. Wrapping was what let them be different widths.
  actions: { flexDirection: 'row', gap: SPACE.sm },
  action: { flex: 1 },
  label: { fontFamily: FONTS.data, fontSize: TYPE.label, textAlign: 'center' },
});
