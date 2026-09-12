import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compile } from 'tailwindcss';

import CompactGameScoreboard from '../CompactGameScoreboard';
import {
  OVERVIEW_SCOREBOARD_GRID_CLASSES,
  OVERVIEW_SCOREBOARD_GRID_MIN_COLUMN_PX,
  OVERVIEW_SCOREBOARD_GRID_THREE_COLUMN_MIN_PX,
  OVERVIEW_SCOREBOARD_GRID_TWO_COLUMN_MIN_PX,
} from '../OverviewPanel';

const CHROME_EXECUTABLE_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((candidate): candidate is string => Boolean(candidate));

type BrowserMeasurement = {
  width: number;
  columnCount: number;
  firstCardWidth: number;
  firstCardLeft: number;
  fourthCardLeft: number;
  firstCardTop: number;
  fourthCardTop: number;
  stressLabelClipped: boolean;
  stressRowOverflows: boolean;
};

type CdpMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: { result?: { value?: unknown }; exceptionDetails?: unknown };
  error?: unknown;
};

function scoreboard(index: number): React.ReactElement {
  const isStressCase = index === 0;
  return (
    <CompactGameScoreboard
      key={index}
      state="live"
      clock="Q2"
      matchupLabel={
        isStressCase ? 'Middle Tennessee State at Louisiana Tech' : `Away ${index} at Home ${index}`
      }
      away={{
        teamName: isStressCase ? 'Middle Tennessee State' : `Away ${index}`,
        teamLogo: isStressCase
          ? { url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E' }
          : null,
        owner: isStressCase ? 'Shambaugh' : 'Alice',
        rank: null,
        record: isStressCase ? { wins: 3, losses: 5 } : { wins: 1, losses: 0 },
        score: isStressCase ? 13 : index,
      }}
      home={{
        teamName: isStressCase ? 'Louisiana Tech' : `Home ${index}`,
        owner: 'Bob',
        rank: null,
        record: { wins: 4, losses: 4 },
        score: isStressCase ? 10 : index + 1,
      }}
    />
  );
}

function classCandidates(markup: string): string[] {
  const document = new JSDOM(markup).window.document;
  return [
    ...new Set(
      [...document.querySelectorAll('[class]')].flatMap((element) => [...element.classList])
    ),
  ];
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

async function waitForChrome(
  port: number,
  process: ChildProcess,
  stderr: () => string
): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`Chrome exited before DevTools was ready (${process.exitCode}): ${stderr()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome has not opened the DevTools socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Chrome DevTools did not become ready: ${stderr()}`);
}

async function evaluateInBrowser(port: number, url: string, expression: string): Promise<unknown> {
  const targetResponse = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' }
  );
  assert.equal(
    targetResponse.ok,
    true,
    `could not create browser target: ${targetResponse.status}`
  );
  const target = (await targetResponse.json()) as { webSocketDebuggerUrl: string };
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('DevTools WebSocket failed')), {
      once: true,
    });
  });

  let nextId = 1;
  const pending = new Map<number, (message: CdpMessage) => void>();
  const events = new Map<string, Array<(params: unknown) => void>>();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as CdpMessage;
    if (message.id) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
      return;
    }
    for (const handler of events.get(message.method ?? '') ?? []) handler(message.params);
  });

  const command = (method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> => {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, (message) => {
        if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
        else resolve(message);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  const once = (method: string): Promise<unknown> =>
    new Promise((resolve) => {
      const handler = (params: unknown) => {
        events.set(
          method,
          (events.get(method) ?? []).filter((candidate) => candidate !== handler)
        );
        resolve(params);
      };
      events.set(method, [...(events.get(method) ?? []), handler]);
    });

  try {
    await command('Page.enable');
    await command('Runtime.enable');
    const loaded = once('Page.loadEventFired');
    await command('Page.navigate', { url });
    await loaded;
    const evaluation = await command('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    assert.equal(evaluation.result?.exceptionDetails, undefined);
    return evaluation.result?.result?.value;
  } finally {
    socket.close();
  }
}

async function stopChrome(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (process.exitCode === null) process.kill('SIGKILL');
    }, 2_000);
    process.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    process.kill('SIGTERM');
  });
}

const chromeExecutable = CHROME_EXECUTABLE_CANDIDATES.find(existsSync);

