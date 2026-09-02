/**
 * app.js — router, views and actions.
 *
 * Deliberately plain: no framework, no build step, ES modules straight from the
 * browser. Views are functions that return HTML strings; actions are triggered
 * by `data-action` attributes and handled by one delegated listener.
 *
 * All business logic lives in pricing.js and sessionState.js. This file decides
 * what to show; it never decides what a price is or whether a session confirms.
 */

import * as store from './store.js';
import { seed } from './seed.js';
import { pricePerHead, priceLadder, savingsFrom, formatINR } from './pricing.js';
import {
  SESSION, COMMITMENT, countsAsLive, seatsToQuorum, isFull,
  canCommit, canWithdraw, resolveSession, validateNewSession, validateHostEdit, generateCode,
} from './sessionState.js';

const app = () => document.getElementById('app');

/* ================================================================== *
 * Small helpers
 * ================================================================== */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const initials = (name) =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function fmtShort(iso) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function countdown(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'Closed';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `Closes in ${d}d ${h}h`;
  if (h > 0) return `Closes in ${h}h ${m}m`;
  return `Closes in ${m}m`;
}

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toast(message, kind = '') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + (kind ? 'toast-' + kind : '');
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function go(hash) {
  location.hash = hash;
}

const CATEGORIES = [
  ['all', 'All'], ['fitness', 'Fitness'], ['craft', 'Craft'], ['outdoors', 'Outdoors'],
  ['learning', 'Learning'], ['sports', 'Sports'], ['social', 'Social'],
];

/* ================================================================== *
 * Domain helpers — the bridge between the pure modules and the store
 * ================================================================== */

function liveCommitments(sessionId) {
  return store.listCommitments({ sessionId }).filter(countsAsLive);
}

function liveCount(sessionId) {
  return liveCommitments(sessionId).length;
}

function myCommitment(sessionId, userId) {
  if (!userId) return null;
  return store.listCommitments({ sessionId, userId }).find(countsAsLive) || null;
}

/**
 * Lazy resolution, applied on every read.
 * Returns the up-to-date session and whether anything changed.
 */
function resolveAndPersist(session) {
  if (!session) return { session: null, changed: false };
  const n = liveCount(session.id);
  const r = resolveSession(session, n, new Date());
  if (r.nextStatus === session.status) return { session, changed: false };

  const updated = store.updateSession(session.id, {
    status: r.nextStatus,
    lockedPricePerHead: r.lockedPrice,
  });

  if (r.commitmentTransition === 'CONFIRM_ALL') {
    store.transitionCommitments(session.id, [COMMITMENT.PENDING], COMMITMENT.CONFIRMED, () => ({
      confirmationCode: generateCode(),
    }));
  } else if (r.commitmentTransition === 'RELEASE_ALL') {
    store.transitionCommitments(session.id, [COMMITMENT.PENDING, COMMITMENT.CONFIRMED], COMMITMENT.RELEASED);
  }

  return { session: updated, changed: true, to: r.nextStatus };
}

function resolveAll() {
  store.listSessions().forEach((s) => resolveAndPersist(s));
}

function currentPrice(session) {
  if (session.lockedPricePerHead != null) return session.lockedPricePerHead;
  return pricePerHead(session.fixedCost, session.hostMargin, session.priceFloor, liveCount(session.id));
}

function ladderFor(session) {
  return priceLadder({
    fixedCost: session.fixedCost,
    hostMargin: session.hostMargin,
    priceFloor: session.priceFloor,
    liveCount: liveCount(session.id),
    minSeats: session.minSeats,
    maxSeats: session.maxSeats,
  });
}

/* ================================================================== *
 * Shared components
 * ================================================================== */

function meter(session) {
  const n = liveCount(session.id);
  const need = seatsToQuorum(n, session.minSeats);
  const pips = Math.max(session.minSeats, n);
  const done = need === 0;
  let html = '<div class="meter">';
  for (let i = 0; i < pips; i++) {
    html += `<div class="pip ${i < n ? (done ? 'done' : 'on') : ''}"></div>`;
  }
  html += '</div>';
  const caption = done
    ? `<strong>${n} committed</strong> · quorum met`
    : `<strong>${n} of ${session.minSeats}</strong> · ${need} more to confirm`;
  return html + `<div class="meter-caption">${caption}</div>`;
}

function priceBlock(session) {
  const n = liveCount(session.id);
  const now = currentPrice(session);
  const atFull = pricePerHead(session.fixedCost, session.hostMargin, session.priceFloor, session.maxSeats);
  const locked = session.lockedPricePerHead != null;
  return `
    <div>
      <div class="price-label">${locked ? 'Locked price each' : 'Price each right now'}</div>
      <div class="price-now">${formatINR(now)}</div>
      ${!locked && atFull < now ? `<div class="price-drop">↓ ${formatINR(atFull)} at ${session.maxSeats} people</div>` : ''}
    </div>`;
}

function statusPill(status) {
  const map = {
    OPEN: ['pill', 'Open'],
    CONFIRMED: ['pill pill-go', "It's on"],
    FAILED: ['pill pill-stop', 'Missed quorum'],
    CANCELLED: ['pill pill-stop', 'Cancelled'],
    COMPLETED: ['pill', 'Done'],
  };
  const [cls, label] = map[status] || ['pill', status];
  return `<span class="${cls}">${label}</span>`;
}

