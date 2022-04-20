import { ChannelSpec } from './config.js';
import { Readable } from 'stream';
import { Message } from './message.js';

export interface UserInfo {
  userName: string,
  userId: string,
}

export interface AttachedFile {
  buffer: () => Promise<Buffer>,
  url: string,
  name: string,
  mimetype: string,
}

export interface MessageEvent extends UserInfo {
  channelId: string,
  userIcon: string,
  message: Message,
  files: AttachedFile[],
  modified: boolean,
}

export interface ChannelJoinEvent extends UserInfo {
  channelId: string,
}

export namespace EventType {
  export const message = Symbol('Event:Message');
  export const joinChannel = Symbol('Event:JoinChannel');
  export const leaveChannel = Symbol('Event:LeaveChannel');
  export const register = Symbol('Event:Register');
}

export interface RegisterRequest {
  userId: string,
  registerKey?: string,
}

export interface VoiceReceiver {
}

export interface VoiceSender {
  play(path: string): Promise<void>;
  play(stream: Readable): Promise<void>;
}

export interface Remote {
  readonly protocol: string;
  readonly supportMultiVoice: boolean;
  // return channel id
  joinTextChannel(channel: ChannelSpec): Promise<string>;
  joinVoiceChannel?(channel: ChannelSpec): Promise<[string, VoiceReceiver, VoiceSender]>;
  sendMessage(channel: string, userName: string, userIcon: string, message: Message, files: AttachedFile[]): Promise<void>;
  sendMessageAsBot(channel: string, message: string): Promise<void>;

  // event emitter
  on(eventType: typeof EventType.message, callback: (event: MessageEvent) => void): void;
  on(eventType: typeof EventType.joinChannel, callback: (event: ChannelJoinEvent) => void): void;
  on(eventType: typeof EventType.leaveChannel, callback: (event: ChannelJoinEvent) => void): void;
  on(eventType: typeof EventType.register, callback: (request: RegisterRequest) => void): void;
}
