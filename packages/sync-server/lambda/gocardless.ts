import * as goCardlessApp from '../src/app-gocardless/app-gocardless.js';

import { createHandler } from './common.js';

export const handle = await createHandler(
  '/gocardless',
  goCardlessApp.handlers,
);
