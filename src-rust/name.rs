use crate::remote::UserInfo;

pub fn format_name(format: &str, user: &UserInfo, protocol: &str) -> String {
    format
        .replace("<display_name>", &user.user_name)
        .replace("<user_id>", &user.user_id)
        .replace("<protocol>", protocol)
}
