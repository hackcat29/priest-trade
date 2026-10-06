// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";

/// What a market's vault needs from the engine.
interface ILpEngine {
    /// The market's equity — what it holds beyond everything it owes its
    /// traders, creator and protocol — valued at the mark and at the live pool,
    /// were the vault to hold `vaultCash` (its cash sets winners' profit budget).
    function lpClaim(address market, uint256 vaultCash) external view returns (int256 atMark, int256 atSpot);
    function lpDepositsOpen(address market) external view returns (bool);
    function lpRedeemCooldown() external view returns (uint64);
    /// First deposit: the market's equity so far, and who it belongs to.
    function lpActivate(address market) external returns (uint256 equityUsdc, address owner);
    function syncCounterflow(address market) external;
}

/// @title CounterflowVault
/// @notice One oracle market's liquidity. Anyone deposits USDC for shares and
/// becomes the counterparty to that market's traders — and no other market's.
/// Winners get their collateral back in full and their profit pro rata to what
/// the market can pay plus this vault's profit budget (a share of its cash) —
/// the rest of their profit is forfeited, so the vault's exposure is capped and
/// shrinks as it pays. In return the vault owns the market's equity: 70% of
/// every fee, liquidation penalties, forfeited profit and what traders lose.
///
/// Share value is marked to market: vault cash plus the market's equity (its
/// free USDC, plus what losers owe, minus what winners can claim). That equity
/// is read at both the mark and the live pool price; entries price at the
/// higher, exits at the lower, so nobody can deposit just before traders'
/// losses are realized or leave just before their profit is. A deposit also
/// pays for its own effect: its cash raises winners' profit budget, and the
/// depositor — not the existing LPs — bears that.
///
/// Equity the market built up before its first deposit (fees and trader losses
/// while nobody backed it) is minted as shares to the protocol at the first
/// deposit — owned, not given to whoever deposits first.
///
/// Exits are requested, wait out the engine's cooldown, then redeem at the
/// share price at claim time, from the vault's cash.
contract CounterflowVault is Initializable, ERC4626Upgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;
    using Math for uint256;

    struct RedeemRequest {
        address owner;
        uint64 unlockAt;
        uint256 shares;
    }

    /// The Perpes engine — the only caller of `cover` and `onIncome`.
    address public engine;
    /// The market this vault backs (its token).
    address public market;
    /// Paid out to the market and not yet repaid.
    uint256 public exposure;

    mapping(uint256 id => RedeemRequest) public redeemRequests;
    uint256 public nextRequestId;
    /// Every request id an owner has made (claimed / cancelled ones read back empty).
    mapping(address owner => uint256[]) internal _requestIds;

    event Activated(address indexed owner, uint256 equityUsdc, uint256 shares);
    event Covered(uint256 requested, uint256 paid, uint256 exposure);
    event Income(uint256 amount, uint256 repaid, uint256 exposure);
    event RedeemRequested(uint256 indexed id, address indexed owner, uint256 shares, uint256 unlockAt);
    event RedeemCancelled(uint256 indexed id, address indexed owner, uint256 shares);
    event RedeemClaimed(uint256 indexed id, address indexed owner, uint256 shares, uint256 assets);

    error OnlyEngine();
    error InvalidParams();
    error NotRequestOwner();
    error CooldownActive(uint64 unlockAt);
    error InsufficientLiquidity(uint256 available);
    error DepositsClosed();
    error VaultUnderwater();

    modifier onlyEngine() {
        if (msg.sender != engine) revert OnlyEngine();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// Called by the engine through a beacon proxy, one per market.
    function initialize(address engine_, address market_, IERC20 usdc_) external initializer {
        string memory sym = _symbolOf(market_);
        __ERC20_init(string.concat("Counterflow ", sym), string.concat("cf", sym));
        __ERC4626_init(usdc_);
        __ReentrancyGuard_init();
        engine = engine_;
        market = market_;
    }

    function _symbolOf(address token) internal view returns (string memory) {
        try IERC20Metadata(token).symbol() returns (string memory s) {
            uint256 n = bytes(s).length;
            if (n > 0 && n <= 20) return s;
        } catch {}
        return "LP";
    }

    // ── NAV ──────────────────────────────────────────────────────────────────

    /// USDC the vault holds — what it can cover with and pay exits from.
    function cash() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// Vault value at the lower and higher of the two prices. Before the first
    /// deposit only cash counts (the market's equity isn't the vault's yet).
    function navRange() public view returns (uint256 low, uint256 high) {
        uint256 c = cash();
        if (totalSupply() == 0) return (c, c);
        (int256 a, int256 b) = _navAt(c);
        (int256 lo, int256 hi) = a < b ? (a, b) : (b, a);
        low = lo > 0 ? uint256(lo) : 0;
        high = hi > 0 ? uint256(hi) : 0;
    }

    /// Vault value at the mark.
    function totalAssets() public view override returns (uint256) {
        uint256 c = cash();
        if (totalSupply() == 0) return c;
        (int256 v,) = _navAt(c);
        return v > 0 ? uint256(v) : 0;
    }

    /// Vault value (at the mark, at the pool) were it to hold `cashAmount`.
    function _navAt(uint256 cashAmount) internal view returns (int256 atMark, int256 atSpot) {
        (int256 m, int256 s) = ILpEngine(engine).lpClaim(market, cashAmount);
        atMark = int256(cashAmount) + m;
        atSpot = int256(cashAmount) + s;
    }

    /// Dead shares make the first-deposit inflation attack uneconomic.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function _toShares(uint256 assets, uint256 nav, Math.Rounding r) internal view returns (uint256) {
        return assets.mulDiv(totalSupply() + 10 ** _decimalsOffset(), nav + 1, r);
    }

    function _toAssets(uint256 shares, uint256 nav, Math.Rounding r) internal view returns (uint256) {
        return shares.mulDiv(nav + 1, totalSupply() + 10 ** _decimalsOffset(), r);
    }

    /// Entries at the higher NAV, exits at the lower. A deposit is credited
    /// only with what it adds to the vault's value — its cash, less what that
    /// cash lets winners claim (the larger effect of the two prices).
    function previewDeposit(uint256 assets) public view override returns (uint256) {
        uint256 c = cash();
        if (totalSupply() == 0) return _toShares(assets, c, Math.Rounding.Floor);
        (int256 m0, int256 s0) = _navAt(c);
        (int256 m1, int256 s1) = _navAt(c + assets);
        int256 dm = m1 - m0;
        int256 ds = s1 - s0;
        int256 added = dm < ds ? dm : ds;
        if (added <= 0) return 0;
        int256 hi = m0 > s0 ? m0 : s0;
        return _toShares(uint256(added), hi > 0 ? uint256(hi) : 0, Math.Rounding.Floor);
    }

    /// Shares-denominated entry can't price a deposit's own effect; use `deposit`.
    function previewMint(uint256) public pure override returns (uint256) {
        revert InvalidParams();
    }

    function previewRedeem(uint256 shares) public view override returns (uint256) {
        (uint256 low,) = navRange();
        return _toAssets(shares, low, Math.Rounding.Floor);
    }

    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        (uint256 low,) = navRange();
        return _toShares(assets, low, Math.Rounding.Ceil);
    }

    // ── Deposits ─────────────────────────────────────────────────────────────

    function maxDeposit(address) public view override returns (uint256) {
        return ILpEngine(engine).lpDepositsOpen(market) ? type(uint256).max : 0;
    }

    function maxMint(address) public pure override returns (uint256) {
        return 0;
    }

    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256 shares) {
        _beforeEntry();
        shares = previewDeposit(assets);
        if (shares == 0) revert InvalidParams();
        _deposit(_msgSender(), receiver, assets, shares);
    }

    function mint(uint256, address) public pure override returns (uint256) {
        revert InvalidParams();
    }

    /// Deposits must be open. The first one takes over the market: its equity
    /// so far is minted to its owner (the protocol) at the opening price.
    /// Later ones need a vault that's worth something.
    function _beforeEntry() internal {
        if (!ILpEngine(engine).lpDepositsOpen(market)) revert DepositsClosed();
        if (totalSupply() == 0) {
            (uint256 equity, address owner) = ILpEngine(engine).lpActivate(market);
            uint256 shares = _toShares(equity, cash(), Math.Rounding.Floor);
            if (shares > 0) _mint(owner, shares);
            emit Activated(owner, equity, shares);
            return;
        }
        (, uint256 high) = navRange();
        if (high == 0) revert VaultUnderwater();
    }

    // ── Withdrawals ──────────────────────────────────────────────────────────

    /// Exits go through requestRedeem / claimRedeem.
    function maxWithdraw(address) public pure override returns (uint256) {
        return 0;
    }

    function maxRedeem(address) public pure override returns (uint256) {
        return 0;
    }

    /// Escrows `shares` in the vault; they keep sharing gains and losses until claimed.
    function requestRedeem(uint256 shares) external nonReentrant returns (uint256 id) {
        if (shares == 0) revert InvalidParams();
        _transfer(msg.sender, address(this), shares);
        id = nextRequestId++;
        uint64 unlockAt = uint64(block.timestamp) + ILpEngine(engine).lpRedeemCooldown();
        redeemRequests[id] = RedeemRequest({owner: msg.sender, unlockAt: unlockAt, shares: shares});
        _requestIds[msg.sender].push(id);
        emit RedeemRequested(id, msg.sender, shares, unlockAt);
    }

    function cancelRedeem(uint256 id) external nonReentrant {
        RedeemRequest memory r = redeemRequests[id];
        if (r.owner != msg.sender) revert NotRequestOwner();
        delete redeemRequests[id];
        _transfer(address(this), msg.sender, r.shares);
        emit RedeemCancelled(id, msg.sender, r.shares);
    }

    /// Redeems a matured request at the lower NAV. When the vault's cash falls
    /// short it first pulls the market's sweepable equity; if that's still not
    /// enough (value tied up in open positions or out covering the market) it
    /// redeems the part the cash covers and leaves the rest of the request open.
    function claimRedeem(uint256 id) external nonReentrant returns (uint256 assets) {
        RedeemRequest memory r = redeemRequests[id];
        if (r.owner != msg.sender) revert NotRequestOwner();
        if (block.timestamp < r.unlockAt) revert CooldownActive(r.unlockAt);
        assets = previewRedeem(r.shares);
        if (assets == 0) revert VaultUnderwater();
        uint256 shares = r.shares;
        if (assets > cash()) {
            try ILpEngine(engine).syncCounterflow(market) {} catch {}
            assets = previewRedeem(shares);
            uint256 available = cash();
            if (assets > available) {
                shares = shares.mulDiv(available, assets);
                assets = previewRedeem(shares);
                if (shares == 0 || assets == 0) revert InsufficientLiquidity(available);
            }
        }
        if (shares == r.shares) delete redeemRequests[id];
        else redeemRequests[id].shares = r.shares - shares;
        _withdraw(address(this), r.owner, address(this), assets, shares);
        emit RedeemClaimed(id, r.owner, shares, assets);
    }

    /// An owner's open requests (ids and their state), for wallets and the app.
    function requestsOf(address owner_) external view returns (uint256[] memory ids, RedeemRequest[] memory open) {
        uint256[] storage all = _requestIds[owner_];
        uint256 n;
        for (uint256 i; i < all.length; i++) {
            if (redeemRequests[all[i]].owner == owner_) n++;
        }
        ids = new uint256[](n);
        open = new RedeemRequest[](n);
        uint256 k;
        for (uint256 i; i < all.length; i++) {
            RedeemRequest memory r = redeemRequests[all[i]];
            if (r.owner == owner_) {
                ids[k] = all[i];
                open[k++] = r;
            }
        }
    }

    // ── Engine ───────────────────────────────────────────────────────────────

    /// The engine asks for `amount` to pay the market's winners; gets what the
    /// vault holds, up to that.
    function cover(uint256 amount) external onlyEngine nonReentrant returns (uint256 paid) {
        uint256 available = cash();
        paid = amount < available ? amount : available;
        if (paid == 0) return 0;
        exposure += paid;
        IERC20(asset()).safeTransfer(engine, paid);
        emit Covered(amount, paid, exposure);
    }

    /// The engine has swept `amount` of the market's equity here; `repaid` of
    /// it settles earlier cover. No reentrancy guard: `claimRedeem` triggers it.
    function onIncome(uint256 amount, uint256 repaid) external onlyEngine {
        uint256 r = repaid < exposure ? repaid : exposure;
        exposure -= r;
        emit Income(amount, r, exposure);
    }
}
