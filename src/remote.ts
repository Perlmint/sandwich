import { ChannelSpec } from './config.js';

export interface MessageEvent {
  channelId: string,
  userName: string,
  userId: string,
  userIcon: string,
  message: string,
}

export namespace EventType {
  export const message = Symbol('Event:Message');
}

export interface Remote {
  // return channel id
  joinTextChannel(channel: ChannelSpec): Promise<string>;
  joinVoiceChannel?(channel: ChannelSpec): Promise<ReadableStream>;
  sendMessage(channel: string, userName: string, userIcon: string, message: string): Promise<void>;

  // event emitter
  on(eventType: typeof EventType.message, callback: (event: MessageEvent) => void): void;
}
