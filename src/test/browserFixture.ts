import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CDP_OPERATION_TIMEOUT_MS = 5_000;
const CHROME_READY_TIMEOUT_MS = 15_000;
const CHROME_STOP_TIMEOUT_MS = 2_000;
// The shared runner caps each test at 30s. Work gets 24s total, then the two
// stop phases get at most 4s, leaving 2s for the final profile removal.
const BROWSER_WORK_TIMEOUT_MS = 24_000;

type PendingCommand = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type BrowserTestContext = {
  diagnostic: (message: string) => void;
  skip: (message: string) => void;
};

export type BrowserFixturePage = {
  evaluate: <T>(expression: string) => Promise<T>;
};

type BrowserFixtureOptions = {
  directoryPrefix: string;
  markup: string | (() => string | Promise<string>);
};

function remainingTimeout(deadline: number, maximumMs: number, operation: string): number {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new Error(`Browser-test work deadline expired before ${operation}`);
  }
  return Math.min(maximumMs, remainingMs);
}

class CdpClient implements BrowserFixturePage {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCommand>();
  private closedError: Error | null = null;

  private constructor(
    private readonly socket: WebSocket,
    private readonly workDeadline: number
  ) {
    socket.addEventListener('message', (event) => this.handleMessage(event));
    socket.addEventListener('error', () => {
      this.rejectAll(new Error('Chrome DevTools socket errored'));
    });
    socket.addEventListener('close', (event) => {
      this.rejectAll(
        new Error(
          `Chrome DevTools socket closed (${event.code}${event.reason ? `: ${event.reason}` : ''})`
        )
      );
    });
  }

  static async connect(url: string, workDeadline: number): Promise<CdpClient> {
    const timeoutMs = remainingTimeout(
      workDeadline,
      CDP_OPERATION_TIMEOUT_MS,
      'the DevTools socket connection'
    );
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        socket.close();
        reject(new Error(`Chrome DevTools socket did not open within ${timeoutMs}ms`));
      }, timeoutMs);
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Chrome DevTools socket failed during open'));
      };
      const onClose = (event: CloseEvent) => {
        cleanup();
        reject(
          new Error(
            `Chrome DevTools socket closed during open (${event.code}${event.reason ? `: ${event.reason}` : ''})`
          )
        );
      };
      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onClose);
      };

      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
    });
    return new CdpClient(socket, workDeadline);
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.command<{
      result?: { value?: T; description?: string };
      exceptionDetails?: { text?: string };
    }>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.text ??
          response.result?.description ??
          'browser evaluation failed'
      );
    }
    if (!response.result || !Object.prototype.hasOwnProperty.call(response.result, 'value')) {
      throw new Error('Browser evaluation returned no serializable value');
    }
    return response.result.value as T;
  }

  close(): void {
    this.rejectAll(new Error('Chrome DevTools client closed'));
    this.socket.close();
  }

  private command<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closedError) return Promise.reject(this.closedError);

    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = remainingTimeout(
        this.workDeadline,
        CDP_OPERATION_TIMEOUT_MS,
        `Chrome DevTools command ${method}`
      );
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;

    let message: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(event.data) as typeof message;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.rejectAll(new Error(`Chrome DevTools sent malformed JSON: ${detail}`));
      this.socket.close();
      return;
    }
    if (message.id === undefined) return;

    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? 'Chrome DevTools command failed'));
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectAll(error: Error): void {
    if (this.closedError) return;
    this.closedError = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function chromeExecutable(): { path: string | null; reason: string } {
  const configured = process.env.CHROME_PATH?.trim();
  if (configured) {
    return existsSync(configured)
      ? { path: configured, reason: '' }
      : { path: null, reason: `CHROME_PATH does not exist: ${configured}` };
  }

  const executableNames = [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
    'microsoft-edge-stable',
  ];
  const executableSuffixes = process.platform === 'win32' ? ['', '.exe'] : [''];
  const pathCandidates = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      executableNames.flatMap((name) =>
        executableSuffixes.map((suffix) => path.join(directory, `${name}${suffix}`))
      )
    );
  const knownCandidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/opt/homebrew/bin/chromium',
    '/usr/local/bin/chromium',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const discovered = [...new Set([...pathCandidates, ...knownCandidates])].find(existsSync) ?? null;
  return {
    path: discovered,
    reason: discovered
      ? ''
      : 'No compatible Chrome, Chromium, or Edge executable was found on PATH or in known locations; set CHROME_PATH explicitly',
  };
}

function childHasStopped(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (childHasStopped(child)) return true;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
    if (childHasStopped(child)) finish(true);
  });
}

async function stopChrome(child: ChildProcess | null): Promise<void> {
  if (!child || childHasStopped(child)) return;

  const gracefulExit = waitForChildExit(child, CHROME_STOP_TIMEOUT_MS);
  child.kill('SIGTERM');
  if (await gracefulExit) return;

  const forcedExit = waitForChildExit(child, CHROME_STOP_TIMEOUT_MS);
  child.kill('SIGKILL');
  if (!(await forcedExit) && !childHasStopped(child)) {
    throw new Error(`Chrome did not stop within ${2 * CHROME_STOP_TIMEOUT_MS}ms`);
  }
}

