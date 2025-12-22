import * as pluggyai from '../src/app-pluggyai/app-pluggyai.js';

import { createHandler } from './common';

export const handle = await createHandler('/pluggyai', pluggyai.handlers);
