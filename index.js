const fs = require("fs");
const { login } = require("dhoner-fca");

let appState = null;
try {
    appState = JSON.parse(fs.readFileSync("appstate.json", "utf8"));
    console.log("✅ Đã tìm thấy file appstate.json");
} catch (e) {
    console.error("❌ Không tìm thấy file appstate.json!");
    process.exit(1);
}

const loginOptions = {
    online: true,
    listenEvents: true,
    autoMarkRead: true,
    autoReconnect: true,
    simulateTyping: true
};

login({ appState }, loginOptions, (err, api) => {
    if (err) {
        console.error("❌ Lỗi đăng nhập:", err);
        return;
    }

    console.log("✅ Đăng nhập thành công! User ID:", api.getCurrentUserID());

    // ====== DANH SÁCH ADMIN BOT (HARDCODE) ======
    const BOT_ADMINS = ["61590576006177"]; // Thay ID của mày vào đây

    api.listenMqtt(async (err, event) => {
        if (err) return console.error("❌ Lỗi lắng nghe:", err);

        if (event.type !== "message" || !event.body || !event.isGroup) return;

        const msg = event.body.toLowerCase();
        const sender = event.senderID;
        const thread = event.threadID;

        // ====== LỆNH PING (ai cũng dùng được) ======
        if (msg === "/ping") {
            api.sendMessage("🏓 pong!", thread);
            return;
        }

        // ====== HELP (ai cũng dùng được) ======
        if (msg === "/help") {
            api.sendMessage(
                "📋 DANH SÁCH LỆNH:\n" +
                "🔹 /ping - Kiểm tra bot\n" +
                "🔹 /help - Hiển thị trợ giúp\n" +
                "🔹 /members - Số thành viên (admin)\n" +
                "🔹 /kick [ID] - Đuổi thành viên (admin)\n" +
                "🔹 /ban [ID] - Cấm thành viên (admin)\n" +
                "🔹 /mute [ID] - Cấm nói (admin)\n" +
                "🔹 /unmute [ID] - Mở nói (admin)\n" +
                "🔹 /addadmin [ID] - Thêm admin (admin)\n" +
                "🔹 /rmadmin [ID] - Gỡ admin (admin)",
                thread
            );
            return;
        }

        // ====== KIỂM TRA ADMIN ======
        if (!BOT_ADMINS.includes(sender.toString())) {
            api.sendMessage("❌ Lệnh này chỉ dành cho Admin bot!", thread);
            return;
        }

        // ====== LỆNH ADMIN ======
        if (msg === "/members") {
            api.getThreadInfo(thread, (err, info) => {
                if (err) return api.sendMessage("❌ Lỗi lấy thông tin group", thread);
                api.sendMessage(`👥 Số thành viên: ${info.participantIDs.length}`, thread);
            });
            return;
        }

        if (msg.startsWith("/kick ")) {
            const target = msg.replace("/kick ", "").trim();
            if (!target) return api.sendMessage("⚠️ /kick [ID]", thread);
            api.removeUserFromGroup(target, thread)
                .then(() => api.sendMessage(`✅ Đã đuổi thành viên.`, thread))
                .catch(() => api.sendMessage("❌ Không thể đuổi. (Bot cần quyền admin group)", thread));
            return;
        }

        if (msg.startsWith("/ban ")) {
            const target = msg.replace("/ban ", "").trim();
            if (!target) return api.sendMessage("⚠️ /ban [ID]", thread);
            api.banUser(target, thread)
                .then(() => api.sendMessage(`✅ Đã ban thành viên.`, thread))
                .catch(() => api.sendMessage("❌ Không thể ban.", thread));
            return;
        }

        if (msg.startsWith("/mute ")) {
            const target = msg.replace("/mute ", "").trim();
            if (!target) return api.sendMessage("⚠️ /mute [ID]", thread);
            api.changeAdminStatus(thread, target, false)
                .then(() => api.sendMessage(`🔇 Đã mute thành viên.`, thread))
                .catch(() => api.sendMessage("❌ Không thể mute. (Bot cần quyền admin)", thread));
            return;
        }

        if (msg.startsWith("/unmute ")) {
            const target = msg.replace("/unmute ", "").trim();
            if (!target) return api.sendMessage("⚠️ /unmute [ID]", thread);
            api.changeAdminStatus(thread, target, true)
                .then(() => api.sendMessage(`🔊 Đã mở nói.`, thread))
                .catch(() => api.sendMessage("❌ Không thể unmute.", thread));
            return;
        }

        if (msg.startsWith("/addadmin ")) {
            const target = msg.replace("/addadmin ", "").trim();
            if (!target) return api.sendMessage("⚠️ /addadmin [ID]", thread);
            api.changeAdminStatus(thread, target, true)
                .then(() => api.sendMessage(`✅ Đã thêm admin.`, thread))
                .catch(() => api.sendMessage("❌ Không thể thêm admin.", thread));
            return;
        }

        if (msg.startsWith("/rmadmin ")) {
            const target = msg.replace("/rmadmin ", "").trim();
            if (!target) return api.sendMessage("⚠️ /rmadmin [ID]", thread);
            api.changeAdminStatus(thread, target, false)
                .then(() => api.sendMessage(`✅ Đã gỡ admin.`, thread))
                .catch(() => api.sendMessage("❌ Không thể gỡ admin.", thread));
            return;
        }
    });
});
