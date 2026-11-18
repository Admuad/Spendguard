// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SpendGuard} from "../../src/SpendGuard.sol";

/// @notice Minimal plain ERC-20 with 6 decimals (mirrors tUSD8's decimals).
/// Reverts on failure, like a standard ERC-20. Test scaffolding only.
contract MockERC20 is IERC20 {
    mapping(address => uint256) internal _balances;
    mapping(address => mapping(address => uint256)) internal _allowances;
    uint256 internal _totalSupply;

    string public name = "Test USD8";
    string public symbol = "tUSD8";
    uint8 public decimals = 6;

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 value) external returns (bool) {
        _allowances[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external virtual returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external virtual returns (bool) {
        _spendAllowance(from, msg.sender, value);
        _transfer(from, to, value);
        return true;
    }

    function mint(address to, uint256 value) external {
        require(to != address(0), "zero address");
        _totalSupply += value;
        _balances[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _spendAllowance(address owner, address spender, uint256 value) internal {
        uint256 current = _allowances[owner][spender];
        require(current >= value, "insufficient allowance");
        if (current != type(uint256).max) {
            _allowances[owner][spender] = current - value;
        }
    }

    function _transfer(address from, address to, uint256 value) internal virtual {
        require(from != address(0) && to != address(0), "zero address");
        require(_balances[from] >= value, "insufficient balance");
        _balances[from] -= value;
        _balances[to] += value;
        emit Transfer(from, to, value);
    }
}

/// @notice An ERC-20 that does NOT revert on failure: `transfer` /
/// `transferFrom` return `false` when the move cannot happen. This mirrors
/// the tUSD8 behaviour reported by the starter-kit docs (addendum A-1).
/// `failAllTransfers` simulates a token that silently fails every move.
contract MockNonRevertingERC20 is MockERC20 {
    bool public failAllTransfers;

    function setFailAllTransfers(bool fail) external {
        failAllTransfers = fail;
    }

    function transfer(address to, uint256 value) external override returns (bool) {
        if (failAllTransfers) return false;
        if (to == address(0) || _balances[msg.sender] < value) return false;
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external override returns (bool) {
        if (failAllTransfers) return false;
        if (to == address(0) || _balances[from] < value) return false;
        uint256 current = _allowances[from][msg.sender];
        if (current < value) return false;
        if (current != type(uint256).max) {
            _allowances[from][msg.sender] = current - value;
        }
        _transfer(from, to, value);
        return true;
    }
}

/// @notice An ERC-20 that calls back into the recipient after every transfer
/// (models a transfer hook / ERC-777-style callback). Hook failures are
/// ignored so the transfer itself still completes; the vault's reentrancy
/// guard is what must stop the re-entrant call. Test scaffolding only.
contract MockHookERC20 is MockERC20 {
    function transfer(address to, uint256 value) external override returns (bool) {
        _transfer(msg.sender, to, value);
        _callHook(to);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external override returns (bool) {
        _spendAllowance(from, msg.sender, value);
        _transfer(from, to, value);
        _callHook(to);
        return true;
    }

    function _callHook(address to) internal {
        if (to.code.length > 0) {
            // Ignore the result: the hook must not be able to revert the
            // transfer, so only the vault's own guard can stop reentrancy.
            (bool ok,) = to.call("");
            ok;
        }
    }
}

/// @notice A malicious recipient contract. Its fallback re-enters
/// `executePayment` for its own session key on every incoming token
/// transfer. `reentryAttempts` counts tries, `reentrySuccesses` counts
/// inner calls that actually moved funds (must stay 0).
contract MaliciousRecipient {
    SpendGuard public vault;
    uint256 public reentryAttempts;
    uint256 public reentrySuccesses;

    constructor(SpendGuard vault_) {
        vault = vault_;
    }

    /// @notice Outer payment call: this contract IS the session key.
    function pay(address recipient, uint256 amount) external {
        vault.executePayment(address(this), recipient, amount);
    }

    receive() external payable {
        _attack();
    }

    fallback() external payable {
        _attack();
    }

    function _attack() internal {
        reentryAttempts++;
        try vault.executePayment(address(this), address(this), 1) {
            reentrySuccesses++;
        } catch {
            // Expected: the reentrancy guard (or the cap check) reverts.
        }
    }
}

/// @notice A malicious owner harness: deploys the vault (so it IS the owner),
/// deposits, and re-enters `ownerWithdraw` from its fallback on every
/// incoming token transfer.
contract MaliciousOwner {
    SpendGuard public vault;
    uint256 public reentryAttempts;
    uint256 public reentrySuccesses;

    constructor(address token) {
        vault = new SpendGuard(token, address(this));
    }

    function deposit(uint256 amount) external {
        vault.deposit(amount);
    }

    function sweep() external {
        vault.ownerWithdraw();
    }

    receive() external payable {
        _attack();
    }

    fallback() external payable {
        _attack();
    }

    function _attack() internal {
        reentryAttempts++;
        try vault.ownerWithdraw() {
            reentrySuccesses++;
        } catch {
            // Expected: the reentrancy guard reverts the inner sweep.
        }
    }
}
