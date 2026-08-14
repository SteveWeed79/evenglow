import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { canRenameFarm } from '@steading/contracts';
import { Confirm, Failure, Field, Secondary, TextField, useSaver } from './Form';
import { Body, Panel } from './Panel';
import { call } from '../auth/call';
import { rememberFarmName } from '../auth/session';
import { useAccount } from '../hooks/useAccount';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * The farm's name, and four separate reasons it does not change by accident.
 *
 * ## Why it lives on My farm
 *
 * It used to sit on *Who is on your farm*, which is a screen about people, and
 * a name is not a person. The alternative offered was *Your account* — but that
 * screen is about **you**: signing in, the password, the subscription, joining.
 * The farm's name is shared by everybody on it, so putting it under a heading
 * that says "your" would be the app calling a shared thing personal.
 *
 * My farm is already the home for exactly this class of setting: the
 * enterprises, the units, the currency, the rotation years — farm-wide answers
 * that everyone on the farm sees. The name is one of those.
 *
 * ## It is not a syncable entity, which is why this makes a call
 *
 * Everything else on My farm is written to the `site` record through the
 * mutation queue and works with the radio off. The name is on the **org**,
 * which is server-owned: it is what a join code shows somebody deciding whether
 * to accept, so it cannot be a local edit that reconciles later. Hence `call`
 * and a straight refusal when there is no signal.
 *
 * ## Four guards, none of them a modal
 *
 * Asked for directly — *"how do we secure it so it cannot happen on
 * accident?"* — and the answer is layered, because a single confirmation
 * dialogue is the guard people learn to tap through:
 *
 * 1. **Role.** `canRenameFarm` is owner or admin. A hand does not see this at
 *    all, which is a UX gate only — the server re-derives it (invariant 8).
 * 2. **Closed by default.** The field is not on screen until somebody asks for
 *    it. The old version left an editable box holding the live name on an
 *    ordinary settings screen, where a stray tap and a keystroke is all it
 *    takes; here there is nothing to fumble into.
 * 3. **No change, no commit.** The button is dead until the trimmed name
 *    actually differs from the current one. It used to be live whenever the box
 *    was non-empty, so opening the screen and pressing it re-sent the same name
 *    as a real rename.
 * 4. **The second tap names the destination.** `Confirm`, the same two-tap
 *    convention as every other irreversible act here, and its armed label reads
 *    out the new name rather than saying "sure?" — so what is confirmed is the
 *    thing that will happen, not the fact that a button was pressed.
 */
export function FarmName(): React.ReactElement {
  const claims = useAccount();
  const { colors } = useTheme();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const named = useSaver(useCallback(() => undefined, []));

  const current = claims?.orgName ?? '';
  // Null means "not touched on this visit", so the box shows the live name
  // without that name becoming an edit the moment the panel opens.
  const next = (draft ?? current).trim();
  const changed = next !== '' && next !== current.trim();

  const rename = useCallback(() => {
    void named.save(async () => {
      await call('/org', { method: 'PATCH', body: { name: next } }, 'rename the farm');
      // Only after the server agreed. The cache is what every screen reads, and
      // writing it publishes — so the Settings row and the Today subtitle
      // correct themselves without anybody navigating anywhere.
      await rememberFarmName(next);
      setOpen(false);
      setDraft(null);
    });
  }, [named, next]);

  // `undefined` is "not read yet" and `null` is "no account"; neither is a farm
  // with a name to show, and flattening them would flash a panel at boot.
  if (claims === null || claims === undefined || !canRenameFarm(claims.role)) return <></>;

  return (
    <Panel label="The farm's name">
      <Text style={[styles.name, { color: colors.ink }]}>{current}</Text>
      <Body>
        What every screen calls it, and what somebody joining sees before they accept. Changing it
        changes it for everybody on the farm.
      </Body>

      {!open ? (
        <Secondary label="Change the name" onPress={() => setOpen(true)} testID="farm-rename-open" />
      ) : (
        <>
          <Field label="What should it be called?">
            <TextField
              value={draft ?? current}
              onChangeText={setDraft}
              placeholder="Hollow Farm"
              maxLength={120}
              testID="farm-name"
            />
          </Field>
          <Failure message={named.failure} />

          {/* Dead until the name is genuinely different — guard 3. Rendered
              either way so the control does not appear and disappear under a
              thumb that is already reaching for it. */}
          {changed && !named.saving ? (
            <Confirm
              label="Rename this farm"
              armedLabel={`Tap again to call it ${next}`}
              onConfirm={rename}
              testID="farm-rename"
            />
          ) : (
            <Secondary
              label={named.saving ? 'Renaming…' : 'Rename this farm'}
              disabled
              onPress={() => undefined}
              testID="farm-rename"
            />
          )}

          <Secondary
            label="Leave it as it is"
            onPress={() => {
              setOpen(false);
              setDraft(null);
            }}
            testID="farm-rename-cancel"
          />
        </>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: FONTS.display, fontSize: TYPE.lede, marginBottom: SPACE.xs },
});
