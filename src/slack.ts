import { RTMClient } from '@slack/rtm-api';
import { MessageAttachment } from '@slack/types';
import { ConversationsListArguments, UsersListArguments, WebAPICallResult, WebClient } from '@slack/web-api';
import EventEmitter from 'eventemitter3';
import { ChannelSpec } from './config_def.js';
import { EventType, Remote, MessageEvent } from './remote.js';

/* eslint-disable camelcase */
type SlackMessageEvent = MessageAttachment & {
  subtype?: 'bot_message',
  user: string,
  channel: string,
};

interface SlackUser {
  id: string,
  name: string,
  real_name: string,
  profile: {
    image_72: string,
  },
}

interface SlackChannel {
  id: string,
  name: string,
  is_member: boolean,
}

interface UserListResp {
  members: SlackUser[],
  next_cursor?: string,
}

interface ChannelListResp {
  channels: SlackChannel[],
  next_cursor?: string,
}
/* eslint-enable camelcase */

export class SlackRemote extends EventEmitter implements Remote {
  private rtmClient: RTMClient;
  private webClient: WebClient;
  private userCache: Map<string, SlackUser> = new Map();
  private channelCache: Map<string, SlackChannel> = new Map();

  public readonly protocol = 'slack';

  public constructor(token: string) {
    super();

    this.rtmClient = new RTMClient(token);
    this.webClient = new WebClient(token);
  }

  public async init(): Promise<void> {
    await Promise.all([this.updateUserCache(), this.updateChannelCache()]);
    this.rtmClient.on('message', async (event: SlackMessageEvent) => {
      if (event.subtype === 'bot_message') {
        return;
      }
      const user = await this.getUser(event.user);
      this.emit(EventType.message, {
        channelId: event.channel,
        message: event.text!,
        userIcon: user.profile.image_72,
        userName: user.real_name
      } as MessageEvent);
    });
    await this.rtmClient.start();
  }

  private async getUser(userID: string): Promise<SlackUser> {
    const user = this.userCache.get(userID);
    if (user) {
      return user;
    }

    throw new Error(`Cache invalid ${userID}`);
  }

  private async updateUserCache(): Promise<void> {
    const arg: UsersListArguments = {};
    const newCache = new Map();
    while (true) {
      const resp = (await this.webClient.users.list(arg)) as WebAPICallResult & UserListResp;

      for (const user of resp.members) {
        newCache.set(user.id, user);
      }

      if (resp.next_cursor == null) {
        break;
      }

      arg.cursor = resp.next_cursor;
    }

    this.userCache = newCache;
  }

  private async updateChannelCache(): Promise<void> {
    const arg: ConversationsListArguments = {};
    const newCache = new Map();
    while (true) {
      const resp = (await this.webClient.conversations.list(arg)) as WebAPICallResult & ChannelListResp;

      for (const channel of resp.channels) {
        newCache.set(channel.id, channel);
      }

      if (resp.next_cursor == null) {
        break;
      }

      arg.cursor = resp.next_cursor;
    }
    this.channelCache = newCache;
  }

  private async getChannel(channelSpec: ChannelSpec): Promise<SlackChannel> {
    if ('channelId' in channelSpec) {
      const channel = this.channelCache.get(channelSpec.channelId);
      if (channel) {
        return channel;
      }
    } else {
      for (const channel of this.channelCache.values()) {
        if (channel.name === channelSpec.channelName) {
          return channel;
        }
      }
    }

    throw new Error('Cache invalid');
  }

  public async joinTextChannel(channelSpec: ChannelSpec): Promise<string> {
    const channel = await this.getChannel(channelSpec);
    if (channel.is_member) {
      return channel.id;
    } else {
      const resp = await this.webClient.conversations.join({ channel: channel.id });
      if (resp.ok) {
        return channel.id;
      } else {
        throw new Error(`Failed to join channel - ${resp.error!}`);
      }
    }
  }

  public async sendMessage(channel: string, userName: string, userIcon: string, message: string): Promise<void> {
    const resp = await this.webClient.chat.postMessage({
      channel: channel,
      text: message,
      icon_url: userIcon,
      username: userName
    });
    if (resp.error) {
      throw new Error(`${resp.error}`);
    }
  }

  public async sendMessageAsBot(channel: string, message: string): Promise<void> {
    const resp = await this.webClient.chat.postMessage({
      channel: channel,
      text: message
    });
    if (resp.error) {
      throw new Error(`${resp.error}`);
    }
  }
}
