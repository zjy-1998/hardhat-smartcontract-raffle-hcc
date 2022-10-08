const { assert, expect } = require("chai")
const { getNamedAccounts, ethers, network, deployments } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Uinit Test", function () {
          let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval
          const chainId = network.config.chainId

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              raffle = await ethers.getContract("Raffle", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              raffleEntranceFee = await raffle.getEntranceFee() // get it from hardhat-config
              interval = await raffle.getInterval()
              subscriptionId = await raffle.getSubscriptionId()
              await vrfCoordinatorV2Mock.addConsumer(subscriptionId, raffle.address) // solve the 'InvalidConsumer()' error
          })

          describe("constructor", function () {
              it("initializes the raffle correctly", async function () {
                  // Ideally we make our tests have just 1 assert per "it"
                  const raffleState = await raffle.getRaffleState()
                  assert.equal(raffleState.toString(), "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"].toString())
              })
          })

          describe("enterRaffle", function () {
              it("reverts whhen you don't pay enough", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle_NotEnoughETHEntered" // check to see if an error is fired->触发
                  )
              })
              it("records players when they enter", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  const playerFromContact = await raffle.getPlayer(0)
                  assert.equal(playerFromContact, deployer)
              })

              it("emits event on enter", async function () {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  )
                  // RafflrEnter is an difined event in raffle contract
              })

              it("doesn't allow entrance when raffle is calculating", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]) // increase time
                  await network.provider.send("evm_mine", [])
                  // await network.provider.send({method:"evm_mine", params:[]})
                  // pretend to be chainlink keeper
                  await raffle.performUpkeep([]) // Now it should be in calculating state
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle_NotOpen"
                  )
              })
          })

          describe("checkUpkeep", function () {
              it("returns false if people haven't sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  //   await raffle.checkUpkeep([])
                  //   const balance = await raffle.getBalance() // 0
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  // don't want to send a tx (may changes the status), use callStatic to simulate sending this tx
                  // should return false because no balance
                  // just extrapolate the upkeepNeeded (where we can get 2 outputs from checkUpkeep())
                  assert(!upkeepNeeded)
              })

              it("returns false if raffle isn't open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee }) // raffleStateBefore=="0", OPEN
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const raffleStateBefore = await raffle.getRaffleState()
                  await raffle.performUpkeep("0x") // "0x" and [] both work
                  // send a blank bites object "0x"; upkeepNeeded=true by checkUpkeep(); raffleState="1", CALCULATING
                  //   const balance = await raffle.getBalance() // 10000000000000000
                  const raffleState = await raffle.getRaffleState() // should return CALCULATING
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]) // upkeepNeeded=false
                  assert.equal(raffleState.toString() == "1", upkeepNeeded == false)
              })

              it("returns false if enough time hasn't passed", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(!upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(upkeepNeeded)
              })
          })

          describe("performUpkeep", function () {
              it("can only run if checkUpkeep is true", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber()])
                  await network.provider.send("evm_mine", [])
                  const tx = await raffle.performUpkeep([])
                  assert(tx) // if tx doesn't work or error, this will fail
              })
              it("reverts when checkUpkeep is false", async function () {
                  await expect(raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffle_UpkeepNotNeeded"
                  )
              })
              it("updates the raffle state, emits event, and calls the vrf coordinator", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber()])
                  await network.provider.send("evm_mine", [])
                  const txResponse = await raffle.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  //   const event_0 = txReceipt.events[0] // no args
                  const requestId = txReceipt.events[1].args.requestId // event[0] is redundant.
                  // we can get requestId from emitted event in raffle (redundant); vrfCoordinatorV2Mock also emit event with requestId
                  const raffleState = await raffle.getRaffleState()
                  assert(requestId.toNumber() > 0, raffleState.toString() == "1")
              })
          })
          describe("fulfillRandomWords", function () {
              // somebody has enter the raffle before we test this
              beforeEach(async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
              })
              it("can only be called after performUpkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
                  // Impossible to test all the _requestId; we will use fuzz testing 模糊测试
              })

              // Wayyyy to big, put them all into one:
              // This test is too big...
              // This test simulates users entering the raffle and wraps the entire functionality of the raffle
              // inside a promise that will resolve if everything is successful.
              // An event listener for the WinnerPicked is set up
              // Mocks of chainlink keepers and vrf coordinator are used to kickoff this winnerPicked event
              // All the assertions are done once the WinnerPicked event is fired
              it("picks a winner, resets the lottory, and send money", async function () {
                  // add additional entrants
                  const additinalEntrants = 3
                  const startingAccountIndex = 1 // deployer=0; have 4 people connect to the raffle
                  const accounts = await ethers.getSigners()
                  console.log(`contract starting balance: ${await raffle.getBalance()}`)
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additinalEntrants;
                      i++
                  ) {
                      // connect entrants account; let them enter
                      const accountConnectedRaffle = raffle.connect(accounts[i]) // Returns a new instance of the Raffle contract connected to player
                      console.log(`${accounts[i].address} : ${await accounts[i].getBalance()}`)
                      await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
                      // enterRaffle({ value: raffleEntranceFee }): Contract can get the balance at the value of raffleEntranceFee from accounts
                      console.log(`${accounts[i].address} : ${await accounts[i].getBalance()}`)
                  }
                  // stores starting timestamp (before we fire our event)
                  console.log(`contract after enterRaffle balance: ${await raffle.getBalance()}`)
                  const startingTimeStamp = await raffle.getLatestTimeStamp()

                  // performUpkeep -> mock being chainlink keepers
                  // fulfillRandomWOrds -> mock being chainlink VRF
                  /* simulate we do need to wait for that event to be called in local blockchain, 
                   for which we need to set up a listener. We set this listner to make the test finish 
                   after listening. Therefore, we need to create a new promise. Important for staging test. 
                  */
                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          console.log("WinnerPicked event fired!")
                          try {
                              // assert throws an error if it fails, so we need to wrap
                              // it in a try/catch so that the promise returns event
                              // if it fails.
                              //   console.log(accounts[0].address)
                              //   console.log(accounts[1].address)
                              //   console.log(accounts[2].address)
                              //   console.log(accounts[3].address)
                              const recentWinner = await raffle.getRecentWinner()
                              console.log(`recentWinner: ${recentWinner}`)
                              const winnerEndingBalance = await accounts[1].getBalance()
                              const raffleState = await raffle.getRaffleState()
                              const endingTimeStamp = await raffle.getLatestTimeStamp()
                              const numPlayers = await raffle.getNumberOfPlayers()
                              console.log(`winnerStartingBalance: ${winnerStartingBalance}
                              winnerEndingBalance: ${winnerEndingBalance}
                              raffleEntranceFee: ${raffleEntranceFee}
                              additinalEntrants: ${additinalEntrants}`)
                              //   for (let i = 0; i < additinalEntrants + 1; i++) {
                              //       console.log(
                              //           `${accounts[i].address} : ${(
                              //               await accounts[i].getBalance()
                              //           ).toString()}`
                              //       )
                              //   }
                              console.log(`contract ending balance: ${await raffle.getBalance()}`)
                              assert(
                                  numPlayers.toString() == "0",
                                  raffleState.toString() == "0", // NO = ; NO assignment!
                                  endingTimeStamp > startingTimeStamp,
                                  winnerEndingBalance.toString() ==
                                      winnerStartingBalance.add(
                                          raffleEntranceFee // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee ) ; Include the deplyer
                                              .mul(additinalEntrants)
                                              .add(raffleEntranceFee)
                                              .toString()
                                      )
                              )
                          } catch (e) {
                              reject(e) // if try fails, rejects the promise
                          }
                          resolve() // if try passes, resolves the promise
                      }) // ()=>{} anonymous function
                      /* if we put code outside of the promise, this promise will never get resolved, because listener
                       will never fire its event. The code below this Promise alway waits for its resolving. We need 
                       to add all of our code inside the promise but outside the raffle.once(). 
                      */
                      // Set up the listener
                      // below, we will fire the event, and the listener will pick it up, and resolve
                      //   const SubId = await raffle.getSubscriptionId() // 1
                      //   const upkeepNeeded = await raffle.callStatic.checkUpkeep([]) // true
                      const tx = await raffle.performUpkeep([]) // mocking chainlink keepers
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance = await accounts[1].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId, // !!!!!!!requestId!!!!!
                          raffle.address
                      ) // mocking the chainlink vrf; raffle.once() is listening for this to get emitted.
                  }) // set timeout in mocha in hardhat.cogfig. >200s this promise without getting fired, test failed.
              })
          })
      })
