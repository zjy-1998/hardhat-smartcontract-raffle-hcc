const { ethers } = require("hardhat")
const { developmentChains } = require("../helper-hardhat-config")

const BASE_FEE = ethers.utils.parseEther("0.25") // 0.25 is the premium. It costs 0.25 LINK per request.
const GAS_PRICE_LINK = 1e9 // link per gas. calculated value baased on the gas price of the chain.

// Chainlink nodes pay the gas fee to give us randomness and do external execution
// So they price of request change based on the price of gas

module.exports = async function ({ getNamedAccounts, deployments }) {
    //  getNamedAccounts, deployments: these variables from hardhat runtime environment
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()
    // const chainId = network.config.chainId // we only want to deploy mock on development chain
    const args = [BASE_FEE, GAS_PRICE_LINK]

    if (developmentChains.includes(network.name)) {
        log("Local network detected! Deploying mocks...")
        // deploy a mock vrf coordinator...
        await deploy("VRFCoordinatorV2Mock", {
            from: deployer,
            log: true,
            args: args,
        })
        log("----------Mocks Deployed!----------")
    }
}

module.exports.tags = ["all", "mocks"]
