import { useCallback, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { newId } from '@steading/contracts';
import { listPhotos, type Photo } from '@steading/core/read/photos';
import { capture, forgetBytes, hasBytes, photoUri } from '../photos/store';
import { Confirm, Failure, Secondary } from './Form';
import { Icon } from './Icon';
import { Body, Panel } from './Panel';
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
 * ## The bytes are on this device only, and it says so
 *
 * The record syncs — a second phone knows a photo exists — and the image does
 * not, yet. Rather than a grey box that reads as a bug, a photo without its
 * bytes says plainly which device took it. See `photos/store.ts`.
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
    },
    [log],
  );

  const mine = (all ?? []).filter((photo) => photo.subjectId === subjectId);

  return (
    <Panel label="Photos">
      {mine.length === 0 ? (
        <Body>
          A receipt, a manual, or something you want to remember the look of — a wound, a kill,
          a leaf. Kept on this phone, not sent anywhere.
        </Body>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {mine.map((photo) => (
            <View key={photo.id} style={styles.item}>
              {hasBytes(photo.id) ? (
                <Image
                  source={{ uri: photoUri(photo.id) }}
                  style={[styles.shot, { borderColor: colors.border }]}
                  accessibilityLabel={`Photo of ${what}, ${new Date(
                    photo.capturedAt,
                  ).toLocaleDateString()}`}
                />
              ) : (
                /* Said rather than shown as a grey square, which reads as a
                   bug. The record travelled; the image has not, yet. */
                <View style={[styles.missing, { borderColor: colors.border }]}>
                  <Icon name="offline" size={24} color={colors.muted} />
                  <Text style={[styles.label, { color: colors.muted }]}>On the other phone</Text>
                </View>
              )}

              <Confirm
                label="Remove"
                armedLabel="Tap again"
                onConfirm={() => remove(photo)}
              />
            </View>
          ))}
        </ScrollView>
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

const styles = StyleSheet.create({
  strip: { gap: SPACE.md, paddingVertical: SPACE.xs },
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
