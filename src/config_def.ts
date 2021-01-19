export interface SlackRemote {
  protocol: 'slack',
  token: string,
}

export interface DiscordRemote {
  protocol: 'discord',
  token: string,
  server: string,
}

export type Remote = SlackRemote | DiscordRemote;

export type BridgeDirection = 'in' | 'out' | 'inout';

export type ChannelSpec = {
  channelName: string
} | {
  channelId: string
};

export interface BridgeRemoteBase {
  name: string,
  direction: BridgeDirection,
}

export type BridgeRemote = BridgeRemoteBase & ChannelSpec;

export interface Bridge {
  nameFormat: string,
  remotes: BridgeRemote[],
}

export interface AudioStream {
  name: string,
  remote: string,
  channel: string,
}

export interface Gamify {
  name: string,
  command: string,
  from: BridgeRemote[],
  targets: BridgeRemote[]
}

export interface Config {
  remote: { [name: string]: Remote },
  bridge?: Bridge[],
  audioStream?: AudioStream[],
  gamify?: Gamify[]
}
