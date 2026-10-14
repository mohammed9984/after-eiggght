import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const app = createApp(config);
const hasOwner = app.db.prepare("SELECT 1 FROM users WHERE role='owner'").get();

app.server.listen(config.port, () => {
  console.log(`\nAFTER 8 running on ${config.baseUrl}  (port ${config.port})`);
  console.log(`Data: ${config.dataDir}/after8.db`);
  if (!hasOwner) {
    console.log('\n[!] No owner account exists, so the owner dashboard is locked.');
    console.log('    Set OWNER_EMAIL and OWNER_PASSWORD (10+ characters) in the environment or a .env file, then restart.');
  }
  if (!config.baseUrlConfigured) {
    console.log('\n[!] BASE_URL is not set to a public address. Table QR codes will point at ' + config.baseUrl + '.');
    console.log('    Set BASE_URL=https://your-domain and restart before printing QR codes.');
  }
  if (!config.secureCookies) console.log('\n[!] BASE_URL is not https, so session cookies are not marked Secure. Use https in production.');
  console.log('');
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
