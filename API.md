# chzzk-chat-server API 사용 설명서

치지직(CHZZK) OAuth 2.0 인증 흐름을 제공하는 Node.js API 서버입니다.  
[buzzk](https://github.com/Emin-G/buzzk) 라이브러리와 [치지직 공식 Open API](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization)를 기반으로 구현되었습니다.

---

## 목차

1. [시작하기](#시작하기)
2. [환경 변수 설정](#환경-변수-설정)
3. [API 엔드포인트](#api-엔드포인트)
   - [GET /auth/login](#get-authlogin)
   - [GET /auth/callback](#get-authcallback)
   - [GET /auth/token/:sessionId](#get-authtokensessionid)
   - [POST /auth/refresh](#post-authrefresh)
   - [POST /auth/revoke](#post-authrevoke)
4. [인증 흐름 전체 순서도](#인증-흐름-전체-순서도)
5. [BridgeBBCC 연동 방법](#bridgebbcc-연동-방법)
6. [오류 코드 및 응답](#오류-코드-및-응답)

---

## 시작하기

### 사전 준비

1. **Node.js 18 이상** 설치
2. **치지직 개발자 센터** ([https://developers.chzzk.naver.com/application](https://developers.chzzk.naver.com/application)) 에서 애플리케이션 등록
   - 로그인 리디렉션 URL에 `http://localhost:3000/auth/callback` 등록
   - Client ID, Client Secret 발급

### 설치 및 실행

```bash
# 저장소 클론 후 의존성 설치
npm install

# 환경 변수 파일 생성
cp .env.example .env
# .env 파일을 편집하여 CLIENT_ID, CLIENT_SECRET 등 입력

# 서버 시작
npm start
```

---

## 환경 변수 설정

`.env` 파일(`.env.example` 참고)에서 설정합니다.

| 변수명 | 필수 | 설명 | 예시 |
|--------|:----:|------|------|
| `CLIENT_ID` | ✅ | 치지직 개발자 센터에서 발급받은 Client ID | `abc123` |
| `CLIENT_SECRET` | ✅ | 치지직 개발자 센터에서 발급받은 Client Secret | `secret456` |
| `REDIRECT_URI` | ✅ | 치지직 개발자 센터에 등록한 로그인 리디렉션 URL | `http://localhost:3000/auth/callback` |
| `PORT` | ❌ | 서버 포트 (기본값: `3000`) | `3000` |
| `ALLOWED_ORIGINS` | ❌ | CORS 허용 오리진, 쉼표로 구분 (미설정 시 전체 허용) | `http://localhost:8080` |

> ⚠️ `.env` 파일은 절대 Git에 커밋하지 마세요. `.gitignore`에 이미 포함되어 있습니다.

---

## API 엔드포인트

### GET /auth/login

치지직 OAuth 로그인 페이지로 리다이렉트합니다.  
브라우저에서 직접 접근하거나 팝업으로 열어야 합니다.

#### Query Parameters

| 파라미터 | 필수 | 설명 |
|----------|:----:|------|
| `session` | ❌ | BridgeBBCC 연동용 세션 ID. 미입력 시 서버가 자동 생성합니다. |

#### 동작

1. `session` 파라미터가 없으면 서버가 랜덤 세션 ID를 자동 생성합니다.
2. CSRF 방지용 `state` 값을 생성하고 세션 ID와 함께 서버에 10분간 보관합니다.
3. 브라우저를 치지직 로그인 페이지로 리다이렉트합니다.

#### 예시

```
브라우저에서 직접 방문:
GET http://localhost:3000/auth/login

세션 ID를 직접 지정:
GET http://localhost:3000/auth/login?session=my-custom-session-id

JavaScript에서 팝업으로 열기:
const popup = window.open('http://localhost:3000/auth/login', 'chzzkLogin', 'width=600,height=700');
```

---

### GET /auth/callback

치지직 로그인 완료 후 자동으로 호출되는 콜백 엔드포인트입니다.  
직접 호출하는 것이 아니라, 치지직 서버가 로그인 완료 후 자동으로 리다이렉트합니다.

#### Query Parameters (치지직 서버가 자동 전달)

| 파라미터 | 설명 |
|----------|------|
| `code` | 인증 코드 |
| `state` | CSRF 방지용 state 값 |
| `error` | 인증 거부 시 오류 코드 |

#### 동작

1. `state` 값을 검증하고, 연결된 세션 ID를 확인합니다.
2. `code`와 `state`로 치지직 API에서 Access Token을 발급받습니다.
3. 발급된 토큰을 세션 ID에 연결하여 **5분간** 서버에 보관합니다.
4. **HTML 페이지**를 반환합니다.
   - **팝업으로 열린 경우**: `window.opener.postMessage`로 부모 창에 토큰을 전달하고 팝업을 닫습니다.
   - **직접 방문한 경우**: 화면에 토큰을 표시하고 클립보드 복사 버튼을 제공합니다.

#### postMessage 페이로드 (팝업 방식)

부모 창에서 `window.addEventListener('message', ...)` 로 수신합니다.

```json
{
  "type": "CHZZK_TOKEN",
  "accessToken": "eyJhbGci...",
  "refreshToken": "dGhpcyBp...",
  "expiresIn": 86400
}
```

---

### GET /auth/token/:sessionId

세션 ID에 연결된 토큰을 **1회** 조회합니다. 조회 즉시 서버에서 삭제됩니다.  
BridgeBBCC 등 클라이언트에서 로그인 완료 여부를 폴링할 때 사용합니다.

#### URL Parameters

| 파라미터 | 설명 |
|----------|------|
| `sessionId` | `/auth/login` 호출 시 사용한 세션 ID |

#### 응답

**토큰 준비 완료 (HTTP 200):**

```json
{
  "success": true,
  "accessToken": "eyJhbGci...",
  "refreshToken": "dGhpcyBp...",
  "expiresIn": 86400
}
```

**아직 로그인 미완료 (HTTP 202):**

```json
{
  "success": false,
  "pending": true
}
```

**세션 만료 또는 없음 (HTTP 404):**

```json
{
  "success": false,
  "message": "세션을 찾을 수 없습니다."
}
```

#### 폴링 예시 (JavaScript)

```javascript
async function pollForToken(sessionId, intervalMs = 2000, timeoutMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`http://localhost:3000/auth/token/${sessionId}`);
    if (res.status === 200) {
      return await res.json(); // { success: true, accessToken, refreshToken, expiresIn }
    }
    if (res.status === 404) {
      throw new Error('세션이 만료되었습니다.');
    }
    // 202: 아직 로그인 미완료, 재시도
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('로그인 대기 시간 초과');
}
```

---

### POST /auth/refresh

Refresh Token으로 만료된 Access Token을 갱신하고 새로운 Refresh Token을 발급합니다.

> ℹ️ Refresh Token은 **일회용**입니다. 갱신 후에는 반드시 응답으로 받은 새 Refresh Token을 저장해야 합니다.  
> Access Token 만료기간: **1일** / Refresh Token 만료기간: **30일**

#### Request

- Method: `POST`
- Content-Type: `application/json`

```json
{
  "refreshToken": "dGhpcyBp..."
}
```

#### Response (HTTP 200)

```json
{
  "success": true,
  "accessToken": "eyJhbGci...",
  "refreshToken": "bmV3UmVm...",
  "expiresIn": 86400
}
```

#### 오류 응답 (HTTP 401)

```json
{
  "success": false,
  "message": "토큰 갱신에 실패했습니다. Refresh Token이 만료되었거나 유효하지 않습니다."
}
```

#### 예시 (curl)

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "dGhpcyBp..."}'
```

---

### POST /auth/revoke

Access Token으로 해당 사용자의 **모든 Token(Access Token + Refresh Token)** 을 일괄 폐기합니다.  
로그아웃 처리 시 사용합니다.

> ⚠️ 동일한 `clientId`와 사용자(`user`)로 발급된 **모든 토큰**이 한 번에 폐기됩니다.

#### Request

- Method: `POST`
- Content-Type: `application/json`

```json
{
  "accessToken": "eyJhbGci..."
}
```

#### Response (HTTP 200)

```json
{
  "success": true,
  "message": "모든 Token이 성공적으로 폐기되었습니다."
}
```

#### 오류 응답 (HTTP 400)

```json
{
  "success": false,
  "message": "Token revoke에 실패했습니다.",
  "detail": { ... }
}
```

#### 예시 (curl)

```bash
curl -X POST http://localhost:3000/auth/revoke \
  -H "Content-Type: application/json" \
  -d '{"accessToken": "eyJhbGci..."}'
```

---

## 인증 흐름 전체 순서도

### 최초 로그인

```
사용자 브라우저                  chzzk-chat-server              치지직 서버
      │                                │                              │
      │  GET /auth/login               │                              │
      │ ─────────────────────────────> │                              │
      │                                │ state 생성 & 보관            │
      │  302 redirect                  │                              │
      │ <───────────────────────────── │                              │
      │                                │                              │
      │  GET /account-interlock?...    │                              │
      │ ──────────────────────────────────────────────────────────>  │
      │                                │                              │
      │           사용자 로그인 완료   │                              │
      │  GET /auth/callback?code=&state= (302 redirect)              │
      │ <──────────────────────────────────────────────────────────  │
      │                                │                              │
      │  GET /auth/callback?code=&state=                             │
      │ ─────────────────────────────> │                              │
      │                                │  POST /auth/v1/token        │
      │                                │ ──────────────────────────> │
      │                                │  { accessToken, refreshToken }
      │                                │ <────────────────────────── │
      │  HTML (토큰 표시/postMessage)  │                              │
      │ <───────────────────────────── │                              │
```

### Access Token 갱신

```
클라이언트                       chzzk-chat-server              치지직 서버
      │                                │                              │
      │  POST /auth/refresh            │                              │
      │  { refreshToken }              │                              │
      │ ─────────────────────────────> │                              │
      │                                │  POST /auth/v1/token        │
      │                                │  { grantType: refresh_token }
      │                                │ ──────────────────────────> │
      │                                │  { accessToken, refreshToken }
      │                                │ <────────────────────────── │
      │  { accessToken, refreshToken } │                              │
      │ <───────────────────────────── │                              │
```

---

## BridgeBBCC 연동 방법

BridgeBBCC에서 치지직 로그인을 연동하는 방법은 두 가지입니다.  
자세한 내용은 [BRIDGEBBCC_INTEGRATION.md](./BRIDGEBBCC_INTEGRATION.md)를 참고하세요.

### 방법 1: 팝업 + postMessage (권장)

```javascript
// BridgeBBCC에서 팝업을 열고 메시지를 수신합니다
const sessionId = 'my-session-' + Date.now();
const popup = window.open(
  `http://localhost:3000/auth/login?session=${sessionId}`,
  'chzzkLogin',
  'width=600,height=700'
);

window.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'CHZZK_TOKEN') {
    const { accessToken, refreshToken, expiresIn } = event.data;
    // 토큰 저장 및 사용
  }
});
```

### 방법 2: 세션 기반 폴링

```javascript
// 1. 세션 ID를 미리 생성
const sessionId = 'my-session-' + Date.now();

// 2. 새 탭/팝업으로 로그인 페이지 열기
window.open(`http://localhost:3000/auth/login?session=${sessionId}`, '_blank');

// 3. 폴링으로 토큰 확인
const interval = setInterval(async () => {
  const res = await fetch(`http://localhost:3000/auth/token/${sessionId}`);
  if (res.status === 200) {
    clearInterval(interval);
    const data = await res.json();
    // data.accessToken 사용
  }
}, 2000);
```

---

## 오류 코드 및 응답

| HTTP 상태 코드 | 의미 | 주요 원인 |
|:--------------:|------|-----------|
| `200` | 성공 | - |
| `202` | 대기 중 | 로그인 미완료 (폴링 중) |
| `400` | 요청 오류 | 파라미터 누락, 유효하지 않은 state |
| `401` | 인증 실패 | Refresh Token 만료/무효 |
| `404` | 없음 | 세션 ID 없음 또는 만료 |
| `500` | 서버 오류 | 환경 변수 미설정 |
| `502` | 업스트림 오류 | 치지직 API 토큰 발급 실패 |

---

## 참고 자료

- [치지직 공식 API 인증 문서](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization)
- [buzzk 라이브러리](https://github.com/Emin-G/buzzk)
- [치지직 개발자 센터](https://developers.chzzk.naver.com/application)
