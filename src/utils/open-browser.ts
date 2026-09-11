import { spawn } from 'node:child_process';

/**
 * Best-effort attempt to open a Google sign-in URL in the user's default browser.
 * Only Google account URLs are ever opened, and no shell is involved.
 */
export function openBrowser(url: string): boolean {
  if (!url.startsWith('https://accounts.google.com/')) return false;
  const [command, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}
