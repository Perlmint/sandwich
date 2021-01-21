import { UserInfo } from './remote.js';

export function formatName(format: string, user: UserInfo, protocol: string) {
  format = format.replace('<display_name>', user.userName);
  format = format.replace('<user_id>', user.userId);
  return format.replace('<protocol>', protocol);
}
