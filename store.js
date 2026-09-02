/**
 * store.js — the persistence layer.
 *
 * KEY ARCHITECTURAL DECISION — repository seam.
 * Every read and write in this app goes through this one module. Nothing else
 * in the codebase knows where data lives. Today that is the browser's
 * localStorage; swapping it for Supabase or any REST backend means rewriting
 * this file and nothing else, because the rest of the app only ever calls
 * store.listSessions(), store.createCommitment() and so on.
 *
 * That is why the functions are async even though localStorage is synchronous —
 * the call sites are already written the way they would be against a network.
 */

const DB_KEY = 'adda.db.v1';
const SESSION_KEY = 'adda.session.v1';

function blank() {
  return { users: [], sessions: [], commitments: [] };
}

function read() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return blank();
    const parsed = JSON.parse(raw);
    return { users: [], sessions: [], commitments: [], ...parsed };
  } catch (e) {
    console.warn('[adda] could not read local database, starting fresh', e);
    return blank();
  }
}

function write(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function uid() {
  return 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/* ------------------------------------------------------------------ *
 * Passwords
 * ------------------------------------------------------------------ */

/**
 * Hash with SHA-256 via the Web Crypto API so we never store a plaintext
 * password, even locally.
 *
 * Being straight about this: real password security needs a salted, slow hash
 * (bcrypt/argon2) on a server the user cannot inspect. That is a backend
 * concern, and this app's v1 has no backend. This is the honest local
 * equivalent, and it is called out in the README as a known limitation.
 */
export async function hashPassword(plain) {
  try {
    const bytes = new TextEncoder().encode('adda::' + plain);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (e) {
    // Web Crypto needs a secure context. Fall back so the app still runs if
    // someone opens the files directly instead of over https.
    let h = 0;
    const s = 'adda::' + plain;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return 'fallback_' + (h >>> 0).toString(16);
  }
}

/* ------------------------------------------------------------------ *
 * Users / auth
 * ------------------------------------------------------------------ */

export async function signUp({ fullName, email, password }) {
  const db = read();
  const clean = String(email || '').trim().toLowerCase();
  if (!fullName || fullName.trim().length < 2) throw new Error('Tell us your name.');
  if (!clean.includes('@')) throw new Error('That does not look like an email address.');
  if (!password || password.length < 6) throw new Error('Password needs at least 6 characters.');
  if (db.users.some((u) => u.email === clean)) throw new Error('An account with that email already exists.');

  const user = {
    id: uid(),
    fullName: fullName.trim(),
    email: clean,
    passwordHash: await hashPassword(password),
    city: 'Ahmedabad',
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  write(db);
  localStorage.setItem(SESSION_KEY, user.id);
  return publicUser(user);
}

export async function logIn({ email, password }) {
  const db = read();
  const clean = String(email || '').trim().toLowerCase();
  const user = db.users.find((u) => u.email === clean);
  if (!user) throw new Error('No account with that email.');
  const hash = await hashPassword(password);
  if (hash !== user.passwordHash) throw new Error('Wrong password.');
  localStorage.setItem(SESSION_KEY, user.id);
  return publicUser(user);
}

export function logOut() {
  localStorage.removeItem(SESSION_KEY);
}

export function currentUser() {
  const id = localStorage.getItem(SESSION_KEY);
  if (!id) return null;
  const user = read().users.find((u) => u.id === id);
  return user ? publicUser(user) : null;
}

export function getUser(id) {
  const u = read().users.find((x) => x.id === id);
  return u ? publicUser(u) : null;
}

/** Never let a password hash escape this module. */
function publicUser(u) {
  return { id: u.id, fullName: u.fullName, email: u.email, city: u.city };
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

export function listSessions() {
  return read().sessions.slice().sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

export function getSession(id) {
  return read().sessions.find((s) => s.id === id) || null;
}

export function createSession(data) {
  const db = read();
  const session = {
    id: uid(),
    status: 'OPEN',
    lockedPricePerHead: null,
    createdAt: new Date().toISOString(),
    ...data,
  };
  db.sessions.push(session);
  write(db);
  return session;
}

export function updateSession(id, patch) {
  const db = read();
  const i = db.sessions.findIndex((s) => s.id === id);
  if (i === -1) throw new Error('Session not found.');
  db.sessions[i] = { ...db.sessions[i], ...patch };
  write(db);
  return db.sessions[i];
}

export function deleteSession(id) {
  const db = read();
  db.sessions = db.sessions.filter((s) => s.id !== id);
  db.commitments = db.commitments.filter((c) => c.sessionId !== id); // cascade
  write(db);
}

/* ------------------------------------------------------------------ *
 * Commitments
 * ------------------------------------------------------------------ */

export function listCommitments({ sessionId, userId } = {}) {
  return read().commitments.filter(
    (c) => (!sessionId || c.sessionId === sessionId) && (!userId || c.userId === userId)
  );
}

export function getCommitment(id) {
  return read().commitments.find((c) => c.id === id) || null;
}

export function createCommitment({ sessionId, userId, referredBy }) {
  const db = read();
  // Mirrors the UNIQUE (session_id, user_id) constraint a real database would carry.
  const existing = db.commitments.find(
    (c) => c.sessionId === sessionId && c.userId === userId && (c.status === 'PENDING' || c.status === 'CONFIRMED')
  );
  if (existing) throw new Error("You've already committed to this session.");

  const commitment = {
    id: uid(),
    sessionId,
    userId,
    status: 'PENDING',
    referredBy: referredBy || null,
    confirmationCode: null,
    createdAt: new Date().toISOString(),
  };
  db.commitments.push(commitment);
  write(db);
  return commitment;
}

export function updateCommitment(id, patch) {
  const db = read();
  const i = db.commitments.findIndex((c) => c.id === id);
  if (i === -1) throw new Error('Commitment not found.');
  db.commitments[i] = { ...db.commitments[i], ...patch };
  write(db);
  return db.commitments[i];
}

/** Bulk transition — used when a session confirms or fails and every
 *  commitment on it has to move together, in one write. */
export function transitionCommitments(sessionId, from, to, decorate) {
  const db = read();
  db.commitments = db.commitments.map((c) => {
    if (c.sessionId !== sessionId || !from.includes(c.status)) return c;
    return { ...c, status: to, ...(decorate ? decorate(c) : {}) };
  });
  write(db);
}

/* ------------------------------------------------------------------ *
 * Seeding / reset
 * ------------------------------------------------------------------ */

export function isSeeded() {
  return read().users.length > 0;
}

export function loadFixture(fixture) {
  write(fixture);
}

export function resetEverything() {
  localStorage.removeItem(DB_KEY);
  localStorage.removeItem(SESSION_KEY);
}
