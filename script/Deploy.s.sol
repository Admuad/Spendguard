// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SpendGuard} from "../src/SpendGuard.sol";

/// @notice Deploy SpendGuard to the Aevum testnet (chain 44005).
/// @dev Reads all secrets from the environment. Never commit a key or a
/// `.env` file: copy `.env.example` to `.env` locally (gitignored) and fill
/// it in. Deploys with a legacy transaction type: some tooling mishandles
/// EIP-1559 fields on this chain (starter-kit docs).
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url https://rpc-test.qday.info \
///     --broadcast --legacy -vvvv
/// with PRIVATE_KEY and TUSD8_ADDRESS set in the environment.
contract Deploy is Script {
    function run() public {
        address token = vm.envAddress("TUSD8_ADDRESS");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        require(token != address(0), "TUSD8_ADDRESS unset");

        vm.startBroadcast(deployerKey);
        SpendGuard vault = new SpendGuard(token);
        vm.stopBroadcast();

        console.log("SpendGuard deployed at:", address(vault));
        console.log("Token:", token);
        console.log("Owner:", vm.addr(deployerKey));
        console.log("Chain ID:", block.chainid);
    }
}
