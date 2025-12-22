import { type APIGatewayProxyResultV2 } from 'aws-lambda';

export async function handle(): Promise<APIGatewayProxyResultV2> {
  return {
    statusCode: 200,
    // Mem and uptime don't make sense in a serverless application
    body: JSON.stringify({
      mem: {
        arrayBuffers: 0,
        external: 0,
        heapTotal: 0,
        heapUsed: 0,
        rss: 0,
      } satisfies NodeJS.MemoryUsage,
      uptime: 0,
    }),
  };
}
