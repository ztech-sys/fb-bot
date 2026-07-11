const fs = require("fs");
const { login } = require("dhoner-fca");

let appState = null;
try {
    appState = JSON.parse(fs.readFileSync("appstate.json", "utf8"));
    console.log("✅ Đã tìm thấy file appstate.json, tiến hành đăng nhập...");
} catch (e) {
    console.error("❌ Không tìm thấy file appstate.json!");
    console.log("💡 Hãy tạo file appstate.json bằng cách export cookie từ trình duyệt.");
    process.exit(1);
}

const loginOptions = {
    online: true,
    listenEvents: true,
    autoMarkRead: true,
    autoReconnect: true,
    simulateTyping: true
};

function isAdmin(api, threadID, userID) {
    return new Promise((resolve) => {
        api.getThreadInfo(threadID, (err, info) => {
            if (err) return resolve(false);
            const admins = info.adminIDs.map(id => id.toString());
            resolve(admins.includes(userID.toString()));
        });
    });
}

function getUserInfo(api, userID) {
    return new Promise((resolve) => {
        api.getUserInfo(userID, (err, info) => {
            if (err) return resolve(null);
            resolve(info[userID]);
        });
    });
}

login({ appState }, loginOptions, (err, api) => {
    if (err) {
        console.error("❌ Lỗi đăng nhập:", err);
        return;
    }

    console.log("✅ Đăng nhập thành công! User ID:", api.getCurrentUserID());

    api.listenMqtt(async (err, event) => {
        if (err) return console.error("❌ Lỗi lắng nghe:", err);

        // ==== AUTO WELCOME ====
        if (event.type === "event" && event.logMessageType === "log:subscribe") {
            const threadID = event.threadID;
            for (const addedUser of event.logMessageData.addedParticipants) {
                const userInfo = await getUserInfo(api, addedUser.userFbId);
                const name = userInfo ? userInfo.name : "Thành viên mới";
                api.sendMessage(`👋 Chào mừng ${name} vào group!`, threadID);
            }
            return;
        }

        // ==== THÔNG BÁO THÀNH VIÊN RA ====
        if (event.type === "event" && event.logMessageType === "log:unsubscribe") {
            const threadID = event.threadID;
            const leftUser = event.logMessageData.leftParticipantFbId;
            if (leftUser) {
                const userInfo = await getUserInfo(api, leftUser);
                const name = userInfo ? userInfo.name : "Thành viên";
                api.sendMessage(`👋 ${name} đã rời group.`, threadID);
            }
            return;
        }

        if (event.type !== "message" || !event.body || !event.isGroup) return;

        const msg = event.body.toLowerCase();
        const sender = event.senderID;
        const thread = event.threadID;

        // ====== LỆNH KHÔNG CẦN ADMIN ======

        if (msg === "/ping") {
            api.sendMessage("🏓 pong!", thread);
            return;
        }

        if (msg === "/help") {
            api.sendMessage(
                "📋 DANH SÁCH LỆNH:\n" +
                "🔹 /ping - Kiểm tra bot\n" +
                "🔹 /help - Hiển thị trợ giúp\n" +
                "🔹 /info @tên - Xem thông tin user\n" +
                "🔹 /stick - Gửi sticker ngẫu nhiên\n" +
                "🔹 /members - Số thành viên (admin)\n" +
                "🔹 /kick @tên - Đuổi thành viên (admin)\n" +
                "🔹 /ban @tên - Cấm thành viên (admin)\n" +
                "🔹 /mute @tên - Cấm nói (admin)\n" +
                "🔹 /unmute @tên - Mở nói (admin)\n" +
                "🔹 /addadmin @tên - Thêm admin (admin)\n" +
                "🔹 /rmadmin @tên - Gỡ admin (admin)",
                thread
            );
            return;
        }

        if (msg.startsWith("/info") && event.mentions) {
            const targetId = Object.keys(event.mentions)[0];
            if (targetId) {
                const info = await getUserInfo(api, targetId);
                if (info) {
                    api.sendMessage(
                        "📌 THÔNG TIN USER:\n" +
                        `👤 Tên: ${info.name || "Không có"}\n` +
                        `🆔 ID: ${targetId}`,
                        thread
                    );
                } else {
                    api.sendMessage("❌ Không tìm thấy thông tin.", thread);
                }
            } else {
                api.sendMessage("⚠️ Cần tag người cần xem info. Ví dụ: /info @tên", thread);
            }
            return;
        }

        if (msg === "/stick") {
            const stickers = ["369239263222822", "369239263222822", "369239263222822"];
            const randomStick = stickers[Math.floor(Math.random() * stickers.length)];
            api.sendMessage({ sticker: randomStick }, thread);
            return;
        }

        // ====== KIỂM TRA ADMIN ======
        const isSenderAdmin = await isAdmin(api, thread, sender);
        if (!isSenderAdmin) {
            api.sendMessage("❌ Lệnh này chỉ dành cho Admin group!", thread);
            return;
        }

        if (msg.startsWith("/kick")) {
            if (event.mentions) {
                const targetId = Object.keys(event.mentions)[0];
                if (targetId) {
                    api.removeUserFromGroup(targetId, thread)
                        .then(() => api.sendMessage(`✅ Đã đuổi thành viên khỏi nhóm.`, thread))
                        .catch(() => api.sendMessage("❌ Không thể đuổi.", thread));
                }
            } else {
                api.sendMessage("⚠️ /kick @tên", thread);
            }
            return;
        }

        if (msg.startsWith("/ban")) {
            if (event.mentions) {
                const targetId = Object.keys(event.mentions)[0];
                if (targetId) {
                    api.banUser(targetId, thread)
                        .then(() => api.sendMessage(`✅ Đã ban thành viên khỏi nhóm.`, thread))
                        .catch(() => api.sendMessage("❌ Không thể ban.", thread));
                }
            } else {
                api.sendMessage("⚠️ /ban @tên", thread);
            }
            return;
        }

        // ====== MUTE / UNMUTE ======
        if (msg.startsWith("/mute") && event.mentions) {
            const targetId = Object.keys(event.mentions)[0];
            if (targetId) {
                api.changeAdminStatus(thread, targetId, false)
                    .then(() => {
                        api.sendMessage(`🔇 Đã mute thành viên.`, thread);
                        api.unsendMessage(event.messageID);
                    })
                    .catch(() => api.sendMessage("❌ Không thể mute.", thread));
            } else {
                api.sendMessage("⚠️ /mute @tên", thread);
            }
            return;
        }

        if (msg.startsWith("/unmute") && event.mentions) {
            const targetId = Object.keys(event.mentions)[0];
            if (targetId) {
                api.changeAdminStatus(thread, targetId, true)
                    .then(() => {
                        api.sendMessage(`🔊 Đã mở nói cho thành viên.`, thread);
                        api.unsendMessage(event.messageID);
                    })
                    .catch(() => api.sendMessage("❌ Không thể unmute.", thread));
            } else {
                api.sendMessage("⚠️ /unmute @tên", thread);
            }
            return;
        }

        if (msg.startsWith("/addadmin") && event.mentions) {
            const targetId = Object.keys(event.mentions)[0];
            if (targetId) {
                api.changeAdminStatus(thread, targetId, true)
                    .then(() => api.sendMessage(`✅ Đã thêm admin.`, thread))
                    .catch(() => api.sendMessage("❌ Không thể thêm admin.", thread));
            } else {
                api.sendMessage("⚠️ /addadmin @tên", thread);
            }
            return;
        }

        if (msg.startsWith("/rmadmin") && event.mentions) {
            const targetId = Object.keys(event.mentions)[0];
            if (targetId) {
                api.changeAdminStatus(thread, targetId, false)
                    .then(() => api.sendMessage(`✅ Đã gỡ admin.`, thread))
                    .catch(() => api.sendMessage("❌ Không thể gỡ admin.", thread));
            } else {
                api.sendMessage("⚠️ /rmadmin @tên", thread);
            }
            return;
        }

        if (msg === "/members") {
            api.getThreadInfo(thread, (err, info) => {
                if (err) return api.sendMessage("❌ Lỗi", thread);
                api.sendMessage(`👥 Số thành viên: ${info.participantIDs.length}`, thread);
            });
            return;
        }
    });
});
