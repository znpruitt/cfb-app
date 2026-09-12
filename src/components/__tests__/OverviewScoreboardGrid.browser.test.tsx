import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CompactGameScoreboard from '../CompactGameScoreboard';
import {
  OVERVIEW_SCOREBOARD_GRID_CLASSES,
  OVERVIEW_SCOREBOARD_GRID_TARGET_COLUMN_PX,
} from '../OverviewPanel';
import { SCOREBOARD_TEAM_LOGO_SLOT } from '../../lib/teamLogos';

const CDP_OPERATION_TIMEOUT_MS = 5_000;
const CHROME_READY_TIMEOUT_MS = 15_000;
const CHROME_STOP_TIMEOUT_MS = 2_000;
const REQUIRED_WIDTHS = [760, 761, 1347, 1348, 1392] as const;

type PendingCommand = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type LayoutMeasurement = {
  width: number;
  columns: number;
  columnGap: number;
  cardRects: Array<{ left: number; top: number; width: number }>;
  stressLabelClipped: boolean;
  stressLabelClientWidth: number;
  stressLabelContentWidth: number;
  stressLabelSlack: number;
  stressRowPaddingLeft: number;
};

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCommand>();
  private closedError: Error | null = null;

  private constructor(private readonly socket: WebSocket) {
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

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        socket.close();
        reject(
          new Error(`Chrome DevTools socket did not open within ${CDP_OPERATION_TIMEOUT_MS}ms`)
        );
      }, CDP_OPERATION_TIMEOUT_MS);
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
    return new CdpClient(socket);
  }

  command<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closedError) return Promise.reject(this.closedError);

    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Chrome DevTools command ${method} timed out after ${CDP_OPERATION_TIMEOUT_MS}ms`
          )
        );
      }, CDP_OPERATION_TIMEOUT_MS);
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

  close(): void {
    this.rejectAll(new Error('Chrome DevTools client closed'));
    this.socket.close();
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;

    const message = JSON.parse(event.data) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
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

  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const discovered = candidates.find(existsSync) ?? null;
  return {
    path: discovered,
    reason: discovered ? '' : 'No Chrome or Chromium executable was found',
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
  spawnError: () => Error | null
): Promise<number> {
  const activePortPath = path.join(profileDirectory, 'DevToolsActivePort');
  const deadline = Date.now() + CHROME_READY_TIMEOUT_MS;

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

  throw new Error(
    `Chrome DevTools did not become ready within ${CHROME_READY_TIMEOUT_MS}ms. ${stderr()}`.trim()
  );
}

async function createPageTarget(port: number, url: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(CDP_OPERATION_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Chrome target creation failed with HTTP ${response.status}`);

  const target = (await response.json()) as { webSocketDebuggerUrl?: unknown };
  if (typeof target.webSocketDebuggerUrl !== 'string') {
    throw new Error('Chrome target response omitted webSocketDebuggerUrl');
  }
  return target.webSocketDebuggerUrl;
}

async function compileFixtureStyles(): Promise<string> {
  const source = `
    @import 'tailwindcss' source(none);
    @custom-variant dark (&);
    @source '../components/OverviewPanel.tsx';
    @source '../components/CompactGameScoreboard.tsx';
    @source '../lib/teamLogos.ts';
  `;
  const from = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const result = await postcss([tailwindcss()]).process(source, { from });
  return result.css;
}

function fixtureMarkup(styles: string): string {
  const scoreboards = Array.from({ length: 5 }, (_, index) => (
    <CompactGameScoreboard
      key={index}
      state="final"
      matchupLabel={`Fixture game ${index + 1}`}
      away={{
        teamName: index === 0 ? 'Middle Tennessee State' : `Away Team ${index + 1}`,
        owner: index === 0 ? 'Shambaugh' : 'Alice',
        record: { wins: 3, losses: 5 },
        score: 13,
      }}
      home={{
        teamName: `Home Team ${index + 1}`,
        owner: 'Bob',
        record: { wins: 6, losses: 2 },
        score: 20,
      }}
    />
  ));
  const body = renderToStaticMarkup(
    <div className="@container" data-layout-container style={{ width: REQUIRED_WIDTHS[0] }}>
      <div className={OVERVIEW_SCOREBOARD_GRID_CLASSES} data-layout-grid>
        {scoreboards}
      </div>
    </div>
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body>${body}</body></html>`;
}

async function waitForDocument(client: CdpClient): Promise<void> {
  const deadline = Date.now() + CDP_OPERATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await client.command<{
      result: { value?: unknown };
    }>('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    });
    if (response.result.value === 'complete') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Fixture document did not load within ${CDP_OPERATION_TIMEOUT_MS}ms`);
}

