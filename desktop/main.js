// Piano Tutor desktop app (Electron). Serves the same web app from a private app:// origin so IndexedDB,
// Web MIDI and the folder picker behave exactly as they do in Chrome.
const { app, BrowserWindow, Menu, net, protocol, session, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const SCHEME = 'app';
const HOST = 'piano-tutor';

// Test runs (health check, README screenshots) use a throwaway profile so they never touch your real data
if (process.env.PIANO_TUTOR_SMOKE || process.env.PIANO_TUTOR_SCREENSHOTS) {
  app.setPath('userData', path.join(require('os').tmpdir(), `piano-tutor-test-${process.pid}`));
}

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

function serveAppFiles() {
  protocol.handle(SCHEME, (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(ROOT)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function allowDevicePermissions() {
  // MIDI keyboards, folder access and full screen are what the app asks for; nothing else is granted
  const allowed = new Set(['midi', 'midiSysex', 'fileSystem', 'fullscreen', 'clipboard-sanitized-write']);
  const ok = (wc, permission) => allowed.has(permission) && wc.getURL().startsWith(`${SCHEME}://${HOST}/`);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(ok(wc, permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => !!wc && ok(wc, permission));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Piano Tutor',
    backgroundColor: '#0a0e15',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  const headless = process.env.PIANO_TUTOR_SMOKE || process.env.PIANO_TUTOR_SCREENSHOTS;
  win.once('ready-to-show', () => { if (!headless) win.show(); });

  // Links that leave the app open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });

  const query = process.env.PIANO_TUTOR_SCREENSHOTS ? '?edition=public' : '';
  win.loadURL(`${SCHEME}://${HOST}/index.html${query}#/library`);
  return win;
}

// Standard menus (copy/paste, full screen, quit) on macOS; Windows hides the menu bar
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  serveAppFiles();
  allowDevicePermissions();
  buildMenu();
  const win = createWindow();

  // `PIANO_TUTOR_SMOKE=1 electron .` loads the app, prints a health check and quits (used for testing builds)
  if (process.env.PIANO_TUTOR_SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 4000));
      const report = await win.webContents.executeJavaScript(`({
        title: document.title,
        songs: document.querySelector('#resultCount')?.textContent,
        rows: document.querySelectorAll('#songList .row').length,
        libs: [typeof Tone, typeof Midi, typeof Vex].join(','),
        midi: typeof navigator.requestMIDIAccess,
        folderPicker: typeof window.showDirectoryPicker,
      })`);
      console.log('SMOKE', JSON.stringify(report));
      app.quit();
    });
    win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('CONSOLE ERROR', e.message); });
  }

  if (process.env.PIANO_TUTOR_SCREENSHOTS) {
    win.setSize(1440, 900);
    win.webContents.once('did-finish-load', async () => {
      await require('./screenshots')(win, path.resolve(process.env.PIANO_TUTOR_SCREENSHOTS));
      app.quit();
    });
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
