import config from '../../config/default.json' with { type: 'json' };
import { buildApp } from './app.ts';

const { host, port, secureCookies } = config.server;
const app = buildApp({ secureCookies });

try {
  const address = await app.listen({ host, port });
  console.log(`API listening at ${address}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
