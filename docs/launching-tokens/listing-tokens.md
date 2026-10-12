# Permissionless Listings

On Priest.trade, you can open a perpetuals market on **any existing token on Monad**, even if it was not launched through our platform.

---

## 1. What are Permissionless Listings?

Through the `listMarket()` function on `PerpesEngine.sol`, any user can register an existing ERC-20 token as an oracle-priced perpetual market.

Unlike new launches (which begin on the vAMM), listed tokens launch directly onto the **Secondary Rail**:
- Trades against an on-chain oracle derived from the token's existing Uniswap pool.
- Uses worst-of execution pricing and depth-based open interest caps.
- The person who submits the listing transaction becomes registered as the **Creator/Lister**, earning the creator fee share from all perp volume!

---

## 2. Listing Requirements

To be eligible for listing, the token must satisfy four strict on-chain conditions:

1. **Eligible Spot Pool:**
   - **Uniswap v3 Pool:** Deployed from the canonical Monad Uniswap v3 factory, quoted against **USDC** or **WMON**.
   - **Uniswap v4 Pool:** Hookless v4 pool deployed from the canonical Monad PoolManager.
2. **Minimum Liquidity Depth:**
   - The spot pool must contain at least **$25,000 in quote-side liquidity** (`minDepthUsdc`).
   - For Uniswap v3 pools, this depth is strictly validated against the pool's real token reserves to prevent virtual concentrated liquidity inflation.
3. **Oracle History (for v3):**
   - The Uniswap v3 pool must have accumulated enough observation history to serve a rolling 5-minute TWAP.
4. **Valid Token Standard:**
   - Must be a valid ERC-20 contract with between 1 and 30 decimals (standard is 18).

---

## 3. How to List an Existing Token

1. Navigate to the **List Token** page on [priest.trade](https://priest.trade).
2. Enter the **ERC-20 Token Address** on Monad.
3. The interface will automatically scan for qualifying Uniswap v3 and v4 pools.
4. Select your preferred spot pool (USDC or WMON pair).
5. Review the detected spot price, pool depth, and initial leverage parameters.
6. Click **List Market** and sign the transaction (including any applicable listing fee).
7. Once confirmed:
   - The market enters a short 10-minute oracle settlement warmup.
   - You begin earning creator fee shares on all subsequent trading volume!
