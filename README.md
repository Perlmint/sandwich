# sandwich

![origin-of-project-name](./docs/origin-of-project-name.jfif)

Multi purporse discord-slack bot.

존나 카와이이하게 봇을 만들어볼게요☆

Discord봇 개발 프로젝트 from party.deltanew by Node.js

- text channel bridge
- void channel streaming over http
- channel gamification
- music streaming
- 이 외의 개발 중인, 혹은 추가하면 좋겠다고 생각하는 feature를 이슈에 등록해주세요.
- 귀엽게 만들어주세요

---

## 시작하기 (JS 버전)

Discord와 Slack 채널을 양방향으로 연결하는 메시지 브릿지입니다. 텍스트, 멘션, 파일 첨부를 양쪽 플랫폼 간에 자동으로 전달합니다.

### 사전 준비

- Node.js 18 이상
- npm
- 관리자 권한이 있는 Discord 서버
- 앱을 설치할 수 있는 Slack 워크스페이스
- (선택) 음성 채널 TTS 알림을 사용하려면 AWS 계정

---

### 1. Discord 봇 설정

Discord 봇을 만들고 토큰과 서버 ID를 발급받습니다.

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. **Bot** 탭 → **Add Bot** → **Token** 복사 (나중에 config에 입력)
3. **Privileged Gateway Intents** 활성화:
   - Server Members Intent
   - Message Content Intent
4. **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Manage Webhooks`, `Connect`, `Speak`
5. 생성된 URL을 브라우저에서 열어 봇을 서버에 초대
6. **서버 ID 얻기**:
   - Discord 설정 → 고급 → 개발자 모드 활성화
   - 서버 이름 우클릭 → **ID 복사**

---

### 2. Slack 앱 설정

Slack 앱을 만들고 두 종류의 토큰을 발급받습니다.

1. [Slack API](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. **Socket Mode** 탭 → **Enable Socket Mode** → App-Level Token 생성
   - Token Name: 아무 이름
   - Scope: `connections:write`
   - **Generate** → **App Token** 복사 (`xapp-`로 시작)
3. **OAuth & Permissions** → **Bot Token Scopes** 추가:
   - `chat:write`
   - `channels:history`
   - `channels:read`
   - `files:read`
   - `users:read`
4. **Install App to Workspace** → **Bot User OAuth Token** 복사 (`xoxb-`로 시작)
5. **Event Subscriptions** → **Enable Events** → **Subscribe to bot events**:
   - `message.channels`

---

### 3. AWS Polly 설정 (선택 — 음성 채널 입퇴장 TTS 알림)

1. [AWS 콘솔](https://console.aws.amazon.com/) → **IAM** → **사용자 추가**
   - 권한: `AmazonPollyReadOnlyAccess` 정책 연결
2. 사용자 생성 후 **액세스 키 생성** → **Access Key ID**와 **Secret Access Key** 복사
3. Voice ID 선택: 한국어 `Seoyeon`, 영어 `Joanna` 등 ([목록](https://docs.aws.amazon.com/polly/latest/dg/voicelist.html))

---

### 4. 설정 파일 작성

`config/example.json`을 복사하여 `config/default.json`을 만들고 발급받은 값을 채웁니다.

```bash
cp config/example.json config/default.json
```

`config/default.json` 예시:

```json
{
  "remote": {
    "slack": {
      "protocol": "slack",
      "socket_token": "xapp-...",
      "web_token": "xoxb-..."
    },
    "discord": {
      "protocol": "discord",
      "token": "여기에_Discord_봇_토큰",
      "server": "여기에_서버_ID"
    }
  },
  "bridge": [
    {
      "nameFormat": "<display_name>@<protocol>",
      "remotes": [
        { "name": "slack", "channelName": "project-sandwich", "direction": "inout" },
        { "name": "discord", "channelName": "project-sandwich", "direction": "inout" }
      ]
    }
  ],
  "tts": {
    "type": "aws-polly",
    "region": "ap-northeast-2",
    "accessKeyId": "여기에_AWS_Access_Key_ID",
    "secretAccessKey": "여기에_AWS_Secret_Access_Key",
    "voiceId": "Seoyeon"
  }
}
```

`bridge` 배열에서 `channelName`은 실제 Discord/Slack 채널명과 일치해야 합니다.

#### 유저 매핑 (선택)

멘션(`@유저`)이 플랫폼 간에 올바르게 변환되려면 각 사람의 Discord ID와 Slack Member ID를 쌍으로 등록합니다.

**Discord 유저 ID 얻기:**
1. Discord 설정 → 고급 → 개발자 모드 활성화
2. 해당 사용자 우클릭 → **ID 복사**

**Slack Member ID 얻기:**
1. 사용자 프로필 클릭 → 더보기(`···`) → **멤버 ID 복사**

`config/default.json`에 `userMap` 추가:

```json
{
  "remote": { ... },
  "bridge": [ ... ],
  "userMap": [
    { "discord": "123456789012345678", "slack": "U0123ABCD" },
    { "discord": "987654321098765432", "slack": "U9876WXYZ" }
  ]
}
```

배열의 각 항목이 "같은 사람"을 나타냅니다. 매핑되지 않은 사용자의 멘션은 `unknown`으로 표시됩니다.

---

### 5. 실행

```bash
npm install
npm run build
npm run config-schema
node lib/main.js
```

콘솔에 `Bot is ready!`가 출력되면 정상 작동 중입니다.

---

### 6. 서비스로 실행 (상시 구동)

#### launchd (macOS)

`~/Library/LaunchAgents/com.sandwich.bot.plist` 파일을 생성합니다 (`/path/to/sandwich`와 `<your-user>`를 실제 값으로 변경):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sandwich.bot</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/sandwich/lib/main.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/path/to/sandwich</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/sandwich.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/sandwich.err</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.sandwich.bot.plist
launchctl start com.sandwich.bot
tail -f /tmp/sandwich.log   # 로그 확인
```

#### systemd (Linux)

`/etc/systemd/system/sandwich.service` 파일을 생성합니다:

```ini
[Unit]
Description=sandwich bot
After=network.target

[Service]
Type=simple
User=<your-user>
WorkingDirectory=/path/to/sandwich
ExecStart=/usr/bin/node lib/main.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sandwich
sudo journalctl -u sandwich -f   # 로그 확인
```

#### Docker Compose

`docker-compose.yml` 파일을 생성합니다:

```yaml
services:
  sandwich:
    build: .
    restart: unless-stopped
    volumes:
      - ./config:/usr/app/config
      - ./tts_cache:/usr/app/tts_cache
```

```bash
docker compose up -d
docker compose logs -f   # 로그 확인
```

#### Docker (단독 실행)

```bash
docker build -t sandwich .
docker run -d --restart unless-stopped \
  -v $(pwd)/config:/usr/app/config \
  -v $(pwd)/tts_cache:/usr/app/tts_cache \
  --name sandwich sandwich
```
