import request from 'supertest';
import { app } from '../app';
import { pool } from '../db/client';

const BASE = '/api/v1/auth';
const testEmail = `test_${Date.now()}@fazn.dev`;
const testUsername = `user_${Date.now()}`;
const testPassword = 'SecurePass123!';

let accessToken: string;
let refreshToken: string;

afterAll(async () => {
  // Clean up test user
  await pool.query('DELETE FROM users WHERE email = $1', [testEmail]);
  await pool.end();
});

// ─── Register ──────────────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  it('creates a new user and returns tokens', async () => {
    const res = await request(app).post(`${BASE}/register`).send({
      email: testEmail,
      username: testUsername,
      password: testPassword,
      firstName: 'Test',
      lastName: 'User',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(testEmail);
    expect(res.body.user.role).toBe('player');
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('rejects duplicate email', async () => {
    const res = await request(app).post(`${BASE}/register`).send({
      email: testEmail,
      username: `other_${Date.now()}`,
      password: testPassword,
      firstName: 'Test',
      lastName: 'User',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USER_EXISTS');
  });

  it('rejects weak password (under 8 chars)', async () => {
    const res = await request(app).post(`${BASE}/register`).send({
      email: `new_${Date.now()}@fazn.dev`,
      username: `new_${Date.now()}`,
      password: 'short',
      firstName: 'Test',
      lastName: 'User',
    });
    expect(res.status).toBe(422);
  });

  it('rejects invalid email format', async () => {
    const res = await request(app).post(`${BASE}/register`).send({
      email: 'not-an-email',
      username: `new_${Date.now()}`,
      password: testPassword,
      firstName: 'Test',
      lastName: 'User',
    });
    expect(res.status).toBe(422);
  });

  it('strips HTML from firstName', async () => {
    const res = await request(app).post(`${BASE}/register`).send({
      email: `html_${Date.now()}@fazn.dev`,
      username: `html_${Date.now()}`,
      password: testPassword,
      firstName: '<script>alert(1)</script>',
      lastName: 'User',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.first_name).not.toContain('<script>');
    // Clean up
    await pool.query('DELETE FROM users WHERE id = $1', [res.body.user.id]);
  });
});

// ─── Login ────────────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  it('returns tokens for valid credentials', async () => {
    const res = await request(app).post(`${BASE}/login`).send({
      email: testEmail,
      password: testPassword,
    });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    refreshToken = res.body.refreshToken;
  });

  it('rejects wrong password', async () => {
    const res = await request(app).post(`${BASE}/login`).send({
      email: testEmail,
      password: 'WrongPassword!',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects non-existent email', async () => {
    const res = await request(app).post(`${BASE}/login`).send({
      email: 'ghost@fazn.dev',
      password: testPassword,
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

// ─── Me ───────────────────────────────────────────────────────────────────────

describe('GET /auth/me', () => {
  it('returns current user with valid token', async () => {
    const res = await request(app)
      .get(`${BASE}/me`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(testEmail);
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get(`${BASE}/me`);
    expect(res.status).toBe(401);
  });

  it('returns 401 with malformed token', async () => {
    const res = await request(app)
      .get(`${BASE}/me`)
      .set('Authorization', 'Bearer notavalidtoken');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

// ─── Refresh ──────────────────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  it('issues new token pair from valid refresh token', async () => {
    const res = await request(app).post(`${BASE}/refresh`).send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    // Update tokens for logout test
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('rejects invalid refresh token', async () => {
    const res = await request(app).post(`${BASE}/refresh`).send({ refreshToken: 'fakefakefake' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH');
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  it('revokes the refresh token', async () => {
    const logoutRes = await request(app).post(`${BASE}/logout`).send({ refreshToken });
    expect(logoutRes.status).toBe(204);

    // Refresh with the same token should now fail
    const refreshRes = await request(app).post(`${BASE}/refresh`).send({ refreshToken });
    expect(refreshRes.status).toBe(401);
    expect(refreshRes.body.error.code).toBe('INVALID_REFRESH');
  });
});

// ─── Rate limiting ────────────────────────────────────────────────────────────

describe('Rate limiting on auth routes', () => {
  it('returns 429 after exceeding login limit', async () => {
    const promises = Array.from({ length: 25 }, () =>
      request(app).post(`${BASE}/login`).send({ email: 'flood@fazn.dev', password: 'password123' }),
    );
    const results = await Promise.all(promises);
    const tooMany = results.filter(r => r.status === 429);
    expect(tooMany.length).toBeGreaterThan(0);
  });
});
