// src/services/report.js
import axios from "axios";

const baseURL = import.meta.env?.VITE_API_URL || "";

const api = axios.create({
    baseURL,
    timeout: 15000,
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token"); // เปลี่ยนให้ตรงกับระบบ login ของคุณ
    if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

/*
 * @typedef {object} ReportRow
 * @property {number} id
 * @property {string} monitor_name
 * @property {number} monitor_id
 * @property {number} status
 * @property {number|null} ping
 * @property {string|null} msg
 * @property {string} time // UTC DATETIME 'YYYY-MM-DD HH:mm:ss'
 */

/*
 * @typedef {object} ReportResponse
 * @property {boolean} ok
 * @property {ReportRow[]} data
 * @property {boolean} has_more
 * @property {number|null} next_offset
 * @property {'ASC'|'DESC'} order
 * @property {number} limit
 * @property {number} offset
 * @property {'1d'|'7d'|'lastday'} range
 * @property {string|null} from
 * @property {string|null} to
 */

const toISO = (v) => {
    if (v == null) {
        return undefined;
    }
    if (typeof v === "string") {
        return v;
    }
    if (v instanceof Date) {
        return v.toISOString();
    }
    if (typeof v === "number") {
        const ms = v > 1e12 ? v : v * 1000;
        return new Date(ms).toISOString();
    }
    return v;
};

/**
 * @typedef {object} GetReportOptions
 * @property {'1d'|'7d'|'lastday'} [range]  ค่าดีฟอลต์: '1d'
 * @property {string|number} [monitorId]    ไอดีของมอนิเตอร์ที่จะดึงรายงาน
 * @property {string|Date} [from]            รูปแบบ 'YYYY-MM-DD' หรือ Date
 * @property {string|Date} [to]             วันสิ้นสุด (YYYY-MM-DD หรือ Date)
 * @property {number} [dstart]               ชั่วโมงเริ่ม 0..23
 * @property {number} [dend]                 ชั่วโมงจบ 1..24
 * @property {number} [hstart]               วันเริ่ม 1..31 (ถ้ามี)
 * @property {number} [hend]                 วันจบ 1..31 (ถ้ามี)
 * @property {'asc'|'desc'} [order]          ค่าดีฟอลต์: 'desc'
 * @property {number} [limit]                ค่าดีฟอลต์: 2000
 * @property {number} [offset]               ค่าดีฟอลต์: 0
 */

/**
 * ดึงรายงาน (รองรับ pagination)
 * @param {GetReportOptions} opts ตัวเลือกรายงาน
 * @returns {Promise<ReportResponse>} ข้อมูลรวมตามตัวเลือก
 */
export async function getReport(opts = {}) {
    const {
        range = "1d",
        monitorID,
        from,
        to,
        date,
        hstart,
        hend,
        order,
        limit,
        offset,
    } = opts;

    const fromISO = toISO(from);
    const toISOVal = toISO(to);

    const params = {};
    // ใช้ range/date/hstart/hend เฉพาะตอนที่ไม่ได้กำหนด from/to
    if (!(fromISO != null && toISOVal != null)) {
        params.range = range;
        if (date) {
            params.date = date;
        }
        if (Number.isInteger(hstart)) {
            params.hstart = hstart;
        }
        if (Number.isInteger(hend)) {
            params.hend = hend;
        }
    } else {
        params.from = fromISO;
        params.to = toISOVal;
    }
    if (monitorID != null) {
        params.monitorID = monitorID;
    }
    if (order) {
        params.order = order;
    }
    if (limit != null) {
        params.limit = limit;
    }
    if (offset != null) {
        params.offset = offset;
    }

    if (params.from && params.to && new Date(params.from) >= new Date(params.to)) {
        throw new Error("Invalid range: 'from' must be earlier than 'to'.");
    }

    try {
        const { data } = await api.get("/api/report", { params });

        // ✅ กรณีปกติ: server ส่ง { ok:true, data:[...], has_more, next_offset, ... }
        if (data?.ok === true && Array.isArray(data.data)) {
            return /** @type {ReportResponse} */ (data);
        }

        // ✅ กันกรณี server เก่าส่งเป็น array ตรงๆ
        if (Array.isArray(data)) {
            return {
                ok: true,
                data,
                has_more: false,
                next_offset: null,
                order: (order || "desc").toUpperCase() === "ASC" ? "ASC" : "DESC",
                limit: limit ?? 500,
                offset: offset ?? 0,
                range,
                from: fromISO ?? null,
                to: toISOVal ?? null,
            };
        }

        throw new Error(data?.msg || "Invalid response from /api/report");
    } catch (err) {
        const message = err?.response?.data?.msg || err?.message || "Request error";
        throw new Error(message);
    }
}
/**
 * ดึงรายงานทุกหน้าด้วยการวนเรียก getReport แบบแบ่งหน้า
 * @param {object} params พารามิเตอร์ส่งต่อให้ getReport
 * @param {number} params.offset ออฟเซ็ตเริ่มต้น (default: 0)
 * @param {number} params.limit จำนวนต่อหน้า (default: 2000)
 * @returns {Promise<object[]>} รายการข้อมูลที่รวมทุกหน้ามาแล้ว
 * @throws {Error} เมื่อการเรียก API ล้มเหลว
 */
export async function getReportAllPages(params = {}) {
    const out = [];
    let offset = params.offset ?? 0;
    const limit = params.limit ?? 2000;

    while (true) {
        const res = await getReport({ ...params,
            limit,
            offset });
        out.push(...(res.data ?? []));
        if (!res.has_more) {
            break;
        }
        offset = res.next_offset ?? (offset + (res.data?.length || 0));
    }
    return out;
}
