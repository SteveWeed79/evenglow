import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Choice, Failure, Field, Primary, Secondary, TextField, useSaver } from '../components/Form';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { GoogleButton } from '../auth/GoogleButton';
import { GOOGLE_AVAILABLE } from '../auth/google';
import { ensureLocalOrgId } from '../auth/local-org';
import {
  type BillingState,
  type CachedClaims,
  claimFarm,
  googleSignIn,
  joinFarm,
  readBilling,
  redeemPromo,
  readCachedClaims,
  signIn,
  SignInError,
} from '../auth/session';
import { useNav } from '../hooks/useNav';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, SPACE, TYPE } from '../theme/tokens';

/**
 * Where an account is asked for, and the only place it is.
 *
 * **This screen is not the door any more.** The app opens on the farm this
 * device minted and works from the first launch (A2.1), so nobody is ever sent
 * here to get in — they arrive when they want one of the three things an
 * account actually buys (A2.3): a second device, a farm hand, or the records
 * surviving the phone.
 *
 * The third is the honest one and it leads, because it is what an account is
 * really for. "Sign up" is a chore; "your records live on this handset and
 * nowhere else" is a fact somebody can act on.
 *
 * ## Three ways in, and the middle one is the odd one out
 *
 * - **Set up an account** claims the farm already on this device. Nothing
 *   moves — same database, same records — because the server adopts the id
 *   rather than assigning one (A2.2).
 * - **Sign in** is for a farm that already has an account: a second phone, or
 *   a reinstall. It opens that farm's database, which is a different file.
 * - **Join a farm** redeems six characters an owner is holding out (A2.5), and
 *   it is the one that costs something — see the warning it shows.
 */

type Mode = 'claim' | 'signin' | 'join';

const MODES = ['claim', 'signin', 'join'] as const;

const LABELS: Record<Mode, string> = {
  claim: 'Set up an account',
  signin: 'Sign in',
  join: 'Join a farm',
};

/** The shortest password the contract will take. Said, rather than discovered. */
const MIN_PASSWORD = 12;

