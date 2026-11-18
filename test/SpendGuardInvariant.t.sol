// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {SpendGuard} from "../src/SpendGuard.sol";
import {MockERC20} from "./mocks/Mocks.sol";

/// @notice Stateful invariant tests (threat model section 4.1, P-1..P-12).
/// The handler performs random sequences of every vault operation from
/// random actors and asserts the expected outcome of each call immediately;
/// the invariant functions then assert the global properties after every
/// sequence step. P-9 (events) is covered by expectEmit checks in the unit
/// suite, as the threat model allows.
contract SpendGuardHandler is Test {
    SpendGuard public vault;
    MockERC20 public token;
    address public owner;
    address public attacker;
    address public merchantA;
    address public merchantB;
    address[3] public keys;

    uint256 public totalDeposited;
    uint256 public totalPaid;
    uint256 public totalSwept;
    mapping(address => uint256) public lastSpent;

    constructor(
        SpendGuard vault_,
        MockERC20 token_,
        address owner_,
        address keyA,
        address keyB,
        address attacker_,
        address merchantA_,
        address merchantB_
    ) {
        vault = vault_;
        token = token_;
        owner = owner_;
        attacker = attacker_;
        merchantA = merchantA_;
        merchantB = merchantB_;
        keys = [keyA, keyB, attacker_];
    }

    function _pickKey(uint256 seed) internal view returns (address) {
        return keys[seed % 3];
    }

    function _pickRecipients(uint256 seed) internal view returns (address[] memory recipients) {
        uint256 kind = seed % 4;
        if (kind == 0) {
            recipients = new address[](1);
            recipients[0] = merchantA;
        } else if (kind == 1) {
            recipients = new address[](1);
            recipients[0] = merchantB;
        } else if (kind == 2) {
            recipients = new address[](2);
            recipients[0] = merchantA;
            recipients[1] = merchantB;
        } else {
            recipients = new address[](0); // empty allowlist: grant must fail
        }
    }

    /// Deposit from the owner or the attacker. Must succeed iff amount > 0.
    function deposit(uint256 amount, uint256 funderSeed) public {
        amount = bound(amount, 0, 100_000_000);
        address funder = funderSeed % 2 == 0 ? owner : attacker;
        uint256 before = token.balanceOf(address(vault));
        vm.prank(funder);
        bool success;
        try vault.deposit(amount) {
            success = true;
        } catch {
            success = false;
        }
        assertEq(success, amount > 0, "deposit outcome");
        if (success) {
            assertEq(token.balanceOf(address(vault)) - before, amount, "deposit delta");
            totalDeposited += amount;
        }
    }

    /// Grant with random parameters. Success must match grant validity (P-12).
    function grant(uint256 keySeed, uint256 perTx, uint256 cap, uint256 expiryOffset, uint256 recipientSeed) public {
        address key = _pickKey(keySeed);
        perTx = bound(perTx, 0, 200_000_000);
        cap = bound(cap, 0, 200_000_000);
        expiryOffset = bound(expiryOffset, 0, 3 days);
        uint64 expiry = uint64(block.timestamp + expiryOffset);
        address[] memory recipients = _pickRecipients(recipientSeed);

        bool wasActive = vault.getSession(key).active;
        bool expected = !wasActive && cap > 0 && perTx > 0 && perTx <= cap && expiry > block.timestamp
            && recipients.length > 0;

        vm.prank(owner);
        bool success;
        try vault.grantSession(key, recipients, perTx, cap, expiry) {
            success = true;
        } catch {
            success = false;
        }
        assertEq(success, expected, "grant outcome");
        if (success) {
            // A fresh grant (including a re-grant after revoke) starts with
            // spent == 0 and exactly the granted parameters (P-7, P-12).
            SpendGuard.Session memory s = vault.getSession(key);
            assertEq(s.spent, 0, "fresh grant spent");
            assertEq(s.spendCap, cap, "fresh grant cap");
            assertEq(s.maxPerTx, perTx, "fresh grant perTx");
            assertEq(s.expiresAt, expiry, "fresh grant expiry");
            assertTrue(s.active, "fresh grant active");
            for (uint256 i = 0; i < recipients.length; i++) {
                assertTrue(vault.isRecipientAllowed(key, recipients[i]), "fresh grant allowlist");
            }
            lastSpent[key] = 0;
        }
    }

    /// Revoke. Must succeed iff the key was active (P-7).
    function revoke(uint256 keySeed) public {
        address key = _pickKey(keySeed);
        bool wasActive = vault.getSession(key).active;
        uint256 spentBefore = vault.getSession(key).spent;
        vm.prank(owner);
        bool success;
        try vault.revokeSession(key) {
            success = true;
        } catch {
            success = false;
        }
        assertEq(success, wasActive, "revoke outcome");
        if (success) {
            assertEq(vault.getSession(key).spent, spentBefore, "revoke preserves spent");
        }
    }

    /// Pay from a key. Success must match every payment precondition (P-2,
    /// P-3, P-6, P-8, P-11): active, unexpired, positive amount within the
    /// per-tx and cumulative caps, allowlisted recipient, unpaused, funded.
    function pay(uint256 keySeed, uint256 recipientSeed, uint256 amount) public {
        address key = _pickKey(keySeed);
        address recipient;
        uint256 kind = recipientSeed % 3;
        if (kind == 0) recipient = merchantA;
        else if (kind == 1) recipient = merchantB;
        else recipient = attacker; // never allowlisted
        amount = bound(amount, 0, 200_000_000);

        SpendGuard.Session memory s = vault.getSession(key);
        bool expected = s.active && block.timestamp < s.expiresAt && amount > 0 && amount <= s.maxPerTx
            && s.spent + amount <= s.spendCap && vault.isRecipientAllowed(key, recipient) && !vault.paused()
            && token.balanceOf(address(vault)) >= amount;

        uint256 vaultBefore = token.balanceOf(address(vault));
        uint256 recipientBefore = token.balanceOf(recipient);
        vm.prank(key);
        bool success;
        try vault.executePayment(key, recipient, amount) {
            success = true;
        } catch {
            success = false;
        }
        assertEq(success, expected, "pay outcome");
        if (success) {
            assertEq(vault.getSession(key).spent, lastSpent[key] + amount, "spent increases exactly");
            assertEq(vaultBefore - token.balanceOf(address(vault)), amount, "vault delta");
            assertEq(token.balanceOf(recipient) - recipientBefore, amount, "recipient delta");
            lastSpent[key] = vault.getSession(key).spent;
            totalPaid += amount;
        }
    }

    function pauseOp() public {
        bool wasPaused = vault.paused();
        vm.prank(owner);
        bool success;
        try vault.pause() {
            success = true;
        } catch {
            success = false;
        }
        assertEq(success, !wasPaused, "pause outcome");
    }

    function unpauseOp() public {
        bool wasPaused = vault.paused();
        vm.prank(owner);
        bool success;
        try vault.unpause() {
            success = true;
        } catch {
            success = false;
        }
        assertEq(success, wasPaused, "unpause outcome");
    }

    /// The owner sweep must ALWAYS succeed, in any state (P-4).
    function sweep() public {
        uint256 before = token.balanceOf(address(vault));
        vm.prank(owner);
        bool success;
        try vault.ownerWithdraw() {
            success = true;
        } catch {
            success = false;
        }
        assertTrue(success, "sweep must always succeed");
        assertEq(token.balanceOf(address(vault)), 0, "sweep takes everything");
        totalSwept += before;
    }

    function warpOp(uint256 seconds_) public {
        seconds_ = bound(seconds_, 0, 2 days);
        vm.warp(block.timestamp + seconds_);
    }

    /// Every admin function from a non-owner must fail (P-10).
    function adminFromNonOwner(uint256 fnSeed, uint256 callerSeed) public {
        address caller = callerSeed % 2 == 0 ? keys[0] : attacker;
        uint256 fn = fnSeed % 5;
        vm.prank(caller);
        if (fn == 0) {
            address[] memory recipients = new address[](1);
            recipients[0] = merchantA;
            try vault.grantSession(keys[1], recipients, 1_000_000, 10_000_000, uint64(block.timestamp + 3600)) {
                revert("non-owner grant succeeded");
            } catch {}
        } else if (fn == 1) {
            try vault.revokeSession(keys[1]) {
                revert("non-owner revoke succeeded");
            } catch {}
        } else if (fn == 2) {
            try vault.pause() {
                revert("non-owner pause succeeded");
            } catch {}
        } else if (fn == 3) {
            try vault.unpause() {
                revert("non-owner unpause succeeded");
            } catch {}
        } else {
            try vault.ownerWithdraw() {
                revert("non-owner sweep succeeded");
            } catch {}
        }
    }
}

