import express from 'express';
import serverless from 'serverless-http';

import { setupApp, setupOpenId } from '../src/common.js';

/**
 * Creates a wrapped handler for the given route/path combo
 * @param route The Express route to handle
 * @param routePath The path to mount the route on
 * @returns The serverless handler
 */
export async function createHandler(routePath: string, route: express.Express) {
  const app = express();
  setupApp(app);
  app.use(routePath, route);

  await setupOpenId();

  const serverlessHandler = serverless(app, {
    binary: [
      'application/actual-sync',
      'application/encrypted-file',
      'application/octet-stream',
    ],
  });

  return serverlessHandler;
}
