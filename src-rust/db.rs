use anyhow::{Context, Result};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{info, warn};

pub struct MessageMappingDb {
    pool: SqlitePool,
}

impl MessageMappingDb {
    pub async fn new(db_path: &str) -> Result<Self> {
        let options = SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await
            .context("Failed to connect to SQLite database")?;

        // Create tables
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS message_mappings (
                source_remote TEXT NOT NULL,
                source_channel TEXT NOT NULL,
                source_msg_id TEXT NOT NULL,
                dest_remote TEXT NOT NULL,
                dest_channel TEXT NOT NULL,
                dest_msg_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (source_remote, source_channel, source_msg_id, dest_remote)
            )
            "#,
        )
        .execute(&pool)
        .await
        .context("Failed to create message_mappings table")?;

        // Create index for reverse lookup
        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_dest
            ON message_mappings(dest_remote, dest_channel, dest_msg_id)
            "#,
        )
        .execute(&pool)
        .await
        .context("Failed to create idx_dest index")?;

        // Create index for cleanup
        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_created_at
            ON message_mappings(created_at)
            "#,
        )
        .execute(&pool)
        .await
        .context("Failed to create idx_created_at index")?;

        // Create thread_mappings table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS thread_mappings (
                source_remote TEXT NOT NULL,
                source_channel TEXT NOT NULL,
                source_thread_id TEXT NOT NULL,
                dest_remote TEXT NOT NULL,
                dest_channel TEXT NOT NULL,
                dest_thread_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (source_remote, source_channel, source_thread_id, dest_remote)
            )
            "#,
        )
        .execute(&pool)
        .await
        .context("Failed to create thread_mappings table")?;

        // Create index for reverse thread lookup
        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_thread_dest
            ON thread_mappings(dest_remote, dest_channel, dest_thread_id)
            "#,
        )
        .execute(&pool)
        .await
        .context("Failed to create idx_thread_dest index")?;

        info!("Database initialized successfully at {}", db_path);

        Ok(Self { pool })
    }

    pub async fn insert_mapping(
        &self,
        source_remote: &str,
        source_channel: &str,
        source_msg_id: &str,
        dest_remote: &str,
        dest_channel: &str,
        dest_msg_id: &str,
    ) -> Result<()> {
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        sqlx::query(
            r#"
            INSERT INTO message_mappings
            (source_remote, source_channel, source_msg_id, dest_remote, dest_channel, dest_msg_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(source_remote)
        .bind(source_channel)
        .bind(source_msg_id)
        .bind(dest_remote)
        .bind(dest_channel)
        .bind(dest_msg_id)
        .bind(created_at)
        .execute(&self.pool)
        .await
        .context("Failed to insert message mapping")?;

        Ok(())
    }

    pub async fn lookup_destinations(
        &self,
        source_remote: &str,
        source_channel: &str,
        source_msg_id: &str,
    ) -> Result<Vec<(String, String, String)>> {
        let rows = sqlx::query_as::<_, (String, String, String)>(
            r#"
            SELECT dest_remote, dest_channel, dest_msg_id
            FROM message_mappings
            WHERE source_remote = ? AND source_channel = ? AND source_msg_id = ?
            "#,
        )
        .bind(source_remote)
        .bind(source_channel)
        .bind(source_msg_id)
        .fetch_all(&self.pool)
        .await
        .context("Failed to lookup destinations")?;

        Ok(rows)
    }

    pub async fn cleanup_old(&self, days: u32) -> Result<u64> {
        let cutoff_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            - (days as i64 * 86400);

        let result = sqlx::query(
            r#"
            DELETE FROM message_mappings
            WHERE created_at < ?
            "#,
        )
        .bind(cutoff_time)
        .execute(&self.pool)
        .await
        .context("Failed to cleanup old mappings")?;

        Ok(result.rows_affected())
    }

    pub async fn insert_thread_mapping(
        &self,
        source_remote: &str,
        source_channel: &str,
        source_thread_id: &str,
        dest_remote: &str,
        dest_channel: &str,
        dest_thread_id: &str,
    ) -> Result<()> {
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        sqlx::query(
            r#"
            INSERT INTO thread_mappings
            (source_remote, source_channel, source_thread_id, dest_remote, dest_channel, dest_thread_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(source_remote)
        .bind(source_channel)
        .bind(source_thread_id)
        .bind(dest_remote)
        .bind(dest_channel)
        .bind(dest_thread_id)
        .bind(created_at)
        .execute(&self.pool)
        .await
        .context("Failed to insert thread mapping")?;

        Ok(())
    }

    pub async fn lookup_thread_mapping(
        &self,
        source_remote: &str,
        source_channel: &str,
        source_thread_id: &str,
        dest_remote: &str,
    ) -> Result<Option<(String, String)>> {
        let row = sqlx::query_as::<_, (String, String)>(
            r#"
            SELECT dest_channel, dest_thread_id
            FROM thread_mappings
            WHERE source_remote = ? AND source_channel = ? AND source_thread_id = ? AND dest_remote = ?
            "#,
        )
        .bind(source_remote)
        .bind(source_channel)
        .bind(source_thread_id)
        .bind(dest_remote)
        .fetch_optional(&self.pool)
        .await
        .context("Failed to lookup thread mapping")?;

        Ok(row)
    }

    pub fn start_cleanup_task(db: Arc<Self>, days: u32) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(86400)); // 24 hours

            loop {
                interval.tick().await;

                match db.cleanup_old(days).await {
                    Ok(count) => {
                        if count > 0 {
                            info!("Cleaned up {} old message mappings", count);
                        }
                    }
                    Err(e) => {
                        warn!("Failed to cleanup old message mappings: {}", e);
                    }
                }
            }
        });
    }
}
