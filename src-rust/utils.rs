use rand::Rng;

#[allow(dead_code)]
pub fn sample<T: Clone>(data: &[T]) -> Option<T> {
    if data.is_empty() {
        return None;
    }

    let mut rng = rand::rng();
    let index = rng.random_range(0..data.len());
    Some(data[index].clone())
}

/// Truncate a string to use as a Discord thread name (max 100 chars)
pub fn truncate_thread_name(content: &str) -> String {
    const MAX_LEN: usize = 100;

    if content.is_empty() {
        return "Thread".to_string();
    }

    let trimmed = content.trim();
    if trimmed.len() <= MAX_LEN {
        trimmed.to_string()
    } else {
        // Find a good breaking point (space, punctuation)
        let truncated = &trimmed[..MAX_LEN];
        if let Some(last_space) =
            truncated.rfind(|c: char| c.is_whitespace() || c == '.' || c == ',' || c == '!')
        {
            if last_space > MAX_LEN / 2 {
                return format!("{}...", &truncated[..last_space].trim());
            }
        }
        format!("{}...", truncated)
    }
}
