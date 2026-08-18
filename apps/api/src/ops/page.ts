/**
 * The board, as one self-contained page.
 *
 * ## No build step, no framework, no assets
 *
 * A string of HTML with its CSS and script inline. The alternative is a second
 * front end with its own toolchain, deployed beside the API, for a page one
 * person opens to answer a question — and every part of that is cost with no
 * matching benefit. It also means there is nothing to fetch from anywhere: no
 * CDN, no font, no external stylesheet, so a box with no outbound network
 * serves the same page it always did.
 *
 * ## Everything from the server goes in as text, never as markup
 *
 * Farm names are typed by farmers and reach this page. `textContent` is used
 * for every value without exception, so a farm called `<img onerror=…>` renders
 * as those characters — which is the correct display *and* the correct
 * security, from the same line. There is no `innerHTML` in this file for
 * anything that came out of the database, and the review question is simply
 * whether that stays true.
 *
 * ## What it deliberately does not show
 *
 * Records. `ACCESS-AND-BILLING.md` §5 draws that line for `farm:show` and it
 * holds here: counts and timings, farm names and ids, and nothing a farm wrote.
 */
/**
 * The nonce is threaded through rather than generated here, because the header
 * and the markup have to carry the same one and only the route can set a
 * header. A page rendered with a nonce the response does not name is a page
 * whose script never runs — so the two come from one value, passed in.
 */
