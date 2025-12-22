import * as syncApp from '../src/app-sync.js';

import { createHandler } from './common.js';

export const handle = await createHandler('/sync', syncApp.handlers);
