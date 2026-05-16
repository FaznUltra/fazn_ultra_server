import { pool } from '../db/client';
import { sanitizeString, sanitizeStringArray } from '../utils/sanitize';
import { ProfileData, PublicUser } from '../types/profile';

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;
const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const BIO_MAX = 160;
const TAGS_MAX = 10;
const TAG_MAX = 20;

export interface ProfileUserRow {
  id: string;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  bio: string | null;
  avatar_url: string | null;
  tags: string[];
  role: 'player' | 'admin';
  email_verified: boolean;
  auth_provider: 'local' | 'google' | 'apple';
  global_rank: number;
  total_wins: number;
  total_matches: number;
}

function winRate(totalWins: number, totalMatches: number): number {
  return totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0;
}

// ─── Get my profile ───────────────────────────────────────────────────────────

export async function getMyProfile(userId: string): Promise<ProfileData> {
  const result = await pool.query<{ global_rank: number; total_wins: number; total_matches: number }>(
    'SELECT u.global_rank, u.total_wins, u.total_matches FROM users u WHERE u.id = $1',
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw Object.assign(new Error('User not found'), { status: 404, code: 'USER_NOT_FOUND' });
  }

  // Phase 1: game rankings, recent results, highest win, top rival are not yet
  // populated — these tables arrive in Phase 3 (Challenges).
  return {
    stats: {
      globalRank: row.global_rank,
      totalWins: row.total_wins,
      totalMatches: row.total_matches,
      winRate: winRate(row.total_wins, row.total_matches),
    },
    gameRankings: [],
    recentResults: [],
    highestWin: null,
    topRival: null,
  };
}

// ─── Update my profile ────────────────────────────────────────────────────────

export async function updateMyProfile(
  userId: string,
  input: {
    firstName?: string;
    lastName?: string;
    username?: string;
    bio?: string;
    avatarUrl?: string;
    tags?: string[];
  },
): Promise<ProfileUserRow> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.firstName !== undefined) {
    sets.push(`first_name = $${idx++}`);
    values.push(sanitizeString(input.firstName));
  }

  if (input.lastName !== undefined) {
    sets.push(`last_name = $${idx++}`);
    values.push(sanitizeString(input.lastName));
  }

  if (input.username !== undefined) {
    const username = sanitizeString(input.username);
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX || !USERNAME_RE.test(username)) {
      throw Object.assign(new Error('Invalid username'), { status: 422, code: 'VALIDATION_ERROR' });
    }
    const clash = await pool.query('SELECT id FROM users WHERE username = $1 AND id <> $2', [username, userId]);
    if (clash.rowCount && clash.rowCount > 0) {
      throw Object.assign(new Error('Username already taken'), { status: 409, code: 'USERNAME_TAKEN' });
    }
    sets.push(`username = $${idx++}`);
    values.push(username);
  }

  if (input.bio !== undefined) {
    const bio = sanitizeString(input.bio);
    if (bio.length > BIO_MAX) {
      throw Object.assign(new Error('Bio exceeds 160 characters'), { status: 422, code: 'VALIDATION_ERROR' });
    }
    sets.push(`bio = $${idx++}`);
    values.push(bio);
  }

  if (input.avatarUrl !== undefined) {
    const avatarUrl = sanitizeString(input.avatarUrl);
    if (!/^https?:\/\//i.test(avatarUrl)) {
      throw Object.assign(new Error('Invalid avatar URL'), { status: 422, code: 'VALIDATION_ERROR' });
    }
    sets.push(`avatar_url = $${idx++}`);
    values.push(avatarUrl);
  }

  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || input.tags.length > TAGS_MAX) {
      throw Object.assign(new Error('Invalid tags'), { status: 422, code: 'VALIDATION_ERROR' });
    }
    const tags = sanitizeStringArray(input.tags);
    if (tags.some((t) => t.length > TAG_MAX)) {
      throw Object.assign(new Error('Tag exceeds 20 characters'), { status: 422, code: 'VALIDATION_ERROR' });
    }
    sets.push(`tags = $${idx++}`);
    values.push(tags);
  }

  sets.push('updated_at = NOW()');
  values.push(userId);

  const result = await pool.query<ProfileUserRow>(
    `UPDATE users SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING id, email, username, first_name, last_name, bio, avatar_url, tags,
               role, email_verified, auth_provider, global_rank, total_wins, total_matches`,
    values,
  );

  const row = result.rows[0];
  if (!row) {
    throw Object.assign(new Error('User not found'), { status: 404, code: 'USER_NOT_FOUND' });
  }
  return row;
}

// ─── Get public profile ───────────────────────────────────────────────────────

export async function getPublicProfile(userId: string): Promise<PublicUser> {
  const result = await pool.query<{
    id: string;
    username: string;
    first_name: string;
    last_name: string;
    avatar_url: string | null;
    bio: string | null;
    tags: string[];
    global_rank: number;
    total_wins: number;
    total_matches: number;
    show_stats: boolean | null;
    show_recent_results: boolean | null;
  }>(
    `SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url,
            u.bio, u.tags, u.global_rank, u.total_wins, u.total_matches,
            ps.show_stats, ps.show_recent_results
     FROM users u
     LEFT JOIN privacy_settings ps ON ps.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row) {
    throw Object.assign(new Error('User not found'), { status: 404, code: 'USER_NOT_FOUND' });
  }

  // Defaults to visible when no privacy_settings row exists.
  const showStats = row.show_stats ?? true;

  return {
    id: row.id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    avatarUrl: row.avatar_url ?? undefined,
    bio: row.bio ?? undefined,
    tags: row.tags ?? [],
    globalRank: row.global_rank,
    totalWins: showStats ? row.total_wins : 0,
    totalMatches: showStats ? row.total_matches : 0,
    winRate: showStats ? winRate(row.total_wins, row.total_matches) : 0,
  };
}
