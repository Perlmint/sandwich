import 'source-map-support';
import config from './config.js';
import { DiscordRemote } from './discord.js';
import { EventType, Remote } from './remote.js';
import { SlackRemote } from './slack.js';

interface TextBridge {
  nameFormat: string,
  out: [Remote, string][],
}

interface RemoteInstance {
  remote: Remote,
  textBridges: {[channelId: string]: TextBridge},
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
      for (const [outRemote, channel] of bridge.out) {
        // TODO: format username properly
        outRemote.sendMessage(channel, event.userName, event.userIcon, event.message).catch((e) => console.error(e));
      }
    }
  });
}

console.log('Bot is ready!');

// TODO: stream audio channel as streaming
