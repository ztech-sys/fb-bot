const express = require('express');
const fs = require("fs");
const readline = require("readline");
const { login } = require("dhoner-fca");

// ====== WEB SERVER CHO CRON PING ======
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
// ====== KẾT THÚC WEB SERVER ======

// ====== DELAY ======
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = () => Math.floor(Math.random() * 3000) + 1000; // 1-4 giây

// ====== CODE BOT ======
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const messageCount = {};
const userCooldown = {};

function askCredentials() {
    return new Promise((resolve) => {
        rl.question("📧 Nhập email Facebook: ", (email) => {
            rl.question("🔑 Nhập mật khẩu Facebook: ", (password) => {
                resolve({ email, password });
                rl.close();
            });
        });
    });
}

// ====== AI REPLY ======
function getAIResponse(message) {
    const msg = message.toLowerCase();
    const responses = {
        "hello": "Xin chào! Tôi là bot, có thể giúp gì cho bạn? 😊",
        "hi": "Chào bạn! Chúc bạn một ngày tốt lành! 🌟",
        "xin chào": "Chào bạn yêu quý! ❤️",
        "chào": "Chào bạn! Có cần tôi giúp gì không? 🤖",
        "cảm ơn": "Không có gì đâu bạn! Rất vui được giúp bạn! 🥰",
        "thanks": "You're welcome! 😊",
        "thank": "My pleasure! 🤗",
        "bot ơi": "Tôi đây! Có chuyện gì thế? 🤖",
        "ơi bot": "Có tôi đây! Bạn cần gì? 😊",
        "có ai không": "Có tôi đây ạ! Đang nghe bạn nè! 👋",
        "mày là ai": "Tôi là bot tự động, được tạo ra để giúp quản lý nhóm! 🤖",
        "bạn là ai": "Tôi là trợ lý ảo trong nhóm này! 😊",
        "bot là gì": "Tôi là một con bot Facebook, được lập trình để hỗ trợ quản lý nhóm!",
        "làm gì": "Tôi có thể giúp bạn: ping, kick, ban, xem members, xem info... Gõ /help để xem chi tiết! 📋",
        "giúp gì": "Tôi hỗ trợ nhiều lệnh lắm! Gõ /help để xem danh sách nhé! 😊",
        "haha": "Có gì vui mà cười thế? Share đi! 😄",
        "cười": "Được rồi, tôi cười cùng bạn: Hahaha! 😂",
        "chán": "Đừng chán! Có tôi ở đây này! Hãy thử gõ /help xem có gì thú vị nhé! 🎮",
        "buồn": "Ôi, bạn buồn à? Để tôi làm gì đó vui vẻ nhé! 😊",
        "mấy giờ": `🕐 Bây giờ là: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
        "thời gian": `📅 Hôm nay là: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
        "tên bạn là gì": "Tôi là bot của nhóm này! Bạn có thể gọi tôi là BOT 😊",
        "tên gì": "Tên tôi là Bot! Bạn có thể gọi tôi là BOT nhé 🤖",
        "tạm biệt": "Tạm biệt bạn! Hẹn gặp lại nhé! 👋",
        "bye": "Bye bye! Chúc bạn vui vẻ! 😊",
        "goodbye": "Goodbye! Have a nice day! 🌟"
    };
    for (const [key, reply] of Object.entries(responses)) {
        if (msg.includes(key)) return reply;
    }
    return null;
}

// ====== KIỂM TRA ADMIN ======
async function isAdmin(api, threadID, userID) {
    try {
        const threadInfo = await api.getThreadInfo(threadID);
        return threadInfo.adminIDs.some(admin => admin.id === userID);
    } catch (error) {
        console.error("❌ Lỗi kiểm tra admin:", error);
        return false;
    }
}

async function isBotAdmin(api, threadID) {
    try {
        const threadInfo = await api.getThreadInfo(threadID);
        const botID = api.getCurrentUserID();
        return threadInfo.adminIDs.some(admin => admin.id === botID);
    } catch (error) {
        console.error("❌ Lỗi kiểm tra bot admin:", error);
        return false;
    }
}

