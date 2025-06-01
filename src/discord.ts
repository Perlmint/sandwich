import {
  Attachment,
  AttachmentBuilder,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Guild,
  GuildBasedChannel,
  GuildChannel,
  TextChannel,
  VoiceChannel,
  Webhook,
  WebhookMessageCreateOptions,
} from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
} from "@discordjs/voice";
import fetch from "node-fetch";
import EventEmitter from "eventemitter3";
import { ChannelSpec } from "./config.js";
import {
  AttachedFile,
  ChannelJoinEvent,
  EventType,
  MessageEvent,
  Remote,
  VoiceReceiver,
  VoiceSender,
} from "./remote.js";
import { Readable } from "stream";
import BiMap from "bidirectional-map";

const mentionPattern = /<@([A-Z0-9]+)>/g;

export class DiscordRemote extends EventEmitter implements Remote {
  private client: Client;
  private webhooks: Map<string, Webhook> = new Map();
  private listenChannels: Map<string, GuildChannel> = new Map();
  private guild!: Guild;

  public readonly protocol = "discord";
  public readonly supportMultiVoice = false;

  public constructor(
    private server: string,
    private userMap: BiMap<string>,
  ) {
    super();

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  public async init(token: string) {
    await this.client.login(token);

    const guild = await this.client.guilds.resolve(this.server);
    if (!guild) {
      throw Error(`Can't resolve guild ${this.server}`);
    }

    this.guild = guild;

    this.client.on(Events.MessageCreate, async (event) => {
      if (!this.listenChannels.has(event.channel.id)) {
        return;
      }
      if (event.system) {
        return;
      }
      if (event.author.bot) {
        return;
      }

      const files = [...event.attachments.values()].map((attachment) => {
        return {
          buffer: async () =>
            fetch(attachment.url).then((resp) => resp.buffer()),
          mimetype: "",
          name: attachment.name ?? "",
          url: attachment.url,
        };
      });

      this.emit(EventType.message, {
        channelId: event.channel.id,
        message: event.content
          .replace(/~~([^~]+)~~/g, "~$1~")
          .replace(/(https?:\/\/[a-z0-9A-Z./?#=&]+)\b/g, "<$1>")
          .replace(mentionPattern, (_, id) => {
            let internalId = this.userMap.get(id);
            if (internalId == null) {
              console.log(`unknown id - discord recv  ${id}`);
              internalId = "unknown";
            }
            return `<@${internalId}>`;
          }),
        userId: event.author.id,
        userIcon: event.author.displayAvatarURL({
          extension: "png",
        }),
        userName: event.author.username,
        files: files,
        modified: false,
      } as MessageEvent);
    });

    this.client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      if (oldState.channelId == null && newState.channelId != null) {
        // join
        const user = newState.member!.user;
        this.emit(EventType.joinChannel, {
          channelId: newState.channelId,
          userId: user.id,
          userName: user.username,
        } as ChannelJoinEvent);
      } else if (oldState.channelId != null && newState.channelId == null) {
        // leave
        const user = oldState.member!.user;
        this.emit(EventType.leaveChannel, {
          channelId: oldState.channelId,
          userId: user.id,
          userName: user.username,
        } as ChannelJoinEvent);
      }
    });

    return new Promise<void>((resolve) =>
      this.client.once(Events.ClientReady, (_) => resolve()),
    );
  }

  private async resolveChannel(
    channelSpec: ChannelSpec,
  ): Promise<GuildBasedChannel> {
    let channel: GuildBasedChannel | undefined | null = null;
    if ("channelName" in channelSpec) {
      channel = this.guild.channels.cache.find(
        (ch) => ch.name === channelSpec.channelName,
      );
    } else {
      channel = await this.guild.channels.resolve(channelSpec.channelId);
    }

    if (!channel) {
      throw new Error(
        `Resolving channel ${JSON.stringify(channelSpec)} failed`,
      );
    }

    return channel;
  }

  // Discord doesn't have joining text channel.
  // Simply verify channel & return channel id
  // if possible, create webhook
  public async joinTextChannel(channelSpec: ChannelSpec): Promise<string> {
    const channel = await this.resolveChannel(channelSpec);

    if (!this.listenChannels.has(channel.id)) {
      if (channel.type === ChannelType.GuildText) {
        this.listenChannels.set(channel.id, channel);
        if (!(channel.id in this.webhooks)) {
          const textChannel = channel as TextChannel;
          const webhooks = await textChannel.fetchWebhooks();
          let webhook = webhooks.find((hook) => hook.name === "sandwich");
          if (!webhook) {
            webhook = await textChannel.createWebhook({
              name: "sandwich",
            });
          }
          this.webhooks.set(channel.id, webhook);
        }
      } else {
        throw new Error(
          `channel ${channel.name}(${channel.id}) is not a text channel`,
        );
      }
    }

    return channel.id;
  }

  public async joinVoiceChannel(
    channelSpec: ChannelSpec,
  ): Promise<[string, VoiceReceiver, VoiceSender]> {
    const channel = await this.resolveChannel(channelSpec);

    if (channel.type !== ChannelType.GuildVoice) {
      throw new Error(
        `channel ${channel.name}(${channel.id}) is not a voice channel`,
      );
    }

    const voiceChannel = channel as VoiceChannel;
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });
    console.log("join voice!");
    const player = createAudioPlayer();
    connection.subscribe(player);

    return [
      channel.id,
      {},
      {
        play: async (pathOrStream: string | Readable) => {
          const res = createAudioResource(pathOrStream);
          player.play(res);
        },
      },
    ];
  }

  public async sendMessage(
    channelName: string,
    userName: string,
    userIcon: string,
    message: string,
    files: AttachedFile[],
  ): Promise<void> {
    const webhook = this.webhooks.get(channelName);
    if (webhook) {
      const content = message.replace(mentionPattern, (_, id) => {
          let discordId = this.userMap.getKey(id);
          if (discordId == null) {
            console.log(`unknown id - send discord ${id}`);
            discordId = "unknown";
          }
          return `<@${discordId}>`;
      });
      const webhookOption: WebhookMessageCreateOptions = {
        content: content !== "" ? content : undefined,
        username: userName,
        avatarURL: userIcon,
        files: await Promise.all(
          files.map(
            async (file) =>
              new AttachmentBuilder(await file.buffer(), {
                name: file.name,
              }),
          ),
        ),
      };
      try {
      await webhook.send(webhookOption);
      } catch (e) {
        console.error("Failed to send message to discord via webhook", e);
        throw e;
      }
    } else {
      throw new Error("send message without webhook is not implemented");
    }
  }

  public async sendMessageAsBot(
    channelName: string,
    message: string,
  ): Promise<void> {
    const webhook = this.webhooks.get(channelName);
    if (webhook) {
      if (message.length !== 0) {
        webhook.send(message);
      }
    } else {
      throw new Error("send message without webhook is not implementd");
    }
  }
}
