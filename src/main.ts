import 'source-map-support';
import config from './config.js';
import { DiscordRemote } from './discord.js';
import { formatName } from './name.js';
import { EventType, Remote } from './remote.js';
import { SlackRemote } from './slack.js';
import { Game, getGames } from './game/gamify.js';

interface TextBridge {
  nameFormat: string,
  out: [Remote, string][],
}

interface RemoteInstance {
  remote: Remote,
  textBridges: { [channelId: string]: TextBridge },
}

const remotes: Map<string, RemoteInstance> = new Map();

// init remotes
for (const name of Object.keys(config.remote)) {
  const remoteCfg = config.remote[name];

  try {
    let remote: Remote;
    switch (remoteCfg.protocol) {
      case 'discord': {
        const newRemote = new DiscordRemote(remoteCfg.server);
        await newRemote.init(remoteCfg.token);
        remote = newRemote;
        break;
      }
      case 'slack': {
        const newRemote = new SlackRemote(remoteCfg.token);
        await newRemote.init();
        remote = newRemote;
        break;
      }
      default:
        throw new Error(`Unknown remote protocol : ${remoteCfg!.protocol}`);
    }

    remotes.set(name, {
      remote,
      textBridges: {}
    });
  } catch (e) {
    console.error(e);
  }
}

// init text bridges
if (config.bridge) {
  for (const bridgeCfg of config.bridge) {
    for (let inIdx = 0, len = bridgeCfg.remotes.length; inIdx < len; inIdx++) {
      const inRemoteCfg = bridgeCfg.remotes[inIdx];
      if (inRemoteCfg.direction === 'out') {
        continue;
      }

      const bridge: TextBridge = {
        nameFormat: bridgeCfg.nameFormat,
        out: []
      };

      const inRemote = remotes.get(inRemoteCfg.name);
      if (!inRemote) {
        console.error(`Remote not found - ${inRemoteCfg.name}`);
        continue;
      }
      const channelId = await inRemote.remote.joinTextChannel(inRemoteCfg);

      inRemote.textBridges[channelId] = bridge;

      for (let outIdx = 0; outIdx < len; outIdx++) {
        if (inIdx === outIdx) {
          continue;
        }

        const outRemoteCfg = bridgeCfg.remotes[outIdx];
        if (outRemoteCfg.direction === 'in') {
          continue;
        }

        const outRemote = remotes.get(outRemoteCfg.name);
        if (!outRemote) {
          // TODO: log invalid out error
          continue;
        }
        const outChannelId = await outRemote.remote.joinTextChannel(outRemoteCfg);
        bridge.out.push([outRemote.remote, outChannelId]);
      }
    }
  }
}

for (const [, remote] of remotes) {
  remote.remote.on(EventType.message, (event) => {
    const bridge = remote.textBridges[event.channelId];
    if (bridge) {
      const username = formatName(bridge.nameFormat, event, remote.remote.protocol);
      for (const [outRemote, channel] of bridge.out) {
        outRemote.sendMessage(channel, username, event.userIcon, event.message).catch((e) => console.error(e));
      }
    }
  });
}

console.log('Bot is ready!');

// TODO: stream audio channel as streaming

// TODO: init gamify settings
const gameMap = getGames();
const games: Game[] = [];

if (config.gamify) {
  const gamifyConfig = config.gamify;
  for (const gamify of gamifyConfig) {
    // config의 네임으로 gamify.ts의 game을 불러오기.
    const GameCtr = gameMap.get(gamify.name);

    if (GameCtr) {
      // target 등록
      const targetRemotes: [Remote, string][] = [];
      for (const targetRemoteConfig of gamify.targets) {
        const targetRemote = remotes.get(targetRemoteConfig.name)?.remote;
        if (targetRemote) {
          const channelId = await targetRemote.joinTextChannel(targetRemoteConfig);
          targetRemotes.push([targetRemote, channelId]);
        }
      }

      // from 등록
      const fromRemotes: [Remote, string][] = [];
      for (const fromRemoteConfig of gamify.from) {
        const fromRemote = remotes.get(fromRemoteConfig.name)?.remote;
        if (fromRemote) {
          const channelId = await fromRemote.joinTextChannel(fromRemoteConfig);
          fromRemotes.push([fromRemote, channelId]);
        }
      }

      const game = new GameCtr(fromRemotes, targetRemotes, gamify.command);
      games.push(game);
    }
  }
}
