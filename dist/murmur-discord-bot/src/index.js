const { Client, GatewayIntentBits } = require('discord.js');
const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { MurmurClient } = require('../../murmur.js/src/index.ts');
const axios = require('axios');
const crypto = require('crypto');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const FALLBACK_NODE_WS = 'ws://127.0.0.1:9944';
const FALLBACK_API_URL = 'http://127.0.0.1:8000';
// Create MurmurService class based on your previous code
class MurmurService {
    constructor() {
        this.api = null;
        this.client = null;
        this.wsUrl = FALLBACK_NODE_WS;
        this.apiUrl = FALLBACK_API_URL;
        this.init(this.wsUrl).then(() => {
            console.log('MurmurService ready.');
        });
    }
    async init(providerMultiAddr) {
        this.api = await this.setupPolkadotJs(providerMultiAddr);
        const httpClient = axios.create({
            baseURL: this.apiUrl,
            headers: {
                'Content-Type': 'application/json',
            },
        });
        const keyring = new Keyring({ type: 'sr25519' });
        const alice = keyring.addFromUri('//Alice');
        this.client = new MurmurClient(httpClient, this.api, alice);
        console.log('MurmurClient initialized');
    }
    async setupPolkadotJs(providerMultiAddr) {
        const provider = new WsProvider(providerMultiAddr);
        return await ApiPromise.create({ provider });
    }
    async createNew(validity, callback) {
        return this.client.new(validity, callback);
    }
    async executeTransaction(extrinsic, callback) {
        return this.client.execute(extrinsic, callback);
    }
    async inspectUser(username) {
        const result = await this.api.query.murmur.registry(username);
        const humanResult = result.toHuman();
        if (!humanResult || !humanResult.address)
            return { address: '', balance: '' };
        const accountData = await this.api.query.system.account(humanResult.address);
        const balance = accountData.data.free.toString();
        return { address: humanResult.address, balance };
    }
}
// Instantiate the service
const murmurService = new MurmurService();
// Helper function to generate a secret password per user
function generateSecret(userId) {
    return crypto.createHash('sha256').update(userId + process.env.SECRET_SALT).digest('hex');
}
// Discord bot commands
client.on('messageCreate', async (message) => {
    if (message.author.bot)
        return;
    const args = message.content.split(' ');
    const command = args[0].toLowerCase();
    if (command === '!create') {
        const secret = generateSecret(message.author.id);
        const validity = parseInt(args[1]) || 10; // Set default validity
        murmurService.createNew(validity, (result) => {
            message.reply(`Created new entry with validity: ${validity}.`);
        });
    }
    if (command === '!execute') {
        const secret = generateSecret(message.author.id);
        const extrinsic = {}; // You would need to construct this properly
        murmurService.executeTransaction(extrinsic, (result) => {
            message.reply('Transaction executed successfully.');
        });
    }
    if (command === '!inspect') {
        const username = args[1] || 'defaultUsername';
        const userInfo = await murmurService.inspectUser(username);
        message.reply(`User ${username} has address: ${userInfo.address} and balance: ${userInfo.balance}`);
    }
});
client.once('ready', () => {
    console.log('Bot is online!');
});
client.login('MTI5NDAzMjIzNDUyMDc3MjYyOQ.GzLE3i.uzRnzIFnTzENQcJXRQJ5OZs4XbPbwbObqNfy6E');
export {};
