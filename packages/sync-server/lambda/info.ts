import { type APIGatewayProxyResultV2 } from 'aws-lambda';

export async function handle(): Promise<APIGatewayProxyResultV2> {
  return {
    statusCode: 200,
    body: JSON.stringify({
      build: {
        name: process.env.SST_ACTUAL_SYNC_SERVER_NAME,
        description: process.env.SST_ACTUAL_SYNC_SERVER_DESCRIPTION,
        version: process.env.SST_ACTUAL_SYNC_SERVER_VERSION,
      },
    }),
  };
}
