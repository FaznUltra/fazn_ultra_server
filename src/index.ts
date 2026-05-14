import { app } from './app';
import { env } from './config/env';

const port = env.PORT;

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', msg: 'server.started', port, env: env.NODE_ENV }));
});

const shutdown = (signal: string) => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', msg: 'server.shutdown', signal }));
  server.close(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
