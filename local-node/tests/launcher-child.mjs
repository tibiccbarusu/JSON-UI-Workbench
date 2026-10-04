import { launchLocal } from '../launcher.mjs';

// Test discovery or importing this support file must not start a server.
if (process.env.JSONUI_LAUNCHER_CHILD === '1') {
  const instance = await launchLocal({ projectRoot: process.argv[2], preferredPort: 0, openBrowser: false });
  console.log(JSON.stringify({ ready: true, reused: instance.reused, url: instance.url }));
  const stop = () => instance.close().catch(() => { process.exitCode = 1; });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
