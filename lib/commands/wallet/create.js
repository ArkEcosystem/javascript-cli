'use strict'

const arkjs = require('arkjs')
const network = require('../../services/network')
const output = require('../../utils/output')
const networks = require('../../config/networks')

/**
 * @dev Create a new wallet.
 * @param {object} cmd A JSON object containing the options for this query (network, format, verbose).
 */
module.exports = async (cmd) => {
  let net = cmd.network ? cmd.network : 'mainnet'
  let format = cmd.format ? cmd.format : 'json'

  try {
    output.setFormat(format)

    // Configure network
    if (!networks[net]) {
      throw new Error(`Unknown network: ${net}`)
    }
    await network.setNetwork(net)
    arkjs.crypto.setNetworkVersion(network.network.version)

    // Create the wallet
    const passphrase = require('bip39').generateMnemonic()
    const wif = arkjs.crypto.getKeys(passphrase).toWIF()
    const address = arkjs.crypto.getAddress(arkjs.crypto.getKeys(passphrase).publicKey)

    const result = {
      seed: passphrase,
      wif,
      address
    }
    output.setTitle('ARK Create wallet')
    output.showOutput(result)
  } catch (error) {
    output.showError(error.message)
    process.exitCode = 1
  }
}