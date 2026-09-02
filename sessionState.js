/**
 * sessionState.js — the quorum state machine.
 *
 * Pure functions, same rules as pricing.js: plain values in, plain values out.
 *
 * SESSION STATES
 *   OPEN       taking commitments, quorum not yet reached
 *   CONFIRMED  quorum reached — it's happening, price is locked
 *   FAILED     deadline passed without quorum — everyone released, nobody charged
 *   CANCELLED  host pulled it
 *   COMPLETED  it happened
 *
 * COMMITMENT STATES
 *   PENDING    "I'm in if it happens"
 *   CONFIRMED  it's happening and you have a code
 *   RELEASED   it didn't happen, you owe nothing
 *   WITHDRAWN  you pulled out while it was still pending
 */

import { pricePerHead } from './pricing.js';

export const SESSION = {
  OPEN: 'OPEN',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
};

export const COMMITMENT = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  RELEASED: 'RELEASED',
  WITHDRAWN: 'WITHDRAWN',
};

/** Commitments that count toward quorum. Withdrawn and released ones don't. */
export function countsAsLive(commitment) {
  return commitment.status === COMMITMENT.PENDING || commitment.status === COMMITMENT.CONFIRMED;
}

export function seatsToQuorum(liveCount, minSeats) {
  return Math.max(0, Number(minSeats) - Number(liveCount));
}

export function isFull(liveCount, maxSeats) {
  return Number(liveCount) >= Number(maxSeats);
}

/**
 * Can this user commit to this session?
 * Returns a specific, human reason on every rejection — the UI shows these
 * verbatim, so a blocked user always knows exactly why.
 */
export function canCommit(session, liveCount, userId, now = new Date()) {
  if (!userId) return { ok: false, reason: 'Log in to commit.' };
  if (session.hostId === userId) return { ok: false, reason: "You're hosting this one." };
  if (session.status === SESSION.CANCELLED) return { ok: false, reason: 'This session was cancelled.' };
  if (session.status === SESSION.FAILED) return { ok: false, reason: "This session didn't reach quorum." };
  if (session.status === SESSION.COMPLETED) return { ok: false, reason: 'This session has already happened.' };
  if (new Date(session.commitDeadline) < now) return { ok: false, reason: 'Commitments closed for this session.' };
  if (isFull(liveCount, session.maxSeats)) return { ok: false, reason: 'This session is full.' };
  return { ok: true };
}

/**
 * Can this user withdraw?
 *
 * Free while pending, blocked once confirmed. That asymmetry is the whole point
 * of the product — it's what makes a commitment mean something. If people could
 * walk away after a session confirmed, the host would be back to guessing.
 */
export function canWithdraw(commitment) {
  if (!commitment) return { ok: false, reason: "You haven't committed to this session." };
  if (commitment.status === COMMITMENT.PENDING) return { ok: true };
  if (commitment.status === COMMITMENT.CONFIRMED) {
    return { ok: false, reason: "This session is confirmed — your spot is locked in." };
  }
  return { ok: false, reason: 'Nothing to withdraw.' };
}

/**
 * Resolve a session against the current clock.
 *
 * KEY ARCHITECTURAL DECISION — lazy resolution.
 * A session whose deadline passes has to become FAILED, but nobody is watching
 * it. The obvious answer is a scheduled background job. We resolve lazily
 * instead: every read of a session runs this first and writes back any change.
 *
 * Cost: a session's status only updates when someone looks at it.
 * Benefit: no scheduler infrastructure, and it is self-healing — whenever
 * anyone does look, the answer is correct.
 */
export function resolveSession(session, liveCount, now = new Date()) {
  const noChange = { nextStatus: session.status, lockedPrice: session.lockedPricePerHead ?? null, commitmentTransition: null };

  if (session.status === SESSION.OPEN) {
    // Quorum reached — confirm immediately, don't wait for the deadline.
    // The moment it's on, everyone should know it's on.
    if (liveCount >= session.minSeats) {
      return {
        nextStatus: SESSION.CONFIRMED,
        lockedPrice: pricePerHead(session.fixedCost, session.hostMargin, session.priceFloor, liveCount),
        commitmentTransition: 'CONFIRM_ALL',
      };
    }
    // Deadline passed without quorum — fail gracefully.
    if (new Date(session.commitDeadline) < now) {
      return { nextStatus: SESSION.FAILED, lockedPrice: null, commitmentTransition: 'RELEASE_ALL' };
    }
    return noChange;
  }

  if (session.status === SESSION.CONFIRMED && new Date(session.startsAt) < now) {
    return { nextStatus: SESSION.COMPLETED, lockedPrice: session.lockedPricePerHead ?? null, commitmentTransition: null };
  }

  return noChange;
}

/**
 * INVARIANT 1: a CONFIRMED session never returns to OPEN, even if someone
 * withdraws and the count drops back below quorum. Once it's on, it's on.
 *
 * This is a product decision, not a technical one. Un-confirming a session that
 * people have already planned their Saturday around would be a genuinely cruel
 * thing to do to a user, so the state machine simply doesn't allow it.
 */
export function isTerminalUpward(status) {
  return status === SESSION.CONFIRMED || status === SESSION.COMPLETED;
}

/**
 * INVARIANT 5: quorum may only ever be lowered, and deadlines only extended,
 * and only while the session is still OPEN.
 */
export function validateHostEdit(session, { minSeats, commitDeadline }) {
  const errors = [];
  if (session.status !== SESSION.OPEN) {
    errors.push('You can only change quorum and deadline while a session is still open.');
    return errors;
  }
  if (minSeats != null && Number(minSeats) > Number(session.minSeats)) {
    errors.push('Quorum can only be lowered, never raised — people committed against the old number.');
  }
  if (minSeats != null && Number(minSeats) < 2) {
    errors.push('Quorum must be at least 2. A session of one is not a session.');
  }
  if (commitDeadline && new Date(commitDeadline) < new Date(session.commitDeadline)) {
    errors.push('The deadline can only be pushed later, never pulled in.');
  }
  if (commitDeadline && new Date(commitDeadline) >= new Date(session.startsAt)) {
    errors.push('The deadline has to be before the session starts.');
  }
  return errors;
}

/** Validate a brand new session. */
export function validateNewSession(s) {
  const errors = [];
  if (!s.title || s.title.trim().length < 3) errors.push('Give it a title.');
  if (!s.venue || !s.venue.trim()) errors.push('Where is it happening?');
  if (!s.startsAt) errors.push('When does it start?');
  if (!s.commitDeadline) errors.push('When do commitments close?');
  if (s.startsAt && s.commitDeadline && new Date(s.commitDeadline) >= new Date(s.startsAt)) {
    errors.push('Commitments have to close before the session starts.');
  }
  if (s.startsAt && new Date(s.startsAt) < new Date()) errors.push('The start time is in the past.');
  if (Number(s.minSeats) < 2) errors.push('Quorum must be at least 2.');
  if (Number(s.maxSeats) < Number(s.minSeats)) errors.push('Maximum seats must be at least the quorum.');
  if (Number(s.fixedCost) < 0 || Number(s.hostMargin) < 0) errors.push('Costs cannot be negative.');
  return errors;
}

/** ADDA-XXXX confirmation codes. */
export function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — people read these aloud
  let out = '';
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return 'ADDA-' + out;
}
