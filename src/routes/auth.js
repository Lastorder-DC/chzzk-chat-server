const express = require("express");
const buzzk = require("buzzk");
const crypto = require("crypto");
const axios = require("axios");

const router = express.Router();

const CHZZK_AUTH_URL = "https://chzzk.naver.com/account-interlock";
const CHZZK_API_URL = "https://openapi.chzzk.naver.com/";

// state 값을 임시 저장하는 인메모리 맵 (TTL: 10분)
const stateStore = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function generateState() {
    const state = crypto.randomBytes(16).toString("hex");
    const expiresAt = Date.now() + STATE_TTL_MS;
    stateStore.set(state, expiresAt);
    return state;
}

function validateAndConsumeState(state) {
    if (!state || !stateStore.has(state)) return false;
    const expiresAt = stateStore.get(state);
    stateStore.delete(state);
    return Date.now() < expiresAt;
}

// 만료된 state 정리 (주기적 실행)
setInterval(() => {
    const now = Date.now();
    for (const [state, expiresAt] of stateStore.entries()) {
        if (now >= expiresAt) stateStore.delete(state);
    }
}, STATE_TTL_MS);

/**
 * GET /auth/login
 * 치지직 OAuth 로그인 페이지로 리다이렉트합니다.
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

    const state = generateState();

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
 * 인증 코드(code)와 state를 수신하고 Access Token을 발급합니다.
 */
router.get("/callback", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
        return res.status(400).json({
            success: false,
            message: "치지직 인증이 거부되었습니다.",
            error
        });
    }

    if (!code || !state) {
        return res.status(400).json({
            success: false,
            message: "code 또는 state 파라미터가 없습니다."
        });
    }

    if (!validateAndConsumeState(state)) {
        return res.status(400).json({
            success: false,
            message: "유효하지 않거나 만료된 state 값입니다."
        });
    }

    const tokens = await buzzk.oauth.get(code, state);

    if (!tokens) {
        return res.status(502).json({
            success: false,
            message: "Access Token 발급에 실패했습니다. code 또는 인증 정보를 확인하세요."
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