export function AccountScreen({
  onSignedIn,
}: {
  onSignedIn: (claims: CachedClaims) => void;
}): React.ReactElement {
  const nav = useNav();
  const { colors } = useTheme();

  const [claims, setClaims] = useState<CachedClaims | null>(null);
  const [known, setKnown] = useState(false);
  const [billing, setBilling] = useState<BillingState | null>(null);

  const [promo, setPromo] = useState('');
  const [promoFailure, setPromoFailure] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  /**
   * Redeeming replaces the billing state rather than re-fetching it.
   *
   * The route answers with exactly what `/billing` would say next, so a second
   * round trip could only introduce a window where the panel still said "kept
   * on this phone" about a farm that is now syncing — on the one screen where
   * somebody is watching for that sentence to change.
   */
  const usePromo = useCallback(async () => {
    setRedeeming(true);
    setPromoFailure(null);
    try {
      setBilling(await redeemPromo(promo));
      setPromo('');
    } catch (error) {
      setPromoFailure(error instanceof Error ? error.message : 'That code does not work.');
    } finally {
      setRedeeming(false);
    }
  }, [promo]);

  const [mode, setMode] = useState<Mode>('claim');
  const [farmName, setFarmName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    void readCachedClaims().then((found) => {
      setClaims(found);
      setKnown(true);
      /**
       * Asked of the server rather than derived from the chip.
       *
       * The chip knows the device was refused; only the server knows what the
       * farm has actually paid for and until when. A screen somebody opened to
       * find out should ask the thing that knows — and it fails soft, because
       * this screen has to work in a barn even though the answer cannot.
       */
      if (found !== null) void readBilling().then(setBilling, () => setBilling(null));
    });
  }, []);

  const { saving, failure, save } = useSaver(useCallback(() => nav.goBack(), [nav]));

  /**
   * The Google path, which asks for a farm name it may not need.
   *
   * The server decides whether this is a sign-in or a claim, and only a claim
   * uses `orgName` — so the field is sent when the person filled it in and
   * falls back to a plain default when they were signing in and never saw it.
   * Asking for a farm name before knowing whether a farm is being made would
   * be a question with no answer for half the people who see it.
   */
  const withGoogle = useCallback(
    (idToken: string | null) => {
      // Backing out of the Google sheet is a decision, not a failure. No
      // message, nothing changed.
      if (idToken === null) return;

      void save(async () => {
        try {
          onSignedIn(
            await googleSignIn({
              idToken,
              orgId: await ensureLocalOrgId(),
              orgName: farmName.trim() === '' ? 'My farm' : farmName.trim(),
            }),
          );
        } catch (error) {
          throw error instanceof SignInError
            ? error
            : new Error('Could not reach the farm. Check the connection and try again.');
        }
      });
    },
    [save, onSignedIn, farmName],
  );

  const submit = useCallback(() => {
    void save(async () => {
      try {
        if (mode === 'signin') {
          onSignedIn(await signIn(email.trim(), password));
          return;
        }

        if (mode === 'join') {
          onSignedIn(
            await joinFarm({ code, name: name.trim(), email: email.trim(), password }),
          );
          return;
        }

        /**
         * `ensureLocalOrgId` rather than a value passed in, and it is the same
         * id the store is already open on. Reading it here rather than
         * threading it through the navigator keeps the one rule that matters
         * about this value in one file: it is minted once and never again.
         */
        onSignedIn(
          await claimFarm({
            orgId: await ensureLocalOrgId(),
            orgName: farmName.trim(),
            name: name.trim(),
            email: email.trim(),
            password,
          }),
        );
      } catch (error) {
        /**
         * The server's own sentence, verbatim.
         *
         * Sign-in answers one message for every failure so the route cannot be
         * used to enumerate accounts, and rewording it here would undo that.
         * The account-creating routes say plainly that an email is taken,
         * because somebody has to be told why it did not work — see the note
         * on `/auth/signup`.
         */
        throw error instanceof SignInError
          ? error
          : new Error('Could not reach the farm. Check the connection and try again.');
      }
    });
  }, [save, mode, onSignedIn, email, password, name, farmName, code]);

  if (!known) return <Screen title="Your account" back>{null}</Screen>;

  if (claims !== null) {
    return (
      <Screen title="Your account" back>
        <Panel label="Signed in">
          <Body>
            This device is signed in{claims.name === undefined ? '' : ` as ${claims.name}`}.
          </Body>
          <Body>Adding somebody else to the farm is under Members.</Body>
        </Panel>

        {/**
          * What the farm has paid for, and what that changes (D13).
          *
          * **The claim above used to promise sync unconditionally** — "so
          * everything logged here reaches the farm's other phones" — which was
          * true when an account was the only gate and became a lie the moment
          * one existed. Signing in is now free; the copy says which of the two
          * a farm is in rather than assuming.
          */}
        {billing === null ? null : billing.syncing ? (
          <Panel label="Syncing">
            <Body>
              Everything logged on this phone reaches the farm's other phones, and is recoverable
              if this one is lost.
              {billing.expiresAt === null
                ? ''
                : ` Paid up to ${new Date(billing.expiresAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}.`}
            </Body>
          </Panel>
        ) : (
          <Panel label="Kept on this phone">
            {/* The server's own sentence, so this screen and the sync chip
                cannot come to disagree about what is happening. */}
            <Body>{billing.message ?? 'Nothing is being sent anywhere.'}</Body>
            <Body>
              Everything works exactly as it does now — the whole app, on this handset, for as
              long as you like. What a subscription adds is a copy on the farm's server: a second
              phone sees the same records, a farm hand can log work, and a phone in a water
              trough costs you a phone rather than a season.
            </Body>

            {/**
              * Under the explanation, not above it.
              *
              * Almost nobody has a code, and a field asking for one is a
              * question most people cannot answer — put first it reads as a
              * wall. Whoever was handed one came here looking for it and will
              * find it perfectly well at the bottom.
              */}
            <Field label="Been given a code?">
              <TextField
                value={promo}
                onChangeText={setPromo}
                placeholder="4F7K-M2Q9-XT3B"
                maxLength={20}
                caps
                testID="promo-code"
              />
            </Field>
            <Failure message={promoFailure} />
            <Secondary
              label={redeeming ? 'Checking…' : 'Use this code'}
              disabled={redeeming || promo.trim() === ''}
              onPress={() => void usePromo()}
              testID="promo-redeem"
            />
          </Panel>
        )}
      </Screen>
    );
  }

  const enough =
    mode === 'signin'
      ? email.trim() !== '' && password !== ''
      : mode === 'join'
        ? code.trim() !== '' && name.trim() !== '' && email.trim() !== '' && password.length >= MIN_PASSWORD
        : farmName.trim() !== '' &&
          name.trim() !== '' &&
          email.trim() !== '' &&
          password.length >= MIN_PASSWORD;

  return (
    <Screen title="Your account" back>
      {/**
        * The honest reason, first (A2.3).
        *
        * Not a nag and not a timer — this panel is only ever read by somebody
        * who came looking. What it must not do is bury the one thing an
        * account is actually for behind the two that sound like features.
        */}
      <Panel label="What this is for">
        <Body>
          Everything you have logged is on this handset and nowhere else. An account keeps a copy
          on the farm's server, so a phone in a water trough costs you a phone rather than a
          season.
        </Body>
        <Body>It is also what lets a second phone, or a farm hand, see the same records.</Body>
      </Panel>

      <Field label="Which are you doing?">
        <Choice options={MODES} value={mode} onChange={setMode} labels={LABELS} />
      </Field>

      {mode === 'claim' ? (
        <>
          <Panel label="Nothing moves">
            <Body>
              Setting up an account keeps the records already on this phone — it claims them
              rather than starting again. Nothing is uploaded until you have an account, and
              everything already logged goes up on the first connection afterwards.
            </Body>
          </Panel>

          <Field label="What is the farm called?">
            <TextField
              value={farmName}
              onChangeText={setFarmName}
              placeholder="Hollow Farm"
              maxLength={120}
              testID="account-farm"
            />
          </Field>
        </>
      ) : null}

      {mode === 'join' ? (
        <>
          {/**
            * Said before the code is typed, not after it works.
            *
            * A user belongs to exactly one farm, so joining somebody else's
            * leaves this device's own behind. Discovering that on the morning
            * you went looking for last week's tallies would be the app's
            * worst broken promise.
            */}
          <Panel label="This leaves your own farm behind">
            <Body>
              Joining somebody else's farm signs this phone in to their records. Anything you
              logged on this handset before joining stays on it and stops being reachable, so do
              this on a phone you have not been keeping your own records on.
            </Body>
          </Panel>

          <Field
            label="The six characters they are showing you"
            hint="Codes last ten minutes and work once. If it has gone stale, ask them to make another."
          >
            <TextField
              value={code}
              onChangeText={setCode}
              placeholder="K4M9PT"
              maxLength={12}
              caps
              testID="account-code"
            />
          </Field>
        </>
      ) : null}

      {mode === 'signin' ? null : (
        <Field label="Your name">
          <TextField
            value={name}
            onChangeText={setName}
            placeholder="Sam"
            maxLength={80}
            testID="account-name"
          />
        </Field>
      )}

      <Field label="Email">
        <TextField
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          maxLength={254}
          // A farm email typed at 6am with cold hands. The email keyboard
          // turns off capitalisation and autocorrect with it.
          keyboardType="email-address"
          testID="account-email"
        />
      </Field>

      <Field
        label="Password"
        {...(mode === 'signin'
          ? {}
          : { hint: `At least ${MIN_PASSWORD} characters. Length beats punctuation.` })}
      >
        <TextField
          value={password}
          onChangeText={setPassword}
          placeholder="Something only you would say"
          maxLength={200}
          secret
          testID="account-password"
        />
      </Field>

      <Failure message={failure} />

      <Primary
        label={LABELS[mode]}
        disabled={saving || !enough}
        onPress={submit}
        testID="account-submit"
      />

      {/**
        * Google, and only where the mode makes sense of it (A2.4).
        *
        * Offered for claiming and for signing in, because the server treats
        * those as one route and works out which it is. Not offered for
        * joining: a join code names the farm and the role, and there is
        * nothing for a Google account to decide about either.
        *
        * Absent entirely in a build with no client id. A dead button that
        * fails on every tap is worse than no button.
        */}
      {GOOGLE_AVAILABLE && mode !== 'join' ? (
        <GoogleButton disabled={saving} onToken={withGoogle} />
      ) : null}

      <Text style={[styles.note, { color: colors.muted }]}>
        Been sent an invitation link? Open it instead — it brings the farm with it.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {
    fontFamily: FONTS.body,
    fontSize: TYPE.body - 1,
    lineHeight: TYPE.body * 1.4,
    marginTop: SPACE.sm,
  },
});
