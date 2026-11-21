/**
 * ABIs for SpendGuard, SpendGuardFactory, and the minimal ERC-20 surface
 * the SDK needs. Written as human-readable signatures and parsed with
 * viem's parseAbi, so they mirror src/SpendGuard.sol and
 * src/SpendGuardFactory.sol exactly. No build step is needed to read them.
 */
/** SpendGuard vault. Mirrors src/SpendGuard.sol. */
export declare const spendGuardAbi: readonly [{
    readonly name: "token";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "owner";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "paused";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "deposit";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "grantSession";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
    }, {
        readonly type: "address[]";
        readonly name: "recipients";
    }, {
        readonly type: "uint256";
        readonly name: "maxPerTx";
    }, {
        readonly type: "uint256";
        readonly name: "spendCap";
    }, {
        readonly type: "uint64";
        readonly name: "expiresAt";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "editSession";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
    }, {
        readonly type: "address[]";
        readonly name: "recipients";
    }, {
        readonly type: "uint256";
        readonly name: "maxPerTx";
    }, {
        readonly type: "uint256";
        readonly name: "spendCap";
    }, {
        readonly type: "uint64";
        readonly name: "expiresAt";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "revokeSession";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "executePayment";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
    }, {
        readonly type: "address";
        readonly name: "recipient";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "ownerWithdraw";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [];
    readonly outputs: readonly [];
}, {
    readonly name: "pause";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [];
    readonly outputs: readonly [];
}, {
    readonly name: "unpause";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [];
    readonly outputs: readonly [];
}, {
    readonly name: "getSession";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
    }];
    readonly outputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "uint256";
            readonly name: "maxPerTx";
        }, {
            readonly type: "uint256";
            readonly name: "spendCap";
        }, {
            readonly type: "uint256";
            readonly name: "spent";
        }, {
            readonly type: "uint64";
            readonly name: "expiresAt";
        }, {
            readonly type: "bool";
            readonly name: "active";
        }, {
            readonly type: "address[]";
            readonly name: "recipients";
        }];
    }];
}, {
    readonly name: "isRecipientAllowed";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
    }, {
        readonly type: "address";
        readonly name: "recipient";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "remainingCap";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "vaultBalance";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "Deposit";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "depositor";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }, {
        readonly type: "uint256";
        readonly name: "newBalance";
    }];
}, {
    readonly name: "SessionGranted";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
        readonly indexed: true;
    }, {
        readonly type: "address[]";
        readonly name: "recipients";
    }, {
        readonly type: "uint256";
        readonly name: "maxPerTx";
    }, {
        readonly type: "uint256";
        readonly name: "spendCap";
    }, {
        readonly type: "uint256";
        readonly name: "expiresAt";
    }];
}, {
    readonly name: "SessionEdited";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
        readonly indexed: true;
    }, {
        readonly type: "address[]";
        readonly name: "recipients";
    }, {
        readonly type: "uint256";
        readonly name: "maxPerTx";
    }, {
        readonly type: "uint256";
        readonly name: "spendCap";
    }, {
        readonly type: "uint256";
        readonly name: "expiresAt";
    }];
}, {
    readonly name: "SessionRevoked";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "spent";
    }, {
        readonly type: "uint256";
        readonly name: "remainingCap";
    }];
}, {
    readonly name: "PaymentExecuted";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "sessionKey";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "recipient";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }, {
        readonly type: "uint256";
        readonly name: "newSpent";
    }, {
        readonly type: "uint256";
        readonly name: "remainingCap";
    }];
}, {
    readonly name: "OwnerWithdraw";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "owner";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }, {
        readonly type: "uint256";
        readonly name: "newBalance";
    }];
}, {
    readonly name: "ZeroAddress";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "ZeroAmount";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "ZeroSpendCap";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "ZeroMaxPerTx";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "MaxPerTxExceedsSpendCap";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "CapBelowSpent";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "ExpiryInPast";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "EmptyAllowlist";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "SessionAlreadyActive";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "SessionNotActive";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "SessionExpired";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "RecipientNotAllowed";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "CapExceeded";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "PerTxLimitExceeded";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "CallerNotSessionKey";
    readonly type: "error";
    readonly inputs: readonly [];
}, {
    readonly name: "InsufficientVaultBalance";
    readonly type: "error";
    readonly inputs: readonly [];
}];
/** SpendGuardFactory. Mirrors src/SpendGuardFactory.sol. */
export declare const spendGuardFactoryAbi: readonly [{
    readonly name: "token";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "allVaults";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "uint256";
        readonly name: "index";
    }];
    readonly outputs: readonly [{
        readonly type: "address";
    }];
}, {
    readonly name: "createVault";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "address";
        readonly name: "vault";
    }];
}, {
    readonly name: "vaultsOf";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "owner";
    }];
    readonly outputs: readonly [{
        readonly type: "address[]";
    }];
}, {
    readonly name: "vaultCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "VaultCreated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "owner";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "vault";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "index";
    }];
}, {
    readonly name: "ZeroAddress";
    readonly type: "error";
    readonly inputs: readonly [];
}];
/** Minimal ERC-20 surface: the approve + balance reads the SDK needs. */
export declare const erc20Abi: readonly [{
    readonly name: "name";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "string";
    }];
}, {
    readonly name: "symbol";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "string";
    }];
}, {
    readonly name: "decimals";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint8";
    }];
}, {
    readonly name: "balanceOf";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "account";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "allowance";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "owner";
    }, {
        readonly type: "address";
        readonly name: "spender";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "approve";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "spender";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}, {
    readonly name: "Transfer";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "from";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "to";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
}, {
    readonly name: "Approval";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "owner";
        readonly indexed: true;
    }, {
        readonly type: "address";
        readonly name: "spender";
        readonly indexed: true;
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
}];
//# sourceMappingURL=abi.d.ts.map