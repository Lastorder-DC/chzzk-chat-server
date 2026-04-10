require("dotenv").config();

const express = require("express");
const cors = require("cors");
const buzzk = require("buzzk");

const authRouter = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 3000;

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

app.get("/", (req, res) => {
    res.json({ status: "ok", message: "chzzk-chat-server is running" });
});

app.use("/auth", authRouter);

app.listen(PORT, () => {
    console.log(`chzzk-chat-server listening on port ${PORT}`);
});
