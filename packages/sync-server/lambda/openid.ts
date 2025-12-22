import * as openidApp from '../src/app-openid.js';

import { createHandler } from './common';

export const handle = createHandler('/openid', openidApp.handlers);
