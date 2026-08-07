import { useCallback, useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';
import { assignableRoles, canInvite, INVITE_TTL_DAYS, JOIN_CODE_TTL_MINUTES, type PendingInvite, type Role, roleSchema } from '@steading/contracts';
import { apiBase, currentAccessToken } from '@steading/core/api';
import { Choice, Confirm, Failure, Field, Primary, Secondary, TextField, useSaver } from '../components/Form';
import { Body, Panel } from '../components/Panel';
import { Screen } from '../components/Screen';
import { readCachedClaims, refreshSession } from '../auth/session';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, RADII, SPACE, TYPE } from '../theme/tokens';

/**
 * Who else is on this farm.
 *
 * Two people logging the same morning is the ordinary case on any farm with
 * help, and until the invite flow was built the only route was for the owner
 * to hand over their password. The server side has existed since then and had
 * no screen — so the feature was, from a farmer's point of view, not shipped.
 *
 * **This screen is online-only, and that is the one honest exception to
 * offline-first in the app.** Membership is not a record on this device; it is
 * a decision the server makes about who may write to the farm, and there is
 * nothing useful to queue. Every other screen keeps working in a barn.
 *
 * **The client copy of the role rules is UX only (invariant 8).** `canInvite`
 * and `assignableRoles` decide which controls to draw; the server re-derives
 * the actor's role from the database on the request that acts, and an admin
 * who edits their way past the chips below gets a 403 rather than an owner.
 */

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Manager',
  hand: 'Farm hand',
};

const ROLE_NOTES: Record<Role, string> = {
  owner: 'Everything, including inviting other owners.',
  admin: 'Everything except making someone an owner.',
  hand: 'Can record what happened — eggs, feed, losses, hours. Cannot change what things are.',
};

const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  disabled: z.boolean(),
});
type Member = z.infer<typeof memberSchema>;

/** Parsed, never trusted — an API response is external data (invariant 11). */
const membersSchema = z.object({ members: z.array(memberSchema) });
const invitesSchema = z.object({
  invites: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      role: roleSchema,
      invitedBy: z.string(),
      createdAt: z.number(),
      expiresAt: z.number(),
    }),
  ),
});
const mintedSchema = z.object({ token: z.string(), expiresAt: z.number() });
const joinCodeSchema = z.object({
  code: z.string(),
  role: roleSchema,
  expiresAt: z.number(),
});
type JoinCode = z.infer<typeof joinCodeSchema>;

async function call(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const base = apiBase();
  if (base === null) throw new Error('This build has no farm server configured.');

  /**
   * No token yet? Get one, rather than telling somebody to wait for something
   * that was never going to happen.
   *
   * The access token is held in memory only (see `core/api` for why) and is
   * minted by `refreshSession` — at boot, on resume, and on network regain. A
   * boot that happened before the network was up takes the offline path, which
   * correctly keeps the session but leaves the token null for the rest of the
   * process.
   *
   * That left this screen permanently stuck, and the recovery it offered could
   * not work: "Try again" re-ran the members fetch with the same absent token,
   * so the button was decoration and "in a moment" never came. Nothing else in
   * the app shows the difference, because every other screen renders the local
   * projection and never needs a header.
   */
  let token = currentAccessToken();
  if (token === null) {
    // Refuses only on a server that actually rejects the refresh token, in
    // which case it has already cleared this device — so a null return here
    // means signed out, not offline.
    const renewed = await refreshSession();
    token = currentAccessToken();

    if (token === null) {
      throw new Error(
        renewed === null
          ? 'This device is signed out. Sign in again to manage who is on the farm.'
          : 'The farm server could not be reached to renew this session.',
      );
    }
  }

  const res = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  if (res.status === 204) return null;

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: unknown })?.error;
    // The server names its refusals — "A farm needs at least one owner" — and
    // passing them through verbatim is what makes them useful.
    throw new Error(typeof message === 'string' ? message : 'The farm server refused that.');
  }
  return body;
}

