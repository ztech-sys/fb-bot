const fs = require("fs");
const readline = require("readline");
const { login } = require("dhoner-fca");

// Tạo interface để nhập từ bàn phím
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Hàm hỏi người dùng nhập email và password
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

// Hàm kiểm tra admin có log chi tiết
async function isAdmin(api, threadID, userID) {
    try {
        const threadInfo = await api.getThreadInfo(threadID);
        const result = threadInfo.adminIDs.some(admin => admin.id === userID);
        return result;
    } catch (error) {
        console.error("❌ Lỗi kiểm tra admin:", error);
        return false;
    }
}

// Hàm kiểm tra bot có phải admin không
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

async function main() {
    // Kiểm tra xem đã có session chưa
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

    // Nếu có session thì dùng session, nếu không thì hỏi email/password
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
            console.log("💡 Thử kiểm tra lại email/mật khẩu hoặc xóa file appstate.json và chạy lại.");
            return;
        }

        console.log("✅ Đăng nhập thành công! User ID:", api.getCurrentUserID());

        // Lưu session cho lần sau
        fs.writeFileSync("appstate.json", JSON.stringify(api.getAppState()));
        console.log("📁 Đã lưu session vào appstate.json");

        // Lắng nghe tin nhắn
        api.listenMqtt(async (err, event) => {
            if (err) return console.error("❌ Lỗi lắng nghe:", err);

            if (event.type !== "message" || !event.body || !event.isGroup) return;

            const msg = event.body.toLowerCase();
            const sender = event.senderID;
            const thread = event.threadID;

            // Kiểm tra admin cho các lệnh yêu cầu quyền admin
            const isSenderAdmin = await isAdmin(api, thread, sender);

            // ====== LỆNH QUẢN TRỊ ======

            // 1. Ping - ai cũng dùng được
            if (msg === "/ping") {
                api.sendMessage("🏓 pong!", thread);
            }

            // 2. Kick - chỉ admin mới được dùng
            if (msg.startsWith("/kick")) {
                console.log(`📨 Nhận lệnh /kick từ ${sender} trong nhóm ${thread}`);
                
                if (!isSenderAdmin) {
                    console.log("❌ Người gửi không phải admin");
                    api.sendMessage("⛔️ Bạn không có quyền sử dụng lệnh này! Chỉ admin mới có thể kick thành viên.", thread);
                    return;
                }

                // Kiểm tra bot có phải admin không
                const botIsAdmin = await isBotAdmin(api, thread);
                console.log(`🤖 Bot admin status: ${botIsAdmin}`);
                
                if (!botIsAdmin) {
                    api.sendMessage("🤖 Bot cần được thêm làm admin để kick thành viên! Vui lòng thêm bot làm admin.", thread);
                    return;
                }

                // Kiểm tra có tag người không
                if (!event.mentions || Object.keys(event.mentions).length === 0) {
                    api.sendMessage("⚠️ Cần tag người cần kick. Ví dụ: /kick @tên", thread);
                    return;
                }

                const targetId = Object.keys(event.mentions)[0];
                console.log(`🎯 Target ID: ${targetId}`);
                
                // Kiểm tra target có phải admin không
                const isTargetAdmin = await isAdmin(api, thread, targetId);
                console.log(`👑 Target admin status: ${isTargetAdmin}`);
                
                if (isTargetAdmin) {
                    api.sendMessage("❌ Không thể kick admin khác!", thread);
                    return;
                }

                // Thực hiện kick
                console.log(`🚀 Đang kick user ${targetId}`);
                api.removeUserFromGroup(targetId, thread)
                    .then(() => {
                        console.log(`✅ Đã kick thành công ${targetId}`);
                        api.sendMessage(`✅ Đã đuổi thành viên khỏi nhóm.`, thread);
                    })
                    .catch((error) => {
                        console.error(`❌ Lỗi kick:`, error);
                        api.sendMessage(`❌ Không thể đuổi. Lỗi: ${error.message || error}`, thread);
                    });
            }

            // 3. Ban - chỉ admin mới được dùng
            if (msg.startsWith("/ban")) {
                if (!isSenderAdmin) {
                    api.sendMessage("⛔️ Bạn không có quyền sử dụng lệnh này! Chỉ admin mới có thể ban thành viên.", thread);
                    return;
                }

                // Kiểm tra bot có phải admin không
                const botIsAdmin = await isBotAdmin(api, thread);
                if (!botIsAdmin) {
                    api.sendMessage("🤖 Bot cần được thêm làm admin để ban thành viên!", thread);
                    return;
                }

                if (!event.mentions || Object.keys(event.mentions).length === 0) {
                    api.sendMessage("⚠️ Cần tag người cần ban. Ví dụ: /ban @tên", thread);
                    return;
                }

                const targetId = Object.keys(event.mentions)[0];
                
                // Kiểm tra target có phải admin không
                const isTargetAdmin = await isAdmin(api, thread, targetId);
                if (isTargetAdmin) {
                    api.sendMessage("❌ Không thể ban admin khác!", thread);
                    return;
                }

                api.banUser(targetId, thread)
                    .then(() => {
                        api.sendMessage(`✅ Đã ban thành viên khỏi nhóm.`, thread);
                    })
                    .catch((error) => {
                        console.error("Lỗi ban:", error);
                        api.sendMessage(`❌ Không thể ban. Lỗi: ${error.message || error}`, thread);
                    });
            }

            // 4. Tự động phát hiện spam - chỉ kick nếu spammer không phải admin
            const spamKeywords = ["kick bố m đi", "noledaden", "matuy" , "địt mẹ", "fuck you", "fuck off", "đm", "địt", "fuck", "fuck u", "fuck ur mom", "fuck your mom", "fuck your mother", "fuck ur mother", "fuck your dad", "fuck ur dad", "fuck your father", "fuck ur father", "fuck your family", "fuck ur family", "fuck your sister", "fuck ur sister", "fuck your brother", "fuck ur brother", "fuck your cousin", "fuck ur cousin", "fuck your uncle", "fuck ur uncle", "fuck your aunt", "fuck ur aunt", "fuck your grandma", "fuck ur grandma", "fuck your grandpa", "fuck ur grandpa", "fuck your niece", "fuck ur niece", "fuck your nephew", "fuck ur nephew","con mẹ mày", "con mẹ m", "con mẹ m địt", "con mẹ m địt cmnr", "con mẹ m địt cmn", "con mẹ m địt cmnr", "con mẹ m địt cmn", "địt con mẹ mày", "địt con mẹ m", "địt con mẹ m địt", "địt con mẹ m địt cmnr", "địt con mẹ m địt cmn", "địt con mẹ m địt cmnr", "địt con mẹ m địt cmn","t địt chết mẹ mày", "t địt chết mẹ m", "t địt chết mẹ m địt", "t địt chết mẹ m địt cmnr", "t địt chết mẹ m địt cmn", "t địt chết mẹ m địt cmnr", "t địt chết mẹ m địt cmn","ăn bố mày đi","ăn cái con cụ mày đi","ăn cái con cụ mày đi","ăn cái con cụ mày đi cmnr","ăn cái con cụ mày đi cmn","ăn cái con cụ mày đi cmnr","ăn cái con cụ mày đi cmn","địt tổ m ccho rách"];
            const isSpam = spamKeywords.some(keyword => msg.includes(keyword));

            if (isSpam) {
                // Kiểm tra người gửi spam có phải admin không
                const isSenderAdmin = await isAdmin(api, thread, sender);
                if (!isSenderAdmin) {
                    // Kiểm tra bot có phải admin không
                    const botIsAdmin = await isBotAdmin(api, thread);
                    if (!botIsAdmin) {
                        api.sendMessage("🤖 Bot cần được thêm làm admin để xử lý spam!", thread);
                    } else {
                        api.sendMessage("🚫 Phát hiện spam! Bot đang xử lý...", thread);
                        api.removeUserFromGroup(sender, thread)
                            .then(() => {
                                api.sendMessage(`✅ Đã đuổi thành viên spam khỏi nhóm.`, thread);
                            })
                            .catch((error) => {
                                console.log("⚠️ Không thể đuổi người spam:", error);
                            });
                    }
                } else {
                    api.sendMessage("⚠️ Admin spam! Bot không thể kick admin.", thread);
                }
            }

          // 5. Help - ai cũng xem được
if (msg === "/help") {
    api.sendMessage(
        "📋 DANH SÁCH LỆNH:\n" +
        "/ping - Kiểm tra bot còn sống\n" +
        "/kick @tên - Đuổi thành viên (Chỉ admin)\n" +
        "/ban @tên - Cấm thành viên (Chỉ admin)\n" +
        "/members - Xem số lượng thành viên trong nhóm\n" +
        "/help - Hiển thị trợ giúp\n\n" +
        "🤖 Bot tự động kick thành viên khi phát hiện từ ngữ vi phạm.",
        thread
    );
}
            // 6. Kiểm tra số lượng thành viên - ai cũng xem được
            if (msg === "/members" || msg === "/thanhvien") {
                try {
                    const threadInfo = await api.getThreadInfo(thread);
                    const memberCount = threadInfo.participantIDs.length;
                    const adminCount = threadInfo.adminIDs.length;
                    const groupName = threadInfo.name || "Không có tên";
                    
                    api.sendMessage(
                        `👥 THÔNG TIN NHÓM\n` +
                        `📝 Tên nhóm: ${groupName}\n` +
                        `👤 Số thành viên: ${memberCount}\n` +
                        `👑 Số admin: ${adminCount}\n` +
                        `🆔 ID nhóm: ${thread}`,
                        thread
                    );
                } catch (error) {
                    console.error("❌ Lỗi lấy thông tin nhóm:", error);
                    api.sendMessage("❌ Không thể lấy thông tin nhóm.", thread);
                }
            }
        });
    });
}

main();
