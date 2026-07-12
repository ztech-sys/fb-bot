const express = require('express');
const fs = require("fs");
const { login } = require("dhoner-fca");
const speakeasy = require("speakeasy");

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Web server đang chạy tại cổng ${PORT}`);
});

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = () => Math.floor(Math.random() * 3000) + 1000;

const FB_EMAIL = process.env.FB_EMAIL;
const FB_PASSWORD = process.env.FB_PASSWORD;
const FB_2FA_SECRET = process.env.FB_2FA_SECRET;

function generate2FACode() {
    try {
        return speakeasy.totp({ secret: FB_2FA_SECRET, encoding: 'base32', step: 30, digits: 6 });
    } catch { return null; }
}

async function refreshAppState() {
    return new Promise((resolve, reject) => {
        const code = generate2FACode();
        if (!code) return reject(new Error("Không tạo được mã 2FA"));

        login({ email: FB_EMAIL, password: FB_PASSWORD, twoFactorCode: code }, {
            online: true,
            listenEvents: true,
            autoMarkRead: false,
            autoReconnect: true,
            simulateTyping: false
        }, (err, api) => {
            if (err) return reject(err);
            const newAppState = api.getAppState();
            fs.writeFileSync("appstate.json", JSON.stringify(newAppState, null, 2));
            console.log("✅ Đã lưu cookie mới");
            resolve(newAppState);
        });
    });
}

const messageCount = {};
const userCooldown = {};

async function isAdmin(api, threadID, userID) {
    try {
        const info = await api.getThreadInfo(threadID);
        return info.adminIDs.some(a => a.id === userID);
    } catch { return false; }
}

async function isBotAdmin(api, threadID) {
    try {
        const info = await api.getThreadInfo(threadID);
        return info.adminIDs.some(a => a.id === api.getCurrentUserID());
    } catch { return false; }
}

async function startBot() {
    let appState = null;
    try {
        appState = JSON.parse(fs.readFileSync("appstate.json", "utf8"));
        console.log("🔑 Đã tìm thấy session cũ");
    } catch {
        console.log("🔑 Chưa có session, sẽ tạo mới...");
    }

    const loginOptions = {
        online: true,
        listenEvents: true,
        autoMarkRead: false,
        autoReconnect: true,
        simulateTyping: false
    };

    function doLogin(credentials) {
        login(credentials, loginOptions, async (err, api) => {
            if (err) {
                console.error("❌ Lỗi:", err);
                if (err.message && err.message.includes("userID")) {
                    try {
                        await refreshAppState();
                        setTimeout(startBot, 3000);
                    } catch {}
                }
                return;
            }

            console.log("✅ Đăng nhập thành công! ID:", api.getCurrentUserID());
            global.botId = api.getCurrentUserID();
            fs.writeFileSync("appstate.json", JSON.stringify(api.getAppState()));

            api.listenMqtt(async (err, event) => {
                if (err) return console.error("❌ MQTT:", err);

                // ====== WELCOME ======
                if (event.type === "event" && event.logMessageType === "log:subscribe") {
                    await delay(3000);
                    const newMembers = event.logMessageData.addedParticipants || [];
                    for (const member of newMembers) {
                        api.sendMessage(`🎉 Chào mừng ${member.fullName || "thành viên mới"} đã tham gia nhóm!`, event.threadID);
                    }
                    return;
                }

                if (event.type !== "message" || !event.body || !event.isGroup) return;

                const msg = event.body.toLowerCase();
                const sender = event.senderID;
                const thread = event.threadID;

                // ====== ĐẾM TIN NHẮN ======
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
                    if (!isSenderAdmin) return api.sendMessage("⛔️ Không có quyền!", thread);
                    if (!(await isBotAdmin(api, thread))) return api.sendMessage("🤖 Bot cần làm admin!", thread);
                    if (!event.mentions || Object.keys(event.mentions).length === 0) return api.sendMessage("⚠️ Cần tag người cần kick!", thread);
                    
                    const targetId = Object.keys(event.mentions)[0];
                    if (await isAdmin(api, thread, targetId)) return api.sendMessage("❌ Không thể kick admin!", thread);
                    
                    api.removeUserFromGroup(targetId, thread)
                        .then(() => api.sendMessage("✅ Đã kick!", thread))
                        .catch(() => api.sendMessage("❌ Lỗi kick!", thread));
                }

                // ====== BAN ======
                if (msg.startsWith("/ban")) {
                    await delay(randomDelay());
                    if (!isSenderAdmin) return api.sendMessage("⛔️ Không có quyền!", thread);
                    if (!(await isBotAdmin(api, thread))) return api.sendMessage("🤖 Bot cần làm admin!", thread);
                    if (!event.mentions || Object.keys(event.mentions).length === 0) return api.sendMessage("⚠️ Cần tag người cần ban!", thread);
                    
                    const targetId = Object.keys(event.mentions)[0];
                    if (await isAdmin(api, thread, targetId)) return api.sendMessage("❌ Không thể ban admin!", thread);
                    
                    api.banUser(targetId, thread)
                        .then(() => api.sendMessage("✅ Đã ban!", thread))
                        .catch(() => api.sendMessage("❌ Lỗi ban!", thread));
                }

                // ====== INFO ======
                if (msg.startsWith("/info")) {
                    await delay(randomDelay());
                    try {
                        let targetId = sender;
                        let name = "Bạn";
                        
                        if (event.mentions && Object.keys(event.mentions).length > 0) {
                            targetId = Object.keys(event.mentions)[0];
                            const userInfo = await api.getUserInfo(targetId);
                            name = userInfo[targetId]?.name || "Người dùng";
                        } else {
                            const userInfo = await api.getUserInfo(sender);
                            name = userInfo[sender]?.name || "Bạn";
                        }
                        
                        const userCount = messageCount[targetId] || 0;
                        const isAdminStatus = await isAdmin(api, thread, targetId);
                        
                        api.sendMessage(
                            `👤 THÔNG TIN THÀNH VIÊN\n` +
                            `📝 Tên: ${name}\n` +
                            `🆔 ID: ${targetId}\n` +
                            `👑 Admin: ${isAdminStatus ? '✅ Có' : '❌ Không'}\n` +
                            `💬 Số tin nhắn: ${userCount}`,
                            thread
                        );
                    } catch { api.sendMessage("❌ Lỗi lấy thông tin!", thread); }
                }

                // ====== STATS ======
                if (msg === "/stats") {
                    await delay(randomDelay());
                    const count = messageCount[sender] || 0;
                    const totalUsers = Object.keys(messageCount).length;
                    const totalMessages = Object.values(messageCount).reduce((a, b) => a + b, 0);
                    
                    api.sendMessage(
                        `📊 THỐNG KÊ\n` +
                        `💬 Tin nhắn của bạn: ${count}\n` +
                        `👥 Tổng người dùng: ${totalUsers}\n` +
                        `📨 Tổng tin nhắn: ${totalMessages}`,
                        thread
                    );
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

                // ====== SPAM DETECTION ======
                const spamKeywords = ["địt mẹ", "fuck", "đm", "con mẹ mày", "địt con mẹ mày", "fuck you", "kick bố m đi"];
                const isSpam = spamKeywords.some(keyword => msg.includes(keyword));

                if (isSpam) {
                    await delay(randomDelay());
                    const isSenderAdmin = await isAdmin(api, thread, sender);
                    if (!isSenderAdmin) {
                        const botIsAdmin = await isBotAdmin(api, thread);
                        if (!botIsAdmin) {
                            api.sendMessage("🤖 Bot cần làm admin để xử lý spam!", thread);
                        } else {
                            api.sendMessage("🚫 Phát hiện spam! Bot đang xử lý...", thread);
                            api.removeUserFromGroup(sender, thread)
                                .then(() => api.sendMessage("✅ Đã đuổi thành viên spam!", thread))
                                .catch(() => console.log("⚠️ Không thể đuổi spam"));
                        }
                    } else {
                        api.sendMessage("⚠️ Admin spam! Bot không thể kick admin.", thread);
                    }
                }

                // ====== HELP ======
                if (msg === "/help") {
                    await delay(randomDelay());
                    api.sendMessage(
                        "📋 DANH SÁCH LỆNH:\n\n" +
                        "🔹 /ping - Kiểm tra bot\n" +
                        "🔹 /info @tên - Xem thông tin thành viên\n" +
                        "🔹 /stats - Xem thống kê tin nhắn\n" +
                        "🔹 /members - Xem số lượng thành viên\n" +
                        "🔹 /kick @tên - Đuổi thành viên (Admin)\n" +
                        "🔹 /ban @tên - Cấm thành viên (Admin)\n" +
                        "🔹 /help - Hiển thị trợ giúp\n\n" +
                        "🎉 Bot tự động chào mừng thành viên mới!\n" +
                        "🚫 Bot tự động kick thành viên khi phát hiện từ ngữ vi phạm.",
                        thread
                    );
                }
            });
        });
    }

    if (appState) {
        doLogin({ appState: appState });
    } else {
        try {
            await refreshAppState();
            setTimeout(startBot, 2000);
        } catch (error) {
            console.error("❌ Không thể tạo appstate:", error);
        }
    }
}

console.log("🚀 Khởi động bot...");
startBot();
