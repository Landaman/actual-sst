import * as simpleFinApp from '../src/app-simplefin/app-simplefin.js';

import { createHandler } from './common.js';

export const handle = await createHandler('/simplefin', simpleFinApp.handlers);
