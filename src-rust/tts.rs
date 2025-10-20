use anyhow::Result;
use aws_config::BehaviorVersion;
use aws_sdk_polly::{
    config::{Credentials, Region},
    types::{OutputFormat, VoiceId},
    Client as PollyClient,
};
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncWriteExt;

use crate::config::TtsConfig;

#[allow(dead_code)]
pub struct TtsEngine {
    client: PollyClient,
    voice_id: VoiceId,
    cache_dir: PathBuf,
}

#[allow(dead_code)]
impl TtsEngine {
    async fn new(client: PollyClient, voice_id: VoiceId) -> Result<Self> {
        let cache_dir = PathBuf::from("tts_cache");
        fs::create_dir_all(&cache_dir).await?;

        Ok(Self {
            client,
            voice_id,
            cache_dir,
        })
    }

    pub async fn synthesize(&self, text: &str) -> Result<PathBuf> {
        // Check cache first
        let cache_path = self.cache_dir.join(format!("{}.ogg", text));

        if cache_path.exists() {
            return Ok(cache_path);
        }

        // Synthesize speech
        let output = self
            .client
            .synthesize_speech()
            .text(text)
            .output_format(OutputFormat::OggVorbis)
            .voice_id(self.voice_id.clone())
            .send()
            .await?;

        // Save to cache
        let audio_stream = output.audio_stream.collect().await?;
        let mut file = fs::File::create(&cache_path).await?;
        file.write_all(&audio_stream.into_bytes()).await?;
        file.flush().await?;

        Ok(cache_path)
    }
}

pub async fn init_tts(config: &TtsConfig) -> Result<TtsEngine> {
    match config {
        TtsConfig::AwsPolly {
            region,
            access_key_id,
            secret_access_key,
            voice_id,
        } => {
            let credentials =
                Credentials::new(access_key_id, secret_access_key, None, None, "static");

            let aws_config = aws_config::defaults(BehaviorVersion::latest())
                .region(Region::new(region.clone()))
                .credentials_provider(credentials)
                .load()
                .await;

            let client = PollyClient::new(&aws_config);

            let voice = VoiceId::from(voice_id.as_str());

            TtsEngine::new(client, voice).await
        }
    }
}
