import { Client, GatewayIntentBits, Partials } from 'discord.js'
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { MurmurClient } from '../../murmur.js/dist/index.js'
import { BN } from 'bn.js'
import axios from 'axios'
import crypto from 'crypto'

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        //   GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel]
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

// Discord bot commands
client.on('messageCreate', async message => {
    if (message.author.bot) return

    const args = message.content.split(' ')
    const command = args[1].toLowerCase()
    console.log(command)
    
    if (command === '!auth') {
        const secret = generateSecret(message.author.id)
        const username = message.author.username
        console.log('calling authenticate')

        try {
            await murmurService.authenticate(username, secret)
            userSessions[message.author.id] = { authenticated: true, secret }
            message.reply('Authenticated successfully.')
        } catch (err) {
            message.reply('Authentication failed.')
        }
    }

    // Create command (requires authentication)
    if (command === '!create') {
        if (!isAuthenticated(message.author.id)) {
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
        if (!isAuthenticated(message.author.id)) {
            return message.reply('Please authenticate using `!auth` first.')
        }

        const username = message.author.username
        const userInfo = await murmurService.inspectUser(username)
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

        murmurService.executeTransaction(tx, (result) => {
            if (result.status.isInBlock) 
                message.reply('Transaction executed successfully.')
        })
        }

        // Inspect command (publicly accessible)
        if (command === '!inspect') {
            // const username = args[1] || 'defaultUsername'
            const username = message.author.username
            const userInfo = await murmurService.inspectUser(username)
            message.reply(`User ${username} has address: ${userInfo.address} and balance: ${userInfo.balance}`)
        }
    })

client.once('ready', () => {
    console.log('Bot is online!')
})

client.login(process.env.DISCORD_BOT_TOKEN)
