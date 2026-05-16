# FAZN Backend — Full API Implementation Plan

## What already exists

The backend is **Express + TypeScript + PostgreSQL** with JWT auth already working end-to-end:

- User registration, login, logout
- Email verification (OTP via Resend)
- Password reset (OTP)
- Google + Apple OAuth
- JWT access tokens (short-lived) + refresh tokens (long-lived, stored hashed in DB)
- `users`, `games`, `wallets`, `refresh_tokens`, `otp_codes` tables in place

Everything else is mock data in the mobile app. This document defines exactly what to build next, in order, so the app becomes fully functional.

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Express |
| Database | PostgreSQL (pg) |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Email | Resend |
| Payments | Paystack (Nigerian market) |
| File storage | TBD (profile avatars — S3 or Cloudflare R2) |
| Real-time | Socket.io (for live challenge state, notifications) |
| AI scoring | Separate `ai-service` (already in monorepo) |
| Media | Separate `media-server` (already in monorepo) |

---

## Folder structure to follow

```
src/
  controllers/       # Route handlers — thin, delegate to services
  services/          # Business logic — all DB queries live here
  routes/            # Express routers
  middleware/        # auth, adminGuard, validate, rateLimiter
  db/
    migrations/      # Numbered SQL files
    client.ts        # pg Pool singleton
    migrate.ts       # Migration runner
  types/             # TypeScript interfaces matching mobile app types
  utils/             # Shared helpers (formatNaira, pagination, etc.)
```

---

## Build order — phase by phase

Build these in order. Each phase produces endpoints the mobile app can immediately wire up to.

---

## Phase 1 — Profile & User Data

**Why first:** Every other feature (challenges, wallet, friends) references a user profile. Profile is foundational.

### New DB migration: `005_profile_schema.sql`

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bio          TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url   TEXT,
  ADD COLUMN IF NOT EXISTS tags         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS global_rank  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_wins   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_matches INT NOT NULL DEFAULT 0;

-- Streaming channel connections
CREATE TABLE IF NOT EXISTS streaming_channels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('youtube', 'twitch')),
  channel_id   TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  access_token TEXT,       -- encrypted, for pulling stream links
  refresh_token TEXT,      -- encrypted
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

