# BridgeBBCC × chzzk-chat-server 연동 가이드

이 문서는 [BridgeBBCC](https://github.com/Lastorder-DC/BridgeBBCC)에 치지직(CHZZK) 채팅 연동을 추가할 때  
`chzzk-chat-server`의 OAuth API를 활용하는 방법을 설명합니다.

---

## 목차

1. [연동 개요](#연동-개요)
2. [사전 준비](#사전-준비)
3. [토큰 획득 방법](#토큰-획득-방법)
   - [방법 1: 팝업 + postMessage (권장)](#방법-1-팝업--postmessage-권장)
   - [방법 2: 세션 기반 폴링](#방법-2-세션-기반-폴링)
4. [토큰 갱신 처리](#토큰-갱신-처리)
5. [로그아웃 처리](#로그아웃-처리)
6. [BridgeBBCC 코드 수정 예시](#bridgebbcc-코드-수정-예시)
   - [config.js 확장](#1-configjs-확장)
   - [토큰 로딩 모듈 추가](#2-토큰-로딩-모듈-추가)
   - [치지직 채팅 연결 모듈 추가](#3-치지직-채팅-연결-모듈-추가)
   - [main.js 연동](#4-mainjs-연동)
7. [전체 흐름 순서도](#전체-흐름-순서도)
8. [보안 고려사항](#보안-고려사항)
9. [FAQ](#faq)

---

## 연동 개요

```
┌─────────────────────────────────────────────────────────────┐
│                         사용자 환경                          │
│                                                             │
│   ┌──────────────────┐        ┌────────────────────────┐   │
│   │   BridgeBBCC     │◄──────►│  chzzk-chat-server     │   │
│   │  (브라우저/WebView)│postMsg │  (localhost:3000)      │   │
│   │                  │polling │                        │   │
│   │  - 치지직 채팅   │        │  - OAuth 인증          │   │
│   │  - 화면 오버레이  │        │  - 토큰 발급/갱신/폐기 │   │
│   └──────────────────┘        └───────────┬────────────┘   │
│                                            │                │
└────────────────────────────────────────────┼────────────────┘
                                             │ HTTPS
                                    ┌────────▼────────┐
                                    │   치지직 서버    │
                                    │ (Open API)      │
                                    └─────────────────┘
```

**핵심 흐름:**
1. BridgeBBCC가 `chzzk-chat-server`의 로그인 URL을 **팝업**으로 엽니다.
2. 사용자가 치지직 계정으로 로그인합니다.
3. 서버가 Access Token을 발급받아 BridgeBBCC 창으로 **postMessage**로 전달합니다.
4. BridgeBBCC가 Access Token으로 치지직 채팅에 연결합니다.
5. Access Token 만료 시 **자동 갱신** 처리를 합니다.

---

## 사전 준비

1. **chzzk-chat-server 설치 및 실행**
   ```bash
   cd chzzk-chat-server
   cp .env.example .env
   # .env에 CLIENT_ID, CLIENT_SECRET, REDIRECT_URI 입력
   npm install
   npm start
   ```

2. **BridgeBBCC의 `lib/config.js`에 치지직 서버 URL 추가** (아래 [Config 확장](#1-configjs-확장) 참고)

3. **치지직 개발자 센터**에서 `REDIRECT_URI`(`http://localhost:3000/auth/callback`)가 등록되어 있는지 확인

---

## 토큰 획득 방법

### 방법 1: 팝업 + postMessage (권장)

브라우저 팝업으로 로그인 창을 열고, 로그인 완료 시 `postMessage`로 토큰을 수신합니다.  
사용자 경험이 자연스럽고 추가 폴링이 필요 없습니다.

```javascript
/**
 * 치지직 로그인 팝업을 열고 Access Token을 반환하는 Promise
 * @param {string} authServerUrl - chzzk-chat-server 주소 (예: 'http://localhost:3000')
 * @returns {Promise<{accessToken: string, refreshToken: string, expiresIn: number}>}
 */
function chzzkLogin(authServerUrl) {
  return new Promise(function(resolve, reject) {
    var sessionId = 'bbcc-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    var loginUrl = authServerUrl + '/auth/login?session=' + encodeURIComponent(sessionId);

    var popup = window.open(loginUrl, 'chzzkLogin', 'width=600,height=700,left=200,top=100');

    if (!popup) {
      reject(new Error('팝업이 차단되었습니다. 팝업 차단을 해제해 주세요.'));
      return;
    }

    var timer = null;

    function onMessage(event) {
      // 보안: 메시지 타입 검증
      if (!event.data || event.data.type !== 'CHZZK_TOKEN') return;

      cleanup();
      resolve({
        accessToken: event.data.accessToken,
        refreshToken: event.data.refreshToken,
        expiresIn: event.data.expiresIn
      });
    }

    // 팝업이 강제로 닫힌 경우 감지
    timer = setInterval(function() {
      if (popup.closed) {
        cleanup();
        reject(new Error('로그인 창이 닫혔습니다.'));
      }
    }, 1000);

    function cleanup() {
      window.removeEventListener('message', onMessage);
      if (timer) clearInterval(timer);
      if (!popup.closed) popup.close();
    }

    window.addEventListener('message', onMessage);
  });
}

// 사용 예시
chzzkLogin('http://localhost:3000')
  .then(function(tokens) {
    console.log('Access Token:', tokens.accessToken);
    // 로컬 스토리지에 저장
    localStorage.setItem('chzzkAccessToken', tokens.accessToken);
    localStorage.setItem('chzzkRefreshToken', tokens.refreshToken);
    localStorage.setItem('chzzkTokenExpiresAt', Date.now() + tokens.expiresIn * 1000);
  })
  .catch(function(err) {
    console.error('로그인 실패:', err.message);
  });
```

---

### 방법 2: 세션 기반 폴링

팝업 `postMessage`가 불가능한 환경(일부 WebView, 임베디드 브라우저 등)에서 사용합니다.  
새 탭에서 로그인 후 서버에서 토큰을 폴링합니다.

```javascript
/**
 * 세션 ID를 생성하고 로그인 탭을 연 뒤 토큰을 폴링합니다.
 * @param {string} authServerUrl
 * @returns {Promise<{accessToken, refreshToken, expiresIn}>}
 */
function chzzkLoginPolling(authServerUrl) {
  return new Promise(function(resolve, reject) {
    var sessionId = 'bbcc-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    var loginUrl = authServerUrl + '/auth/login?session=' + encodeURIComponent(sessionId);
    var tokenUrl = authServerUrl + '/auth/token/' + encodeURIComponent(sessionId);

    // 새 탭에서 로그인
    window.open(loginUrl, '_blank');

    var interval = null;
    var elapsed = 0;
    var TIMEOUT_MS = 5 * 60 * 1000; // 5분
    var POLL_INTERVAL_MS = 2000;     // 2초마다 폴링

    interval = setInterval(function() {
      elapsed += POLL_INTERVAL_MS;
      if (elapsed >= TIMEOUT_MS) {
        clearInterval(interval);
        reject(new Error('로그인 대기 시간이 초과되었습니다.'));
        return;
      }

      fetch(tokenUrl)
        .then(function(res) {
          if (res.status === 200) {
            clearInterval(interval);
            return res.json().then(resolve);
          }
          if (res.status === 404) {
            clearInterval(interval);
            reject(new Error('세션이 만료되었습니다. 다시 시도해 주세요.'));
          }
          // 202: 아직 로그인 미완료, 계속 폴링
        })
        .catch(function(err) {
          console.warn('폴링 오류 (재시도 중):', err.message);
        });
    }, POLL_INTERVAL_MS);
  });
}
```

---

## 토큰 갱신 처리

Access Token의 만료기간은 **1일**입니다. 만료 전 자동으로 갱신하는 처리를 추가하는 것을 권장합니다.

```javascript
/**
 * 저장된 Access Token이 만료 임박(5분 이내)이면 자동 갱신합니다.
 * @param {string} authServerUrl
 * @returns {Promise<string>} 유효한 Access Token
 */
async function getValidAccessToken(authServerUrl) {
  var accessToken = localStorage.getItem('chzzkAccessToken');
  var refreshToken = localStorage.getItem('chzzkRefreshToken');
  var expiresAt = parseInt(localStorage.getItem('chzzkTokenExpiresAt') || '0', 10);

  // 만료까지 5분 미만이면 갱신
  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    if (!refreshToken) throw new Error('Refresh Token이 없습니다. 다시 로그인해 주세요.');

    var res = await fetch(authServerUrl + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshToken })
    });

    if (!res.ok) {
      // Refresh Token도 만료된 경우 → 재로그인 필요
      localStorage.removeItem('chzzkAccessToken');
      localStorage.removeItem('chzzkRefreshToken');
      localStorage.removeItem('chzzkTokenExpiresAt');
      throw new Error('토큰 갱신 실패. 다시 로그인해 주세요.');
    }

    var data = await res.json();
    accessToken = data.accessToken;

    // 새 토큰 저장 (Refresh Token도 교체됨)
    localStorage.setItem('chzzkAccessToken', data.accessToken);
    localStorage.setItem('chzzkRefreshToken', data.refreshToken);
    localStorage.setItem('chzzkTokenExpiresAt', Date.now() + data.expiresIn * 1000);
  }

  return accessToken;
}
```

---

## 로그아웃 처리

```javascript
/**
 * 치지직 로그아웃: 모든 토큰을 폐기하고 로컬 저장소에서 삭제합니다.
 * @param {string} authServerUrl
 */
async function chzzkLogout(authServerUrl) {
  var accessToken = localStorage.getItem('chzzkAccessToken');
  if (accessToken) {
    try {
      await fetch(authServerUrl + '/auth/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: accessToken })
      });
    } catch (e) {
      console.warn('Token revoke 실패 (무시):', e.message);
    }
  }
  localStorage.removeItem('chzzkAccessToken');
  localStorage.removeItem('chzzkRefreshToken');
  localStorage.removeItem('chzzkTokenExpiresAt');
}
```

---

## BridgeBBCC 코드 수정 예시

아래는 BridgeBBCC에 치지직 채팅 연동을 추가하기 위한 구체적인 코드 수정 예시입니다.

### 1. `config.js` 확장

`lib/config.js`에 치지직 관련 설정 항목을 추가합니다.

```javascript
configData = {
  // ... 기존 설정 유지 ...

  // ↓ 치지직 연동 설정 추가
  chzzk: {
    enabled: true,                          // 치지직 채팅 연동 활성화 여부
    authServerUrl: 'http://localhost:3000', // chzzk-chat-server 주소
    channelId: '',                          // 시청할 채널 ID (선택: 미입력 시 로그인 계정 채널)
    autoLogin: false,                       // 페이지 로드 시 자동 로그인 시도
  }
};
```

---

### 2. 토큰 로딩 모듈 추가

`source/chzzkAuth.js` 파일을 새로 생성합니다.

```javascript
// source/chzzkAuth.js

'use strict';

var AUTH_SERVER_URL = (configData.chzzk && configData.chzzk.authServerUrl)
  ? configData.chzzk.authServerUrl
  : 'http://localhost:3000';

var STORAGE_KEYS = {
  ACCESS_TOKEN:  'chzzkAccessToken',
  REFRESH_TOKEN: 'chzzkRefreshToken',
  EXPIRES_AT:    'chzzkTokenExpiresAt'
};

/**
 * 저장된 토큰을 불러옵니다.
 */
function loadStoredTokens() {
  return {
    accessToken:  localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN),
    refreshToken: localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN),
    expiresAt:    parseInt(localStorage.getItem(STORAGE_KEYS.EXPIRES_AT) || '0', 10)
  };
}

/**
 * 토큰을 로컬 스토리지에 저장합니다.
 */
function saveTokens(accessToken, refreshToken, expiresIn) {
  localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN,  accessToken);
  localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
  localStorage.setItem(STORAGE_KEYS.EXPIRES_AT, Date.now() + expiresIn * 1000);
}

/**
 * 팝업 로그인으로 토큰을 획득합니다.
 * @returns {Promise<string>} Access Token
 */
function login() {
  return new Promise(function(resolve, reject) {
    var sessionId = 'bbcc-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    var popup = window.open(
      AUTH_SERVER_URL + '/auth/login?session=' + encodeURIComponent(sessionId),
      'chzzkLogin',
      'width=600,height=700,left=200,top=100'
    );

    if (!popup) {
      reject(new Error('팝업이 차단되었습니다.'));
      return;
    }

    var timer = setInterval(function() {
      if (popup.closed) { cleanup(); reject(new Error('로그인 창이 닫혔습니다.')); }
    }, 1000);

    function onMessage(event) {
      if (!event.data || event.data.type !== 'CHZZK_TOKEN') return;
      cleanup();
      saveTokens(event.data.accessToken, event.data.refreshToken, event.data.expiresIn);
      resolve(event.data.accessToken);
    }

    function cleanup() {
      window.removeEventListener('message', onMessage);
      clearInterval(timer);
      if (!popup.closed) popup.close();
    }

    window.addEventListener('message', onMessage);
  });
}

/**
 * 만료 임박 시 자동 갱신 후 유효한 Access Token을 반환합니다.
 * @returns {Promise<string>}
 */
function getAccessToken() {
  var stored = loadStoredTokens();

  // 토큰이 없으면 로그인 필요
  if (!stored.accessToken) return Promise.reject(new Error('로그인 필요'));

  // 만료까지 5분 미만이면 갱신
  if (Date.now() > stored.expiresAt - 5 * 60 * 1000) {
    return fetch(AUTH_SERVER_URL + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: stored.refreshToken })
    })
    .then(function(res) {
      if (!res.ok) {
        // Refresh Token 만료 → 기존 토큰 삭제
        [STORAGE_KEYS.ACCESS_TOKEN, STORAGE_KEYS.REFRESH_TOKEN, STORAGE_KEYS.EXPIRES_AT]
          .forEach(function(k) { localStorage.removeItem(k); });
        return Promise.reject(new Error('토큰 갱신 실패. 재로그인이 필요합니다.'));
      }
      return res.json();
    })
    .then(function(data) {
      saveTokens(data.accessToken, data.refreshToken, data.expiresIn);
      return data.accessToken;
    });
  }

  return Promise.resolve(stored.accessToken);
}

/**
 * 로그아웃: 서버에서 토큰을 폐기하고 로컬 저장소에서 삭제합니다.
 * @returns {Promise<void>}
 */
function logout() {
  var stored = loadStoredTokens();
  var revokePromise = stored.accessToken
    ? fetch(AUTH_SERVER_URL + '/auth/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: stored.accessToken })
      }).catch(function() {})
    : Promise.resolve();

  return revokePromise.then(function() {
    [STORAGE_KEYS.ACCESS_TOKEN, STORAGE_KEYS.REFRESH_TOKEN, STORAGE_KEYS.EXPIRES_AT]
      .forEach(function(k) { localStorage.removeItem(k); });
  });
}

module.exports = { login: login, logout: logout, getAccessToken: getAccessToken };
```

---

### 3. 치지직 채팅 연결 모듈 추가

`source/chzzkChat.js` 파일을 새로 생성합니다.

```javascript
// source/chzzkChat.js

'use strict';

var buzzk = require('buzzk');
var chzzkAuth = require('./chzzkAuth');

var chatInstance = null;

/**
 * 치지직 채팅에 연결하고 메시지 콜백을 등록합니다.
 * @param {function} onMessage - 채팅 메시지 수신 콜백 (data: { author, message })
 * @param {function} onDonation - 후원 메시지 수신 콜백 (data: { type, amount, author, message })
 * @returns {Promise<void>}
 */
async function connect(onMessage, onDonation) {
  var accessToken = await chzzkAuth.getAccessToken();

  var buzzkChat = buzzk.chat;
  chatInstance = new buzzkChat(accessToken);

  chatInstance.onMessage(onMessage);
  if (onDonation) chatInstance.onDonation(onDonation);

  chatInstance.onDisconnect(async function() {
    console.log('[ChzzkChat] 연결 끊김. 재연결 시도...');
    await new Promise(function(r) { setTimeout(r, 3000); });
    try {
      var newToken = await chzzkAuth.getAccessToken();
      await reconnect(newToken, onMessage, onDonation);
    } catch (e) {
      console.error('[ChzzkChat] 재연결 실패:', e.message);
    }
  });

  await chatInstance.connect();
  console.log('[ChzzkChat] 치지직 채팅 연결 완료');
}

async function reconnect(accessToken, onMessage, onDonation) {
  var buzzkChat = buzzk.chat;
  chatInstance = new buzzkChat(accessToken);
  chatInstance.onMessage(onMessage);
  if (onDonation) chatInstance.onDonation(onDonation);
  chatInstance.onDisconnect(async function() {
    await new Promise(function(r) { setTimeout(r, 3000); });
    try {
      var newToken = await chzzkAuth.getAccessToken();
      await reconnect(newToken, onMessage, onDonation);
    } catch (e) {
      console.error('[ChzzkChat] 재연결 실패:', e.message);
    }
  });
  await chatInstance.connect();
}

/**
 * 치지직 채팅 연결을 끊습니다.
 */
async function disconnect() {
  if (chatInstance) {
    await chatInstance.disconnect();
    chatInstance = null;
  }
}

module.exports = { connect: connect, disconnect: disconnect };
```

---

### 4. `main.js` 연동

`source/main.js`에서 치지직 채팅을 초기화하는 코드를 추가합니다.

```javascript
// source/main.js 에 추가 (기존 Twitch IRC 연결 코드 아래에 추가)

var chzzkAuth = require('./chzzkAuth');
var chzzkChat = require('./chzzkChat');

// 치지직 채팅 메시지를 BridgeBBCC 채팅창에 추가하는 함수
function handleChzzkMessage(data) {
  // BridgeBBCC의 addChatMessage 함수 형식에 맞게 변환
  addChatMessage({
    name: data.author.name,
    message: data.message,
    // 필요시 추가 필드 매핑
  });
}

// 치지직 연동 초기화
async function initChzzk() {
  if (!configData.chzzk || !configData.chzzk.enabled) return;

  try {
    // 저장된 토큰이 없으면 로그인
    var token = await chzzkAuth.getAccessToken().catch(function() { return null; });
    if (!token) {
      // autoLogin이 설정된 경우 자동으로 팝업 로그인
      if (configData.chzzk.autoLogin) {
        token = await chzzkAuth.login();
      } else {
        // 로그인 버튼을 UI에 추가하거나 콘솔에 안내 출력
        console.log('[ChzzkChat] 치지직 로그인이 필요합니다.');
        console.log('[ChzzkChat] chzzkAuth.login()을 호출하여 로그인하세요.');
        return;
      }
    }

    await chzzkChat.connect(handleChzzkMessage, function(donation) {
      // 후원 처리 (필요시 구현)
      console.log('[ChzzkChat] 후원:', donation.author.name, donation.amount);
    });
  } catch (e) {
    console.error('[ChzzkChat] 초기화 실패:', e.message);
  }
}

// 페이지 로드 후 치지직 초기화
initChzzk();
```

---

## 전체 흐름 순서도

```
BridgeBBCC (브라우저)          chzzk-chat-server          치지직 서버
      │                               │                        │
      │  1. window.open('/auth/login?session=xxx')             │
      │ ─────────────────────────────>│                        │
      │                               │ state 생성             │
      │  2. redirect to chzzk login   │                        │
      │ <──────────────────────────── │                        │
      │                               │                        │
      │  3. 사용자 치지직 로그인       │                        │
      │ ──────────────────────────────────────────────────────>│
      │                               │                        │
      │  4. callback?code=&state=     │                        │
      │ ──────────────────────────────────────────────────────>│
      │                               │  POST /auth/v1/token  │
      │                               │<──────────────────────>│
      │                               │ { accessToken, refreshToken }
      │  5. postMessage({ type: 'CHZZK_TOKEN', accessToken, ... })
      │ <───────────────────────────── │                        │
      │                               │                        │
      │  6. buzzk.chat로 채팅 연결     │                        │
      │ ──────────────────────────────────────────────────────>│
      │                               │                        │
      │  7. 실시간 채팅 수신/표시      │                        │
      │ <──────────────────────────────────────────────────────│
```

---

## 보안 고려사항

1. **HTTPS 사용 권장**  
   실제 서비스 환경에서는 `chzzk-chat-server`를 HTTPS로 운영하세요.  
   로컬 개발 환경에서는 `http://localhost`도 허용됩니다.

2. **`ALLOWED_ORIGINS` 설정**  
   `.env`에서 `ALLOWED_ORIGINS`를 BridgeBBCC가 실행되는 실제 오리진으로 제한하면  
   다른 사이트에서 API를 무단 호출하는 것을 막을 수 있습니다.
   ```
   ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
   ```

3. **토큰 저장 위치**  
   `localStorage`는 XSS 공격에 취약할 수 있습니다.  
   BridgeBBCC가 완전히 신뢰할 수 있는 로컬 환경에서만 사용한다면 큰 문제가 없으나,  
   인터넷에 공개된 페이지라면 `sessionStorage` 또는 메모리 변수 사용을 검토하세요.

4. **Refresh Token 보관**  
   Refresh Token은 Access Token보다 오래 유효하므로 유출에 주의하세요.  
   로컬 전용 환경이 아니라면 서버 측에 보관하는 것을 권장합니다.

5. **세션 토큰 TTL**  
   `/auth/token/:sessionId` 엔드포인트의 토큰은 서버에 **5분**만 보관됩니다.  
   그 이상이 지나면 다시 로그인이 필요합니다.

---

## FAQ

**Q. `chzzk-chat-server`가 반드시 로컬에서 실행되어야 하나요?**  
A. 아닙니다. 외부 서버에 배포해도 됩니다. `config.js`의 `authServerUrl`을 서버 주소로 변경하고, `.env`의 `REDIRECT_URI`도 해당 서버 주소로 설정하세요.

---

**Q. BridgeBBCC를 XSplit/OBS Webpage Source로 사용하는데 팝업이 열리지 않아요.**  
A. 일부 임베디드 WebView는 팝업을 차단합니다. 이 경우 [방법 2: 세션 기반 폴링](#방법-2-세션-기반-폴링)을 사용하거나, 로그인을 별도 브라우저에서 완료 후 토큰을 `localStorage`에 직접 입력하는 방법을 사용하세요.

---

**Q. Access Token이 만료되면 어떻게 되나요?**  
A. 치지직 API는 `401(INVALID_TOKEN)` 오류를 반환합니다. `getAccessToken()` 함수가 만료 5분 전 자동으로 Refresh Token을 사용해 갱신합니다. Refresh Token(30일)도 만료된 경우에는 재로그인이 필요합니다.

---

**Q. 여러 치지직 계정을 지원하고 싶어요.**  
A. `sessionId`에 계정 식별자를 포함하고, `localStorage` 키를 계정별로 구분하면 됩니다. 예: `chzzkAccessToken_channelId123`

---

## 참고 자료

- [chzzk-chat-server API 문서](./API.md)
- [치지직 공식 API 인증 문서](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization)
- [buzzk 라이브러리](https://github.com/Emin-G/buzzk)
- [BridgeBBCC 레포지토리](https://github.com/Lastorder-DC/BridgeBBCC)
