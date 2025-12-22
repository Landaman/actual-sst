// Can't use real imports in sst.config.ts
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  async app(input) {
    const region: aws.Region = 'us-east-1';

    return {
      name: 'actual-sst',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      protect: ['production'].includes(input?.stage),
      home: 'aws',
      providers: {
        aws: {
          region,
        },
        'aws-native': {
          version: '1.40.0',
          region,
        },
      },
    };
  },
  async run() {
    const vpc = (await import('./vpc-ipv6')).createDualStackVPC('AppVPC');
    const vpcMapping = {
      id: vpc.vpc.id,
      subnets: vpc.privateSubnets.apply(subnets =>
        subnets.map(subnet => subnet.id),
      ),
    } as const;

    const efs = new sst.aws.Efs('ActualDataDir', {
      vpc: vpcMapping,
    });

    // These are dependencies that are native and don't come precompiled for linux
    const compiledDependencies = ['bcrypt', 'better-sqlite3'];
    const fullyQualifiedCompiledDependenciesFolder = (
      await import('path')
    ).join(__dirname, '../', './artifacts/CompiledDependencies-src');

    if (
      !(await import('fs')).existsSync(fullyQualifiedCompiledDependenciesFolder)
    ) {
      console.log('Building compiled dependencies for Lambda...');
      const cmd = `
        docker run --rm \
          --platform=linux/amd64 \
          --entrypoint /bin/bash \
          -v "${fullyQualifiedCompiledDependenciesFolder}:/var/task" \
          -w /var/task \
          "public.ecr.aws/lambda/nodejs:22" \
          -c "
            set -e

            echo 'Installing build tools...'
            microdnf install -y \
              gcc-c++ \
              make \
              python3 \
              && microdnf clean all

            echo 'Rebuilding native addons...'
            npm install ${compiledDependencies.join(' ')}
          "
          `;
      (await import('child_process')).execSync(cmd, { stdio: 'inherit' });
      console.log('Compiled dependency build complete');
    }

    const compiledDependencyLayer = new aws.lambda.LayerVersion(
      'CompiledDependencies',
      {
        layerName: `${$app.name}-${$app.stage}-compiled-dependencies`,
        code: $asset(fullyQualifiedCompiledDependenciesFolder),
      },
    );
    const syncServerPackageJson = JSON.parse(
      (await import('fs')).readFileSync(
        './packages/sync-server/package.json',
        'utf-8',
      ),
    );

    await generateBanksFile();
    const functionBase = {
      transform: {
        function: (args: aws.lambda.FunctionArgs) => {
          args.vpcConfig = {
            ...args.vpcConfig,
            ipv6AllowedForDualStack: true,
          };
          return undefined;
        },
      },
      vpc: {
        id: vpc.vpc.id,
        privateSubnets: vpc.privateSubnets.apply(subnets =>
          subnets.map(subnet => subnet.id),
        ),
        securityGroups: $util.output([vpc.securityGroup.id]),
      },
      runtime: 'nodejs22.x' as const,
      dev: false as const,
      copyFiles: [
        {
          from: './packages/sync-server/src/sql',
          to: 'sql',
        },
        // Uncomment this if you use a config.json file. DO NOT try to set https stuff there (it won't do anything). HTTPS is handled by CloudFront
        // {
        //   from: './config.json',
        //   to: 'config.json',
        // },
      ],
      layers: [compiledDependencyLayer.arn],
      nodejs: {
        install: ['bcrypt', 'better-sqlite3'],
      },
      // bcrypt and better-sqlite3 are LAME and need to be built manually for linux
      // Not all node packages with native binaries are like this, but these in particular
      // aren't prebundled with native binaries via optionalDependencies -> OS
      // so that SST can find them
      // Also the weird import stuff is actuallu necessary, no top-level imports in sst.config.ts
      hook: {
        postbuild: async (dir: string) => {
          console.log('Removing compiled packages from node modules');
          const cmd = `cd ${dir} && npm uninstall ${compiledDependencies.join(' ')}`;
          (await import('child_process')).execSync(cmd, { stdio: 'inherit' });
        },
      },
      environment: {
        SST_ACTUAL_SYNC_SERVER_NAME: syncServerPackageJson.name,
        SST_ACTUAL_SYNC_SERVER_DESCRIPTION: syncServerPackageJson.description,
        SST_ACTUAL_SYNC_SERVER_VERSION: syncServerPackageJson.version,
        ACTUAL_DATA_DIR: '/mnt/data',
        ACTUAL_CONFIG_PATH: '/config.json',
        SST: 'true',
      },
      volume: {
        efs,
        path: '/mnt/data',
      },
    };

    await generateMigrationsFile();
    const migrator = new sst.aws.Function('Migrator', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/migrate.handle',
    });
    // // This is how migrations are handled in dev as well
    new aws.lambda.Invocation('MigrationJob', {
      functionName: migrator.name,
      // We need to use the date as input, so that the migration actually runs every time you try to go up
      input: JSON.stringify({
        now: new Date().toISOString(),
      }),
    });

    // Actual needs these headers
    const routerResponseHeaders = new aws.cloudfront.ResponseHeadersPolicy(
      'AppRouterResponseHeaders',
      {
        customHeadersConfig: {
          items: [
            {
              header: 'Cross-Origin-Embedder-Policy',
              override: true,
              value: 'require-corp',
            },
            {
              header: 'Cross-Origin-Opener-Policy',
              override: true,
              value: 'same-origin',
            },
          ],
        },
      },
    );
    const router = new sst.aws.Router('AppRouter', {
      transform: {
        cachePolicy: {},
        cdn: {
          transform: {
            distribution: args => {
              args.defaultCacheBehavior = {
                ...args.defaultCacheBehavior,
                responseHeadersPolicyId: routerResponseHeaders.id,
              };
            },
          },
        },
      },
    });

    new sst.aws.StaticSite('ViteApp', {
      router: { instance: router },
      path: 'packages/desktop-client',
      dev: {
        command: `yarn start:browser`,
      },
      build: {
        command: 'yarn build:browser',
        output: 'build',
      },
      environment: $dev
        ? {
            SST_API_URL: router.url,
          }
        : undefined,
    });
    new sst.aws.Function('SyncFunction', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/sync.handle',
      url: {
        router: { instance: router, path: '/sync' },
      },
    });
    new sst.aws.Function('AccountFunction', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/account.handle',
      url: {
        router: { instance: router, path: '/account' },
      },
    });
    new sst.aws.Function('GoCardlessFunction', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/gocardless.handle',
      url: {
        router: { instance: router, path: '/gocardless' },
      },
    });
    new sst.aws.Function('SimpleFinFunction', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/simplefin.handle',
      url: {
        router: { instance: router, path: '/simplefin' },
      },
    });
    new sst.aws.Function('PluggyAiFunction', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/pluggyai.handle',
      url: {
        router: { instance: router, path: '/pluggyai' },
      },
    });
    new sst.aws.Function('SecretFunction', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/secret.handle',
      url: {
        router: { instance: router, path: '/secret' },
      },
    });
    new sst.aws.Function('CorsProxyFunction', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/corsProxy.handle',
      url: {
        router: { instance: router, path: '/cors-proxy' },
      },
    });
    new sst.aws.Function('AdminFunction', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/admin.handle',
      url: {
        router: { instance: router, path: '/admin' },
      },
    });
    new sst.aws.Function('OpenIDFunction', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/openid.handle',
      url: {
        router: { instance: router, path: '/openid' },
      },
    });
    new sst.aws.Function('ModeFunction', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/mode.handle',
      url: {
        router: { instance: router, path: '/mode' },
      },
    });
    new sst.aws.Function('InfoFunction', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/info.handle',
      url: {
        router: { instance: router, path: '/info' },
      },
    });
    new sst.aws.Function('HealthFunction', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/health.handle',
      url: {
        router: { instance: router, path: '/health' },
      },
    });
    new sst.aws.Function('MetricsFunction', {
      ...functionBase,
      handler: 'packages/sync-server/lambda/metrics.handle',
      url: {
        router: { instance: router, path: '/metrics' },
      },
    });
  },
});

