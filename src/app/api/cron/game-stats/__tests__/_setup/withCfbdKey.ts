// Side-effect module: set CFBD_API_KEY BEFORE the cron route module first loads.
// The route captures the key in a module-load-time constant, so a later
// `process.env` assignment (or a beforeEach) cannot reach it. Import this module
// AHEAD of '../route' so the key is present when the route is evaluated. ESM
// evaluates imported modules in source order, so import order is what matters.
process.env.CFBD_API_KEY = 'test-cfbd-token';

export {};
