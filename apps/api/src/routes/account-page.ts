import { ACCOUNT_DELETE_PATH, PRODUCT_NAME } from '@homefarm/contracts';

/**
 * The page a person reaches without the app, to delete their account.
 *
 * Google Play requires one for any app with account creation: a web address,
 * reachable with nothing installed, that lets somebody delete the account and
 * the data behind it. It is also the only route for a farm whose phone is at
 * the bottom of a trough — the in-app path needs the app.
 *
 * ## The board's shape, for the board's reasons
 *
 * One string of HTML with its style and script inline, a nonce on both, no CDN
 * and no font host — `ops/page.ts` sets out why, and every reason holds here
 * with one added: this page is on the **API's** host and reachable by anybody,
 * so the content policy that stops an injected script running is doing more
 * work than it does on a board behind a password. Nothing from the server
 * reaches this page as markup; the script puts every sentence in through
 * `textContent`.
 *
 * ## `form-action 'none'` is doing real work here, unlike on the board
 *
 * The form is submitted by script and the handler calls `preventDefault`, so in
 * the ordinary case nothing native happens. The case that is not ordinary is
 * the script failing to run at all — a stale nonce, an extension, a browser
 * that refused it — where a `<form>` with no `action` falls back to submitting
 * to the current URL **by GET**, which would put somebody's password in a query
 * string, in their history, and in this server's access log.
 *
 * The policy refuses that outright. It is the one directive on this page whose
 * absence would be a defect rather than a weakening, so it is named here rather
 * than left to be inherited from a shared helper.
 *
 * ## What it says before the button
 *
 * The same three things the app says, in the same order, because a person
 * reading this has usually not got the app in front of them to compare: that
 * the last owner's deletion takes the whole farm and every other member's
 * account on it; that a subscription is cancelled at Google Play and not here;
 * and that the records on any phone stay on that phone. A form that deletes a
 * farm must not be shorter than the warning.
 */
export function accountDeletePage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:,">
<title>Delete your ${PRODUCT_NAME} account</title>
<style nonce="${nonce}">
  :root {
    color-scheme: light dark;
    --bg: #f6f5f2; --card: #fffefb; --ink: #1c1a17; --muted: #6b665e;
    --line: #dedad2; --accent: #3f6f4f; --bad: #9b2c2c;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14150f; --card: #1c1e17; --ink: #ece9e1; --muted: #9a978d;
      --line: #2e3128; --accent: #8fbf9c; --bad: #e08585;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 560px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 22px; margin: 0 0 16px; letter-spacing: -0.01em; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;
       color: var(--muted); margin: 0 0 8px; font-weight: 600; }
  p { margin: 0 0 12px; }
  .card { background: var(--card); border: 1px solid var(--line);
          border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  label { display: block; font-size: 13px; color: var(--muted); margin: 10px 0 4px; }
  input[type=email], input[type=password] {
    font: inherit; width: 100%; padding: 9px 10px; border-radius: 7px;
    border: 1px solid var(--line); background: var(--bg); color: var(--ink);
  }
  .agree { display: flex; gap: 10px; align-items: flex-start; margin: 14px 0; }
  .agree input { margin-top: 5px; }
  button {
    font: inherit; padding: 10px 14px; border-radius: 7px; border: 1px solid transparent;
    background: var(--bad); color: var(--bg); font-weight: 600; cursor: pointer; width: 100%;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .said { margin-top: 12px; font-size: 15px; }
  .said.bad { color: var(--bad); }
  .said.ok { color: var(--accent); }
  .hint { color: var(--muted); font-size: 13px; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1>Delete your ${PRODUCT_NAME} account</h1>

  <div class="card">
    <h2>What this does</h2>
    <p>If you are the farm's only owner, this deletes the farm: every record,
    every photo, and the accounts of everybody else on it. If somebody else owns
    the farm too, or you joined it as a manager or a farm hand, only your own
    account is deleted and the farm carries on without you.</p>
    <p>Anything logged on a phone stays on that phone. This deletes what the
    farm's server holds, not what you can see with the app open.</p>
    <p>A subscription is not cancelled by this. Cancel it in Google Play first,
    or the store will go on charging for a farm that no longer exists.</p>
    <p class="hint">Deleted farms remain in encrypted server backups for a
    limited time before those are removed too.</p>
  </div>

  <form id="form" class="card">
    <h2>Confirm it is you</h2>
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="username" required maxlength="320">
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" required maxlength="1024">
    <p class="hint">An account that only ever signed in with Google has no
    password. Delete it from inside the app: Settings, then Your account.</p>
    <div class="agree">
      <input id="agree" type="checkbox">
      <label for="agree">I understand this cannot be undone.</label>
    </div>
    <button id="go" type="submit" disabled>Delete my account</button>
    <div class="said" id="said"></div>
  </form>
</main>

<script nonce="${nonce}">
(function () {
  var form = document.getElementById('form');
  var agree = document.getElementById('agree');
  var go = document.getElementById('go');
  var said = document.getElementById('said');

  agree.addEventListener('change', function () { go.disabled = !agree.checked; });

  function say(text, kind) {
    // textContent, never innerHTML: the sentence came from the server.
    said.textContent = text;
    said.className = 'said ' + kind;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!agree.checked) return;
    go.disabled = true;
    say('Deleting…', '');

    fetch(${JSON.stringify(ACCOUNT_DELETE_PATH)}, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          say(typeof body.error === 'string' ? body.error : 'That did not work. Try again in a minute.', 'bad');
          go.disabled = false;
          return;
        }
        form.reset();
        say(body.deleted === 'farm'
          ? 'Your account and the farm have been deleted.'
          : 'Your account has been deleted. The farm carries on without you.', 'ok');
      });
    }).catch(function () {
      say('The server could not be reached. Check the connection and try again.', 'bad');
      go.disabled = false;
    });
  });
})();
</script>
</body>
</html>
`;
}
