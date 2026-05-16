export interface WalletRow {
  id: string;
  user_id: string;
  balance: number;
  created_at: string;
}

export interface TransactionRow {
  id: string;
  user_id: string;
  type: string;
  status: string;
  amount: number;
  description: string;
  reference: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
