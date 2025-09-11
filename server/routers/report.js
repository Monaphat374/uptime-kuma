// server/routers/report.js
const express = require("express");
const router = express.Router();
const { R } = require("redbean-node");

/**
 * Helper: แปลง ISO string / epoch (sec|ms) หรือ Date
 * ให้เป็น MySQL DATETIME 'YYYY-MM-DD HH:mm:ss'
 * @param {(string|number|Date|null)} input - ค่าที่รับ: ISO string, epoch (วินาที/มิลลิวินาที) หรือ Date; เป็น null ได้
 * @returns {(string|null)} - สตริง DATETIME รูปแบบ 'YYYY-MM-DD HH:mm:ss' หรือ null ถ้าแปลงไม่ได้
 */
function toMySQLDateTime(input) {
    if (input == null) {
        return null;
    }
    const d = (input instanceof Date) ? input : new Date(input);
    if (isNaN(d.getTime())) {
        return null;
    }
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    const MM = pad(d.getUTCMonth() + 1);
    const dd = pad(d.getUTCDate());
    const hh = pad(d.getUTCHours());
    const mm = pad(d.getUTCMinutes());
    const ss = pad(d.getUTCSeconds());
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

/**
 * Helper (NEW): สร้างสตริงวันที่ UTC "YYYY-MM-DD"
 * @param {number} y - ปี (ค.ศ.)
 * @param {number} m - เดือน (1–12)
 * @param {number} d - วัน (1–31)
 * @returns {string} - วันที่แบบ 'YYYY-MM-DD' (UTC)
 */
function toUTCDateString(y, m, d) {
    const pad = (n) => String(n).padStart(2, "0");
    const dt = new Date(Date.UTC(y, m - 1, d)); // เที่ยงคืน UTC
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Helper (NEW): เพิ่ม/ลดวันในสตริง 'YYYY-MM-DD' แบบ UTC
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {number} days - จำนวนวัน (+/-)
 * @returns {string} - 'YYYY-MM-DD' (UTC)
 */
function addDaysUTC(dateStr, days) {
    const [ y, m, d ] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return toUTCDateString(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

router.get("/api/report", async (req, res) => {
    try {
        // รองรับ '7d' | 'lastday' | '1d'
        const range = [ "7d", "lastday", "1d" ].includes(req.query.range) ? req.query.range : "1d";
        const monitorID = req.query.monitorID ? Number(req.query.monitorID) : null;
        const minutes = range === "7d" ? 7 * 24 * 60 : 24 * 60;

        // from/to: รับ ISO/epoch/date → แปลงเป็น DATETIME (UTC)
        let from = toMySQLDateTime(req.query.from);
        let to = toMySQLDateTime(req.query.to);

        let sql;
        let params = [];

        // === รับ date + hstart + hend (ตีความเป็น UTC) ===
        const date = (req.query.date || "").trim();                               // 'YYYY-MM-DD'
        const hstart = req.query.hstart != null ? parseInt(req.query.hstart, 10) : null;  // 0..23
        const hend = req.query.hend != null ? parseInt(req.query.hend, 10) : null;  // 1..24

        // ถ้าไม่ส่ง from/to แต่ส่ง date+hstart+hend → สร้างช่วงแบบ UTC
        if (!from && !to && date && Number.isInteger(hstart) && Number.isInteger(hend)) {
            if (hstart < 0 || hstart > 23 || hend < 1 || hend > 24 || hend <= hstart) {
                return res.status(400).json({ ok: false,
                    msg: "Invalid hstart/hend" });
            }

            const pad = (n) => String(n).padStart(2, "0");

            // ช่วงแบบ half-open [from, to) : รวมเวลาเริ่ม ไม่รวมเวลาจบ (UTC)
            from = `${date} ${pad(hstart)}:00:00`;
            to = (hend === 24)
                ? `${addDaysUTC(date, 1)} 00:00:00`
                : `${date} ${pad(hend)}:00:00`;
        }

        if (from && to) {
            // โหมดกำหนดช่วงเอง (UTC)
            sql = `
                SELECT
                    hb.id,
                    m.name AS monitor_name,
                    hb.monitor_id,
                    hb.status,
                    hb.ping,
                    hb.msg,
                    hb.time AS time
                FROM heartbeat hb
                LEFT JOIN monitor m ON m.id = hb.monitor_id
                WHERE hb.time >= ? AND hb.time < ?
                ${monitorID ? "AND hb.monitor_id = ?" : ""}
                ORDER BY hb.time DESC
                LIMIT 500
            `;
            params = monitorID ? [ from, to, monitorID ] : [ from, to ];
        } else if (range === "lastday") {
            // เมื่อวานเต็มวัน (UTC): [00:00 ของเมื่อวาน, 00:00 ของวันนี้)
            sql = `
                SELECT
                    hb.id,
                    m.name AS monitor_name,
                    hb.monitor_id,
                    hb.status,
                    hb.ping,
                    hb.msg,
                    hb.time AS time
                FROM heartbeat hb
                LEFT JOIN monitor m ON m.id = hb.monitor_id
                WHERE hb.time >= DATE(UTC_TIMESTAMP()) - INTERVAL 1 DAY
                AND   hb.time <  DATE(UTC_TIMESTAMP())
                ${monitorID ? "AND hb.monitor_id = ?" : ""}
                ORDER BY hb.time DESC
                LIMIT 500
            `;
            params = monitorID ? [ monitorID ] : [];
        } else {
            // 1d/7d ถอยหลังเป็นนาที จากเวลาปัจจุบัน (UTC)
            sql = `
                SELECT
                    hb.id,
                    m.name AS monitor_name,
                    hb.monitor_id,
                    hb.status,
                    hb.ping,
                    hb.msg,
                    hb.time AS time
                FROM heartbeat hb
                LEFT JOIN monitor m ON m.id = hb.monitor_id
                WHERE hb.time > UTC_TIMESTAMP() - INTERVAL ? MINUTE
                ${monitorID ? "AND hb.monitor_id = ?" : ""}
                ORDER BY hb.time DESC
                LIMIT 500
            `;
            params = monitorID ? [ minutes, monitorID ] : [ minutes ];
        }

        const rows = await R.getAll(sql, params);
        res.json({ ok: true,
            data: rows });
    } catch (e) {
        console.error("[/api/report] error:", e);
        res.status(500).json({ ok: false,
            msg: e.message });
    }
});

module.exports = router;
