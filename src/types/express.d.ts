declare namespace Express {
  interface UserPayload {
    id: string;
    email: string;
    role: 'player' | 'admin';
  }

  interface Request {
    user?: UserPayload;
  }
}
