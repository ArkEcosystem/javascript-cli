'use strict'

const Joi = require('joi')
const arkjs = require('arkjs')
const network = require('../../services/network')
const output = require('../../utils/output')
const input = require('../../utils/input')
const accountUtils = require('../../utils/account')
const networks = require('../../config/networks')
const ledger = require('../../ledger/ledger')
const schema = {
  passphrase: Joi.string().required(),
  secondSecret: Joi.string().allow('').optional()
}

/**
 * @dev Unvote the corrently voted delegate.
 * @param {object} cmd A JSON object containing the options for this query (network, node, format, verbose).
 */
module.exports = async (cmd) => {
  let net = cmd.network ? cmd.network : 'mainnet'
  let node = cmd.node ? cmd.node : null
  let format = cmd.format ? cmd.format : 'json'
  let interactive = cmd.interactive ? cmd.interactive : false
  let passphrase = cmd.passphrase ? cmd.passphrase : false
  let secondSecret = cmd.signature ? cmd.signature : null

  // Surpres logging if not --verbose
  if (!cmd.verbose) {
    network.logger.info = () => { }
    network.logger.warn = () => { }
    network.logger.error = (err) => {
      output.showError(err)
    }

    ledger.logger.info = () => { }
    ledger.logger.warn = () => { }
    ledger.logger.error = (err) => {
      output.showError(err)
    }
  }

  try {
    output.setFormat(format)

    let promptPassphrase, promptSignature

    if (!cmd.ledger) {
      // Prompt for optional input (passphrase and SmartBridge)
      promptPassphrase = !cmd.passphrase || cmd.passphrase === true
      promptSignature = cmd.signature === true
    } else {
      // Test if the Ledger is supported
      await ledger.isSupported()
      passphrase = 'pass'
      promptPassphrase = false
      promptSignature = false
    }

    // Prompt for optional input (passphrase and SmartBridge)
    const inputResponse = await input.getPrompt(promptPassphrase, promptSignature)

    if (inputResponse.hasOwnProperty('passphrase')) {
      passphrase = inputResponse.passphrase.toString()
    }

    if (inputResponse.hasOwnProperty('signature')) {
      secondSecret = inputResponse.signature.toString()
    }

    // Validate input
    let _secondSecret = secondSecret === null ? '' : secondSecret
    Joi.validate({
      passphrase,
      secondSecret: _secondSecret
    }, schema, (err) => {
      if (err) {
        throw new Error('The passphrase must be a string.')
      }
    })

    // connect to the network
    if (!networks[net]) {
      throw new Error(`Unknown network: ${net}`)
    }

    await network.setNetwork(net)

    if (node) {
      await network.setServer(node)
      // The network.connect method skips network config when a server and network have been defined already
      const response = await network.getFromNode('/api/loader/autoconfigure')
      network.network.config = response.data.network
    }
    await network.connect(net)

    // Retreive the address for the current passphrase or Ledger address
    let address, publicKey, i
    if (cmd.ledger) {
       // Initialize the ledger
      ledger.setNetwork(network)
      await ledger.connect()

      // Retrieve all wallets from the Ledger
      let wallets = await ledger.getBip44Accounts()

      // Select which wallet to use
      i = await input.getLedgerWallet(wallets)
      publicKey = wallets[i].publicKey
      address = wallets[i].address
    } else {
      const account = accountUtils.getAccountFromSeed(passphrase, network.network.version)
      address = account.address
    }
    // Retreive the currently voted delegate
    const delegates = await accountUtils.getDelegate(network, address)
    let delegate = [`-${delegates.publicKey}`]

    // Create the transaction
    arkjs.crypto.setNetworkVersion(network.network.version)
    const unvotetransaction = arkjs.vote.createVote(passphrase, delegate, secondSecret)

    // Execute the transaction
    if (interactive) {
      // Promt to confirm transaction
      const message = `Removing vote for ${delegates.username} now. Are you sure? Y(es)/N(o)`
      const confirm = await input.promptConfirmTransaction(message)
      if (!confirm) {
        throw new Error('Transaction cancelled by user.')
      }
    }

     if (cmd.ledger) {
      delete unvotetransaction.signature
      delete unvotetransaction.id
      let path = `44'/${network.network.slip44}'/${i}'/0/0`
      unvotetransaction.senderPublicKey = publicKey
      unvotetransaction.recipientId = address
      let signature = await ledger.signTransaction(path, unvotetransaction)
      unvotetransaction.signature = signature
      unvotetransaction.id = arkjs.crypto.getId(unvotetransaction)
    }

    const transactionResponse = await network.postTransaction(unvotetransaction)
    if (!transactionResponse.data.hasOwnProperty('success') || !transactionResponse.data.success) {
      let errorMsg = transactionResponse.data.hasOwnProperty('error') && transactionResponse.data.error
        ? transactionResponse.data.error : 'Failed to post transaction to the network.'
      throw new Error(errorMsg)
    }

    if (transactionResponse.data.hasOwnProperty('transactionIds') && transactionResponse.data.transactionIds.length) {
      // Broadcast the transaction
      try {
        await network.broadcast(unvotetransaction)
      } catch (err) {
        // Do nothing, we are only bradcasting
      }

      const transactionId = transactionResponse.data.transactionIds[0]
      const result = {
        'delegate': delegates.username,
        transactionId
      }
      output.setTitle('ARK Unvote delegate')
      output.showOutput(result)
      return
    }

    throw new Error('Did not receive a transactionId, check status in wallet.')
  } catch (error) {
    output.showError(error.message)
    process.exitCode = 1
  }
}