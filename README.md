# Murmur Bots

This is a collection of node.js-based implementations of the murmur protocol. Specifically, this repo contains bot integrations for both [Discord](https://discordapp.com/) and [Twitch](https://www.twitch.tv/), enabling per-channel/server wallets via Murmur.

To learn more about the Murmur protocol, visit the documentation at https://murmur.idealabs.network.

## Getting Started

### Discord

#### Setup

First create a file called .env.discord in the root of this repo containing the following keys:

``` 
MAX_RETRIES=number of times to retry failed transactions
SECRET_SALT=any string
DISCORD_BOT_TOKEN=a valid discord bot token for the server
```

Once configured, install dependencies and run the bot with
``` shell
npm i
npm run discord
```

### Twitch

Create a file called .env.twitch in the root of this repo containing the following keys:

```
MAX_RETRIES=
SECRET_SALT=any string
TWITCH_BOT_USERNAME=<username of twitch bot>
TWITCH_OAUTH_TOKEN=<twitch chat oauth token>
TWITCH_CHANNEL=<twitch channel name (e.g. your username)>
```

Then instsall depenencies and run the twitch bot with

``` shell
npm i
npm run twitch
```