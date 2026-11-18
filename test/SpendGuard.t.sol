// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SpendGuard} from "../src/SpendGuard.sol";
import {MockERC20, MockNonRevertingERC20, MockHookERC20, MaliciousRecipient, MaliciousOwner} from "./mocks/Mocks.sol";

/// @notice Scripted adversarial scenarios (threat model section 4.2, T-1..T-15)
/// plus happy-path, event, view, and non-reverting-token tests.
/// Amounts are in tUSD8 base units (6 decimals): 1 tUSD8 == 1_000_000.
contract SpendGuardTest is Test {
    // Events redeclared for vm.expectEmit checks (INV-15).
    event Deposit(address indexed depositor, uint256 amount, uint256 newBalance);
    event SessionGranted(
        address indexed sessionKey, address[] recipients, uint256 maxPerTx, uint256 spendCap, uint256 expiresAt
    );
    event SessionEdited(
        address indexed sessionKey, address[] recipients, uint256 maxPerTx, uint256 spendCap, uint256 expiresAt
    );
    event SessionRevoked(address indexed sessionKey, uint256 spent, uint256 remainingCap);
    event PaymentExecuted(
        address indexed sessionKey, address indexed recipient, uint256 amount, uint256 newSpent, uint256 remainingCap
    );
    event OwnerWithdraw(address indexed owner, uint256 amount, uint256 newBalance);

    address owner = makeAddr("owner");
    address keyA = makeAddr("keyA");
    address keyB = makeAddr("keyB");
    address merchantA = makeAddr("merchantA");
    address merchantB = makeAddr("merchantB");
    address attacker = makeAddr("attacker");

    uint256 constant CAP = 50_000_000; // 50 tUSD8
    uint256 constant PER_TX = 10_000_000; // 10 tUSD8
    uint256 constant VAULT_FUNDS = 500_000_000; // 500 tUSD8

    MockERC20 token;
    SpendGuard vault;
    uint64 expiry;

    function setUp() public {
        token = new MockERC20();
        token.mint(owner, 10_000_000_000); // 10,000 tUSD8
        vm.prank(owner);
        vault = new SpendGuard(address(token), owner);
        expiry = uint64(block.timestamp + 3600);
        _depositAs(owner, VAULT_FUNDS);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _one(address r) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = r;
    }

    function _grant(address key, address[] memory recipients, uint256 perTx, uint256 cap, uint64 exp) internal {
        vm.prank(owner);
        vault.grantSession(key, recipients, perTx, cap, exp);
    }

    function _grantDefault(address key) internal {
        _grant(key, _one(merchantA), PER_TX, CAP, expiry);
    }

    function _edit(address key, address[] memory recipients, uint256 perTx, uint256 cap, uint64 exp) internal {
        vm.prank(owner);
        vault.editSession(key, recipients, perTx, cap, exp);
    }

    function _depositAs(address who, uint256 amount) internal {
        vm.startPrank(who);
        token.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }

    function _payAs(address key, address recipient, uint256 amount) internal {
        vm.prank(key);
        vault.executePayment(key, recipient, amount);
    }

    function _spent(address key) internal view returns (uint256) {
        return vault.getSession(key).spent;
    }

    // ------------------------------------------------------------------
    // Happy path
    // ------------------------------------------------------------------

    function test_HappyPath_DepositGrantPay() public {
        uint256 merchantBefore = token.balanceOf(merchantA);
        _grantDefault(keyA);
        _payAs(keyA, merchantA, 5_000_000);
        assertEq(token.balanceOf(merchantA), merchantBefore + 5_000_000);
        assertEq(_spent(keyA), 5_000_000);
        assertEq(vault.remainingCap(keyA), CAP - 5_000_000);
        assertEq(vault.vaultBalance(), VAULT_FUNDS - 5_000_000);
    }

    function test_DepositByNonOwner() public {
        token.mint(attacker, 100_000_000);
        uint256 before = vault.vaultBalance();
        _depositAs(attacker, 100_000_000);
        assertEq(vault.vaultBalance(), before + 100_000_000);
    }

    function test_ConstructorZeroTokenReverts() public {
        vm.expectRevert(SpendGuard.ZeroAddress.selector);
        new SpendGuard(address(0), owner);
    }

    function test_ConstructorZeroOwnerReverts() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new SpendGuard(address(token), address(0));
    }

    function test_ZeroDepositReverts() public {
        vm.prank(owner);
        vm.expectRevert(SpendGuard.ZeroAmount.selector);
        vault.deposit(0);
    }

    // ------------------------------------------------------------------
    // T-1..T-15: scripted adversarial scenarios
    // ------------------------------------------------------------------

    /// T-1 (A-1, INV-1): five in-cap payments succeed; the sixth reverts.
    function test_T1_OverCapReverts() public {
        _grantDefault(keyA);
        for (uint256 i = 0; i < 5; i++) {
            _payAs(keyA, merchantA, PER_TX);
        }
        assertEq(_spent(keyA), CAP);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.CapExceeded.selector);
        vault.executePayment(keyA, merchantA, PER_TX);
        assertEq(_spent(keyA), CAP);
    }

    /// T-2 (A-4, INV-2): expiry is a hard cutoff at `expiresAt`.
    function test_T2_ExpiryBoundary() public {
        _grantDefault(keyA);
        vm.warp(expiry - 1);
        _payAs(keyA, merchantA, 1_000_000); // succeeds one second before expiry
        vm.warp(expiry);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.SessionExpired.selector);
        vault.executePayment(keyA, merchantA, 1_000_000);
        vm.warp(expiry + 1);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.SessionExpired.selector);
        vault.executePayment(keyA, merchantA, 1_000_000);
        assertEq(_spent(keyA), 1_000_000);
    }

    /// T-3 (A-5, INV-2/INV-7): revoke is immediate; later payments revert.
    function test_T3_RevokeThenSpendReverts() public {
        _grantDefault(keyA);
        _payAs(keyA, merchantA, 5_000_000);
        vm.prank(owner);
        vault.revokeSession(keyA);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.SessionNotActive.selector);
        vault.executePayment(keyA, merchantA, 5_000_000);
        assertEq(_spent(keyA), 5_000_000);
    }

    /// T-4 (A-3, INV-3): payments to non-allowlisted recipients revert.
    function test_T4_WrongRecipientReverts() public {
        _grantDefault(keyA);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.RecipientNotAllowed.selector);
        vault.executePayment(keyA, merchantB, 5_000_000);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.RecipientNotAllowed.selector);
        vault.executePayment(keyA, keyA, 5_000_000);
        assertEq(_spent(keyA), 0);
        assertEq(vault.vaultBalance(), VAULT_FUNDS);
    }

    /// T-5 (A-2, INV-8): single payments above maxPerTx revert.
    function test_T5_OverPerTxReverts() public {
        _grantDefault(keyA);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.PerTxLimitExceeded.selector);
        vault.executePayment(keyA, merchantA, PER_TX + 1);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.PerTxLimitExceeded.selector);
        vault.executePayment(keyA, merchantA, CAP);
        assertEq(_spent(keyA), 0);
    }

    /// T-6 (A-6, INV-9/INV-10): reentrancy via a hook token is blocked.
    function test_T6_ReentrancyAttempt() public {
        MockHookERC20 hookToken = new MockHookERC20();
        hookToken.mint(owner, 1_000_000_000);
        vm.prank(owner);
        SpendGuard hookVault = new SpendGuard(address(hookToken), owner);
        vm.startPrank(owner);
        hookToken.approve(address(hookVault), VAULT_FUNDS);
        hookVault.deposit(VAULT_FUNDS);
        vm.stopPrank();

        MaliciousRecipient evil = new MaliciousRecipient(hookVault);
        address[] memory recipients = new address[](1);
        recipients[0] = address(evil);
        vm.prank(owner);
        hookVault.grantSession(address(evil), recipients, PER_TX, CAP, expiry);

        uint256 vaultBefore = hookToken.balanceOf(address(hookVault));
        evil.pay(address(evil), 5_000_000);

        assertEq(evil.reentryAttempts(), 1, "reentrant attempt must have happened");
        assertEq(evil.reentrySuccesses(), 0, "reentrant call must not move funds");
        assertEq(hookVault.getSession(address(evil)).spent, 5_000_000, "outer payment exactly once");
        assertEq(hookToken.balanceOf(address(hookVault)), vaultBefore - 5_000_000);
        assertEq(hookToken.balanceOf(address(evil)), 5_000_000);
    }

    /// T-6b: reentrancy into ownerWithdraw from a malicious owner contract.
    function test_T6b_ReentrancyOwnerWithdraw() public {
        MockHookERC20 hookToken = new MockHookERC20();
        MaliciousOwner harness = new MaliciousOwner(address(hookToken));
        SpendGuard hookVault = harness.vault();
        hookToken.mint(address(harness), VAULT_FUNDS);
        vm.prank(address(harness));
        hookToken.approve(address(hookVault), VAULT_FUNDS);
        harness.deposit(VAULT_FUNDS);

        harness.sweep();

        assertEq(harness.reentryAttempts(), 1, "reentrant sweep attempt must have happened");
        assertEq(harness.reentrySuccesses(), 0, "reentrant sweep must not move funds");
        assertEq(hookToken.balanceOf(address(harness.vault())), 0);
        assertEq(hookToken.balanceOf(address(harness)), VAULT_FUNDS);
    }

    /// T-7 (A-8, INV-6): pause blocks payments, never the owner sweep.
    function test_T7_PauseThenSpendReverts_SweepStillWorks() public {
        _grantDefault(keyA);
        _payAs(keyA, merchantA, 5_000_000);
        vm.prank(owner);
        vault.pause();
        vm.prank(keyA);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.executePayment(keyA, merchantA, 5_000_000);
        // Sweep works while paused.
        uint256 ownerBefore = token.balanceOf(owner);
        vm.prank(owner);
        vault.ownerWithdraw();
        assertEq(token.balanceOf(owner), ownerBefore + VAULT_FUNDS - 5_000_000);
        assertEq(vault.vaultBalance(), 0);
        // Re-fund, unpause, payments resume within the remaining cap.
        _depositAs(owner, VAULT_FUNDS);
        vm.prank(owner);
        vault.unpause();
        _payAs(keyA, merchantA, 5_000_000);
        assertEq(_spent(keyA), 10_000_000);
    }

    /// T-8 (A-8a, INV-12): every admin function reverts for non-owners.
    function test_T8_NonOwnerAdminReverts() public {
        address[] memory callers = new address[](2);
        callers[0] = keyA;
        callers[1] = attacker;
        for (uint256 i = 0; i < callers.length; i++) {
            address caller = callers[i];
            bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, caller);
            vm.prank(caller);
            vm.expectRevert(err);
            vault.grantSession(keyA, _one(merchantA), PER_TX, CAP, expiry);
            vm.prank(caller);
            vm.expectRevert(err);
            vault.revokeSession(keyA);
            vm.prank(caller);
            vm.expectRevert(err);
            vault.pause();
            vm.prank(caller);
            vm.expectRevert(err);
            vault.unpause();
            vm.prank(caller);
            vm.expectRevert(err);
            vault.ownerWithdraw();
        }
        assertFalse(vault.paused());
        assertEq(vault.vaultBalance(), VAULT_FUNDS);
    }

    /// T-9 (A-12, INV-14): calling executePayment for another key reverts.
    function test_T9_ImpersonationReverts() public {
        _grantDefault(keyB);
        address[] memory callers = new address[](3);
        callers[0] = keyA;
        callers[1] = owner;
        callers[2] = attacker;
        for (uint256 i = 0; i < callers.length; i++) {
            vm.prank(callers[i]);
            vm.expectRevert(SpendGuard.CallerNotSessionKey.selector);
            vault.executePayment(keyB, merchantA, 5_000_000);
        }
        assertEq(_spent(keyB), 0);
    }

    /// T-10 (INV-4): sweep after revoke returns the full remaining balance.
    function test_T10_OwnerSweepAfterRevoke() public {
        _grantDefault(keyA);
        _payAs(keyA, merchantA, 10_000_000);
        _payAs(keyA, merchantA, 5_000_000);
        vm.prank(owner);
        vault.revokeSession(keyA);
        uint256 ownerBefore = token.balanceOf(owner);
        vm.prank(owner);
        vault.ownerWithdraw();
        assertEq(token.balanceOf(owner), ownerBefore + VAULT_FUNDS - 15_000_000);
        assertEq(vault.vaultBalance(), 0);
    }

    /// T-11 (A-10, INV-11): every invalid grant shape reverts, no state change.
    function test_T11_GrantValidation() public {
        // spendCap == 0
        vm.prank(owner);
        vm.expectRevert(SpendGuard.ZeroSpendCap.selector);
        vault.grantSession(keyA, _one(merchantA), PER_TX, 0, expiry);
        // maxPerTx == 0
        vm.prank(owner);
        vm.expectRevert(SpendGuard.ZeroMaxPerTx.selector);
        vault.grantSession(keyA, _one(merchantA), 0, CAP, expiry);
        // maxPerTx > spendCap
        vm.prank(owner);
        vm.expectRevert(SpendGuard.MaxPerTxExceedsSpendCap.selector);
        vault.grantSession(keyA, _one(merchantA), CAP + 1, CAP, expiry);
        // expiresAt in the past
        vm.prank(owner);
        vm.expectRevert(SpendGuard.ExpiryInPast.selector);
        vault.grantSession(keyA, _one(merchantA), PER_TX, CAP, uint64(block.timestamp));
        // empty allowlist
        vm.prank(owner);
        vm.expectRevert(SpendGuard.EmptyAllowlist.selector);
        vault.grantSession(keyA, new address[](0), PER_TX, CAP, expiry);
        // zero-address session key
        vm.prank(owner);
        vm.expectRevert(SpendGuard.ZeroAddress.selector);
        vault.grantSession(address(0), _one(merchantA), PER_TX, CAP, expiry);
        // zero-address recipient
        vm.prank(owner);
        vm.expectRevert(SpendGuard.ZeroAddress.selector);
        vault.grantSession(keyA, _one(address(0)), PER_TX, CAP, expiry);
        // duplicate grant to an active key
        _grantDefault(keyA);
        vm.prank(owner);
        vm.expectRevert(SpendGuard.SessionAlreadyActive.selector);
        vault.grantSession(keyA, _one(merchantB), PER_TX, CAP, expiry);
        // No state change from any failed grant: the live grant is intact.
        assertTrue(vault.getSession(keyA).active);
        assertTrue(vault.isRecipientAllowed(keyA, merchantA));
        assertFalse(vault.isRecipientAllowed(keyA, merchantB));

        // Cap above the current vault balance is ALLOWED (owner may deposit
        // later); INV-5 still caps actual outflow at the vault balance.
        _grant(keyB, _one(merchantA), PER_TX, VAULT_FUNDS * 2, expiry);
        assertTrue(vault.getSession(keyB).active);
    }

    /// T-12 (A-7): in both orderings the loss is at most the remaining cap.
    function test_T12_FrontRunRevoke_OutcomeBounded() public {
        // Ordering (a): payment mined before the revoke.
        _grantDefault(keyA);
        _payAs(keyA, merchantA, PER_TX);
        vm.prank(owner);
        vault.revokeSession(keyA);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.SessionNotActive.selector);
        vault.executePayment(keyA, merchantA, PER_TX);
        assertLe(_spent(keyA), CAP);

        // Ordering (b): revoke mined before the payment.
        _grantDefault(keyB);
        vm.prank(owner);
        vault.revokeSession(keyB);
        vm.prank(keyB);
        vm.expectRevert(SpendGuard.SessionNotActive.selector);
        vault.executePayment(keyB, merchantA, PER_TX);
        assertEq(_spent(keyB), 0);
    }

    /// T-13 (INV-8): zero-amount payments revert with no state change.
    function test_T13_ZeroAmountReverts() public {
        _grantDefault(keyA);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.ZeroAmount.selector);
        vault.executePayment(keyA, merchantA, 0);
        assertEq(_spent(keyA), 0);
    }

    /// T-14 (INV-1): paying exactly the remaining cap succeeds; 1 more reverts.
    function test_T14_ExactCapBoundary() public {
        _grantDefault(keyA);
        for (uint256 i = 0; i < 4; i++) {
            _payAs(keyA, merchantA, PER_TX);
        }
        _payAs(keyA, merchantA, PER_TX); // exactly the remaining cap
        assertEq(_spent(keyA), CAP);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.CapExceeded.selector);
        vault.executePayment(keyA, merchantA, 1);
    }

    /// T-15 (INV-13): the vault pulls exactly the approved deposit amount.
    function test_T15_DepositExactPull() public {
        uint256 before = vault.vaultBalance();
        vm.startPrank(owner);
        token.approve(address(vault), 100_000_000);
        vault.deposit(100_000_000);
        assertEq(vault.vaultBalance(), before + 100_000_000);
        assertEq(token.allowance(owner, address(vault)), 0);
        // Second deposit without a fresh approval reverts (allowance spent).
        vm.expectRevert();
        vault.deposit(100_000_000);
        vm.stopPrank();
        assertEq(vault.vaultBalance(), before + 100_000_000);
    }

    // ------------------------------------------------------------------
    // Re-grant semantics (INV-7, INV-16)
    // ------------------------------------------------------------------

    function test_ReGrantAfterRevoke_StartsFresh() public {
        _grantDefault(keyA);
        _payAs(keyA, merchantA, 10_000_000);
        vm.prank(owner);
        vault.revokeSession(keyA);
        // Fresh grant: new recipient set, new caps, spent reset to 0.
        _grant(keyA, _one(merchantB), 5_000_000, 25_000_000, uint64(block.timestamp + 7200));
        assertEq(_spent(keyA), 0);
        assertFalse(vault.isRecipientAllowed(keyA, merchantA), "old allowlist must be cleared");
        assertTrue(vault.isRecipientAllowed(keyA, merchantB));
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.RecipientNotAllowed.selector);
        vault.executePayment(keyA, merchantA, 1_000_000);
        _payAs(keyA, merchantB, 5_000_000);
        assertEq(_spent(keyA), 5_000_000);
    }

    function test_RevokeInactiveKeyReverts() public {
        vm.prank(owner);
        vm.expectRevert(SpendGuard.SessionNotActive.selector);
        vault.revokeSession(keyA);
    }

    // ------------------------------------------------------------------
    // Events (INV-15)
    // ------------------------------------------------------------------

    function test_EventsEmitted() public {
        // Deposit
        vm.prank(owner);
        token.approve(address(vault), 100_000_000);
        vm.expectEmit(true, false, false, true, address(vault));
        emit Deposit(owner, 100_000_000, VAULT_FUNDS + 100_000_000);
        vm.prank(owner);
        vault.deposit(100_000_000);

        // SessionGranted
        address[] memory recipients = _one(merchantA);
        vm.expectEmit(true, false, false, true, address(vault));
        emit SessionGranted(keyA, recipients, PER_TX, CAP, expiry);
        _grant(keyA, recipients, PER_TX, CAP, expiry);

        // PaymentExecuted
        vm.expectEmit(true, true, false, true, address(vault));
        emit PaymentExecuted(keyA, merchantA, 5_000_000, 5_000_000, CAP - 5_000_000);
        _payAs(keyA, merchantA, 5_000_000);

        // SessionRevoked
        vm.expectEmit(true, false, false, true, address(vault));
        emit SessionRevoked(keyA, 5_000_000, CAP - 5_000_000);
        vm.prank(owner);
        vault.revokeSession(keyA);

        // OwnerWithdraw
        uint256 balance = vault.vaultBalance();
        vm.expectEmit(true, false, false, true, address(vault));
        emit OwnerWithdraw(owner, balance, 0);
        vm.prank(owner);
        vault.ownerWithdraw();
    }

    // ------------------------------------------------------------------
    // Non-reverting token (addendum A-1): silent `false` never counts
    // ------------------------------------------------------------------

    function test_NonRevertingToken_DepositRevertsOnFalse() public {
        MockNonRevertingERC20 badToken = new MockNonRevertingERC20();
        badToken.mint(owner, 1_000_000_000);
        vm.prank(owner);
        SpendGuard badVault = new SpendGuard(address(badToken), owner);
        // No approval: transferFrom returns false instead of reverting.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(badToken)));
        badVault.deposit(100_000_000);
        assertEq(badVault.vaultBalance(), 0);
    }

    function test_NonRevertingToken_PaymentRevertsOnFalse() public {
        MockNonRevertingERC20 flaky = new MockNonRevertingERC20();
        flaky.mint(owner, 1_000_000_000);
        vm.prank(owner);
        SpendGuard flakyVault = new SpendGuard(address(flaky), owner);
        vm.startPrank(owner);
        flaky.approve(address(flakyVault), VAULT_FUNDS);
        flakyVault.deposit(VAULT_FUNDS);
        flakyVault.grantSession(keyA, _one(merchantA), PER_TX, CAP, expiry);
        vm.stopPrank();

        // Token now fails every transfer silently.
        flaky.setFailAllTransfers(true);
        vm.prank(keyA);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(flaky)));
        flakyVault.executePayment(keyA, merchantA, 5_000_000);
        // The failed spend corrupted nothing: spent and balance unchanged.
        assertEq(flakyVault.getSession(keyA).spent, 0);
        assertEq(flakyVault.vaultBalance(), VAULT_FUNDS);

        // And a deposit fails the same way while the token is flaky.
        vm.startPrank(owner);
        flaky.approve(address(flakyVault), 100_000_000);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(flaky)));
        flakyVault.deposit(100_000_000);
        vm.stopPrank();

        // Recovery: token healthy again, everything works.
        flaky.setFailAllTransfers(false);
        vm.prank(keyA);
        flakyVault.executePayment(keyA, merchantA, 5_000_000);
        assertEq(flakyVault.getSession(keyA).spent, 5_000_000);
    }

    // ------------------------------------------------------------------
    // Solvency backstop (INV-5, INV-17)
    // ------------------------------------------------------------------

    function test_PaymentExceedingVaultBalanceReverts() public {
        // Drain the vault via sweep, then re-fund with less than one payment.
        vm.prank(owner);
        vault.ownerWithdraw();
        _depositAs(owner, 1_000_000);
        _grantDefault(keyA);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.InsufficientVaultBalance.selector);
        vault.executePayment(keyA, merchantA, 5_000_000);
        assertEq(_spent(keyA), 0);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function test_Views() public {
        address[] memory recipients = new address[](2);
        recipients[0] = merchantA;
        recipients[1] = merchantB;
        _grant(keyA, recipients, PER_TX, CAP, expiry);
        SpendGuard.Session memory s = vault.getSession(keyA);
        assertEq(s.maxPerTx, PER_TX);
        assertEq(s.spendCap, CAP);
        assertEq(s.spent, 0);
        assertEq(s.expiresAt, expiry);
        assertTrue(s.active);
        assertEq(s.recipients.length, 2);
        assertTrue(vault.isRecipientAllowed(keyA, merchantA));
        assertTrue(vault.isRecipientAllowed(keyA, merchantB));
        assertEq(vault.remainingCap(keyA), CAP);
        assertEq(vault.vaultBalance(), VAULT_FUNDS);
    }

    // ------------------------------------------------------------------
    // Fuzz: boundary behaviour over random amounts
    // ------------------------------------------------------------------

    function testFuzz_PaymentBoundary(uint256 amount) public {
        amount = bound(amount, 1, 60_000_000);
        _grantDefault(keyA);
        vm.prank(keyA);
        if (amount <= PER_TX) {
            vault.executePayment(keyA, merchantA, amount);
            assertEq(_spent(keyA), amount);
        } else {
            vm.expectRevert(SpendGuard.PerTxLimitExceeded.selector);
            vault.executePayment(keyA, merchantA, amount);
            assertEq(_spent(keyA), 0);
        }
    }

    function testFuzz_DepositPullsExact(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000_000);
        uint256 before = vault.vaultBalance();
        _depositAs(owner, amount);
        assertEq(vault.vaultBalance(), before + amount);
    }

    // ------------------------------------------------------------------
    // Edit: bounds change, spent is preserved, revoked stays terminal
    // ------------------------------------------------------------------

    function test_Edit_RaisesCap_PreservesSpent() public {
        _grantDefault(keyA);
        _payAs(keyA, merchantA, PER_TX); // spent 10
        _edit(keyA, _one(merchantA), 20_000_000, 80_000_000, expiry);
        SpendGuard.Session memory s = vault.getSession(keyA);
        assertEq(s.spent, PER_TX, "spent preserved");
        assertEq(s.spendCap, 80_000_000, "cap raised");
        assertEq(s.maxPerTx, 20_000_000, "perTx raised");
        assertTrue(s.active, "still active");
        assertEq(vault.remainingCap(keyA), 70_000_000, "remaining recomputed");
        _payAs(keyA, merchantA, 20_000_000); // pays under the NEW per-tx cap
        assertEq(_spent(keyA), 30_000_000);
    }

    function test_Edit_LowersCap_StillAboveSpent() public {
        _grantDefault(keyA);
        _payAs(keyA, merchantA, PER_TX); // spent 10
        _edit(keyA, _one(merchantA), PER_TX, 15_000_000, expiry);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.CapExceeded.selector);
        vault.executePayment(keyA, merchantA, 6_000_000); // 10 + 6 > 15
        _payAs(keyA, merchantA, 5_000_000); // 10 + 5 == 15, exactly the cap
        assertEq(_spent(keyA), 15_000_000);
    }

    function test_Edit_CapBelowSpentReverts() public {
        _grantDefault(keyA);
        _payAs(keyA, merchantA, PER_TX); // spent 10
        vm.prank(owner);
        vm.expectRevert(SpendGuard.CapBelowSpent.selector);
        // perTx must fit the new cap, so only the cap floor can fire.
        vault.editSession(keyA, _one(merchantA), 5_000_000, 5_000_000, expiry);
        assertEq(_spent(keyA), PER_TX, "spent untouched by failed edit");
        assertEq(vault.getSession(keyA).spendCap, CAP, "cap untouched by failed edit");
    }

    function test_Edit_CapEqualToSpent_OK() public {
        _grantDefault(keyA);
        _payAs(keyA, merchantA, PER_TX); // spent 10
        _edit(keyA, _one(merchantA), PER_TX, PER_TX, expiry);
        assertEq(vault.remainingCap(keyA), 0, "no room left");
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.CapExceeded.selector);
        vault.executePayment(keyA, merchantA, 1);
    }

    function test_Edit_LowersMaxPerTx() public {
        _grantDefault(keyA);
        _edit(keyA, _one(merchantA), 2_000_000, CAP, expiry);
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.PerTxLimitExceeded.selector);
        vault.executePayment(keyA, merchantA, 5_000_000);
        _payAs(keyA, merchantA, 2_000_000);
        assertEq(_spent(keyA), 2_000_000);
    }

    function test_Edit_ExtendsExpiry() public {
        _grantDefault(keyA);
        vm.warp(expiry); // exact expiry second: payments revert
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.SessionExpired.selector);
        vault.executePayment(keyA, merchantA, 1_000_000);
        uint64 later = uint64(block.timestamp + 3600);
        _edit(keyA, _one(merchantA), PER_TX, CAP, later);
        _payAs(keyA, merchantA, 1_000_000); // spendable again under the new expiry
        assertEq(_spent(keyA), 1_000_000);
    }

    function test_Edit_ReplacesRecipients() public {
        _grantDefault(keyA);
        _edit(keyA, _one(merchantB), PER_TX, CAP, expiry);
        assertFalse(vault.isRecipientAllowed(keyA, merchantA), "old recipient cleared");
        assertTrue(vault.isRecipientAllowed(keyA, merchantB), "new recipient allowlisted");
        vm.prank(keyA);
        vm.expectRevert(SpendGuard.RecipientNotAllowed.selector);
        vault.executePayment(keyA, merchantA, 1_000_000);
        _payAs(keyA, merchantB, 1_000_000);
        assertEq(_spent(keyA), 1_000_000);
    }

    function test_Edit_RevokedReverts() public {
        _grantDefault(keyA);
        vm.prank(owner);
        vault.revokeSession(keyA);
        vm.prank(owner);
        vm.expectRevert(SpendGuard.SessionNotActive.selector);
        vault.editSession(keyA, _one(merchantA), PER_TX, CAP, expiry);
    }

    function test_Edit_NeverGrantedReverts() public {
        vm.prank(owner);
        vm.expectRevert(SpendGuard.SessionNotActive.selector);
        vault.editSession(keyB, _one(merchantA), PER_TX, CAP, expiry);
    }

    function test_Edit_NonOwnerReverts() public {
        _grantDefault(keyA);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vault.editSession(keyA, _one(merchantA), PER_TX, CAP, expiry);
    }

    function test_Edit_ValidationsRevert() public {
        _grantDefault(keyA);
        vm.startPrank(owner);
        vm.expectRevert(SpendGuard.ZeroSpendCap.selector);
        vault.editSession(keyA, _one(merchantA), PER_TX, 0, expiry);
        vm.expectRevert(SpendGuard.ZeroMaxPerTx.selector);
        vault.editSession(keyA, _one(merchantA), 0, CAP, expiry);
        vm.expectRevert(SpendGuard.MaxPerTxExceedsSpendCap.selector);
        vault.editSession(keyA, _one(merchantA), CAP + 1, CAP, expiry);
        vm.expectRevert(SpendGuard.ExpiryInPast.selector);
        vault.editSession(keyA, _one(merchantA), PER_TX, CAP, uint64(block.timestamp));
        vm.expectRevert(SpendGuard.EmptyAllowlist.selector);
        vault.editSession(keyA, new address[](0), PER_TX, CAP, expiry);
        address[] memory withZero = new address[](1);
        withZero[0] = address(0);
        vm.expectRevert(SpendGuard.ZeroAddress.selector);
        vault.editSession(keyA, withZero, PER_TX, CAP, expiry);
        vm.stopPrank();
    }

    function test_Edit_EmitsEvent() public {
        _grantDefault(keyA);
        vm.expectEmit(true, false, false, true, address(vault));
        emit SessionEdited(keyA, _one(merchantB), 5_000_000, 60_000_000, expiry);
        _edit(keyA, _one(merchantB), 5_000_000, 60_000_000, expiry);
    }

    function test_Edit_WhilePaused() public {
        _grantDefault(keyA);
        vm.prank(owner);
        vault.pause();
        _edit(keyA, _one(merchantA), 20_000_000, CAP, expiry); // admin works paused
        assertEq(vault.getSession(keyA).maxPerTx, 20_000_000);
        vm.prank(keyA);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.executePayment(keyA, merchantA, 1_000_000);
        vm.prank(owner);
        vault.unpause();
        _payAs(keyA, merchantA, 20_000_000); // new bound applies after unpause
    }
}
