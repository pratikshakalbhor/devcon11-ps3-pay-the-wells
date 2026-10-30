// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeepFunding} from "../src/DeepFunding.sol";

/// @dev Calls claim() for four fixed recipients with precomputed proofs.
contract ClaimHandler is Test {
    DeepFunding public immutable target;
    address[] public actors;
    mapping(address => uint256) public amounts;
    mapping(address => bytes32[]) internal proofs;
    uint256 public totalClaimed;
    uint256 public successfulClaims;

    constructor(
        DeepFunding target_,
        address[] memory actors_,
        uint256[] memory amounts_,
        bytes32[][] memory proofs_
    ) {
        target = target_;
        for (uint256 i = 0; i < actors_.length; i++) {
            actors.push(actors_[i]);
            amounts[actors_[i]] = amounts_[i];
            proofs[actors_[i]] = proofs_[i];
        }
    }

    function claim(uint256 seed) external {
        uint256 index = seed % actors.length;
        address actor = actors[index];
        uint256 amount = amounts[actor];
        if (amount == 0) return;
        bytes32[] memory proof = proofs[actor];
        vm.prank(actor);
        try target.claim(amount, proof) {
            totalClaimed += amount;
            successfulClaims += 1;
        } catch {
            // Already claimed / invalid after a previous successful call.
        }
    }
}

contract DeepFundingInvariantTest is Test {
    DeepFunding internal funding;
    ClaimHandler internal handler;
    uint256 internal constant POT = 10 ether;

    function setUp() public {
        address[] memory initialJurors = new address[](1);
        initialJurors[0] = address(0xA11CE);
        funding = new DeepFunding{value: POT}(initialJurors);

        address[4] memory actorSet = [
            address(0x1001),
            address(0x1002),
            address(0x1003),
            address(0x1004)
        ];
        uint256[4] memory amountSet = [uint256(1 ether), 2 ether, 3 ether, 1 ether];

        address[] memory actors = new address[](4);
        uint256[] memory amounts = new uint256[](4);
        for (uint256 i = 0; i < 4; i++) {
            actors[i] = actorSet[i];
            amounts[i] = amountSet[i];
        }

        bytes32 l0 = _leaf(actors[0], amounts[0]);
        bytes32 l1 = _leaf(actors[1], amounts[1]);
        bytes32 l2 = _leaf(actors[2], amounts[2]);
        bytes32 l3 = _leaf(actors[3], amounts[3]);
        bytes32 n01 = _hashPair(l0, l1);
        bytes32 n23 = _hashPair(l2, l3);
        bytes32 root = _hashPair(n01, n23);

        bytes32[][] memory proofs = new bytes32[][](4);
        proofs[0] = new bytes32[](2);
        proofs[0][0] = l1;
        proofs[0][1] = n23;
        proofs[1] = new bytes32[](2);
        proofs[1][0] = l0;
        proofs[1][1] = n23;
        proofs[2] = new bytes32[](2);
        proofs[2][0] = l3;
        proofs[2][1] = n01;
        proofs[3] = new bytes32[](2);
        proofs[3][0] = l2;
        proofs[3][1] = n01;

        funding.proposeResult(root);
        vm.warp(block.timestamp + funding.DISPUTE_WINDOW());
        funding.finalize();

        handler = new ClaimHandler(funding, actors, amounts, proofs);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = ClaimHandler.claim.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_TotalClaimedNeverExceedsPot() public view {
        assertLe(handler.totalClaimed(), funding.totalPot());
        assertEq(address(funding).balance + handler.totalClaimed(), funding.totalPot());
    }

    function _leaf(address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}
