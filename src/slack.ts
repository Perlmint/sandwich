import { RTMClient } from '@slack/rtm-api';
import fetch from 'node-fetch';
import { ImageBlock, KnownBlock, MessageAttachment } from '@slack/types';
import { ConversationsListArguments, UsersListArguments, WebAPICallResult, WebClient } from '@slack/web-api';
import EventEmitter from 'eventemitter3';
import { ChannelSpec } from './config_def.js';
import { EventType, Remote, MessageEvent, AttachedFile } from './remote.js';

/* eslint-disable camelcase */
/* eslint-disable no-unused-vars */
interface EventFileData {
  title: string,
  name: string,
  mimetype: string,
  url_private: string,
  permalink: string,
  permalink_public: string
};

type BotMessageEvent = {
  subtype: 'bot_message',
};

type BaseSlackMessageEvent = MessageAttachment & {
  user: string,
  files?: EventFileData[],
};

type BasicSlackMessageEvent = BaseSlackMessageEvent & {
  subtype: undefined,
  channel: string,
};

type SlackMessageRepliedEvent = {
  subtype: 'message_replied',
  message: BaseSlackMessageEvent,
  channel: string,
};

type SlackMessageChangedEvent = {
  subtype: 'message_changed',
  message: BasicSlackMessageEvent,
  previous_message: BasicSlackMessageEvent,
};

type SlackMessageEvent = BotMessageEvent | BasicSlackMessageEvent | SlackMessageRepliedEvent | SlackMessageChangedEvent;

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

interface SlackFileResp {
  file: {
    id: string,
    permalink: string,
    permalink_public: string
  }
}

/* eslint-enable no-unused-vars */
/* eslint-enable camelcase */

export class SlackRemote extends EventEmitter implements Remote {
  private rtmClient: RTMClient;
  private webClient: WebClient;
  private userCache: Map<string, SlackUser> = new Map();
  private channelCache: Map<string, SlackChannel> = new Map();

  public readonly protocol = 'slack';
  public readonly supportMultiVoice = false;

  public constructor(token: string) {
    super();

    this.rtmClient = new RTMClient(token);
    this.webClient = new WebClient(token);
  }

  private async createMessageEvent(event: BasicSlackMessageEvent, channel: String): Promise<MessageEvent> {
    const user = await this.getUser(event.user);
    const files = (event.files ?? []).map((file) => ({
      buffer: () => fetch(file.url_private, {
        headers: {
          Authorization: `Bearer ${this.webClient.token}`
        }
      }).then((resp) => resp.buffer()),
      mimetype: file.mimetype,
      name: file.name,
      url: file.permalink_public
    }));

    return {
      channelId: channel,
      message: event.text!,
      userId: user.id,
      userIcon: user.profile.image_72,
      userName: user.real_name,
      files,
      modified: false
    } as MessageEvent;
  }

  public async init(): Promise<void> {
    await Promise.all([this.updateUserCache(), this.updateChannelCache()]);
    this.rtmClient.on('message', async (event: SlackMessageEvent) => {
      if (event.subtype === 'message_changed') {
        const ev = await this.createMessageEvent(event.message, event.message.channel);
        ev.modified = true;

        this.emit(EventType.message, ev);
      } else if (event.subtype === undefined) {
        this.emit(EventType.message, await this.createMessageEvent(event, event.channel));
      }
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

  public async sendMessage(channel: string, userName: string, userIcon: string, message: string, files: AttachedFile[]): Promise<void> {
    const blocks: KnownBlock[] = [];

    if (message.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'plain_text',
          text: message,
          emoji: true
        }
      });
    }

    blocks.push(...await Promise.all((files).map(async (file) => {
      const imageUrl = file.url;

      return {
        type: 'image',
        alt_text: file.name,
        image_url: imageUrl
      } as ImageBlock;
    })));

    const resp = await this.webClient.chat.postMessage({
      channel: channel,
      text: message,
      icon_url: userIcon,
      username: userName,
      blocks: blocks
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
