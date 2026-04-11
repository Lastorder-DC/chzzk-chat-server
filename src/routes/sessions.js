const express = require("express");
const axios = require("axios");

const router = express.Router();

const CHZZK_API_BASE = "https://openapi.chzzk.naver.com";

/**
 * Authorization 헤더가 없으면 401을 응답하고 null을 반환합니다.
 * 헤더가 있으면 헤더 값을 반환합니다.
 */
function requireAuthorization(req, res) {
    const authorization = req.headers["authorization"];
    if (!authorization) {
        res.status(401).json({
            success: false,
            message: "Authorization 헤더가 필요합니다. (Bearer {accessToken} 형식)"
        });
        return null;
    }
    return authorization;
}

/**
 * Chzzk OpenAPI에 유저 인증(Bearer) 기반 GET 요청을 프록시합니다.
 * 클라이언트가 Authorization: Bearer {accessToken} 헤더를 전달해야 합니다.
 */
async function proxyUserGet(req, res, path) {
    const authorization = requireAuthorization(req, res);
    if (!authorization) return;

    try {
        const response = await axios.get(`${CHZZK_API_BASE}${path}`, {
            params: req.query,
            headers: { Authorization: authorization }
        });
        return res.status(response.status).json(response.data);
    } catch (err) {
        const status = err.response?.status || 502;
        const data = err.response?.data || { message: err.message };
        return res.status(status).json({ success: false, upstream: data });
    }
}

/**
 * Chzzk OpenAPI에 클라이언트 인증(Client-Id/Secret) 기반 GET 요청을 프록시합니다.
 */
async function proxyClientGet(req, res, path) {
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return res.status(500).json({
            success: false,
            message: "서버 환경 변수(CLIENT_ID, CLIENT_SECRET)가 설정되지 않았습니다."
        });
    }

    try {
        const response = await axios.get(`${CHZZK_API_BASE}${path}`, {
            params: req.query,
            headers: {
                "Client-Id": clientId,
                "Client-Secret": clientSecret
            }
        });
        return res.status(response.status).json(response.data);
    } catch (err) {
        const status = err.response?.status || 502;
        const data = err.response?.data || { message: err.message };
        return res.status(status).json({ success: false, upstream: data });
    }
}

/**
 * Chzzk OpenAPI에 유저 인증(Bearer) 기반 POST 요청을 프록시합니다.
 * 클라이언트가 Authorization: Bearer {accessToken} 헤더를 전달해야 합니다.
 */
async function proxyUserPost(req, res, path) {
    const authorization = requireAuthorization(req, res);
    if (!authorization) return;

    try {
        const formData = new URLSearchParams(req.body);
        const response = await axios.post(`${CHZZK_API_BASE}${path}`, formData, {
            headers: {
                Authorization: authorization,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });
        return res.status(response.status).json(response.data);
    } catch (err) {
        const status = err.response?.status || 502;
        const data = err.response?.data || { message: err.message };
        return res.status(status).json({ success: false, upstream: data });
    }
}

/**
 * GET /sessions
 * 세션 목록 조회(유저)
 * Chzzk API: GET /open/v1/sessions
 *
 * Headers: Authorization: Bearer {accessToken}
 * Query: size (선택, default 20), page (선택, default 0)
 */
router.get("/", (req, res) => proxyUserGet(req, res, "/open/v1/sessions"));

/**
 * GET /sessions/client
 * 세션 목록 조회(클라이언트)
 * Chzzk API: GET /open/v1/sessions/client
 *
 * Query: size (선택, default 20), page (선택, default 0)
 */
router.get("/client", (req, res) => proxyClientGet(req, res, "/open/v1/sessions/client"));

/**
 * GET /sessions/auth
 * 세션 생성(유저) - 소켓 연결 URL 발급
 * Chzzk API: GET /open/v1/sessions/auth
 *
 * Headers: Authorization: Bearer {accessToken}
 */
router.get("/auth", (req, res) => proxyUserGet(req, res, "/open/v1/sessions/auth"));

/**
 * GET /sessions/auth/client
 * 세션 생성(클라이언트) - 소켓 연결 URL 발급
 * Chzzk API: GET /open/v1/sessions/auth/client
 */
router.get("/auth/client", (req, res) => proxyClientGet(req, res, "/open/v1/sessions/auth/client"));

/**
 * POST /sessions/events/subscribe/chat
 * 이벤트 구독(채팅)
 * Chzzk API: POST /open/v1/sessions/events/subscribe/chat
 *
 * Headers: Authorization: Bearer {accessToken}
 * Body: { sessionKey: string, channelId: string }
 */
router.post("/events/subscribe/chat", (req, res) => proxyUserPost(req, res, "/open/v1/sessions/events/subscribe/chat"));

/**
 * POST /sessions/events/subscribe/donation
 * 이벤트 구독(후원)
 * Chzzk API: POST /open/v1/sessions/events/subscribe/donation
 *
 * Headers: Authorization: Bearer {accessToken}
 * Body: { sessionKey: string, channelId: string }
 */
router.post("/events/subscribe/donation", (req, res) => proxyUserPost(req, res, "/open/v1/sessions/events/subscribe/donation"));

/**
 * POST /sessions/events/subscribe/subscription
 * 이벤트 구독(구독)
 * Chzzk API: POST /open/v1/sessions/events/subscribe/subscription
 *
 * Headers: Authorization: Bearer {accessToken}
 * Body: { sessionKey: string, channelId: string }
 */
router.post("/events/subscribe/subscription", (req, res) => proxyUserPost(req, res, "/open/v1/sessions/events/subscribe/subscription"));

module.exports = router;
