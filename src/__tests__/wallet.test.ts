import { createHmac } from 'crypto';
import request from 'supertest';

// Configure Paystack BEFORE app/services import so env picks it up.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy_secret';

// Mock the Paystack HTTP layer — never hit the network in tests.
jest.mock('../services/paystack.service', () => ({
  initializeTransaction: jest.fn(async (p: { reference: string }) => ({
    authorizationUrl: `https://checkout.paystack.com/${p.reference}`,
    reference: p.reference,
  })),
  verifyTransaction: jest.fn(async (reference: string) => ({
    status: 'success' as const,
    amount: 0,
    reference,
  })),
}));

// eslint-disable-next-line import/first
import { app } from '../app';
// eslint-disable-next-line import/first
import { pool } from '../db/client';

const AUTH = '/api/v1/auth';
const BASE = '/api/v1/wallet';
const SECRET = 'sk_test_dummy_secret';

const ts = Date.now();
const user = {
  email: `w_${ts}@fazn.dev`,
  username: `w_${ts}`,
  password: 'SecurePass123!',
  firstName: 'Wally',
  lastName: 'W',
};

let token: string;
let userId: string;

beforeAll(async () => {
  const r = await request(app).post(`${AUTH}/register`).send(user);
  token = r.body.accessToken;
  userId = r.body.user.id;
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email = $1', [user.email]);
  await pool.end();
});

// ─── GET /wallet ──────────────────────────────────────────────────────────────

describe('GET /wallet', () => {
  it('returns 200 with wallet shape (auto-created wallet, zero balance)', async () => {
    const res = await request(app).get(`${BASE}/`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      balance: 0,
      pendingAmount: 0,
      totalWon: 0,
      totalSpent: 0,
      transactions: [],
    });
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get(`${BASE}/`);
    expect(res.status).toBe(401);
  });
});

// ─── POST /wallet/topup ───────────────────────────────────────────────────────

describe('POST /wallet/topup', () => {
  it('creates a pending top-up and returns a reference', async () => {
    const res = await request(app)
      .post(`${BASE}/topup`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 2500, paymentMethod: 'paystack_card' });
    expect(res.status).toBe(200);
    expect(typeof res.body.reference).toBe('string');
    expect(res.body.authorizationUrl).toContain('checkout.paystack.com');
  });

  it('rejects non-positive amount with 422', async () => {
    const res = await request(app)
      .post(`${BASE}/topup`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 0 });
    expect(res.status).toBe(422);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).post(`${BASE}/topup`).send({ amount: 1000 });
    expect(res.status).toBe(401);
  });
});

// ─── POST /wallet/topup/verify (idempotency) ──────────────────────────────────

describe('POST /wallet/topup/verify', () => {
  it('credits wallet once and is idempotent on repeat calls', async () => {
    const init = await request(app)
      .post(`${BASE}/topup`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1000, paymentMethod: 'paystack_card' });
    const reference = init.body.reference;

    const first = await request(app)
      .post(`${BASE}/topup/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reference });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('completed');

    const afterFirst = await request(app).get(`${BASE}/`).set('Authorization', `Bearer ${token}`);
    const balanceAfterFirst = afterFirst.body.balance;

    // Second verify must NOT double-credit.
    const second = await request(app)
      .post(`${BASE}/topup/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reference });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('completed');

    const afterSecond = await request(app).get(`${BASE}/`).set('Authorization', `Bearer ${token}`);
    expect(afterSecond.body.balance).toBe(balanceAfterFirst);
  });
});

// ─── POST /wallet/withdraw ────────────────────────────────────────────────────

describe('POST /wallet/withdraw', () => {
  it('rejects amount below minimum with 400', async () => {
    const res = await request(app)
      .post(`${BASE}/withdraw`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 100, accountName: 'Wally W', accountNumber: '0123456789', bankName: 'GTBank' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AMOUNT_TOO_LOW');
  });

  it('rejects insufficient balance with 422', async () => {
    const res = await request(app)
      .post(`${BASE}/withdraw`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 999999,
        accountName: 'Wally W',
        accountNumber: '0123456789',
        bankName: 'GTBank',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('debits wallet and creates a pending withdrawal', async () => {
    // Ensure a known balance via a verified top-up.
    const init = await request(app)
      .post(`${BASE}/topup`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 5000, paymentMethod: 'paystack_card' });
    await request(app)
      .post(`${BASE}/topup/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reference: init.body.reference });

    const before = await request(app).get(`${BASE}/`).set('Authorization', `Bearer ${token}`);
    const balanceBefore = before.body.balance;

    const res = await request(app)
      .post(`${BASE}/withdraw`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 600, accountName: 'Wally W', accountNumber: '0123456789', bankName: 'GTBank' });
    expect(res.status).toBe(200);
    expect(res.body.transaction.type).toBe('withdrawal');
    expect(res.body.transaction.status).toBe('pending');

    const after = await request(app).get(`${BASE}/`).set('Authorization', `Bearer ${token}`);
    expect(after.body.balance).toBe(balanceBefore - 600);
  });

  it('returns 401 without token', async () => {
    const res = await request(app)
      .post(`${BASE}/withdraw`)
      .send({ amount: 600, accountName: 'X', accountNumber: '0123456789', bankName: 'GTBank' });
    expect(res.status).toBe(401);
  });
});

// ─── GET /wallet/transactions ─────────────────────────────────────────────────

describe('GET /wallet/transactions', () => {
  it('returns paginated transactions', async () => {
    const res = await request(app)
      .get(`${BASE}/transactions?page=1&limit=5`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.transactions)).toBe(true);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(5);
    expect(typeof res.body.total).toBe('number');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get(`${BASE}/transactions`);
    expect(res.status).toBe(401);
  });
});

// ─── POST /wallet/webhook ─────────────────────────────────────────────────────

describe('POST /wallet/webhook', () => {
  it('accepts a valid Paystack signature', async () => {
    const init = await request(app)
      .post(`${BASE}/topup`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1500, paymentMethod: 'paystack_card' });

    const payload = JSON.stringify({
      event: 'charge.success',
      id: `evt_${Date.now()}`,
      data: { reference: init.body.reference },
    });
    const signature = createHmac('sha512', SECRET).update(payload).digest('hex');

    const res = await request(app)
      .post(`${BASE}/webhook`)
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', signature)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('rejects an invalid signature with 401', async () => {
    const payload = JSON.stringify({ event: 'charge.success', id: 'evt_bad', data: {} });
    const res = await request(app)
      .post(`${BASE}/webhook`)
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', 'deadbeef')
      .send(payload);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('is idempotent for duplicate event ids', async () => {
    const init = await request(app)
      .post(`${BASE}/topup`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1200, paymentMethod: 'paystack_card' });

    const eventId = `evt_dup_${Date.now()}`;
    const payload = JSON.stringify({
      event: 'charge.success',
      id: eventId,
      data: { reference: init.body.reference },
    });
    const signature = createHmac('sha512', SECRET).update(payload).digest('hex');

    const first = await request(app)
      .post(`${BASE}/webhook`)
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', signature)
      .send(payload);
    expect(first.status).toBe(200);

    const balAfterFirst = (
      await request(app).get(`${BASE}/`).set('Authorization', `Bearer ${token}`)
    ).body.balance;

    const second = await request(app)
      .post(`${BASE}/webhook`)
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', signature)
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);

    const balAfterSecond = (
      await request(app).get(`${BASE}/`).set('Authorization', `Bearer ${token}`)
    ).body.balance;
    expect(balAfterSecond).toBe(balAfterFirst);
  });
});