// ====== HÀM CHÍNH ======
async function main() {
    let appState = null;
    try {
        appState = JSON.parse(fs.readFileSync("appstate.json", "utf8"));
        console.log("🔑 Đã tìm thấy session, đăng nhập tự động...");
    } catch (e) {
        console.log("🔑 Chưa có session, cần đăng nhập lần đầu.");
    }

    const loginOptions = {
        online: true,
        listenEvents: true,
        autoMarkRead: false,   // TẮT autoMarkRead
        autoReconnect: true,
        simulateTyping: false, // TẮT simulateTyping
        forceLogin: false,
        selfListen: false
    };

    let credentials = {};
    if (appState) {
        credentials = { appState: appState };
    } else {
        const { email, password } = await askCredentials();
        credentials = { email, password };
    }

    login(credentials, loginOptions, (err, api) => {
        if (err) {
            console.error("❌ Lỗi đăng nhập:", err);
            return;
        }

        console.log("✅ Đăng nhập thành công! User ID:", api.getCurrentUserID());
        global.botId = api.getCurrentUserID();

        fs.writeFileSync("appstate.json", JSON.stringify(api.getAppState()));
        console.log("📁 Đã lưu session vào appstate.json");

        api.listenMqtt(async (err, event) => {
            if (err) return console.error("❌ Lỗi lắng nghe:", err);

            // ====== WELCOME ======
            if (event.type === "event" && event.logMessageType === "log:subscribe") {
                await delay(5000); // Chờ 5s trước khi chào
                const newMembers = event.logMessageData.addedParticipants || [];
                for (const member of newMembers) {
                    const name = member.fullName || "thành viên mới";
                    api.sendMessage(`🎉 Chào mừng ${name} đã tham gia nhóm!\n\n👋 Hãy giới thiệu bản thân và tuân thủ nội quy nhé!`, event.threadID);
                }
                return;
            }

            if (event.type !== "message" || !event.body || !event.isGroup) return;

            const msg = event.body.toLowerCase();
            const sender = event.senderID;
            const thread = event.threadID;

            // ====== ĐẾM TIN NHẮN ======
            messageCount[sender] = (messageCount[sender] || 0) + 1;

            // Chống spam lệnh (5s)
            if (userCooldown[sender] && Date.now() - userCooldown[sender] < 5000) {
                return;
            }
            userCooldown[sender] = Date.now();

            const isSenderAdmin = await isAdmin(api, thread, sender);

            // ====== AI REPLY (có delay) ======
            if (!msg.startsWith("/")) {
                const aiReply = getAIResponse(msg);
                if (aiReply) {
                    await delay(randomDelay());
                    api.sendMessage(aiReply, thread);
                }
            }

            // ====== PING ======
            if (msg === "/ping") {
                await delay(randomDelay());
                api.sendMessage("🏓 pong!", thread);
            }

            // ====== KICK ======
            if (msg.startsWith("/kick")) {
                await delay(randomDelay());
                console.log(`📨 Nhận lệnh /kick từ ${sender}`);
                
                if (!isSenderAdmin) {
                    api.sendMessage("⛔️ Bạn không có quyền!", thread);
                    return;
                }

                const botIsAdmin = await isBotAdmin(api, thread);
                if (!botIsAdmin) {
                    api.sendMessage("🤖 Bot cần được thêm làm admin!", thread);
                    return;
                }

                if (!event.mentions || Object.keys(event.mentions).length === 0) {
                    api.sendMessage("⚠️ Cần tag người cần kick. Ví dụ: /kick @tên", thread);
                    return;
                }

                const targetId = Object.keys(event.mentions)[0];
                const isTargetAdmin = await isAdmin(api, thread, targetId);
                
                if (isTargetAdmin) {
                    api.sendMessage("❌ Không thể kick admin khác!", thread);
                    return;
                }

                await delay(randomDelay()); // Delay trước khi kick
                api.removeUserFromGroup(targetId, thread)
                    .then(() => {
                        api.sendMessage("✅ Đã đuổi thành viên khỏi nhóm.", thread);
                    })
                    .catch((error) => {
                        console.error("Lỗi kick:", error);
                        api.sendMessage(`❌ Lỗi: ${error.message}`, thread);
                    });
            }

            // ====== BAN ======
            if (msg.startsWith("/ban")) {
                await delay(randomDelay());
                if (!isSenderAdmin) {
                    api.sendMessage("⛔️ Bạn không có quyền!", thread);
                    return;
                }

                const botIsAdmin = await isBotAdmin(api, thread);
                if (!botIsAdmin) {
                    api.sendMessage("🤖 Bot cần được thêm làm admin!", thread);
                    return;
                }

                if (!event.mentions || Object.keys(event.mentions).length === 0) {
                    api.sendMessage("⚠️ Cần tag người cần ban. Ví dụ: /ban @tên", thread);
                    return;
                }

                const targetId = Object.keys(event.mentions)[0];
                const isTargetAdmin = await isAdmin(api, thread, targetId);
                
                if (isTargetAdmin) {
                    api.sendMessage("❌ Không thể ban admin khác!", thread);
                    return;
                }

                await delay(randomDelay());
                api.banUser(targetId, thread)
                    .then(() => {
                        api.sendMessage("✅ Đã ban thành viên khỏi nhóm.", thread);
                    })
                    .catch((error) => {
                        console.error("Lỗi ban:", error);
                        api.sendMessage(`❌ Lỗi: ${error.message}`, thread);
                    });
            }

            // ====== MEMBERS ======
            if (msg === "/members" || msg === "/thanhvien") {
                await delay(randomDelay());
                try {
                    const threadInfo = await api.getThreadInfo(thread);
                    api.sendMessage(
                        `👥 THÔNG TIN NHÓM\n` +
                        `👤 Số thành viên: ${threadInfo.participantIDs.length}\n` +
                        `👑 Số admin: ${threadInfo.adminIDs.length}`,
                        thread
                    );
                } catch (error) {
                    api.sendMessage("❌ Không thể lấy thông tin nhóm.", thread);
                }
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
                } catch (error) {
                    api.sendMessage("❌ Không thể lấy thông tin.", thread);
                }
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
                    "🤖 Bot tự động trả lời các câu chào hỏi, cảm ơn...\n" +
                    "🎉 Bot tự động chào mừng thành viên mới!",
                    thread
                );
            }
        });
    });
}

main();
