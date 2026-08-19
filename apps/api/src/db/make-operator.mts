/**
 * `pnpm ops:admin <email>` — who may open the operations board.
 *
 * ## Why this is not a role
 *
 * The board's first version checked `role === 'admin'`, and `admin` is a
 * **farm** role — the manager a farm's owner appoints on the Members screen.
 * `assignableRoles('owner')` returns all three roles and
 * `assignableRoles('admin')` returns `['admin', 'hand']`, so any farm owner
 * could mint one and any admin could mint another. That account would then have
 * read every farm on the server, granted free sync, and minted subscription
 * codes — cross-tenant escalation reachable from an ordinary farm screen, on
 * the one surface `scoped()` deliberately does not protect.
 *
 * A farm's admin manages a farm. An operator runs the box. Most usually an
 * operator is a plain `hand` on their own farm, and the two facts have nothing
 * to say about each other.
 *
 * ## Why it needs a shell
 *
 * Nothing on the wire writes `operatorSince`: not a payload schema, not
 * `/members/:id/role`, not the access token. This command is the only thing
 * that sets it, and it needs a shell on the server — the same authority model
 * `farm:grant` and `promo:new` have, and the one the masterplan asks for:
 * *"a grant that can be requested is a grant that can be requested by
 * anybody."*
 *
 *   pnpm ops:admin you@example.com            let them open the board
 *   pnpm ops:admin you@example.com --revoke   take it back
 *   pnpm ops:admin --list                     who has it now
 */

import { findUserByEmail, listOperators, setOperator } from './identity.ts';

const email = process.argv[2];
const revoke = process.argv.includes('--revoke');

function when(at: Date | undefined): string {
  return at === undefined ? 'unknown' : at.toISOString().slice(0, 10);
}

/**
 * The list, printed before anything changes and after anything does.
 *
 * "Who else can open this" has no other answer on a running box, and a grant
 * nobody can audit is one nobody can revoke with confidence.
 */
async function show(): Promise<void> {
  const operators = await listOperators();

  if (operators.length === 0) {
    console.log(`
  Nobody can open the operations board on this server.

  That is the state a fresh box is in, and it is the safe one — the board
  reads every farm, so it stays shut until somebody is named.
`);
    return;
  }

  console.log('\n  Operators of this server:\n');
  for (const operator of operators) {
    console.log(`    ${operator.email.padEnd(34)} ${operator.name.padEnd(20)} since ${when(operator.operatorSince)}`);
  }
  console.log('');
}

if (process.argv.includes('--list')) {
  await show();
  process.exit(0);
}

if (email === undefined || email.startsWith('--')) {
  console.error(`
  Usage: pnpm ops:admin <email> [--revoke]
         pnpm ops:admin --list

  The account must already exist — this grants the board to somebody who has
  signed up, it does not create anybody.
`);
  process.exit(1);
}

/**
 * Named before it is changed, for the reason `farm:grant` gives about farm ids:
 * the failure mode of the wrong address is silent, and printing whose account
 * it is makes a mistyped one visible at the moment it happens.
 */
const account = await findUserByEmail(email);

if (account === null) {
  console.error(`
  No account uses ${email}.

  This grants the board to somebody who has already signed up. If they have
  not, have them create an account in the app first — or check the address
  against: pnpm farm:show <farmId>
`);
  process.exit(1);
}

if (account.disabledAt !== undefined) {
  console.error(`
  ${email} belongs to an account that has been removed from its farm.

  The board refuses a disabled account on every request, so granting this
  would do nothing. Nothing has been changed.
`);
  process.exit(1);
}

if (revoke) {
  if (account.operatorSince === undefined) {
    console.log(`\n  "${account.name}" was not an operator. Nothing to take back.\n`);
    process.exit(0);
  }

  await setOperator(email, null);
  console.log(`
  Taken back from "${account.name}" (${email}).

  Their farm account is untouched — this was never a farm permission. Any
  board session they are holding stops working on its next request, because
  the board re-reads this on every one.
`);
  await show();
  process.exit(0);
}

if (account.operatorSince !== undefined) {
  console.log(`\n  "${account.name}" has been an operator since ${when(account.operatorSince)}. Nothing to do.\n`);
  process.exit(0);
}

await setOperator(email, new Date());

console.log(`
  "${account.name}" (${email}) can now open the operations board.

  They sign in with the password they already use for the app — this grants
  the board, it does not create a second credential.

  The board is NOT on the internet: it binds 127.0.0.1:3002 and nothing in the
  Caddyfile proxies it. Reach it over an SSH tunnel:

      ssh -L 3002:127.0.0.1:3002 <you>@<this box>
      then open http://localhost:3002

  And it only answers while its own unit is running:

      sudo systemctl status homefarm-ops

  Take it back with: pnpm ops:admin ${email} --revoke
`);

await show();
process.exit(0);
