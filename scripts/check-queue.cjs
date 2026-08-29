// 临时脚本：查看 pending_events 状态分布与落库情况
const db = require("better-sqlite3")("memory-root/memory.db", { readonly: true });
console.log("status 分布:", db.prepare("SELECT status, COUNT(*) n FROM pending_events GROUP BY status").all());
console.log("memories:", db.prepare("SELECT COUNT(*) n FROM memories").get());
const review = db.prepare("SELECT eventId FROM pending_events WHERE status='review' LIMIT 2").all();
console.log("review 样例:", review);
const fail = db.prepare("SELECT COUNT(*) n FROM pending_events WHERE status='failed'").get();
console.log("failed:", fail);
db.close();
