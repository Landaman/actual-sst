import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import migrate from 'migrate';

import { config } from './load-config';

export function run(direction = 'up') {
  console.log(
    `Checking if there are any migrations to run for direction "${direction}"...`,
  );

  const __dirname = dirname(fileURLToPath(import.meta.url)); // this directory

  return new Promise(resolve =>
    migrate.load(
      {
        stateStore: `${path.join(config.get('dataDir'), '.migrate')}${
          config.get('mode') === 'test' ? '-test' : ''
        }`,
        migrationsDirectory: process.env.SST
          ? undefined
          : path.join(__dirname, '../migrations'),
        // SST bundles this automatically. This won't always exist as a result
        // eslint-disable-next-line import/no-unresolved
        migrations: process.env.SST
          ? require('../migrations.generated.js').default
          : undefined,
      },
      (err, set) => {
        if (err) {
          throw err;
        }

        set[direction](err => {
          if (err) {
            throw err;
          }

          console.log('Migrations: DONE');
          resolve();
        });
      },
    ),
  );
}
