export type Tier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';
export type ResultOutcome = 'win' | 'loss' | 'draw';

export interface GameRanking {
  gameId: string;
  gameName: string;
  platform: string;
  tier: Tier;
  rank: number;
  points: number;
}

export interface RecentResult {
  id: string;
  gameName: string;
  outcome: ResultOutcome;
  score: string;
  opponentUsername: string;
  playedAt: string;
}

export interface HighestWin {
  gameName: string;
  score: string;
  opponentUsername: string;
  date: string;
}

export interface TopRival {
  username: string;
  avatarUrl?: string;
  winsAgainst: number;
  lossesAgainst: number;
}

export interface ProfileStats {
  globalRank: number;
  totalWins: number;
  totalMatches: number;
  winRate: number;
}

export interface ProfileData {
  stats: ProfileStats;
  gameRankings: GameRanking[];
  recentResults: RecentResult[];
  highestWin: HighestWin | null;
  topRival: TopRival | null;
}

export interface PublicUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  bio?: string;
  tags: string[];
  globalRank: number;
  totalWins: number;
  totalMatches: number;
  winRate: number;
}

export interface PrivacySettings {
  showOnlineStatus: boolean;
  showStats: boolean;
  showRecentResults: boolean;
  allowChallengesFrom: 'everyone' | 'friends' | 'nobody';
}

export interface StreamingChannel {
  id: string;
  provider: 'youtube' | 'twitch';
  channelId: string;
  channelName: string;
  channelUrl: string;
  connectedAt: string;
}
