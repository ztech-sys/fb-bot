const express = require('express');
const fs = require("fs");
const { login } = require("dhoner-fca");
const speakeasy = require("speakeasy");

// ====== WEB SERVER ======
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    console.log(`📡 Ping nhận lúc: ${new Date().toISOString()}`);
    res.status(200).send('🤖 Bot is running!');
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'online',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        botId: global.botId || 'chưa login'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Web server đang chạy tại cổng ${PORT}`);
});

// ====== DELAY ======
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = () => Math.floor(Math.random() * 3000) + 1000;

// ====== BIẾN MÔI TRƯỜNG ======
const FB_EMAIL = process.env.FB_EMAIL || "your_email@gmail.com";
const FB_PASSWORD = process.env.FB_PASSWORD || "your_password";
const FB_2FA_SECRET = process.env.FB_2FA_SECRET || "KH4N5G7I9J2L4M6P8Q1R3T5U7W9X2Z4";

// ====== HÀM TẠO MÃ 2FA ======
function generate2FACode() {
    try {
        const code = speakeasy.totp({
            secret: FB_2FA_SECRET,
            encoding: 'base32',
            step: 30,
            digits: 6
        });
        console.log(`🔐 Mã 2FA: ${code}`);
        return code;
    } catch (error) {
        console.error("❌ Lỗi tạo mã 2FA:", error);
        return null;
    }
}

// ====== HÀM LẤY COOKIE MỚI ======
async function refreshAppState() {
    return new Promise((resolve, reject) => {
        const code = generate2FACode();
        if (!code) {
            reject(new Error("Không tạo được mã 2FA"));
            return;
        }

        const loginOptions = {
            online: true,
            listenEvents: true,
            autoMarkRead: false,
            autoReconnect: true,
            simulateTyping: false,
            forceLogin: false
        };

        const credentials = {
            email: FB_EMAIL,
            password: FB_PASSWORD,
            twoFactorCode: code
        };

        console.log("🔄 Đang đăng nhập để lấy cookie mới...");

        login(credentials, loginOptions, (err, api) => {
            if (err) {
                console.error("❌ Lỗi đăng nhập:", err);
                reject(err);
                return;
            }

            const newAppState = api.getAppState();
            fs.writeFileSync("appstate.json", JSON.stringify(newAppState, null, 2));
            console.log("✅ Đã lưu cookie mới vào appstate.json");
            resolve(newAppState);
        });
    });
}

// ====== CODE BOT CHÍNH ======
const messageCount = {};
const userCooldown = {};

async function isAdmin(api, threadID, userID) {
    try {
        const threadInfo = await api.getThreadInfo(threadID);
        return threadInfo.adminIDs.some(admin => admin.id === userID);
    } catch { return false; }
}

async function isBotAdmin(api, threadID) {
    try {
        const threadInfo = await api.getThreadInfo(threadID);
        const botID = api.getCurrentUserID();
        return threadInfo.adminIDs.some(admin => admin.id === botID);
    } catch { return false; }
}

async function startBot() {
    // ====== KIỂM TRA APPSTATE ======
    let appState = null;
    try {
        appState = JSON.parse(fs.readFileSync("appstate.json", "utf8"));
        console.log("🔑 Đã tìm thấy session cũ");
    } catch (e) {
        console.log("🔑 Chưa có session, sẽ tạo mới...");
    }

    const loginOptions = {
        online: true,
        listenEvents: true,
        autoMarkRead: false,
        autoReconnect: true,
        simulateTyping: false,
        forceLogin: false
    };

    // ====== LOGIN ======
    function doLogin(credentials) {
        login(credentials, loginOptions, async (err, api) => {
            if (err) {
                console.error("❌ Lỗi đăng nhập:", err);
                
                if (err.message && (err.message.includes("userID") || err.message.includes("session"))) {
                    console.log("🔄 Session hết hạn, đang lấy cookie mới...");
                    try {
                        const newAppState = await refreshAppState();
                        console.log("✅ Đã lấy cookie mới, khởi động lại bot...");
                        setTimeout(() => startBot(), 3000);
                    } catch (refreshError) {
                        console.error("❌ Không thể refresh cookie:", refreshError);
                    }
                }
                return;
            }

            console.log("✅ Đăng nhập thành công! ID:", api.getCurrentUserID());
            global.botId = api.getCurrentUserID();

            fs.writeFileSync("appstate.json", JSON.stringify(api.getAppState()));
            console.log("📁 Đã lưu session");

            api.listenMqtt(async (err, event) => {
                if (err) {
                    console.error("❌ Lỗi MQTT:", err);
                    if (err.message && err.message.includes("1357001")) {
                        console.log("🔄 Tài khoản bị chặn, thử lấy cookie mới...");
                        try {
                            await refreshAppState();
                            setTimeout(() => startBot(), 5000);
                        } catch (e) {
                            console.error("❌ Không thể refresh:", e);
                        }
                    }
                    return;
                }

                // ====== WELCOME ======
                if (event.type === "event" && event.logMessageType === "log:subscribe") {
                    await delay(3000);
                    const newMembers = event.logMessageData.addedParticipants || [];
                    for (const member of newMembers) {
                        const name = member.fullName || "thành viên mới";
                        api.sendMessage(`🎉 Chào mừng ${name} đã tham gia nhóm!`, event.threadID);
                    }
                    return;
                }

                if (event.type !== "message" || !event.body || !event.isGroup) return;

                const msg = event.body.toLowerCase();
                const sender = event.senderID;
                const thread = event.threadID;

                messageCount[sender] = (messageCount[sender] || 0) + 1;
                if (userCooldown[sender] && Date.now() - userCooldown[sender] < 5000) return;
                userCooldown[sender] = Date.now();

                const isSenderAdmin = await isAdmin(api, thread, sender);

                // ====== PING ======
                if (msg === "/ping") {
                    await delay(randomDelay());
                    api.sendMessage("🏓 pong!", thread);
                }

                // ====== KICK ======
                if (msg.startsWith("/kick")) {
                    await delay(randomDelay());
                    if (!isSenderAdmin) {
                        api.sendMessage("⛔️ Bạn không có quyền!", thread);
                        return;
                    }
                    if (!(await isBotAdmin(api, thread))) {
                        api.sendMessage("🤖 Bot cần làm admin!", thread);
                        return;
                    }
                    if (!event.mentions || Object.keys(event.mentions).length === 0) {
                        api.sendMessage("⚠️ Cần tag người cần kick!", thread);
                        return;
                    }
                    const targetId = Object.keys(event.mentions)[0];
                    if (await isAdmin(api, thread, targetId)) {
                        api.sendMessage("❌ Không thể kick admin!", thread);
                        return;
                    }
                    api.removeUserFromGroup(targetId, thread)
                        .then(() => api.sendMessage("✅ Đã kick!", thread))
                        .catch(() => api.sendMessage("❌ Lỗi kick!", thread));
                }

                // ====== MEMBERS ======
                if (msg === "/members") {
                    await delay(randomDelay());
                    try {
                        const info = await api.getThreadInfo(thread);
                        api.sendMessage(
                            `👥 Số thành viên: ${info.participantIDs.length}\n` +
                            `👑 Số admin: ${info.adminIDs.length}`,
                            thread
                        );
                    } catch { api.sendMessage("❌ Lỗi!", thread); }
                }

                // ====== HELP ======
                if (msg === "/help") {
                    await delay(randomDelay());
                    api.sendMessage(
                        "📋 LỆNH:\n" +
                        "/ping - Kiểm tra bot\n" +
                        "/kick @tên - Đuổi (Admin)\n" +
                        "/members - Số thành viên\n" +
                        "/help - Trợ giúp",
                        thread
                    );
                }
            });
        });
    }

    // ====== BẮT ĐẦU LOGIN ======
    if (appState) {
        doLogin({ appState: appState });
    } else {
        try {
            const newAppState = await refreshAppState();
            console.log("✅ Đã tạo appstate mới!");
            setTimeout(() => startBot(), 2000);
        } catch (error) {
            console.error("❌ Không thể tạo appstate:", error);
        }
    }
}

// ====== KHỞI ĐỘNG ======
console.log("🚀 Khởi động bot...");
startBot();
