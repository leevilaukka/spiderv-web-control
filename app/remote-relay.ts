// The remote-control relay (relay.ts) in Vite's dev and preview servers.
import type { Plugin } from 'vite';
import { RELAY_PATH, createRelay } from './relay.ts';

export function remoteRelay(): Plugin {
  const relay = createRelay();
  return {
    name: 'spiderv-remote',
    configureServer(server) {
      relay.attach(server.httpServer);
      server.middlewares.use(RELAY_PATH + '/info', relay.info);
    },
    configurePreviewServer(server) {
      relay.attach(server.httpServer);
      server.middlewares.use(RELAY_PATH + '/info', relay.info);
    },
  };
}
