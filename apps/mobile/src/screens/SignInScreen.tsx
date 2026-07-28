import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { Plaster } from '../components/Plaster';
import { signIn, SignInError, type CachedClaims } from '../auth/session';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TAP, TYPE } from '../theme/tokens';

/**
 * The door.
 *
 * The one screen in the app that cannot work offline, and the only one, which
 * is why it is worth keeping small: everything past it works with the radio
 * off, and a session survives being offline indefinitely. Someone reaches this
 * screen once per device and then effectively never again.
 */
export function SignInScreen({ onSignedIn }: { onSignedIn: (claims: CachedClaims) => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (busy || email.trim() === '' || password === '') return;

    setBusy(true);
    setError(null);
    try {
      onSignedIn(await signIn(email.trim(), password));
    } catch (e) {
      /**
       * The server answers one message for every failure — unknown email,
       * wrong password, disabled account — so this route cannot be used to
       * enumerate accounts. Showing it verbatim keeps that true; inventing a
       * more helpful one here would undo it.
       */
      setError(
        e instanceof SignInError
          ? e.message
          : 'Could not reach the farm. Check the connection and try again.',
      );
      setBusy(false);
    }
  }, [busy, email, password, onSignedIn]);

  return (
    <View style={[styles.ground, { backgroundColor: colors.ground, paddingTop: insets.top }]}>
      <Plaster />

      <View style={styles.body}>
        <View style={styles.mark}>
          <Icon name="today" size={56} color={colors.lanternInk} />
        </View>

        <Text style={[styles.title, { color: colors.ink }]}>Steading</Text>
        <Text style={[styles.lede, { color: colors.muted }]}>Sign in to your farm.</Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={colors.muted}
          // A farm email typed at 6am with cold hands. Every one of these
          // turns off something the keyboard would otherwise do wrong.
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          returnKeyType="next"
          editable={!busy}
          style={[styles.field, { backgroundColor: colors.raised, borderColor: colors.border, color: colors.ink }]}
        />

        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={colors.muted}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          editable={!busy}
          style={[styles.field, { backgroundColor: colors.raised, borderColor: colors.border, color: colors.ink }]}
        />

        {/* Reserved space, so the button does not jump down the screen under
            a thumb that is already moving toward it. */}
        <Text style={[styles.error, { color: colors.rowan }]} accessibilityLiveRegion="polite">
          {error ?? ' '}
        </Text>

        <Pressable
          onPress={() => void submit()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          style={({ pressed }) => [
            styles.submit,
            { backgroundColor: colors.lantern, opacity: busy || pressed ? 0.75 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            // Ink on brass, not on the wall: the lantern is a fill here, and
            // the label sits on top of it where it reads at 8:1.
            <Text style={[styles.submitLabel, { color: '#241c14' }]}>Sign in</Text>
          )}
        </Pressable>

        <Text style={[styles.note, { color: colors.muted }]}>
          Been invited? Open the link you were sent — it will bring you here with your farm
          already chosen.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', padding: SPACE.xl, gap: SPACE.md },
  mark: { alignItems: 'center', marginBottom: SPACE.sm },
  title: { fontFamily: FONTS.display, fontSize: TYPE.hero, textAlign: 'center' },
  lede: { fontFamily: FONTS.body, fontSize: TYPE.lede, textAlign: 'center', marginBottom: SPACE.lg },
  field: {
    minHeight: TAP.min,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACE.lg,
    fontFamily: FONTS.body,
    fontSize: TYPE.body,
  },
  error: { fontFamily: FONTS.body, fontSize: TYPE.body, minHeight: TYPE.body * 1.4 },
  submit: {
    minHeight: TAP.primary,
    borderRadius: RADII.softHead,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitLabel: { fontFamily: FONTS.display, fontSize: TYPE.lede },
  note: {
    fontFamily: FONTS.body,
    fontSize: TYPE.body,
    lineHeight: TYPE.body * 1.45,
    textAlign: 'center',
    marginTop: SPACE.lg,
  },
});
