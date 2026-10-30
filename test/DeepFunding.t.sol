// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {DeepFunding} from "../src/DeepFunding.sol";

/// @dev Re-enters claim() from receive() and records the claimed marker.
contract ReentrantClaimer {
    DeepFunding public immutable target;
    uint256 public immutable amount;
    bool public reentryReverted;
    bool public sawClaimedBeforeTransfer;
    uint256 public reentryAttempts;

    constructor(DeepFunding target_, uint256 amount_) {
        target = target_;
        amount = amount_;
    }

    function attack() external {
        target.claim(amount, new bytes32[](0));
    }

    receive() external payable {
        reentryAttempts += 1;
        sawClaimedBeforeTransfer = target.claimed(address(this));
        if (reentryAttempts == 1) {
            try target.claim(amount, new bytes32[](0)) {
                // Should never succeed.
            } catch {
                reentryReverted = true;
            }
        }
    }
}

/// @dev Records whether `claimed[this]` was already true when ETH arrived.
contract ClaimProbe {
    DeepFunding public immutable target;
    uint256 public immutable amount;
    bool public sawClaimed;

    constructor(DeepFunding target_, uint256 amount_) {
        target = target_;
        amount = amount_;
    }

    function claimIt() external {
        target.claim(amount, new bytes32[](0));
    }

    receive() external payable {
        sawClaimed = target.claimed(address(this));
    }
}

