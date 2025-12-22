import * as accountApp from '../src/app-account.js';

import { createHandler } from './common.js';

export const handle = await createHandler('/account', accountApp.handlers);
