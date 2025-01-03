export interface SlackRemote {
  protocol: 'slack',
  web_token: string,
  socket_token: string,
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

export interface TTSAWSConfig {
  type: 'aws-polly',
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
  voiceId: string,
}

export type TTSConfig = TTSAWSConfig;

export type AudioStream = ChannelSpec & {
  name?: string,
  remote: string,
  enteranceAudioNotification?: {
    format: {
      join: string[],
      leave: string[],
    },
  },
}

export interface Gamify {
  name: string,
  command: string,
  from: BridgeRemote[],
  targets: BridgeRemote[]
}

export interface Config {
  remote: { [name: string]: Remote },
  tts?: TTSConfig,
  bridge?: Bridge[],
  audioStream?: AudioStream[],
  gamify?: Gamify[]
}
