const { assert, expect } = require("chai")
const { getNamedAccounts, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

developmentChains.includes(network.name)
    ? describe.skip // skip staging test if we are on local network
    : describe("Raffle Uinit Test", function () {
          let raffle, raffleEntranceFee, deployer

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              raffle = await ethers.getContract("Raffle", deployer)
              raffleEntranceFee = await raffle.getEntranceFee() // get it from hardhat-config
          })

          describe("fulfillRandomWords", function () {
              it("works with live Chainlink Keeoers and Chainlink VRF, we get a random winner", async () => {
                  // Chainlink Keeoers and Chainlink VRF kick off the enterRaffle()
                  // enter the raffle
                  console.log("Setting up test...")
                  const startingTimeStamp = await raffle.getLatestTimeStamp()
                  const accounts = await ethers.getSigners() //accounts?
                  console.log(startingTimeStamp)

                  console.log("Setting up Listener...")
                  await new Promise(async (resolve, reject) => {
                      // Setup the listener before we enter the raffle
                      // Just in case the blockchain moves REALLY fast
                      raffle.once("WinnerPicked", async () => {
                          console.log("WinnerPicked event fired!")
                          try {
                              // add assert
                              const recentWinner = await raffle.getRecentWinner()
                              const raffleState = await raffle.getRaffleState()
                              const winnerEndingBalance = await accounts[0].getBalance() // accounts[0] is deployer
                              const endingTimeStamp = await raffle.getLatestTimeStamp()

                              await expect(raffle.getPlayer(0)).to.be.reverted // ?
                              assert(
                                  recentWinner.toString() == accounts[0].address,
                                  raffleState.toString() == "0",
                                  winnerEndingBalance.toString() ==
                                      winnerStartingBalance.add(raffleEntranceFee).toString(),
                                  startingTimeStamp < endingTimeStamp
                              )
                              resolve()
                          } catch (error) {
                              console.log(error)
                              reject(e)
                          }
                      })
                      const SubId = await raffle.getSubscriptionId() // 1
                      console.log(`SubId:${SubId}`)
                      console.log("Entering Raffle...")
                      const tx = await raffle.enterRaffle({ value: raffleEntranceFee })
                      await tx.wait(1)
                      console.log("Entered!")
                      const upkeepNeededBefore = await raffle.callStatic.checkUpkeep([]) // true
                      console.log(`upkeepNeeded before performUpkeep: ${upkeepNeededBefore}`)

                      //   const performUpkeepReceipt = await raffle.callStatic.performUpkeep([]).wait(1) // ?
                      //   console.log(
                      //       `requestId of performUpkeepReceipt: ${performUpkeepReceipt.events[1].args.requestId}`
                      //   )
                      const upkeepNeededAfter = await raffle.callStatic.checkUpkeep([]) // true

                      console.log(`upkeepNeeded after performUpkeep: ${upkeepNeededAfter}`)
                      console.log("Ok, time to wait...")
                      const winnerStartingBalance = await accounts[0].getBalance()

                      // and this code WONT complete until our listener has finished listening!

                      // checkUpkeep(), performUpkeep() and fulfillRamdonWords() will be kicked off by Chainlink Keeoers and Chainlink VRF
                  })
              })
          })
      })
