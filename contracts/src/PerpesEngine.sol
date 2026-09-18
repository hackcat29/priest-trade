// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import {PerpesMath} from "../../src/PerpesMath.sol";
import {PerpesToken} from "../../src/PerpesToken.sol";

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
/// Not ported yet: graduation to the oracle-priced secondary engine, the CLOB
/// and copy vaults. Markets therefore stay on the primary curve.
contract PerpesEngineV1 is Initializable, UUPSUpgradeable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable {
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

    function setTradingPaused(bool paused) external onlyOwner {
        tradingPaused = paused;
        emit TradingPausedSet(paused, block.timestamp);
    }

    function setLaunchPaused(bool paused) external onlyOwner {
        _config.launchPaused = paused;
        emit ConfigUpdated(msg.sender, block.timestamp);
    }

    /// Delisted markets take no new risk; existing positions can still close.
    function delistMarket(address token) external onlyOwner {
        Market storage m = _markets[token];
        if (m.status == MarketStatus.None) revert MarketNotFound();
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
        if (!_oiWithinCap(m, notionalUsdc)) revert PrimaryOpenInterestCapExceeded();
        if ((notionalUsdc * 100) / collateralUsdc > uint256(_currentMaxLeverage(m)) * 100) revert LeverageTooHigh();

        Position memory p = _positions[token][msg.sender];
        _resetTriggersIfFlat(p);
        _settle(p, m);
        if (p.pendingLiquidation) revert PendingLiquidation();

        uint256 priceBefore = m.markPriceE6;
        Fill memory fill = _primaryOpenFill(m, side, notionalUsdc);
        _checkSlippage(side, priceBefore, fill.priceE6, maxSlippageBps);

        uint256 fee = PerpesMath.notionalFee(notionalUsdc, m.takerFeeBps);
        _increase(p, m, side, fill, collateralUsdc);
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
        Market memory m = _loadPrimaryMarket(token);
        _accrue(m);
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
        Position memory p = _positions[token][msg.sender];
        _settle(p, m);
        if (p.pendingLiquidation) revert PendingLiquidation();
        if (p.collateralUsdc < amountUsdc) revert InsufficientCollateral();

        uint256 newCollateral = p.collateralUsdc - amountUsdc;
        // Equity-based: collateral already lost to an unrealized loss isn't the
        // owner's to withdraw; unrealized profit doesn't count toward margin.
        int256 pnl = PerpesMath.unrealizedPnl(
            p.side == Side.Long, p.sizeUsdc, p.baseAmount, _marginPrice(m, p.side, false)
        );
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
        Market memory m = _loadPrimaryMarket(token);
        _accrue(m);
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
            Fill memory fill = _primaryCloseFill(m, side, base);
            _applyReduce(p, m, closeSize, base, released);
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
        _emitPosition(token, owner_, _positions[token][owner_]);
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
        uint256 amount = _min(p.unsettledProfitUsdc, _headroom(m));
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
        Market memory m = _loadPrimaryMarket(token);
        _accrue(m);
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
        _emitPosition(token, owner_, _positions[token][owner_]);
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
        if (m.status != MarketStatus.Warmup && m.status != MarketStatus.Active) revert InvalidMarketStatus();
        if (leverage == 0 || leverage > m.flatMaxLeverageX) revert LeverageTooHigh();
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
        if (!_oiWithinCap(m, fillNotionalUsdc)) revert PrimaryOpenInterestCapExceeded();

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
        Fill memory fill = _primaryOpenFill(m, o.side, f.notional);
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

    // ── Internals: loading / storing ───────────────────────────────────────────

    function _loadMarket(address token) internal view returns (Market memory m) {
        m = _markets[token];
        if (m.status == MarketStatus.None) revert MarketNotFound();
    }

    function _loadPrimaryMarket(address token) internal view returns (Market memory m) {
        m = _loadMarket(token);
        if (m.status == MarketStatus.Graduated) revert InvalidEngineTransition();
    }

    function _loadOpenableMarket(address token) internal view returns (Market memory m) {
        if (tradingPaused) revert TradingPaused();
        m = _loadMarket(token);
        if (m.status != MarketStatus.Warmup && m.status != MarketStatus.Active) revert InvalidMarketStatus();
    }

    function _store(address token, address owner_, Market memory m, Position memory p) internal {
        p.tradeCount += 1;
        _markets[token] = m;
        _positions[token][owner_] = p;
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
            m.indexPriceE6 =
                PerpesMath.ewmaIndexE6(m.indexPriceE6, m.markPriceE6, elapsed, m.referenceUpdateIntervalSeconds);
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
        return block.timestamp < m.warmupUntil ? m.warmupMaxLeverageX : m.maxLeverageX;
    }

    function _oiWithinCap(Market memory m, uint256 incoming) internal pure returns (bool) {
        if (m.maxOiMultiple == 0) return true;
        return m.oiLongUsdc + m.oiShortUsdc + incoming <= m.liquidityDepthUsdc * m.maxOiMultiple;
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
            // zero, so only the headroom cap applies.
            (payNow, deferred) = PerpesMath.splitClosePayout(principal, v - principal, 10_000, _headroom(m));
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
        (uint256 base, uint256 released) = _reduceAmounts(p, closeNotional);
        uint256 priceBefore = m.markPriceE6;
        Fill memory fill = _primaryCloseFill(m, side, base);
        _checkSlippage(_opposite(side), priceBefore, fill.priceE6, maxSlippageBps);
        _applyReduce(p, m, closeNotional, base, released);
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

    /// Vault balance that isn't trader money: insurance plus unclaimed fees.
    function _reserved(Market memory m) internal pure returns (uint256) {
        return m.insuranceTrancheUsdc + m.creatorFeesPendingUsdc + m.protocolFeesPendingUsdc;
    }

    function _headroom(Market memory m) internal pure returns (uint256) {
        return _subFloor(m.vaultBalanceUsdc, _reserved(m));
    }

    function _coverShortfall(address token, Market memory m, uint256 shortfall) internal {
        uint256 covered = _min(shortfall, m.insuranceTrancheUsdc);
        m.insuranceTrancheUsdc -= covered;
        uint256 uncovered = shortfall - covered;
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
        uint256 protocolCut = fee - creatorCut - insuranceCut;
        m.totalFeesCollectedUsdc += fee;
        m.creatorFeesPendingUsdc += creatorCut;
        m.insuranceTrancheUsdc += insuranceCut;
        m.protocolFeesPendingUsdc += protocolCut;
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
        bytes memory data = bytes.concat(
            abi.encode(p.side, p.sizeUsdc, p.baseAmount, p.collateralUsdc, p.entryPriceE6),
            abi.encode(p.tpPriceE6, p.slPriceE6, p.pendingLiquidation, p.unsettledProfitUsdc)
        );
        bytes32 topic0 = PositionState.selector;
        assembly ("memory-safe") {
            log3(add(data, 0x20), mload(data), topic0, owner_, token)
        }
    }
}