-- Privacy settings
CREATE TABLE IF NOT EXISTS privacy_settings (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  show_online_status   BOOLEAN NOT NULL DEFAULT TRUE,
  show_stats           BOOLEAN NOT NULL DEFAULT TRUE,
  show_recent_results  BOOLEAN NOT NULL DEFAULT TRUE,
  allow_challenges_from TEXT NOT NULL DEFAULT 'everyone'
    CHECK (allow_challenges_from IN ('everyone', 'friends', 'nobody')),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Endpoints

```
GET    /api/v1/profile/me              → ProfileData (own full profile)
PATCH  /api/v1/profile/me             → Updated User (edit first_name, last_name, username, bio, tags)
GET    /api/v1/profile/:userId        → PublicProfileData (another user's public view)
POST   /api/v1/profile/avatar         → { avatarUrl: string } (multipart upload)

GET    /api/v1/profile/me/privacy     → PrivacySettings
PATCH  /api/v1/profile/me/privacy     → PrivacySettings

GET    /api/v1/profile/me/streaming   → StreamingChannel[]
POST   /api/v1/profile/me/streaming/youtube   → StreamingChannel (OAuth connect)
DELETE /api/v1/profile/me/streaming/youtube   → { message }
POST   /api/v1/profile/me/streaming/twitch    → StreamingChannel
DELETE /api/v1/profile/me/streaming/twitch    → { message }
```

### Response shapes (match mobile types exactly)

```typescript
// GET /profile/me
interface ProfileResponse {
  stats: {
    globalRank: number;
    totalWins: number;
    totalMatches: number;
    winRate: number;          // calculated: totalWins / totalMatches * 100
  };
  gameRankings: GameRanking[];    // from challenge_results table (Phase 3)
  recentResults: RecentResult[];  // last 5 completed challenges
  highestWin: HighestWin | null;
  topRival: TopRival | null;
}

// GET /profile/:userId (public)
interface PublicProfileResponse {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  bio?: string;
  tags: string[];
  globalRank: number;
  totalWins: number;
  totalMatches: number;
  winRate: number;
}
```

---

## Phase 2 — Wallet & Payments

**Why second:** Challenges require wallet balance. Build wallet before challenges so the debit/credit logic is ready.

### New DB migration: `006_wallet_schema.sql`

```sql
-- Extend wallets table
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS pending_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_won       NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_spent     NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Transaction ledger
CREATE TABLE IF NOT EXISTS transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN (
                     'top_up', 'withdrawal', 'challenge_entry',
                     'challenge_win', 'gift_sent', 'gift_received',
                     'platform_bonus', 'refund'
                   )),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
  amount           NUMERIC(14,2) NOT NULL,     -- always positive
  direction        TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  description      TEXT NOT NULL,
  reference        TEXT NOT NULL UNIQUE,        -- Paystack ref or internal ref
  paystack_ref     TEXT,
  challenge_id     UUID,                        -- FK added in Phase 3
  opponent_id      UUID REFERENCES users(id),
  bank_name        TEXT,
  account_last4    TEXT,
  payment_method   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions (reference);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status);
```

### Endpoints

```
GET  /api/v1/wallet                    → WalletData
GET  /api/v1/wallet/transactions       → Transaction[] (paginated: ?page=1&limit=20)

POST /api/v1/wallet/topup/initialize   → { authorizationUrl, reference }
                                         Body: { amount: number, paymentMethod: string }
                                         Calls Paystack Initialize Transaction API
                                         Returns redirect URL for user to complete payment

POST /api/v1/wallet/topup/verify       → { message, newBalance }
                                         Body: { reference: string }
                                         Verifies with Paystack, credits wallet

POST /api/v1/wallet/topup/webhook      → 200 OK (Paystack webhook — server-to-server)
                                         Validates Paystack signature header
                                         Credits wallet on charge.success event

POST /api/v1/wallet/withdraw           → { message, transactionId }
                                         Body: { amount, method, bankDetails: { accountName, accountNumber, bankName } }
                                         Validates min ₦1,000, deducts ₦100 fee
                                         Creates pending transaction
                                         Initiates Paystack Transfer API (or queues for manual)
```

### Business rules
- Platform fee: **5%** on all challenge pots (stake × 2 × 0.05)
- Minimum withdrawal: **₦1,000**
- Withdrawal flat fee: **₦100** deducted from amount
- Top-up bonuses: ₦500 on ₦10,000 top-up, ₦2,000 on ₦25,000 top-up — credit as `platform_bonus` transaction
- Wallet balance can never go below 0 — check before any debit
- All wallet mutations must be **atomic** (use DB transactions)

### Paystack integration notes
- Use Paystack's **Initialize Transaction** for card/bank top-ups
- Use Paystack's **Transfer** API for withdrawals (requires Paystack business account with transfer enabled)
- Always verify webhooks with `x-paystack-signature` HMAC-SHA512 header
- Store `PAYSTACK_SECRET_KEY` in env, never expose to client

---

## Phase 3 — Challenges (Arena)

**Why third:** Core product feature. Depends on users (Phase 1) and wallets (Phase 2).

### New DB migration: `007_challenges_schema.sql`

```sql
CREATE TABLE IF NOT EXISTS challenges (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  game_id          UUID NOT NULL REFERENCES games(id),
  platform         TEXT NOT NULL,
  format           TEXT NOT NULL DEFAULT '1v1' CHECK (format IN ('1v1', '2v2')),
  stake            NUMERIC(14,2) NOT NULL,
  potential_win    NUMERIC(14,2) NOT NULL,
  platform_fee     NUMERIC(14,2) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                     'open', 'pending_acceptance', 'accepted', 'live',
                     'awaiting_result', 'disputed', 'completed',
                     'cancelled', 'rejected', 'expired', 'void', 'refunded'
                   )),
  creator_id       UUID NOT NULL REFERENCES users(id),
  opponent_id      UUID REFERENCES users(id),
  invite_only      BOOLEAN NOT NULL DEFAULT FALSE,
  opponent_type    TEXT NOT NULL DEFAULT 'public'
                     CHECK (opponent_type IN ('public', 'private', 'direct')),
  outcome          TEXT CHECK (outcome IN ('creator_win', 'opponent_win', 'draw')),
  rules            TEXT NOT NULL DEFAULT '',
  acceptance_due   TIMESTAMPTZ NOT NULL,
  game_start_time  TIMESTAMPTZ NOT NULL,
  game_end_time    TIMESTAMPTZ,
  creator_started  BOOLEAN NOT NULL DEFAULT FALSE,  -- creator clicked Start
  opponent_agreed  BOOLEAN NOT NULL DEFAULT FALSE,  -- opponent clicked Agree to Start
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Game-specific match settings (eFootball, Dream League etc.)
CREATE TABLE IF NOT EXISTS challenge_settings (
  challenge_id   UUID PRIMARY KEY REFERENCES challenges(id) ON DELETE CASCADE,
  match_time     INT,           -- minutes (eFootball: 10)
  penalties      BOOLEAN,       -- eFootball: always true
  extra_time     BOOLEAN,       -- eFootball: always false
  custom_rules   JSONB          -- future extensibility
);

-- Escrow: locked funds for a challenge
CREATE TABLE IF NOT EXISTS challenge_escrow (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id   UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id),
  amount         NUMERIC(14,2) NOT NULL,
  status         TEXT NOT NULL DEFAULT 'locked'
                   CHECK (status IN ('locked', 'released', 'refunded')),
  locked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at    TIMESTAMPTZ,
  UNIQUE (challenge_id, user_id)
);

-- Per-game rankings/tiers (updated after each completed challenge)
CREATE TABLE IF NOT EXISTS game_rankings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id    UUID NOT NULL REFERENCES games(id),
  platform   TEXT NOT NULL,
  tier       TEXT NOT NULL DEFAULT 'Bronze'
               CHECK (tier IN ('Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond')),
  rank_points INT NOT NULL DEFAULT 0,
  rank_number INT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, game_id, platform)
);

-- Stream links attached to a live challenge (from YouTube/Twitch)
CREATE TABLE IF NOT EXISTS challenge_streams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id  UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id),
  stream_url    TEXT NOT NULL,
  provider      TEXT NOT NULL CHECK (provider IN ('youtube', 'twitch', 'fazn')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  UNIQUE (challenge_id, user_id)
);

-- Add FK from transactions to challenges
ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_challenge
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_challenges_creator ON challenges (creator_id);
CREATE INDEX IF NOT EXISTS idx_challenges_opponent ON challenges (opponent_id);
CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges (status);
CREATE INDEX IF NOT EXISTS idx_challenges_game ON challenges (game_id);
CREATE INDEX IF NOT EXISTS idx_escrow_challenge ON challenge_escrow (challenge_id);
CREATE INDEX IF NOT EXISTS idx_rankings_user ON game_rankings (user_id);
```

### Endpoints

```
GET  /api/v1/arena                      → ArenaData
     Returns marketplace (open), myChallenges, invited
     Each challenge has userRole computed server-side based on auth user

GET  /api/v1/challenges/:id             → ArenaChallenge (with userRole)

POST /api/v1/challenges                 → ArenaChallenge
     Body: { gameId, platform, format, stake, opponentType, directOpponentId?,
             acceptanceDue, gameStartTime, rules, matchSettings }
     - Validates wallet balance >= stake
     - Locks stake in escrow (challenge_escrow)
     - Debits wallet (challenge_entry transaction)
     - Creates challenge with status 'open' or 'pending_acceptance'

POST /api/v1/challenges/:id/accept      → ArenaChallenge
     - Validates challenger != creator
     - Validates status is 'open' or 'pending_acceptance'
     - Validates wallet balance >= stake
     - Locks opponent stake in escrow
     - Sets status → 'accepted', opponent_id → auth user

POST /api/v1/challenges/:id/reject      → { message }
     - Only callable by invited opponent
     - Sets status → 'rejected'
     - Refunds creator escrow

POST /api/v1/challenges/:id/cancel      → { message }
     - Only callable by creator (when status is open/pending_acceptance)
     - Sets status → 'cancelled'
     - Refunds creator escrow

POST /api/v1/challenges/:id/start       → ArenaChallenge
     - Only callable by creator (status must be 'accepted')
     - Sets creator_started = true
     - If opponent_agreed already true → status → 'live' (pull stream URLs)
     - Else stays 'accepted', notifies opponent

POST /api/v1/challenges/:id/agree-start → ArenaChallenge
     - Only callable by opponent (status must be 'accepted')
     - Sets opponent_agreed = true
     - If creator_started already true → status → 'live'

POST /api/v1/challenges/:id/stream      → { message }
     Body: { streamUrl, provider }
     - Attaches stream URL for this user to the challenge
     - Used when match goes live — mobile recorder or YouTube/Twitch URL
```

### Challenge lifecycle & escrow flow

```
CREATE         → creator wallet debited → stake locked in escrow
ACCEPT         → opponent wallet debited → stake locked in escrow
CANCEL/REJECT  → escrow released → creator refunded
LIVE           → no money movement, AI starts monitoring streams
AWAITING_RESULT → AI analysing
COMPLETED (win)  → winner credited (stake×2×0.95), fee credited to FAZN wallet
COMPLETED (draw) → both refunded full stake
VOID           → both refunded full stake
EXPIRED        → creator refunded (no opponent accepted in time)
```

### AI scoring integration

The `ai-service` in the monorepo handles scoring. When a challenge moves to `awaiting_result`:
1. Backend sends stream URLs to `ai-service` via internal HTTP call
2. `ai-service` processes recording, returns `{ outcome: 'creator_win' | 'opponent_win' | 'draw', confidence: number }`
3. Backend updates challenge status to `completed`, sets outcome, settles escrow
4. If confidence < threshold → status → `disputed` for manual review

```
POST /internal/ai/score   (internal only, not exposed to mobile)
     Body: { challengeId, creatorStreamUrl, opponentStreamUrl }
     → Handled by ai-service
```

---

## Phase 4 — Friends & Social

**Why fourth:** Friends are referenced in direct challenges (Phase 3) but the friend system itself can be built in parallel or right after.

### New DB migration: `008_friends_schema.sql`

```sql
CREATE TABLE IF NOT EXISTS friendships (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships (requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships (addressee_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships (status);

-- Favourites (subset of friends)
CREATE TABLE IF NOT EXISTS favourites (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, friend_id)
);

-- Online presence (updated by socket connections — see Phase 6)
CREATE TABLE IF NOT EXISTS user_presence (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'offline'
                 CHECK (status IN ('online', 'in_game', 'offline')),
  current_game TEXT,
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Endpoints

```
GET  /api/v1/friends                       → FriendsState
     Returns friends (accepted), suggestions (friends-of-friends), requestCount

GET  /api/v1/friends/requests              → FriendRequest[]
     Splits into incoming (addressee = me, status = pending)
     and outgoing (requester = me, status = pending)

POST /api/v1/friends/request               → { message }
     Body: { userId }
     Creates friendship row with status 'pending'

POST /api/v1/friends/requests/:id/accept   → { message }
     Sets status → 'accepted'

POST /api/v1/friends/requests/:id/reject   → { message }
     Deletes the friendship row

DELETE /api/v1/friends/:userId             → { message }
     Deletes accepted friendship row

POST /api/v1/friends/:userId/block         → { message }
     Sets status → 'blocked'

POST /api/v1/friends/:userId/favourite     → { isFavourite: boolean }
     Toggles favourite entry

GET  /api/v1/users/search?q=              → FriendUser[]
     Searches username, firstName, lastName
     Excludes blocked users
     Min 3 chars enforced
     Includes friendshipStatus relative to auth user
```

### Computing FriendUser.friendshipStatus server-side

```
SELECT u.*, f.status, f.requester_id
FROM users u
LEFT JOIN friendships f ON (
  (f.requester_id = $authUserId AND f.addressee_id = u.id)
  OR
  (f.addressee_id = $authUserId AND f.requester_id = u.id)
)
WHERE u.id = $targetUserId
```

Then derive:
- `null` row → `'none'`
- `status = 'accepted'` → `'friends'`
- `status = 'pending'` AND `requester_id = authUserId` → `'pending_sent'`
- `status = 'pending'` AND `requester_id != authUserId` → `'pending_received'`
- `status = 'blocked'` → `'blocked'`

---

## Phase 5 — Home Feed & Search

**Why fifth:** Depends on challenges (Phase 3) and users (Phase 1) being real data.

### Endpoints

```
GET /api/v1/home         → HomeData
    Returns:
    - walletBalance (from wallet)
    - notificationCount (unread)
    - featuredChallenges (isFeatured=true, status=open, ordered by prize desc)
    - hotChallenges (isHot=true OR high participant count, status=open)
    - streams (challenges with status=live that have stream URLs attached)

GET /api/v1/search?q=    → GroupedSearchResults
    Searches across:
    - players: username, firstName, lastName ILIKE
    - challenges: title ILIKE + status=open
    - games: name ILIKE (from games table)
    Min 3 chars. Returns top 5 per category.

GET /api/v1/notifications          → Notification[]
POST /api/v1/notifications/read    → { message }
     Body: { notificationIds: string[] }
```

### New DB migration: `009_home_schema.sql`

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('challenge', 'friend', 'result', 'system')),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  challenge_id UUID REFERENCES challenges(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read);

-- Mark featured/hot on challenges table
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_hot      BOOLEAN NOT NULL DEFAULT FALSE;
```

### When to create notifications

| Event | Recipient | Type |
|---|---|---|
| Someone accepts your challenge | Creator | `challenge` |
| Direct challenge sent to you | Opponent | `challenge` |
| Challenge goes live | Both | `challenge` |
| AI result ready | Both | `result` |
| Dispute resolved | Both | `result` |
| Friend request received | Addressee | `friend` |
| Friend request accepted | Requester | `friend` |

---

## Phase 6 — Real-time (Socket.io)

**Why sixth:** Polish layer. Challenges work without it but feel slow. Friends' online status needs it.

### Events to implement

```
// Server → Client
challenge:updated     { challengeId, status, ... }   // any status change
challenge:started     { challengeId }                 // creator hit Start
challenge:result      { challengeId, outcome }        // AI scored
notification:new      { notification }                // push new notification
friend:online         { userId }
friend:offline        { userId }
friend:in_game        { userId, game }

// Client → Server
presence:update       { status: 'online' | 'in_game' | 'offline', game? }
challenge:join_room   { challengeId }                 // subscribe to a challenge's events
challenge:leave_room  { challengeId }
```

### Auth for sockets

Pass the JWT access token as a handshake auth header. Middleware validates it on connection. Reject unauthenticated connections.

---

## API conventions to follow (already established in codebase)

### Request / response format

All responses follow the pattern the mobile `api.ts` already expects:

**Success:**
```json
{ "user": { ... } }           // single resource
{ "data": [...] }             // list
{ "message": "Done" }         // action confirmation
```

**Error:**
```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "Wrong password." } }
```

Error codes the mobile app already handles:
- `INVALID_CREDENTIALS`
- `USER_EXISTS`
- `INVALID_OTP`
- `TOKEN_EXPIRED`
- `INVALID_TOKEN`
- `NETWORK`
- `UNKNOWN`

Add these new ones as needed:
- `INSUFFICIENT_FUNDS`
- `CHALLENGE_NOT_FOUND`
- `ALREADY_ACCEPTED`
- `NOT_YOUR_CHALLENGE`
- `WALLET_LOCKED`

### Auth middleware

Already exists at `src/middleware/auth.ts`. Use `requireAuth` on every protected route. It attaches `req.user` (the decoded JWT payload with `userId`).

### Validation middleware

Use `express-validator` (already installed). Put validation rules inline in route files. Check `src/routes/auth.routes.ts` for the pattern.

### Pagination

For any list endpoint returning potentially many items:
```
GET /api/v1/wallet/transactions?page=1&limit=20
Response: { data: Transaction[], total: number, page: number, limit: number }
```

### Rate limiting

Already configured globally. Add stricter limits on:
- Wallet top-up/withdraw: 10/minute
- Challenge create: 5/minute
- OTP send: 3/minute (already in place)

---

## Environment variables to add

```env
# Already present
JWT_SECRET=
DATABASE_URL=
RESEND_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=

# Add these
PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=
PAYSTACK_WEBHOOK_SECRET=
AI_SERVICE_URL=http://localhost:4001         # internal ai-service URL
MEDIA_SERVER_URL=http://localhost:4002       # internal media-server URL
FRONTEND_URL=https://app.fazn.gg            # for OAuth redirects
```

---

## Wiring the mobile app

For each phase completed, replace the mock fetch function in the corresponding hook.

**Example — useWallet.ts:**
```typescript
// Replace this:
async function fetchWallet(): Promise<WalletData> {
  await new Promise(r => setTimeout(r, 800));
  return MOCK_WALLET;
}

// With this:
import { apiFetch } from '../lib/api';
async function fetchWallet(): Promise<WalletData> {
  const res = await apiFetch<{ data: WalletData }>('/wallet');
  return res.data;
}
```

The hooks already handle loading/error states, optimistic updates, and retry — no hook restructuring needed.

---

## Priority summary

| Phase | What | Unlocks |
|---|---|---|
| 1 | Profile & streaming channels | Edit profile, privacy settings |
| 2 | Wallet & Paystack | Real money, top-up, withdraw |
| 3 | Challenges (Arena) | Full challenge lifecycle, AI scoring |
| 4 | Friends & social | Direct challenges, friend list |
| 5 | Home feed & search | Real featured/hot/live on home |
| 6 | Socket.io real-time | Live status, instant notifications |

Start with Phase 1. Each phase is independent enough to deploy and test on the mobile app before moving to the next.
