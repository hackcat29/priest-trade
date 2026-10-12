# API Overview

Priest.trade exposes a high-performance REST API running on Cloudflare Edge and dedicated backend clusters for programmatic traders, aggregators, and data indexing.

---

## 1. Base URL

```
Production: https://api.priest.trade/api/v1
```

All requests must use HTTPS. Responses are formatted in JSON.

---

## 2. Public Endpoints

### Markets

#### `GET /markets`
Returns summary statistics for all live markets on Priest.trade.

**Query Parameters:**
- `status` (optional): Filter by status (`Warmup`, `Active`, `Graduated`, `Delisted`).
- `limit` (optional): Results per page (default: 50, max: 200).

**Sample Response:**
```json
{
  "success": true,
  "data": [
    {
      "token": "0x1234567890abcdef1234567890abcdef12345678",
      "name": "Monad Cathedral",
      "symbol": "CATH",
      "status": "Active",
      "markPriceE6": "1250000",
      "indexPriceE6": "1248000",
      "volume24hUsdc": "145200000000",
      "maxLeverage": 40,
      "fundingRateHourlyBps": 12,
      "tradeable": true
    }
  ]
}
```

#### `GET /markets/:token`
Fetch detailed parameters and graduation gate status for a specific token.

#### `GET /markets/:token/candles`
Fetch historical candlestick data for charts and analysis.

**Query Parameters:**
- `resolution`: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`.
- `from`: UNIX timestamp in seconds.
- `to`: UNIX timestamp in seconds.

---

## 3. Account Endpoints (Authenticated)

Endpoints requiring authentication accept a Privy JWT in the `Authorization` header:

```
Authorization: Bearer <PRIVY_AUTH_TOKEN>
```

#### `GET /portfolio`
Returns all open positions, active orders, and margin metrics for the authenticated wallet.

#### `GET /rewards/epoch`
Fetch points, referral earnings, and leaderboard position for the authenticated user.

---

## 4. Rate Limits

- **Public Endpoints:** 60 requests per minute per IP address.
- **WebSocket Subscriptions:** Up to 10 concurrent connections per IP.
