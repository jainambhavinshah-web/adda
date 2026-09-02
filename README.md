# 🫱 Adda

**Group experiences that only happen when enough people show up — and get cheaper for everyone the more people join.**

Live app: **https://jainambhavinshah-web.github.io/adda/**

---

## The problem

A pottery instructor in Ahmedabad wants to run a Saturday class. The studio costs her ₹4,000 whether three people show up or twelve. So she's stuck: price it high enough to survive a low turnout and nobody signs up; price it low and she needs ten people or she loses money — so she cancels at the last minute.

The people signing up have the mirror problem. They pay upfront for something that might get cancelled, or they pay a premium to subsidise empty chairs.

Today this gets solved on WhatsApp. *"Guys, doing a photowalk Sunday, need at least eight, who's in?"* Then three days of chasing, a Google Form, UPI screenshots, and a decent chance it dies anyway.

## The insight

The atomic unit here isn't a **ticket**. It's a **conditional commitment** — *"I'm in **if** it happens."*

Every booking product forces a binary: confirmed or not. None of them model that actual intent. Adda makes it a first-class object, and three mechanics fall out of it.

### 1. Quorum gate
Every session has a minimum. Joining doesn't book you, it commits you. The moment the minimum is reached the session flips to **confirmed** and every pending commitment confirms together with a code. If the deadline passes without quorum, the session **fails** and everyone is released — nobody charged, nobody ghosted, everyone told at the same instant.

Withdrawal is free while pending and blocked once confirmed. That asymmetry is what makes a commitment mean something.

### 2. Split pricing
The host never enters a per-head price. That's the inversion. They enter what the session actually costs them — the studio, the turf, the materials — plus the margin they want to clear:

```
price_per_head = max(price_floor, ceil((fixed_cost + host_margin) / live_count))
```

So the price **falls as the group grows**, live on screen. At 4 people a ₹4,000 studio plus ₹2,000 margin is ₹1,500 each; at 12 it's ₹500.

**Fairness rule:** everyone pays the *final* price, not the price they joined at. The number you see when you commit can only go down, never up.

### 3. Skin-in-the-game invites
Because your own price drops with every extra person, each attendee has a direct financial reason to recruit. Every commitment generates a personal invite link, and your commitment card shows *"You brought 3 · saved ₹340 each."*

**The attendees are the distribution channel, and the pricing model is what pays them.** No referral budget, no coupon codes — the incentive is structural.

## Why this isn't an existing product

| | Meetup | Groupon | Eventbrite | **Adda** |
|---|---|---|---|---|
| Booking state | RSVP, non-binding | Purchase | Purchase | **Conditional commitment** |
| Price | Free | Fixed merchant discount | Fixed | **Live function of group size** |
| Who carries turnout risk | Host | Merchant | Host | **Nobody — it's gated away** |
| Growth loop | Social | Paid | Paid | **Structural** |

Group-buying has existed for years, but always as a merchant *discount tier*. Adda applies the threshold to the **supply decision itself** — the session does not exist below quorum — and makes price a continuous function of headcount rather than a step discount.

---

## Screenshots

| Discover | Session detail | Hosting |
|---|---|---|
| ![Discover](docs/shot-discover.png) | ![Detail](docs/shot-detail.png) | ![Host](docs/shot-hostform.png) |

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| UI | Vanilla JS (ES modules), HTML, CSS | No build step. What's in the repo is exactly what runs in the browser. |
| Business logic | Two pure ES modules | `pricing.js` and `sessionState.js` — no DOM, no storage, no framework |
| Persistence | `localStorage` behind a repository module | `store.js` is the only file that knows where data lives |
| Auth | Email + password, SHA-256 via Web Crypto | Sign up, log in, log out, persisted across refresh |
| Routing | Hash router | Works on static hosting with no server rewrites |
| Hosting | GitHub Pages | Free, static, deploys from `main` |
| Built with | Claude (Anthropic) for the product spec, pricing model, state machine and implementation | |

---

## Running it locally

There is nothing to install and nothing to build. The app does need to be **served over HTTP** rather than opened as a file, because it uses ES modules and the Web Crypto API.

```bash
git clone https://github.com/jainambhavinshah-web/adda.git
cd adda
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works — `npx serve`, VS Code Live Server, whatever you have.

The app seeds itself with demo data the first time it loads. To wipe everything and start over, open the browser console and run:

```js
adda.reset()
```

## Deploying

Push to `main`, then in the repository: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)` → Save**. The site is live at `https://jainambhavinshah-web.github.io/adda/` within a minute or two.

