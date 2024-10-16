import tmi from 'tmi.js'
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { MurmurClient } from '@ideallabs/murmur.js'
import { BN } from 'bn.js'
import axios from 'axios'
import crypto from 'crypto'
import 'dotenv/config'

const TWITCH = 'twitch'
// Twitch bot configuration
const client = new tmi.Client({
    identity: {
        username: process.env.TWITCH_BOT_USERNAME,
        password: process.env.TWITCH_OAUTH_TOKEN // oauth:xxxxxx
    },
    channels: ['driemworks']
})

const FALLBACK_NODE_WS = 'ws://127.0.0.1:9944'
const FALLBACK_API_URL = 'http://127.0.0.1:8000'

// Store user sessions to track authentication
const userSessions = {}

class MurmurService {
    constructor() {
        this.api = null
        this.client = null
        this.wsUrl = FALLBACK_NODE_WS
        this.apiUrl = FALLBACK_API_URL

        this.init(this.wsUrl).then(() => {
            console.log('MurmurService ready.')
        })
    }

    async init(providerMultiAddr) {
        this.api = await this.setupPolkadotJs(providerMultiAddr)

        const httpClient = axios.create({
            baseURL: this.apiUrl,
            headers: {
                'Content-Type': 'application/json',
            },
        })

        const keyring = new Keyring({ type: 'sr25519' })
        const alice = keyring.addFromUri('//Alice')
        this.client = new MurmurClient(httpClient, this.api, alice)

        console.log('MurmurClient initialized')
    }

    async setupPolkadotJs(providerMultiAddr) {
        const provider = new WsProvider(providerMultiAddr)
        return await ApiPromise.create({ provider })
    }

    async authenticate(username, password) {
        return this.client.authenticate(username, password)
    }

    async createNew(validity, callback) {
        return this.client.new(validity, callback)
    }

    async executeTransaction(extrinsic, callback) {
        return this.client.execute(extrinsic, callback)
    }

    async inspectUser(username) {
        const result = await this.api.query.murmur.registry(username)
        const humanResult = result.toHuman()
        if (!humanResult || !humanResult.address) return { address: '', balance: '' }

        const accountData = await this.api.query.system.account(humanResult.address)
        const balance = accountData.data.free.toString()
        return { address: humanResult.address, balance }
    }
}

// Instantiate the service
const murmurService = new MurmurService()

// Helper function to generate a secret password per user
function generateSecret(userId) {
    return crypto.createHash('sha256').update(userId + process.env.SECRET_SALT).digest('hex')
}

// Helper to check if a user is authenticated
function isAuthenticated(userId) {
    return userSessions[userId] && userSessions[userId].authenticated
}

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
            murmurService.authenticate(username  + TWITCH, secret).then(() => {
                userSessions[tags['user-id']] = { authenticated: true, secret }
                client.say(channel, `@${username}, authenticated successfully.`)   
            })
        } catch (err) {
            console.log(err)
            client.say(channel, `@${username}, authentication failed.`)
        }
    }

    // Create command (requires authentication)
    if (command === '!create') {
        if (!isAuthenticated(tags['user-id'])) {
            return client.say(channel, `@${tags['display-name']}, please authenticate using \`!auth\` first.`)
        }

        const validity = parseInt(args[2]) || 10 // Set default validity
        murmurService.createNew(validity, (result) => {
            if (result.status.isInBlock)
                client.say(channel, `@${tags['display-name']}, created new entry with validity: ${validity}.`)
        })
    }

    // Execute command (requires authentication)
    if (command === '!execute') {
        if (!isAuthenticated(tags['user-id'])) {
            return client.say(channel, `@${tags['display-name']}, please authenticate using \`!auth\` first.`)
        }

        const username = tags['display-name']
        const userInfo = await murmurService.inspectUser(username  + TWITCH)
        if (userInfo === '') {
            return client.say(channel, `@${username}, you must first create a wallet with !create.`)
        }

        const recipient = args[2]
        const amount = args[3]

        let balance = new BN(amount * Math.pow(10, 12))
        let tx = await murmurService.api.tx.balances.transferKeepAlive(recipient, balance)

        murmurService.executeTransaction(tx, (result) => {
            if (result.status.isInBlock)
                client.say(channel, `@${username}, transaction executed successfully.`)
        })
    }

    // Inspect command (publicly accessible)
    if (command === '!inspect') {
        const username = tags['display-name']
        const userInfo = await murmurService.inspectUser(username + TWITCH)
        client.say(channel, `User ${username} has address: ${userInfo.address} and balance: ${userInfo.balance}`)
    }
})
