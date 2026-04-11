# chzzk-chat-server
Chzzk Chat Server for ChatAssistX

---

## 설치 및 실행

### 1. 사전 준비

- [Node.js](https://nodejs.org/) v18.x 이상
- [치지직 개발자 센터](https://developers.chzzk.naver.com/application)에서 애플리케이션 등록 및 `CLIENT_ID`, `CLIENT_SECRET` 발급

### 2. 저장소 클론 및 의존성 설치

```bash
git clone https://github.com/Lastorder-DC/chzzk-chat-server.git
cd chzzk-chat-server
npm install
```

### 3. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 아래 항목을 채웁니다.

| 변수 | 설명 |
|------|------|
| `CLIENT_ID` | 치지직 개발자 센터에서 발급한 Client ID |
| `CLIENT_SECRET` | 치지직 개발자 센터에서 발급한 Client Secret |
| `REDIRECT_URI` | 콜백 URL (치지직 개발자 센터에 등록한 값과 동일하게 입력) |
| `PORT` | 서버 포트 (기본값: `3000`) |
| `ALLOWED_ORIGINS` | CORS 허용 오리진 (쉼표로 구분, 미설정 시 모든 오리진 허용) |
| `TRUST_PROXY` | 리버스 프록시 신뢰 단계 수 (nginx 사용 시 `1`, 사용 안 할 경우 `0`, 기본값: `1`) |

### 4. 직접 실행

```bash
npm start
```

---

## PM2로 구동

[PM2](https://pm2.keymetrics.io/)를 사용하면 서버를 백그라운드에서 실행하고 시스템 재시작 시 자동으로 복구할 수 있습니다.

### PM2 설치

```bash
npm install -g pm2
```

### 서버 시작

```bash
pm2 start npm --name chzzk-chat-server -- start
```

### 자주 쓰는 PM2 명령어

```bash
pm2 list                         # 실행 중인 프로세스 목록 확인
pm2 logs chzzk-chat-server       # 로그 확인
pm2 restart chzzk-chat-server    # 재시작
pm2 stop chzzk-chat-server       # 중지
pm2 delete chzzk-chat-server     # 목록에서 제거
```

### 시스템 재시작 시 자동 실행 등록

```bash
pm2 startup     # 출력되는 명령어를 복사해 실행
pm2 save        # 현재 프로세스 목록 저장
```

---

## nginx 리버스 프록시로 구동

nginx를 앞에 두고 운영하면 HTTPS 종료, 도메인 연결, 정적 파일 캐싱 등을 처리할 수 있습니다.

### nginx 설정 예시

`/etc/nginx/sites-available/chzzk-chat-server` 파일을 작성합니다.

```nginx
server {
    listen 80;
    server_name example.com;  # 실제 도메인으로 변경

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

설정 적용:

```bash
sudo ln -s /etc/nginx/sites-available/chzzk-chat-server /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS를 사용하려면 [Certbot](https://certbot.eff.org/)으로 SSL 인증서를 발급받을 수 있습니다.

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d example.com
```

### nginx 사용 시 주의사항

- nginx가 앞에 있으면 Express가 클라이언트 IP를 `X-Forwarded-For` 헤더에서 읽도록 `.env`에 `TRUST_PROXY=1`을 설정해야 합니다 (기본값으로 이미 활성화되어 있습니다).
- `REDIRECT_URI`는 nginx를 통해 외부에서 접근 가능한 URL로 설정해야 합니다. 예: `https://example.com/auth/callback`
- 치지직 개발자 센터의 **로그인 리디렉션 URL**에도 동일한 URL을 등록해야 합니다.