test(
  'browser renders the Overview stress row and left-aligned orphan at the declared column floors',
  { skip: chromeExecutable ? false : 'Chrome or Chromium is unavailable' },
  async () => {
    assert.ok(chromeExecutable);
    const markup = renderToStaticMarkup(
      <div id="scoreboard-container" className="@container">
        <div id="scoreboard-grid" className={OVERVIEW_SCOREBOARD_GRID_CLASSES}>
          {Array.from({ length: 5 }, (_, index) => scoreboard(index))}
        </div>
      </div>
    );
    const compiler = await compile(`
      @theme {
        --spacing: .25rem;
        --text-xs: .75rem;
        --text-xs--line-height: calc(1 / .75);
        --text-sm: .875rem;
        --text-sm--line-height: calc(1.25 / .875);
        --font-weight-normal: 400;
        --font-weight-medium: 500;
        --font-weight-semibold: 600;
      }
      @tailwind utilities;
    `);
    const utilities = compiler.build(classCandidates(markup));
    const fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'cfb-overview-grid-'));
    const fixturePath = path.join(fixtureDirectory, 'fixture.html');
    const profilePath = path.join(fixtureDirectory, 'chrome-profile');
    const measurementExpression = `
      (() => {
        const container = document.querySelector('#scoreboard-container');
        const grid = document.querySelector('#scoreboard-grid');
        const cards = [...grid.querySelectorAll('[data-game-scoreboard]')];
        const stressRow = grid.querySelector('[data-scoreboard-side="away"]');
        const stressLabel = stressRow.querySelector('.truncate');
        const widths = [
          ${OVERVIEW_SCOREBOARD_GRID_TWO_COLUMN_MIN_PX - 1},
          ${OVERVIEW_SCOREBOARD_GRID_TWO_COLUMN_MIN_PX},
          ${OVERVIEW_SCOREBOARD_GRID_THREE_COLUMN_MIN_PX - 1},
          ${OVERVIEW_SCOREBOARD_GRID_THREE_COLUMN_MIN_PX}
        ];
        const measurements = [];
        for (const width of widths) {
          container.style.width = width + 'px';
          void grid.offsetWidth;
          const first = cards[0].getBoundingClientRect();
          const fourth = cards[3].getBoundingClientRect();
          measurements.push({
            width,
            columnCount: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
            firstCardWidth: first.width,
            firstCardLeft: first.left,
            fourthCardLeft: fourth.left,
            firstCardTop: first.top,
            fourthCardTop: fourth.top,
            stressLabelClipped: stressLabel.scrollWidth > stressLabel.clientWidth + 0.01,
            stressRowOverflows: stressRow.scrollWidth > stressRow.clientWidth + 0.01,
          });
        }
        return measurements;
      })();
    `;
    const html = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            *, *::before, *::after { box-sizing: border-box; }
            html, body { margin: 0; padding: 0; }
            body {
              font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica,
                Arial, "Apple Color Emoji", "Segoe UI Emoji";
            }
            img { display: block; }
            ${utilities}
          </style>
        </head>
        <body>${markup}</body>
      </html>`;

    writeFileSync(fixturePath, html);
    const port = await availablePort();
    let browserStderr = '';
    const browser = spawn(
      chromeExecutable,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-features=MediaRouter,OptimizationHints',
        '--disable-extensions',
        '--disable-logging',
        '--log-level=3',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profilePath}`,
        '--window-size=1600,1000',
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    browser.stderr?.on('data', (chunk) => {
      browserStderr += String(chunk);
    });
    try {
      await waitForChrome(port, browser, () => browserStderr);
      const measurements = (await evaluateInBrowser(
        port,
        pathToFileURL(fixturePath).href,
        measurementExpression
      )) as BrowserMeasurement[];
      assert.ok(Array.isArray(measurements), 'browser did not publish grid measurements');
      const byWidth = new Map(measurements.map((measurement) => [measurement.width, measurement]));
      const belowTwo = byWidth.get(OVERVIEW_SCOREBOARD_GRID_TWO_COLUMN_MIN_PX - 1);
      const atTwo = byWidth.get(OVERVIEW_SCOREBOARD_GRID_TWO_COLUMN_MIN_PX);
      const belowThree = byWidth.get(OVERVIEW_SCOREBOARD_GRID_THREE_COLUMN_MIN_PX - 1);
      const atThree = byWidth.get(OVERVIEW_SCOREBOARD_GRID_THREE_COLUMN_MIN_PX);
      assert.ok(belowTwo && atTwo && belowThree && atThree);

      assert.equal(belowTwo.columnCount, 1);
      assert.equal(atTwo.columnCount, 2);
      assert.equal(belowThree.columnCount, 2);
      assert.equal(atThree.columnCount, 3);
      assert.equal(atTwo.firstCardWidth, OVERVIEW_SCOREBOARD_GRID_MIN_COLUMN_PX);
      assert.equal(atThree.firstCardWidth, OVERVIEW_SCOREBOARD_GRID_MIN_COLUMN_PX);
      assert.equal(atThree.stressLabelClipped, false);
      assert.equal(atThree.stressRowOverflows, false);
      assert.ok(
        atThree.fourthCardTop > atThree.firstCardTop,
        'fourth card must begin a second row'
      );
      assert.ok(
        Math.abs(atThree.fourthCardLeft - atThree.firstCardLeft) < 0.25,
        'the orphan row must begin in the leftmost column'
      );
    } finally {
      await stopChrome(browser);
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  }
);