contract SpendGuardInvariantTest is StdInvariant, Test {
    MockERC20 token;
    SpendGuard vault;
    SpendGuardHandler handler;

    address owner = makeAddr("owner");
    address keyA = makeAddr("keyA");
    address keyB = makeAddr("keyB");
    address attacker = makeAddr("attacker");
    address merchantA = makeAddr("merchantA");
    address merchantB = makeAddr("merchantB");

    function setUp() public {
        token = new MockERC20();
        token.mint(owner, 100_000_000_000);
        token.mint(attacker, 100_000_000_000);
        vm.prank(owner);
        vault = new SpendGuard(address(token));
        vm.prank(owner);
        token.approve(address(vault), type(uint256).max);
        vm.prank(attacker);
        token.approve(address(vault), type(uint256).max);

        handler = new SpendGuardHandler(vault, token, owner, keyA, keyB, attacker, merchantA, merchantB);
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.grant.selector;
        selectors[2] = handler.revoke.selector;
        selectors[3] = handler.pay.selector;
        selectors[4] = handler.pauseOp.selector;
        selectors[5] = handler.unpauseOp.selector;
        selectors[6] = handler.sweep.selector;
        selectors[7] = handler.warpOp.selector;
        // adminFromNonOwner is exercised via its own selector too.
        bytes4[] memory all = new bytes4[](9);
        for (uint256 i = 0; i < 8; i++) all[i] = selectors[i];
        all[8] = handler.adminFromNonOwner.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: all}));
    }

    /// P-1: spent never exceeds the cap, for every key, after any sequence.
    function invariant_SpentWithinCap() public view {
        address[3] memory keys = [keyA, keyB, attacker];
        for (uint256 i = 0; i < keys.length; i++) {
            SpendGuard.Session memory s = vault.getSession(keys[i]);
            assertLe(s.spent, s.spendCap, "spent <= cap");
        }
    }

    /// P-5 / INV-5 / INV-17: solvency. The vault balance is exactly deposits
    /// minus payments minus sweeps, and outflows never exceed deposits.
    function invariant_Solvency() public view {
        assertEq(
            token.balanceOf(address(vault)),
            handler.totalDeposited() - handler.totalPaid() - handler.totalSwept(),
            "balance == deposits - payments - sweeps"
        );
        assertLe(handler.totalPaid() + handler.totalSwept(), handler.totalDeposited(), "outflows <= deposits");
    }

    /// P-12 shape: every active session satisfies the grant-validation rules.
    function invariant_ActiveSessionsValid() public view {
        address[3] memory keys = [keyA, keyB, attacker];
        for (uint256 i = 0; i < keys.length; i++) {
            SpendGuard.Session memory s = vault.getSession(keys[i]);
            if (s.active) {
                assertGt(s.spendCap, 0, "active cap > 0");
                assertGt(s.maxPerTx, 0, "active perTx > 0");
                assertLe(s.maxPerTx, s.spendCap, "active perTx <= cap");
                assertGt(s.recipients.length, 0, "active allowlist non-empty");
            }
        }
    }

    /// P-7 / INV-16 support: the handler's spent mirror matches the vault,
    /// so no spend, revoke, pause, or sweep ever moves `spent` unexpectedly.
    function invariant_SpentMatchesGhost() public view {
        address[3] memory keys = [keyA, keyB, attacker];
        for (uint256 i = 0; i < keys.length; i++) {
            assertEq(vault.getSession(keys[i]).spent, handler.lastSpent(keys[i]), "spent mirror");
        }
    }
}
