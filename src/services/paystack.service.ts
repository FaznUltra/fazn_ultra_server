import { env } from '../config/env';

const PAYSTACK_BASE = 'https://api.paystack.co';

interface DomainError extends Error {
  status: number;
  code: string;
  details?: unknown;
}

function domainError(status: number, code: string, message: string): DomainError {
  return Object.assign(new Error(message), { status, code }) as DomainError;
}

function assertConfigured(): string {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw domainError(503, 'PAYSTACK_NOT_CONFIGURED', 'Paystack is not configured');
  }
  return env.PAYSTACK_SECRET_KEY;
}

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

async function paystackFetch<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  const secret = assertConfigured();

  let res: Response;
  try {
    res = await fetch(`${PAYSTACK_BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw domainError(502, 'PAYSTACK_UNREACHABLE', 'Could not reach payment provider');
  }

  let json: PaystackEnvelope<T> | null = null;
  try {
    json = (await res.json()) as PaystackEnvelope<T>;
  } catch {
    json = null;
  }

  if (!res.ok || !json || json.status !== true) {
    const message = json?.message ?? 'Payment provider error';
    throw domainError(502, 'PAYSTACK_ERROR', message);
  }

  return json.data;
}

// ─── Initialize a transaction ─────────────────────────────────────────────────

export async function initializeTransaction(params: {
  email: string;
  amount: number; // kobo
  reference: string;
  callbackUrl?: string;
}): Promise<{ authorizationUrl: string; reference: string }> {
  assertConfigured();

  const data = await paystackFetch<{ authorization_url: string; reference: string }>(
    '/transaction/initialize',
    {
      method: 'POST',
      body: {
        email: params.email,
        amount: params.amount,
        reference: params.reference,
        callback_url: params.callbackUrl || env.PAYSTACK_CALLBACK_URL || undefined,
      },
    },
  );

  return { authorizationUrl: data.authorization_url, reference: data.reference };
}

// ─── Verify a transaction ─────────────────────────────────────────────────────

export async function verifyTransaction(reference: string): Promise<{
  status: 'success' | 'failed' | 'abandoned';
  amount: number; // kobo
  reference: string;
}> {
  assertConfigured();

  const data = await paystackFetch<{ status: string; amount: number; reference: string }>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { method: 'GET' },
  );

  const normalized: 'success' | 'failed' | 'abandoned' =
    data.status === 'success'
      ? 'success'
      : data.status === 'abandoned'
        ? 'abandoned'
        : 'failed';

  return { status: normalized, amount: data.amount, reference: data.reference };
}
