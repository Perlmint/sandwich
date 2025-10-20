use anyhow::{Context as _, Result};
use async_trait::async_trait;
use bimap::BiHashMap;
use dashmap::DashMap;
use regex::Regex;
use serenity::{
    all::{ChannelId, CreateAttachment, GuildId, Message, Ready, VoiceState},
    async_trait as serenity_async_trait,
    client::{Context, EventHandler},
    prelude::*,
};
use std::sync::Arc;
use tokio::sync::broadcast;

use crate::config::ChannelSpec;
use crate::remote::{
    AttachedFile, ChannelJoinEvent, Event, EventReceiver, MessageEvent, Remote,
    VoiceReceiver, VoiceSender,
};

struct Handler {
    event_tx: broadcast::Sender<Event>,
    listen_channels: Arc<DashMap<String, ChannelId>>,
    user_map: Option<Arc<BiHashMap<String, String>>>,
}

#[serenity_async_trait]
impl EventHandler for Handler {
    async fn ready(&self, _ctx: Context, ready: Ready) {
        tracing::info!("Discord bot connected as {}", ready.user.name);
    }

    async fn message(&self, _ctx: Context, msg: Message) {
        // Ignore messages not in listen channels
        if !self.listen_channels.contains_key(&msg.channel_id.to_string()) {
            return;
        }

        // Ignore system messages and bot messages
        if msg.author.bot {
            return;
        }

        let files: Vec<AttachedFile> = msg
            .attachments
            .iter()
            .map(|attachment| AttachedFile {
                url: attachment.url.clone(),
                name: attachment.filename.clone(),
                mimetype: attachment.content_type.clone().unwrap_or_default(),
                data: None,
            })
            .collect();

        // Transform message content
        let message = self.transform_discord_to_internal(&msg.content);

        let event = MessageEvent {
            channel_id: msg.channel_id.to_string(),
            user_name: msg.author.name.clone(),
            user_id: msg.author.id.to_string(),
            user_icon: msg.author.face(),
            message,
            files,
            modified: msg.edited_timestamp.is_some(),
        };

        let _ = self.event_tx.send(Event::Message(event));
    }

    async fn voice_state_update(&self, _ctx: Context, old: Option<VoiceState>, new: VoiceState) {
        if let Some(old_state) = old {
            // User left channel
            if old_state.channel_id.is_some() && new.channel_id.is_none() {
                if let Some(user) = &new.member {
                    let event = ChannelJoinEvent {
                        channel_id: old_state.channel_id.unwrap().to_string(),
                        user_name: user.user.name.clone(),
                        user_id: user.user.id.to_string(),
                    };
                    let _ = self.event_tx.send(Event::LeaveChannel(event));
                }
            }
            // User joined channel
            else if old_state.channel_id.is_none() && new.channel_id.is_some() {
                if let Some(user) = &new.member {
                    let event = ChannelJoinEvent {
                        channel_id: new.channel_id.unwrap().to_string(),
                        user_name: user.user.name.clone(),
                        user_id: user.user.id.to_string(),
                    };
                    let _ = self.event_tx.send(Event::JoinChannel(event));
                }
            }
        } else if new.channel_id.is_some() {
            // New user joined
            if let Some(user) = &new.member {
                let event = ChannelJoinEvent {
                    channel_id: new.channel_id.unwrap().to_string(),
                    user_name: user.user.name.clone(),
                    user_id: user.user.id.to_string(),
                };
                let _ = self.event_tx.send(Event::JoinChannel(event));
            }
        }
    }
}

impl Handler {
    fn transform_discord_to_internal(&self, message: &str) -> String {
        let mention_regex = Regex::new(r"<@(\d+)>").unwrap();
        let url_regex = Regex::new(r"(https?://[a-zA-Z0-9./?#=&]+)\b").unwrap();
        let strikethrough_regex = Regex::new(r"~~([^~]+)~~").unwrap();

        let mut result = message.to_string();

        // Convert Discord strikethrough to Slack
        result = strikethrough_regex
            .replace_all(&result, "~$1~")
            .to_string();

        // Wrap URLs in angle brackets for Slack
        result = url_regex.replace_all(&result, "<$1>").to_string();

        // Map mentions
        if let Some(user_map) = &self.user_map {
            result = mention_regex
                .replace_all(&result, |caps: &regex::Captures| {
                    let discord_id = &caps[1];
                    if let Some(internal_id) = user_map.get_by_left(discord_id) {
                        format!("<@{}>", internal_id)
                    } else {
                        tracing::warn!("Unknown Discord user ID: {}", discord_id);
                        format!("<@unknown>")
                    }
                })
                .to_string();
        }

        result
    }
}

pub struct DiscordRemote {
    client: Arc<Client>,
    guild_id: GuildId,
    event_tx: broadcast::Sender<Event>,
    listen_channels: Arc<DashMap<String, ChannelId>>,
    webhooks: Arc<DashMap<String, serenity::model::webhook::Webhook>>,
    user_map: Option<Arc<BiHashMap<String, String>>>,
}

