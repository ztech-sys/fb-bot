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

// ====== CODE BOT ======
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// ====== BIẾN TOÀN CỤ ======
const messageCount = {}; // Lưu số tin nhắn của từng user
const userCooldown = {}; // Chống spam lệnh

// ====== HÀM HỖ TRỢ ======
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

// ====== HÀM AI REPLY ======
function getAIResponse(message) {
    const msg = message.toLowerCase();
    
    // ====== TỪ KHÓA ======
    const responses = {
        // Chào hỏi
        "hello": "Xin chào! Tôi là bot, có thể giúp gì cho bạn? 😊",
        "hi": "Chào bạn! Chúc bạn một ngày tốt lành! 🌟",
        "xin chào": "Chào bạn yêu quý! ❤️",
        "chào": "Chào bạn! Có cần tôi giúp gì không? 🤖",
        
        // Cảm ơn
        "cảm ơn": "Không có gì đâu bạn! Rất vui được giúp bạn! 🥰",
        "thanks": "You're welcome! 😊",
        "thank": "My pleasure! 🤗",
        
        // Hỏi thăm
        "bot ơi": "Tôi đây! Có chuyện gì thế? 🤖",
        "ơi bot": "Có tôi đây! Bạn cần gì? 😊",
        "có ai không": "Có tôi đây ạ! Đang nghe bạn nè! 👋",
        
        // Hỏi về bot
        "mày là ai": "Tôi là bot tự động, được tạo ra để giúp quản lý nhóm! 🤖",
        "bạn là ai": "Tôi là trợ lý ảo trong nhóm này! 😊",
        "bot là gì": "Tôi là một con bot Facebook, được lập trình để hỗ trợ quản lý nhóm!",
        
        // Hỏi về tính năng
        "làm gì": "Tôi có thể giúp bạn: ping, kick, ban, xem members, xem info... Gõ /help để xem chi tiết! 📋",
        "giúp gì": "Tôi hỗ trợ nhiều lệnh lắm! Gõ /help để xem danh sách nhé! 😊",
        
        // Vui vẻ
        "haha": "Có gì vui mà cười thế? Share đi! 😄",
        "cười": "Được rồi, tôi cười cùng bạn: Hahaha! 😂",
        "chán": "Đừng chán! Có tôi ở đây này! Hãy thử gõ /help xem có gì thú vị nhé! 🎮",
        "buồn": "Ôi, bạn buồn à? Để tôi làm gì đó vui vẻ nhé! 😊",
        
        // Thời gian
        "mấy giờ": `🕐 Bây giờ là: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
        "thời gian": `📅 Hôm nay là: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
        
        // Hỏi về tôi
        "tên bạn là gì": "Tôi là bot của nhóm này! Bạn có thể gọi tôi là BOT 😊",
        "tên gì": "Tên tôi là Bot! Bạn có thể gọi tôi là BOT nhé 🤖",
        
        // Tạm biệt
        "tạm biệt": "Tạm biệt bạn! Hẹn gặp lại nhé! 👋",
        "bye": "Bye bye! Chúc bạn vui vẻ! 😊",
        "goodbye": "Goodbye! Have a nice day! 🌟"
    };
    
    // Kiểm tra từ khóa
    for (const [key, reply] of Object.entries(responses)) {
        if (msg.includes(key)) {
            return reply;
        }
    }
    
    // Nếu không có từ khóa nào khớp
    return null;
}