async function waitForChromeDevTools(
  profileDirectory: string,
  child: ChildProcess,
  stderr: () => string,
  spawnError: () => Error | null,
  workDeadline: number
): Promise<number> {
  const activePortPath = path.join(profileDirectory, 'DevToolsActivePort');
  const deadline = Math.min(Date.now() + CHROME_READY_TIMEOUT_MS, workDeadline);

  while (Date.now() < deadline) {
    const launchError = spawnError();
    if (launchError) throw launchError;
    if (childHasStopped(child)) {
      throw new Error(`Chrome exited before DevTools became ready. ${stderr()}`.trim());
    }

    try {
      const [portLine] = (await readFile(activePortPath, 'utf8')).split('\n');
      const port = Number(portLine);
      if (Number.isSafeInteger(port) && port > 0) return port;
    } catch {
      // The file is absent or incomplete while Chrome initializes.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const reason =
    Date.now() >= workDeadline
      ? `Browser-test work deadline expired after ${BROWSER_WORK_TIMEOUT_MS}ms`
      : `Chrome DevTools did not become ready within ${CHROME_READY_TIMEOUT_MS}ms`;
  throw new Error(`${reason}. ${stderr()}`.trim());
}

async function createPageTarget(port: number, url: string, workDeadline: number): Promise<string> {
  const timeoutMs = remainingTimeout(
    workDeadline,
    CDP_OPERATION_TIMEOUT_MS,
    'Chrome target creation'
  );
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Chrome target creation failed with HTTP ${response.status}`);

  const target = (await response.json()) as { webSocketDebuggerUrl?: unknown };
  if (typeof target.webSocketDebuggerUrl !== 'string') {
    throw new Error('Chrome target response omitted webSocketDebuggerUrl');
  }
  return target.webSocketDebuggerUrl;
}

async function waitForDocument(client: CdpClient, workDeadline: number): Promise<void> {
  const deadline = Math.min(Date.now() + CDP_OPERATION_TIMEOUT_MS, workDeadline);
  while (Date.now() < deadline) {
    const readyState = await client.evaluate<unknown>('document.readyState');
    if (readyState === 'complete') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    Date.now() >= workDeadline
      ? `Browser-test work deadline expired after ${BROWSER_WORK_TIMEOUT_MS}ms`
      : `Fixture document did not load within ${CDP_OPERATION_TIMEOUT_MS}ms`
  );
}

export async function withBrowserFixture(
  t: BrowserTestContext,
  options: BrowserFixtureOptions,
  verify: (page: BrowserFixturePage) => Promise<void>
): Promise<void> {
  const browser = chromeExecutable();
  if (!browser.path) {
    const message = `${browser.reason}. Run npm run test:browser:required on a host with Chrome.`;
    if (process.env.REQUIRE_BROWSER_TESTS === '1') throw new Error(message);
    t.skip(message);
    return;
  }

  let fixtureDirectory: string | null = null;
  let chrome: ChildProcess | null = null;
  let client: CdpClient | null = null;
  let testFailure: unknown = null;
  const cleanupErrors: unknown[] = [];
  const workDeadline = Date.now() + BROWSER_WORK_TIMEOUT_MS;
  const emergencyCleanup = () => {
    try {
      if (chrome && !childHasStopped(chrome)) chrome.kill('SIGKILL');
    } catch {
      // Process teardown cannot recover or report cleanup failures safely.
    }
    try {
      if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true });
    } catch {
      // Best effort only during process teardown; normal cleanup reports errors below.
    }
  };
  process.once('exit', emergencyCleanup);

  try {
    fixtureDirectory = await mkdtemp(path.join(tmpdir(), options.directoryPrefix));
    const profileDirectory = path.join(fixtureDirectory, 'chrome-profile');
    const fixturePath = path.join(fixtureDirectory, 'index.html');
    const markup = typeof options.markup === 'function' ? await options.markup() : options.markup;
    await writeFile(fixturePath, markup, 'utf8');

    let stderr = '';
    let launchError: Error | null = null;
    const chromeArguments = [
      '--headless=new',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-features=MediaRouter,OptimizationHints',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDirectory}`,
      'about:blank',
    ];
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      chromeArguments.splice(1, 0, '--no-sandbox');
    }
    chrome = spawn(browser.path, chromeArguments, { stdio: ['ignore', 'ignore', 'pipe'] });
    chrome.once('error', (error) => {
      launchError = error;
    });
    chrome.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString();
    });

    const port = await waitForChromeDevTools(
      profileDirectory,
      chrome,
      () => stderr.trim(),
      () => launchError,
      workDeadline
    );
    const targetSocketUrl = await createPageTarget(
      port,
      pathToFileURL(fixturePath).href,
      workDeadline
    );
    client = await CdpClient.connect(targetSocketUrl, workDeadline);
    await waitForDocument(client, workDeadline);
    await verify(client);
  } catch (error) {
    testFailure = error;
  } finally {
    try {
      client?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await stopChrome(chrome);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    process.removeListener('exit', emergencyCleanup);
  }

  if (cleanupErrors.length > 0) {
    const cleanupMessage = cleanupErrors
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join('; ');
    if (testFailure) {
      t.diagnostic(`Browser cleanup also failed: ${cleanupMessage}`);
    } else {
      throw new AggregateError(cleanupErrors, `Browser cleanup failed: ${cleanupMessage}`);
    }
  }
  if (testFailure) throw testFailure;
}