/**
 * Generates a banks.generated.js file that imports all bank files and exports them as an array.
 * We have to do this because dynamic imports aren't supported by ESBuild (at least not the way we did it...)
 */
async function generateBanksFile() {
  const banksDir = (await import('path')).resolve(
    './packages/sync-server/src/app-gocardless/banks',
  );

  const files = (await import('fs'))
    .readdirSync(banksDir)
    .filter(f => f.includes('_') && f.endsWith('.js'));

  const imports = files
    .map((f, i) => `import b${i} from './banks/${f}';`)
    .join('\n');

  const exports = `export default [${files.map((_, i) => `b${i}`).join(', ')}];`;

  (await import('fs')).writeFileSync(
    (await import('path')).join(banksDir, '../', 'banks.generated.js'),
    `${imports}\n\n${exports}\n`,
  );
}

/**
 * Generates a migrations.generated.js file that imports all migration files and exports them as an object.
 * We have to do this because dynamic imports aren't supported by ESBuild (at least not the way we did it...)
 */
async function generateMigrationsFile() {
  const migrationsDir = (await import('path')).resolve(
    './packages/sync-server/migrations',
  );

  const files = (await import('fs'))
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith('.js'));

  const imports = files
    .map((f, i) => `import * as m${i} from './migrations/${f}';`)
    .join('\n');

  const exports = `export default {\n${files
    .map((f, i) => {
      const filename = f.replace('.js', '');
      return `  '${filename}': { up: m${i}.up, down: m${i}.down }`;
    })
    .join(',\n')}\n};`;

  (await import('fs')).writeFileSync(
    (await import('path')).join(
      migrationsDir,
      '../',
      'migrations.generated.js',
    ),
    `${imports}\n\n${exports}\n`,
  );
}
