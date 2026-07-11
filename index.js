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
        api.listenMqtt((err, event) => {
            if (err) return console.error("❌ Lỗi lắng nghe:", err);

            if (event.type !== "message" || !event.body || !event.isGroup) return;

            const msg = event.body.toLowerCase();
            const sender = event.senderID;
            const thread = event.threadID;

            // ====== LỆNH QUẢN TRỊ ======

            // 1. Ping
            if (msg === "/ping") {
                api.sendMessage("🏓 pong!", thread);
            }

            // 2. Kick
            if (msg.startsWith("/kick")) {
                if (event.mentions) {
                    const targetId = Object.keys(event.mentions)[0];
                    if (targetId) {
                        api.removeUserFromGroup(targetId, thread)
                            .then(() => api.sendMessage(`✅ Đã đuổi thành viên khỏi nhóm.`, thread))
                            .catch(() => api.sendMessage("❌ Không thể đuổi (có thể user là admin).", thread));
                    }
                } else {
                    api.sendMessage("⚠️ Cần tag người cần kick. Ví dụ: /kick @tên", thread);
                }
            }

            // 3. Ban
            if (msg.startsWith("/ban")) {
                if (event.mentions) {
                    const targetId = Object.keys(event.mentions)[0];
                    if (targetId) {
                        api.banUser(targetId, thread)
                            .then(() => api.sendMessage(`✅ Đã ban thành viên khỏi nhóm.`, thread))
                            .catch(() => api.sendMessage("❌ Không thể ban thành viên này.", thread));
                    }
                } else {
                    api.sendMessage("⚠️ Cần tag người cần ban. Ví dụ: /ban @tên", thread);
                }
            }

            // 4. Tự động phát hiện spam
            const spamKeywords = ["trúng thưởng", "kiếm tiền online", "link độc hại", "crypto", "bitcoin", "nạp tiền", "đầu tư"];
            const isSpam = spamKeywords.some(keyword => msg.includes(keyword));

            if (isSpam) {
                api.sendMessage("🚫 Phát hiện spam! Bot đang xử lý...", thread);
                api.removeUserFromGroup(sender, thread)
                    .then(() => api.sendMessage(`✅ Đã đuổi thành viên spam khỏi nhóm.`, thread))
                    .catch(() => console.log("⚠️ Không thể đuổi người spam"));
            }

            // 5. Help
            if (msg === "/help") {
                api.sendMessage(
                    "📋 DANH SÁCH LỆNH:\n" +
                    "/ping - Kiểm tra bot còn sống\n" +
                    "/kick @tên - Đuổi thành viên\n" +
                    "/ban @tên - Cấm thành viên\n" +
                    "/help - Hiển thị trợ giúp\n\n" +
                    "🤖 Bot tự động kick spam từ: " + spamKeywords.join(", "),
                    thread
                );
            }
        });
    });
}

main();