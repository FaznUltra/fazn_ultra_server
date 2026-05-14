import { pool } from '../db/client';

export async function findOrCreateUser(clerkUserId: string, email: string, username: string) {
  const existing = await pool.query('SELECT * FROM users WHERE clerk_user_id = $1', [clerkUserId]);
  if (existing.rows.length > 0) return existing.rows[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO users (clerk_user_id, email, username) VALUES ($1, $2, $3) RETURNING *`,
      [clerkUserId, email, username],
    );
    await client.query('INSERT INTO wallets (user_id) VALUES ($1)', [result.rows[0].id]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getUserByClerkId(clerkUserId: string) {
  const result = await pool.query(
    'SELECT u.*, w.balance FROM users u LEFT JOIN wallets w ON w.user_id = u.id WHERE u.clerk_user_id = $1',
    [clerkUserId],
  );
  return result.rows[0] ?? null;
}
