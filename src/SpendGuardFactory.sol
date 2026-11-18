// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SpendGuard} from "./SpendGuard.sol";

/// @title SpendGuardFactory
/// @notice Creates one independent SpendGuard vault per user.
/// @dev Anyone may create a vault; the caller becomes that vault's owner.
/// Vaults are full deployments (not proxies): each vault is a standalone
/// contract holding only its owner's funds, so one vault can never spend,
/// sweep, or read another vault's balance. There is no shared pool and no
/// per-user ledger to get wrong.
///
/// The factory itself is deliberately powerless: it holds no funds, has no
/// owner, no pause, no upgrade path, and no function that touches a vault
/// after creation. Its only state is the registry below, which the UI reads
/// to find a user's vaults. A compromised or buggy factory could at worst
/// misreport the registry; it could never move funds, because it holds
/// none and owns no vault.
///
/// Gas note: full deployments cost more than minimal-proxy clones. That is
/// a deliberate trade for this build: no initializer pattern, no proxy
/// storage-layout risk, and the vault logic stays exactly the code the
/// test suite proves. Clones are a documented roadmap optimisation, not a
/// correctness need on a testnet with free faucet gas.
contract SpendGuardFactory {
    /// @notice The token every vault created here holds (tUSD8 on Aevum testnet).
    IERC20 public immutable token;

    /// @notice Every vault ever created, in creation order.
    address[] public allVaults;

    /// @notice Vaults created by each owner, in creation order.
    mapping(address => address[]) private _vaultsByOwner;

    event VaultCreated(address indexed owner, address indexed vault, uint256 index);

    error ZeroAddress();

    constructor(address token_) {
        if (token_ == address(0)) revert ZeroAddress();
        token = IERC20(token_);
    }

    /// @notice Create a new vault owned by the caller. Returns the vault
    /// address. The caller funds it with `deposit` and grants session keys
    /// on the vault itself; the factory plays no further part.
    function createVault() external returns (address vault) {
        vault = address(new SpendGuard(address(token), msg.sender));
        _vaultsByOwner[msg.sender].push(vault);
        allVaults.push(vault);
        emit VaultCreated(msg.sender, vault, allVaults.length - 1);
    }

    /// @notice All vaults owned by `owner`, in creation order. Empty if the
    /// owner has never created one.
    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaultsByOwner[owner];
    }

    /// @notice How many vaults exist in total.
    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
