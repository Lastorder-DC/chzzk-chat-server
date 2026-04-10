const express = require("express");
const buzzk = require("buzzk");
const crypto = require("crypto");
const axios = require("axios");

const router = express.Router();

const CHZZK_AUTH_URL = "https://chzzk.naver.com/account-interlock";
const CHZZK_API_URL = "https://openapi.chzzk.naver.com/";

// state → { expiresAt, sessionId } 매핑 (TTL: 10분)
const stateStore = new Map();
// sessionId → { accessToken, refreshToken, expiresIn, expiresAt } (TTL: 5분)
const sessionTokenStore = new Map();

const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TOKEN_TTL_MS = 5 * 60 * 1000;

// 세션 ID로 허용되는 문자 패턴 (영숫자, 하이픈, 언더스코어, 최대 64자)
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function generateState(sessionId) {
    const state = crypto.randomBytes(16).toString("hex");
    stateStore.set(state, { expiresAt: Date.now() + STATE_TTL_MS, sessionId: sessionId || null });
    return state;
}

function validateAndConsumeState(state) {
    if (!state || !stateStore.has(state)) return null;
    const entry = stateStore.get(state);
    stateStore.delete(state);
    if (Date.now() >= entry.expiresAt) return null;
    return entry;
}

// 만료된 항목 주기적 정리
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of stateStore.entries()) {
        if (now >= v.expiresAt) stateStore.delete(k);
    }
    for (const [k, v] of sessionTokenStore.entries()) {
        if (now >= v.expiresAt) sessionTokenStore.delete(k);
    }
}, STATE_TTL_MS);

/** HTML 특수문자를 이스케이프합니다. */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
}

/**
 * postMessage 전송에 사용할 targetOrigin을 반환합니다.
 * ALLOWED_ORIGINS가 설정된 경우 첫 번째 오리진을 사용하고, 없으면 '*'을 사용합니다.
 */
function getPostMessageTargetOrigin() {
    const origins = process.env.ALLOWED_ORIGINS;
    if (origins) {
        const first = origins.split(",")[0].trim();
        if (first) return first;
    }
    return "*";
}

/**
 * 토큰 전달 성공 HTML 페이지를 생성합니다.
 * - window.opener가 있으면 postMessage로 부모 창에 토큰을 전달하고 창을 닫습니다. (팝업 방식)
 * - window.opener가 없으면 토큰을 화면에 표시합니다. (직접 방문 방식)
 */
