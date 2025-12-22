import { run as runMigrations } from '../src/migrations.js';

// Keep this in a separate file because the compiled file ends up being way simpler and
// we guarantee we run migrations before the rest of the app code gets let into the bundle
export async function handle() {
  await runMigrations();
}