impl DiscordRemote {
    pub async fn new(
        token: &str,
        server_id: &str,
        user_map: Option<Arc<BiHashMap<String, String>>>,
    ) -> Result<Self> {
        let guild_id: GuildId = server_id
            .parse::<u64>()
            .context("Invalid server ID")?
            .into();

        let (event_tx, _) = broadcast::channel(100);
        let listen_channels = Arc::new(DashMap::new());

        let handler = Handler {
            event_tx: event_tx.clone(),
            listen_channels: listen_channels.clone(),
            user_map: user_map.clone(),
        };

        let intents = GatewayIntents::GUILDS
            | GatewayIntents::GUILD_MESSAGES
            | GatewayIntents::GUILD_VOICE_STATES
            | GatewayIntents::MESSAGE_CONTENT;

        let client = Client::builder(token, intents)
            .event_handler(handler)
            .await
            .context("Failed to create Discord client")?;

        Ok(Self {
            client: Arc::new(client),
            guild_id,
            event_tx,
            listen_channels,
            webhooks: Arc::new(DashMap::new()),
            user_map,
        })
    }

    fn transform_internal_to_discord(&self, message: &str) -> String {
        let mention_regex = Regex::new(r"<@(\d+)>").unwrap();
        let strikethrough_regex = Regex::new(r"~([^~]+)~").unwrap();

        let mut result = message.to_string();

        // Convert Slack strikethrough to Discord
        result = strikethrough_regex
            .replace_all(&result, "~~$1~~")
            .to_string();

        // Map mentions back to Discord IDs
        if let Some(user_map) = &self.user_map {
            result = mention_regex
                .replace_all(&result, |caps: &regex::Captures| {
                    let internal_id = &caps[1];
                    if let Some(discord_id) = user_map.get_by_right(internal_id) {
                        format!("<@{}>", discord_id)
                    } else {
                        tracing::warn!("Unknown internal user ID: {}", internal_id);
                        format!("<@unknown>")
                    }
                })
                .to_string();
        }

        result
    }
}

#[async_trait]
impl Remote for DiscordRemote {
    fn protocol(&self) -> &str {
        "discord"
    }

    fn supports_multi_voice(&self) -> bool {
        false
    }

    async fn join_text_channel(&self, channel_spec: &ChannelSpec) -> Result<String> {
        let http = &self.client.http;
        let guild = self.guild_id.to_partial_guild(http).await?;

        let channel_id = match channel_spec {
            ChannelSpec::ByName { channel_name } => {
                let channels = guild.channels(http).await?;
                channels
                    .iter()
                    .find(|(_, ch)| ch.name == *channel_name)
                    .map(|(id, _)| *id)
                    .context(format!("Channel '{}' not found", channel_name))?
            }
            ChannelSpec::ById { channel_id } => channel_id
                .parse::<u64>()
                .context("Invalid channel ID")?
                .into(),
        };

        self.listen_channels
            .insert(channel_id.to_string(), channel_id);

        // Try to create or find webhook for this channel
        if let Ok(webhooks) = channel_id.webhooks(http).await {
            if let Some(webhook) = webhooks.iter().find(|w| w.name.as_deref() == Some("sandwich"))
            {
                self.webhooks
                    .insert(channel_id.to_string(), webhook.clone());
            } else {
                // Create new webhook
                if let Ok(webhook) = channel_id
                    .create_webhook(http, serenity::builder::CreateWebhook::new("sandwich"))
                    .await
                {
                    self.webhooks.insert(channel_id.to_string(), webhook);
                }
            }
        }

        Ok(channel_id.to_string())
    }

    async fn send_message(
        &self,
        channel: &str,
        user_name: &str,
        user_icon: &str,
        message: &str,
        files: &[AttachedFile],
    ) -> Result<()> {
        let webhook = self
            .webhooks
            .get(channel)
            .context("Webhook not found for channel")?;

        let transformed_message = self.transform_internal_to_discord(message);

        // Download files if needed
        let mut attachments = Vec::new();
        for file in files {
            if let Some(data) = &file.data {
                attachments.push(CreateAttachment::bytes(data.as_ref(), file.name.clone()));
            } else {
                // Fetch file data
                let response = reqwest::get(&file.url).await?;
                let bytes = response.bytes().await?;
                attachments.push(CreateAttachment::bytes(bytes.as_ref(), file.name.clone()));
            }
        }

        let mut execute_webhook = serenity::builder::ExecuteWebhook::new()
            .username(user_name)
            .avatar_url(user_icon);

        if !transformed_message.is_empty() {
            execute_webhook = execute_webhook.content(transformed_message);
        }

        if !attachments.is_empty() {
            execute_webhook = execute_webhook.files(attachments);
        }

        webhook
            .execute(&self.client.http, false, execute_webhook)
            .await?;

        Ok(())
    }

    async fn send_message_as_bot(&self, channel: &str, message: &str) -> Result<()> {
        let channel_id: ChannelId = channel.parse::<u64>()?.into();

        if !message.is_empty() {
            channel_id
                .say(&self.client.http, message)
                .await
                .context("Failed to send message as bot")?;
        }

        Ok(())
    }

    fn subscribe(&self) -> EventReceiver {
        self.event_tx.subscribe()
    }
}
