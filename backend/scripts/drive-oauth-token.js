// scripts/drive-oauth-token.js
// One-time helper: sign in with the SSG-owned Google account and obtain a
// refresh token for Drive Synced Storage (drive.file scope).
//
// Run it YOURSELF in your own terminal (the token is a secret):
//   cd backend
//   $env:GOOGLE_DRIVE_OAUTH_CLIENT_ID="<desktop-client-id>"
//   $env:GOOGLE_DRIVE_OAUTH_CLIENT_SECRET="<desktop-client-secret>"
//   node scripts/drive-oauth-token.js
// Then paste the printed refresh token into backend/.env as
// GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN. Do not commit it or share it.
//
// Requires an OAuth client of type "Desktop app" (loopback redirect allowed).

require('dotenv').config();
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

const PORT = Number(process.env.DRIVE_OAUTH_PORT || 53682);
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const clientId = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_DRIVE_OAUTH_CLIENT_ID and GOOGLE_DRIVE_OAUTH_CLIENT_SECRET first.');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a refresh token even if previously granted
  scope: ['https://www.googleapis.com/auth/drive.file'],
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== '/oauth2callback') return res.end();
  const code = url.searchParams.get('code');
  if (!code) {
    res.end('No code received. Check the terminal.');
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    res.end('Done. You can close this tab and return to the terminal.');
    if (!tokens.refresh_token) {
      console.error('\nNo refresh token returned. Remove the app at myaccount.google.com/permissions and retry.');
    } else {
      console.log('\nAdd this line to backend/.env (keep it secret):\n');
      console.log(`GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    }
  } catch (err) {
    res.end('Token exchange failed. Check the terminal.');
    console.error('Token exchange failed:', err.message);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log('Open this URL and sign in with the SSG-owned Google account:\n');
  console.log(authUrl + '\n');
});