export function boardPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<!-- An empty icon, so a browser does not ask for one this process will not serve. -->
<link rel="icon" href="data:,">
<title>Steading — operations</title>
<style nonce="${nonce}">
  :root {
    color-scheme: light dark;
    --bg: #f6f5f2; --card: #fffefb; --ink: #1c1a17; --muted: #6b665e;
    --line: #dedad2; --accent: #3f6f4f; --warn: #8a4b2a; --bad: #9b2c2c;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14150f; --card: #1c1e17; --ink: #ece9e1; --muted: #9a978d;
      --line: #2e3128; --accent: #8fbf9c; --warn: #d99a6c; --bad: #e08585;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;
       color: var(--muted); margin: 0 0 10px; font-weight: 600; }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 20px; }
  header .sub { color: var(--muted); font-size: 13px; }
  .card { background: var(--card); border: 1px solid var(--line);
          border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .figures { display: flex; flex-wrap: wrap; gap: 24px; }
  .figure .n { font-size: 26px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .figure .l { color: var(--muted); font-size: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th { text-align: left; color: var(--muted); font-weight: 600; font-size: 12px;
       text-transform: uppercase; letter-spacing: 0.06em; padding: 6px 10px 6px 0; }
  td { padding: 7px 10px 7px 0; border-top: 1px solid var(--line);
       font-variant-numeric: tabular-nums; }
  td.name { font-variant-numeric: normal; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
         color: var(--muted); }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px;
          border: 1px solid var(--line); font-size: 12px; }
  .warn { color: var(--warn); } .bad { color: var(--bad); } .ok { color: var(--accent); }
  form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  input, button, select {
    font: inherit; padding: 7px 10px; border-radius: 7px;
    border: 1px solid var(--line); background: var(--bg); color: var(--ink);
  }
  button { background: var(--accent); color: var(--bg); border-color: transparent;
           font-weight: 600; cursor: pointer; }
  button.quiet { background: transparent; color: var(--ink); border-color: var(--line);
                 font-weight: 500; }
  button:disabled { opacity: 0.5; cursor: progress; }
  .said { margin-top: 10px; font-size: 14px; }
  .code-out { font-family: ui-monospace, Menlo, monospace; font-size: 18px;
              letter-spacing: 0.06em; padding: 10px; border: 1px dashed var(--line);
              border-radius: 8px; margin-top: 10px; }
  .hint { color: var(--muted); font-size: 12px; margin-top: 6px; }
  #signin { max-width: 380px; margin: 12vh auto; }
  #signin input { width: 100%; margin-bottom: 8px; }
  #signin button { width: 100%; }
  [hidden] { display: none !important; }
</style>
</head>
<body>

<div id="signin" class="card">
  <h1>Steading operations</h1>
  <p class="hint">An administrator account on this server. Nothing here shows a farm's records.</p>
  <form id="signin-form">
    <input id="email" type="email" autocomplete="username" placeholder="Email" required>
    <input id="password" type="password" autocomplete="current-password" placeholder="Password" required>
    <button type="submit">Sign in</button>
  </form>
  <div class="said" id="signin-said"></div>
</div>

<main id="board" hidden>
  <header>
    <h1>Steading operations</h1>
    <span class="sub" id="who"></span>
    <span class="sub" style="margin-left:auto"><button class="quiet" id="refresh">Refresh</button></span>
  </header>

  <div class="grid">
    <section class="card">
      <h2>Farms</h2>
      <div class="figures" id="subscribers"></div>
    </section>
    <section class="card">
      <h2>Tokens</h2>
      <div class="figures" id="tokens"></div>
    </section>
    <section class="card">
      <h2>Server</h2>
      <div class="figures" id="health"></div>
      <div class="hint" id="sweep"></div>
    </section>
  </div>

  <section class="card">
    <h2>Sync trouble</h2>
    <div id="trouble"></div>
  </section>

  <section class="card">
    <h2>Builds in the field</h2>
    <div id="builds"></div>
    <div class="hint">Counted per account, not per handset — a person with two phones on
      different builds shows as whichever synced last.</div>
  </section>

  <section class="card">
    <h2>Every farm</h2>
    <div id="farms"></div>
  </section>

  <div class="grid">
    <section class="card">
      <h2>Mint a promotion code</h2>
      <form id="promo-form">
        <input id="promo-days" type="number" min="1" max="3650" placeholder="Days (blank = forever)" style="width:190px">
        <input id="promo-uses" type="number" min="1" max="1000" value="1" style="width:90px">
        <input id="promo-note" type="text" placeholder="Note" style="width:160px">
        <button type="submit">Mint</button>
      </form>
      <div id="promo-said" class="said"></div>
    </section>

    <section class="card">
      <h2>Grant or revoke sync</h2>
      <form id="grant-form">
        <input id="grant-org" type="text" placeholder="Farm id" style="width:250px" required>
        <input id="grant-note" type="text" placeholder="Note" style="width:150px">
        <button type="submit">Grant</button>
        <button type="button" class="quiet" id="revoke">Revoke</button>
      </form>
      <div id="grant-said" class="said"></div>
      <div class="hint">Passwords are not changeable from here, on purpose. Use
        <code>pnpm db:password</code> on the box.</div>
    </section>
  </div>
</main>

<script nonce="${nonce}">
(() => {
  'use strict';

  /**
   * In a variable, never a cookie. Nothing the browser attaches by itself means
   * nothing a another site can make this page do on your behalf — and a refresh
   * signing you out is the honest consequence of that, not an oversight.
   */
  let token = null;

  const $ = (id) => document.getElementById(id);
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value === null || value === undefined ? '—' : String(value);
    if (className) node.className = className;
    return node;
  };

  async function call(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.error) || ('Request failed (' + res.status + ')'));
    return body;
  }

  function figure(into, n, label, className) {
    const wrap = document.createElement('div');
    wrap.className = 'figure';
    wrap.append(text('div', n, 'n' + (className ? ' ' + className : '')), text('div', label, 'l'));
    into.append(wrap);
  }

  const bytes = (n) => {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  };

  const ago = (iso) => {
    if (!iso) return 'never';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return days + 'd ago';
  };

  const forMs = (ms) => {
    if (ms === null || ms === undefined) return '—';
    const hours = ms / 3600000;
    if (hours < 1) return Math.round(ms / 60000) + 'm';
    if (hours < 48) return hours.toFixed(1) + 'h';
    return Math.floor(hours / 24) + 'd';
  };

  function table(into, columns, rows) {
    into.replaceChildren();
    if (rows.length === 0) {
      into.append(text('p', columns.empty || 'Nothing to show.', 'hint'));
      return;
    }
    const t = document.createElement('table');
    const head = document.createElement('tr');
    for (const c of columns.head) head.append(text('th', c));
    t.append(head);
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const cell of row) {
        tr.append(text('td', cell.value, cell.className));
      }
      t.append(tr);
    }
    into.append(t);
  }

  function draw(board) {
    const counts = {};
    for (const farm of board.farms) counts[farm.sync] = (counts[farm.sync] || 0) + 1;

    const subs = $('subscribers');
    subs.replaceChildren();
    figure(subs, board.farms.length, 'farms');
    figure(subs, counts.paid || 0, 'paying', 'ok');
    figure(subs, (counts.comped || 0) + (counts.granted || 0), 'comped');
    figure(subs, (counts.unsubscribed || 0) + (counts.lapsed || 0), 'free');
    if (counts.open) figure(subs, counts.open, 'open server', 'warn');

    const tk = $('tokens');
    tk.replaceChildren();
    figure(tk, board.tokens.promoRedemptions, 'codes claimed', 'ok');
    figure(tk, board.tokens.promoLive, 'codes live');
    figure(tk, board.tokens.promoMinted, 'codes minted');
    figure(tk, board.tokens.invitesAccepted, 'invites taken');
    figure(tk, board.tokens.invitesPending, 'invites open');

    const h = $('health');
    h.replaceChildren();
    const db = board.health.databaseMs;
    figure(h, db === null ? 'down' : db + ' ms', 'database', db === null ? 'bad' : 'ok');
    figure(h, forMs(board.health.uptimeSeconds * 1000), 'uptime');
    figure(h, bytes(board.health.recordBytes), 'records');
    figure(h, bytes(board.health.photoBytes), 'photos');

    const sweep = board.health.sweep;
    $('sweep').textContent = sweep.failed
      ? 'Sweeper failed: ' + sweep.failed
      : sweep.at
        ? 'Sweeper last ran ' + ago(sweep.at) + ' on ' + (sweep.host || 'an unnamed host') +
          ' — ' + sweep.found + ' undecided, ' + sweep.decided + ' decided' +
          (sweep.capped ? ', and stopped at its ceiling with more to do.' : '.')
        // Said this way rather than "since this process started", which was the
        // old wording and was wrong twice over: the sweeper runs in the API
        // unit, not this one, so it was never about this process — and this
        // sentence is also what a box shows when the API unit is not running at
        // all, which is worth being able to read as that.
        : 'No sweeper pass has been recorded. The API service may not be running.';
    $('sweep').className = 'hint' + (sweep.failed || sweep.capped ? ' bad' : '');

    table(
      $('trouble'),
      {
        head: ['Farm', 'Pending', 'Oldest', 'Rejected', 'Conflicts'],
        empty: 'Nothing pending, nothing refused. This is what a healthy server looks like.',
      },
      board.trouble.map((t) => [
        { value: t.name, className: 'name' },
        { value: t.pending, className: t.pending > 0 ? 'warn' : '' },
        { value: forMs(t.oldestPendingMs) },
        { value: t.rejected },
        { value: t.conflict },
      ]),
    );

    const fleet = {};
    for (const farm of board.farms) {
      for (const b of farm.builds) fleet[b.version] = (fleet[b.version] || 0) + b.people;
    }
    const versions = Object.keys(fleet).sort((a, b) => {
      const l = a.split('.').map(Number), r = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) if ((r[i] || 0) !== (l[i] || 0)) return (r[i] || 0) - (l[i] || 0);
      return 0;
    });
    table(
      $('builds'),
      { head: ['Build', 'Accounts'], empty: 'Nobody has reported a build yet.' },
      versions.map((v) => [{ value: v }, { value: fleet[v] }]),
    );

    table(
      $('farms'),
      { head: ['Farm', 'Id', 'Who', 'Records', 'Sync', 'Build', 'Last write'] },
      board.farms.map((f) => [
        { value: f.name, className: 'name' },
        { value: f.orgId, className: 'name' },
        { value: f.people },
        { value: f.records },
        { value: f.sync, className: 'name' },
        { value: f.builds.length ? f.builds[0].version + (f.builds.length > 1 ? ' +' + (f.builds.length - 1) : '') : '—', className: 'name' },
        { value: ago(f.lastWriteAt), className: 'name' },
      ]),
    );
  }

  async function load() {
    const button = $('refresh');
    button.disabled = true;
    try {
      draw(await call('/board'));
    } catch (error) {
      if (String(error.message).includes('expired') || String(error.message) === 'Sign in.') {
        token = null;
        $('board').hidden = true;
        $('signin').hidden = false;
        $('signin-said').textContent = 'That session ended. Sign in again.';
      } else {
        $('sweep').textContent = error.message;
      }
    } finally {
      button.disabled = false;
    }
  }

  $('signin-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('signin-said').textContent = '';
    try {
      const answer = await call('/session', {
        method: 'POST',
        body: JSON.stringify({ email: $('email').value, password: $('password').value }),
      });
      token = answer.token;
      $('password').value = '';
      $('who').textContent = answer.name;
      $('signin').hidden = true;
      $('board').hidden = false;
      await load();
    } catch (error) {
      $('signin-said').textContent = error.message;
      $('signin-said').className = 'said bad';
    }
  });

  $('refresh').addEventListener('click', load);

  $('promo-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const said = $('promo-said');
    said.replaceChildren();
    try {
      const days = $('promo-days').value;
      const answer = await call('/actions/promo', {
        method: 'POST',
        body: JSON.stringify({
          days: days === '' ? null : Number(days),
          uses: Number($('promo-uses').value || 1),
          ...($('promo-note').value ? { note: $('promo-note').value } : {}),
        }),
      });
      said.append(text('div', answer.code, 'code-out'));
      said.append(text('div',
        'Worth ' + (answer.days === null ? 'sync, forever' : 'sync for ' + answer.days + ' days') +
        ', for ' + answer.uses + (answer.uses === 1 ? ' farm' : ' farms') +
        '. Write it down — it is stored hashed and cannot be shown again.', 'hint'));
      $('promo-note').value = '';
    } catch (error) {
      said.append(text('div', error.message, 'bad'));
    }
  });

  async function grant(revoke) {
    const said = $('grant-said');
    said.replaceChildren();
    try {
      const answer = await call('/actions/grant', {
        method: 'POST',
        body: JSON.stringify({
          orgId: $('grant-org').value.trim(),
          revoke,
          ...($('grant-note').value ? { note: $('grant-note').value } : {}),
        }),
      });
      said.append(text('div',
        answer.name + (answer.granted ? ' now syncs.' : ' no longer has a grant.'),
        answer.granted ? 'ok' : 'warn'));
      await load();
    } catch (error) {
      said.append(text('div', error.message, 'bad'));
    }
  }

  $('grant-form').addEventListener('submit', (event) => { event.preventDefault(); grant(false); });
  $('revoke').addEventListener('click', () => grant(true));
})();
</script>
</body>
</html>`;
}