export function MembersScreen(): React.ReactElement {
  const { colors } = useTheme();

  const [role, setRole] = useState<Role | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('hand');
  const [minted, setMinted] = useState<{ token: string; expiresAt: number } | null>(null);
  const [code, setCode] = useState<JoinCode | null>(null);

  const refresh = useCallback(async () => {
    setProblem(null);
    try {
      const claims = await readCachedClaims();
      setRole(claims?.role ?? null);
      setMe(claims?.userId ?? null);

      setMembers(membersSchema.parse(await call('/members')).members);

      // Only an owner or manager may list invites, so a hand asking would get
      // a 403 that is not a problem worth reporting to them.
      if (claims !== null && canInvite(claims.role)) {
        setInvites(invitesSchema.parse(await call('/invites')).invites);
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const invited = useSaver(useCallback(() => setEmail(''), []));

  const invite = useCallback(() => {
    void invited.save(async () => {
      const body = mintedSchema.parse(
        await call('/invites', { method: 'POST', body: { email: email.trim(), role: inviteRole } }),
      );
      /**
       * The link is shown once and never again.
       *
       * There is no email sender in this system, so the farm passes it on
       * themselves — and the server stores only a hash, so a database
       * disclosure does not hand over live invites. Losing this screen before
       * copying the link means revoking it and sending another.
       */
      setMinted(body);
      await refresh();
    });
  }, [invited, email, inviteRole, refresh]);

  const coded = useSaver(useCallback(() => undefined, []));

  /**
   * Minting replaces whatever was live, so a farm never has two working codes.
   *
   * The characters come back once, in this response, and are never readable
   * again — the server keeps only a hash, for the reason `join-codes.ts`
   * gives. An owner who loses the screen presses the button again.
   */
  const mintCode = useCallback(() => {
    void coded.save(async () => {
      setCode(
        joinCodeSchema.parse(
          await call('/join-codes', { method: 'POST', body: { role: inviteRole } }),
        ),
      );
    });
  }, [coded, inviteRole]);

  const act = useCallback(
    async (run: () => Promise<unknown>) => {
      try {
        await run();
        await refresh();
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error));
      }
    },
    [refresh],
  );

  const mayInvite = role !== null && canInvite(role);
  const grantable = role === null ? [] : assignableRoles(role);

  return (
    <Screen title="Who is on this farm" back>
      {problem === null ? null : (
        <Panel label="Could not reach the farm">
          <Body>{problem}</Body>
          <Body>
            This is the one screen that needs a signal — who may write to your farm is the
            server&rsquo;s decision, not this device&rsquo;s. Everything else still works.
          </Body>
          <Secondary label="Try again" onPress={() => void refresh()} />
        </Panel>
      )}

      {members === null ? null : members.length === 0 ? (
        <Panel label="Just you">
          <View style={styles.spot}>
          </View>
          <Body>Nobody else has been added yet.</Body>
        </Panel>
      ) : (
        members.map((member) => (
          <View
            key={member.id}
            style={[styles.card, { backgroundColor: colors.raised, borderColor: colors.border }]}
          >
            <Text style={[styles.name, { color: colors.ink }]}>
              {member.name}
              {member.id === me ? ' (you)' : ''}
            </Text>
            <Text style={[styles.detail, { color: colors.muted }]}>
              {member.email} · {ROLE_LABELS[member.role]}
              {member.disabled ? ' · removed' : ''}
            </Text>

            {/* Never on yourself: leaving is a different action with a
                different confirmation, and an accident here costs someone
                access to the farm they are standing on. */}
            {mayInvite && member.id !== me && !member.disabled ? (
              <>
                <Choice
                  options={grantable}
                  value={member.role}
                  onChange={(next) =>
                    void act(() =>
                      call(`/members/${member.id}/role`, { method: 'PATCH', body: { role: next } }),
                    )
                  }
                  labels={ROLE_LABELS}
                />
                <Confirm
                  label="Remove from the farm"
                  armedLabel="Tap again to remove"
                  onConfirm={() =>
                    void act(() => call(`/members/${member.id}`, { method: 'DELETE' }))
                  }
                />
              </>
            ) : null}
          </View>
        ))
      )}

      {invites.length > 0 ? (
        <Panel label="Waiting to be accepted">
          {invites.map((pending) => (
            <View key={pending.id} style={styles.invite}>
              <Text style={[styles.detail, { color: colors.ink }]}>
                {pending.email} · {ROLE_LABELS[pending.role]} · expires{' '}
                {new Date(pending.expiresAt).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                })}
              </Text>
              <Confirm
                label="Cancel it"
                armedLabel="Tap again to cancel"
                onConfirm={() =>
                  void act(() => call(`/invites/${pending.id}`, { method: 'DELETE' }))
                }
              />
            </View>
          ))}
        </Panel>
      ) : null}

      {minted === null ? null : (
        <Panel label="Send this link — it is shown once">
          <Body>
            It only works for {email.trim() === '' ? 'the address you entered' : email.trim()},
            so a leaked link is useless to anyone else. It expires in {INVITE_TTL_DAYS} days.
          </Body>
          <Text style={[styles.token, { color: colors.ink }]} selectable>
            {minted.token}
          </Text>
          <Secondary
            label="Share it"
            onPress={() => void Share.share({ message: minted.token })}
          />
          <Secondary label="Done" icon="check" onPress={() => setMinted(null)} />
        </Panel>
      )}

      {/**
        * The code, on the screen the owner is holding out (A2.5).
        *
        * Above the invite form deliberately: both people are standing at the
        * same gate, which is the ordinary case on a farm, and an email
        * invitation is the exception rather than the default it used to be.
        */}
      {mayInvite ? (
        <Panel label="Somebody standing next to you">
          <Body>
            Six characters they type into their own phone. It lasts{' '}
            {JOIN_CODE_TTL_MINUTES} minutes, works once, and needs no email at all.
          </Body>

          {code === null ? null : (
            <>
              {/* Wide-tracked and large: this is read off one screen and typed
                  into another, at arm's length, outdoors. */}
              <Text style={[styles.code, { color: colors.ink }]} selectable>
                {code.code}
              </Text>
              <Body>
                They will join as {ROLE_LABELS[code.role].toLowerCase()}. It stops working once
                somebody uses it.
              </Body>
            </>
          )}

          <Field label="What may they do?" hint={ROLE_NOTES[inviteRole]}>
            <Choice
              options={grantable}
              value={inviteRole}
              onChange={setInviteRole}
              labels={ROLE_LABELS}
            />
          </Field>

          <Failure message={coded.failure} />

          <Secondary
            label={code === null ? 'Show a join code' : 'Show a fresh one'}
            icon="sync"
            onPress={mintCode}
            testID="mint-join-code"
          />
        </Panel>
      ) : null}

      {mayInvite ? (
        <Panel label="Somebody who is not here">
          <Field label="Their email">
            <TextField
              value={email}
              onChangeText={setEmail}
              placeholder="them@example.com"
              keyboardType="email-address"
              maxLength={254}
              testID="invite-email"
            />
          </Field>

          <Field label="What may they do?" hint={ROLE_NOTES[inviteRole]}>
            <Choice
              options={grantable}
              value={inviteRole}
              onChange={setInviteRole}
              labels={ROLE_LABELS}
            />
          </Field>

          <Failure message={invited.failure} />

          <Primary
            label="Make an invite"
            disabled={invited.saving || !email.includes('@')}
            onPress={invite}
            testID="send-invite"
          />
        </Panel>
      ) : role === null ? null : (
        <Panel label="Adding people">
          <Body>
            Only the owner or a manager can add someone to a farm. Ask whoever set this one up.
          </Body>
        </Panel>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  spot: { alignItems: 'center', paddingVertical: SPACE.md },
  card: {
    padding: SPACE.lg,
    borderRadius: RADII.softHead,
    borderWidth: StyleSheet.hairlineWidth,
    gap: SPACE.sm,
  },
  invite: { gap: SPACE.sm },
  name: { fontFamily: FONTS.display, fontSize: TYPE.title },
  detail: { fontFamily: FONTS.data, fontSize: TYPE.label, letterSpacing: 0.4 },
  token: { fontFamily: FONTS.data, fontSize: TYPE.body },
  /**
   * Read off one screen at arm's length and typed into another, so it is set
   * like a number rather than like prose: monospaced, large, and tracked wide
   * enough that two characters cannot be taken for one.
   */
  code: {
    fontFamily: FONTS.data,
    fontSize: TYPE.hero,
    letterSpacing: 6,
    textAlign: 'center',
  },
});