contract DeepFundingTest is Test {
    using stdJson for string;

    DeepFunding internal funding;

    address internal constant DEPLOYER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address internal juror = address(0xA11CE);
    uint256 internal constant POT = 10 ether;

    bytes32 internal root;
    uint256 internal deployerAmount;
    bytes32[] internal deployerProof;

    function setUp() public {
        string memory json = vm.readFile(
            string.concat(vm.projectRoot(), "/data/merkle.json")
        );
        root = json.readBytes32(".root");
        address recipient = json.readAddress(".leaves[0].recipient");
        require(recipient == DEPLOYER, "leaf 0 must be the test deployer");
        deployerAmount = json.readUint(".leaves[0].amount");
        deployerProof = json.readBytes32Array(".leaves[0].proof");

        vm.deal(DEPLOYER, 100 ether);
        address[] memory initialJurors = new address[](2);
        initialJurors[0] = juror;
        initialJurors[1] = DEPLOYER;
        vm.prank(DEPLOYER);
        funding = new DeepFunding{value: POT}(initialJurors);
    }

    function _proposeAndFinalize() internal {
        vm.prank(DEPLOYER);
        funding.proposeResult(root);
        vm.warp(block.timestamp + funding.DISPUTE_WINDOW());
        funding.finalize();
    }

    function _leaf(address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function test_ProposeResult_OnlyOperator() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(DeepFunding.NotOperator.selector);
        funding.proposeResult(root);

        vm.prank(DEPLOYER);
        funding.proposeResult(root);
        assertEq(funding.merkleRoot(), root);
        assertEq(funding.proposedAt(), block.timestamp);
    }

    function test_Claim_HappyPath() public {
        _proposeAndFinalize();
        uint256 before = DEPLOYER.balance;
        vm.prank(DEPLOYER);
        funding.claim(deployerAmount, deployerProof);

        assertEq(DEPLOYER.balance, before + deployerAmount);
        assertTrue(funding.claimed(DEPLOYER));
        assertEq(address(funding).balance, POT - deployerAmount);
    }

    function test_Claim_InvalidProofReverts() public {
        _proposeAndFinalize();
        bytes32[] memory badProof = new bytes32[](0);
        vm.prank(DEPLOYER);
        vm.expectRevert(DeepFunding.InvalidProof.selector);
        funding.claim(deployerAmount, badProof);
    }

    function test_Claim_OnlyOnce() public {
        _proposeAndFinalize();
        vm.startPrank(DEPLOYER);
        funding.claim(deployerAmount, deployerProof);
        vm.expectRevert(DeepFunding.AlreadyClaimed.selector);
        funding.claim(deployerAmount, deployerProof);
        vm.stopPrank();
    }

    function test_FinalizeBeforeWindowReverts() public {
        vm.prank(DEPLOYER);
        funding.proposeResult(root);
        vm.warp(block.timestamp + funding.DISPUTE_WINDOW() - 1);
        vm.expectRevert(DeepFunding.WindowNotClosed.selector);
        funding.finalize();
    }

    function test_OpenDisputeBlocksFinalize() public {
        vm.prank(DEPLOYER);
        funding.proposeResult(root);
        vm.prank(juror);
        funding.dispute("allocation looks wrong");
        vm.warp(block.timestamp + funding.DISPUTE_WINDOW() + 1);
        vm.expectRevert(DeepFunding.OpenDispute.selector);
        funding.finalize();
    }

    function test_DisputeAfterWindowReverts() public {
        vm.prank(DEPLOYER);
        funding.proposeResult(root);
        vm.warp(block.timestamp + funding.DISPUTE_WINDOW() + 1);
        vm.prank(juror);
        vm.expectRevert(DeepFunding.WindowClosed.selector);
        funding.dispute("too late");
    }

    function test_NonJurorDisputeReverts() public {
        vm.prank(DEPLOYER);
        funding.proposeResult(root);
        vm.prank(address(0xBAD));
        vm.expectRevert(DeepFunding.NotJuror.selector);
        funding.dispute("not a juror");
    }

    function test_ResolveDisputeAccepted_AllowsReproposal() public {
        vm.prank(DEPLOYER);
        funding.proposeResult(root);
        vm.prank(juror);
        funding.dispute("please redo");

        vm.prank(DEPLOYER);
        funding.resolveDispute(true);
        assertEq(funding.merkleRoot(), bytes32(0));
        assertEq(funding.proposedAt(), 0);
        assertFalse(funding.hasOpenDispute());

        bytes32 newRoot = keccak256("new allocation root");
        vm.prank(DEPLOYER);
        funding.proposeResult(newRoot);
        assertEq(funding.merkleRoot(), newRoot);
    }

    function test_FinalizedRootIsImmutable() public {
        _proposeAndFinalize();
        assertTrue(funding.finalized());
        vm.prank(DEPLOYER);
        vm.expectRevert(DeepFunding.AlreadyFinalized.selector);
        funding.proposeResult(keccak256("overwrite attempt"));
        assertEq(funding.merkleRoot(), root);
    }

    function test_ReentrancyOnClaim() public {
        ReentrantClaimer attacker = new ReentrantClaimer(funding, 1 ether);
        bytes32 attackerRoot = _leaf(address(attacker), 1 ether);

        vm.prank(DEPLOYER);
        funding.proposeResult(attackerRoot);
        vm.warp(block.timestamp + funding.DISPUTE_WINDOW());
        funding.finalize();

        attacker.attack();

        assertTrue(attacker.reentryReverted());
        assertTrue(attacker.sawClaimedBeforeTransfer());
        assertEq(address(attacker).balance, 1 ether);
        assertTrue(funding.claimed(address(attacker)));
    }

    function test_ClaimedMarkerSetBeforeTransfer() public {
        ClaimProbe probe = new ClaimProbe(funding, 1 ether);
        bytes32 probeRoot = _leaf(address(probe), 1 ether);

        vm.prank(DEPLOYER);
        funding.proposeResult(probeRoot);
        vm.warp(block.timestamp + funding.DISPUTE_WINDOW());
        funding.finalize();

        probe.claimIt();
        assertTrue(probe.sawClaimed());
        assertEq(address(probe).balance, 1 ether);
    }

    function testFuzz_InvalidProofAlwaysReverts(bytes32[] memory proof) public {
        _proposeAndFinalize();

        bool sameAsValid = proof.length == deployerProof.length;
        if (sameAsValid) {
            for (uint256 i = 0; i < proof.length; i++) {
                if (proof[i] != deployerProof[i]) {
                    sameAsValid = false;
                    break;
                }
            }
        }
        vm.assume(!sameAsValid);

        vm.prank(DEPLOYER);
        vm.expectRevert(DeepFunding.InvalidProof.selector);
        funding.claim(deployerAmount, proof);
    }
}
