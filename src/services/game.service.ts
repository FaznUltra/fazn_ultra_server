import { pool } from '../db/client';
import { sanitizeString, sanitizeStringArray } from '../utils/sanitize';

export interface Game {
  id: string;
  name: string;
  slug: string;
  category: string;
  platforms: string[];
  thumbnail_url: string | null;
  score_type: 'numeric' | 'win_loss' | 'time';
  active: boolean;
  created_by: string | null;
  created_at: string;
}

const VALID_CATEGORIES = ['soccer', 'basketball', 'racing', 'fps', 'fighting', 'sports', 'other'];
const VALID_PLATFORMS = ['PC', 'PS4', 'PS5', 'Xbox One', 'Xbox Series X/S', 'Mobile', 'Nintendo Switch'];
const VALID_SCORE_TYPES = ['numeric', 'win_loss', 'time'];

export { VALID_CATEGORIES, VALID_PLATFORMS, VALID_SCORE_TYPES };

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function listActiveGames(): Promise<Game[]> {
  const result = await pool.query<Game>(
    `SELECT id, name, slug, category, platforms, thumbnail_url, score_type, active, created_by, created_at
       FROM games WHERE active = TRUE ORDER BY created_at DESC`,
  );
  return result.rows;
}

export async function listAllGames(): Promise<Game[]> {
  const result = await pool.query<Game>(
    `SELECT id, name, slug, category, platforms, thumbnail_url, score_type, active, created_by, created_at
       FROM games ORDER BY created_at DESC`,
  );
  return result.rows;
}

export async function createGame(input: {
  name: string;
  category: string;
  platforms: string[];
  thumbnailUrl?: string;
  scoreType: 'numeric' | 'win_loss' | 'time';
  createdBy: string;
}): Promise<Game> {
  const name = sanitizeString(input.name);
  const category = sanitizeString(input.category);
  const platforms = sanitizeStringArray(input.platforms);
  const slug = toSlug(name);
  const result = await pool.query<Game>(
    `INSERT INTO games (name, slug, category, platforms, thumbnail_url, score_type, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, slug, category, platforms, thumbnail_url, score_type, active, created_by, created_at`,
    [name, slug, category, platforms, input.thumbnailUrl ?? null, input.scoreType, input.createdBy],
  );
  return result.rows[0];
}

export async function toggleGameActive(id: string, active: boolean): Promise<Game | null> {
  const result = await pool.query<Game>(
    `UPDATE games SET active = $1 WHERE id = $2
     RETURNING id, name, slug, category, platforms, thumbnail_url, score_type, active, created_by, created_at`,
    [active, id],
  );
  return result.rows[0] ?? null;
}