// ====== HÀM KIỂM TRA ADMIN ======
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
        autoMarkRead: true,
        autoReconnect: true,
        simulateTyping: true
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

            // ====== 1. WELCOME ======
            if (event.type === "event" && event.logMessageType === "log:subscribe") {
                const newMembers = event.logMessageData.addedParticipants || [];
                for (const member of newMembers) {
                    const name = member.fullName || "thành viên mới";
                    const message = `🎉 Chào mừng ${name} đã tham gia nhóm!\n\n👋 Hãy giới thiệu bản thân và tuân thủ nội quy nhé!\n📋 Gõ /help để xem các lệnh của bot.`;
                    api.sendMessage(message, event.threadID);
                    console.log(`👋 Đã chào mừng ${name} vào nhóm ${event.threadID}`);
                }
                return;
            }

            if (event.type !== "message" || !event.body || !event.isGroup) return;

            const msg = event.body.toLowerCase();
            const sender = event.senderID;
            const thread = event.threadID;

            // ====== ĐẾM TIN NHẮN ======
            messageCount[sender] = (messageCount[sender] || 0) + 1;

            // Chống spam lệnh
            if (userCooldown[sender] && Date.now() - userCooldown[sender] < 2000) {
                return;
            }
            userCooldown[sender] = Date.now();

            const isSenderAdmin = await isAdmin(api, thread, sender);

            // ====== 2. INFO ======
            if (msg.startsWith("/info")) {
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
                        `💬 Số tin nhắn: ${userCount}\n` +
                        `📅 Gia nhập: ${new Date().toLocaleDateString('vi-VN')}`,
                        thread
                    );
                } catch (error) {
                    console.error("Lỗi /info:", error);
                    api.sendMessage("❌ Không thể lấy thông tin.", thread);
                }
            }

            // ====== 3. STATS (Đếm tin nhắn) ======
            if (msg === "/stats" || msg === "/thống kê") {
                const count = messageCount[sender] || 0;
                const totalUsers = Object.keys(messageCount).length;
                const totalMessages = Object.values(messageCount).reduce((a, b) => a + b, 0);
                
                api.sendMessage(
                    `📊 THỐNG KÊ CÁ NHÂN\n` +
                    `💬 Số tin nhắn của bạn: ${count}\n` +
                    `👥 Tổng người dùng: ${totalUsers}\n` +
                    `📨 Tổng tin nhắn: ${totalMessages}`,
                    thread
                );
            }

            // ====== 4. AI REPLY ======
            // Kiểm tra reply (không chạy với lệnh bắt đầu bằng /)
            if (!msg.startsWith("/")) {
                const aiReply = getAIResponse(msg);
                if (aiReply) {
                    // Delay nhẹ để không bị spam
                    setTimeout(() => {
                        api.sendMessage(aiReply, thread);
                    }, 1000);
                }
            }

            // ====== CÁC LỆNH CŨ ======

            // Ping
            if (msg === "/ping") {
                api.sendMessage("🏓 pong!", thread);
            }

            // Kick
            if (msg.startsWith("/kick")) {
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

                api.removeUserFromGroup(targetId, thread)
                    .then(() => {
                        api.sendMessage("✅ Đã đuổi thành viên khỏi nhóm.", thread);
                    })
                    .catch((error) => {
                        console.error("Lỗi kick:", error);
                        api.sendMessage(`❌ Lỗi: ${error.message}`, thread);
                    });
            }

            // Ban
            if (msg.startsWith("/ban")) {
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

                api.banUser(targetId, thread)
                    .then(() => {
                        api.sendMessage("✅ Đã ban thành viên khỏi nhóm.", thread);
                    })
                    .catch((error) => {
                        console.error("Lỗi ban:", error);
                        api.sendMessage(`❌ Lỗi: ${error.message}`, thread);
                    });
            }

            // Members
            if (msg === "/members" || msg === "/thanhvien") {
                try {
                    const threadInfo = await api.getThreadInfo(thread);
                    const memberCount = threadInfo.participantIDs.length;
                    const adminCount = threadInfo.adminIDs.length;
                    const groupName = threadInfo.name || "Không có tên";
                    
                    api.sendMessage(
                        `👥 THÔNG TIN NHÓM\n` +
                        `📝 Tên: ${groupName}\n` +
                        `👤 Số thành viên: ${memberCount}\n` +
                        `👑 Số admin: ${adminCount}\n` +
                        `🆔 ID nhóm: ${thread}`,
                        thread
                    );
                } catch (error) {
                    console.error("Lỗi members:", error);
                    api.sendMessage("❌ Không thể lấy thông tin nhóm.", thread);
                }
            }

            // Help
            if (msg === "/help") {
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
                    "🚫 Bot tự động kick thành viên khi phát hiện từ ngữ vi phạm.",
                    thread
                );
            }

            // Spam detection
            const spamKeywords = ["kick bố m đi", "noledaden", "matuy", "địt mẹ", "fuck you", "fuck off", "đm", "địt", "fuck", "fuck u", "fuck ur mom", "fuck your mom", "fuck your mother", "fuck ur mother", "fuck your dad", "fuck ur dad", "fuck your father", "fuck ur father", "fuck your family", "fuck ur family", "fuck your sister", "fuck ur sister", "fuck your brother", "fuck ur brother", "fuck your cousin", "fuck ur cousin", "fuck your uncle", "fuck ur uncle", "fuck your aunt", "fuck ur aunt", "fuck your grandma", "fuck ur grandma", "fuck your grandpa", "fuck ur grandpa", "fuck your niece", "fuck ur niece", "fuck your nephew", "fuck ur nephew","con mẹ mày", "con mẹ m", "con mẹ m địt", "con mẹ m địt cmnr", "con mẹ m địt cmn", "con mẹ m địt cmnr", "con mẹ m địt cmn", "địt con mẹ mày", "địt con mẹ m", "địt con mẹ m địt", "địt con mẹ m địt cmnr", "địt con mẹ m địt cmn", "địt con mẹ m địt cmnr", "địt con mẹ m địt cmn","t địt chết mẹ mày", "t địt chết mẹ m", "t địt chết mẹ m địt", "t địt chết mẹ m địt cmnr", "t địt chết mẹ m địt cmn", "t địt chết mẹ m địt cmnr", "t địt chết mẹ m địt cmn","ăn bố mày đi","ăn cái con cụ mày đi","ăn cái con cụ mày đi","ăn cái con cụ mày đi cmnr","ăn cái con cụ mày đi cmn","ăn cái con cụ mày đi cmnr","ăn cái con cụ mày đi cmn","địt tổ m ccho rách"];
            const isSpam = spamKeywords.some(keyword => msg.includes(keyword));

            if (isSpam) {
                const isSenderAdmin = await isAdmin(api, thread, sender);
                if (!isSenderAdmin) {
                    const botIsAdmin = await isBotAdmin(api, thread);
                    if (!botIsAdmin) {
                        api.sendMessage("🤖 Bot cần được thêm làm admin để xử lý spam!", thread);
                    } else {
                        api.sendMessage("🚫 Phát hiện spam! Bot đang xử lý...", thread);
                        api.removeUserFromGroup(sender, thread)
                            .then(() => {
                                api.sendMessage("✅ Đã đuổi thành viên spam khỏi nhóm.", thread);
                            })
                            .catch((error) => {
                                console.log("⚠️ Không thể đuổi người spam:", error);
                            });
                    }
                } else {
                    api.sendMessage("⚠️ Admin spam! Bot không thể kick admin.", thread);
                }
            }
        });
    });
}

main();
