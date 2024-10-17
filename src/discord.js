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

import { Client, GatewayIntentBits, Partials } from 'discord.js'
import { BN } from 'bn.js'
import { MurmurService, generateSecret, isAuthenticated, executeWithRetries } from './index.js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.discord' })

const DISCORD = 'discord'
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel]
})
// Store user sessions to track authentication
const userSessions = {}

// Instantiate the service
const murmurService = new MurmurService()
// Discord bot commands
client.on('messageCreate', async message => {
    if (message.author.bot) return

    const args = message.content.split(' ')

    console.log(args)
    let command = args[1]

    if (command === undefined) return

    command = command.toLowerCase()
    console.log(command)

    if (command === '!auth') {
        const secret = generateSecret(message.author.id)
        const username = message.author.username + DISCORD
        console.log('calling authenticate')

        try {
            await murmurService.authenticate(username, secret)
            userSessions[message.author.id] = { authenticated: true, secret }
            message.reply('Authenticated successfully.')
        } catch (err) {
            console.log(err)
            message.reply('Authentication failed.')
        }
    }

    if (command === '!drip') {
        if (!isAuthenticated(message.author.id, userSessions)) {
            return message.reply('Please authenticate using `!auth` first.')
        }

        // ensure a proxy exists first
        const username = message.author.username
        const userInfo = await murmurService.inspectUser(username + DISCORD)
        if (userInfo.address == '') return message.reply('You must call !create <validity> first')
        const address = userInfo.address;
        murmurService.faucet(address, () => {
            message.reply(`Sent 500 tokens to @${username}.`)
        });
    }

    // Create command (requires authentication)
    if (command === '!create') {
        if (!isAuthenticated(message.author.id, userSessions)) {
            return message.reply('Please authenticate using `!auth` first.')
        }

        const validity = parseInt(args[2]) || 10 // Set default validity
        murmurService.createNew(validity, (result) => {
            if (result.status.isInBlock)
                message.reply(`Created new entry with validity: ${validity}.`)
        })
    }

    // Execute command (requires authentication)
    if (command === '!execute') {
        if (!isAuthenticated(message.author.id, userSessions)) {
            return message.reply('Please authenticate using `!auth` first.')
        }

        const username = message.author.username
        const userInfo = await murmurService.inspectUser(username + DISCORD)
        if (userInfo === '')
            return message.reply('You must first create a wallet with !create')

        // todo: get recipient
        const recipient = args[2]
        // todo: get amount
        const amount = args[3]

        let balance = new BN(amount * Math.pow(10, 12))
        let tx = await murmurService.api
            .tx
            .balances
            .transferKeepAlive(recipient, balance)


        executeWithRetries(murmurService, tx,
            () => {
                message.reply(`@${username}, transaction executed successfully.`);
            }, (retries) => {
                message.reply(`@${username}, transaction execution failed (timing). Attempting retry ${retries + 1} of ${process.env.MAX_RETRIES}`)
            }, () => {
                message.reply(`@${username}, maximum retry limit reached. Transaction failed.`)
            })

    }

    // Inspect command (publicly accessible)
    if (command === '!inspect') {
        const username = message.author.username
        const userInfo = await murmurService.inspectUser(username + DISCORD)
        message.reply(`User ${username} has address: ${userInfo.address} and balance: ${userInfo.balance}`)
    }

    if (command === '!help') {
        message.reply(`
            Available Commands:
                !auth - Authenticate with the service.
                !create <validity> - Create a new entry with optional validity.
                !drip - Receive 500 tokens (requires authentication).
                !execute <recipient> <amount> - Execute a token transfer (requires authentication).
                !inspect - Inspect your current balance and address.
                !help - Display the help message
        `)
    }
})

client.once('ready', () => {
    console.log('Bot is online!')
})

client.login(process.env.DISCORD_BOT_TOKEN)

