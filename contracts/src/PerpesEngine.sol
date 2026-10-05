// SPDX-License-Identifier: MIT
// Snapshot of the v3 engine (68d5a99) as deployed on Monad testnet and mainnet — the upgrade tests start from it.
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {PerpesMath} from "../../src/PerpesMath.sol";
import {IUniswapV3FactoryLike, IUniswapV3PoolLike, PerpesOracle} from "../../src/PerpesOracle.sol";
import {PerpesSecondaryMath} from "../../src/PerpesSecondaryMath.sol";
import {PerpesToken} from "../../src/PerpesToken.sol";
import {PerpesUniswap} from "../../src/PerpesUniswap.sol";

/// The Counterflow vault, as the engine sees it.
interface ICounterflowV1 {
    function cover(address market, uint256 amount) external returns (uint256 paid);
    function onIncome(address market, uint256 amount, uint256 repaid) external;
}

/// @title PerpesEngine
/// @notice EVM (Monad) port of the Perpes Solana program's primary engine: a
/// permissionless perpetuals launchpad. Anyone can launch a token; every launch
/// gets a perps market priced by a constant-product virtual AMM, with funding,
/// an EWMA index, liquidations, on-chain TP/SL and resting limit orders.
///
/// One contract holds every market (the Solana program is likewise one program
/// with one PDA per market). Each market's USDC is accounted separately in
/// `Market.vaultBalanceUsdc` — the equivalent of the per-market vault token
/// account on Solana — so one market's traders can never be paid from another's.
///
/// Graduation: a protocol-approved market moves to the secondary engine. The
/// engine seeds a token/USDC Uniswap v4 pool at the market's price with
/// full-range liquidity whose position NFT is minted to the burn address, burns
/// the rest of the token supply, and from then on prices the perp off the
/// pool's TWAP (pushed by an operator, sanity-checked against the live pool)
/// plus a premium that grows with open-interest skew — the Solana program's
/// secondary engine. Not ported: the CLOB and copy vaults.
///
/// Listing: anyone can open an oracle-priced market on an existing token that
/// has a deep enough Uniswap v3 or v4 pool against USDC or MON.
///
/// Oracle: read on-chain from the market's pool — the v3 pool's own TWAP, or
/// an engine-kept EMA of a v4 pool — with fills at the worse of oracle and
/// live pool price, so neither a lagging oracle nor a moved pool can be farmed.
///
/// Counterflow: an LP vault (see CounterflowVault) backs selected oracle
/// markets — it pays their winners in full when the market's own vault can't,
/// and earns a share of their fees plus what their traders lose.
contract PerpesEngineV3 is
    Initializable,
    UUPSUpgradeable,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable,
    IUnlockCallback
{
    using SafeERC20 for IERC20;

    // ── Types ──────────────────────────────────────────────────────────────────

    enum Side {
        Long,
        Short
    }

    enum MarketStatus {
        None,
        Warmup,
        Active,
        Graduated,
        Delisted
    }

    enum OrderType {
        Limit,
        StopMarket,
        StopLimit,
        TakeProfit,
        ImmediateOrCancel,
        FillOrKill
    }

    enum OrderStatus {
        None,
        Open,
        PartiallyFilled,
        Filled,
        Cancelled
    }

    struct Config {
        address protocolFeeWallet;
        address insuranceFundWallet;
        address treasury;
        uint256 launchFeeWei;
        bool launchPaused;
        uint16 takerFeeBps;
        int64 fundingVelocityBps;
        int64 fundingRateCapBps;
        uint64 fundingIntervalSeconds;
        uint8 flatMaxLeverageX;
        uint8 warmupMaxLeverageX;
        uint64 warmupSeconds;
        uint256 defaultLiquidityDepthUsdc;
        uint256 initialPriceE6;
        uint16 creatorFeeBps;
        uint16 creatorFeeBpsUnqualified;
        uint256 creatorFeeVolumeThresholdUsdc;
        uint64 creatorFeeWindowSeconds;
        uint16 insuranceFeeBpsStatic;
        uint16 liquidationRewardBps;
        uint16 liquidationPenaltyBps;
        uint64 referenceUpdateIntervalSeconds;
        uint32 maxActiveOrdersPerWallet;
        uint256 tickSizeE6;
        uint16 maxOiMultiple;
        uint256 fundingOiFloorUsdc;
    }

    struct Market {
        address creator;
        MarketStatus status;
        bool creatorFeeTierUnlocked;
        uint8 flatMaxLeverageX;
        uint8 warmupMaxLeverageX;
        uint8 maxLeverageX;
        uint16 maintenanceMarginBps;
        uint16 takerFeeBps;
        uint16 hRatioBps;
        uint16 creatorFeeBps;
        uint16 creatorFeeBpsUnqualified;
        uint16 insuranceFeeBpsStatic;
        uint16 liquidationRewardBps;
        uint16 liquidationPenaltyBps;
        uint16 maxOiMultiple;
        uint32 maxActiveOrdersPerWallet;
        int64 premiumTwapBps;
        int64 fundingVelocityBps;
        int64 fundingRateCapBps;
        uint64 fundingIntervalSeconds;
        uint64 referenceUpdateIntervalSeconds;
        uint64 creatorFeeWindowSeconds;
        uint64 createdAt;
        uint64 warmupUntil;
        uint64 lastAccumulatorTs;
        uint256 creatorFeeVolumeThresholdUsdc;
        uint256 fundingOiFloorUsdc;
        uint256 tickSizeE6;
        uint256 liquidityDepthUsdc;
        uint256 indexPriceE6;
        uint256 markPriceE6;
        uint256 vammQuoteReserve;
        uint256 vammBaseReserve;
        uint256 vammK;
        uint256 oiLongUsdc;
        uint256 oiShortUsdc;
        uint256 baseLong;
        uint256 baseShort;
        int256 fundingIndexE9;
        uint256 totalVolumeUsdc;
        uint256 totalFeesCollectedUsdc;
        uint256 insuranceTrancheUsdc;
        uint256 creatorFeesPendingUsdc;
        uint256 protocolFeesPendingUsdc;
        uint256 collateralPoolUsdc;
        uint256 badDebtUsdc;
        uint256 unsettledProfitTotalUsdc;
        // USDC this market actually holds (collateral, fees, insurance).
        uint256 vaultBalanceUsdc;
        // Collateral locked in resting limit orders — held apart from the vault
        // so it can never back another trader's payout.
        uint256 orderEscrowUsdc;
        // ── Counterflow (appended) ──
        // Counterflow's fee share, reserved here until syncCounterflow sweeps it.
        uint256 counterflowPendingUsdc;
        // Covered by Counterflow and not yet repaid.
        uint256 counterflowDrawnUsdc;
    }

    struct Position {
        Side side;
        bool reduceOnly;
        bool pendingLiquidation;
        uint64 lastUpdateTs;
        uint64 tradeCount;
        uint256 sizeUsdc;
        uint256 baseAmount;
        uint256 collateralUsdc;
        uint256 entryPriceE6;
        int256 lastFundingIndexE9;
        uint256 unsettledProfitUsdc;
        uint256 tpPriceE6;
        uint256 slPriceE6;
    }

    struct LimitOrder {
        address trader;
        address market;
        Side side;
        OrderType orderType;
        OrderStatus status;
        bool postOnly;
        uint8 leverage;
        uint64 createdAt;
        uint64 expiresAt;
        uint256 collateralUsdc;
        uint256 limitPriceE6;
        uint256 stopPriceE6;
        uint256 initialNotionalUsdc;
        uint256 remainingNotionalUsdc;
        uint256 filledNotionalUsdc;
    }

    struct LaunchParams {
        string name;
        string symbol;
        string uri;
        string imageUrl;
        string description;
        string twitter;
        string telegram;
        string website;
        bool cashbackEnabled;
        bytes32 salt;
    }

    struct Fill {
        uint256 base;
        uint256 quote;
        uint256 priceE6;
    }

    /// The closed slice of a position, for `_settleClose`.
    struct CloseSlice {
        address token;
        address owner;
        Side side;
        uint256 costBasis;
        uint256 released;
        // Carried (unpaid) funding owed by the closed slice; comes out of its proceeds.
        uint256 fundingDebt;
    }

    /// Graduation thresholds and secondary-engine risk parameters (defaults
    /// mirror programs/perpes/src/state/secondary.rs). Snapshotted onto a
    /// market when its graduation is approved.
    struct SecondaryConfig {
        // Eligibility
        uint64 minAgeSeconds;
        uint32 minUniqueTraders;
        uint16 maxVaultStressBps;
        uint256 minVolumeUsdc;
        uint256 minPeakOiUsdc;
        // Oracle
        uint64 transitionSeconds;
        uint64 velocityWindowSeconds;
        uint64 maxPriceStalenessSeconds;
        uint64 maxLiquidityStalenessSeconds;
        uint16 maxOracleSpotDeviationBps;
        uint16 velocityCircuitBps;
        // Risk
        uint16 virtualLiqMultiplier;
        uint16 maxOiMultiplier;
        uint256 minVirtualLiquidityUsdc;
        uint8 initialMaxLeverageX;
        uint8 maxLeverageCapX;
        uint8 leverageStepPer24h;
        uint16 maxExecutionImpactBps;
        uint16 maxMarkDeviationBps;
        uint16 minSpreadBps;
        uint16 maxPositionShareBps;
        int64 fundingVelocityBps;
        int64 fundingRateCapBps;
        uint64 fundingIntervalSeconds;
        // Uniswap v4 pool
        uint24 poolFee;
        int24 tickSpacing;
    }

    /// A market's graduation and secondary-engine state.
    struct Secondary {
        bool approved;
        bool adminOverride;
        bool active;
        bool velocityTripped;
        uint64 approvedAt;
        uint64 graduatedAt;
        uint64 lastOracleTs;
        uint64 lastLiquidityTs;
        uint64 velocityWindowTs;
        // Price the pool was seeded at; blended out over the transition window.
        uint256 syntheticSnapshotE6;
        // Latest pool TWAP pushed by an operator.
        uint256 spotTwapE6;
        // The market's oracle: synthetic → spot blend.
        uint256 oracleE6;
        uint256 velocityWindowPriceE6;
        uint256 spotLiquidityUsdc;
        uint256 skewScaleUsdc;
        uint256 maxOiUsdc;
        uint256 seedUsdc;
        uint256 seedTokens;
        uint256 lpTokenId;
        uint128 lpLiquidity;
        bytes32 poolId;
        SecondaryConfig cfg;
        // ── v3 layout (appended) ──
        SourceKind sourceKind;
        // Opened by listMarket on an existing token (not by graduation).
        bool listed;
        // Counterflow pays this market's winners in full and earns its surplus.
        bool backed;
        // The pool's other side: false = USDC, true = WMON (priced via the MON/USD pool).
        bool quoteIsWmon;
        // Token decimals (0 = 18, i.e. a Perpes launch).
        uint8 baseDecimals;
        // Listed v4 pool shape (graduation pools use cfg.poolFee / cfg.tickSpacing).
        uint24 v4Fee;
        int24 v4TickSpacing;
        address v3Pool;
        // Live pool price at the last read — fills use the worse of this and the oracle.
        uint256 lastSpotE6;
        // Delisted: exits only (an oracle market's status can't change).
        bool closeOnly;
    }

    /// Where an oracle market's price comes from.
    enum SourceKind {
        // Uniswap v4 pool (engine-kept EMA)
        V4,
        // Uniswap v3 pool (the pool's own TWAP)
        V3
    }

    /// On-chain oracle settings (v3 layout).
    struct OracleConfig {
        // Uniswap v3 factory listings must come from (0 = no v3 listings).
        address v3Factory;
        // WMON, and the v3 WMON/USDC pool MON-quoted markets are priced through.
        address wmon;
        address monUsdPool;
        // v3 TWAP window.
        uint32 twapWindowSeconds;
        // v4 EMA: time constant, longest gap one sample may count for, and the
        // band (around the EMA) a sample is clamped to.
        uint32 emaTauSeconds;
        uint32 maxSampleGapSeconds;
        uint16 maxSampleDeviationBps;
    }

    /// Permissionless listing of existing tokens (v3 layout).
    struct ListingConfig {
        bool enabled;
        uint8 maxLeverageX;
        uint32 warmupSeconds;
        uint256 listingFeeWei;
        // Minimum USDC-equivalent depth of the pool's quote side.
        uint256 minDepthUsdc;
    }

    /// Counterflow wiring (v3 layout).
    struct CounterflowConfig {
        address vault;
        // Share of every fee on a backed market that goes to Counterflow
        // (carved out of the protocol's cut).
        uint16 feeShareBps;
        // OI cap and skew scale multiplier (× pool depth) on a backed market.
        uint16 backedOiMultiplier;
        // Collateral share kept in a backed market before its surplus is swept.
        uint16 surplusBufferBps;
        // Newly graduated markets are backed automatically.
        bool autoBackGraduated;
    }

    struct ListingParams {
        SourceKind kind;
        address v3Pool;
        uint24 v4Fee;
        int24 v4TickSpacing;
        bool quoteIsWmon;
    }

    /// On-chain graduation metrics, tracked from the first trade.
    struct MarketStats {
        uint32 uniqueTraders;
        uint256 peakOiUsdc;
    }

    struct Eligibility {
        uint256 ageSeconds;
        uint256 volumeUsdc;
        uint32 uniqueTraders;
        uint256 peakOiUsdc;
        uint256 vaultStressBps;
        bool allMet;
    }

    struct UniswapV4 {
        address poolManager;
        address positionManager;
        address permit2;
    }

    /// What `graduate` put into the pool.
    struct Seeded {
        bytes32 poolId;
        uint256 lpTokenId;
        uint128 liquidity;
        uint256 usdcInPool;
        uint256 tokensInPool;
    }

    /// An existing pool may sit this far (bps) from the market price; further
    /// and `graduate` swaps it into line first.
    uint256 internal constant POOL_PRICE_TOLERANCE_BPS = 50;

    // ── Storage ────────────────────────────────────────────────────────────────

    IERC20 public usdc;
    Config internal _config;
    mapping(address token => Market) internal _markets;
    mapping(address token => mapping(address owner => Position)) internal _positions;
    mapping(uint256 orderId => LimitOrder) internal _orders;
    mapping(address trader => mapping(address token => uint32)) public activeOrderCount;
    mapping(address creator => uint32) public creatorLaunchCount;
    address[] public allMarkets;
    uint256 public nextOrderId;
    /// Emergency stop for new risk (opens, limit placement and fills). Closes,
    /// collateral, TP/SL, liquidations and claims keep working. Appended after
    /// the v1 layout — new state goes below this line.
    bool public tradingPaused;
    /// Graduation (appended in the v2 layout — new state goes below this line).
    SecondaryConfig internal _secondaryConfig;
    mapping(address token => Secondary) internal _secondary;
    mapping(address token => MarketStats) internal _stats;
    /// May push secondary oracle/liquidity and execute approved graduations.
    mapping(address account => bool) public isOperator;
    UniswapV4 public uniswap;
    /// True only while `graduate` is swapping a pre-existing pool into line.
    bool private transient _correctingPool;
    /// Listing, on-chain oracle and Counterflow (appended in the v3 layout).
    OracleConfig internal _oracleConfig;
    ListingConfig internal _listingConfig;
    CounterflowConfig internal _counterflowConfig;

    // ── Events ─────────────────────────────────────────────────────────────────

    event ConfigUpdated(address indexed authority, uint256 timestamp);
    event TradingPausedSet(bool paused, uint256 timestamp);
    event TokenLaunched(address indexed creator, address indexed token, LaunchParams params, uint256 timestamp);
    event MarketInitialized(address indexed market, address indexed creator, uint256 timestamp);
    event MarketDelisted(address indexed market, uint256 timestamp);
    event MarketPriceUpdated(
        address indexed market,
        uint256 indexPriceE6,
        uint256 markPriceE6,
        uint256 oiLongUsdc,
        uint256 oiShortUsdc,
        int256 fundingRateBps,
        uint256 totalVolumeUsdc,
        uint256 timestamp
    );
    event PositionOpened(
        address indexed owner,
        address indexed market,
        Side side,
        uint256 notionalUsdc,
        uint256 collateralUsdc,
        uint256 executionPriceE6,
        uint256 feeUsdc,
        uint256 timestamp
    );
    event PositionClosed(
        address indexed owner,
        address indexed market,
        Side side,
        uint256 notionalUsdc,
        uint256 executionPriceE6,
        uint256 payoutUsdc,
        uint256 feeUsdc,
        int256 realizedPnlUsdc,
        uint256 timestamp
    );
    event PositionLiquidated(
        address indexed owner,
        address indexed market,
        address indexed liquidator,
        Side side,
        uint256 sizeUsdc,
        uint256 liquidationPriceE6,
        uint256 rewardUsdc,
        uint256 timestamp
    );
    /// Authoritative position state after every change — the indexer mirrors it as-is.
    event PositionState(
        address indexed owner,
        address indexed market,
        Side side,
        uint256 sizeUsdc,
        uint256 baseAmount,
        uint256 collateralUsdc,
        uint256 entryPriceE6,
        uint256 tpPriceE6,
        uint256 slPriceE6,
        bool pendingLiquidation,
        uint256 unsettledProfitUsdc
    );
    event CollateralUpdated(address indexed owner, address indexed market, uint256 collateralUsdc, uint256 timestamp);
    event TradingFeeAccrued(
        address indexed market,
        address indexed trader,
        uint256 feeUsdc,
        uint256 creatorCutUsdc,
        uint256 insuranceCutUsdc,
        uint256 protocolCutUsdc,
        bool creatorTierUnlocked,
        uint256 timestamp
    );
    event PayoutHaircut(
        address indexed owner,
        address indexed market,
        uint256 grossPayoutUsdc,
        uint256 actualPayoutUsdc,
        uint256 shortfallUsdc,
        uint256 timestamp
    );
    event PayoutDeferred(
        address indexed owner, address indexed market, uint256 deferredUsdc, uint256 totalUnsettledUsdc, uint256 timestamp
    );
    event UnsettledProfitClaimed(
        address indexed owner, address indexed market, uint256 amountUsdc, uint256 remainingUsdc, uint256 timestamp
    );
    event BadDebtRecorded(
        address indexed market,
        uint256 shortfallUsdc,
        uint256 coveredByInsuranceUsdc,
        uint256 uncoveredUsdc,
        uint256 totalBadDebtUsdc,
        uint256 timestamp
    );
    event PositionTriggersUpdated(
        address indexed owner, address indexed market, uint256 tpPriceE6, uint256 slPriceE6, uint256 timestamp
    );
    event PositionTriggerExecuted(
        address indexed owner,
        address indexed market,
        Side side,
        bool takeProfit,
        uint256 triggerPriceE6,
        uint256 executionPriceE6,
        uint256 notionalUsdc,
        uint256 payoutUsdc,
        uint256 timestamp
    );
    event LimitOrderPlaced(
        uint256 indexed orderId,
        address indexed trader,
        address indexed market,
        Side side,
        OrderType orderType,
        uint256 limitPriceE6,
        uint256 stopPriceE6,
        uint256 initialNotionalUsdc,
        uint256 collateralUsdc,
        uint8 leverage,
        uint256 expiresAt,
        uint256 timestamp
    );
    event LimitOrderCancelled(
        uint256 indexed orderId, address indexed trader, address indexed market, uint256 refundUsdc, uint256 timestamp
    );
    event LimitOrderExecuted(
        uint256 indexed orderId,
        address indexed trader,
        address indexed market,
        uint256 executionPriceE6,
        uint256 filledNotionalUsdc,
        uint256 remainingNotionalUsdc,
        OrderStatus status,
        uint256 timestamp
    );
    event CreatorFeesClaimed(address indexed market, address indexed creator, uint256 amountUsdc, uint256 timestamp);
    event ProtocolFeesClaimed(address indexed market, address indexed wallet, uint256 amountUsdc, uint256 timestamp);
    event SecondaryConfigUpdated(address indexed authority, uint256 timestamp);
    event UniswapSet(address poolManager, address positionManager, address permit2);
    event OperatorSet(address indexed operator, bool enabled);
    event GraduationApproved(address indexed market, address indexed approvedBy, bool adminOverride, uint256 timestamp);
    event GraduationRevoked(address indexed market, uint256 timestamp);
    event PoolPriceCorrected(address indexed market, uint160 fromSqrtPriceX96, uint160 toSqrtPriceX96);
    event MarketGraduated(
        address indexed market,
        bytes32 indexed poolId,
        uint256 lpTokenId,
        uint128 liquidity,
        uint256 usdcInPool,
        uint256 tokensInPool,
        uint256 priceE6,
        uint256 timestamp
    );
    event SecondaryOracleUpdated(
        address indexed market,
        uint256 spotTwapE6,
        uint256 liveSpotE6,
        uint256 oracleE6,
        bool velocityTripped,
        uint256 timestamp
    );
    event MarketListed(
        address indexed market,
        address indexed lister,
        SourceKind kind,
        address v3Pool,
        uint24 v4Fee,
        int24 v4TickSpacing,
        bool quoteIsWmon,
        uint256 priceE6,
        uint256 depthUsdc,
        uint256 timestamp
    );
    event OracleConfigUpdated(address indexed authority, uint256 timestamp);
    event ListingConfigUpdated(address indexed authority, uint256 timestamp);
    event CounterflowConfigUpdated(address indexed vault, uint256 timestamp);
    event CounterflowBackingSet(address indexed market, bool backed, uint256 timestamp);
    event CounterflowDrawn(address indexed market, uint256 requested, uint256 paid, uint256 drawnTotal, uint256 timestamp);
    event CounterflowSynced(
        address indexed market, uint256 sentUsdc, uint256 repaidUsdc, uint256 feesUsdc, uint256 drawnTotal, uint256 timestamp
    );
    event SecondaryLiquidityUpdated(
        address indexed market, uint256 spotLiquidityUsdc, uint256 skewScaleUsdc, uint256 maxOiUsdc, uint256 timestamp
    );

    // ── Errors ─────────────────────────────────────────────────────────────────

    error Unauthorized();
    error ProtocolPaused();
    error InvalidConfig();
    error InvalidLaunchFee();
    error FeeTransferFailed();
    error NameTooLong();
    error SymbolTooLong();
    error MetadataTooLong();
    error MarketNotFound();
    error InvalidMarketStatus();
    error InvalidEngineTransition();
    error InsufficientCollateral();
    error InvalidCloseSize();
    error LeverageTooHigh();
    error PendingLiquidation();
    error PositionSideMismatch();
    error SlippageExceeded();
    error PrimaryOpenInterestCapExceeded();
    error WithdrawalBreachesMargin();
    error LiquidationNotAllowed();
    error NothingToClaim();
    error InvalidTrigger();
    error TriggerNotHit();
    error MinimumNotionalNotMet();
    error PostOnlyRejection();
    error OrderWalletLimitExceeded();
    error OrderNotOpen();
    error OrderExpired();
    error OrderTriggerNotMet();
    error FillOrKillNotFillable();
    error LimitPriceNotMet();
    error InvalidOrder();
    error TradingPaused();
    error InsufficientVaultHeadroom();
    error EligibilityNotMet();
    error SecondaryNotActive();
    error PriceDataStale();
    error LiquidityDataStale();
    error OpenInterestCapExceeded();
    error PositionLimitExceeded();
    error OracleDeviatesFromSpot();
    error PoolPriceMismatch();
    error ImmediateRoundtripProfit();
    error InvalidPrice();
    error UniswapNotConfigured();
    error ListingDisabled();
    error AlreadyListed();
    error InvalidListing();
    error InsufficientPoolDepth();
    error MarketWarmingUp();
    error NotOracleMarket();

    // ── Init / admin ───────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, IERC20 usdc_, Config calldata config_) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        usdc = usdc_;
        _setConfig(config_);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function setConfig(Config calldata config_) external onlyOwner {
        _setConfig(config_);
    }

    function _setConfig(Config calldata c) internal {
        if (
            c.protocolFeeWallet == address(0) || c.treasury == address(0)
                || uint256(c.creatorFeeBps) + c.insuranceFeeBpsStatic > 10_000
                || uint256(c.creatorFeeBpsUnqualified) + c.insuranceFeeBpsStatic > 10_000 || c.flatMaxLeverageX == 0
                || c.warmupMaxLeverageX == 0 || c.fundingIntervalSeconds == 0 || c.defaultLiquidityDepthUsdc == 0
                || c.initialPriceE6 == 0 || c.tickSizeE6 == 0 || c.takerFeeBps > 1_000
        ) revert InvalidConfig();
        _config = c;
        emit ConfigUpdated(msg.sender, block.timestamp);
    }

    modifier onlyOperator() {
        if (!isOperator[msg.sender] && msg.sender != owner()) revert Unauthorized();
        _;
    }

    /// One-time setup for the graduation upgrade (run via upgradeToAndCall).
    function initializeGraduation(SecondaryConfig calldata c, UniswapV4 calldata u, address operator)
        external
        reinitializer(2)
        onlyOwner
    {
        _setSecondaryConfig(c);
        _setUniswap(u);
        if (operator != address(0)) _setOperator(operator, true);
    }

    function setSecondaryConfig(SecondaryConfig calldata c) external onlyOwner {
        _setSecondaryConfig(c);
    }

    function setUniswap(UniswapV4 calldata u) external onlyOwner {
        _setUniswap(u);
    }

    /// One-time setup for listing, the on-chain oracle and Counterflow (run
    /// via upgradeToAndCall, or after initializeGraduation in the same batch).
    function initializeV3(OracleConfig calldata o, ListingConfig calldata l, CounterflowConfig calldata c)
        external
        reinitializer(3)
        onlyOwner
    {
        _setOracleConfig(o);
        _setListingConfig(l);
        _setCounterflowConfig(c);
    }

    function setOracleConfig(OracleConfig calldata o) external onlyOwner {
        _setOracleConfig(o);
    }

    function setListingConfig(ListingConfig calldata l) external onlyOwner {
        _setListingConfig(l);
    }

    function setCounterflowConfig(CounterflowConfig calldata c) external onlyOwner {
        _setCounterflowConfig(c);
    }

    function _setOracleConfig(OracleConfig calldata o) internal {
        if (
            o.twapWindowSeconds == 0 || o.emaTauSeconds == 0 || o.maxSampleGapSeconds == 0
                || o.maxSampleDeviationBps == 0 || o.maxSampleDeviationBps >= 10_000
                || (o.wmon == address(0)) != (o.monUsdPool == address(0))
        ) revert InvalidConfig();
        _oracleConfig = o;
        emit OracleConfigUpdated(msg.sender, block.timestamp);
    }

    function _setListingConfig(ListingConfig calldata l) internal {
        if (l.maxLeverageX == 0 || l.maxLeverageX > 100 || l.minDepthUsdc == 0) revert InvalidConfig();
        _listingConfig = l;
        emit ListingConfigUpdated(msg.sender, block.timestamp);
    }

    function _setCounterflowConfig(CounterflowConfig calldata c) internal {
        Config memory cfg = _config;
        uint256 maxCreator = cfg.creatorFeeBps > cfg.creatorFeeBpsUnqualified ? cfg.creatorFeeBps : cfg.creatorFeeBpsUnqualified;
        if (
            maxCreator + cfg.insuranceFeeBpsStatic + c.feeShareBps > 10_000 || c.backedOiMultiplier == 0
                || c.surplusBufferBps > 10_000
        ) revert InvalidConfig();
        _counterflowConfig = c;
        emit CounterflowConfigUpdated(c.vault, block.timestamp);
    }

    /// Turns Counterflow backing on or off for an oracle market. An operator
    /// may do it (no Safe round-trip per market); the vault's own per-market
    /// and total exposure caps bound what any one market can draw.
    function setCounterflowBacking(address token, bool backed) external onlyOperator {
        Secondary storage s = _secondary[token];
        if (!s.active) revert NotOracleMarket();
        if (backed && _counterflowConfig.vault == address(0)) revert InvalidConfig();
        s.backed = backed;
        _deriveFromLiquidity(s);
        emit CounterflowBackingSet(token, backed, block.timestamp);
    }

    function setOperator(address operator, bool enabled) external onlyOwner {
        _setOperator(operator, enabled);
    }

    function _setSecondaryConfig(SecondaryConfig calldata c) internal {
        _validateSecondaryConfig(c);
        _secondaryConfig = c;
        emit SecondaryConfigUpdated(msg.sender, block.timestamp);
    }

    function _validateSecondaryConfig(SecondaryConfig calldata c) internal pure {
        if (
            c.initialMaxLeverageX == 0 || c.maxLeverageCapX < c.initialMaxLeverageX || c.maxLeverageCapX > 100
                || c.fundingIntervalSeconds == 0 || uint256(c.maxExecutionImpactBps) + c.minSpreadBps >= 10_000
                || c.maxMarkDeviationBps >= 10_000 || c.maxPositionShareBps == 0 || c.maxPositionShareBps > 10_000
                || c.maxOiMultiplier == 0 || c.maxPriceStalenessSeconds == 0 || c.maxLiquidityStalenessSeconds == 0
                || c.maxOracleSpotDeviationBps == 0 || c.maxOracleSpotDeviationBps >= 10_000 || c.velocityWindowSeconds == 0
                || c.maxVaultStressBps > 10_000 || c.tickSpacing < TickMath.MIN_TICK_SPACING
                || c.tickSpacing > TickMath.MAX_TICK_SPACING || c.poolFee > 1_000_000
        ) revert InvalidConfig();
    }

    function _setUniswap(UniswapV4 calldata u) internal {
        if (u.poolManager == address(0) || u.positionManager == address(0) || u.permit2 == address(0)) {
            revert InvalidConfig();
        }
        uniswap = u;
        emit UniswapSet(u.poolManager, u.positionManager, u.permit2);
    }

    function _setOperator(address operator, bool enabled) internal {
        isOperator[operator] = enabled;
        emit OperatorSet(operator, enabled);
    }

    function setTradingPaused(bool paused) external onlyOwner {
        tradingPaused = paused;
        emit TradingPausedSet(paused, block.timestamp);
    }

    function setLaunchPaused(bool paused) external onlyOwner {
        _config.launchPaused = paused;
        emit ConfigUpdated(msg.sender, block.timestamp);
    }

    /// Delisted markets take no new risk; existing positions can still close.
    /// An oracle market (graduated or listed) keeps its status — its pricing
    /// depends on it — and goes close-only instead.
    function delistMarket(address token) external onlyOwner {
        Market storage m = _markets[token];
        if (m.status == MarketStatus.None) revert MarketNotFound();
        if (m.status == MarketStatus.Graduated) {
            _secondary[token].closeOnly = true;
            emit MarketDelisted(token, block.timestamp);
            return;
        }
        m.status = MarketStatus.Delisted;
        emit MarketDelisted(token, block.timestamp);
    }

    // ── Views ──────────────────────────────────────────────────────────────────

    function config() external view returns (Config memory) {
        return _config;
    }

    function getMarket(address token) external view returns (Market memory) {
        return _markets[token];
    }

    function getPosition(address token, address owner_) external view returns (Position memory) {
        return _positions[token][owner_];
    }

    function getOrder(uint256 orderId) external view returns (LimitOrder memory) {
        return _orders[orderId];
    }

    function marketCount() external view returns (uint256) {
        return allMarkets.length;
    }

    /// Market state accrued to the current block (funding, index, leverage cap).
    function previewMarket(address token) public view returns (Market memory m) {
        m = _markets[token];
        if (m.status == MarketStatus.None) revert MarketNotFound();
        _accrue(m);
        if (m.status == MarketStatus.Graduated) _refreshSecondary(m, _secondary[token]);
    }

    /// Margin ratio (bps of cost basis) the liquidation check would see now, and
    /// whether the position is liquidatable. Used by the keeper and the UI.
    function positionHealth(address token, address owner_)
        external
        view
        returns (int256 marginRatioBps, bool liquidatable, int256 pendingFundingUsdc, int256 unrealizedPnlUsdc)
    {
        Market memory m = previewMarket(token);
        Position memory p = _positions[token][owner_];
        if (p.sizeUsdc == 0) return (type(int256).max, false, 0, 0);
        pendingFundingUsdc =
            PerpesMath.pendingFunding(p.side == Side.Long, p.sizeUsdc, m.fundingIndexE9, p.lastFundingIndexE9);
        unrealizedPnlUsdc = PerpesMath.unrealizedPnl(p.side == Side.Long, p.sizeUsdc, p.baseAmount, m.markPriceE6);
        marginRatioBps = _marginRatioBps(p, m);
        liquidatable = marginRatioBps < int256(uint256(m.maintenanceMarginBps));
    }

    function oracleConfig() external view returns (OracleConfig memory) {
        return _oracleConfig;
    }

    function listingConfig() external view returns (ListingConfig memory) {
        return _listingConfig;
    }

    function counterflowConfig() external view returns (CounterflowConfig memory) {
        return _counterflowConfig;
    }

    function secondaryConfig() external view returns (SecondaryConfig memory) {
        return _secondaryConfig;
    }

    function getSecondary(address token) external view returns (Secondary memory) {
        return _secondary[token];
    }

    function marketStats(address token) external view returns (MarketStats memory) {
        return _stats[token];
    }

    /// The graduation criteria as measured on-chain right now.
    function graduationEligibility(address token) public view returns (Eligibility memory e) {
        Market memory m = previewMarket(token);
        MarketStats memory st = _stats[token];
        SecondaryConfig memory c = _secondaryConfig;
        e.ageSeconds = block.timestamp - m.createdAt;
        e.volumeUsdc = m.totalVolumeUsdc;
        e.uniqueTraders = st.uniqueTraders;
        e.peakOiUsdc = st.peakOiUsdc;
        e.vaultStressBps = _vaultStressBps(m);
        e.allMet = (m.status == MarketStatus.Warmup || m.status == MarketStatus.Active) && c.initialMaxLeverageX != 0
            && e.ageSeconds >= c.minAgeSeconds && e.volumeUsdc >= c.minVolumeUsdc && e.uniqueTraders >= c.minUniqueTraders
            && e.peakOiUsdc >= c.minPeakOiUsdc && e.vaultStressBps <= c.maxVaultStressBps;
    }

    /// The token/USDC v4 pool a market graduates (or graduated) into.
    function graduationPoolKey(address token) public view returns (PoolKey memory) {
        Secondary storage s = _secondary[token];
        SecondaryConfig storage c = (s.approved || s.active) ? s.cfg : _secondaryConfig;
        return PerpesUniswap.poolKey(token, address(usdc), c.poolFee, c.tickSpacing);
    }

    /// Live price of the market's pool, USDC E6 (0 if it doesn't exist yet).
    /// Before graduation this is the would-be graduation pool.
    function spotPriceE6(address token) public view returns (uint256 spotE6) {
        (spotE6,,) = _readSource(token, _secondary[token]);
    }

    /// USDC value of the quote side of the pool's in-range liquidity.
    function poolUsdcDepth(address token) public view returns (uint256 depthUsdc) {
        (,, depthUsdc) = _readSource(token, _secondary[token]);
    }

    /// What `syncCounterflow` would send now: pending fee share, and surplus.
    function counterflowSurplus(address token) public view returns (uint256 pendingFees, uint256 surplus) {
        Market memory m = previewMarket(token);
        pendingFees = m.counterflowPendingUsdc;
        surplus = _surplus(m);
    }

    /// Fill price a graduated market would give a taker of `notional` now.
    function quoteSecondary(address token, Side takerSide, uint256 notional) external view returns (uint256) {
        Market memory m = previewMarket(token);
        if (m.status != MarketStatus.Graduated) revert SecondaryNotActive();
        Secondary storage s = _secondary[token];
        (uint256 spot,,) = _readSource(token, s);
        return PerpesSecondaryMath.executionPriceE6(
            _worstOf(m.indexPriceE6, spot, takerSide == Side.Long),
            _skew(m),
            takerSide == Side.Long,
            notional,
            s.skewScaleUsdc,
            s.cfg.minSpreadBps,
            s.cfg.maxExecutionImpactBps
        );
    }

    /// Whether `executeTrigger` would fire now, and which leg.
    function triggerStatus(address token, address owner_) external view returns (bool hit, bool takeProfit) {
        Market memory m = previewMarket(token);
        Position memory p = _positions[token][owner_];
        if (p.sizeUsdc == 0) return (false, false);
        return PerpesMath.hitTrigger(p.side == Side.Long, p.tpPriceE6, p.slPriceE6, m.markPriceE6, m.indexPriceE6);
    }

    // ── Launch ─────────────────────────────────────────────────────────────────

    /// Permissionless: anyone may launch. The token is created here (fixed supply,
    /// minted entirely to this contract, no owner), so no pre-minted inventory can
    /// exist anywhere. Pays the launch fee to the treasury and refunds any excess.
    function createTokenAndMarket(LaunchParams calldata p) external payable nonReentrant returns (address token) {
        Config memory c = _config;
        if (c.launchPaused) revert ProtocolPaused();
        if (bytes(p.name).length == 0 || bytes(p.name).length > 32) revert NameTooLong();
        if (bytes(p.symbol).length == 0 || bytes(p.symbol).length > 10) revert SymbolTooLong();
        if (
            bytes(p.uri).length > 200 || bytes(p.imageUrl).length > 200 || bytes(p.description).length > 300
                || bytes(p.twitter).length > 50 || bytes(p.telegram).length > 50 || bytes(p.website).length > 100
        ) revert MetadataTooLong();
        if (msg.value < c.launchFeeWei) revert InvalidLaunchFee();

        // Salt is bound to the caller so nobody can front-run a creator's address.
        token = address(
            new PerpesToken{salt: keccak256(abi.encode(msg.sender, p.salt))}(p.name, p.symbol, p.uri, address(this))
        );
        _initMarket(token, msg.sender, c);
        creatorLaunchCount[msg.sender] += 1;

        emit TokenLaunched(msg.sender, token, p, block.timestamp);

        if (c.launchFeeWei > 0) _sendValue(c.treasury, c.launchFeeWei);
        if (msg.value > c.launchFeeWei) _sendValue(msg.sender, msg.value - c.launchFeeWei);
    }

    /// The address `createTokenAndMarket` will deploy to for (creator, salt).
    function predictTokenAddress(address creator, bytes32 salt, string calldata name, string calldata symbol, string calldata uri)
        external
        view
        returns (address)
    {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(PerpesToken).creationCode, abi.encode(name, symbol, uri, address(this)))
        );
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), address(this), keccak256(abi.encode(creator, salt)), initCodeHash)
                    )
                )
            )
        );
    }

    function _sendValue(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert FeeTransferFailed();
    }

    function _initMarket(address token, address creator, Config memory c) internal {
        Market storage m = _markets[token];
        (uint256 q, uint256 b, uint256 k) = PerpesMath.initialReserves(c.defaultLiquidityDepthUsdc, c.initialPriceE6);
        uint64 nowTs = uint64(block.timestamp);
        m.creator = creator;
        m.status = MarketStatus.Warmup;
        m.flatMaxLeverageX = c.flatMaxLeverageX;
        m.warmupMaxLeverageX = c.warmupMaxLeverageX;
        m.maxLeverageX = c.flatMaxLeverageX;
        m.takerFeeBps = c.takerFeeBps;
        m.hRatioBps = 10_000;
        m.creatorFeeBps = c.creatorFeeBps;
        m.creatorFeeBpsUnqualified = c.creatorFeeBpsUnqualified;
        m.insuranceFeeBpsStatic = c.insuranceFeeBpsStatic;
        m.liquidationRewardBps = c.liquidationRewardBps;
        m.liquidationPenaltyBps = c.liquidationPenaltyBps;
        m.maxOiMultiple = c.maxOiMultiple;
        m.maxActiveOrdersPerWallet = c.maxActiveOrdersPerWallet;
        m.fundingVelocityBps = c.fundingVelocityBps;
        m.fundingRateCapBps = c.fundingRateCapBps;
        m.fundingIntervalSeconds = c.fundingIntervalSeconds;
        m.referenceUpdateIntervalSeconds = c.referenceUpdateIntervalSeconds;
        m.creatorFeeWindowSeconds = c.creatorFeeWindowSeconds;
        m.createdAt = nowTs;
        m.warmupUntil = nowTs + c.warmupSeconds;
        m.lastAccumulatorTs = nowTs;
        m.creatorFeeVolumeThresholdUsdc = c.creatorFeeVolumeThresholdUsdc;
        m.fundingOiFloorUsdc = c.fundingOiFloorUsdc;
        m.tickSizeE6 = c.tickSizeE6;
        m.liquidityDepthUsdc = c.defaultLiquidityDepthUsdc;
        m.vammQuoteReserve = q;
        m.vammBaseReserve = b;
        m.vammK = k;
        m.indexPriceE6 = PerpesMath.priceE6(q, b);
        m.markPriceE6 = m.indexPriceE6;
        uint256 levX100 = uint256(nowTs < m.warmupUntil ? c.warmupMaxLeverageX : c.flatMaxLeverageX) * 100;
        m.maintenanceMarginBps = PerpesMath.maintenanceMarginBps(levX100);
        allMarkets.push(token);
        emit MarketInitialized(token, creator, block.timestamp);
    }

    // ── Trading ────────────────────────────────────────────────────────────────

    /// Open or increase a position. The fill swaps through the market's curve,
    /// so it moves the price. Pulls `collateral + fee` from the caller.
    function openPosition(address token, Side side, uint256 collateralUsdc, uint256 notionalUsdc, uint16 maxSlippageBps)
        external
        nonReentrant
    {
        if (collateralUsdc == 0) revert InsufficientCollateral();
        if (notionalUsdc == 0) revert InvalidCloseSize();
        Market memory m = _loadOpenableMarket(token);
        _accrue(m);
        _prepSecondary(token, m, true);
        _checkOpenCaps(token, m, notionalUsdc);
        if ((notionalUsdc * 100) / collateralUsdc > uint256(_currentMaxLeverage(m)) * 100) revert LeverageTooHigh();

        Position memory p = _positions[token][msg.sender];
        _resetTriggersIfFlat(p);
        _settle(p, m);
        if (p.pendingLiquidation) revert PendingLiquidation();
        _checkPositionShare(token, m, p, notionalUsdc);

        uint256 priceBefore = _referencePrice(m);
        Fill memory fill = _openFill(token, m, side, notionalUsdc);
        _checkSlippage(side, priceBefore, fill.priceE6, maxSlippageBps);

        uint256 fee = PerpesMath.notionalFee(notionalUsdc, m.takerFeeBps);
        _increase(p, m, side, fill, collateralUsdc);
        _afterFill(token, m);
        if (_marginRatioBps(p, m) < int256(uint256(m.maintenanceMarginBps))) revert LeverageTooHigh();
        _accrueFee(m, token, msg.sender, fee);
        _refreshHealth(m);
        m.vaultBalanceUsdc += collateralUsdc + fee;

        _store(token, msg.sender, m, p);
        usdc.safeTransferFrom(msg.sender, address(this), collateralUsdc + fee);

        emit PositionOpened(msg.sender, token, side, notionalUsdc, collateralUsdc, fill.priceE6, fee, block.timestamp);
        _emitMarket(token, m);
        _emitPosition(token, msg.sender, p);
    }

    /// Close (part of) a position by swapping its base back through the curve.
    /// `closeNotionalUsdc` is cost basis; pass the full size to close everything.
    function closePosition(address token, uint256 closeNotionalUsdc, uint16 maxSlippageBps) external nonReentrant {
        if (closeNotionalUsdc == 0) revert InvalidCloseSize();
        Market memory m = _loadMarket(token);
        _accrue(m);
        _prepSecondary(token, m, false);
        Position memory p = _positions[token][msg.sender];
        _settle(p, m);
        if (p.pendingLiquidation) revert PendingLiquidation();

        (uint256 payout,) = _closeAtMarket(token, msg.sender, m, p, closeNotionalUsdc, maxSlippageBps);

        _store(token, msg.sender, m, p);
        if (payout > 0) usdc.safeTransfer(msg.sender, payout);
        _emitMarket(token, m);
        _emitPosition(token, msg.sender, p);
    }

    function addCollateral(address token, uint256 amountUsdc) external nonReentrant {
        if (amountUsdc == 0) revert InsufficientCollateral();
        Market memory m = _loadMarket(token);
        _accrue(m);
        Position memory p = _positions[token][msg.sender];
        if (p.sizeUsdc == 0) revert InvalidCloseSize();
        // Irrecoverable: once flagged, no collateral can save the position.
        if (p.pendingLiquidation) revert PendingLiquidation();
        _settle(p, m);
        p.collateralUsdc += amountUsdc;
        p.lastUpdateTs = uint64(block.timestamp);
        m.collateralPoolUsdc += amountUsdc;
        m.vaultBalanceUsdc += amountUsdc;

        _store(token, msg.sender, m, p);
        usdc.safeTransferFrom(msg.sender, address(this), amountUsdc);
        emit CollateralUpdated(msg.sender, token, p.collateralUsdc, block.timestamp);
        _emitPosition(token, msg.sender, p);
    }

    function removeCollateral(address token, uint256 amountUsdc) external nonReentrant {
        if (amountUsdc == 0) revert InsufficientCollateral();
        Market memory m = _loadMarket(token);
        _accrue(m);
        _prepSecondary(token, m, false);
        Position memory p = _positions[token][msg.sender];
        _settle(p, m);
        if (p.pendingLiquidation) revert PendingLiquidation();
        if (p.collateralUsdc < amountUsdc) revert InsufficientCollateral();

        uint256 newCollateral = p.collateralUsdc - amountUsdc;
        // Equity-based: collateral already lost to an unrealized loss isn't the
        // owner's to withdraw; unrealized profit doesn't count toward margin.
        int256 pnl = PerpesMath.unrealizedPnl(p.side == Side.Long, p.sizeUsdc, p.baseAmount, _withdrawPrice(token, m, p.side));
        if (!PerpesMath.withdrawalKeepsInitialMargin(p.sizeUsdc, newCollateral, pnl, _currentMaxLeverage(m))) {
            revert WithdrawalBreachesMargin();
        }
        // Collateral can be credited by funding from counterparties who couldn't
        // pay it; a withdrawal must never reach into insurance or unclaimed fees.
        if (amountUsdc > _headroom(m)) revert InsufficientVaultHeadroom();
        p.collateralUsdc = newCollateral;
        p.lastUpdateTs = uint64(block.timestamp);
        m.collateralPoolUsdc = _subFloor(m.collateralPoolUsdc, amountUsdc);
        m.vaultBalanceUsdc -= amountUsdc;

        _store(token, msg.sender, m, p);
        usdc.safeTransfer(msg.sender, amountUsdc);
        emit CollateralUpdated(msg.sender, token, p.collateralUsdc, block.timestamp);
        _emitPosition(token, msg.sender, p);
    }

    /// Permissionless liquidation. Only allowed below maintenance at BOTH mark and
    /// index, so a single-block pump or dump can't liquidate anyone. Remaining
    /// equity pays the liquidator, then an insurance penalty, then the owner;
    /// negative equity is covered by insurance, then recorded as bad debt.
    function liquidate(address token, address owner_) external nonReentrant {
        Market memory m = _loadMarket(token);
        _accrue(m);
        _prepSecondary(token, m, false);
        Position memory p = _positions[token][owner_];
        if (p.sizeUsdc == 0) revert LiquidationNotAllowed();
        _settle(p, m);
        if (_marginRatioBps(p, m) >= int256(uint256(m.maintenanceMarginBps))) revert LiquidationNotAllowed();

        Side side = p.side;
        uint256 closeSize = p.sizeUsdc;
        uint256 priceE6;
        uint256 reward;
        uint256 ownerPay;
        {
            int256 equity = int256(p.collateralUsdc) - int256(_fundingDebt(p, m, closeSize));
            (uint256 base, uint256 released) = _reduceAmounts(p, closeSize);
            Fill memory fill = _liquidationFill(m, side, base);
            _applyReduce(p, m, closeSize, base, released);
            _afterFill(token, m);
            p.pendingLiquidation = false;
            priceE6 = fill.priceE6;
            (reward, ownerPay) = _liquidationPayouts(
                token, owner_, m, p, equity + _signedPnl(side, closeSize, fill.quote), fill.quote
            );
        }

        _store(token, owner_, m, p);
        if (reward > 0) usdc.safeTransfer(msg.sender, reward);
        // A recipient that can't receive USDC (blacklisted) must not be able to
        // block its own liquidation — its share is kept as claimable instead.
        _payOrDefer(token, owner_, ownerPay);

        emit PositionLiquidated(owner_, token, msg.sender, side, closeSize, priceE6, reward, block.timestamp);
        _emitMarket(token, m);
        _emitStoredPosition(token, owner_);
    }

    /// Splits a liquidated position's equity `gross` (collateral − carried funding
    /// + PnL): engine fee, liquidator reward, insurance penalty, then the owner;
    /// covers any shortfall. Debits the vault for both payouts; returns them for
    /// the caller to transfer after storing state.
    function _liquidationPayouts(
        address token,
        address owner_,
        Market memory m,
        Position memory p,
        int256 gross,
        uint256 exitQuote
    ) internal returns (uint256 reward, uint256 ownerPay) {
        uint256 fee = _min(PerpesMath.notionalFee(exitQuote, m.takerFeeBps), gross > 0 ? uint256(gross) : 0);
        (uint256 toLiquidator, uint256 toInsurance, uint256 toOwner, uint256 shortfall) = PerpesMath.splitLiquidation(
            gross - int256(fee), exitQuote, m.liquidationRewardBps, m.liquidationPenaltyBps
        );
        _accrueFee(m, token, owner_, fee);
        m.insuranceTrancheUsdc += toInsurance;
        if (shortfall > 0) _coverShortfall(token, m, shortfall);
        _refreshHealth(m);

        if (toLiquidator + toOwner > _headroom(m)) _drawCounterflow(token, m, toLiquidator + toOwner - _headroom(m));
        uint256 headroom = _headroom(m);
        reward = _min(toLiquidator, headroom);
        ownerPay = _min(toOwner, headroom - reward);
        m.vaultBalanceUsdc -= reward + ownerPay;
        if (toOwner > ownerPay) _deferPayout(token, owner_, m, p, toOwner - ownerPay);
    }

    /// Pay out profit a close couldn't pay at the time, from vault headroom only.
    function claimUnsettledProfit(address token) external nonReentrant {
        Market memory m = _loadMarket(token);
        Position memory p = _positions[token][msg.sender];
        uint256 available = _claimableHeadroom(m);
        if (p.unsettledProfitUsdc > available) _drawCounterflow(token, m, p.unsettledProfitUsdc - available);
        uint256 amount = _min(p.unsettledProfitUsdc, _claimableHeadroom(m));
        if (amount == 0) revert NothingToClaim();
        p.unsettledProfitUsdc -= amount;
        m.unsettledProfitTotalUsdc = _subFloor(m.unsettledProfitTotalUsdc, amount);
        m.vaultBalanceUsdc -= amount;
        _store(token, msg.sender, m, p);
        usdc.safeTransfer(msg.sender, amount);
        emit UnsettledProfitClaimed(msg.sender, token, amount, p.unsettledProfitUsdc, block.timestamp);
        _emitPosition(token, msg.sender, p);
    }

    /// Accrue funding/index for an idle market (anyone; the keeper pokes quiet markets).
    function poke(address token) external {
        Market memory m = _loadMarket(token);
        _accrue(m);
        _prepSecondary(token, m, false);
        _markets[token] = m;
        _emitMarket(token, m);
    }

    // ── TP / SL ────────────────────────────────────────────────────────────────

    /// Owner sets or clears (0) the position's on-chain take profit / stop loss.
    function setTriggers(address token, uint256 tpPriceE6, uint256 slPriceE6) external {
        Position storage p = _positions[token][msg.sender];
        if (p.sizeUsdc == 0) revert InvalidCloseSize();
        uint256 entry = p.entryPriceE6;
        if (p.side == Side.Long) {
            if ((tpPriceE6 != 0 && tpPriceE6 <= entry) || (slPriceE6 != 0 && slPriceE6 >= entry)) revert InvalidTrigger();
        } else {
            if ((tpPriceE6 != 0 && tpPriceE6 >= entry) || (slPriceE6 != 0 && slPriceE6 <= entry)) revert InvalidTrigger();
        }
        p.tpPriceE6 = tpPriceE6;
        p.slPriceE6 = slPriceE6;
        emit PositionTriggersUpdated(msg.sender, token, tpPriceE6, slPriceE6, block.timestamp);
        _emitPosition(token, msg.sender, p);
    }

    /// Closes the whole position at market once its TP or SL is hit. Anyone may
    /// call it (the keeper does); the payout always goes to the owner.
    function executeTrigger(address token, address owner_) external nonReentrant {
        Market memory m = _loadMarket(token);
        _accrue(m);
        _prepSecondary(token, m, false);
        Position memory p = _positions[token][owner_];
        _settle(p, m);
        if (p.pendingLiquidation) revert PendingLiquidation();
        if (p.sizeUsdc == 0) revert InvalidCloseSize();

        (bool hit, bool takeProfit) =
            PerpesMath.hitTrigger(p.side == Side.Long, p.tpPriceE6, p.slPriceE6, m.markPriceE6, m.indexPriceE6);
        if (!hit) revert TriggerNotHit();
        uint256 triggerPrice = takeProfit ? p.tpPriceE6 : p.slPriceE6;

        Side side = p.side;
        uint256 closeSize = p.sizeUsdc;
        p.tpPriceE6 = 0;
        p.slPriceE6 = 0;
        (uint256 payout, uint256 fillPriceE6) = _closeAtMarket(token, owner_, m, p, closeSize, 0);
        _store(token, owner_, m, p);
        payout = _payOrDefer(token, owner_, payout);

        emit PositionTriggerExecuted(
            owner_, token, side, takeProfit, triggerPrice, fillPriceE6, closeSize, payout, block.timestamp
        );
        _emitMarket(token, m);
        _emitStoredPosition(token, owner_);
    }

    // ── Limit orders ───────────────────────────────────────────────────────────

    /// Rest a limit / stop order. Collateral is escrowed now; the keeper (or
    /// anyone) executes it once the mark crosses the trigger.
    function placeLimitOrder(
        address token,
        Side side,
        OrderType orderType,
        uint256 collateralUsdc,
        uint8 leverage,
        uint256 limitPriceE6,
        uint256 stopPriceE6,
        bool postOnly,
        uint64 expiresAt
    ) external nonReentrant returns (uint256 orderId) {
        if (collateralUsdc == 0) revert InsufficientCollateral();
        if (tradingPaused) revert TradingPaused();
        Market storage m = _markets[token];
        bool graduated = m.status == MarketStatus.Graduated;
        if (m.status != MarketStatus.Warmup && m.status != MarketStatus.Active && !graduated) {
            revert InvalidMarketStatus();
        }
        // The fill re-checks against the live cap; this only rejects the impossible.
        uint8 levCap = graduated ? _secondary[token].cfg.maxLeverageCapX : m.flatMaxLeverageX;
        if (leverage == 0 || leverage > levCap) revert LeverageTooHigh();
        bool needsLimit = orderType == OrderType.Limit || orderType == OrderType.StopLimit
            || orderType == OrderType.ImmediateOrCancel || orderType == OrderType.FillOrKill;
        bool needsStop =
            orderType == OrderType.StopMarket || orderType == OrderType.StopLimit || orderType == OrderType.TakeProfit;
        if ((needsLimit && limitPriceE6 == 0) || (needsStop && stopPriceE6 == 0)) revert InvalidOrder();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert OrderExpired();

        uint256 notional = collateralUsdc * leverage;
        if (notional < 10e6) revert MinimumNotionalNotMet();
        if (postOnly && orderType == OrderType.Limit) {
            uint256 mark = m.markPriceE6;
            if (side == Side.Long ? mark <= limitPriceE6 : mark >= limitPriceE6) revert PostOnlyRejection();
        }
        if (activeOrderCount[msg.sender][token] >= m.maxActiveOrdersPerWallet) revert OrderWalletLimitExceeded();
        activeOrderCount[msg.sender][token] += 1;
        m.orderEscrowUsdc += collateralUsdc;

        orderId = ++nextOrderId;
        _orders[orderId] = LimitOrder({
            trader: msg.sender,
            market: token,
            side: side,
            orderType: orderType,
            status: OrderStatus.Open,
            postOnly: postOnly,
            leverage: leverage,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            collateralUsdc: collateralUsdc,
            limitPriceE6: limitPriceE6,
            stopPriceE6: stopPriceE6,
            initialNotionalUsdc: notional,
            remainingNotionalUsdc: notional,
            filledNotionalUsdc: 0
        });
        usdc.safeTransferFrom(msg.sender, address(this), collateralUsdc);
        emit LimitOrderPlaced(
            orderId,
            msg.sender,
            token,
            side,
            orderType,
            limitPriceE6,
            stopPriceE6,
            notional,
            collateralUsdc,
            leverage,
            expiresAt,
            block.timestamp
        );
    }

    /// The trader cancels (any time) or anyone cancels an expired order; the
    /// remaining escrow always goes back to the trader.
    function cancelLimitOrder(uint256 orderId) external nonReentrant {
        LimitOrder storage o = _orders[orderId];
        if (o.status != OrderStatus.Open && o.status != OrderStatus.PartiallyFilled) revert OrderNotOpen();
        bool expired = o.expiresAt != 0 && block.timestamp >= o.expiresAt;
        if (msg.sender != o.trader && msg.sender != owner() && !expired) revert Unauthorized();
        uint256 refund = o.collateralUsdc;
        address trader = o.trader;
        address token = o.market;
        o.status = OrderStatus.Cancelled;
        o.collateralUsdc = 0;
        _markets[token].orderEscrowUsdc -= refund;
        activeOrderCount[trader][token] -= 1;
        if (refund > 0) usdc.safeTransfer(trader, refund);
        emit LimitOrderCancelled(orderId, trader, token, refund, block.timestamp);
    }

    /// Permissionless: fill a triggered order through the curve. Trigger uses the
    /// mark; the fill must be at the limit or better. The executor earns 0.01%
    /// of the filled notional out of the order's collateral.
    function executeLimitOrder(uint256 orderId, uint256 fillNotionalUsdc) external nonReentrant {
        LimitOrder memory o = _orders[orderId];
        if (o.status != OrderStatus.Open && o.status != OrderStatus.PartiallyFilled) revert OrderNotOpen();
        if (o.expiresAt != 0 && block.timestamp >= o.expiresAt) revert OrderExpired();
        Market memory m = _loadOpenableMarket(o.market);
        if (!_orderTriggered(o, m.markPriceE6)) revert OrderTriggerNotMet();
        if (o.orderType == OrderType.FillOrKill && fillNotionalUsdc != o.remainingNotionalUsdc) {
            revert FillOrKillNotFillable();
        }
        if (fillNotionalUsdc == 0 || fillNotionalUsdc > o.remainingNotionalUsdc) revert InvalidCloseSize();
        _accrue(m);
        _prepSecondary(o.market, m, true);
        _checkOpenCaps(o.market, m, fillNotionalUsdc);

        OrderFill memory f = _orderFillAmounts(o, m, fillNotionalUsdc);
        Position memory p = _positions[o.market][o.trader];
        _applyOrderFill(o, m, p, f);

        _orders[orderId] = o;
        _store(o.market, o.trader, m, p);
        if (f.reward > 0) usdc.safeTransfer(msg.sender, f.reward);
        if (f.refund > 0) usdc.safeTransfer(o.trader, f.refund);

        emit LimitOrderExecuted(
            orderId, o.trader, o.market, f.priceE6, f.notional, o.remainingNotionalUsdc, o.status, block.timestamp
        );
        emit PositionOpened(o.trader, o.market, o.side, f.notional, f.effective, f.priceE6, f.fee, block.timestamp);
        _emitMarket(o.market, m);
        _emitPosition(o.market, o.trader, p);
    }

    /// One limit-order fill's amounts (all USDC E6 except priceE6).
    struct OrderFill {
        uint256 notional;
        uint256 collateral; // escrow consumed by this fill
        uint256 fee;
        uint256 reward; // executor's 0.01%
        uint256 effective; // collateral that lands on the position
        uint256 priceE6;
        uint256 refund; // IOC remainder returned to the trader
    }

    function _orderFillAmounts(LimitOrder memory o, Market memory m, uint256 notional)
        internal
        view
        returns (OrderFill memory f)
    {
        f.notional = notional;
        // Proportional to what's left, so the last fill consumes all escrow.
        f.collateral = notional == o.remainingNotionalUsdc
            ? o.collateralUsdc
            : (o.collateralUsdc * notional) / o.remainingNotionalUsdc;
        f.fee = PerpesMath.notionalFee(notional, m.takerFeeBps);
        f.reward = notional / 10_000;
        if (f.collateral < f.fee + f.reward) revert InsufficientCollateral();
        f.effective = f.collateral - f.fee - f.reward;
        if ((notional * 100) / (f.effective == 0 ? 1 : f.effective) > uint256(_currentMaxLeverage(m)) * 100) {
            revert LeverageTooHigh();
        }
    }

    /// Fills through the curve onto the trader's position and updates the order.
    function _applyOrderFill(LimitOrder memory o, Market memory m, Position memory p, OrderFill memory f) internal {
        _resetTriggersIfFlat(p);
        _settle(p, m);
        if (p.pendingLiquidation) revert PendingLiquidation();
        _checkPositionShare(o.market, m, p, f.notional);
        Fill memory fill = _openFill(o.market, m, o.side, f.notional);
        f.priceE6 = fill.priceE6;
        if (
            o.limitPriceE6 > 0
                && (o.orderType == OrderType.Limit || o.orderType == OrderType.StopLimit
                    || o.orderType == OrderType.ImmediateOrCancel || o.orderType == OrderType.FillOrKill)
        ) {
            if (o.side == Side.Long ? fill.priceE6 > o.limitPriceE6 : fill.priceE6 < o.limitPriceE6) {
                revert LimitPriceNotMet();
            }
        }
        _increase(p, m, o.side, fill, f.effective);
        _afterFill(o.market, m);
        if (_marginRatioBps(p, m) < int256(uint256(m.maintenanceMarginBps))) revert LeverageTooHigh();
        _accrueFee(m, o.market, o.trader, f.fee);
        _refreshHealth(m);
        m.orderEscrowUsdc -= f.collateral;
        m.vaultBalanceUsdc += f.effective + f.fee;

        o.filledNotionalUsdc += f.notional;
        o.remainingNotionalUsdc -= f.notional;
        o.collateralUsdc -= f.collateral;
        if (o.remainingNotionalUsdc == 0) {
            o.status = OrderStatus.Filled;
        } else if (o.orderType == OrderType.ImmediateOrCancel) {
            o.status = OrderStatus.Cancelled;
            f.refund = o.collateralUsdc;
            m.orderEscrowUsdc -= f.refund;
            o.collateralUsdc = 0;
        } else {
            o.status = OrderStatus.PartiallyFilled;
        }
        if (o.status != OrderStatus.PartiallyFilled) activeOrderCount[o.trader][o.market] -= 1;
    }

    function _orderTriggered(LimitOrder memory o, uint256 mark) internal pure returns (bool) {
        bool long = o.side == Side.Long;
        if (o.orderType == OrderType.StopMarket || o.orderType == OrderType.StopLimit || o.orderType == OrderType.TakeProfit) {
            // Long stop/TP buys once price rises through the stop; short once it falls.
            return long ? mark >= o.stopPriceE6 : mark <= o.stopPriceE6;
        }
        return long ? mark <= o.limitPriceE6 : mark >= o.limitPriceE6;
    }

    // ── Fees ───────────────────────────────────────────────────────────────────

    function claimCreatorFees(address token) external nonReentrant {
        Market storage m = _markets[token];
        if (msg.sender != m.creator) revert Unauthorized();
        uint256 amount = m.creatorFeesPendingUsdc;
        if (amount == 0) revert NothingToClaim();
        m.creatorFeesPendingUsdc = 0;
        m.vaultBalanceUsdc -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit CreatorFeesClaimed(token, msg.sender, amount, block.timestamp);
    }

    function claimProtocolFees(address token) external nonReentrant {
        if (msg.sender != _config.protocolFeeWallet) revert Unauthorized();
        Market storage m = _markets[token];
        uint256 amount = m.protocolFeesPendingUsdc;
        if (amount == 0) revert NothingToClaim();
        m.protocolFeesPendingUsdc = 0;
        m.vaultBalanceUsdc -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit ProtocolFeesClaimed(token, msg.sender, amount, block.timestamp);
    }

    // ── Graduation ─────────────────────────────────────────────────────────────

    /// Owner (the protocol) approves a market for graduation. Without
    /// `adminOverride` every on-chain criterion must be met. Snapshots the
    /// current secondary config onto the market.
    function approveGraduation(address token, bool adminOverride) external onlyOwner {
        Market memory m = previewMarket(token);
        if (m.status != MarketStatus.Warmup && m.status != MarketStatus.Active) revert InvalidMarketStatus();
        Secondary storage s = _secondary[token];
        if (s.active) revert InvalidEngineTransition();
        if (_secondaryConfig.initialMaxLeverageX == 0) revert InvalidConfig();
        if (!adminOverride && !graduationEligibility(token).allMet) revert EligibilityNotMet();
        s.approved = true;
        s.adminOverride = adminOverride;
        s.approvedAt = uint64(block.timestamp);
        s.cfg = _secondaryConfig;
        emit GraduationApproved(token, msg.sender, adminOverride, block.timestamp);
    }

    function revokeGraduation(address token) external onlyOwner {
        Secondary storage s = _secondary[token];
        if (!s.approved || s.active) revert InvalidEngineTransition();
        s.approved = false;
        emit GraduationRevoked(token, block.timestamp);
    }

    /// Executes an approved graduation: seeds the token/USDC v4 pool at the
    /// market's index price with full-range liquidity minted to the burn
    /// address, burns the rest of the supply and switches the market to the
    /// secondary engine. `seedUsdc` is funded from the market's unclaimed
    /// protocol fees first, then pulled from the caller. Reverts unless the
    /// index sits within [minPriceE6, maxPriceE6] (protection against a
    /// manipulated price at execution time).
    function graduate(address token, uint256 seedUsdc, uint256 minPriceE6, uint256 maxPriceE6)
        external
        onlyOperator
        nonReentrant
    {
        Secondary storage s = _secondary[token];
        if (!s.approved || s.active) revert InvalidEngineTransition();
        if (uniswap.positionManager == address(0)) revert UniswapNotConfigured();
        if (seedUsdc == 0) revert InsufficientCollateral();
        Market memory m = _loadMarket(token);
        if (m.status != MarketStatus.Warmup && m.status != MarketStatus.Active) revert InvalidMarketStatus();
        _accrue(m);
        uint256 priceE6 = m.indexPriceE6;
        if (priceE6 == 0 || priceE6 < minPriceE6 || priceE6 > maxPriceE6) revert SlippageExceeded();

        uint256 fromFees = _min(seedUsdc, m.protocolFeesPendingUsdc);
        m.protocolFeesPendingUsdc -= fromFees;
        m.vaultBalanceUsdc -= fromFees;
        if (seedUsdc > fromFees) usdc.safeTransferFrom(msg.sender, address(this), seedUsdc - fromFees);

        uint256 usdcBefore = usdc.balanceOf(address(this));
        Seeded memory r = _seedPool(token, s.cfg, priceE6, seedUsdc);
        // USDC the pool didn't take (rounding), or that a price correction paid
        // in, stays with this market as insurance.
        uint256 leftover = seedUsdc + usdc.balanceOf(address(this)) - usdcBefore;
        m.insuranceTrancheUsdc += leftover;
        m.vaultBalanceUsdc += leftover;

        // What's in the pool is all of this token that will ever trade.
        uint256 rest = IERC20(token).balanceOf(address(this));
        if (rest > 0) IERC20(token).safeTransfer(PerpesUniswap.DEAD, rest);

        _activateSecondary(token, m, s, r, priceE6);
    }

    function _activateSecondary(address token, Market memory m, Secondary storage s, Seeded memory r, uint256 priceE6)
        internal
    {
        SecondaryConfig storage c = s.cfg;
        uint64 nowTs = uint64(block.timestamp);
        m.status = MarketStatus.Graduated;
        m.fundingVelocityBps = c.fundingVelocityBps;
        m.fundingRateCapBps = c.fundingRateCapBps;
        m.fundingIntervalSeconds = c.fundingIntervalSeconds;
        // Liquidation threshold stays at the market's steady-state level; the
        // secondary schedule only limits opening leverage (as on Solana).
        m.maintenanceMarginBps = PerpesMath.maintenanceMarginBps(uint256(m.flatMaxLeverageX) * 100);
        m.indexPriceE6 = priceE6;

        s.active = true;
        s.graduatedAt = nowTs;
        s.syntheticSnapshotE6 = priceE6;
        s.spotTwapE6 = priceE6;
        s.oracleE6 = priceE6;
        s.lastOracleTs = nowTs;
        s.velocityWindowPriceE6 = priceE6;
        s.velocityWindowTs = nowTs;
        s.lastSpotE6 = priceE6;
        s.backed = _counterflowConfig.autoBackGraduated && _counterflowConfig.vault != address(0);
        s.seedUsdc = r.usdcInPool;
        s.seedTokens = r.tokensInPool;
        s.lpTokenId = r.lpTokenId;
        s.lpLiquidity = r.liquidity;
        s.poolId = r.poolId;
        _setSpotLiquidity(s, r.usdcInPool);
        _refreshSecondary(m, s);
        _markets[token] = m;

        emit MarketGraduated(
            token, r.poolId, r.lpTokenId, r.liquidity, r.usdcInPool, r.tokensInPool, priceE6, block.timestamp
        );
        _emitMarket(token, m);
    }

    /// Initializes the pool at `priceE6` (or swaps a pre-existing one into line)
    /// and mints the full-range position, sized so the USDC side binds.
    function _seedPool(address token, SecondaryConfig storage c, uint256 priceE6, uint256 seedUsdc)
        internal
        returns (Seeded memory r)
    {
        UniswapV4 memory u = uniswap;
        IPoolManager pm = IPoolManager(u.poolManager);
        PoolKey memory key = PerpesUniswap.poolKey(token, address(usdc), c.poolFee, c.tickSpacing);
        bool tokenIs0 = token < address(usdc);
        r.poolId = PerpesUniswap.poolId(key);

        uint256 usdcStart = usdc.balanceOf(address(this));
        uint160 target = PerpesUniswap.toSqrtPriceX96(priceE6, tokenIs0);
        uint160 current = PerpesUniswap.sqrtPrice(pm, key);
        if (current == 0) {
            pm.initialize(key, target);
        } else if (
            PerpesSecondaryMath.velocityBps(PerpesUniswap.toPriceE6(current, tokenIs0), priceE6) > POOL_PRICE_TOLERANCE_BPS
        ) {
            _correctPoolPrice(token, pm, key, tokenIs0, current, target);
        }
        current = PerpesUniswap.sqrtPrice(pm, key);
        uint256 poolPrice = PerpesUniswap.toPriceE6(current, tokenIs0);
        if (PerpesSecondaryMath.velocityBps(poolPrice, priceE6) > POOL_PRICE_TOLERANCE_BPS) revert PoolPriceMismatch();

        uint256 usdcForMint = seedUsdc + usdc.balanceOf(address(this)) - usdcStart;
        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        // 1% spare tokens so USDC is the binding side; the excess is burned.
        uint256 tokens = _min(tokenBalance, (usdcForMint * PerpesUniswap.TOKEN_UNIT * 101) / (poolPrice * 100));
        (uint256 a0, uint256 a1) = tokenIs0 ? (tokens, usdcForMint) : (usdcForMint, tokens);

        uint256 usdcBeforeMint = usdc.balanceOf(address(this));
        (r.lpTokenId, r.liquidity) =
            PerpesUniswap.mintFullRangeToDead(u.positionManager, u.permit2, key, current, a0, a1);
        r.usdcInPool = usdcBeforeMint - usdc.balanceOf(address(this));
        r.tokensInPool = tokenBalance - IERC20(token).balanceOf(address(this));
    }

    /// Anyone can initialize a v4 pool, so the pool may already exist at a bad
    /// price. Before graduation this engine holds the entire token supply, so
    /// the only liquidity anyone else can have added is USDC bids below the
    /// price: raising the price meets no resistance (1 wei of input moves it),
    /// and lowering it sells our tokens into those bids above the target price.
    function _correctPoolPrice(
        address token,
        IPoolManager pm,
        PoolKey memory key,
        bool tokenIs0,
        uint160 current,
        uint160 target
    ) internal {
        bool zeroForOne = target < current;
        bool sellToken = zeroForOne == tokenIs0;
        int256 amountIn = sellToken ? int256(IERC20(token).balanceOf(address(this)) / 2) : int256(1);
        _correctingPool = true;
        pm.unlock(abi.encode(key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -amountIn, sqrtPriceLimitX96: target})));
        _correctingPool = false;
        emit PoolPriceCorrected(token, current, PerpesUniswap.sqrtPrice(pm, key));
    }

    /// v4 unlock callback — only for `_correctPoolPrice`'s swap.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != uniswap.poolManager || !_correctingPool) revert Unauthorized();
        (PoolKey memory key, SwapParams memory params) = abi.decode(data, (PoolKey, SwapParams));
        IPoolManager pm = IPoolManager(msg.sender);
        BalanceDelta delta = pm.swap(key, params, "");
        _resolveDelta(pm, key.currency0, delta.amount0());
        _resolveDelta(pm, key.currency1, delta.amount1());
        return "";
    }

    function _resolveDelta(IPoolManager pm, Currency currency, int128 amount) internal {
        if (amount < 0) {
            pm.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(pm), uint256(uint128(-amount)));
            pm.settle();
        } else if (amount > 0) {
            pm.take(currency, address(this), uint256(uint128(amount)));
        }
    }

    // ── Listing ────────────────────────────────────────────────────────────────

    /// Permissionless: opens an oracle-priced market on an existing token that
    /// has a Uniswap v3 (from the configured factory) or hookless v4 pool
    /// against USDC or WMON, at least `minDepthUsdc` deep. The market trades on
    /// the secondary engine; new positions wait out a short warmup while the
    /// oracle settles. The lister earns the creator share of its fees. Listed
    /// markets aren't Counterflow-backed unless an operator turns it on.
    function listMarket(address token, ListingParams calldata p) external payable nonReentrant {
        ListingConfig memory lc = _listingConfig;
        if (!lc.enabled) revert ListingDisabled();
        if (msg.value < lc.listingFeeWei) revert InvalidLaunchFee();
        if (_markets[token].status != MarketStatus.None) revert AlreadyListed();
        if (_secondaryConfig.initialMaxLeverageX == 0) revert InvalidConfig();
        address quote = p.quoteIsWmon ? _oracleConfig.wmon : address(usdc);
        if (quote == address(0) || token == quote || token == address(usdc) || token.code.length == 0) {
            revert InvalidListing();
        }
        uint8 decimals = IERC20Metadata(token).decimals();
        if (decimals == 0 || decimals > 30) revert InvalidListing();

        Secondary storage s = _secondary[token];
        s.sourceKind = p.kind;
        s.quoteIsWmon = p.quoteIsWmon;
        s.baseDecimals = decimals;
        s.listed = true;
        if (p.kind == SourceKind.V3) {
            address factory = _oracleConfig.v3Factory;
            if (factory == address(0) || p.v3Pool == address(0)) revert InvalidListing();
            uint24 fee = IUniswapV3PoolLike(p.v3Pool).fee();
            if (IUniswapV3FactoryLike(factory).getPool(token, quote, fee) != p.v3Pool) revert InvalidListing();
            s.v3Pool = p.v3Pool;
        } else {
            if (uniswap.poolManager == address(0)) revert UniswapNotConfigured();
            s.v4Fee = p.v4Fee;
            s.v4TickSpacing = p.v4TickSpacing;
        }
        (uint256 spot, uint256 twap, uint256 depth) = _readSource(token, s);
        if (spot == 0 || depth < lc.minDepthUsdc) revert InsufficientPoolDepth();
        // A v3 pool must already serve a TWAP over the window (enough history).
        if (p.kind == SourceKind.V3 && twap == 0) revert InvalidListing();
        _initListedMarket(token, s, p.kind == SourceKind.V3 ? twap : spot, spot, depth, lc);

        emit MarketListed(
            token, msg.sender, p.kind, p.v3Pool, p.v4Fee, p.v4TickSpacing, p.quoteIsWmon, s.oracleE6, depth, block.timestamp
        );
        if (lc.listingFeeWei > 0) _sendValue(_config.treasury, lc.listingFeeWei);
        if (msg.value > lc.listingFeeWei) _sendValue(msg.sender, msg.value - lc.listingFeeWei);
    }

    function _initListedMarket(
        address token,
        Secondary storage s,
        uint256 priceE6,
        uint256 spotE6,
        uint256 depth,
        ListingConfig memory lc
    ) internal {
        Config memory c = _config;
        SecondaryConfig memory sc = _secondaryConfig;
        if (sc.initialMaxLeverageX > lc.maxLeverageX) sc.initialMaxLeverageX = lc.maxLeverageX;
        if (sc.maxLeverageCapX > lc.maxLeverageX) sc.maxLeverageCapX = lc.maxLeverageX;
        uint64 nowTs = uint64(block.timestamp);

        Market memory m;
        m.creator = msg.sender;
        m.status = MarketStatus.Graduated;
        m.flatMaxLeverageX = lc.maxLeverageX;
        m.warmupMaxLeverageX = lc.maxLeverageX;
        m.takerFeeBps = c.takerFeeBps;
        m.creatorFeeBps = c.creatorFeeBps;
        m.creatorFeeBpsUnqualified = c.creatorFeeBpsUnqualified;
        m.insuranceFeeBpsStatic = c.insuranceFeeBpsStatic;
        m.liquidationRewardBps = c.liquidationRewardBps;
        m.liquidationPenaltyBps = c.liquidationPenaltyBps;
        m.maxActiveOrdersPerWallet = c.maxActiveOrdersPerWallet;
        m.fundingVelocityBps = sc.fundingVelocityBps;
        m.fundingRateCapBps = sc.fundingRateCapBps;
        m.fundingIntervalSeconds = sc.fundingIntervalSeconds;
        m.referenceUpdateIntervalSeconds = c.referenceUpdateIntervalSeconds;
        m.creatorFeeWindowSeconds = c.creatorFeeWindowSeconds;
        m.createdAt = nowTs;
        m.warmupUntil = nowTs + lc.warmupSeconds;
        m.lastAccumulatorTs = nowTs;
        m.creatorFeeVolumeThresholdUsdc = c.creatorFeeVolumeThresholdUsdc;
        m.fundingOiFloorUsdc = c.fundingOiFloorUsdc;
        m.tickSizeE6 = c.tickSizeE6;
        m.maintenanceMarginBps = PerpesMath.maintenanceMarginBps(uint256(lc.maxLeverageX) * 100);
        m.indexPriceE6 = priceE6;

        s.active = true;
        s.graduatedAt = nowTs;
        s.cfg = sc;
        s.syntheticSnapshotE6 = priceE6;
        s.spotTwapE6 = priceE6;
        s.oracleE6 = priceE6;
        s.lastSpotE6 = spotE6;
        s.lastOracleTs = nowTs;
        s.spotLiquidityUsdc = depth;
        s.lastLiquidityTs = nowTs;
        _deriveFromLiquidity(s);
        _refreshSecondary(m, s);
        _markets[token] = m;
        allMarkets.push(token);
        emit MarketInitialized(token, msg.sender, block.timestamp);
        _emitMarket(token, m);
    }

    // ── On-chain oracle ────────────────────────────────────────────────────────

    /// The market's pool: live price and its own TWAP (v3; 0 for v4), both
    /// USDC E6, and the USDC value of the pool's quote side. Before a market
    /// graduates this reads its would-be graduation pool.
    function _readSource(address token, Secondary storage s)
        internal
        view
        returns (uint256 spotE6, uint256 twapE6, uint256 depthUsdc)
    {
        OracleConfig storage oc = _oracleConfig;
        bool wmonQuote = s.quoteIsWmon;
        address quote = wmonQuote ? oc.wmon : address(usdc);
        uint8 baseDec = s.baseDecimals == 0 ? 18 : s.baseDecimals;
        uint8 quoteDec = wmonQuote ? 18 : 6;
        bool baseIs0 = token < quote;
        uint160 sqrtP;
        uint128 liquidity;
        if (s.sourceKind == SourceKind.V3) {
            (sqrtP, liquidity) = PerpesOracle.v3Spot(s.v3Pool);
            twapE6 = _v3TwapE18(s.v3Pool, baseIs0, baseDec, quoteDec);
        } else {
            if (uniswap.poolManager == address(0)) revert UniswapNotConfigured();
            PoolKey memory key = s.listed
                ? PerpesUniswap.poolKey(token, quote, s.v4Fee, s.v4TickSpacing)
                : graduationPoolKey(token);
            (sqrtP, liquidity) = PerpesOracle.v4Spot(IPoolManager(uniswap.poolManager), key);
        }
        if (sqrtP == 0) return (0, 0, 0);
        spotE6 = PerpesOracle.priceE18(sqrtP, baseIs0, baseDec, quoteDec);
        depthUsdc = PerpesOracle.quoteDepth(liquidity, sqrtP, !baseIs0);
        // Concentrated v3 liquidity makes in-range "virtual" depth overstate
        // what the pool holds; never count more than its actual quote balance.
        if (s.sourceKind == SourceKind.V3) depthUsdc = _min(depthUsdc, IERC20(quote).balanceOf(s.v3Pool));
        if (wmonQuote) {
            // MON → USD from the reference pool's TWAP (its spot only if the
            // pool can't serve the window).
            bool wmonIs0 = oc.wmon < address(usdc);
            uint256 monUsdE18 = _v3TwapE18(oc.monUsdPool, wmonIs0, 18, 6);
            if (monUsdE18 == 0) {
                (uint160 monSqrt,) = PerpesOracle.v3Spot(oc.monUsdPool);
                monUsdE18 = PerpesOracle.priceE18(monSqrt, wmonIs0, 18, 6);
            }
            spotE6 = (spotE6 * monUsdE18) / 1e18;
            twapE6 = (twapE6 * monUsdE18) / 1e18;
            depthUsdc = (depthUsdc * monUsdE18) / 1e30;
        }
        spotE6 /= 1e12;
        twapE6 /= 1e12;
    }

    /// A v3 pool's TWAP over the configured window (1e18 fixed), or 0 when the
    /// pool doesn't keep enough observations to cover it.
    function _v3TwapE18(address pool, bool baseIs0, uint8 baseDec, uint8 quoteDec) internal view returns (uint256) {
        uint32 window = _oracleConfig.twapWindowSeconds;
        uint32[] memory ago = new uint32[](2);
        ago[0] = window;
        try IUniswapV3PoolLike(pool).observe(ago) returns (int56[] memory cumulative, uint160[] memory) {
            return PerpesOracle.priceE18(
                PerpesOracle.meanTickSqrtPrice(cumulative[0], cumulative[1], window), baseIs0, baseDec, quoteDec
            );
        } catch {
            return 0;
        }
    }

    /// Reads the pool and updates the market's oracle: always the live price
    /// (for worst-of fills and the breaker); at most once per second the
    /// average — the v3 TWAP, or one clamped EMA step for v4 — and the depth,
    /// whose increases are smoothed so JIT liquidity can't inflate caps.
    function _sampleOracle(address token, Secondary storage s) internal {
        (uint256 spot, uint256 twap, uint256 depth) = _readSource(token, s);
        if (spot == 0) revert InvalidPrice();
        s.lastSpotE6 = spot;
        uint256 nowTs = block.timestamp;
        uint256 dt = nowTs - s.lastOracleTs;
        if (dt > 0) {
            OracleConfig storage oc = _oracleConfig;
            if (dt > oc.maxSampleGapSeconds) dt = oc.maxSampleGapSeconds;
            // v3: the pool's own TWAP; v4 (or a v3 pool that can't serve the
            // window right now): one clamped EMA step.
            s.spotTwapE6 = (s.sourceKind == SourceKind.V3 && twap > 0)
                ? twap
                : PerpesOracle.emaStep(s.spotTwapE6, spot, dt, oc.emaTauSeconds, oc.maxSampleDeviationBps);
            s.spotLiquidityUsdc = PerpesOracle.depthStep(s.spotLiquidityUsdc, depth, dt, oc.emaTauSeconds);
            s.lastOracleTs = uint64(nowTs);
            s.lastLiquidityTs = uint64(nowTs);
            _deriveFromLiquidity(s);
        }
        SecondaryConfig storage c = s.cfg;
        s.oracleE6 = s.listed
            ? s.spotTwapE6
            : PerpesSecondaryMath.blendedPriceE6(
                s.syntheticSnapshotE6,
                s.spotTwapE6,
                PerpesSecondaryMath.transitionProgressQ9(nowTs, s.graduatedAt, c.transitionSeconds)
            );
        // Breaker: the pool running away from its own average (not from the
        // blended oracle, which sits near the seed price during the transition).
        s.velocityTripped = PerpesSecondaryMath.velocityBps(spot, s.spotTwapE6) >= c.velocityCircuitBps;
        if (dt > 0) emit SecondaryOracleUpdated(token, s.spotTwapE6, spot, s.oracleE6, s.velocityTripped, nowTs);
    }

    /// The worse price for a taker: the higher of oracle and pool when buying,
    /// the lower when selling.
    function _worstOf(uint256 oracleE6, uint256 spotE6, bool takerIsBuy) internal pure returns (uint256) {
        if (spotE6 == 0) return oracleE6;
        if (takerIsBuy) return oracleE6 > spotE6 ? oracleE6 : spotE6;
        return oracleE6 < spotE6 ? oracleE6 : spotE6;
    }

    // ── Counterflow ────────────────────────────────────────────────────────────

    /// Sends a backed market's pending fee share and surplus (what its traders
    /// have lost beyond what open positions could still claim) to Counterflow —
    /// repaying earlier cover first. Permissionless; the keeper runs it.
    function syncCounterflow(address token) external nonReentrant {
        address vault = _counterflowConfig.vault;
        if (vault == address(0)) revert InvalidConfig();
        Market memory m = _loadMarket(token);
        Secondary storage s = _secondary[token];
        if (!s.backed && m.counterflowDrawnUsdc == 0 && m.counterflowPendingUsdc == 0) revert NotOracleMarket();
        _accrue(m);
        _prepSecondary(token, m, false);
        uint256 fees = m.counterflowPendingUsdc;
        // An unbacked market only repays what it drew; its surplus stays.
        uint256 surplus = _surplus(m);
        if (!s.backed && surplus > m.counterflowDrawnUsdc) surplus = m.counterflowDrawnUsdc;
        uint256 send = fees + surplus;
        if (send == 0) return;
        uint256 repaid = _min(send, m.counterflowDrawnUsdc);
        m.counterflowPendingUsdc = 0;
        m.counterflowDrawnUsdc -= repaid;
        m.vaultBalanceUsdc -= send;
        _markets[token] = m;
        usdc.safeTransfer(vault, send);
        ICounterflowV1(vault).onIncome(token, send, repaid);
        emit CounterflowSynced(token, send, repaid, fees, m.counterflowDrawnUsdc, block.timestamp);
    }

    /// Vault balance beyond everything the market could owe: reserved funds,
    /// open collateral (plus a buffer for rounding and funding drift),
    /// deferred payouts and open positions' net unrealized profit.
    function _surplus(Market memory m) internal view returns (uint256) {
        int256 open = _aggregatePnl(m);
        uint256 owed = _reserved(m) + m.collateralPoolUsdc
            + (m.collateralPoolUsdc * _counterflowConfig.surplusBufferBps) / 10_000 + m.unsettledProfitTotalUsdc
            + (open > 0 ? uint256(open) : 0);
        return _subFloor(m.vaultBalanceUsdc, owed);
    }

    /// Asks Counterflow to cover `amount` for a backed market; credits what it pays.
    function _drawCounterflow(address token, Market memory m, uint256 amount) internal returns (uint256 paid) {
        if (amount == 0 || !_secondary[token].backed) return 0;
        address vault = _counterflowConfig.vault;
        if (vault == address(0)) return 0;
        // A vault failure must never block a close or a liquidation: no cover, the
        // usual deferral applies. Only USDC that actually arrived is credited.
        uint256 before = usdc.balanceOf(address(this));
        try ICounterflowV1(vault).cover(token, amount) returns (uint256) {
            paid = usdc.balanceOf(address(this)) - before;
        } catch {
            return 0;
        }
        if (paid == 0) return 0;
        m.vaultBalanceUsdc += paid;
        m.counterflowDrawnUsdc += paid;
        emit CounterflowDrawn(token, amount, paid, m.counterflowDrawnUsdc, block.timestamp);
    }

    /// Owner retunes an approved or graduated market's risk parameters (its
    /// snapshot of the secondary config) — e.g. the staleness windows, which set
    /// how often the operator must push. The pool shape can't change once chosen.
    function setMarketSecondaryConfig(address token, SecondaryConfig calldata c) external onlyOwner {
        Secondary storage s = _secondary[token];
        if (!s.approved && !s.active) revert InvalidEngineTransition();
        if (c.poolFee != s.cfg.poolFee || c.tickSpacing != s.cfg.tickSpacing) revert InvalidConfig();
        _validateSecondaryConfig(c);
        s.cfg = c;
        if (s.active) _deriveFromLiquidity(s);
        emit SecondaryConfigUpdated(msg.sender, block.timestamp);
    }

    function _setSpotLiquidity(Secondary storage s, uint256 spotLiquidityUsdc) internal {
        s.spotLiquidityUsdc = spotLiquidityUsdc;
        s.lastLiquidityTs = uint64(block.timestamp);
        _deriveFromLiquidity(s);
    }

    /// Skew scale and OI cap follow the spot depth and the market's multipliers.
    function _deriveFromLiquidity(Secondary storage s) internal {
        SecondaryConfig storage c = s.cfg;
        // Backing deepens the market: a larger skew scale (smaller premium) and OI cap.
        uint256 skewMult = c.virtualLiqMultiplier;
        if (s.backed && _counterflowConfig.backedOiMultiplier > skewMult) skewMult = _counterflowConfig.backedOiMultiplier;
        s.skewScaleUsdc = PerpesSecondaryMath.skewScaleUsdc(s.spotLiquidityUsdc, skewMult, c.minVirtualLiquidityUsdc);
        s.maxOiUsdc = s.spotLiquidityUsdc * _oiMultiplier(s);
    }

    // ── Internals: loading / storing ───────────────────────────────────────────

    function _loadMarket(address token) internal view returns (Market memory m) {
        m = _markets[token];
        if (m.status == MarketStatus.None) revert MarketNotFound();
    }

    function _loadOpenableMarket(address token) internal view returns (Market memory m) {
        if (tradingPaused) revert TradingPaused();
        m = _loadMarket(token);
        if (m.status != MarketStatus.Warmup && m.status != MarketStatus.Active && m.status != MarketStatus.Graduated) {
            revert InvalidMarketStatus();
        }
    }

    /// Also tracks the on-chain graduation metrics: a wallet's first trade in a
    /// market counts it as a unique trader, and peak open interest is latched.
    function _store(address token, address owner_, Market memory m, Position memory p) internal {
        _trackStats(_stats[token], p.tradeCount, m.oiLongUsdc + m.oiShortUsdc);
        p.tradeCount += 1;
        _markets[token] = m;
        _positions[token][owner_] = p;
    }

    function _trackStats(MarketStats storage st, uint64 priorTrades, uint256 oi) internal {
        if (priorTrades == 0) st.uniqueTraders += 1;
        if (oi > st.peakOiUsdc) st.peakOiUsdc = oi;
    }

    // ── Internals: accrual / health ────────────────────────────────────────────

    /// Accrues funding to now, steps the index toward the mark, and refreshes
    /// derived fields. Never touches the mark (the curve price).
    function _accrue(Market memory m) internal view {
        uint256 nowTs = block.timestamp;
        if (nowTs > m.lastAccumulatorTs) {
            uint256 elapsed = nowTs - m.lastAccumulatorTs;
            int256 rate = _fundingRate(m);
            m.fundingIndexE9 += (rate * int256(elapsed) * PerpesMath.ACCUMULATOR_SCALE) / 10_000
                / int256(uint256(m.fundingIntervalSeconds));
            m.lastAccumulatorTs = uint64(nowTs);
            // A graduated market's index is its oracle, set only by oracle pushes.
            if (m.status != MarketStatus.Graduated) {
                m.indexPriceE6 =
                    PerpesMath.ewmaIndexE6(m.indexPriceE6, m.markPriceE6, elapsed, m.referenceUpdateIntervalSeconds);
            }
            int256 premium = ((int256(m.markPriceE6) - int256(m.indexPriceE6)) * 10_000)
                / int256(m.indexPriceE6 == 0 ? 1 : m.indexPriceE6);
            if (premium > PerpesMath.MAX_PREMIUM_BPS) premium = PerpesMath.MAX_PREMIUM_BPS;
            if (premium < -PerpesMath.MAX_PREMIUM_BPS) premium = -PerpesMath.MAX_PREMIUM_BPS;
            m.premiumTwapBps = int64(premium);
        }
        _refreshHealth(m);
    }

    function _fundingRate(Market memory m) internal pure returns (int256) {
        return PerpesMath.fundingRateBps(
            m.oiLongUsdc, m.oiShortUsdc, m.fundingOiFloorUsdc, m.fundingVelocityBps, m.fundingRateCapBps
        );
    }

    function _refreshHealth(Market memory m) internal view {
        m.hRatioBps = PerpesMath.hRatioBps(m.oiLongUsdc, m.oiShortUsdc);
        if (m.status != MarketStatus.Graduated) {
            uint256 levX100 =
                uint256(block.timestamp < m.warmupUntil ? m.warmupMaxLeverageX : m.flatMaxLeverageX) * 100;
            uint256 lev = levX100 / 100;
            m.maxLeverageX = uint8(lev == 0 ? 1 : (lev > 100 ? 100 : lev));
            m.maintenanceMarginBps = PerpesMath.maintenanceMarginBps(levX100);
        }
        if (m.status == MarketStatus.Warmup && m.warmupUntil <= block.timestamp) m.status = MarketStatus.Active;
    }

    function _currentMaxLeverage(Market memory m) internal view returns (uint8) {
        if (m.status == MarketStatus.Graduated) return m.maxLeverageX;
        return block.timestamp < m.warmupUntil ? m.warmupMaxLeverageX : m.maxLeverageX;
    }

    function _oiWithinCap(Market memory m, uint256 incoming) internal pure returns (bool) {
        if (m.maxOiMultiple == 0) return true;
        return m.oiLongUsdc + m.oiShortUsdc + incoming <= m.liquidityDepthUsdc * m.maxOiMultiple;
    }

    // ── Internals: secondary engine ────────────────────────────────────────────

    /// Oracle markets (graduated or listed): samples the pool, moves the index
    /// to the oracle and refreshes the leverage schedule and mark. A listed
    /// market takes no new risk until its warmup ends. No-op on primary markets.
    function _prepSecondary(address token, Market memory m, bool opening) internal {
        if (m.status != MarketStatus.Graduated) return;
        Secondary storage s = _secondary[token];
        if (opening) {
            if (s.closeOnly) revert InvalidMarketStatus();
            if (s.listed && block.timestamp < m.warmupUntil) revert MarketWarmingUp();
        }
        _sampleOracle(token, s);
        m.indexPriceE6 = s.oracleE6;
        _refreshSecondary(m, s);
    }

    /// Opening-leverage schedule (with the velocity breaker) and the skew mark.
    function _refreshSecondary(Market memory m, Secondary storage s) internal view {
        SecondaryConfig storage c = s.cfg;
        m.maxLeverageX = uint8(
            PerpesSecondaryMath.maxLeverageX(
                s.graduatedAt,
                block.timestamp,
                c.initialMaxLeverageX,
                c.leverageStepPer24h,
                c.maxLeverageCapX,
                s.velocityTripped
            )
        );
        m.markPriceE6 =
            PerpesSecondaryMath.markPriceE6(m.indexPriceE6, _skew(m), s.skewScaleUsdc, c.maxMarkDeviationBps);
    }

    function _secondaryMaxOi(Secondary storage s) internal view returns (uint256) {
        return PerpesSecondaryMath.maxOiUsdc(s.spotLiquidityUsdc, _oiMultiplier(s), s.velocityTripped);
    }

    /// Counterflow-backed markets can carry more OI per dollar of pool depth.
    function _oiMultiplier(Secondary storage s) internal view returns (uint256) {
        uint256 base = s.cfg.maxOiMultiplier;
        uint256 backed = _counterflowConfig.backedOiMultiplier;
        return s.backed && backed > base ? backed : base;
    }

    function _checkOpenCaps(address token, Market memory m, uint256 incoming) internal view {
        if (m.status != MarketStatus.Graduated) {
            if (!_oiWithinCap(m, incoming)) revert PrimaryOpenInterestCapExceeded();
            return;
        }
        if (m.oiLongUsdc + m.oiShortUsdc + incoming > _secondaryMaxOi(_secondary[token])) {
            revert OpenInterestCapExceeded();
        }
    }

    /// Graduated: one wallet may hold at most `maxPositionShareBps` of the OI cap.
    function _checkPositionShare(address token, Market memory m, Position memory p, uint256 incoming)
        internal
        view
    {
        if (m.status != MarketStatus.Graduated) return;
        Secondary storage s = _secondary[token];
        if (p.sizeUsdc + incoming > (_secondaryMaxOi(s) * s.cfg.maxPositionShareBps) / 10_000) {
            revert PositionLimitExceeded();
        }
    }

    /// Price slippage is measured from: the curve price, or a graduated market's oracle.
    function _referencePrice(Market memory m) internal pure returns (uint256) {
        return m.status == MarketStatus.Graduated ? m.indexPriceE6 : m.markPriceE6;
    }

    function _openFill(address token, Market memory m, Side side, uint256 notional) internal view returns (Fill memory) {
        if (m.status != MarketStatus.Graduated) return _primaryOpenFill(m, side, notional);
        Secondary storage s = _secondary[token];
        bool long = side == Side.Long;
        uint256 price = PerpesSecondaryMath.executionPriceE6(
            _worstOf(m.indexPriceE6, s.lastSpotE6, long),
            _skew(m),
            long,
            notional,
            s.skewScaleUsdc,
            s.cfg.minSpreadBps,
            s.cfg.maxExecutionImpactBps
        );
        uint256 base = PerpesSecondaryMath.baseForNotional(notional, price, !long);
        if (base == 0) revert InvalidCloseSize();
        return Fill(base, notional, price);
    }

    /// Closing `base` of a `side` position; on a graduated market the skew moves
    /// by the closed cost basis (OI is tracked at cost basis).
    function _closeFill(address token, Market memory m, Side side, uint256 base, uint256 closeNotional)
        internal
        view
        returns (Fill memory)
    {
        if (m.status != MarketStatus.Graduated) return _primaryCloseFill(m, side, base);
        Secondary storage s = _secondary[token];
        uint256 price = PerpesSecondaryMath.executionPriceE6(
            _worstOf(m.indexPriceE6, s.lastSpotE6, side == Side.Short),
            _skew(m),
            side == Side.Short,
            closeNotional,
            s.skewScaleUsdc,
            s.cfg.minSpreadBps,
            s.cfg.maxExecutionImpactBps
        );
        return _oracleCloseFill(side, base, price);
    }

    /// Graduated markets liquidate at the oracle itself — no premium or spread.
    function _liquidationFill(Market memory m, Side side, uint256 base) internal pure returns (Fill memory) {
        if (m.status == MarketStatus.Graduated) return _oracleCloseFill(side, base, m.indexPriceE6);
        return _primaryCloseFill(m, side, base);
    }

    /// A close at `priceE6`; a short's buy-back rounds up.
    function _oracleCloseFill(Side side, uint256 base, uint256 priceE6) internal pure returns (Fill memory) {
        return Fill(base, PerpesMath.baseValue(base, priceE6, side == Side.Short), priceE6);
    }

    /// After a fill changes skew, a graduated market's mark follows it.
    function _afterFill(address token, Market memory m) internal view {
        if (m.status == MarketStatus.Graduated) _refreshSecondary(m, _secondary[token]);
    }

    function _skew(Market memory m) internal pure returns (int256) {
        return int256(m.oiLongUsdc) - int256(m.oiShortUsdc);
    }

    /// Traders' net unrealized PnL at the mark (positive = owed by the vault).
    function _aggregatePnl(Market memory m) internal pure returns (int256) {
        return PerpesSecondaryMath.aggregateTraderPnl(m.baseLong, m.oiLongUsdc, m.baseShort, m.oiShortUsdc, m.markPriceE6);
    }

    /// Headroom deferred profit may be claimed from. On a graduated market the
    /// vault backs open profit too, so a throttled closer can't claim that
    /// share straight back.
    function _claimableHeadroom(Market memory m) internal pure returns (uint256) {
        uint256 available = _headroom(m);
        if (m.status != MarketStatus.Graduated) return available;
        int256 open = _aggregatePnl(m);
        return open > 0 ? _subFloor(available, uint256(open)) : available;
    }

    /// Share of the vault's free balance already owed to traders — open profit,
    /// deferred payouts and bad debt — in bps (capped at 100%).
    function _vaultStressBps(Market memory m) internal pure returns (uint256) {
        int256 open = _aggregatePnl(m);
        uint256 owed = (open > 0 ? uint256(open) : 0) + m.unsettledProfitTotalUsdc + m.badDebtUsdc;
        if (owed == 0) return 0;
        uint256 headroom = _headroom(m);
        uint256 bps = (owed * 10_000) / (headroom == 0 ? 1 : headroom);
        return bps > 10_000 ? 10_000 : bps;
    }

    // ── Internals: positions ───────────────────────────────────────────────────

    function _resetTriggersIfFlat(Position memory p) internal pure {
        // A fresh position never inherits the previous one's TP/SL.
        if (p.sizeUsdc == 0) {
            p.tpPriceE6 = 0;
            p.slPriceE6 = 0;
        }
    }

    /// Settles funding into collateral and latches `pendingLiquidation` the first
    /// time the position is seen below maintenance (never cleared by recovery).
    function _settle(Position memory p, Market memory m) internal pure {
        int256 pending = PerpesMath.pendingFunding(p.side == Side.Long, p.sizeUsdc, m.fundingIndexE9, p.lastFundingIndexE9);
        if (pending >= 0) {
            p.collateralUsdc += uint256(pending);
        } else {
            uint256 debit = uint256(-pending);
            if (debit > p.collateralUsdc) {
                // Owes more than its collateral: take it all and carry the rest
                // by leaving the funding marker behind (pendingFunding keeps
                // reporting it), so it still counts against margin and is paid
                // out of the position's proceeds at close or liquidation instead
                // of being forgiven. Rounded so the carried debt never shrinks.
                uint256 lag = PerpesMath.ceilDiv((debit - p.collateralUsdc) * uint256(PerpesMath.ACCUMULATOR_SCALE), p.sizeUsdc);
                p.collateralUsdc = 0;
                p.reduceOnly = true;
                p.lastFundingIndexE9 =
                    p.side == Side.Long ? m.fundingIndexE9 - int256(lag) : m.fundingIndexE9 + int256(lag);
                _latchLiquidation(p, m);
                return;
            }
            p.collateralUsdc -= debit;
            if (p.collateralUsdc == 0 && p.sizeUsdc > 0) p.reduceOnly = true;
        }
        p.lastFundingIndexE9 = m.fundingIndexE9;
        _latchLiquidation(p, m);
    }

    function _latchLiquidation(Position memory p, Market memory m) internal pure {
        if (!p.pendingLiquidation && p.sizeUsdc > 0 && _marginRatioBps(p, m) < int256(uint256(m.maintenanceMarginBps))) {
            p.pendingLiquidation = true;
        }
    }

    /// Withdrawals value a position at the least favourable of mark, index and
    /// (on an oracle market) the live pool price.
    function _withdrawPrice(address token, Market memory m, Side side) internal view returns (uint256) {
        uint256 px = _marginPrice(m, side, false);
        if (m.status != MarketStatus.Graduated) return px;
        return _worstOf(px, _secondary[token].lastSpotE6, side == Side.Short);
    }

    /// Margin price: liquidation uses the price most favourable to the trader
    /// (under maintenance at both mark and index); opening/withdrawing the least.
    function _marginPrice(Market memory m, Side side, bool maintenance) internal pure returns (uint256) {
        uint256 mark = m.markPriceE6 == 0 ? 1 : m.markPriceE6;
        uint256 index = m.indexPriceE6 == 0 ? mark : m.indexPriceE6;
        uint256 hi = mark > index ? mark : index;
        uint256 lo = mark > index ? index : mark;
        bool long = side == Side.Long;
        return (long == maintenance) ? hi : lo;
    }

    function _marginRatioBps(Position memory p, Market memory m) internal pure returns (int256) {
        if (p.sizeUsdc == 0) return type(int256).max;
        bool long = p.side == Side.Long;
        int256 equity = int256(p.collateralUsdc)
            + PerpesMath.unrealizedPnl(long, p.sizeUsdc, p.baseAmount, _marginPrice(m, p.side, true))
            + PerpesMath.pendingFunding(long, p.sizeUsdc, m.fundingIndexE9, p.lastFundingIndexE9);
        return (equity * 10_000) / int256(p.sizeUsdc);
    }

    function _primaryOpenFill(Market memory m, Side side, uint256 notional) internal pure returns (Fill memory f) {
        PerpesMath.Swap memory s = side == Side.Long
            ? PerpesMath.openLong(m.vammQuoteReserve, m.vammBaseReserve, m.vammK, notional)
            : PerpesMath.openShort(m.vammQuoteReserve, m.vammBaseReserve, m.vammK, notional);
        m.vammQuoteReserve = s.newQuoteReserve;
        m.vammBaseReserve = s.newBaseReserve;
        m.markPriceE6 = PerpesMath.priceE6(s.newQuoteReserve, s.newBaseReserve);
        if (s.baseAmount == 0) revert InvalidCloseSize();
        f = Fill(s.baseAmount, notional, PerpesMath.averagePriceE6(notional, s.baseAmount));
    }

    function _primaryCloseFill(Market memory m, Side side, uint256 base) internal pure returns (Fill memory f) {
        PerpesMath.Swap memory s = side == Side.Long
            ? PerpesMath.closeLong(m.vammQuoteReserve, m.vammBaseReserve, m.vammK, base)
            : PerpesMath.closeShort(m.vammQuoteReserve, m.vammBaseReserve, m.vammK, base);
        m.vammQuoteReserve = s.newQuoteReserve;
        m.vammBaseReserve = s.newBaseReserve;
        m.markPriceE6 = PerpesMath.priceE6(s.newQuoteReserve, s.newBaseReserve);
        f = Fill(base, s.quoteAmount, PerpesMath.averagePriceE6(s.quoteAmount, base));
    }

    /// Adds a fill on the same side (a position can't be flipped by opening the
    /// other side — close it first).
    function _increase(Position memory p, Market memory m, Side side, Fill memory f, uint256 collateral) internal view {
        if (p.reduceOnly) revert PositionSideMismatch();
        if (p.sizeUsdc > 0 && p.side != side) revert PositionSideMismatch();
        p.side = side;
        p.sizeUsdc += f.quote;
        p.baseAmount += f.base;
        p.collateralUsdc += collateral;
        p.entryPriceE6 = PerpesMath.averagePriceE6(p.sizeUsdc, p.baseAmount);
        // Adding moves the entry; a TP/SL now on the wrong side of it would fire
        // immediately (a "take profit" at a loss), so drop it.
        bool long = side == Side.Long;
        if (p.tpPriceE6 != 0 && (long ? p.tpPriceE6 <= p.entryPriceE6 : p.tpPriceE6 >= p.entryPriceE6)) p.tpPriceE6 = 0;
        if (p.slPriceE6 != 0 && (long ? p.slPriceE6 >= p.entryPriceE6 : p.slPriceE6 <= p.entryPriceE6)) p.slPriceE6 = 0;
        p.lastFundingIndexE9 = m.fundingIndexE9;
        p.lastUpdateTs = uint64(block.timestamp);
        m.collateralPoolUsdc += collateral;
        if (side == Side.Long) {
            m.oiLongUsdc += f.quote;
            m.baseLong += f.base;
        } else {
            m.oiShortUsdc += f.quote;
            m.baseShort += f.base;
        }
        m.totalVolumeUsdc += f.quote;
    }

    function _reduceAmounts(Position memory p, uint256 closeNotional) internal pure returns (uint256 base, uint256 released) {
        if (closeNotional == 0 || closeNotional > p.sizeUsdc) revert InvalidCloseSize();
        if (closeNotional == p.sizeUsdc) return (p.baseAmount, p.collateralUsdc);
        base = (p.baseAmount * closeNotional) / p.sizeUsdc;
        released = (p.collateralUsdc * closeNotional) / p.sizeUsdc;
        if (base == 0) revert InvalidCloseSize();
    }

    function _applyReduce(Position memory p, Market memory m, uint256 closeNotional, uint256 base, uint256 released)
        internal
        view
    {
        Side side = p.side;
        p.sizeUsdc -= closeNotional;
        p.baseAmount -= base;
        p.collateralUsdc -= released;
        if (p.sizeUsdc == 0) {
            p.baseAmount = 0;
            p.entryPriceE6 = 0;
            p.reduceOnly = false;
        } else {
            p.entryPriceE6 = PerpesMath.averagePriceE6(p.sizeUsdc, p.baseAmount);
        }
        p.lastUpdateTs = uint64(block.timestamp);
        m.collateralPoolUsdc = _subFloor(m.collateralPoolUsdc, released);
        if (side == Side.Long) {
            m.oiLongUsdc -= closeNotional;
            m.baseLong = _subFloor(m.baseLong, base);
        } else {
            m.oiShortUsdc -= closeNotional;
            m.baseShort = _subFloor(m.baseShort, base);
        }
        m.totalVolumeUsdc += closeNotional;
    }

    /// Shared tail of every voluntary close: realizes PnL on the closed slice.
    /// A loss beyond the released collateral comes out of the remaining
    /// collateral, then insurance, then bad debt. Principal is paid in full
    /// while the vault has headroom; anything unpaid is deferred, never forfeited.
    /// Debits `vaultBalanceUsdc` by the amount paid; the caller transfers it.
    function _settleClose(CloseSlice memory c, Market memory m, Position memory p, Fill memory fill)
        internal
        returns (uint256 payNow, uint256 fee)
    {
        int256 pnl = _signedPnl(c.side, c.costBasis, fill.quote);
        {
            int256 gross = int256(c.released) + pnl - int256(c.fundingDebt);
            fee = _min(PerpesMath.notionalFee(fill.quote, m.takerFeeBps), gross > 0 ? uint256(gross) : 0);
            int256 value = gross - int256(fee);
            if (value < 0) {
                uint256 loss = uint256(-value);
                uint256 fromCollateral = _min(loss, p.collateralUsdc);
                p.collateralUsdc -= fromCollateral;
                m.collateralPoolUsdc = _subFloor(m.collateralPoolUsdc, fromCollateral);
                if (p.collateralUsdc == 0 && p.sizeUsdc > 0) p.reduceOnly = true;
                if (loss > fromCollateral) _coverShortfall(c.token, m, loss - fromCollateral);
            }
            _accrueFee(m, c.token, c.owner, fee);
            _refreshHealth(m);

            uint256 v = value > 0 ? uint256(value) : 0;
            uint256 principal = _min(v, c.released);
            uint256 deferred;
            // Primary: no profit throttle — on the curve traders' PnL nets to
            // zero, so only the headroom cap applies. Oracle markets: the vault
            // is the counterparty to net skew, so profit is throttled by how
            // much of the vault open profit already claims — unless Counterflow
            // backs the market, which then covers what the vault can't pay.
            bool backed = _secondary[c.token].backed;
            if (backed && v > _headroom(m)) _drawCounterflow(c.token, m, v - _headroom(m));
            uint256 headroom = _headroom(m);
            uint256 claimRatio = (m.status == MarketStatus.Graduated && !backed)
                ? PerpesSecondaryMath.claimRatioBps(PerpesSecondaryMath.utilizationBps(_aggregatePnl(m), headroom))
                : 10_000;
            (payNow, deferred) = PerpesMath.splitClosePayout(principal, v - principal, claimRatio, headroom);
            m.vaultBalanceUsdc -= payNow;
            if (deferred > 0) {
                _deferPayout(c.token, c.owner, m, p, deferred);
                emit PayoutHaircut(c.owner, c.token, v, payNow, deferred, block.timestamp);
            }
        }
        emit PositionClosed(c.owner, c.token, c.side, c.costBasis, fill.priceE6, payNow, fee, pnl, block.timestamp);
    }

    /// Pays `amount` (already debited from the stored vault) to `to`. If the token
    /// refuses — e.g. a USDC-blacklisted recipient — the amount goes back into the
    /// vault as `to`'s claimable unsettled profit instead of reverting, so keeper
    /// actions (liquidation, TP/SL) can't be blocked by the recipient. Returns
    /// what was actually paid.
    function _payOrDefer(address token, address to, uint256 amount) internal returns (uint256) {
        if (amount == 0) return 0;
        (bool ok, bytes memory ret) = address(usdc).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (ok && (ret.length == 0 || abi.decode(ret, (bool)))) return amount;
        Market storage m = _markets[token];
        Position storage p = _positions[token][to];
        m.vaultBalanceUsdc += amount;
        m.unsettledProfitTotalUsdc += amount;
        p.unsettledProfitUsdc += amount;
        emit PayoutDeferred(to, token, amount, p.unsettledProfitUsdc, block.timestamp);
        return 0;
    }

    /// Closes `closeNotional` of cost basis through the curve (with an optional
    /// slippage bound) and realizes it via `_settleClose`. Returns the payout,
    /// already debited from the vault; the caller transfers it after storing.
    function _closeAtMarket(
        address token,
        address owner_,
        Market memory m,
        Position memory p,
        uint256 closeNotional,
        uint16 maxSlippageBps
    ) internal returns (uint256 payout, uint256 fillPriceE6) {
        Side side = p.side;
        uint256 debt = _fundingDebt(p, m, closeNotional);
        uint64 lastTouch = p.lastUpdateTs;
        (uint256 base, uint256 released) = _reduceAmounts(p, closeNotional);
        uint256 priceBefore = _referencePrice(m);
        Fill memory fill = _closeFill(token, m, side, base, closeNotional);
        _checkSlippage(_opposite(side), priceBefore, fill.priceE6, maxSlippageBps);
        _applyReduce(p, m, closeNotional, base, released);
        // Graduated: a close in the same second as the position's last change
        // must not be profitable, so premium/rounding can't be round-tripped.
        if (
            m.status == MarketStatus.Graduated && lastTouch == block.timestamp
                && _signedPnl(side, closeNotional, fill.quote) > 0
        ) revert ImmediateRoundtripProfit();
        _afterFill(token, m);
        (payout,) = _settleClose(CloseSlice(token, owner_, side, closeNotional, released, debt), m, p, fill);
        fillPriceE6 = fill.priceE6;
    }

    /// Unpaid funding carried by the position (see `_settle`), pro rata for a
    /// `closeNotional` slice. Must be read before the position is reduced.
    function _fundingDebt(Position memory p, Market memory m, uint256 closeNotional) internal pure returns (uint256) {
        int256 pending = PerpesMath.pendingFunding(p.side == Side.Long, p.sizeUsdc, m.fundingIndexE9, p.lastFundingIndexE9);
        if (pending >= 0 || p.sizeUsdc == 0) return 0;
        uint256 debt = uint256(-pending);
        return closeNotional >= p.sizeUsdc ? debt : PerpesMath.ceilDiv(debt * closeNotional, p.sizeUsdc);
    }

    function _signedPnl(Side side, uint256 costBasis, uint256 exitQuote) internal pure returns (int256) {
        return side == Side.Long ? int256(exitQuote) - int256(costBasis) : int256(costBasis) - int256(exitQuote);
    }

    /// Vault balance that isn't trader money: insurance plus unclaimed fees
    /// (Counterflow's share included).
    function _reserved(Market memory m) internal pure returns (uint256) {
        return m.insuranceTrancheUsdc + m.creatorFeesPendingUsdc + m.protocolFeesPendingUsdc + m.counterflowPendingUsdc;
    }

    function _headroom(Market memory m) internal pure returns (uint256) {
        return _subFloor(m.vaultBalanceUsdc, _reserved(m));
    }

    /// A loss beyond a position's collateral: insurance first, then (backed
    /// markets) Counterflow, and only the rest is bad debt.
    function _coverShortfall(address token, Market memory m, uint256 shortfall) internal {
        uint256 covered = _min(shortfall, m.insuranceTrancheUsdc);
        m.insuranceTrancheUsdc -= covered;
        uint256 uncovered = shortfall - covered;
        uncovered -= _drawCounterflow(token, m, uncovered);
        m.badDebtUsdc += uncovered;
        emit BadDebtRecorded(token, shortfall, covered, uncovered, m.badDebtUsdc, block.timestamp);
    }

    function _deferPayout(address token, address owner_, Market memory m, Position memory p, uint256 amount) internal {
        p.unsettledProfitUsdc += amount;
        m.unsettledProfitTotalUsdc += amount;
        emit PayoutDeferred(owner_, token, amount, p.unsettledProfitUsdc, block.timestamp);
    }

    /// Three-way fee split: creator (two-tier), static insurance cut, protocol
    /// remainder. The creator's qualified rate unlocks if the market reaches the
    /// volume threshold within the window; once latched it stays.
    function _accrueFee(Market memory m, address token, address trader, uint256 fee) internal {
        if (fee == 0) return;
        if (
            !m.creatorFeeTierUnlocked && block.timestamp - m.createdAt <= m.creatorFeeWindowSeconds
                && m.totalVolumeUsdc >= m.creatorFeeVolumeThresholdUsdc
        ) m.creatorFeeTierUnlocked = true;
        uint256 creatorBps = m.creatorFeeTierUnlocked ? m.creatorFeeBps : m.creatorFeeBpsUnqualified;
        uint256 creatorCut = (fee * creatorBps) / 10_000;
        uint256 insuranceCut = (fee * m.insuranceFeeBpsStatic) / 10_000;
        // Backed markets: Counterflow's share comes out of the protocol's cut.
        uint256 counterflowCut = _secondary[token].backed ? (fee * _counterflowConfig.feeShareBps) / 10_000 : 0;
        uint256 protocolCut = fee - creatorCut - insuranceCut - counterflowCut;
        m.totalFeesCollectedUsdc += fee;
        m.creatorFeesPendingUsdc += creatorCut;
        m.insuranceTrancheUsdc += insuranceCut;
        m.protocolFeesPendingUsdc += protocolCut;
        m.counterflowPendingUsdc += counterflowCut;
        emit TradingFeeAccrued(
            token, trader, fee, creatorCut, insuranceCut, protocolCut, m.creatorFeeTierUnlocked, block.timestamp
        );
    }

    /// Rejects a fill that moved more than `maxSlippageBps` against `side` from
    /// `basePrice`. 0 means no tolerance was specified (skipped).
    function _checkSlippage(Side side, uint256 basePrice, uint256 execPrice, uint16 maxSlippageBps) internal pure {
        if (maxSlippageBps == 0) return;
        if (side == Side.Long) {
            if (execPrice > (basePrice * (10_000 + uint256(maxSlippageBps))) / 10_000) revert SlippageExceeded();
        } else {
            uint256 bound = maxSlippageBps >= 10_000 ? 0 : (basePrice * (10_000 - uint256(maxSlippageBps))) / 10_000;
            if (execPrice < bound) revert SlippageExceeded();
        }
    }

    function _opposite(Side side) internal pure returns (Side) {
        return side == Side.Long ? Side.Short : Side.Long;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _subFloor(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : 0;
    }

    function _emitMarket(address token, Market memory m) internal {
        emit MarketPriceUpdated(
            token,
            m.indexPriceE6,
            m.markPriceE6,
            m.oiLongUsdc,
            m.oiShortUsdc,
            _fundingRate(m),
            m.totalVolumeUsdc,
            block.timestamp
        );
    }

    /// Emits `PositionState`. Encoded in two halves and logged directly: the
    /// bytes are identical to `emit PositionState(...)` (a static tuple encodes
    /// as its concatenated words), but this keeps 11 values off the stack of
    /// every caller.
    function _emitPosition(address token, address owner_, Position memory p) internal {
        bytes memory data = _positionStateData(p);
        bytes32 topic0 = PositionState.selector;
        assembly ("memory-safe") {
            log3(add(data, 0x20), mload(data), topic0, owner_, token)
        }
    }

    function _emitStoredPosition(address token, address owner_) internal {
        _emitPosition(token, owner_, _positions[token][owner_]);
    }

    function _positionStateData(Position memory p) private pure returns (bytes memory) {
        return bytes.concat(
            abi.encode(p.side, p.sizeUsdc, p.baseAmount, p.collateralUsdc, p.entryPriceE6),
            abi.encode(p.tpPriceE6, p.slPriceE6, p.pendingLiquidation, p.unsettledProfitUsdc)
        );
    }
}
