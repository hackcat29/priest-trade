# Glossary

Simple explanations of the terms used on Priest.trade.

---

### **cfUSDC**
The token you receive when you deposit USDC into the Counterflow Vault. Its value grows over time as the vault earns trading fees and market surplus.

### **Counterflow Vault**
The liquidity vault where users deposit USDC to back graduated markets on Priest.trade.

### **Dead Address**
`0x000000000000000000000000000000000000dEaD`. An unspendable burn address. When a coin graduates, its Uniswap v4 liquidity NFT is sent here so nobody can ever withdraw the liquidity.

### **Dual-Price Check**
A safety rule where your position is only liquidated if your margin ratio is breached at both the mark price AND the smoothed index price, protecting you from sudden flash wicks.

### **Entry Price**
The average price where your trade was filled.

### **Funding Rate**
Regular payments between longs and shorts that keep perpetual contract prices in line with the real spot price.

### **Graduation**
When a coin clears 5 volume and resilience gates and moves from the virtual curve into a real Uniswap v4 spot pool with locked LP.

### **Initial Margin**
The collateral needed to open a trade. At 40x leverage, you put down 2.5% of the position value.

### **Leverage**
How much larger your trade is compared to your collateral. $100 collateral at 10x leverage gives you a $1,000 position.

### **Maintenance Margin**
The minimum equity you must hold to keep your trade open (1.25% at 40x). If you fall below this, you get liquidated.

### **Mark Price**
The current live execution price of the perpetual contract.

### **Monad**
The high-speed EVM blockchain Priest.trade is built on, featuring 1-second blocks and sub-cent gas fees.

### **MON**
The native gas token of Monad used to pay transaction fees.

### **Notional Size**
The total dollar value of your trade (Collateral $\times$ Leverage).

### **Secondary Engine**
The perpetual trading engine used after graduation, which prices contracts off real Uniswap spot pools.

### **Slippage**
The difference between the estimated price you saw when submitting an order and the actual price where it filled.

### **Take Profit (TP) / Stop Loss (SL)**
Automatic triggers stored on-chain that close your position when the market hits your target price.

### **vAMM (Virtual AMM)**
An automated pricing curve where reserves are virtual, letting users trade perpetuals from block zero without needing upfront seed liquidity.

### **Vault Headroom**
The free money in a market vault above reserved insurance and fees. Collateral can only be withdrawn from available headroom.

### **Warmup Window**
The first 24 hours of a new coin's life, where leverage is capped at 10x to prevent instant 40x liquidations while the market finds its price.

### **Worst-Of Pricing**
A secondary market rule where buyers fill at the higher of spot and oracle, and sellers fill at the lower. Stops traders from gaming small price lags.
