// Can't use real imports in sst.config.ts
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts"/>

/**
 * Creates a dual-stack VPC with public and private subnets, internet gateway,
 * egress-only internet gateway, and default security group.
 * Basically a copy of what SST does, but with IPv6 support and no cloud map
 */
export function createDualStackVPC(name: string) {
  const vpc = new aws.ec2.Vpc(`${name}Vpc`, {
    cidrBlock: '10.0.0.0/16',
    enableDnsSupport: true,
    enableDnsHostnames: true,
    assignGeneratedIpv6CidrBlock: true,
    tags: {
      Name: `${$app.name}-${$app.stage}-${name} VPC`,
    },
  });

  const internetGateway = new aws.ec2.InternetGateway(
    `${name}IGW`,
    {
      vpcId: vpc.id,
      tags: {
        Name: `${$app.name}-${$app.stage}-${name} VPC`,
      },
    },

    { parent: vpc },
  );

  const egressOnlyInternetGateway = new aws.ec2.EgressOnlyInternetGateway(
    `${name}EIGW`,
    {
      vpcId: vpc.id,
    },

    { parent: vpc },
  );

  const securityGroup = new aws.ec2.DefaultSecurityGroup(
    `${name}SecurityGroup`,
    {
      vpcId: vpc.id,
      egress: [
        {
          fromPort: 0,
          toPort: 0,
          protocol: '-1',
          cidrBlocks: ['0.0.0.0/0'],
        },
        {
          fromPort: 0,
          toPort: 0,
          protocol: '-1',
          ipv6CidrBlocks: ['::/0'],
        },
      ],
      ingress: [
        {
          fromPort: 0,
          toPort: 0,
          protocol: '-1',
          // Restricts inbound traffic to only within the VPC
          cidrBlocks: [vpc.cidrBlock],
        },
      ],
    },
    { parent: vpc },
  );

  const zones = $util
    .all([
      aws.getAvailabilityZonesOutput(
        {
          state: 'available',
        },
        { parent: vpc },
      ),
      2,
    ])
    .apply(([zones, az]) =>
      Array(az)
        .fill(0)
        .map((_, i) => zones.names[i]),
    );

  const publicZones = zones.apply(zones =>
    zones.map((zone, i) => {
      // Use native because otherwise pulumi gets messed up https://github.com/pulumi/pulumi-aws/issues/2570
      const subnet = new awsnative.ec2.Subnet(
        `${name}PublicSubnet${i + 1}`,
        {
          vpcId: vpc.id,
          cidrBlock: `10.0.${8 * i}.0/22`,
          availabilityZone: zone,
          mapPublicIpOnLaunch: true,
          assignIpv6AddressOnCreation: true,
          ipv6CidrBlock: getIpv6SubnetRange(vpc.ipv6CidrBlock, i, false),
        },
        { parent: vpc },
      );

      const routeTable = new aws.ec2.RouteTable(
        `${name}PublicRouteTable${i + 1}`,
        {
          vpcId: vpc.id,
          routes: [
            {
              cidrBlock: '0.0.0.0/0',
              gatewayId: internetGateway.id,
            },
            {
              ipv6CidrBlock: '::/0',
              egressOnlyGatewayId: $util.output(egressOnlyInternetGateway.id),
            },
          ],
        },
        { parent: vpc },
      );

      new aws.ec2.RouteTableAssociation(
        `${name}PublicRouteTableAssociation${i + 1}`,
        {
          subnetId: subnet.id,
          routeTableId: routeTable.id,
        },
        { parent: vpc },
      );

      return { subnet, routeTable };
    }),
  );

  const privateZones = zones.apply(zones =>
    zones.map((zone, i) => {
      const subnet = new awsnative.ec2.Subnet(
        `${name}PrivateSubnet${i + 1}`,
        {
          vpcId: vpc.id,
          cidrBlock: `10.0.${8 * i + 4}.0/22`,
          availabilityZone: zone,
          assignIpv6AddressOnCreation: true,
          ipv6CidrBlock: getIpv6SubnetRange(vpc.ipv6CidrBlock, i, true),
        },
        { parent: vpc },
      );

      const routeTable = new aws.ec2.RouteTable(
        `${name}PrivateRouteTable${i + 1}`,
        {
          vpcId: vpc.id,
          routes: [
            {
              ipv6CidrBlock: '::/0',
              egressOnlyGatewayId: $util.output(egressOnlyInternetGateway.id),
            },
          ],
        },
        { parent: vpc },
      );

      new aws.ec2.RouteTableAssociation(
        `${name}PrivateRouteTableAssociation${i + 1}`,
        {
          subnetId: subnet.id,
          routeTableId: routeTable.id,
        },
        { parent: vpc },
      );

      return { subnet, routeTable };
    }),
  );

  return {
    vpc,
    internetGateway,
    egressOnlyInternetGateway,
    securityGroup,
    publicSubnets: publicZones.apply(zones => zones.map(zone => zone.subnet)),
    publicRouteTables: publicZones.apply(zones =>
      zones.map(zone => zone.routeTable),
    ),
    privateSubnets: privateZones.apply(zones => zones.map(zone => zone.subnet)),
    privateRouteTables: privateZones.apply(zones =>
      zones.map(zone => zone.routeTable),
    ),
  };
}

function getIpv6SubnetRange(
  vpcIPv6Range: $util.Output<string>,
  subnetNumber: number,
  fromStart: boolean,
): $util.Output<string> {
  return vpcIPv6Range.apply(vpcRange => {
    if (vpcRange.split('/')[1] !== '56') {
      throw new Error('The provided CIDR block is a /56 range.');
    }

    const base = ipv6ToBigInt(vpcRange.split('/')[0]);

    // A /64 subnet increments the address by 2^(128-64) = 2^64
    const subnetSize = 1n << 64n;

    const subnetBase =
      base +
      BigInt(fromStart ? subnetNumber : 256 - subnetNumber - 1) * subnetSize;

    return `${bigIntToIpv6(subnetBase)}/64`;
  });
}

/**
 * Uses bitshifting to convert an ipv6 address into a big int
 * @param ip the ipv6 address to convert
 */
function ipv6ToBigInt(ip: string): bigint {
  // Expand ::
  const parts = ip.split('::');
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];

  if (parts.length > 2) {
    throw new Error('Invalid IPv6 address');
  }

  const missing = 8 - (left.length + right.length);
  const full = [...left, ...Array(missing).fill('0'), ...right];

  if (full.length !== 8) {
    throw new Error('Invalid IPv6 address');
  }

  return full.reduce((acc, part) => {
    const value = BigInt(parseInt(part || '0', 16));
    return (acc << 16n) + value;
  }, 0n);
}

/**
 * Uses bit-shifting to convert a big int back into ipv6
 * @param value the bigint to convert to ipv6
 */
function bigIntToIpv6(value: bigint): string {
  const parts: string[] = [];

  for (let i = 0; i < 8; i++) {
    parts.unshift(((value >> BigInt(i * 16)) & 0xffffn).toString(16));
  }

  return compressIpv6(parts.join(':'));
}

/**
 * Best-effort guess at compressing an IPv6 address
 * @param ip the Ipv6 address to compress
 */
function compressIpv6(ip: string): string {
  // Minimal IPv6 zero-compression (best-effort)
  return ip.replace(/\b:?(?:0+:){2,}/, '::').replace(/^0::/, '::');
}
