import { useCallback, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { newId } from '@steading/contracts';
import { listPhotos, type Photo } from '@steading/core/read/photos';
import { capture, forgetBytes, hasBytes, photoUri } from '../photos/store';
import { Confirm, Failure, Secondary } from './Form';
import { Icon } from './Icon';
import { Body, Panel } from './Panel';
import { Touch } from './Touch';
import { useLive } from '../hooks/useLive';
import { useLog } from '../hooks/useSync';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TYPE } from '../theme/tokens';

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

  return (
    <Panel label="Photos">
      {!read ? null : mine.length === 0 ? (
        <Body>
          A receipt, a manual, or something you want to remember the look of — a wound, a kill,
          a leaf. Shrunk to save space, and shared with the farm&rsquo;s other phones when
          there is signal.
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
                    <Icon name="offline" size={24} color={colors.muted} />
                    <Text style={[styles.label, { color: colors.muted }]}>On the other phone</Text>
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
                  /* Full width and square-ish: a receipt at 128px is not a
                     receipt, it is a thumbnail of one. `contain` because these
                     are documents as often as they are pictures, and cropping
                     a receipt loses the total. */
                  <Image
                    source={{ uri: photoUri(photo.id) }}
                    resizeMode="contain"
                    style={[styles.large, { borderColor: colors.border }]}
                    accessibilityLabel={`Photo of ${what}, ${taken(photo)}`}
                  />
                ) : (
                  <Body>
                    Taken on another phone. The record is here and the picture is still coming —
                    it arrives the next time this phone has signal and a moment spare.
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

      <View style={styles.actions}>
        <Secondary
          label={busy ? 'Working…' : 'Take one'}
          icon="photo"
          onPress={() => void add('camera')}
          testID="photo-camera"
        />
        <Secondary
          label="Choose one"
          icon="basket"
          onPress={() => void add('library')}
          testID="photo-library"
        />
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
  actions: { flexDirection: 'row', gap: SPACE.sm, flexWrap: 'wrap' },
  label: { fontFamily: FONTS.data, fontSize: TYPE.label, textAlign: 'center' },
});
