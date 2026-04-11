require("dotenv").config();

const express = require("express");
const cors = require("cors");
const buzzk = require("buzzk");

const authRouter = require("./routes/auth");
const sessionsRouter = require("./routes/sessions");

const app = express();
const PORT = process.env.PORT || 3000;

// 리버스 프록시(nginx 등) 뒤에서 실행될 때 실제 클라이언트 IP를 올바르게 인식하도록 설정
// TRUST_PROXY=1 이면 첫 번째 프록시(nginx)만 신뢰, 0 이면 비활성화
const trustProxy = process.env.TRUST_PROXY !== undefined ? parseInt(process.env.TRUST_PROXY, 10) || 0 : 1;
if (trustProxy) {
    app.set("trust proxy", trustProxy);
}

// buzzk 인증 초기화
buzzk.auth(process.env.CLIENT_ID, process.env.CLIENT_SECRET);

// CORS 설정 - BridgeBBCC 브라우저에서 API 호출 가능하도록
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : null;

app.use(cors({
    origin: allowedOrigins || "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get("/", (req, res) => {
    res.json({ status: "ok", message: "chzzk-chat-server is running" });
});

app.use("/auth", authRouter);
app.use("/sessions", sessionsRouter);

app.listen(PORT, () => {
    console.log(`chzzk-chat-server listening on port ${PORT}`);
});
