// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SpendGuard} from "../src/SpendGuard.sol";
import {SpendGuardFactory} from "../src/SpendGuardFactory.sol";
import {MockERC20} from "./mocks/Mocks.sol";

/// @notice Factory tests: one independent vault per user, and proof that no
/// vault can touch another vault's funds, keys, or admin functions.
/// Amounts are in tUSD8 base units (6 decimals): 1 tUSD8 == 1_000_000.
contract SpendGuardFactoryTest is Test {
    event VaultCreated(address indexed owner, address indexed vault, uint256 index);

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address keyA = makeAddr("keyA");
    address merchant = makeAddr("merchant");
    address stranger = makeAddr("stranger");

    MockERC20 token;
    SpendGuardFactory factory;

    function setUp() public {
        token = new MockERC20();
        factory = new SpendGuardFactory(address(token));
        token.mint(alice, 10_000_000_000);
        token.mint(bob, 10_000_000_000);
    }

    function _createAs(address who) internal returns (SpendGuard vault) {
        vm.prank(who);
        address vaultAddr = factory.createVault();
        vault = SpendGuard(vaultAddr);
    }

    function _depositAs(address who, SpendGuard vault, uint256 amount) internal {
        vm.startPrank(who);
        token.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }

    function _one(address r) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = r;
    }

    // ------------------------------------------------------------------
    // Creation and registry
    // ------------------------------------------------------------------

    function test_CreateVault_SetsOwnerAndToken() public {
        SpendGuard vault = _createAs(alice);
        assertEq(vault.owner(), alice);
        assertEq(address(vault.token()), address(token));
        assertEq(factory.vaultCount(), 1);
        address[] memory owned = factory.vaultsOf(alice);
        assertEq(owned.length, 1);
        assertEq(owned[0], address(vault));
    }

    function test_CreateVault_EmitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(factory));
        emit VaultCreated(alice, address(0), 0);
        factory.createVault();
    }

    function test_CreateVault_MultiplePerOwner() public {
        SpendGuard first = _createAs(alice);
        SpendGuard second = _createAs(alice);
        assertTrue(address(first) != address(second));
        address[] memory owned = factory.vaultsOf(alice);
        assertEq(owned.length, 2);
        assertEq(factory.vaultCount(), 2);
        assertEq(factory.allVaults(0), address(first));
        assertEq(factory.allVaults(1), address(second));
    }

    function test_VaultsOf_EmptyForStranger() public {
        _createAs(alice);
        assertEq(factory.vaultsOf(stranger).length, 0);
        assertEq(factory.vaultsOf(bob).length, 0);
    }

    function test_FactoryZeroTokenReverts() public {
        vm.expectRevert(SpendGuardFactory.ZeroAddress.selector);
        new SpendGuardFactory(address(0));
    }

    // ------------------------------------------------------------------
    // Isolation: balances, keys, and admin powers never cross vaults
    // ------------------------------------------------------------------

    function test_Isolation_BalancesIndependent() public {
        SpendGuard vaultA = _createAs(alice);
        SpendGuard vaultB = _createAs(bob);
        _depositAs(alice, vaultA, 100_000_000);
        _depositAs(bob, vaultB, 50_000_000);
        assertEq(vaultA.vaultBalance(), 100_000_000);
        assertEq(vaultB.vaultBalance(), 50_000_000);

        // Alice sweeping her vault leaves Bob's untouched.
        vm.prank(alice);
        vaultA.ownerWithdraw();
        assertEq(vaultA.vaultBalance(), 0);
        assertEq(vaultB.vaultBalance(), 50_000_000);
    }

    function test_Isolation_KeyCannotSpendOtherVault() public {
        SpendGuard vaultA = _createAs(alice);
        SpendGuard vaultB = _createAs(bob);
        _depositAs(alice, vaultA, 100_000_000);
        _depositAs(bob, vaultB, 100_000_000);
        vm.prank(alice);
        vaultA.grantSession(keyA, _one(merchant), 10_000_000, 50_000_000, uint64(block.timestamp + 3600));

        // The key is valid on Alice's vault only. On Bob's vault it has no
        // session at all, so the payment reverts before any funds move.
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.SessionNotActive.selector);
        vaultB.executePayment(keyA, merchant, 1_000_000);
        assertEq(vaultB.vaultBalance(), 100_000_000);

        // And it works on its own vault.
        vm.prank(keyA);
        vaultA.executePayment(keyA, merchant, 1_000_000);
        assertEq(vaultA.vaultBalance(), 99_000_000);
    }

    function test_Isolation_OwnerCannotSweepOtherVault() public {
        SpendGuard vaultA = _createAs(alice);
        SpendGuard vaultB = _createAs(bob);
        _depositAs(bob, vaultB, 50_000_000);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vaultB.ownerWithdraw();
        assertEq(vaultB.vaultBalance(), 50_000_000);
    }

    function test_Isolation_GrantAndPauseDoNotCrossVaults() public {
        SpendGuard vaultA = _createAs(alice);
        SpendGuard vaultB = _createAs(bob);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vaultB.grantSession(keyA, _one(merchant), 1, 1, uint64(block.timestamp + 3600));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vaultB.pause();
        assertFalse(vaultB.paused());
    }

    function test_FactoryHoldsNoFunds() public {
        SpendGuard vaultA = _createAs(alice);
        _depositAs(alice, vaultA, 100_000_000);
        assertEq(token.balanceOf(address(factory)), 0);
    }

    function test_Isolation_PauseOneVaultLeavesOtherLive() public {
        SpendGuard vaultA = _createAs(alice);
        SpendGuard vaultB = _createAs(bob);
        _depositAs(alice, vaultA, 100_000_000);
        _depositAs(bob, vaultB, 100_000_000);
        vm.prank(bob);
        vaultB.grantSession(keyA, _one(merchant), 10_000_000, 50_000_000, uint64(block.timestamp + 3600));
        vm.prank(alice);
        vaultA.pause();

        // Bob's vault still pays while Alice's is paused.
        vm.prank(keyA);
        vaultB.executePayment(keyA, merchant, 1_000_000);
        assertEq(vaultB.vaultBalance(), 99_000_000);
    }

    function test_Isolation_EditDoesNotCrossVaults() public {
        SpendGuard vaultA = _createAs(alice);
        SpendGuard vaultB = _createAs(bob);
        _depositAs(alice, vaultA, 100_000_000);
        _depositAs(bob, vaultB, 100_000_000);
        uint64 expiry = uint64(block.timestamp + 3600);
        // The SAME key address holds a session in both vaults.
        vm.prank(alice);
        vaultA.grantSession(keyA, _one(merchant), 10_000_000, 50_000_000, expiry);
        vm.prank(bob);
        vaultB.grantSession(keyA, _one(merchant), 10_000_000, 50_000_000, expiry);

        // Alice cannot edit Bob's session at all.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vaultB.editSession(keyA, _one(merchant), 1_000_000, 5_000_000, expiry);

        // Alice edits her own session: lower cap, tighter per-tx.
        vm.prank(alice);
        vaultA.editSession(keyA, _one(merchant), 1_000_000, 5_000_000, expiry);

        // Bob's session is untouched.
        SpendGuard.Session memory b = vaultB.getSession(keyA);
        assertEq(b.spendCap, 50_000_000, "bob cap unchanged");
        assertEq(b.maxPerTx, 10_000_000, "bob perTx unchanged");
        assertTrue(b.active, "bob session active");
        vm.prank(keyA);
        vaultB.executePayment(keyA, merchant, 10_000_000); // pays under bob's bounds
        assertEq(vaultB.getSession(keyA).spent, 10_000_000);
        assertEq(vaultA.getSession(keyA).spent, 0, "alice session unspent");
    }
}