function buildSuccessHtml(accessToken, refreshToken, expiresIn, sessionId) {
    const tokenData = JSON.stringify({ type: "CHZZK_TOKEN", accessToken, refreshToken, expiresIn });
    const targetOrigin = getPostMessageTargetOrigin();
    const sessionInfo = sessionId
        ? `<p id="session-info">세션 ID: <code>${escapeHtml(sessionId)}</code><br>아래 엔드포인트로 토큰을 가져올 수 있습니다:<br><code>GET /auth/token/${escapeHtml(sessionId)}</code></p>`
        : "";

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>치지직 로그인 완료</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f0f0f; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 2rem; max-width: 520px; width: 90%; text-align: center; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.4rem; margin-bottom: 0.5rem; color: #fff; }
    p { color: #aaa; font-size: 0.9rem; margin-bottom: 1rem; line-height: 1.5; }
    code { background: #2a2a2a; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; word-break: break-all; }
    .token-box { background: #111; border: 1px solid #444; border-radius: 8px; padding: 0.8rem; margin: 1rem 0; text-align: left; font-size: 0.78rem; word-break: break-all; color: #ccc; }
    .token-box span { color: #888; font-size: 0.72rem; display: block; margin-bottom: 4px; }
    button { background: #00c73c; color: #fff; border: none; border-radius: 8px; padding: 0.6rem 1.4rem; font-size: 0.9rem; cursor: pointer; margin: 0.3rem; }
    button:hover { background: #00a832; }
    button.secondary { background: #333; }
    button.secondary:hover { background: #444; }
    #status { margin-top: 1rem; font-size: 0.85rem; color: #888; }
    #session-info { background: #1e1e2e; border: 1px solid #444; border-radius: 8px; padding: 0.8rem; text-align: left; font-size: 0.82rem; line-height: 1.8; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#x2705;</div>
    <h1>&#xCE58;&#xC9C0;&#xC9C1; &#xB85C;&#xADF8;&#xC778; &#xC644;&#xB8CC;</h1>
    <p id="desc">&#xC778;&#xC99D;&#xC774; &#xC644;&#xB8CC;&#xB418;&#xC5C8;&#xC2B5;&#xB2C8;&#xB2E4;.</p>
    <div class="token-box">
      <span>Access Token</span>${escapeHtml(accessToken)}
    </div>
    <div>
      <button onclick="copyToken()">Access Token &#xBCF5;&#xC0AC;</button>
      <button class="secondary" onclick="copyAll()">&#xC804;&#xCCB4; JSON &#xBCF5;&#xC0AC;</button>
    </div>
    ${sessionInfo}
    <div id="status"></div>
  </div>
  <script>
    var tokenData = ${tokenData};
    var targetOrigin = ${JSON.stringify(targetOrigin)};
    var allJson = JSON.stringify({ accessToken: tokenData.accessToken, refreshToken: tokenData.refreshToken, expiresIn: tokenData.expiresIn }, null, 2);

    function copyToken() {
      navigator.clipboard.writeText(tokenData.accessToken).then(function() {
        document.getElementById("status").textContent = "\u2714 Access Token\uC774 \uD074\uB9BD\uBCF4\uB4DC\uC5D0 \uBCF5\uC0AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.";
      });
    }
    function copyAll() {
      navigator.clipboard.writeText(allJson).then(function() {
        document.getElementById("status").textContent = "\u2714 \uC804\uCCB4 \uD1A0\uD070 \uC815\uBCF4\uAC00 \uD074\uB9BD\uBCF4\uB4DC\uC5D0 \uBCF5\uC0AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.";
      });
    }

    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(tokenData, targetOrigin);
        document.getElementById("desc").textContent = "BridgeBBCC\uC5D0 \uD1A0\uD070\uC744 \uC804\uB2EC\uD588\uC2B5\uB2C8\uB2E4. \uCC3D\uC774 \uC790\uB3D9\uC73C\uB85C \uB2EB\uD799\uB2C8\uB2E4.";
        setTimeout(function() { window.close(); }, 2000);
      } catch(e) {
        document.getElementById("desc").textContent = "\uD1A0\uD070 \uC804\uB2EC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uC704\uC758 Access Token\uC744 \uC9C1\uC811 \uBCF5\uC0AC\uD574 \uC0AC\uC6A9\uD558\uC138\uC694.";
      }
    } else {
      document.getElementById("desc").textContent = "\uC704\uC758 Access Token\uC744 \uBCF5\uC0AC\uD558\uC5EC BridgeBBCC \uC124\uC815\uC5D0 \uC785\uB825\uD558\uC138\uC694.";
    }
  </script>
</body>
</html>`;
}

/**
 * 오류 HTML 페이지를 생성합니다.
 */
function buildErrorHtml(message) {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>&#xCE58;&#xC9C0;&#xC9C1; &#xB85C;&#xADF8;&#xC778; &#xC624;&#xB958;</title>
  <style>
    body { font-family: sans-serif; background: #0f0f0f; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1a1a1a; border: 1px solid #c00; border-radius: 12px; padding: 2rem; max-width: 480px; width: 90%; text-align: center; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.3rem; color: #ff6b6b; margin-bottom: 0.8rem; }
    p { color: #aaa; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#x274C;</div>
    <h1>&#xB85C;&#xADF8;&#xC778; &#xC2E4;&#xD328;</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

/**
 * GET /auth/login
 * 치지직 OAuth 로그인 페이지로 리다이렉트합니다.
 *
 * Query:
 *   session (선택) - BridgeBBCC 연동용 세션 ID. 없으면 서버가 자동 생성합니다.
 *                    발급된 세션 ID는 /auth/token/:sessionId 로 토큰을 조회할 때 사용합니다.
 */
router.get("/login", (req, res) => {
    const clientId = process.env.CLIENT_ID;
    const redirectUri = process.env.REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return res.status(500).json({
            success: false,
            message: "서버 환경 변수(CLIENT_ID, REDIRECT_URI)가 설정되지 않았습니다."
        });
    }

    const rawSession = req.query.session;
    let sessionId;
    if (rawSession && typeof rawSession === "string" && SESSION_ID_PATTERN.test(rawSession)) {
        sessionId = rawSession;
    } else {
        sessionId = crypto.randomBytes(12).toString("hex");
    }

    const state = generateState(sessionId);

    const params = new URLSearchParams({
        clientId,
        redirectUri,
        responseType: "code",
        state
    });

    return res.redirect(`${CHZZK_AUTH_URL}?${params.toString()}`);
});

/**
 * GET /auth/callback
 * 치지직 인증 후 리다이렉트되는 콜백 엔드포인트입니다.
 * - 인증 성공 시 HTML 페이지를 반환합니다.
 *   - 팝업으로 열린 경우: window.opener.postMessage로 부모 창(BridgeBBCC)에 토큰을 전달합니다.
 *   - 직접 방문한 경우: 토큰을 화면에 표시합니다.
 * - 세션 ID가 있으면 서버에 토큰을 5분간 보관합니다. (GET /auth/token/:sessionId 로 조회 가능)
 */
router.get("/callback", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
        return res.status(400).send(buildErrorHtml("치지직 인증이 거부되었습니다."));
    }

    if (!code || !state) {
        return res.status(400).send(buildErrorHtml("code 또는 state 파라미터가 없습니다."));
    }

    const stateEntry = validateAndConsumeState(state);
    if (!stateEntry) {
        return res.status(400).send(buildErrorHtml("유효하지 않거나 만료된 state 값입니다. 다시 로그인해 주세요."));
    }

    const tokens = await buzzk.oauth.get(code, state);

    if (!tokens) {
        console.error("[auth/callback] Access Token 발급 실패. 치지직 API 오류 또는 code 만료 가능성이 있습니다.");
        return res.status(502).send(buildErrorHtml("Access Token 발급에 실패했습니다. 잠시 후 다시 시도해 주세요."));
    }

    const { sessionId } = stateEntry;

    // 세션이 있으면 토큰을 서버에 임시 저장 (BridgeBBCC 폴링 또는 1회 조회 용도)
    if (sessionId) {
        sessionTokenStore.set(sessionId, {
            accessToken: tokens.access,
            refreshToken: tokens.refresh,
            expiresIn: tokens.expireIn,
            expiresAt: Date.now() + SESSION_TOKEN_TTL_MS
        });
    }

    return res.send(buildSuccessHtml(tokens.access, tokens.refresh, tokens.expireIn, sessionId));
});

/**
 * GET /auth/token/:sessionId
 * 세션 ID로 발급된 토큰을 1회 조회합니다. 조회 즉시 서버에서 삭제됩니다.
 * BridgeBBCC에서 /auth/login?session=SESSION_ID 로 로그인 후 이 엔드포인트로 폴링합니다.
 *
 * 응답:
 *   - 토큰이 준비된 경우: { success: true, accessToken, refreshToken, expiresIn }
 *   - 아직 준비되지 않은 경우: { success: false, pending: true }
 *   - 만료된 경우: 404
 */
router.get("/token/:sessionId", (req, res) => {
    const { sessionId } = req.params;

    // 유효하지 않은 세션 ID 형식이면 즉시 404
    if (!SESSION_ID_PATTERN.test(sessionId)) {
        return res.status(404).json({ success: false, message: "세션을 찾을 수 없습니다." });
    }

    if (!sessionTokenStore.has(sessionId)) {
        // 형식은 유효하지만 아직 토큰이 없으면 로그인 대기 중
        return res.status(202).json({ success: false, pending: true });
    }

    const entry = sessionTokenStore.get(sessionId);

    if (Date.now() >= entry.expiresAt) {
        sessionTokenStore.delete(sessionId);
        return res.status(404).json({ success: false, message: "세션이 만료되었습니다." });
    }

    // 1회 조회 후 삭제
    sessionTokenStore.delete(sessionId);

    return res.json({
        success: true,
        accessToken: entry.accessToken,
        refreshToken: entry.refreshToken,
        expiresIn: entry.expiresIn
    });
});

/**
 * POST /auth/refresh
 * Refresh Token으로 Access Token을 갱신합니다.
 * Body: { "refreshToken": "..." }
 */
router.post("/refresh", async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({
            success: false,
            message: "refreshToken이 필요합니다."
        });
    }

    const tokens = await buzzk.oauth.refresh(refreshToken);

    if (!tokens) {
        return res.status(401).json({
            success: false,
            message: "토큰 갱신에 실패했습니다. Refresh Token이 만료되었거나 유효하지 않습니다."
        });
    }

    return res.json({
        success: true,
        accessToken: tokens.access,
        refreshToken: tokens.refresh,
        expiresIn: tokens.expireIn
    });
});

/**
 * POST /auth/revoke
 * Access Token으로 해당 사용자의 모든 Token을 폐기합니다.
 * Body: { "accessToken": "..." }
 */
router.post("/revoke", async (req, res) => {
    const { accessToken } = req.body;

    if (!accessToken) {
        return res.status(400).json({
            success: false,
            message: "accessToken이 필요합니다."
        });
    }

    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;

    try {
        const response = await axios.post(
            `${CHZZK_API_URL}auth/v1/token/revoke`,
            { accessToken },
            {
                headers: {
                    "Client-Id": clientId,
                    "Client-Secret": clientSecret,
                    "Content-Type": "application/json"
                }
            }
        );

        const data = response.data;

        if (data.code !== 200) {
            return res.status(400).json({
                success: false,
                message: "Token revoke에 실패했습니다.",
                detail: data
            });
        }

        return res.json({
            success: true,
            message: "모든 Token이 성공적으로 폐기되었습니다."
        });
    } catch (err) {
        const status = err.response?.status || 500;
        const detail = err.response?.data || err.message;
        return res.status(status).json({
            success: false,
            message: "Token revoke 요청 중 오류가 발생했습니다.",
            detail
        });
    }
});

module.exports = router;
