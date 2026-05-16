import request from 'supertest';
import { app } from '../app';
import { pool } from '../db/client';

const AUTH = '/api/v1/auth';
const BASE = '/api/v1/profile';

const ts = Date.now();
const userA = { email: `pa_${ts}@fazn.dev`, username: `pa_${ts}`, password: 'SecurePass123!', firstName: 'Alice', lastName: 'A' };
const userB = { email: `pb_${ts}@fazn.dev`, username: `pb_${ts}`, password: 'SecurePass123!', firstName: 'Bob', lastName: 'B' };

let tokenA: string;
let tokenB: string;
let userBId: string;

beforeAll(async () => {
  const a = await request(app).post(`${AUTH}/register`).send(userA);
  tokenA = a.body.accessToken;
  const b = await request(app).post(`${AUTH}/register`).send(userB);
  tokenB = b.body.accessToken;
  userBId = b.body.user.id;
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[userA.email, userB.email]]);
  await pool.end();
});

// ─── GET /profile (me) ────────────────────────────────────────────────────────

describe('GET /profile', () => {
  it('returns 200 with profile shape', async () => {
    const res = await request(app).get(`${BASE}/`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.stats).toBeDefined();
    expect(res.body.gameRankings).toEqual([]);
    expect(res.body.recentResults).toEqual([]);
    expect(res.body.highestWin).toBeNull();
    expect(res.body.topRival).toBeNull();
    expect(res.body.stats.winRate).toBe(0);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get(`${BASE}/`);
    expect(res.status).toBe(401);
  });
});

// ─── PATCH /profile (me) ──────────────────────────────────────────────────────

describe('PATCH /profile', () => {
  it('updates bio', async () => {
    const res = await request(app).patch(`${BASE}/`).set('Authorization', `Bearer ${tokenA}`).send({ bio: 'Pro gamer' });
    expect(res.status).toBe(200);
    expect(res.body.user.bio).toBe('Pro gamer');
  });

  it('updates username', async () => {
    const newName = `alice_${ts}`;
    const res = await request(app).patch(`${BASE}/`).set('Authorization', `Bearer ${tokenA}`).send({ username: newName });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(newName);
  });

  it('partial update does not clear bio', async () => {
    const res = await request(app).patch(`${BASE}/`).set('Authorization', `Bearer ${tokenA}`).send({ firstName: 'Alicia' });
    expect(res.status).toBe(200);
    expect(res.body.user.first_name).toBe('Alicia');
    expect(res.body.user.bio).toBe('Pro gamer');
  });

  it('rejects bio over 160 chars', async () => {
    const res = await request(app).patch(`${BASE}/`).set('Authorization', `Bearer ${tokenA}`).send({ bio: 'x'.repeat(161) });
    expect(res.status).toBe(422);
  });

  it('rejects invalid username', async () => {
    const res = await request(app).patch(`${BASE}/`).set('Authorization', `Bearer ${tokenA}`).send({ username: 'bad name!' });
    expect(res.status).toBe(422);
  });

  it('rejects non-URL avatarUrl', async () => {
    const res = await request(app).patch(`${BASE}/`).set('Authorization', `Bearer ${tokenA}`).send({ avatarUrl: 'not-a-url' });
    expect(res.status).toBe(422);
  });

  it('rejects taken username with 409', async () => {
    const res = await request(app).patch(`${BASE}/`).set('Authorization', `Bearer ${tokenA}`).send({ username: userB.username });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).patch(`${BASE}/`).send({ bio: 'hi' });
    expect(res.status).toBe(401);
  });
});

// ─── Privacy ──────────────────────────────────────────────────────────────────

