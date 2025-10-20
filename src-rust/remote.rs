use anyhow::Result;
use async_trait::async_trait;
use bytes::Bytes;
use tokio::sync::broadcast;

use crate::config::ChannelSpec;

#[derive(Debug, Clone)]
pub struct UserInfo {
    pub user_name: String,
    pub user_id: String,
}

#[derive(Debug, Clone)]
pub struct AttachedFile {
    pub url: String,
    pub name: String,
    pub mimetype: String,
    pub data: Option<Bytes>,
}

#[derive(Debug, Clone)]
pub struct MessageEvent {
    pub channel_id: String,
    pub user_name: String,
    pub user_id: String,
    pub user_icon: String,
    pub message: String,
    pub files: Vec<AttachedFile>,
    pub modified: bool,
}

#[derive(Debug, Clone)]
pub struct ChannelJoinEvent {
    pub channel_id: String,
    pub user_name: String,
    pub user_id: String,
}

#[derive(Debug, Clone)]
pub enum Event {
    Message(MessageEvent),
    JoinChannel(ChannelJoinEvent),
    LeaveChannel(ChannelJoinEvent),
}

pub type EventSender = broadcast::Sender<Event>;
pub type EventReceiver = broadcast::Receiver<Event>;

pub struct EventType;

impl EventType {
    pub const MESSAGE: &'static str = "message";
    pub const JOIN_CHANNEL: &'static str = "join_channel";
    pub const LEAVE_CHANNEL: &'static str = "leave_channel";
}

#[async_trait]
pub trait Remote: Send + Sync {
    fn protocol(&self) -> &str;
    fn supports_multi_voice(&self) -> bool;

    async fn join_text_channel(&self, channel: &ChannelSpec) -> Result<String>;

    async fn join_voice_channel(
        &self,
        _channel: &ChannelSpec,
    ) -> Result<(String, VoiceReceiver, VoiceSender)> {
        Err(anyhow::anyhow!("Voice channels not supported"))
    }

    async fn send_message(
        &self,
        channel: &str,
        user_name: &str,
        user_icon: &str,
        message: &str,
        files: &[AttachedFile],
    ) -> Result<()>;

    async fn send_message_as_bot(&self, channel: &str, message: &str) -> Result<()>;

    fn subscribe(&self) -> EventReceiver;
}

pub struct VoiceReceiver {
    // TODO: Implement voice receiving if needed
}

pub struct VoiceSender {
    // TODO: Implement with songbird
}

impl VoiceSender {
    pub async fn play(&self, _path_or_stream: &str) -> Result<()> {
        // TODO: Implement audio playback
        Ok(())
    }
}
