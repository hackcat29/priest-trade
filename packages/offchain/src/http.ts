import { createServer, type Server } from 'node:http';

export interface HealthServerOptions {
  port: number;
  serviceName: string;
  getReadiness: () => Promise<boolean> | boolean;
  getMetrics?: () => Promise<string> | string;
}

export function createHealthServer(options: HealthServerOptions): Server {
  return createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(404).end();
      return;
    }

    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          service: options.serviceName,
          ok: true,
          ts: new Date().toISOString(),
        }),
      );
      return;
    }

    if (req.url === '/readyz') {
      const ready = await options.getReadiness();
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          service: options.serviceName,
          ready,
          ts: new Date().toISOString(),
        }),
      );
      return;
    }

    if (req.url === '/metrics') {
      const metrics = options.getMetrics ? await options.getMetrics() : '';
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      res.end(metrics);
      return;
    }

    res.writeHead(404).end();
  }).listen(options.port);
}
