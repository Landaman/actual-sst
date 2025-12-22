import * as adminApp from '../src/app-admin.js';

import { createHandler } from './common';

export const handle = createHandler('/admin', adminApp.handlers);
