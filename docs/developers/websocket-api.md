# WebSocket Streams

For real-time price feeds, order book depth, and instant trade execution updates, Priest.trade provides persistent WebSocket streaming.

---

## 1. Connection Endpoint

```
wss://api.priest.trade/ws
```

---

## 2. Subscription Protocol

Clients subscribe to topics by sending JSON messages over the connection:

```json
{
  "op": "subscribe",
  "channel": "trades",
  "token": "0x1234567890abcdef1234567890abcdef12345678"
}
```

To unsubscribe:
```json
{
  "op": "unsubscribe",
  "channel": "trades",
  "token": "0x1234567890abcdef1234567890abcdef12345678"
}
```

---

## 3. Available Channels

### `trades` Channel
Broadcasts individual executed fills (opens, closes, liquidations).

**Message Payload:**
```json
{
  "channel": "trades",
  "token": "0x1234...5678",
  "data": {
    "trader": "0xabcd...ef01",
    "side": "LONG",
    "sizeUsdc": 500.00,
    "priceE6": 1250000,
    "feeUsdc": 0.50,
    "txHash": "0x9876...5432",
    "timestamp": 1728567890
  }
}
```

### `ticker` Channel
Emits real-time mark price, 24h volume, funding rates, and open interest on every block.

### `candles` Channel
Emits real-time candlestick bars for live charting updates.

---

## 4. Heartbeats (Ping / Pong)

To prevent connection drops through network proxies:
- Clients should send `{"op": "ping"}` every 30 seconds.
- The server will respond with `{"op": "pong"}`.
