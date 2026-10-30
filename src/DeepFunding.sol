// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title DeepFunding
/// @notice Retro-funding pot for a jury-weighted dependency graph.
/// @dev The operator commits to a Merkle root of `(recipient, amount)` leaves.
///      Jurors may open a dispute during a 48-hour window. After the window and
///      with no open dispute, the result can be finalized and recipients claim
///      their allocation with a Merkle proof.
contract DeepFunding is ReentrancyGuard {
    /// @notice Account allowed to propose results, add jurors, and resolve disputes.
    address public immutable operator;

    /// @notice Committed Merkle root of the allocation result.
    bytes32 public merkleRoot;

    /// @notice Pot funded at deployment, in wei.
    uint256 public totalPot;

    /// @notice Timestamp at which the current result was proposed.
    uint256 public proposedAt;

    /// @notice Dispute window length after a proposal.
    uint256 public constant DISPUTE_WINDOW = 48 hours;

    /// @notice True once a result is finalized. Never reset.
    bool public finalized;

    /// @notice Hash of a dispute payload -> whether it was recorded.
    mapping(bytes32 => bool) public disputed;

    /// @notice Recipient -> whether the allocation has been claimed.
    mapping(address => bool) public claimed;

    /// @notice Registered juror -> whether the account may dispute.
    mapping(address => bool) public jurors;

    /// @notice True while at least one dispute is unresolved.
    bool public hasOpenDispute;

    /// @notice Emitted when a result root is proposed.
    event ResultProposed(bytes32 root, uint256 proposedAt);

    /// @notice Emitted when a juror opens a dispute.
    event Disputed(address indexed juror, string reason);

    /// @notice Emitted when the operator resolves the open dispute.
    event DisputeResolved(bool accepted);

    /// @notice Emitted when a result is finalized.
    event Finalized(bytes32 root);

    /// @notice Emitted when a recipient claims their allocation.
    event Claimed(address indexed recipient, uint256 amount);

    /// @notice Emitted when a juror is registered.
    event JurorAdded(address indexed juror);

    /// @notice Caller is not the operator.
    error NotOperator();
    /// @notice A result has already been proposed.
    error AlreadyProposed();
    /// @notice No result has been proposed.
    error NothingProposed();
    /// @notice The dispute window has already closed.
    error WindowClosed();
    /// @notice The dispute window has not closed yet.
    error WindowNotClosed();
    /// @notice An open dispute blocks finalization.
    error OpenDispute();
    /// @notice This recipient already claimed.
    error AlreadyClaimed();
    /// @notice The Merkle proof did not verify.
    error InvalidProof();
    /// @notice The result is already finalized.
    error AlreadyFinalized();
    /// @notice Caller is not a registered juror.
    error NotJuror();
    /// @notice The result is not finalized yet.
    error NotFinalized();
    /// @notice No dispute is currently open.
    error NoOpenDispute();
    /// @notice A zero address was supplied.
    error ZeroAddress();
    /// @notice A zero Merkle root was supplied.
    error InvalidRoot();
    /// @notice Native ETH transfer failed.
    error TransferFailed();

    /// @notice Restricts a function to the operator.
    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @notice Deploys the pot and registers the initial jurors.
    /// @param initialJurors Juror addresses allowed to dispute.
    constructor(address[] memory initialJurors) payable {
        operator = msg.sender;
        totalPot = msg.value;
        for (uint256 i = 0; i < initialJurors.length; i++) {
            address juror = initialJurors[i];
            if (juror == address(0)) revert ZeroAddress();
            jurors[juror] = true;
            emit JurorAdded(juror);
        }
    }

    /// @notice Registers a juror. Only callable by the operator before finalization.
    /// @param juror Address to register.
    function addJuror(address juror) external onlyOperator {
        if (finalized) revert AlreadyFinalized();
        if (juror == address(0)) revert ZeroAddress();
        jurors[juror] = true;
        emit JurorAdded(juror);
    }

    /// @notice Proposes the Merkle root of the allocation result.
    /// @dev Only one proposal may exist at a time. An accepted dispute resets the
    ///      proposal, allowing a new root to be proposed.
    /// @param root Merkle root over `(address recipient, uint256 amount)` leaves.
    function proposeResult(bytes32 root) external onlyOperator {
        if (finalized) revert AlreadyFinalized();
        if (merkleRoot != bytes32(0)) revert AlreadyProposed();
        if (root == bytes32(0)) revert InvalidRoot();
        merkleRoot = root;
        proposedAt = block.timestamp;
        emit ResultProposed(root, block.timestamp);
    }

    /// @notice Opens a dispute during the dispute window. Jurors only.
    /// @param reason Human-readable reason stored as part of the dispute hash.
    function dispute(string calldata reason) external {
        if (proposedAt == 0) revert NothingProposed();
        if (block.timestamp > proposedAt + DISPUTE_WINDOW) revert WindowClosed();
        if (!jurors[msg.sender]) revert NotJuror();
        hasOpenDispute = true;
        bytes32 disputeHash = keccak256(abi.encode(msg.sender, reason, block.timestamp));
        disputed[disputeHash] = true;
        emit Disputed(msg.sender, reason);
    }

    /// @notice Resolves the open dispute. Only callable by the operator.
    /// @dev Accepting resets the proposal so the operator can propose again.
    /// @param accepted True to reject the proposed root and allow re-proposal.
    function resolveDispute(bool accepted) external onlyOperator {
        if (!hasOpenDispute) revert NoOpenDispute();
        if (accepted) {
            merkleRoot = bytes32(0);
            proposedAt = 0;
        }
        hasOpenDispute = false;
        emit DisputeResolved(accepted);
    }

    /// @notice Finalizes the proposed result after the dispute window.
    function finalize() external {
        if (finalized) revert AlreadyFinalized();
        if (proposedAt == 0) revert NothingProposed();
        if (block.timestamp < proposedAt + DISPUTE_WINDOW) revert WindowNotClosed();
        if (hasOpenDispute) revert OpenDispute();
        finalized = true;
        emit Finalized(merkleRoot);
    }

    /// @notice Claims the caller's allocation using a Merkle proof.
    /// @dev CEI: the claimed marker is written before the ETH transfer.
    ///      The leaf is double-hashed to match OpenZeppelin StandardMerkleTree:
    ///      `keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))))`.
    /// @param amount Allocation in wei.
    /// @param proof Merkle proof for `(msg.sender, amount)`.
    function claim(uint256 amount, bytes32[] calldata proof) external nonReentrant {
        if (!finalized) revert NotFinalized();
        if (claimed[msg.sender]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        if (!MerkleProof.verify(proof, merkleRoot, leaf)) revert InvalidProof();

        claimed[msg.sender] = true;
        emit Claimed(msg.sender, amount);

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
