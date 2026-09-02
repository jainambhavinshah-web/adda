/**
 * pricing.js — the split-pricing engine.
 *
 * Pure functions. No DOM, no storage, no framework. Everything here takes plain
 * numbers and returns plain numbers, which is what makes the pricing model
 * testable and impossible to get subtly wrong in one screen but right in another.
 *
 * THE MODEL
 * ---------
 * A host does not set a price per head. They enter what the session actually
 * costs them: a fixed cost (the studio, the turf, the equipment — paid whether
 * three people show up or twelve) plus the margin they want to clear.
 *
 * Price per head is that total divided by however many people have committed.
 * So the price falls as the group grows.
 */

/**
 * Price per head at a given headcount.
 * Clamped at the host's floor so the price can never fall to something absurd.
 */
export function pricePerHead(fixedCost, hostMargin, priceFloor, n) {
  const total = Number(fixedCost || 0) + Number(hostMargin || 0);
  const heads = Math.max(Number(n) || 0, 1); // never divide by zero
  return Math.max(Number(priceFloor || 0), Math.ceil(total / heads));
}

/**
 * The three-rung ladder shown on cards, the detail page and the create form.
 * Rungs that land on the same headcount are collapsed, so a session sitting
 * exactly at quorum doesn't show "8 (now)" and "8 (confirms)" as two rows.
 */
export function priceLadder({ fixedCost, hostMargin, priceFloor, liveCount, minSeats, maxSeats }) {
  const rungs = [
    { people: Math.max(liveCount, 1), label: 'now' },
    { people: minSeats, label: 'confirms' },
    { people: maxSeats, label: 'full' },
  ];

  const seen = new Set();
  return rungs
    .filter((r) => Number.isFinite(r.people) && r.people > 0)
    .filter((r) => {
      if (seen.has(r.people)) return false;
      seen.add(r.people);
      return true;
    })
    .sort((a, b) => a.people - b.people)
    .map((r) => ({
      ...r,
      price: pricePerHead(fixedCost, hostMargin, priceFloor, r.people),
    }));
}

/**
 * What a user's referrals have saved them.
 *
 * This is the number that makes the growth loop visible: every person you bring
 * lowers your own price, so we show you exactly how much lower.
 */
export function savingsFrom({ fixedCost, hostMargin, priceFloor, liveCount }, referredCount) {
  if (!referredCount) return 0;
  const without = pricePerHead(fixedCost, hostMargin, priceFloor, liveCount - referredCount);
  const with_ = pricePerHead(fixedCost, hostMargin, priceFloor, liveCount);
  return Math.max(0, without - with_);
}

/** What the host clears, regardless of how many people turn up. */
export function hostTakeHome(hostMargin) {
  return Number(hostMargin || 0);
}

export function formatINR(n) {
  return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
}
