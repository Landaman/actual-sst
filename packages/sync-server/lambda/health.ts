// Import is from TypeStrong, rule doesn't acknowledge that
// oxlint-disable-next-line actual/no-extraneous-dependencies
import type { APIGatewayProxyResultV2 } from 'aws-lambda';

export async function handle(): Promise<APIGatewayProxyResultV2> {
  return {
    statusCode: 200,
    body: JSON.stringify({
      status: 'UP',
    }),
  };
}
