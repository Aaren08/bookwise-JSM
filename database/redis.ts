import config from "@/lib/config";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: config.env.upstash.redisUrl,
  token: config.env.upstash.restToken,
});

export default redis;
