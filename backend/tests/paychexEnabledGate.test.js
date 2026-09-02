const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { requirePaychexEnabled, requirePaychexDisabled } = require('../middleware/paychexGuard');

function createApp() {
  const app = express();
  app.get('/enabled', requirePaychexEnabled, (_req, res) => res.json({ ok: true }));
  app.get('/disabled', requirePaychexDisabled, (_req, res) => res.json({ ok: true }));
  return app;
}

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

describe('paychex guard middleware', () => {
  let server;
  let port;
  const original = process.env.PAYCHEX_ENABLED;

  before(async () => {
    const app = createApp();
    server = await listen(app);
    port = server.port;
  });

  after(async () => {
    process.env.PAYCHEX_ENABLED = original;
    await server.close();
  });

  it('blocks Paychex routes when PAYCHEX_ENABLED=0', async () => {
    process.env.PAYCHEX_ENABLED = '0';
    const res = await fetch(`http://127.0.0.1:${port}/enabled`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'PAYCHEX_DISABLED');
  });

  it('allows Non-Paychex routes when PAYCHEX_ENABLED=0', async () => {
    process.env.PAYCHEX_ENABLED = '0';
    const res = await fetch(`http://127.0.0.1:${port}/disabled`);
    assert.equal(res.status, 200);
  });

  it('blocks Non-Paychex routes when PAYCHEX_ENABLED=1', async () => {
    process.env.PAYCHEX_ENABLED = '1';
    const res = await fetch(`http://127.0.0.1:${port}/disabled`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'PAYCHEX_ENABLED');
  });
});
