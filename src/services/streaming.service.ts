import { pool } from '../db/client';
import { sanitizeString } from '../utils/sanitize';
import { StreamingChannel } from '../types/profile';

const CHANNEL_NAME_MAX = 100;
const PROVIDERS = ['youtube', 'twitch'] as const;
type Provider = (typeof PROVIDERS)[number];

interface ChannelRow {
  id: string;
  provider: Provider;
  channel_id: string;
  channel_name: string;
  channel_url: string;
  connected_at: Date;
}

function mapRow(row: ChannelRow): StreamingChannel {
  return {
    id: row.id,
    provider: row.provider,
    channelId: row.channel_id,
    channelName: row.channel_name,
    channelUrl: row.channel_url,
    connectedAt: row.connected_at.toISOString(),
  };
}

function isValidChannelUrl(provider: Provider, url: string): boolean {
  if (provider === 'youtube') {
    return /^https:\/\/(www\.)?youtube\.com/i.test(url);
  }
  return /^https:\/\/(www\.)?twitch\.tv/i.test(url);
}

// ─── List channels ────────────────────────────────────────────────────────────

export async function getStreamingChannels(userId: string): Promise<StreamingChannel[]> {
  const result = await pool.query<ChannelRow>(
    `SELECT id, provider, channel_id, channel_name, channel_url, connected_at
     FROM streaming_channels WHERE user_id = $1 ORDER BY connected_at ASC`,
    [userId],
  );
  return result.rows.map(mapRow);
}

// ─── Connect channel ──────────────────────────────────────────────────────────

export async function connectChannel(
  userId: string,
  input: { provider: string; channelId: string; channelName: string; channelUrl: string },
): Promise<StreamingChannel> {
  const provider = input.provider as Provider;
  if (!PROVIDERS.includes(provider)) {
    throw Object.assign(new Error('Invalid provider'), { status: 422, code: 'VALIDATION_ERROR' });
  }

  const channelId = sanitizeString(input.channelId ?? '');
  const channelName = sanitizeString(input.channelName ?? '');
  const channelUrl = sanitizeString(input.channelUrl ?? '');

  if (!channelId) {
    throw Object.assign(new Error('channelId is required'), { status: 422, code: 'VALIDATION_ERROR' });
  }
  if (!channelName || channelName.length > CHANNEL_NAME_MAX) {
    throw Object.assign(new Error('Invalid channelName'), { status: 422, code: 'VALIDATION_ERROR' });
  }
  if (!isValidChannelUrl(provider, channelUrl)) {
    throw Object.assign(new Error('Invalid channelUrl for provider'), { status: 422, code: 'VALIDATION_ERROR' });
  }

  const result = await pool.query<ChannelRow>(
    `INSERT INTO streaming_channels (user_id, provider, channel_id, channel_name, channel_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, provider) DO UPDATE SET
       channel_id = EXCLUDED.channel_id,
       channel_name = EXCLUDED.channel_name,
       channel_url = EXCLUDED.channel_url,
       connected_at = NOW()
     RETURNING id, provider, channel_id, channel_name, channel_url, connected_at`,
    [userId, provider, channelId, channelName, channelUrl],
  );

  return mapRow(result.rows[0]);
}

// ─── Disconnect channel ───────────────────────────────────────────────────────

export async function disconnectChannel(userId: string, provider: string): Promise<void> {
  const result = await pool.query(
    'DELETE FROM streaming_channels WHERE user_id = $1 AND provider = $2',
    [userId, provider],
  );
  if (!result.rowCount || result.rowCount === 0) {
    throw Object.assign(new Error('Channel not found'), { status: 404, code: 'CHANNEL_NOT_FOUND' });
  }
}
