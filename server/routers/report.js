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
    const dt = new Date(Date.UTC(y, m - 1, d));
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

/** ===== Helpers พารามิเตอร์ query ที่ปลอดภัย ===== */

/**
 * แปลงค่าพารามิเตอร์ order ให้เป็น 'ASC' หรือ 'DESC'
 * @param {string|undefined|null} val ค่าจาก query (เช่น "asc" หรือ "desc")
 * @returns {'ASC'|'DESC'} ค่าที่พร้อมใช้ใน SQL ORDER BY
 */
function parseOrder(val) {
    const v = typeof val === "string" ? val : "";
    return v.toLowerCase() === "asc" ? "ASC" : "DESC";
}

/**
 * แปลง limit เป็นจำนวนเต็มบวก และจำกัดเพดานสูงสุด
 * @param {string|number|undefined|null} val ค่าจาก query
 * @param {number} def ค่าเริ่มต้นของ limit (ดีฟอลต์ 500)
 * @param {number} max เพดานสูงสุดของ limit (ดีฟอลต์ 5000)
 * @returns {number} ค่า limit ที่ผ่านการตรวจสอบแล้ว
 */
function parseLimit(val, def = 500, max = 5000) {
    const n = Number.parseInt(val, 10);
    if (Number.isFinite(n) && n > 0) {
        return Math.min(n, max);  // ต้องมีปีกกา
    }
    return def;
}

/**
 * แปลง offset เป็นจำนวนเต็มไม่ติดลบ
 * @param {string|number|undefined|null} val ค่าจาก query
 * @returns {number} ค่า offset (ไม่ถูกต้องจะคืน 0)
 */
function parseOffset(val) {
    const n = Number.parseInt(val, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * GET /api/report
 * Query:
 * - range: '1d' | 'lastday' | '7d'
 * - from, to: ISO/epoch/MySQL DATETIME (UTC)
 * - date + hstart + hend (UTC)  -> ครอบช่วง [date hstart:00, date hend:00) (hend=24 ได้)
 * - monitorID: number
 * - order: 'asc'|'desc'  (default: desc)
 * - limit: number        (default: 500, max: 5000)
 * - offset: number       (default: 0)
 */
router.get("/api/report", async (req, res) => {
    try {
        const range = [ "30d", "7d", "lastday", "1d" ].includes(req.query.range) ? req.query.range : "1d";
        const monitorID = req.query.monitorID ? Number(req.query.monitorID) : null;

        // ✅ ใหม่: ควบคุมการเรียงและการแบ่งหน้า
        const order = parseOrder(req.query.order);               // ASC | DESC
        const limit = parseLimit(req.query.limit, 500, 5000);    // จำกัดเพดานเพื่อความปลอดภัย
        const offset = parseOffset(req.query.offset);            // เริ่มอ่านจากแถวที่ N

        // ถ้าไม่ได้ส่ง from/to จะ fallback เป็นย้อนหลัง N นาที (รองรับ 30d)
        let minutes;
        switch (range) {
            case "30d":
                minutes = 30 * 24 * 60; // 43200 นาที
                break;
            case "7d":
                minutes = 7 * 24 * 60;  // 10080 นาที
                break;
            default:
                minutes = 24 * 60;      // 1 วัน
        }

        // from/to: รับ ISO/epoch/date -> DATETIME (UTC)
        let from = toMySQLDateTime(req.query.from);
        let to = toMySQLDateTime(req.query.to);

        // รองรับ date + hstart + hend (UTC)
        const date = (req.query.date || "").trim(); // 'YYYY-MM-DD'
        const hstart = req.query.hstart != null ? parseInt(req.query.hstart, 10) : null; // 0..23
        const hend = req.query.hend != null ? parseInt(req.query.hend, 10) : null;       // 1..24

        if (!from && !to && date && Number.isInteger(hstart) && Number.isInteger(hend)) {
            if (hstart < 0 || hstart > 23 || hend < 1 || hend > 24 || hend <= hstart) {
                return res.status(400).json({ ok: false,
                    msg: "Invalid hstart/hend" });
            }
            const pad = (n) => String(n).padStart(2, "0");
            from = `${date} ${pad(hstart)}:00:00`;
            to = (hend === 24)
                ? `${addDaysUTC(date, 1)} 00:00:00`
                : `${date} ${pad(hend)}:00:00`;
        }

        // สร้างเงื่อนไขช่วงเวลา
        const params = [];
        const whereParts = [];

        if (from && to) {
            whereParts.push("hb.time >= ? AND hb.time < ?");
            params.push(from, to);
        } else if (range === "lastday") {
            whereParts.push("hb.time >= DATE(UTC_TIMESTAMP()) - INTERVAL 1 DAY");
            whereParts.push("hb.time <  DATE(UTC_TIMESTAMP())");
        } else {
            whereParts.push("hb.time > UTC_TIMESTAMP() - INTERVAL ? MINUTE");
            params.push(minutes); // 1d=1440, 7d=10080
        }

        if (monitorID) {
            whereParts.push("hb.monitor_id = ?");
            params.push(monitorID);
        }

        const sql = `
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
        WHERE ${whereParts.join(" AND ")}
        ORDER BY hb.time ${order}, hb.id ${order}
        LIMIT ${limit} OFFSET ${offset}
        `;

        const rows = await R.getAll(sql, params);
        const hasMore = rows.length === limit;

        res.json({
            ok: true,
            data: rows,
            has_more: hasMore,
            next_offset: hasMore ? offset + rows.length : null,
            order,
            limit,
            offset,
            range,
            from: from || null,
            to: to || null
        });

    } catch (e) {
        console.error("[/api/report] error:", e);
        res.status(500).json({ ok: false,
            msg: e.message });
    }
});

module.exports = router;
