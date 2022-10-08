// SPDX-License-Identifier: MIT

// Raffle
// Enter the lottery (paying some ammount)
// Pick a random winner (verifiably random, umtamper)
// Winner to be selected every X minutes -> complete automated
// Chainlink Oracle -> randomness, Automated Execution(Chainlink Keeper) (Smart contract cannot execute itself)

pragma solidity ^0.8.7;

// yarn add --dev @chainlink/contracts
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AutomationCompatibleInterface.sol";

error Raffle_NotEnoughETHEntered();
error RaffleTransferFailed();
error Raffle_NotOpen();
error Raffle_UpkeepNotNeeded(uint256 currentBalance, uint256 numPlayers, uint256 raffleState);

/** @title A sample Raffle Contract
 * @author Venus Chou
 * @notice This contract is for creating an untemperable decentralized smart contract
 * @dev This implements Chainlink VRF v2 and Chainlink Keepers
 */
contract Raffle is VRFConsumerBaseV2, AutomationCompatibleInterface {
    /* Type declarations */
    enum RaffleState {
        OPEN,
        CALCULATING
    } // uint256 0=OPEN,1=CALCULATING

    /* State Variables */
    uint256 private immutable i_entranceFee;
    address payable[] private s_players;
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_gasLane;
    uint64 private immutable i_subscriptionId;
    uint16 private constant REQUEST_COMFIRMATIONS = 3;
    uint32 private immutable i_callbackGasLimit;
    uint32 private constant NUM_WORDS = 1;

    // Lottory Variables
    address private s_recentWinner;
    // bool private s_isOpen;
    // uint256 private s_state; // to pengding, open, closed, calculating
    RaffleState private s_raffleState;
    uint256 private s_lastTimeStamp;
    uint256 private immutable i_interval;

    /* Events */
    event RaffleEnter(address indexed player);
    event RequestedRaffleWinner(uint256 indexed requestId);
    event WinnerPicked(address indexed winner);

    // pass the VRF CoordinatorV2 address to the VRFConsumerBaseV2
    constructor(
        address vrfCoordinatorV2, // contract -> need to deploy some mock for this
        uint256 entranceFee, // change the entrance fee depends on what chain we on
        bytes32 gasLane,
        uint64 subscriptionId,
        uint32 callbackGasLimit,
        uint256 interval
    ) VRFConsumerBaseV2(vrfCoordinatorV2) {
        i_entranceFee = entranceFee;
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
        i_gasLane = gasLane;
        i_subscriptionId = subscriptionId;
        i_callbackGasLimit = callbackGasLimit;
        s_raffleState = RaffleState.OPEN; // RaffleState(0)
        s_lastTimeStamp = block.timestamp;
        i_interval = interval;
    }

    /* Function */
    function enterRaffle() public payable {
        // require (msg.value > i_entranceFee, "Not enough ETH!")
        // Custom error is more gas effivient
        if (msg.value < i_entranceFee) {
            revert Raffle_NotEnoughETHEntered();
        }
        s_players.push(payable(msg.sender));
        // Events
        emit RaffleEnter(msg.sender);
        if (s_raffleState != RaffleState.OPEN) {
            revert Raffle_NotOpen();
        }
    }

    /**
     * @dev This is the function that the Chainlink Keeper nodes call
     * they look for the `upKeepNeeded` to return true
     * The following should be true in order to return true:
     * 1. Our time interval should have passed
     * 2. The lotterry should have at least one player and have some eth
     * 3. Our subscription is funded with LINK
     * 4. The lottery should be in an "open" state.
     *    When we are waiting for a random number, the lottery should be in "close" or "calculating" state.
     */
    function checkUpkeep(
        bytes memory /* checkData */
    )
        public
        view
        override
        returns (
            // public makes the contract can call this function itself

            bool upkeepNeeded,
            bytes memory /* performData */
        )
    {
        bool isOpen = (RaffleState.OPEN == s_raffleState);
        bool timePassed = ((block.timestamp - s_lastTimeStamp) > i_interval);
        bool hasPlayers = (s_players.length > 0);
        bool hasBalance = address(this).balance > 0;
        upkeepNeeded = (isOpen && timePassed && hasPlayers && hasBalance);
    }

    // NEED Chainlink VRF and Chainlink Keepers
    // pickRandomWinner() will be called by Chainlink Keepers Network
    // external function is a little cheaper than public function
    // 2 tx process
    // 1. Request the random number
    // 2. Once we get it, do something with it
    function performUpkeep(
        bytes calldata /* performData */
    ) external override {
        (bool upkeepNeeded, ) = checkUpkeep("");
        if (!upkeepNeeded) {
            revert Raffle_UpkeepNotNeeded(
                address(this).balance,
                s_players.length,
                uint256(s_raffleState)
            );
        }
        s_raffleState = RaffleState.CALCULATING;
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            // return a uint256 request id
            i_gasLane, // keyHash =gasLane 煤气管道
            i_subscriptionId,
            REQUEST_COMFIRMATIONS,
            i_callbackGasLimit,
            NUM_WORDS
        ); // Emit the 0th event within requestRandomWords(). This is redundant (args)!
        emit RequestedRaffleWinner(requestId); // event[1] with args
    }

    // fulfillRandomWords() = fulfillRandomNumbers()
    // overrided
    function fulfillRandomWords(
        uint256, /*requestId*/
        uint256[] memory randomWords
    ) internal override {
        // s_players size 10
        // randomNumber 202
        // 202 % 10 = 2 -> modulo function; we can always get the number 0-9
        uint256 indexOfWinner = randomWords[0] % s_players.length;
        address payable recentWinner = s_players[indexOfWinner];
        s_recentWinner = recentWinner;
        s_raffleState = RaffleState.OPEN;
        s_players = new address payable[](0); // size 0
        s_lastTimeStamp = block.timestamp;
        (bool success, ) = recentWinner.call{value: address(this).balance}("");
        // require(success, "Transfer failed");
        if (!success) {
            revert RaffleTransferFailed();
        }
        // emit an evnent so that get the easily queruable history of event winner
        emit WinnerPicked(recentWinner);
    }

    /* View / Pure Function */
    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }

    function getPlayer(uint256 index) public view returns (address) {
        return s_players[index];
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinner;
    }

    function getRaffleState() public view returns (RaffleState) {
        return s_raffleState;
    }

    function getNumWords() public pure returns (uint256) {
        // Not read from storage
        return NUM_WORDS;
    }

    function getNumOfPlayers() public view returns (uint256) {
        return s_players.length;
    }

    function getLatestTimeStamp() public view returns (uint256) {
        return s_lastTimeStamp;
    }

    function getRequestConfirmations() public pure returns (uint256) {
        return REQUEST_COMFIRMATIONS;
    }

    function getInterval() public view returns (uint256) {
        return i_interval;
    }

    function getSubscriptionId() public view returns (uint64) {
        return i_subscriptionId;
    }

    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }

    function getNumberOfPlayers() public view returns (uint256) {
        return s_players.length;
    }
}
