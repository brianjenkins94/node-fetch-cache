import { Buffer } from 'buffer';
import { Readable } from 'stream';
import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import type { INodeFetchCacheCache, NFCResponseMetadata } from 'node-fetch-cache';

type StoredMetadata = {
  expiration?: number | undefined;
} & NFCResponseMetadata;

type ExtendedRedisOptions = {
  ttl?: number | undefined;
} & RedisOptions;

// Redis Connection Parameters
// add host, port or path as options to set database.
// additionally, set `ttl` for a default expiry
// Leave host, port or path undefined for localhost:6379

export class RedisCache implements INodeFetchCacheCache {
  private readonly ttl?: number | undefined;
  private readonly redis: Redis;
  private readonly redisOptions: RedisOptions = {};

  constructor(options: ExtendedRedisOptions = {}, redisInstance?: Redis) {
    this.redisOptions = options ?? {};
    this.ttl = options?.ttl;
    this.redis = redisInstance ?? new Redis(this.redisOptions);
  }

  async get(key: string) {
    const [cachedObjectInfo, storedMetadata] = await Promise.all([
      this.redis.getBuffer(key),
      this.redis.get(`${key}:meta`),
    ]);

    if (cachedObjectInfo === null || !storedMetadata) {
      return undefined;
    }

    const readableStream = Readable.from(cachedObjectInfo);
    const storedMetadataJson = JSON.parse(storedMetadata) as StoredMetadata;
    const nfcMetadata = storedMetadataJson;

    return {
      bodyStream: readableStream,
      metaData: nfcMetadata,
    };
  }

  async remove(key: string) {
    await Promise.all([
      this.redis.del(key),
      this.redis.del(`${key}:meta`),
    ]);

    return true;
  }

  async set(key: string, bodyStream: NodeJS.ReadableStream, metaData: NFCResponseMetadata) {
    const buffer: Buffer = await new Promise((fulfill, reject) => {
      const chunks: Buffer[] = [];

      bodyStream.on('data', chunk => {
        chunks.push(chunk as Buffer);
      });

      bodyStream.on('end', async () => {
        try {
          fulfill(Buffer.concat(chunks));
        } catch (error) {
          reject(error);
        }
      });

      bodyStream.on('error', error => {
        reject(error);
      });
    });

    if (typeof this.ttl === 'number') {
      await Promise.all([
        this.redis.set(key, buffer, 'PX', this.ttl),
        this.redis.set(`${key}:meta`, JSON.stringify(metaData), 'PX', this.ttl),
      ]);
    } else {
      await Promise.all([
        this.redis.set(key, buffer),
        this.redis.set(`${key}:meta`, JSON.stringify(metaData)),
      ]);
    }

    return {
      bodyStream: Readable.from(buffer),
      metaData,
    };
  }
}
