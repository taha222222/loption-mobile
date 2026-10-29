// Runs the real dispatcher core once against the local PostgREST (service
// role) with a FAKE Expo Push API, for the end-to-end harness.
// Usage: node --experimental-strip-types dispatch_once.ts <restBase> <serviceJwt> <nowIso> <mode ok|unregistered> <outFile>
// Prints the dispatch summary as JSON; writes the messages the fake push
// service received to <outFile>. Never contacts Expo.
import http from 'node:http';
import fs from 'node:fs';
import { postgrestRpc, runDispatch } from '../../functions/dispatch-notifications/dispatch.ts';

const [restBase, serviceJwt, nowIso, mode, outFile] = process.argv.slice(2);
const received: unknown[] = [];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.endsWith('/push/send')) {
      const messages = JSON.parse(body) as unknown[];
      received.push(...messages);
      res.end(
        JSON.stringify({
          data: messages.map((_, i) =>
            mode === 'unregistered'
              ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
              : { status: 'ok', id: `fake-ticket-${Date.now()}-${i}` }
          ),
        })
      );
    } else {
      res.end(JSON.stringify({ data: {} }));
    }
  });
});

server.listen(0, '127.0.0.1', async () => {
  const port = (server.address() as { port: number }).port;
  try {
    const summary = await runDispatch({
      rpc: postgrestRpc(restBase.replace(/\/rest\/v1\/?$/, ''), serviceJwt, fetch),
      fetch,
      expoPushUrl: `http://127.0.0.1:${port}/push/send`,
      expoReceiptsUrl: `http://127.0.0.1:${port}/push/getReceipts`,
      now: () => new Date(nowIso),
    });
    fs.writeFileSync(outFile, JSON.stringify(received));
    console.log(JSON.stringify(summary));
  } catch (e) {
    console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  } finally {
    server.close();
  }
});
