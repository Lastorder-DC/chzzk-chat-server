require("dotenv").config();

const express = require("express");
const buzzk = require("buzzk");

const authRouter = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 3000;

// buzzk 인증 초기화
buzzk.auth(process.env.CLIENT_ID, process.env.CLIENT_SECRET);

app.use(express.json());

app.get("/", (req, res) => {
    res.json({ status: "ok", message: "chzzk-chat-server is running" });
});

app.use("/auth", authRouter);

app.listen(PORT, () => {
    console.log(`chzzk-chat-server listening on port ${PORT}`);
});
