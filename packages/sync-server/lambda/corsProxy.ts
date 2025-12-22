import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
  // Import is from TypeStrong, rule doesn't acknowledge that
  // oxlint-disable-next-line actual/no-extraneous-dependencies
} from 'aws-lambda';

import * as corsApp from '../src/app-cors-proxy.js';
import { config } from '../src/load-config';

import { createHandler } from './common';

const handler = await createHandler('/cors-proxy', corsApp.handlers);
const enabled = config.get('corsProxy.enabled');

export async function handle(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  if (enabled) {
    return handler(event, context);
  } else {
    return {
      statusCode: 404,
    };
  }
}
