// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {DeepFunding} from "../src/DeepFunding.sol";

/// @notice Deploys DeepFunding on Sepolia with a 0.01 ETH pot.
/// @dev Requires PRIVATE_KEY, SEPOLIA_RPC_URL, and JUROR_ADDRESS in the env.
contract Deploy is Script {
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;
    uint256 internal constant POT = 0.01 ether;

    error WrongChain(uint256 chainId);
    error EmptyRpcUrl();

    function run() external returns (DeepFunding funding) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        string memory rpcUrl = vm.envString("SEPOLIA_RPC_URL");
        if (bytes(rpcUrl).length == 0) revert EmptyRpcUrl();
        address juror = vm.envAddress("JUROR_ADDRESS");
        if (block.chainid != SEPOLIA_CHAIN_ID) revert WrongChain(block.chainid);

        address deployer = vm.addr(deployerKey);
        address[] memory initialJurors = new address[](2);
        initialJurors[0] = juror;
        initialJurors[1] = deployer;

        vm.startBroadcast(deployerKey);
        funding = new DeepFunding{value: POT}(initialJurors);
        vm.stopBroadcast();

        string memory obj = "deployment";
        string memory json = vm.serializeUint(obj, "chainId", block.chainid);
        json = vm.serializeAddress(obj, "contract", address(funding));
        json = vm.serializeAddress(obj, "operator", deployer);
        json = vm.serializeAddress(obj, "juror", juror);
        json = vm.serializeUint(obj, "totalPotWei", POT);
        json = vm.serializeString(obj, "status", "deployed");

        vm.writeJson(
            json,
            string.concat(vm.projectRoot(), "/deployments/sepolia.json")
        );

        console2.log("DeepFunding deployed at", address(funding));
        console2.log("Operator", deployer);
        console2.log("Juror", juror);
        console2.log("Pot (wei)", POT);
    }
}
