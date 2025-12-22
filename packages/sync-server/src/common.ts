import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { bootstrap } from './account-db.js';
import { config } from './load-config.js';

/**
 * Sets up common middleware and settings for the Express app
 * @param app The Express app to set up
 */
export function setupApp(app: express.Express) {
  app.disable('x-powered-by');
  app.use(cors());
  app.set('trust proxy', config.get('trustedProxies'));
  if (process.env.NODE_ENV !== 'development') {
    app.use(
      rateLimit({
        windowMs: 60 * 1000,
        max: 500,
        legacyHeaders: false,
        standardHeaders: true,
      }),
    );
  }

  app.use(express.json({ limit: `${config.get('upload.fileSizeLimitMB')}mb` }));

  app.use(
    express.raw({
      type: 'application/actual-sync',
      limit: `${config.get('upload.fileSizeSyncLimitMB')}mb`,
    }),
  );

  app.use(
    express.raw({
      type: 'application/encrypted-file',
      limit: `${config.get('upload.syncEncryptedFileSizeLimitMB')}mb`,
    }),
  );
}

/**
 * Sets up the OpenID configuration if provided in the config
 */
export async function setupOpenId() {
  const openIdConfig = config?.getProperties()?.openId;
  if (
    openIdConfig?.discoveryURL ||
    openIdConfig?.issuer?.authorization_endpoint
  ) {
    console.log('OpenID configuration found. Preparing server to use it');
    try {
      const { error } = await bootstrap({ openId: openIdConfig }, true);
      if (error) {
        console.log(error);
      } else {
        console.log('OpenID configured!');
      }
    } catch (err) {
      console.error(err);
    }
  }
}