function topbar(user, active) {
  const link = (href, label, key) =>
    `<a class="navlink ${active === key ? 'active' : ''}" href="${href}">${label}</a>`;
  return `
  <div class="topbar">
    <div class="wrap topbar-inner">
      <a class="brand" href="#/">🫱 Ad<span>da</span></a>
      <nav class="navlinks">
        ${link('#/', 'Discover', 'discover')}
        ${link('#/me', 'My commitments', 'me')}
        ${link('#/host', 'My sessions', 'host')}
      </nav>
      <div class="spacer"></div>
      <a class="btn btn-primary btn-sm" href="#/host/new">Host a session</a>
      <span class="avatar" title="${esc(user.fullName)}">${initials(user.fullName)}</span>
      <button class="btn btn-ghost btn-sm" data-action="logout">Log out</button>
    </div>
  </div>`;
}

function footer() {
  return `<footer class="foot">Adda · a conditional-commitment marketplace · built for MICA PGP-MC 2025</footer>`;
}

/* ================================================================== *
 * View: auth
 * ================================================================== */

let authMode = 'login';

function viewAuth() {
  const isLogin = authMode === 'login';
  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-brand">
        <div class="big">🫱 Ad<span>da</span></div>
        <p>Sessions that only happen when enough people show up — and get cheaper the more who do.</p>
      </div>
      <div class="card card-pad">
        <div class="auth-toggle">
          <button class="${isLogin ? 'active' : ''}" data-action="auth-mode" data-mode="login">Log in</button>
          <button class="${!isLogin ? 'active' : ''}" data-action="auth-mode" data-mode="signup">Sign up</button>
        </div>
        <div id="auth-error"></div>
        <form data-action="${isLogin ? 'login' : 'signup'}">
          ${isLogin ? '' : `
          <div class="field">
            <label>Your name</label>
            <input name="fullName" autocomplete="name" placeholder="Asha Patel" required />
          </div>`}
          <div class="field">
            <label>Email</label>
            <input name="email" type="email" autocomplete="email" placeholder="you@example.com" required />
          </div>
          <div class="field">
            <label>Password</label>
            <input name="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" placeholder="At least 6 characters" required />
          </div>
          <button class="btn btn-primary btn-block btn-lg" type="submit">${isLogin ? 'Log in' : 'Create account'}</button>
        </form>
        <div class="demo-creds">
          <b>Demo accounts</b> — password <code>AddaDemo123!</code><br />
          <code>host@adda.demo</code> · <code>asha@adda.demo</code> · <code>rohan@adda.demo</code>
          <br /><button class="btn btn-sm" data-action="fill-demo">Fill in Asha's login</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ================================================================== *
 * View: discover
 * ================================================================== */

let activeCategory = 'all';

function sessionCard(s) {
  const live = s.status === SESSION.OPEN || s.status === SESSION.CONFIRMED;
  const ribbon =
    s.status === SESSION.CONFIRMED ? `<div class="ribbon">IT'S ON</div>`
    : s.status === SESSION.FAILED ? `<div class="ribbon ribbon-stop">MISSED QUORUM</div>`
    : '';

  // A session that's over doesn't get a live price or a quorum meter — it gets
  // an epitaph. Showing "3 more to confirm" on a dead session would be a lie.
  const middle = live
    ? `${priceBlock(s)}<div>${meter(s)}</div>`
    : `<p class="dim" style="margin:0">${
        s.status === SESSION.FAILED
          ? "Didn't reach quorum by the deadline. Nobody was charged."
          : s.status === SESSION.CANCELLED
          ? 'The host cancelled this one.'
          : 'This has already happened.'
      }</p>`;

  return `
  <a class="card scard" href="#/s/${s.id}" style="${live ? '' : 'opacity:.72'}">
    ${ribbon}
    <div class="scard-top">${s.emoji || '🫱'}</div>
    <div class="scard-body">
      <div><span class="pill">${esc(s.category)}</span></div>
      <div class="scard-title">${esc(s.title)}</div>
      <div class="dim">${esc(s.venue)} · ${fmtShort(s.startsAt)}</div>
      ${middle}
      <div class="dim" style="margin-top:auto">${s.status === SESSION.OPEN ? countdown(s.commitDeadline) : statusPill(s.status)}</div>
    </div>
  </a>`;
}

/** Live sessions first, soonest deadline first; finished ones sink to the bottom. */
function feedOrder(a, b) {
  const rank = (s) => (s.status === SESSION.OPEN ? 0 : s.status === SESSION.CONFIRMED ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  return new Date(a.commitDeadline) - new Date(b.commitDeadline);
}

function viewDiscover(user) {
  resolveAll();
  const all = store.listSessions().filter((s) => s.status !== SESSION.CANCELLED).sort(feedOrder);
  const list = activeCategory === 'all' ? all : all.filter((s) => s.category === activeCategory);

  const chips = CATEGORIES.map(
    ([k, label]) => `<button class="chip ${activeCategory === k ? 'active' : ''}" data-action="filter" data-cat="${k}">${label}</button>`
  ).join('');

  return `
  ${topbar(user, 'discover')}
  <div class="wrap">
    <div style="margin:30px 0 0">
      <h1>What's happening around you</h1>
      <p class="lede">Nothing here is confirmed until enough people commit. Join early and the price only ever falls.</p>
    </div>
    <div class="chips">${chips}</div>
    ${
      list.length
        ? `<div class="grid">${list.map(sessionCard).join('')}</div>`
        : `<div class="empty"><h2>Nothing on yet</h2><p>Be the one who starts something.</p><a class="btn btn-primary" href="#/host/new">Host the first one</a></div>`
    }
    ${footer()}
  </div>`;
}

/* ================================================================== *
 * View: session detail
 * ================================================================== */

function viewSession(user, id, refId) {
  const found = store.getSession(id);
  if (!found) return notFound(user);
  const { session: s } = resolveAndPersist(found);

  const n = liveCount(s.id);
  const host = store.getUser(s.hostId);
  const mine = myCommitment(s.id, user.id);
  const attendees = liveCommitments(s.id).map((c) => store.getUser(c.userId)).filter(Boolean);
  const ladder = ladderFor(s);
  const commitCheck = canCommit(s, n, user.id);
  const need = seatsToQuorum(n, s.minSeats);

  const ladderRows = ladder
    .map((r) => {
      const cls = r.label === 'confirms' ? 'is-confirm' : r.label === 'now' ? 'is-now' : '';
      return `<tr class="${cls}"><td>${r.people} <span class="dim">(${r.label})</span></td><td>${formatINR(r.price)}</td></tr>`;
    })
    .join('');

  let bar = '';
  if (mine && mine.status === COMMITMENT.CONFIRMED) {
    bar = `
      <div class="row-between">
        <div>
          <div class="eyebrow">You're confirmed</div>
          <div class="code">${esc(mine.confirmationCode || '')}</div>
        </div>
        <button class="btn" data-action="copy-invite" data-session="${s.id}" data-commitment="${mine.id}">Copy invite link</button>
      </div>`;
  } else if (mine && mine.status === COMMITMENT.PENDING) {
    bar = `
      <div class="row-between">
        <div>
          <div style="font-weight:650">You're in — pending</div>
          <div class="dim">${need > 0 ? `${need} more ${need === 1 ? 'person' : 'people'} and this is on.` : 'Confirming…'}</div>
        </div>
        <div class="row">
          <button class="btn" data-action="copy-invite" data-session="${s.id}" data-commitment="${mine.id}">Copy invite link</button>
          <button class="btn btn-danger" data-action="withdraw" data-commitment="${mine.id}">Withdraw</button>
        </div>
      </div>`;
  } else if (commitCheck.ok) {
    const likely = pricePerHead(s.fixedCost, s.hostMargin, s.priceFloor, Math.max(s.minSeats, n + 1));
    bar = `
      <button class="btn btn-primary btn-lg btn-block" data-action="commit" data-session="${s.id}" data-ref="${refId || ''}">
        Commit — ${formatINR(currentPrice(s))} today, likely ${formatINR(likely)}
      </button>`;
  } else {
    bar = `<button class="btn btn-lg btn-block" disabled>${esc(commitCheck.reason)}</button>`;
  }

  return `
  ${topbar(user, '')}
  <div class="wrap narrow">
    <p style="margin:22px 0 0"><a class="navlink" href="#/">← Back</a></p>

    <div class="card card-pad" style="margin-top:10px">
      <div class="row-between">
        <div class="hero-emoji">${s.emoji || '🫱'}</div>
        ${statusPill(s.status)}
      </div>
      <h1 style="margin-top:12px">${esc(s.title)}</h1>
      <div class="row" style="margin-bottom:14px">
        <span class="avatar">${initials(host?.fullName)}</span>
        <span class="muted">Hosted by ${esc(host?.fullName || 'someone')}</span>
      </div>
      <div class="dim">${esc(s.venue)}</div>
      <div class="dim">${fmtDate(s.startsAt)}</div>
    </div>

    <div class="panel" style="margin-top:16px">
      <h2>${need > 0 ? `${need} more ${need === 1 ? 'person' : 'people'} and this is on` : "Quorum met — it's on"}</h2>
      ${meter(s)}
      <div class="dim" style="margin-top:10px">${s.status === SESSION.OPEN ? countdown(s.commitDeadline) + ' · closes ' + fmtShort(s.commitDeadline) : ''}</div>
    </div>

    <div class="panel" style="margin-top:16px">
      <h2>What it costs</h2>
      <table class="ladder">
        <thead><tr><th>People</th><th style="text-align:right">Price each</th></tr></thead>
        <tbody>${ladderRows}</tbody>
      </table>
      <p class="note" style="margin-top:12px">You'll pay the final price, not today's. It can only go down.</p>
      <p class="dim" style="margin-top:8px">
        The host pays ${formatINR(s.fixedCost)} for the space whether 3 people come or ${s.maxSeats}.
        That cost is split between everyone who joins.
      </p>
    </div>

    ${s.description ? `<div class="panel" style="margin-top:16px"><h2>About</h2><p class="muted" style="margin:0">${esc(s.description)}</p></div>` : ''}

    ${
      attendees.length
        ? `<div class="panel" style="margin-top:16px">
             <h3>Who's in</h3>
             <div class="row">
               <div class="avatars">${attendees.slice(0, 8).map((u) => `<span class="avatar" title="${esc(u.fullName)}">${initials(u.fullName)}</span>`).join('')}</div>
               ${attendees.length > 8 ? `<span class="dim">+${attendees.length - 8} others</span>` : ''}
             </div>
           </div>`
        : ''
    }

    ${refId ? `<div class="callout" style="margin-top:16px">You came through a friend's invite. When you join, <strong>their price drops too</strong>.</div>` : ''}

    <div class="commitbar">${bar}</div>
    ${footer()}
  </div>`;
}

/* ================================================================== *
 * View: my commitments
 * ================================================================== */

let meTab = 'PENDING';

function viewMe(user) {
  resolveAll();
  const mine = store.listCommitments({ userId: user.id });

  const buckets = {
    PENDING: mine.filter((c) => c.status === COMMITMENT.PENDING),
    CONFIRMED: mine.filter((c) => c.status === COMMITMENT.CONFIRMED),
    PAST: mine.filter((c) => c.status === COMMITMENT.RELEASED || c.status === COMMITMENT.WITHDRAWN),
  };

  const rows = (buckets[meTab] || []).map((c) => {
    const s = store.getSession(c.sessionId);
    if (!s) return '';
    const n = liveCount(s.id);
    const referred = store.listCommitments({ sessionId: s.id }).filter((x) => x.referredBy === c.id && countsAsLive(x)).length;
    const saved = savingsFrom(
      { fixedCost: s.fixedCost, hostMargin: s.hostMargin, priceFloor: s.priceFloor, liveCount: n },
      referred
    );
    const price = c.status === COMMITMENT.CONFIRMED ? s.lockedPricePerHead ?? currentPrice(s) : currentPrice(s);

    return `
      <div class="card card-pad" style="${c.status === COMMITMENT.RELEASED || c.status === COMMITMENT.WITHDRAWN ? 'opacity:.62' : ''}">
        <div class="row-between">
          <div>
            <div class="row" style="gap:8px">
              <a href="#/s/${s.id}" style="font-weight:650;text-decoration:none">${esc(s.title)}</a>
              ${statusPill(s.status)}
            </div>
            <div class="dim">${esc(s.venue)} · ${fmtShort(s.startsAt)}</div>
            ${referred ? `<div class="price-drop">You brought ${referred} · saved ${formatINR(saved)} each</div>` : ''}
            ${c.status === COMMITMENT.RELEASED ? `<div class="dim">Didn't reach quorum — you weren't charged.</div>` : ''}
            ${c.status === COMMITMENT.WITHDRAWN ? `<div class="dim">You withdrew while it was still pending.</div>` : ''}
          </div>
          <div style="text-align:right">
            ${c.status === COMMITMENT.CONFIRMED ? `<div class="code">${esc(c.confirmationCode || '')}</div>` : ''}
            <div class="price-now" style="font-size:20px;margin-top:6px">${formatINR(price)}</div>
            <div class="price-label">${c.status === COMMITMENT.CONFIRMED ? 'locked' : 'right now'}</div>
          </div>
        </div>
      </div>`;
  }).join('');

  const tab = (k, label) =>
    `<button class="tab ${meTab === k ? 'active' : ''}" data-action="me-tab" data-tab="${k}">${label} (${buckets[k].length})</button>`;

  return `
  ${topbar(user, 'me')}
  <div class="wrap narrow">
    <h1 style="margin-top:30px">My commitments</h1>
    <p class="lede">Pending means you're in if it happens. Nothing is owed until a session confirms.</p>
    <div class="tabs">${tab('PENDING', 'Pending')}${tab('CONFIRMED', 'Confirmed')}${tab('PAST', 'Past')}</div>
    ${rows || `<div class="empty"><h2>Nothing here yet</h2><p>Find something to join.</p><a class="btn btn-primary" href="#/">Browse sessions</a></div>`}
    ${footer()}
  </div>`;
}

/* ================================================================== *
 * View: host list
 * ================================================================== */

function viewHostList(user) {
  resolveAll();
  const mine = store.listSessions().filter((s) => s.hostId === user.id);

  const rows = mine.map((s) => {
    const n = liveCount(s.id);
    return `
    <tr>
      <td><a href="#/host/${s.id}" style="font-weight:600">${esc(s.title)}</a><div class="dim">${fmtShort(s.startsAt)}</div></td>
      <td>${statusPill(s.status)}</td>
      <td>${n}/${s.minSeats}</td>
      <td>${formatINR(currentPrice(s))}</td>
      <td style="text-align:right;white-space:nowrap">
        <a class="btn btn-sm" href="#/host/${s.id}">Manage</a>
        <a class="btn btn-sm" href="#/host/${s.id}/edit">Edit</a>
        <button class="btn btn-sm btn-danger" data-action="delete-session" data-session="${s.id}">Delete</button>
      </td>
    </tr>`;
  }).join('');

  return `
  ${topbar(user, 'host')}
  <div class="wrap">
    <div class="row-between" style="margin:30px 0 6px">
      <h1 style="margin:0">My sessions</h1>
      <a class="btn btn-primary" href="#/host/new">New session</a>
    </div>
    <p class="lede">You enter what it costs you. Adda works out what each person pays.</p>
    ${
      mine.length
        ? `<div class="panel"><table class="data">
             <thead><tr><th>Session</th><th>Status</th><th>Quorum</th><th>Price now</th><th></th></tr></thead>
             <tbody>${rows}</tbody></table></div>`
        : `<div class="empty"><h2>You haven't hosted anything yet</h2><p>Set a minimum, set a deadline, and only run it if the room fills.</p><a class="btn btn-primary" href="#/host/new">Host a session</a></div>`
    }
    ${footer()}
  </div>`;
}

/* ================================================================== *
 * View: create / edit
 * ================================================================== */

function defaultsForNew() {
  const start = new Date(Date.now() + 7 * 864e5);
  start.setHours(17, 0, 0, 0);
  const deadline = new Date(start.getTime() - 2 * 864e5);
  return {
    title: '', description: '', category: 'craft', venue: '',
    startsAt: start.toISOString(), commitDeadline: deadline.toISOString(),
    minSeats: 6, maxSeats: 12, fixedCost: 4000, hostMargin: 2000, priceFloor: 300, emoji: '🫱',
  };
}

function previewHTML(v) {
  const ladder = priceLadder({
    fixedCost: v.fixedCost, hostMargin: v.hostMargin, priceFloor: v.priceFloor,
    liveCount: 0, minSeats: Number(v.minSeats) || 2, maxSeats: Number(v.maxSeats) || 2,
  });
  const rows = ladder
    .map((r) => `<tr class="${r.label === 'confirms' ? 'is-confirm' : ''}"><td>${r.people} <span class="dim">(${r.label})</span></td><td>${formatINR(r.price)}</td></tr>`)
    .join('');

  const atMin = pricePerHead(v.fixedCost, v.hostMargin, v.priceFloor, Number(v.minSeats) || 2);
  const atMax = pricePerHead(v.fixedCost, v.hostMargin, v.priceFloor, Number(v.maxSeats) || 2);
  const when = v.commitDeadline ? fmtShort(v.commitDeadline) : '…';

  return `
    <div class="panel">
      <div class="eyebrow">Price ladder</div>
      <table class="ladder" style="margin-top:10px">
        <thead><tr><th>People</th><th style="text-align:right">Price each</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="callout" style="margin-top:14px">
      This runs if at least <strong>${Number(v.minSeats) || 2}</strong> people commit by <strong>${when}</strong>.
      At ${Number(v.minSeats) || 2} people everyone pays <strong>${formatINR(atMin)}</strong>.
      At ${Number(v.maxSeats) || 2} it's <strong>${formatINR(atMax)}</strong>.
      You clear <strong>${formatINR(v.hostMargin)}</strong> either way.
    </div>
    <p class="note" style="margin-top:12px">If it doesn't reach ${Number(v.minSeats) || 2}, nothing happens and nobody is charged.</p>`;
}

function readForm(form) {
  const d = Object.fromEntries(new FormData(form).entries());
  return {
    title: d.title, description: d.description, category: d.category, venue: d.venue, emoji: d.emoji || '🫱',
    startsAt: d.startsAt ? new Date(d.startsAt).toISOString() : '',
    commitDeadline: d.commitDeadline ? new Date(d.commitDeadline).toISOString() : '',
    minSeats: Number(d.minSeats), maxSeats: Number(d.maxSeats),
    fixedCost: Number(d.fixedCost), hostMargin: Number(d.hostMargin), priceFloor: Number(d.priceFloor),
  };
}

function viewHostForm(user, editId) {
  let v = defaultsForNew();
  let existing = null;
  if (editId) {
    existing = store.getSession(editId);
    if (!existing) return notFound(user);
    if (existing.hostId !== user.id) return denied(user);
    v = existing;
  }
  const locked = existing && liveCount(existing.id) > 0;

  return `
  ${topbar(user, 'host')}
  <div class="wrap">
    <h1 style="margin-top:30px">${editId ? 'Edit session' : 'Host a session'}</h1>
    <p class="lede">Enter what it costs you, not what you want to charge. Adda splits it.</p>
    <div id="form-errors"></div>
    <div class="two-col">
      <form class="panel" id="session-form" data-action="${editId ? 'save-session' : 'create-session'}" data-session="${editId || ''}">
        <div class="field"><label>Title</label>
          <input name="title" value="${esc(v.title)}" placeholder="Wheel-throwing basics" ${locked ? 'readonly' : ''} required /></div>

        <div class="field"><label>What is it?</label>
          <textarea name="description" placeholder="What happens, what to bring, who it's for." ${locked ? 'readonly' : ''}>${esc(v.description)}</textarea></div>

        <div class="field-row">
          <div class="field"><label>Category</label>
            <select name="category" ${locked ? 'disabled' : ''}>
              ${CATEGORIES.slice(1).map(([k, label]) => `<option value="${k}" ${v.category === k ? 'selected' : ''}>${label}</option>`).join('')}
            </select></div>
          <div class="field"><label>Emoji</label>
            <input name="emoji" value="${esc(v.emoji || '🫱')}" maxlength="4" ${locked ? 'readonly' : ''} /></div>
        </div>

        <div class="field"><label>Where</label>
          <input name="venue" value="${esc(v.venue)}" placeholder="Clayworks Studio, Navrangpura" ${locked ? 'readonly' : ''} required /></div>

        <div class="field-row">
          <div class="field"><label>Starts</label>
            <input name="startsAt" type="datetime-local" value="${toLocalInput(v.startsAt)}" ${locked ? 'readonly' : ''} required /></div>
          <div class="field"><label>Commitments close</label>
            <input name="commitDeadline" type="datetime-local" value="${toLocalInput(v.commitDeadline)}" required />
            <div class="hint">Can only ever be pushed later.</div></div>
        </div>

        <div class="field-row">
          <div class="field"><label>Minimum people (quorum)</label>
            <input name="minSeats" type="number" min="2" value="${v.minSeats}" required />
            <div class="hint">Below this, it doesn't run.</div></div>
          <div class="field"><label>Maximum people</label>
            <input name="maxSeats" type="number" min="2" value="${v.maxSeats}" ${locked ? 'readonly' : ''} required /></div>
        </div>

        <div class="field-row">
          <div class="field"><label>Fixed cost (₹)</label>
            <input name="fixedCost" type="number" min="0" value="${v.fixedCost}" ${locked ? 'readonly' : ''} required />
            <div class="hint">Venue, materials — what you pay regardless of turnout.</div></div>
          <div class="field"><label>Your margin (₹)</label>
            <input name="hostMargin" type="number" min="0" value="${v.hostMargin}" ${locked ? 'readonly' : ''} required />
            <div class="hint">What you want to clear.</div></div>
        </div>

        <div class="field"><label>Price floor per person (₹)</label>
          <input name="priceFloor" type="number" min="0" value="${v.priceFloor}" ${locked ? 'readonly' : ''} required />
          <div class="hint">The price never drops below this, however many join.</div></div>

        ${locked ? `<p class="note">People have already committed, so only the quorum and the deadline can still change — and quorum only downward.</p>` : ''}

        <button class="btn btn-primary btn-lg btn-block" type="submit">${editId ? 'Save changes' : 'Publish session'}</button>
      </form>

      <div class="sticky-side">
        <div id="preview">${previewHTML(v)}</div>
      </div>
    </div>
    ${footer()}
  </div>`;
}

/* ================================================================== *
 * View: host manage
 * ================================================================== */

function viewHostManage(user, id) {
  const found = store.getSession(id);
  if (!found) return notFound(user);
  if (found.hostId !== user.id) return denied(user);
  const { session: s } = resolveAndPersist(found);

  const all = store.listCommitments({ sessionId: s.id });
  const n = liveCount(s.id);
  const need = seatsToQuorum(n, s.minSeats);

  const roster = all.map((c) => {
    const u = store.getUser(c.userId);
    const ref = c.referredBy ? store.getUser(store.getCommitment(c.referredBy)?.userId) : null;
    return `<tr>
      <td><div class="row"><span class="avatar">${initials(u?.fullName)}</span> ${esc(u?.fullName || 'Unknown')}</div></td>
      <td class="dim">${fmtShort(c.createdAt)}</td>
      <td><span class="pill ${c.status === 'CONFIRMED' ? 'pill-go' : c.status === 'RELEASED' || c.status === 'WITHDRAWN' ? 'pill-stop' : ''}">${c.status.toLowerCase()}</span></td>
      <td class="dim">${ref ? esc(ref.fullName) : '—'}</td>
    </tr>`;
  }).join('');

  const leaderboard = {};
  all.filter(countsAsLive).forEach((c) => {
    if (!c.referredBy) return;
    const owner = store.getCommitment(c.referredBy);
    if (!owner) return;
    leaderboard[owner.userId] = (leaderboard[owner.userId] || 0) + 1;
  });
  const board = Object.entries(leaderboard).sort((a, b) => b[1] - a[1]);

  return `
  ${topbar(user, 'host')}
  <div class="wrap narrow">
    <p style="margin:22px 0 0"><a class="navlink" href="#/host">← My sessions</a></p>
    <div class="row-between" style="margin:10px 0 4px">
      <h1 style="margin:0">${esc(s.title)}</h1>
      ${statusPill(s.status)}
    </div>
    <p class="dim">${esc(s.venue)} · ${fmtDate(s.startsAt)}</p>

    <div class="panel" style="margin-top:16px">
      <h2>${need > 0 ? `${need} more to go` : 'Quorum met'}</h2>
      ${meter(s)}
      <div class="row-between" style="margin-top:14px">
        <div>${priceBlock(s)}</div>
        <div style="text-align:right">
          <div class="price-label">You clear</div>
          <div class="price-now" style="font-size:20px">${formatINR(s.hostMargin)}</div>
        </div>
      </div>
      <div class="dim" style="margin-top:10px">${s.status === SESSION.OPEN ? countdown(s.commitDeadline) : ''}</div>
    </div>

    ${
      s.status === SESSION.OPEN
        ? `<div class="panel" style="margin-top:16px">
      <h3>Short of quorum? Pull a lever.</h3>
      <div class="field-row">
        <form data-action="lower-quorum" data-session="${s.id}">
          <div class="field"><label>Lower the quorum</label>
            <input name="minSeats" type="number" min="2" max="${s.minSeats}" value="${Math.max(2, s.minSeats - 1)}" /></div>
          <button class="btn btn-block btn-sm" type="submit">Lower quorum</button>
        </form>
        <form data-action="extend-deadline" data-session="${s.id}">
          <div class="field"><label>Push the deadline</label>
            <input name="commitDeadline" type="datetime-local" value="${toLocalInput(s.commitDeadline)}" /></div>
          <button class="btn btn-block btn-sm" type="submit">Extend deadline</button>
        </form>
      </div>
      <p class="note">Lowering quorum can confirm the session immediately.</p>
    </div>`
        : ''
    }

    <div class="panel" style="margin-top:16px">
      <h3>Who's committed</h3>
      ${all.length ? `<table class="data"><thead><tr><th>Person</th><th>Joined</th><th>Status</th><th>Brought by</th></tr></thead><tbody>${roster}</tbody></table>` : '<p class="dim">Nobody yet.</p>'}
    </div>

    ${
      board.length
        ? `<div class="panel" style="margin-top:16px"><h3>Who brought whom</h3>
           ${board.map(([uid, count]) => `<div class="row-between" style="padding:7px 0;border-top:1px solid var(--line)"><span>${esc(store.getUser(uid)?.fullName || '—')}</span><span class="pill pill-accent">${count} brought</span></div>`).join('')}</div>`
        : ''
    }

    <div class="panel" style="margin-top:16px">
      <h3>Admin</h3>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn btn-sm" data-action="resolve-now" data-session="${s.id}">Resolve now</button>
        ${s.status === SESSION.OPEN || s.status === SESSION.CONFIRMED ? `<button class="btn btn-sm btn-danger" data-action="cancel-session" data-session="${s.id}">Cancel session</button>` : ''}
      </div>
      <p class="note" style="margin-top:10px">
        "Resolve now" re-runs the state machine against the clock. Deadlines are normally resolved
        lazily whenever anyone reads a session — this button forces it on demand.
      </p>
    </div>
    ${footer()}
  </div>`;
}

/* ================================================================== *
 * Error views
 * ================================================================== */

function notFound(user) {
  return `${topbar(user, '')}<div class="wrap"><div class="empty"><h2>Not found</h2><p>That session doesn't exist any more.</p><a class="btn btn-primary" href="#/">Back to Discover</a></div></div>`;
}

function denied(user) {
  return `${topbar(user, '')}<div class="wrap"><div class="empty"><h2>Not yours to manage</h2><p>You can only manage sessions you're hosting.</p><a class="btn btn-primary" href="#/">Back to Discover</a></div></div>`;
}

/* ================================================================== *
 * Actions
 * ================================================================== */

/**
 * Commit to a session, then immediately re-resolve it.
 * If that push crossed quorum, the session confirms and every pending
 * commitment on it becomes CONFIRMED with a code, in one go.
 */
function doCommit(sessionId, refId) {
  const user = store.currentUser();
  const s = store.getSession(sessionId);
  if (!s || !user) return;

  const check = canCommit(s, liveCount(s.id), user.id);
  if (!check.ok) return toast(check.reason, 'stop');

  try {
    store.createCommitment({ sessionId, userId: user.id, referredBy: refId || null });
  } catch (e) {
    return toast(e.message, 'stop');
  }

  const after = resolveAndPersist(store.getSession(sessionId));
  if (after.changed && after.to === SESSION.CONFIRMED) {
    toast(`It's on! ${liveCount(sessionId)} people committed.`, 'go');
  } else {
    const need = seatsToQuorum(liveCount(sessionId), s.minSeats);
    toast(need > 0 ? `You're in. ${need} more to go.` : "You're in.");
  }
  render();
}

function doWithdraw(commitmentId) {
  const c = store.getCommitment(commitmentId);
  const check = canWithdraw(c);
  if (!check.ok) return toast(check.reason, 'stop');
  store.updateCommitment(commitmentId, { status: COMMITMENT.WITHDRAWN });
  toast('Withdrawn. You owe nothing.');
  render();
}

function copyInvite(sessionId, commitmentId) {
  const url = `${location.origin}${location.pathname}#/s/${sessionId}?ref=${commitmentId}`;
  const done = () => toast('Link copied — every person you bring lowers your own price.', 'go');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(() => window.prompt('Copy this link:', url));
  } else {
    window.prompt('Copy this link:', url);
  }
}

function showErrors(targetId, errors) {
  const box = document.getElementById(targetId);
  if (!box) return;
  box.innerHTML = errors.length
    ? `<div class="errors"><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`
    : '';
}

/* ================================================================== *
 * Router
 * ================================================================== */

function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query] = raw.split('?');
  const params = new URLSearchParams(query || '');
  return { parts: path.split('/').filter(Boolean), params };
}