async function measureWidths(
  client: CdpClient,
  widths: readonly number[]
): Promise<LayoutMeasurement[]> {
  const response = await client.command<{
    result: { value?: LayoutMeasurement[]; description?: string };
    exceptionDetails?: { text?: string };
  }>('Runtime.evaluate', {
    expression: `
      (async () => {
        const widths = ${JSON.stringify(widths)};
        const container = document.querySelector('[data-layout-container]');
        const grid = document.querySelector('[data-layout-grid]');
        if (!(container instanceof HTMLElement) || !(grid instanceof HTMLElement)) {
          throw new Error('layout fixture did not render');
        }
        const round = (value) => Math.round(value * 1000) / 1000;
        const results = [];
        for (const width of widths) {
          container.style.width = width + 'px';
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const gridStyle = getComputedStyle(grid);
          const gridRect = grid.getBoundingClientRect();
          const cards = Array.from(grid.children, (card) => {
            const rect = card.getBoundingClientRect();
            return {
              left: round(rect.left - gridRect.left),
              top: round(rect.top - gridRect.top),
              width: round(rect.width),
            };
          });
          const stressTeam = grid.querySelector('[data-scoreboard-team="away"]');
          const stressLabel = stressTeam?.parentElement;
          const stressRow = stressTeam?.closest('[data-scoreboard-side="away"]');
          if (!(stressLabel instanceof HTMLElement) || !(stressRow instanceof HTMLElement)) {
            throw new Error('stress row did not render');
          }
          const stressContentRange = document.createRange();
          stressContentRange.selectNodeContents(stressLabel);
          const stressLabelContentWidth = stressContentRange.getBoundingClientRect().width;
          results.push({
            width,
            columns: gridStyle.gridTemplateColumns.trim().split(/\\s+/).filter(Boolean).length,
            columnGap: round(parseFloat(gridStyle.columnGap)),
            cardRects: cards,
            stressLabelClipped: stressLabel.scrollWidth > stressLabel.clientWidth,
            stressLabelClientWidth: stressLabel.clientWidth,
            stressLabelContentWidth: round(stressLabelContentWidth),
            stressLabelSlack: round(stressLabel.clientWidth - stressLabelContentWidth),
            stressRowPaddingLeft: round(parseFloat(getComputedStyle(stressRow).paddingLeft)),
          });
        }
        return results;
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.text ?? response.result.description ?? 'layout probe failed'
    );
  }
  if (!Array.isArray(response.result.value))
    throw new Error('layout probe returned no measurements');
  return response.result.value;
}

function assertNear(actual: number, expected: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= 0.1,
    `${message}: expected ${expected}, received ${actual}`
  );
}

test('Overview scoreboard grid renders its required container tiers and 416px target', async (t) => {
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
  try {
    fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'cfb-overview-grid-'));
    const profileDirectory = path.join(fixtureDirectory, 'chrome-profile');
    const fixturePath = path.join(fixtureDirectory, 'index.html');
    await writeFile(fixturePath, fixtureMarkup(await compileFixtureStyles()), 'utf8');

    let stderr = '';
    let launchError: Error | null = null;
    chrome = spawn(
      browser.path,
      [
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
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
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
      () => launchError
    );
    const targetSocketUrl = await createPageTarget(port, pathToFileURL(fixturePath).href);
    client = await CdpClient.connect(targetSocketUrl);
    await waitForDocument(client);

    const measurements = await measureWidths(client, [...REQUIRED_WIDTHS, 240]);
    const byWidth = new Map(measurements.map((measurement) => [measurement.width, measurement]));
    assert.deepEqual(
      REQUIRED_WIDTHS.map((width) => ({ width, columns: byWidth.get(width)?.columns })),
      [
        { width: 760, columns: 1 },
        { width: 761, columns: 2 },
        { width: 1347, columns: 2 },
        { width: 1348, columns: 3 },
        { width: 1392, columns: 3 },
      ]
    );

    const atThree = byWidth.get(1348);
    const clippingControl = byWidth.get(240);
    assert.ok(atThree && clippingControl, 'all required measurements must be returned');
    t.diagnostic(
      `1348px: ${atThree.cardRects[0]!.width}px columns, ${atThree.stressLabelContentWidth}px stress content in ${atThree.stressLabelClientWidth}px, ${atThree.stressLabelSlack}px range slack`
    );
    assert.equal(clippingControl.stressLabelClipped, true, 'the clipping observer needs a control');
    assert.ok(
      clippingControl.stressLabelContentWidth > clippingControl.stressLabelClientWidth + 0.5,
      'the text-range observer must measure a real overrun in the clipping control'
    );
    assert.equal(atThree.stressLabelClipped, false, 'the named stress row must fit at 1348px');
    assert.ok(
      atThree.stressLabelContentWidth <= atThree.stressLabelClientWidth + 0.5,
      'subpixel text geometry must stay within half a rendered pixel of the available label width'
    );
    assert.equal(atThree.stressRowPaddingLeft, SCOREBOARD_TEAM_LOGO_SLOT.widthPx);
    assert.equal(atThree.columnGap, 40);
    assert.ok(atThree.cardRects[0]!.width >= OVERVIEW_SCOREBOARD_GRID_TARGET_COLUMN_PX);
    assertNear(
      3 * (atThree.cardRects[0]!.width - OVERVIEW_SCOREBOARD_GRID_TARGET_COLUMN_PX),
      20,
      'three rendered columns must distribute the specified total headroom'
    );

    const [first, second, third, fourth, fifth] = atThree.cardRects;
    assert.ok(first && second && third && fourth && fifth);
    assertNear(first.top, second.top, 'the first grid row must be row-major');
    assertNear(first.top, third.top, 'the first grid row must contain three cards');
    assertNear(fourth.top, fifth.top, 'the final two cards must share the second row');
    assert.ok(fourth.top > first.top, 'the remainder must follow the first row');
    assertNear(fourth.left, first.left, 'the remainder must start in column one');
    assertNear(fifth.left, second.left, 'the second remainder must stay in column two');
    assert.ok(third.left > second.left, 'the unused final-row gap must remain on the right');
  } finally {
    client?.close();
    await stopChrome(chrome);
    if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
  }
});
