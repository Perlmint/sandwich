import { ChannelSpec } from './config.js';

export interface UserInfo {
  userName: string,
  userId: string,
}

export interface MessageEvent extends UserInfo {
    channelId: string,
    userIcon: string,
    message: string,
}

export namespace EventType {
export const message = Symbol('Event:Message');
}

export interface Remote {
  readonly protocol: string;
  // return channel id
  joinTextChannel(channel: ChannelSpec): Promise<string>;
  joinVoiceChannel?(channel: ChannelSpec): Promise<ReadableStream>;
  sendMessage(channel: string, userName: string, userIcon: string, message: string): Promise<void>;

  // event emitter
  on(eventType: typeof EventType.message, callback: (event: MessageEvent) => void): void;
}
