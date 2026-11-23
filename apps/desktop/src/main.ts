/**
 * GoCrypto desktop — Electron main process.
 *
 * Security model:
 *  - The renderer is the regular web app, served from a privileged custom scheme (app://gocrypto)
 *    with a strict Content-Security-Policy. No Node.js in the renderer: contextIsolation + sandbox.
 *  - The preload exposes a tiny, typed bridge (window.gocryptoDesktop). Every IPC handler checks
 *    the sender origin and validates its arguments.
 *  - Auth tokens are encrypted with the OS keychain (safeStorage: DPAPI / Keychain / libsecret).
 *    If encryption is unavailable they are kept in memory only — never written in plain text.
 *  - Navigation and window.open are locked down; external links open in the default browser.
 */
import { BrowserWindow, Menu, Notification, app, ipcMain, nativeTheme, net, protocol, safeStorage, screen, session, shell, type IpcMainInvokeEvent } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEME = 'app';
const HOST = 'gocrypto';
const APP_ORIGIN = `${SCHEME}://${HOST}`;
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const isDev = Boolean(DEV_URL);
const SECURE_KEYS = new Set(['auth']);

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);

// ───────────────────────── configuration ─────────────────────────

interface DesktopConfig {
  apiUrl: string;
  wsUrl: string;
}

function userFile(name: string): string {
  return join(app.getPath('userData'), name);
}

function readJson<T>(file: string): T | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Endpoints: environment variables win, then <userData>/config.json, then local development defaults.
 * Production installs ship a config.json (or set GOCRYPTO_API_URL / GOCRYPTO_WS_URL) pointing at HTTPS endpoints.
 */
function loadConfig(): DesktopConfig {
  const file = readJson<Partial<DesktopConfig>>(userFile('config.json')) ?? {};
  const apiUrl = [process.env.GOCRYPTO_API_URL, file.apiUrl].find(isHttpUrl) ?? 'http://localhost:4000';
  const wsUrl = [process.env.GOCRYPTO_WS_URL, file.wsUrl].find(isHttpUrl) ?? 'http://localhost:4001';
  if (!app.isPackaged || process.env.GOCRYPTO_ALLOW_INSECURE === '1') return { apiUrl, wsUrl };
  // Packaged builds refuse plaintext endpoints except on loopback.
  const secure = (u: string) => new URL(u).protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(u).hostname);
  if (!secure(apiUrl) || !secure(wsUrl)) throw new Error('GoCrypto desktop requires HTTPS API endpoints (set apiUrl/wsUrl in config.json).');
  return { apiUrl, wsUrl };
}

let config: DesktopConfig;