function render() {
  const user = store.currentUser();
  const { parts, params } = parseRoute();

  if (!user) {
    app().className = '';
    app().innerHTML = viewAuth();
    return;
  }

  let html;
  if (parts.length === 0) html = viewDiscover(user);
  else if (parts[0] === 's' && parts[1]) html = viewSession(user, parts[1], params.get('ref'));
  else if (parts[0] === 'me') html = viewMe(user);
  else if (parts[0] === 'host' && !parts[1]) html = viewHostList(user);
  else if (parts[0] === 'host' && parts[1] === 'new') html = viewHostForm(user, null);
  else if (parts[0] === 'host' && parts[2] === 'edit') html = viewHostForm(user, parts[1]);
  else if (parts[0] === 'host' && parts[1]) html = viewHostManage(user, parts[1]);
  else html = notFound(user);

  app().className = '';
  app().innerHTML = html;
  window.scrollTo(0, 0);
}

/* ================================================================== *
 * Event wiring — one delegated click handler, one submit handler
 * ================================================================== */

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t || t.tagName === 'FORM') return;
  const a = t.dataset.action;

  if (a === 'logout') { store.logOut(); authMode = 'login'; go('#/'); render(); toast('Logged out.'); }
  else if (a === 'auth-mode') { authMode = t.dataset.mode; render(); }
  else if (a === 'fill-demo') {
    const f = document.querySelector('form[data-action]');
    if (f) { f.email.value = 'asha@adda.demo'; f.password.value = 'AddaDemo123!'; }
  }
  else if (a === 'filter') { activeCategory = t.dataset.cat; render(); }
  else if (a === 'me-tab') { meTab = t.dataset.tab; render(); }
  else if (a === 'commit') doCommit(t.dataset.session, t.dataset.ref);
  else if (a === 'withdraw') doWithdraw(t.dataset.commitment);
  else if (a === 'copy-invite') copyInvite(t.dataset.session, t.dataset.commitment);
  else if (a === 'resolve-now') {
    const r = resolveAndPersist(store.getSession(t.dataset.session));
    toast(r.changed ? `Resolved — now ${r.to}.` : 'Nothing to resolve yet.', r.changed ? 'go' : '');
    render();
  }
  else if (a === 'cancel-session') {
    if (!confirm('Cancel this session? Everyone who committed will be released.')) return;
    store.updateSession(t.dataset.session, { status: SESSION.CANCELLED });
    store.transitionCommitments(t.dataset.session, [COMMITMENT.PENDING, COMMITMENT.CONFIRMED], COMMITMENT.RELEASED);
    toast('Session cancelled. Everyone has been released.');
    render();
  }
  else if (a === 'delete-session') {
    const s = store.getSession(t.dataset.session);
    if (s.status === SESSION.CONFIRMED) return toast("It's confirmed — cancel it instead of deleting.", 'stop');
    if (!confirm('Delete this session permanently?')) return;
    store.deleteSession(t.dataset.session);
    toast('Deleted.');
    render();
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  const a = form.dataset.action;
  if (!a) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form).entries());

  try {
    if (a === 'login') {
      await store.logIn({ email: d.email, password: d.password });
      go('#/'); render(); toast('Welcome back.');
    }
    else if (a === 'signup') {
      await store.signUp({ fullName: d.fullName, email: d.email, password: d.password });
      go('#/'); render(); toast('Account created.');
    }
    else if (a === 'create-session') {
      const v = readForm(form);
      const errors = validateNewSession(v);
      if (errors.length) return showErrors('form-errors', errors);
      const created = store.createSession({ ...v, hostId: store.currentUser().id });
      toast('Published.', 'go');
      go('#/host/' + created.id);
    }
    else if (a === 'save-session') {
      const id = form.dataset.session;
      const existing = store.getSession(id);
      const v = readForm(form);
      if (liveCount(id) > 0) {
        const errors = validateHostEdit(existing, { minSeats: v.minSeats, commitDeadline: v.commitDeadline });
        if (errors.length) return showErrors('form-errors', errors);
        store.updateSession(id, { minSeats: v.minSeats, commitDeadline: v.commitDeadline });
      } else {
        const errors = validateNewSession(v);
        if (errors.length) return showErrors('form-errors', errors);
        store.updateSession(id, v);
      }
      const after = resolveAndPersist(store.getSession(id));
      toast(after.changed && after.to === SESSION.CONFIRMED ? "That did it — it's on!" : 'Saved.', after.changed ? 'go' : '');
      go('#/host/' + id);
      render();
    }
    else if (a === 'lower-quorum' || a === 'extend-deadline') {
      const id = form.dataset.session;
      const existing = store.getSession(id);
      const patch = a === 'lower-quorum'
        ? { minSeats: Number(d.minSeats) }
        : { commitDeadline: new Date(d.commitDeadline).toISOString() };
      const errors = validateHostEdit(existing, patch);
      if (errors.length) { errors.forEach((x) => toast(x, 'stop')); return; }
      store.updateSession(id, patch);
      const after = resolveAndPersist(store.getSession(id));
      toast(after.changed && after.to === SESSION.CONFIRMED ? "That did it — it's on!" : 'Updated.', after.changed ? 'go' : '');
      render();
    }
  } catch (err) {
    if (a === 'login' || a === 'signup') showErrors('auth-error', [err.message]);
    else toast(err.message, 'stop');
  }
});

// Live price-ladder preview on the host form.
document.addEventListener('input', (e) => {
  const form = e.target.closest('#session-form');
  if (!form) return;
  const box = document.getElementById('preview');
  if (box) box.innerHTML = previewHTML(readForm(form));
});

window.addEventListener('hashchange', render);

/* ================================================================== *
 * Boot
 * ================================================================== */

(async function boot() {
  if (!store.isSeeded()) await seed();
  resolveAll();
  render();
  // Refresh countdowns once a minute.
  setInterval(() => {
    if (store.currentUser() && (parseRoute().parts.length === 0)) render();
  }, 60000);
})();

// Exposed for debugging and for the reset link in the README.
window.adda = { store, reset: () => { store.resetEverything(); location.reload(); } };