---

## Test credentials

Password for every account below: **`AddaDemo123!`**

| Email | Role in the demo |
|---|---|
| `host@adda.demo` | Meera Joshi — hosts *Wheel-throwing basics* |
| `asha@adda.demo` | Asha Patel — attendee |
| `rohan@adda.demo` | Rohan Desai — attendee |

Signing up a fresh account works too.

**To see the core flow in 60 seconds:** log in as Asha, open *Wheel-throwing basics* (3 of 5 committed), and commit — the price drops from ₹2,000 to ₹1,500. Copy the invite link, log in as Rohan, open that link and commit. Quorum hits, the session flips to confirmed, both get codes and the price locks at ₹1,200.

**To see graceful failure:** open *Watercolour Sunday*. Its deadline has passed with only one commitment, so it resolves to failed on read and the commitment is released.

---

## Project structure

```
adda/
├── index.html            # shell
├── styles.css            # design system
├── js/
│   ├── pricing.js        # split-pricing engine — pure, no dependencies
│   ├── sessionState.js   # quorum state machine + invariants — pure
│   ├── store.js          # repository: auth, sessions, commitments
│   ├── seed.js           # demo fixture
│   └── app.js            # router, views, actions
└── docs/                 # screenshots
```

The separation is the point: `pricing.js` and `sessionState.js` contain every rule in the product and import nothing. `app.js` decides what to show; it never decides what a price is or whether a session confirms.

---

## Business logic

### Session states

```
OPEN ──── live_count >= min_seats ──────────────> CONFIRMED   (immediately, not at the deadline)
OPEN ──── now > deadline & below quorum ───────> FAILED
OPEN | CONFIRMED ──── host cancels ────────────> CANCELLED
CONFIRMED ──── now > start time ───────────────> COMPLETED
```

### Commitment states

```
join                             ──> PENDING
PENDING  + session confirms      ──> CONFIRMED  (+ ADDA-XXXX code)
PENDING  + session fails         ──> RELEASED
PENDING  + user withdraws        ──> WITHDRAWN
CONFIRMED + host cancels         ──> RELEASED
CONFIRMED + user withdraws       ──> blocked
```

### Invariants

1. **A confirmed session never returns to open**, even if someone withdraws and the count falls back below quorum. Once it's on, it's on. This is a product decision, not a technical one — un-confirming a session people have planned their Saturday around would be a cruel thing to do to a user.
2. `locked_price_per_head` is written exactly once, at confirmation, and never recomputed.
3. A host can never commit to their own session.
4. One live commitment per person per session.
5. Quorum may only be lowered and deadlines only extended, and only while a session is open.
6. Withdrawing sets a status; it never deletes the row. The audit trail stays intact.

### Key decision — lazy resolution

A session whose deadline passes has to become *failed*, but nobody is watching it. The obvious answer is a scheduled background job. Adda resolves **lazily** instead: every read of a session runs `resolveSession()` against the current clock and writes back any change.

- **Cost:** a session's status only updates when someone looks at it.
- **Benefit:** no scheduler infrastructure, and it's self-healing — whenever anyone does look, the answer is correct.

At real volume the same transition would move to a Postgres cron job. At this scale, resolving on read is the right trade. The host console's **Resolve now** button forces it on demand.

### Key decision — the repository seam

Every read and write goes through `store.js`. Nothing else in the codebase knows where data lives. Its functions are `async` even though `localStorage` is synchronous, so the call sites are already written the way they'd be against a network. Moving to Supabase or any REST backend means rewriting that one file.

---

## Known limitations

Deliberately out of scope for v1, and each has an obvious v2:

- **No real payments.** The app records the commitment and the locked price; settlement happens at the venue. A Razorpay pre-authorisation hold at commit time is the natural next step, and the schema already carries `lockedPricePerHead` to support it.
- **Browser-local persistence.** Data lives in each visitor's `localStorage`, so it doesn't sync across devices or between users. The repository seam above exists precisely so this can be swapped for a real backend without touching the rest of the app.
- **Password hashing is client-side SHA-256.** Real password security needs a salted, slow hash on a server the user can't inspect. That's a backend concern and v1 has no backend; this is the honest local equivalent.
- **No notifications.** Quorum changes are visible on the page but nothing emails or messages you.
- **No reviews, chat, maps or image uploads.**

---

Built for the MICA PGP-MC 2025 app assignment.
