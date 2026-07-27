import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './components/AppShell';
import { wipeLocalData } from './db/open';
import './styles.css';

/**
 * The Vite entry.
 *
 * Deliberately thin. The shell, the tabs and every screen are the same modules
 * Next renders today — this only decides where they mount, which is the one
 * thing that genuinely differs between a server-rendered page and a static
 * bundle in a WebView.
 */

/**
 * Sign-out, pending the token client.
 *
 * Clears the device, which is the half that matters for a shared barn tablet
 * (C5): the next person to sign in must not read the previous farm's records.
 * It does NOT yet revoke the refresh token server-side — there is no token
 * client on this entry to hold one, so there is nothing to revoke. When that
 * lands it calls POST /auth/logout, which S3b already built and tested.
 */
async function signOut(): Promise<void> {
  await wipeLocalData();
  window.location.reload();
}

const root = document.getElementById('root');
if (!root) throw new Error('No #root element — index.html and main.tsx disagree.');

createRoot(root).render(
  <StrictMode>
    <AppShell signOutAction={signOut} />
  </StrictMode>,
);