describe('Privacy settings', () => {
  it('returns defaults for new user', async () => {
    const res = await request(app).get(`${BASE}/privacy`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      showOnlineStatus: true,
      showStats: true,
      showRecentResults: true,
      allowChallengesFrom: 'everyone',
    });
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get(`${BASE}/privacy`);
    expect(res.status).toBe(401);
  });

  it('updates allowChallengesFrom and persists', async () => {
    const res = await request(app).patch(`${BASE}/privacy`).set('Authorization', `Bearer ${tokenA}`).send({ allowChallengesFrom: 'friends' });
    expect(res.status).toBe(200);
    expect(res.body.data.allowChallengesFrom).toBe('friends');

    const get = await request(app).get(`${BASE}/privacy`).set('Authorization', `Bearer ${tokenA}`);
    expect(get.body.data.allowChallengesFrom).toBe('friends');
  });

  it('rejects invalid allowChallengesFrom', async () => {
    const res = await request(app).patch(`${BASE}/privacy`).set('Authorization', `Bearer ${tokenA}`).send({ allowChallengesFrom: 'aliens' });
    expect(res.status).toBe(422);
  });
});

// ─── Streaming ────────────────────────────────────────────────────────────────

describe('Streaming channels', () => {
  it('returns empty array for new user', async () => {
    const res = await request(app).get(`${BASE}/streaming`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get(`${BASE}/streaming`);
    expect(res.status).toBe(401);
  });

  it('connects a YouTube channel', async () => {
    const res = await request(app).post(`${BASE}/streaming/youtube`).set('Authorization', `Bearer ${tokenA}`).send({
      channelId: 'UC123',
      channelName: 'Alice Plays',
      channelUrl: 'https://youtube.com/@aliceplays',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.provider).toBe('youtube');
    expect(res.body.data.channelName).toBe('Alice Plays');
  });

  it('rejects non-YouTube channelUrl', async () => {
    const res = await request(app).post(`${BASE}/streaming/youtube`).set('Authorization', `Bearer ${tokenA}`).send({
      channelId: 'UC123',
      channelName: 'Alice Plays',
      channelUrl: 'https://example.com/foo',
    });
    expect(res.status).toBe(422);
  });

  it('rejects missing channelId', async () => {
    const res = await request(app).post(`${BASE}/streaming/youtube`).set('Authorization', `Bearer ${tokenA}`).send({
      channelName: 'Alice Plays',
      channelUrl: 'https://youtube.com/@aliceplays',
    });
    expect(res.status).toBe(422);
  });

  it('re-connecting updates existing row (idempotent)', async () => {
    const res = await request(app).post(`${BASE}/streaming/youtube`).set('Authorization', `Bearer ${tokenA}`).send({
      channelId: 'UC456',
      channelName: 'Alice New',
      channelUrl: 'https://www.youtube.com/@alicenew',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.channelName).toBe('Alice New');

    const list = await request(app).get(`${BASE}/streaming`).set('Authorization', `Bearer ${tokenA}`);
    expect(list.body.data.filter((c: any) => c.provider === 'youtube')).toHaveLength(1);
  });

  it('disconnects channel', async () => {
    const res = await request(app).delete(`${BASE}/streaming/youtube`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Channel disconnected');
  });

  it('returns 404 disconnecting unconnected channel', async () => {
    const res = await request(app).delete(`${BASE}/streaming/youtube`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHANNEL_NOT_FOUND');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).delete(`${BASE}/streaming/youtube`);
    expect(res.status).toBe(401);
  });
});

// ─── Public profile ───────────────────────────────────────────────────────────

describe('GET /profile/:userId', () => {
  it('returns public profile of another user', async () => {
    const res = await request(app).get(`${BASE}/${userBId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(userB.username);
    expect(res.body.user.totalWins).toBe(0);
  });

  it('returns 404 for non-existent user', async () => {
    const res = await request(app)
      .get(`${BASE}/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('respects showStats=false (stats zeroed)', async () => {
    await request(app).patch(`${BASE}/privacy`).set('Authorization', `Bearer ${tokenB}`).send({ showStats: false });
    await pool.query('UPDATE users SET total_wins = 5, total_matches = 10 WHERE id = $1', [userBId]);

    const res = await request(app).get(`${BASE}/${userBId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.user.totalWins).toBe(0);
    expect(res.body.user.totalMatches).toBe(0);
    expect(res.body.user.winRate).toBe(0);
  });
});
