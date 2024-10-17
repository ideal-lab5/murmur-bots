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

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { MurmurClient } from '@ideallabs/murmur.js'
import { BN } from 'bn.js'
import axios from 'axios'
import crypto from 'crypto'
import 'dotenv/config'

// default to 3 maximum retries
const MAX_RETRIES = process.env.MAX_RETRIES || 3
const FALLBACK_NODE_WS = 'ws://127.0.0.1:9944'
const FALLBACK_API_URL = 'http://127.0.0.1:8000'

// errors that can arise due to timing issues and should result in a limited number of retries
const BAD_CT_ERROR = '0x00000000'
const BAD_MT_ERROR = '0x03000000'

export class MurmurService {
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

    async faucet(address, callback) {
        const call = this.api.tx.balances.transferAllowDeath(address, new BN(500 * Math.pow(10, 12)))
        const keyring = new Keyring({ type: 'sr25519' })
        const alice = keyring.addFromUri('//Alice')
        const unsub = await call.signAndSend(alice, (result) => {
            if (result.status.isInBlock) {
                callback()
            } else if (result.status.isFinalized) {
                unsub()
            }
        })
    }

    async inspectUser(username) {
        const result = await this.api.query.murmur.registry(username)
        const humanResult = result.toHuman()
        if (!humanResult || !humanResult.address) return { address: '', balance: '' }

        const accountData = await this.api.query.system.account(humanResult.address)
        const balance = accountData.data.free.toString()
        const formattedBalance = new BN(balance / Math.pow(10, 12))
        return { address: humanResult.address, balance: formattedBalance }
    }
}

// Helper function to generate a secret password per user
export function generateSecret(userId) {
    return crypto.createHash('sha256').update(userId + process.env.SECRET_SALT).digest('hex')
}

// Helper to check if a user is authenticated
export function isAuthenticated(userId, userSessions) {
    return userSessions[userId] && userSessions[userId].authenticated
}

export async function executeWithRetries(murmurService, tx, successCallback, retryCallback, exhaustedCallback, retries = 0) {
    await murmurService.executeTransaction(tx, (result) => {
        if (result.dispatchError &&
            (result.dispatchError.toHuman().Module.error === BAD_CT_ERROR ||
                result.dispatchError.toHuman().Module.error === BAD_MT_ERROR)) {
            console.log('Dispatch error detected');
            setTimeout(async () => {
                if (retries < MAX_RETRIES) {
                    retryCallback(retries)
                    await executeWithRetries(
                        murmurService,
                        tx,
                        successCallback,
                        retryCallback,
                        exhaustedCallback,
                        retries + 1
                    )
                } else {
                    exhaustedCallback(retries)
                    return
                }
            }, 3000) // 3s cooldown (1 block)
        } else if (result.status.isInBlock) {
            successCallback(result.toHuman())
        }
    });
}
