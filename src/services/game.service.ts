import { pool } from '../db/client';

export interface Game {
  id: string;
  name: string;
  platform: string;
  thumbnail_url: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export async function listActiveGames(): Promise<Game[]> {
  const result = await pool.query<Game>(
    `SELECT id, name, platform, thumbnail_url, active, created_by, created_at
       FROM games
      WHERE active = TRUE
      ORDER BY created_at DESC`,
  );
  return result.rows;
}

export async function createGame(input: {
  name: string;
  platform: string;
  thumbnailUrl?: string;
  createdBy: string;
}): Promise<Game> {
  const result = await pool.query<Game>(
    `INSERT INTO games (name, platform, thumbnail_url, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, platform, thumbnail_url, active, created_by, created_at`,
    [input.name, input.platform, input.thumbnailUrl ?? null, input.createdBy],
  );
  return result.rows[0];
}

export async function deactivateGame(id: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE games SET active = FALSE WHERE id = $1 AND active = TRUE`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}
