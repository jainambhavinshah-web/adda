/**
 * seed.js — demo fixture.
 *
 * Builds a believable set of sessions across every state, with times relative
 * to whenever the app is first opened, so deadlines and countdowns always make
 * sense no matter when someone loads it.
 */

import { hashPassword, uid, loadFixture } from './store.js';

const hours = (n) => new Date(Date.now() + n * 3600 * 1000).toISOString();
const days = (n) => hours(n * 24);

export async function seed() {
  const pw = await hashPassword('AddaDemo123!');

  const mkUser = (fullName, email) => ({
    id: uid(),
    fullName,
    email,
    passwordHash: pw,
    city: 'Ahmedabad',
    createdAt: new Date().toISOString(),
  });

  // The three accounts published in the README.
  const host = mkUser('Meera Joshi', 'host@adda.demo');
  const asha = mkUser('Asha Patel', 'asha@adda.demo');
  const rohan = mkUser('Rohan Desai', 'rohan@adda.demo');

  // Extra people so sessions look populated.
  const filler = [
    mkUser('Kabir Shah', 'kabir@adda.demo'),
    mkUser('Nisha Rao', 'nisha@adda.demo'),
    mkUser('Devansh Mehta', 'devansh@adda.demo'),
    mkUser('Tara Iyer', 'tara@adda.demo'),
    mkUser('Imran Qureshi', 'imran@adda.demo'),
    mkUser('Priya Nair', 'priya@adda.demo'),
    mkUser('Vikram Bhatt', 'vikram@adda.demo'),
  ];

  const users = [host, asha, rohan, ...filler];

  const mkSession = (o) => ({
    id: uid(),
    status: 'OPEN',
    lockedPricePerHead: null,
    priceFloor: 200,
    createdAt: new Date().toISOString(),
    ...o,
  });

  // ── 1 ── THE DEMO SESSION. Sits at 3 of 5. Asha makes 4, Rohan makes 5 and
  // it flips to CONFIRMED on camera. 6000 total → 2000 / 1500 / 1200.
  const pottery = mkSession({
    hostId: host.id,
    title: 'Wheel-throwing basics',
    description:
      'Three hours on the wheel with clay, tools and firing included. No experience needed — you will make something wobbly and it will be yours. The studio takes eight at a time.',
    category: 'craft',
    venue: 'Clayworks Studio, Navrangpura',
    startsAt: days(6),
    commitDeadline: days(4),
    minSeats: 5,
    maxSeats: 12,
    fixedCost: 4000,
    hostMargin: 2000,
    priceFloor: 400,
    emoji: '🏺',
  });

  // ── 2 ── Already confirmed, price already down.
  const photowalk = mkSession({
    hostId: filler[0].id,
    title: 'Sunday 6 AM photowalk, Sabarmati',
    description:
      'Riverfront at first light. Bring any camera, phones absolutely fine. We walk about four kilometres and stop for chai halfway.',
    category: 'outdoors',
    venue: 'Sabarmati Riverfront, Gate 3',
    startsAt: days(3),
    commitDeadline: days(2),
    minSeats: 6,
    maxSeats: 15,
    fixedCost: 1800,
    hostMargin: 1200,
    priceFloor: 100,
    status: 'CONFIRMED',
    lockedPricePerHead: 500,
    emoji: '📷',
  });

  // ── 3 ── Open, short of quorum, plenty of time.
  const turf = mkSession({
    hostId: filler[1].id,
    title: '5-a-side turf, Bodakdev',
    description: 'Two hours of floodlit turf, Thursday night. Bibs provided, bring your own shoes.',
    category: 'sports',
    venue: 'Kickstart Turf, Bodakdev',
    startsAt: days(4),
    commitDeadline: days(3),
    minSeats: 8,
    maxSeats: 10,
    fixedCost: 3200,
    hostMargin: 800,
    priceFloor: 150,
    emoji: '⚽',
  });

  // ── 4 ── THE FAILURE DEMO. Deadline already passed, only one commitment.
  // Stays OPEN in the fixture on purpose — lazy resolution flips it to FAILED
  // the first time anyone looks at it, which is exactly the behaviour to show.
  const watercolour = mkSession({
    hostId: filler[2].id,
    title: 'Watercolour Sunday',
    description: 'Loose, fast watercolour for people who think they cannot draw. Paper and paints included.',
    category: 'craft',
    venue: 'The Attic, Paldi',
    startsAt: hours(20),
    commitDeadline: hours(-2), // two hours ago
    minSeats: 5,
    maxSeats: 10,
    fixedCost: 2500,
    hostMargin: 1000,
    priceFloor: 200,
    emoji: '🎨',
  });

  // ── 5 ── Nearly full.
  const sourdough = mkSession({
    hostId: filler[3].id,
    title: 'Sourdough starter workshop',
    description: 'Build a starter from scratch and take it home in a jar, plus a loaf to bake tomorrow.',
    category: 'learning',
    venue: 'Bake House, Thaltej',
    startsAt: days(5),
    commitDeadline: days(3),
    minSeats: 6,
    maxSeats: 8,
    fixedCost: 3500,
    hostMargin: 1500,
    priceFloor: 300,
    status: 'CONFIRMED',
    lockedPricePerHead: 715,
    emoji: '🍞',
  });

  // ── 6 ── Cancelled by the host.
  const openmic = mkSession({
    hostId: filler[4].id,
    title: 'Open mic night, Law Garden',
    description: 'Seven minutes each, any format. Venue pulled out at the last minute.',
    category: 'social',
    venue: 'Rooftop, Law Garden',
    startsAt: days(2),
    commitDeadline: days(1),
    minSeats: 10,
    maxSeats: 25,
    fixedCost: 5000,
    hostMargin: 2000,
    priceFloor: 200,
    status: 'CANCELLED',
    emoji: '🎤',
  });

  const sessions = [pottery, photowalk, turf, watercolour, sourdough, openmic];

  const mkCommitment = (session, user, status, extra = {}) => ({
    id: uid(),
    sessionId: session.id,
    userId: user.id,
    status,
    referredBy: null,
    confirmationCode: status === 'CONFIRMED' ? 'ADDA-' + Math.random().toString(36).slice(2, 6).toUpperCase() : null,
    createdAt: new Date().toISOString(),
    ...extra,
  });

  const commitments = [
    // Pottery: 3 of 5. Two more and it's on.
    mkCommitment(pottery, filler[0], 'PENDING'),
    mkCommitment(pottery, filler[1], 'PENDING'),
    mkCommitment(pottery, filler[5], 'PENDING'),

    // Photowalk: confirmed with six.
    ...[filler[1], filler[2], filler[3], filler[4], filler[5], filler[6]].map((u) =>
      mkCommitment(photowalk, u, 'CONFIRMED')
    ),

    // Turf: 5 of 8.
    ...[filler[0], filler[2], filler[3], filler[5], filler[6]].map((u) => mkCommitment(turf, u, 'PENDING')),

    // Watercolour: one lonely commitment, deadline gone.
    mkCommitment(watercolour, filler[6], 'PENDING'),

    // Sourdough: 7 of 8, confirmed.
    ...[filler[0], filler[1], filler[2], filler[4], filler[5], filler[6], asha].map((u) =>
      mkCommitment(sourdough, u, 'CONFIRMED')
    ),

    // Open mic: released when the host cancelled.
    ...[filler[0], filler[1], filler[3]].map((u) => mkCommitment(openmic, u, 'RELEASED')),
  ];

  loadFixture({ users, sessions, commitments });
}
