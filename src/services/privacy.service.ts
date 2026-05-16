import { pool } from '../db/client';
import { PrivacySettings } from '../types/profile';

interface PrivacyRow {
  show_online_status: boolean;
  show_stats: boolean;
  show_recent_results: boolean;
  allow_challenges_from: 'everyone' | 'friends' | 'nobody';
}

const DEFAULTS: PrivacySettings = {
  showOnlineStatus: true,
  showStats: true,
  showRecentResults: true,
  allowChallengesFrom: 'everyone',
};

function mapRow(row: PrivacyRow): PrivacySettings {
  return {
    showOnlineStatus: row.show_online_status,
    showStats: row.show_stats,
    showRecentResults: row.show_recent_results,
    allowChallengesFrom: row.allow_challenges_from,
  };
}

// ─── Get privacy settings ─────────────────────────────────────────────────────

export async function getPrivacySettings(userId: string): Promise<PrivacySettings> {
  const result = await pool.query<PrivacyRow>('SELECT * FROM privacy_settings WHERE user_id = $1', [userId]);
  const row = result.rows[0];
  return row ? mapRow(row) : { ...DEFAULTS };
}

// ─── Update privacy settings ──────────────────────────────────────────────────

export async function updatePrivacySettings(
  userId: string,
  input: {
    showOnlineStatus?: boolean;
    showStats?: boolean;
    showRecentResults?: boolean;
    allowChallengesFrom?: 'everyone' | 'friends' | 'nobody';
  },
): Promise<PrivacySettings> {
  // Merge with current (or default) values so partial updates do not clobber.
  const current = await getPrivacySettings(userId);
  const merged: PrivacySettings = {
    showOnlineStatus: input.showOnlineStatus ?? current.showOnlineStatus,
    showStats: input.showStats ?? current.showStats,
    showRecentResults: input.showRecentResults ?? current.showRecentResults,
    allowChallengesFrom: input.allowChallengesFrom ?? current.allowChallengesFrom,
  };

  const result = await pool.query<PrivacyRow>(
    `INSERT INTO privacy_settings (user_id, show_online_status, show_stats, show_recent_results, allow_challenges_from)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       show_online_status = EXCLUDED.show_online_status,
       show_stats = EXCLUDED.show_stats,
       show_recent_results = EXCLUDED.show_recent_results,
       allow_challenges_from = EXCLUDED.allow_challenges_from,
       updated_at = NOW()
     RETURNING *`,
    [userId, merged.showOnlineStatus, merged.showStats, merged.showRecentResults, merged.allowChallengesFrom],
  );

  return mapRow(result.rows[0]);
}
