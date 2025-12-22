import * as secretApp from '../src/app-secrets.js';

import { createHandler } from './common';

export const handle = await createHandler('/secret', secretApp.handlers);
