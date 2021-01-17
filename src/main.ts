import config from './config.js';
import { DiscordRemote } from './discord.js';
import { EventType, Remote } from './remote.js';

interface TextBridge {
  nameFormat: string,
  out: [Remote, string][],
}

const remotes: {[name: string]: {
  remote: Remote,
  textBridges: {[channelId: string]: TextBridge}
}} = {};

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
      case 'slack':
        throw new Error('Not yet implemented');
      default:
        throw new Error(`Unknown remote protocol : ${remoteCfg!.protocol}`);
    }

    remotes[name] = {
      remote,
      textBridges: {}
    };
  } catch (e) {

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

      const inRemote = remotes[inRemoteCfg.name];
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

        const outRemote = remotes[outRemoteCfg.name];
        if (outRemote == null) {
          // TODO: log invalid out error
          continue;
        }
        const outChannelId = await outRemote.remote.joinTextChannel(outRemoteCfg);
        bridge.out.push([outRemote.remote, outChannelId]);
      }
    }
  }
}

for (const remote of Object.values(remotes)) {
  remote.remote.on(EventType.message, (event) => {
    const bridge = remote.textBridges[event.channelId];
    if (bridge) {
      for (const [outRemote, channel] of bridge.out) {
        // TODO: log error
        // TODO: format username properly
        outRemote.sendMessage(channel, event.userName, event.userIcon, event.message);
      }
    }
  });
}

// TODO: stream audio channel as streaming
