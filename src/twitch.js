/*
 * Copyright 2024 by Ideal Labs, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import tmi from 'tmi.js'
import { BN } from 'bn.js'
import dotenv from 'dotenv'
import {
  MurmurService,
  generateSecret,
  isAuthenticated,
  executeWithRetries,
} from './index.js'

dotenv.config({ path: '.env.twitch' })
const TWITCH = 'twitch'

// Twitch bot configuration
const client = new tmi.Client({
  identity: {
    username: process.env.TWITCH_BOT_USERNAME,
    password: process.env.TWITCH_OAUTH_TOKEN,
  },
  channels: [process.env.TWITCH_CHANNEL],
})

// Store user sessions to track authentication
const userSessions = {}

const murmurService = new MurmurService()

client.connect().then(() => {
  console.log('Twitch Bot is online!')
})

// Twitch bot commands
client.on('message', async (channel, tags, message, self) => {
  if (self) return // Ignore messages from the bot

  const args = message.split(' ')
  let command = args[1]
  if (command === undefined) return
  command = command.toLowerCase()

  // Auth command
  if (command === '!auth') {
    const secret = generateSecret(tags['user-id'])
    const username = tags['display-name']

    try {
      murmurService.authenticate(username + TWITCH, secret).then(() => {
        userSessions[tags['user-id']] = { authenticated: true, secret }
        client.say(channel, `@${username}, authenticated successfully.`)
      })
    } catch (err) {
      console.log(err)
      client.say(channel, `@${username}, authentication failed.`)
    }
  }

  if (command === '!drip') {
    if (!isAuthenticated(tags['user-id'], userSessions)) {
      return client.say(
        channel,
        `@${tags['display-name']}, please authenticate using \`!auth\` first.`
      )
    }

    const username = tags['display-name']
    const userInfo = await murmurService.inspectUser(username + TWITCH)
    if (userInfo.address == '')
      return client.say(channel, 'You must call !create <validity> first.')
    const address = userInfo.address
    murmurService.faucet(address, () => {
      client.say(channel, `Sent 500 tokens to @${username}.`)
    })
  }

  // Create command (requires authentication)
  if (command === '!create') {
    if (!isAuthenticated(tags['user-id'], userSessions)) {
      return client.say(
        channel,
        `@${tags['display-name']}, please authenticate using \`!auth\` first.`
      )
    }

    const validity = parseInt(args[2]) || 10 // Set default validity
    murmurService.createNew(validity, (result) => {
      if (result.status.isInBlock)
        client.say(
          channel,
          `@${tags['display-name']}, created new entry with validity: ${validity}.`
        )
    })
  }

  // Execute command (requires authentication)
  if (command === '!execute') {
    if (!isAuthenticated(tags['user-id'], userSessions)) {
      return client.say(
        channel,
        `@${tags['display-name']}, please authenticate using \`!auth\` first.`
      )
    }

    const username = tags['display-name']
    const userInfo = await murmurService.inspectUser(username + TWITCH)
    if (userInfo === '') {
      return client.say(
        channel,
        `@${username}, you must first create a wallet with !create.`
      )
    }

    const recipient = args[2]
    const amount = args[3]

    let balance = new BN(amount * Math.pow(10, 12))
    let tx = await murmurService.api.tx.balances.transferKeepAlive(
      recipient,
      balance
    )

    executeWithRetries(
      murmurService,
      tx,
      () => {
        client.say(channel, `@${username}, transaction executed successfully.`)
      },
      (retries) => {
        client.say(
          channel,
          `@${username}, transaction execution failed (timing). Attempting retry ${retries + 1} of ${process.env.MAX_RETRIES}`
        )
      },
      () => {
        client.say(
          channel,
          `@${username}, maximum retry limit reached. Transaction failed.`
        )
      }
    )
  }

  // Inspect command (publicly accessible)
  if (command === '!inspect') {
    const username = tags['display-name']
    const userInfo = await murmurService.inspectUser(username + TWITCH)
    client.say(
      channel,
      `User ${username} has address: ${userInfo.address} and balance: ${userInfo.balance}`
    )
  }

  if (command === '!help') {
    client.say(
      channel,
      `
            Available Commands:
                !auth - Authenticate with the service.
                !create <validity> - Create a new entry with optional validity.
                !drip - Receive 500 tokens (requires authentication).
                !execute <recipient> <amount> - Execute a token transfer (requires authentication).
                !inspect - Inspect your current balance and address.
                !help - Display the help message
        `
    )
  }
})
