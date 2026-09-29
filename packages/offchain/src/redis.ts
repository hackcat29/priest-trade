import Redis from 'ioredis';

export function createRedisClient(url: string, connectionName: string): Redis {
  return new Redis(url, {
    connectionName,
    lazyConnect: false,
    enableAutoPipelining: true,
    maxRetriesPerRequest: null,
  });
}

export async function publishJson(
  redis: Redis,
  channel: string,
  payload: Record<string, unknown>,
): Promise<number> {
  return redis.publish(channel, JSON.stringify(payload));
}

export async function acquireLock(
  redis: Redis,
  key: string,
  owner: string,
  ttlMs: number,
): Promise<boolean> {
  const result = await redis.set(key, owner, 'PX', ttlMs, 'NX');
  return result === 'OK';
}

export async function releaseLock(redis: Redis, key: string, owner: string): Promise<void> {
  const current = await redis.get(key);

  if (current === owner) {
    await redis.del(key);
  }
}

export const redisChannels = {
  discoveryNewLaunch: 'discovery:new_launch',
  discoveryGraduation: 'discovery:graduation',
  discoveryTrending: 'discovery:trending_update',
  discoveryMostLiquidated: 'discovery:most_liquidated_update',
  rewardsLeaderboard: 'rewards:leaderboard_update',
  marketPrice: (mint: string) => `market:${mint}:price_update`,
  marketOi: (mint: string) => `market:${mint}:oi_update`,
  marketFunding: (mint: string) => `market:${mint}:funding_update`,
  marketTrade: (mint: string) => `market:${mint}:trade`,
  marketOrderBook: (mint: string) => `market:${mint}:orderbook_update`,
  marketLiquidation: (mint: string) => `market:${mint}:liquidation`,
  marketSocial: (mint: string) => `market:${mint}:social_event`,
  marketCandle: (mint: string) => `market:${mint}:candle_update`,
  marketChat: (mint: string) => `market:${mint}:chat_message`,
  marketPoll: (mint: string) => `market:${mint}:poll_update`,
  marketSystem: (mint: string) => `market:${mint}:system_message`,
  marketCopyTrade: (mint: string) => `market:${mint}:copy_trade_update`,
  marketRoomPresence: (mint: string) => `market:${mint}:room_presence`,
  marketSpotlight: (mint: string) => `market:${mint}:spotlight_update`,
  secondaryMarket: (mint: string) => `market:${mint}:secondary_update`,
  portfolioPosition: (wallet: string) => `portfolio:${wallet}:position_update`,
  portfolioPnl: (wallet: string) => `portfolio:${wallet}:pnl_update`,
  portfolioMarginHealth: (wallet: string) => `portfolio:${wallet}:margin_health`,
  portfolioWarning: (wallet: string) => `portfolio:${wallet}:liquidation_warning`,
  portfolioFundingPayment: (wallet: string) => `portfolio:${wallet}:funding_payment`,
  portfolioCopyTrade: (wallet: string) => `portfolio:${wallet}:copy_trade`,
  // Rides the portfolio room — the API's websocket forwards portfolio:* as-is.
  userNotification: (wallet: string) => `portfolio:${wallet}:notification`,
  rewardsPoints: (wallet: string) => `rewards:${wallet}:points_update`,
  rewardsReferralTrade: (wallet: string) => `rewards:${wallet}:referral_trade`,
  rewardsEpochSnapshot: (wallet: string) => `rewards:${wallet}:epoch_snapshot`,
} as const;