function contentSecurityPolicy(): string {
  const origins = new Set<string>();
  for (const u of [config.apiUrl, config.wsUrl]) {
    const url = new URL(u);
    origins.add(url.origin);
    origins.add(`${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`);
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${[...origins].join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// ───────────────────────── secure storage (OS keychain) ─────────────────────────

const memoryStore = new Map<string, string>();

/** Real OS-backed encryption only: Linux's "basic_text" fallback is obfuscation, so tokens then stay in memory. */
function canEncrypt(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
  return true;
}

function secureGet(key: string): string | null {
  if (!canEncrypt()) return memoryStore.get(key) ?? null;
  const store = readJson<Record<string, string>>(userFile('secure-store.json')) ?? {};
  const enc = store[key];
  if (!enc) return null;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return null;
  }
}

function secureSet(key: string, value: string | null): void {
  if (!canEncrypt()) {
    if (value === null) memoryStore.delete(key);
    else memoryStore.set(key, value);
    return;
  }
  const file = userFile('secure-store.json');
  const store = readJson<Record<string, string>>(file) ?? {};
  if (value === null) delete store[key];
  else store[key] = safeStorage.encryptString(value).toString('base64');
  writeJson(file, store);
}

// ───────────────────────── IPC (validated) ─────────────────────────

function trustedSender(e: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith(`${APP_ORIGIN}/`) || (isDev && url.startsWith(DEV_URL!));
}

function registerIpc(): void {
  ipcMain.handle('config:get', (e) => {
    if (!trustedSender(e)) throw new Error('forbidden');
    return config;
  });
  ipcMain.handle('secure-store:get', (e, key: unknown) => {
    if (!trustedSender(e) || typeof key !== 'string' || !SECURE_KEYS.has(key)) throw new Error('forbidden');
    return secureGet(key);
  });
  ipcMain.handle('secure-store:set', (e, key: unknown, value: unknown) => {
    if (!trustedSender(e) || typeof key !== 'string' || !SECURE_KEYS.has(key)) throw new Error('forbidden');
    if (value !== null && (typeof value !== 'string' || value.length > 16_384)) throw new Error('invalid value');
    secureSet(key, value);
  });
  ipcMain.on('notify', (e, title: unknown, body: unknown) => {
    if (!trustedSender(e) || typeof title !== 'string' || typeof body !== 'string') return;
    if (!Notification.isSupported()) return;
    new Notification({ title: title.slice(0, 120), body: body.slice(0, 400), silent: false }).show();
  });
  ipcMain.on('open-external', (e, url: unknown) => {
    if (!trustedSender(e) || !isHttpUrl(url)) return;
    void shell.openExternal(url);
  });
}

// ───────────────────────── renderer protocol ─────────────────────────

function rendererRoot(): string {
  // Packaged: resources/app.asar/renderer ; dev build: apps/desktop/renderer
  return join(__dirname, '..', 'renderer');
}

function registerAppProtocol(): void {
  const root = rendererRoot();
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('Not found', { status: 404 });
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || !pathname.includes('.')) pathname = '/index.html';
    const file = normalize(join(root, pathname));
    const rel = relative(root, file);
    if (rel.startsWith('..') || rel.includes(`..${sep}`)) return new Response('Forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', contentSecurityPolicy());
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    return new Response(res.body, { status: res.status, headers });
  });
}

// ───────────────────────── windows ─────────────────────────

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

function loadWindowState(): WindowState {
  const s = readJson<WindowState>(userFile('window-state.json'));
  const fallback = { width: 1440, height: 900 };
  if (!s || typeof s.width !== 'number' || typeof s.height !== 'number') return fallback;
  // Ignore positions that are no longer on any display (monitor unplugged).
  const visible =
    s.x === undefined ||
    s.y === undefined ||
    screen.getAllDisplays().some((d) => s.x! >= d.bounds.x - 50 && s.y! >= d.bounds.y - 50 && s.x! < d.bounds.x + d.bounds.width && s.y! < d.bounds.y + d.bounds.height);
  return visible ? s : { ...fallback, maximized: s.maximized };
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const state = loadWindowState();
  const win = new BrowserWindow({
    ...state,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'GoCrypto',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0d12' : '#f4f6fa',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: isDev || !app.isPackaged,
      additionalArguments: [`--gocrypto-version=${app.getVersion()}`],
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  const saveState = () => {
    if (win.isDestroyed()) return;
    const b = win.getNormalBounds();
    writeJson(userFile('window-state.json'), { ...b, maximized: win.isMaximized() });
  };
  win.on('close', saveState);

  // Lock navigation to the app itself; everything else opens in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith(`${APP_ORIGIN}/`) || (isDev && url.startsWith(DEV_URL!));
    if (!allowed) {
      event.preventDefault();
      if (isHttpUrl(url)) void shell.openExternal(url);
    }
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  void win.loadURL(isDev ? DEV_URL! : `${APP_ORIGIN}/index.html`);
  win.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(isDev || !app.isPackaged ? [{ role: 'toggleDevTools' as const }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Open config folder',
          click: () => void shell.openPath(app.getPath('userData')),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ───────────────────────── lifecycle ─────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  void app.whenReady().then(() => {
    config = loadConfig();
    // Deny every permission request except notifications and sanitized clipboard writes (copy buttons).
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'notifications' || permission === 'clipboard-sanitized-write'));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'notifications' || permission === 'clipboard-sanitized-write');
    registerAppProtocol();
    registerIpc();
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
