import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { looksLikeJoinCode, ROLE_WORDS } from '@homefarm/contracts';
import { readExposure } from '@homefarm/core/backup/exposure';
import { Choice, Failure, Field, Primary, Secondary, TextField, useSaver } from '../components/Form';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { Touch } from '../components/Touch';
import { GoogleButton } from '../auth/GoogleButton';
import { GOOGLE_AVAILABLE } from '../auth/google';
import { ensureLocalOrgId } from '../auth/local-org';
import {
  type BillingState,
  type CachedClaims,
  claimFarm,
  googleSignIn,
  joinFarm,
  acceptInvite,
  lookupInvite,
  type Invitation,
  readBilling,
  redeemPromo,
  readCachedClaims,
  requestReset,
  resetPassword,
  changeEmail,
  confirmEmail,
  sendVerifyCode,
  signIn,
  SignInError,
} from '../auth/session';
import { useLive } from '../hooks/useLive';
import { useLeave } from '../hooks/useNav';
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
 * - **Join a farm** takes either of the two things a farm can hand out — six
 *   characters an owner is holding out (A2.5), or a link they sent — and it is
 *   the one that costs something, because a user belongs to exactly one farm.
 *   See the warning it shows.
 *
 * ## The invite half had no door
 *
 * The server has minted invitations, published a lookup for one, and accepted
 * them since invites were built. **Nothing in the app called any of it.** A farm
 * could invite somebody, share the link, and watch it go nowhere — there was no
 * screen anywhere that would take it.
 *
 * Both now arrive in one box, because whoever is holding one did not pick which
 * they were given: `looksLikeJoinCode` decides which route to take. A pasted
 * link is looked up first so the farm's name and the role are on screen before
 * anybody invents a password — which matters here more than most places, since
 * accepting leaves this device's own farm behind.
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
  const { colors } = useTheme();

  /**
   * What is on this phone right now, for the join warning below.
   *
   * The same read Settings and the exposure strip make, so the number
   * somebody is shown before a join is the number they have been shown all
   * along rather than a second opinion computed differently.
   */
  const exposure = useLive(readExposure);

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

  /**
   * Confirming the address on an account that is already signed in.
   *
   * Its own state rather than the sign-in form's `save`, following `promo`
   * directly above: the two branches of this screen never render together, but
   * sharing a failure line between "your password was wrong" and "that code
   * has expired" is a class of confusion worth not inviting.
   */
  const [verifySent, setVerifySent] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyFailure, setVerifyFailure] = useState<string | null>(null);
  /** Open only when somebody says the address is wrong — see the panel. */
  const [fixing, setFixing] = useState(false);
  const [fixEmail, setFixEmail] = useState('');
  const [fixPassword, setFixPassword] = useState('');

  /**
   * Runs one of the three verification calls and puts its sentence on screen.
   *
   * All three answer plainly — the server has an authenticated caller asking
   * about their own address, so there is nothing here to keep vague — which is
   * why this shows the server's own words rather than a local substitute.
   */
  const runVerify = useCallback(
    async (work: () => Promise<void>): Promise<void> => {
      setVerifyBusy(true);
      setVerifyFailure(null);
      try {
        await work();
        setClaims(await readCachedClaims());
      } catch (error) {
        setVerifyFailure(
          error instanceof Error ? error.message : 'That did not work. Try again in a minute.',
        );
      } finally {
        setVerifyBusy(false);
      }
    },
    [],
  );

  const askToConfirm = useCallback(() => {
    void runVerify(async () => {
      setVerifySent(await sendVerifyCode());
    });
  }, [runVerify]);

  const confirmWithCode = useCallback(() => {
    void runVerify(async () => {
      await confirmEmail(verifyCode.trim());
      setVerifyCode('');
      setVerifySent(null);
    });
  }, [runVerify, verifyCode]);

  const correctEmail = useCallback(() => {
    void runVerify(async () => {
      await changeEmail({ email: fixEmail.trim(), password: fixPassword });
      // Only on success. The new address is unproved too, so the panel stays —
      // with the code step reset, because any code in flight was minted for the
      // address that has just been replaced and the server has retired it.
      setFixing(false);
      setFixEmail('');
      setFixPassword('');
      setVerifyCode('');
      setVerifySent(null);
    });
  }, [runVerify, fixEmail, fixPassword]);

  /**
   * Which of the three this device is most likely here for.
   *
   * **It was always `claim`**, so a second phone landed on "Set up an account"
   * with sign-in one of three options behind a selector, under a panel of
   * prose. Reported as the login form being hidden — and it was, behind a
   * question somebody had already answered by owning an account.
   *
   * The device cannot be asked, but it can be read. Every handset mints a farm
   * on first launch (D14), so "has a farm" says nothing; **what it has in it
   * says everything**:
   *
   * - records on this device → `claim`, because claiming is what keeps them
   *   and losing them to a sign-in is the expensive mistake;
   * - nothing logged → `signin`, because there is nothing to claim and a bare
   *   handset opening this screen is somebody adding a second device.
   *
   * A default, not a decision — the selector is still there and still says
   * what all three do. `readExposure` is the same count Settings and the
   * exposure strip already show, so it cannot disagree with them.
   */
  const [mode, setMode] = useState<Mode>('claim');
  const [modeChosen, setModeChosen] = useState(false);

  useEffect(() => {
    if (modeChosen || exposure === null) return;
    setMode(exposure.records > 0 ? 'claim' : 'signin');
  }, [exposure, modeChosen]);

  const chooseMode = useCallback((next: Mode) => {
    setModeChosen(true);
    setMode(next);
  }, []);
  const [farmName, setFarmName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /** The second box, on the two modes that create a password rather than check one. */
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  /**
   * The recovery form, which replaces the sign-in form rather than sitting
   * beside it.
   *
   * `PASSWORD-RECOVERY.md` §9 asks for two steps on one screen: ask for the
   * address, then take the code and the new password together. One screen,
   * because the code arrives while the person is still holding the phone and a
   * second navigation is a place to get lost — and because somebody doing this
   * is already stuck, which is the worst moment to add a journey.
   */
  const [recovering, setRecovering] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [resetCode, setResetCode] = useState('');
  /** Set once, to say the password changed. Cleared as soon as they type again. */
  const [changed, setChanged] = useState(false);
  const [code, setCode] = useState('');

  /**
   * What a pasted link turns out to be for, looked up before anything is typed.
   *
   * The endpoint exists precisely for this and had no caller. Somebody handed a
   * 43-character string has no way to tell whose farm it is or what it makes
   * them, and asking them to invent a password first and find out afterwards is
   * the wrong order — especially since accepting *leaves their own farm behind*,
   * which is the warning directly above this field.
   *
   * Only for the link half: a join code has nothing public to read, which is
   * the point of it lasting ten minutes. Null covers spent, revoked, expired
   * and wrong alike, because telling them apart tells a guesser which tokens
   * exist — so the field simply stays quiet and the server refuses on submit.
   */
  const [invitation, setInvitation] = useState<Invitation | null>(null);

  useEffect(() => {
    const token = code.trim();
    if (mode !== 'join' || token.length < 20 || looksLikeJoinCode(token)) {
      setInvitation(null);
      return;
    }

    let live = true;
    void lookupInvite(token).then((found) => {
      if (live) setInvitation(found);
    });
    return () => {
      live = false;
    };
  }, [code, mode]);

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

  const { saving, failure, save } = useSaver(useLeave());

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
          // The shape of what they were handed decides the route. Both end in
          // the same place: an account on somebody else's farm, signed in.
          onSignedIn(
            looksLikeJoinCode(code)
              ? await joinFarm({ code, name: name.trim(), email: email.trim(), password })
              : await acceptInvite({
                  token: code,
                  name: name.trim(),
                  email: email.trim(),
                  password,
                }),
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

  /** Step one: ask for a code. The answer never says whether the account exists. */
  const askForCode = useCallback(() => {
    void save(async () => {
      try {
        setSent(await requestReset(email.trim()));
      } catch (error) {
        throw error instanceof SignInError
          ? error
          : new Error('Could not reach the farm. Check the connection and try again.');
      }
    });
  }, [save, email]);

  /** Step two: spend it. On success this returns to sign-in with the email kept. */
  const useCode = useCallback(() => {
    void save(async () => {
      try {
        await resetPassword({ email: email.trim(), code: resetCode.trim(), password });
      } catch (error) {
        throw error instanceof SignInError
          ? error
          : new Error('Could not reach the farm. Check the connection and try again.');
      }
      // Only on success: back to sign-in with the address kept, the password
      // boxes cleared, and one sentence saying what happened.
      setRecovering(false);
      setSent(null);
      setResetCode('');
      setPassword('');
      setConfirm('');
      setChanged(true);
    });
  }, [save, email, resetCode, password]);

  if (!known) return <Screen title="Your account" back>{null}</Screen>;

  if (claims !== null) {
    return (
      <Screen title="Your account" back>
        <Panel label="Signed in">
          <Body>
            This device is signed in{claims.name === undefined ? '' : ` as ${claims.name}`}.
          </Body>
          {/* The address, wherever the server has told this device one. It is
              here rather than only in the warning below so that somebody who
              confirmed months ago can still check which inbox a reset would go
              to — the question that sends people to this screen. */}
          {claims.email === undefined ? null : (
            <Body>
              {claims.email}
              {claims.emailVerified === true ? ' — confirmed.' : ''}
            </Body>
          )}
          <Body>Adding somebody else to the farm is under Members.</Body>
        </Panel>

        {/**
          * Unconfirmed, which means a forgotten password cannot be recovered.
          *
          * **The whole point of email verification is this panel.** The server
          * gate is what closes the hole — an unproved address is sent nothing —
          * but a gate nobody is told about is just a farm that one day finds
          * recovery does not work. What actually prevents the damage is somebody
          * reading their own address back and noticing they typed `alcie@`.
          *
          * So it says the address, says plainly what is switched off, and puts
          * the correction one tap away. It is not a nag: it appears on a screen
          * people visit rarely, and it goes away for good the moment a code is
          * typed.
          *
          * **Only when the server has an opinion.** `emailVerified` is absent
          * against a server that predates this, and absent must not render as
          * unconfirmed — that would put a warning about recovery on a farm
          * whose server never said anything about it.
          */}
        {claims.emailVerified === false ? (
          <Panel label="Confirm your email">
            <Body>
              {claims.email === undefined
                ? 'This account’s email has not been confirmed yet.'
                : `${claims.email} has not been confirmed yet.`}
            </Body>
            <Body>
              Until it is, a forgotten password cannot be reset by email — the app will not send
              a code to an address nobody has proved they can read. Your records are on this
              handset either way; what is at stake is getting back in, not losing them.
            </Body>

            {verifySent === null ? null : <Body>{verifySent}</Body>}

            {verifySent === null ? (
              <Secondary
                label={verifyBusy ? 'Sending…' : 'Send me a code'}
                disabled={verifyBusy}
                onPress={askToConfirm}
                testID="verify-send"
              />
            ) : (
              <>
                <Field label="The code from the email" hint="Eight characters.">
                  <TextField
                    value={verifyCode}
                    onChangeText={setVerifyCode}
                    placeholder="K3M7QP2W"
                    maxLength={12}
                    caps
                    testID="verify-code"
                  />
                </Field>
                <Primary
                  label={verifyBusy ? 'Confirming…' : 'Confirm this email'}
                  disabled={verifyBusy || verifyCode.trim() === ''}
                  onPress={confirmWithCode}
                  testID="verify-confirm"
                />
              </>
            )}

            {/**
              * The correction, under the code rather than beside it.
              *
              * Most people came here to type a code they already have. Whoever
              * needs this needs it because no code ever arrived, which is a
              * thing they find out after waiting — so it belongs at the end of
              * the panel, where somebody who has given up will look.
              */}
            {fixing ? (
              <>
                <Field label="The right email">
                  <TextField
                    value={fixEmail}
                    onChangeText={setFixEmail}
                    placeholder="you@example.com"
                    maxLength={254}
                    keyboardType="email-address"
                    testID="verify-new-email"
                  />
                </Field>
                <Field
                  label="Your password"
                  hint="Asked for because a stolen session must not be able to move the address on its own."
                >
                  <TextField
                    value={fixPassword}
                    onChangeText={setFixPassword}
                    secret
                    testID="verify-password"
                  />
                </Field>
                <Primary
                  label={verifyBusy ? 'Changing…' : 'Use this email instead'}
                  disabled={verifyBusy || fixEmail.trim() === '' || fixPassword === ''}
                  onPress={correctEmail}
                  testID="verify-change"
                />
              </>
            ) : (
              <Secondary
                label="That address is wrong"
                disabled={verifyBusy}
                onPress={() => setFixing(true)}
                testID="verify-fix"
              />
            )}

            <Failure message={verifyFailure} />
          </Panel>
        ) : null}

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

  /**
   * Both boxes, and it is a hard gate rather than a warning.
   *
   * A mistyped password at signup is a farm nobody can open, with the records
   * already on the phone. Letting it through with a red line underneath would
   * be offering somebody the chance to make exactly that mistake.
   *
   * **The gate stays now that recovery exists**, and it is worth saying why
   * rather than leaving the old reasoning to look overtaken. Recovery needs a
   * *confirmed* address, and an address is unconfirmed on the morning somebody
   * signs up — which is precisely the morning this mistake gets made. The one
   * flow that could rescue a mistyped password is the one that is not on yet.
   */
  const matches = mode === 'signin' || password === confirm;

  const enough =
    (mode === 'signin'
      ? email.trim() !== '' && password !== ''
      : mode === 'join'
        ? code.trim() !== '' && name.trim() !== '' && email.trim() !== '' && password.length >= MIN_PASSWORD
        : farmName.trim() !== '' &&
          name.trim() !== '' &&
          email.trim() !== '' &&
          password.length >= MIN_PASSWORD) && matches;

  return (
    <Screen title="Your account" back>
      {/**
        * The honest reason, first (A2.3).
        *
        * Not a nag and not a timer — this panel is only ever read by somebody
        * who came looking. What it must not do is bury the one thing an
        * account is actually for behind the two that sound like features.
        */}
      {/**
        * The honest reason, and only to somebody still deciding.
        *
        * A2.3 puts this first deliberately — what an account is actually for
        * must not be buried behind the two things that sound like features.
        * That argument is about somebody weighing it up, which is `claim`.
        *
        * Sign in and join are people who have already decided, arriving with a
        * password or a code in hand, and for them a panel of prose is two
        * hundred pixels between the screen and the field they came to type in.
        * On a phone that is the difference between the form being visible and
        * not.
        */}
      {mode === 'claim' ? (
        <Panel label="What this is for">
          <Body>
            Everything you have logged is on this handset and nowhere else. An account keeps a copy
            on the farm's server, so a phone in a water trough costs you a phone rather than a
            season.
          </Body>
          <Body>It is also what lets a second phone, or a farm hand, see the same records.</Body>
        </Panel>
      ) : null}

      {recovering ? (
        <>
          {/**
            * Two steps, one screen, and the second appears once the first has
            * been done. Nothing here says whether the address has an account —
            * §5 — so the copy describes what was *done*, not what was found.
            */}
          <Panel label="Getting back in">
            <Body>
              Type the address the account uses. If it has one, a code comes by email — eight
              characters, good for twenty minutes. Type it below with the new password.
            </Body>
            <Body>
              Your records are on this phone either way. This restores syncing, not the data.
            </Body>
          </Panel>

          <Field label="Email">
            <TextField
              value={email}
              onChangeText={(next) => {
                setEmail(next);
                setSent(null);
              }}
              placeholder="you@example.com"
              maxLength={254}
              keyboardType="email-address"
              testID="recover-email"
            />
          </Field>

          {sent === null ? (
            <Primary
              label="Send a code"
              disabled={saving || email.trim() === ''}
              onPress={askForCode}
              testID="recover-send"
            />
          ) : (
            <>
              <Panel label="Sent">
                <Body>{sent}</Body>
              </Panel>

              <Field label="The code from the email" hint="Eight characters.">
                <TextField
                  value={resetCode}
                  onChangeText={setResetCode}
                  placeholder="K4M9PT2X"
                  maxLength={40}
                  caps
                  testID="recover-code"
                />
              </Field>

              <Field
                label="New password"
                hint={`At least ${MIN_PASSWORD} characters. Length beats punctuation.`}
              >
                <TextField
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Something only you would say"
                  maxLength={200}
                  secret={!showPassword}
                  testID="recover-password"
                />
              </Field>

              <Field label="New password again">
                <TextField
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="The same one"
                  maxLength={200}
                  secret={!showPassword}
                  testID="recover-password-confirm"
                />
              </Field>

              {confirm !== '' && password !== confirm ? (
                <Failure message="Those two do not match." />
              ) : null}

              <Primary
                label="Set the new password"
                disabled={
                  saving ||
                  resetCode.trim() === '' ||
                  password.length < MIN_PASSWORD ||
                  password !== confirm
                }
                onPress={useCode}
                testID="recover-submit"
              />

              {/* A code that never arrived, or one that has expired while
                  somebody looked for it. Cheaper than making them start over. */}
              <Touch
                affordance="check"
                onPress={() => setSent(null)}
                accessibilityRole="button"
                testID="recover-again"
              >
                <Text style={[styles.revealLabel, { color: colors.muted }]}>
                  Send another code
                </Text>
              </Touch>
            </>
          )}

          <Failure message={failure} />

          <Touch
            affordance="check"
            onPress={() => {
              setRecovering(false);
              setSent(null);
            }}
            accessibilityRole="button"
            testID="recover-cancel"
          >
            <Text style={[styles.revealLabel, { color: colors.muted }]}>Back to signing in</Text>
          </Touch>
        </>
      ) : (
      <>
      {changed ? (
        <Panel label="Password changed">
          <Body>Sign in with the new one. Every other device has been signed out.</Body>
        </Panel>
      ) : null}

      <Field label="Which are you doing?">
        <Choice options={MODES} value={mode} onChange={chooseMode} labels={LABELS} />
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
          {/**
           * **With the count, and the count is the whole point.**
           *
           * "Anything you logged" is a sentence somebody agrees to without
           * knowing what it costs. On a phone that has been in use since
           * February the honest version of it is a number, and on a phone
           * bought yesterday there is nothing to warn about at all — so an
           * empty farm says the short thing rather than making somebody weigh
           * a risk that is not there.
           *
           * It also used to say the records "stop being reachable", which was
           * true when a join deleted the id and stopped being true when
           * `retireLocalOrgId` started setting it aside instead. A warning
           * that overstates is spent the first time somebody checks it.
           */}
          <Panel label="This leaves your own farm behind">
            <Body>
              Joining somebody else's farm signs this phone in to their records.
              {exposure === null || exposure.records === 0
                ? ' Nothing you have logged here goes with you.'
                : ` The ${exposure.records.toLocaleString()} records on this phone stay on it and stop being shown — they come back if you sign out, and Get your records out can take a copy first.`}
            </Body>
          </Panel>

          {/**
            * One box for both things a farm can hand out.
            *
            * A six-character code read off a phone at the gate, or a long link
            * texted to a particular address. The person holding one did not
            * choose which they were given and should not have to know there are
            * two — `looksLikeJoinCode` decides which door to knock on, and the
            * server is the authority either way.
            *
            * **The link half had no door at all.** The server has minted
            * invites, published a lookup and accepted them since invites were
            * built; the app could send one and had nowhere to receive one. A
            * farm invited somebody and the invitation went nowhere.
            *
            * Not `caps` any more: a join code is Crockford and case-free, but a
            * base64url token is not, and upper-casing one destroys it.
            */}
          <Field
            label="The code or link they sent you"
            hint={
              invitation === null
                ? 'Six characters if they read it out — those last ten minutes. A long link lasts longer and only works for the address it was sent to.'
                : `${invitation.orgName} — ${invitation.invitedBy} invited you as ${ROLE_WORDS[invitation.role].toLowerCase()}. Use the address it was sent to.`
            }
          >
            <TextField
              value={code}
              onChangeText={setCode}
              placeholder="K4M9PT"
              maxLength={64}
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
          secret={!showPassword}
          testID="account-password"
        />
        {/**
          * Let somebody see what they typed.
          *
          * A password field on a phone is dots, and the phone is being held in
          * a barn by somebody wearing gloves who has just typed twelve
          * characters they invented ten seconds ago. Hiding it protects
          * against a shoulder, and there is no shoulder — the realistic threat
          * here is typing it wrong twice and being locked out of a farm.
          *
          * Off by default, because the field is still a password and somebody
          * signing in at a market stall should not have it painted on the
          * screen without asking.
          */}
        <Touch
          /* Toggles a state and stays put, and the word says which state. */
          affordance="check"
          onPress={() => setShowPassword(!showPassword)}
          accessibilityRole="button"
          accessibilityLabel={showPassword ? 'Hide the password' : 'Show the password'}
          testID="account-password-show"
          style={({ pressed }) => [styles.reveal, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.revealLabel, { color: colors.muted }]}>
            {showPassword ? 'Hide' : 'Show'}
          </Text>
        </Touch>
      </Field>

      {/**
        * Typed twice, on the two modes that CREATE one.
        *
        * Not on sign-in: there the password already exists, a wrong one is
        * told to you immediately, and a second box would be asking somebody to
        * prove they can type something they are about to have checked anyway.
        *
        * On the other two it is still worth the second box. There IS a reset
        * now — the link below sign-in — but it needs the address to be right
        * and reachable, and a password mistyped at signup is discovered by
        * somebody who may also have mistyped the email. Catching it here costs
        * one field; catching it there costs a round trip through an inbox.
        */}
      {mode === 'signin' ? null : (
        <Field label="Password again">
          <TextField
            value={confirm}
            onChangeText={setConfirm}
            placeholder="The same one"
            maxLength={200}
            secret={!showPassword}
            testID="account-password-confirm"
          />
        </Field>
      )}

      {/* Said only once it can be true — a mismatch while somebody is still
          typing the second box is not a mistake, it is being half way. */}
      {mode !== 'signin' && confirm !== '' && password !== confirm ? (
        <Failure message="Those two do not match." />
      ) : null}

      <Failure message={failure} />

      <Primary
        label={LABELS[mode]}
        disabled={saving || !enough}
        onPress={submit}
        testID="account-submit"
      />

      {/**
        * Where somebody discovers they are stuck, which is the only place this
        * belongs — §9. Offered on sign-in alone: on the other two modes there
        * is no password yet to have forgotten.
        */}
      {mode === 'signin' ? (
        <Touch
          affordance="check"
          onPress={() => {
            setRecovering(true);
            setChanged(false);
            setPassword('');
            setConfirm('');
          }}
          accessibilityRole="button"
          testID="account-forgot"
        >
          <Text style={[styles.revealLabel, { color: colors.muted }]}>
            Forgotten your password?
          </Text>
        </Touch>
      ) : null}

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

      <Text style={[styles.note, { color: colors.inkQuiet }]}>
        Been sent an invitation link? Open it instead — it brings the farm with it.
      </Text>
      </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  /** Sits under its field, aligned left with the label above it. */
  reveal: { alignSelf: 'flex-start', paddingVertical: SPACE.xs },
  revealLabel: {
    fontFamily: FONTS.data,
    fontSize: TYPE.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  note: {
    fontFamily: FONTS.body,
    fontSize: TYPE.body - 1,
    lineHeight: TYPE.body * 1.4,
    marginTop: SPACE.sm,
  },
});
