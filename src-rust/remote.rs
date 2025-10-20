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
    #[allow(dead_code)]
    pub mimetype: String,
    pub data: Option<Bytes>,
}

#[derive(Debug, Clone)]
pub struct MessageEvent {
    pub channel_id: String,
    pub message_id: Option<String>,
    pub user_name: String,
    pub user_id: String,
    pub user_icon: String,
    pub message: String,
    pub files: Vec<AttachedFile>,
    pub modified: bool,
    pub thread_id: Option<String>,
    pub parent_message_id: Option<String>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ChannelJoinEvent {
    pub channel_id: String,
    pub user_name: String,
    pub user_id: String,
}

#[derive(Debug, Clone)]
pub enum Event {
    Message(MessageEvent),
    #[allow(dead_code)]
    JoinChannel(ChannelJoinEvent),
    #[allow(dead_code)]
    LeaveChannel(ChannelJoinEvent),
}

#[allow(dead_code)]
pub type EventSender = broadcast::Sender<Event>;
pub type EventReceiver = broadcast::Receiver<Event>;

#[allow(dead_code)]
pub struct EventType;

#[allow(dead_code)]
impl EventType {
    pub const MESSAGE: &'static str = "message";
    pub const JOIN_CHANNEL: &'static str = "join_channel";
    pub const LEAVE_CHANNEL: &'static str = "leave_channel";
}

#[async_trait]
pub trait Remote: Send + Sync {
    fn protocol(&self) -> &str;
    #[allow(dead_code)]
    fn supports_multi_voice(&self) -> bool;

    async fn join_text_channel(&self, channel: &ChannelSpec) -> Result<String>;

    #[allow(dead_code)]
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
        thread_id: Option<&str>,
    ) -> Result<String>;

    async fn edit_message(
        &self,
        channel: &str,
        message_id: &str,
        message: &str,
        files: &[AttachedFile],
        thread_id: Option<&str>,
    ) -> Result<()>;

    async fn create_thread(
        &self,
        channel: &str,
        message_id: Option<&str>,
        name: &str,
    ) -> Result<String>;

    #[allow(dead_code)]
    async fn send_message_as_bot(&self, channel: &str, message: &str) -> Result<()>;

    fn subscribe(&self) -> EventReceiver;
}

#[allow(dead_code)]
pub struct VoiceReceiver {
    // TODO: Implement voice receiving if needed
}

#[allow(dead_code)]
pub struct VoiceSender {
    // TODO: Implement with songbird
}

#[allow(dead_code)]
impl VoiceSender {
    pub async fn play(&self, _path_or_stream: &str) -> Result<()> {
        // TODO: Implement audio playback
        Ok(())
    }
}
