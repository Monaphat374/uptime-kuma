// src/services/report.js  (Frontend)
import axios from "axios";

/**
 * API client สำหรับดึงรายงาน
 * - ถ้าใช้ Vite proxy ให้ปล่อย VITE_API_URL ว่างไว้
 * - ถ้าไม่ใช้ proxy ให้ตั้ง .env ฝั่ง frontend: VITE_API_URL="http://localhost:3001"
 */
const baseURL = import.meta.env?.VITE_API_URL || "";

const api = axios.create({
    baseURL,
    timeout: 15000,
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");
    if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

/**
 * @typedef {object} ReportRow
 * @property {number} id - Row id ของ heartbeat
 * @property {string} monitor_name - ชื่อมอนิเตอร์แบบอ่านง่าย
 * @property {number} monitor_id - รหัสมอนิเตอร์
 * @property {number} status - สถานะ 1=UP, 0=DOWN
 * @property {number|null} ping - ค่า latency (ms) หรือ null ถ้าไม่มี
 * @property {string|null} msg - ข้อความประกอบเหตุการณ์ (ถ้ามี)
 * @property {string} time - เวลาแบบ UTC DATETIME จากเซิร์ฟเวอร์ (YYYY-MM-DD HH:mm:ss)
 */

/**
 * ดึงรายงาน heartbeat จาก API
 * @async
 * @param {object} opts - ตัวเลือกสำหรับการดึงรายงาน (optional)
 * @param {'1d'|'7d'|'lastday'} opts.range - ช่วงเวลา (optional; default = '1d')
 * @param {number} opts.monitorID - กรองเฉพาะมอนิเตอร์ที่ระบุ (optional)
 * @param {string|number|Date} opts.from - เวลาเริ่มช่วง (ISO/epoch/Date) ส่งต่อให้ backend (optional)
 * @param {string|number|Date} opts.to - เวลาสิ้นสุดช่วง (ISO/epoch/Date) ส่งต่อให้ backend (optional)
 * @param {string} opts.date - วันที่รูปแบบ 'YYYY-MM-DD' (ใช้คู่กับ hstart/hend) (optional)
 * @param {number} opts.hstart - ชั่วโมงเริ่ม 0..23 (ใช้คู่กับ date) (optional)
 * @param {number} opts.hend - ชั่วโมงจบ 1..24 (ใช้คู่กับ date) (optional)
 * @returns {Promise<ReportRow[]>} - อาร์เรย์ข้อมูลรายงานที่ดึงมาได้
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
    } = opts;

    // แปลงค่าเวลาให้เป็น ISO string เสมอ (รองรับ number epoch sec/ms และ Date)
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
            const ms = v > 1e12 ? v : v * 1000; // epoch sec → ms
            return new Date(ms).toISOString();
        }
        return v;
    };

    // ใส่เฉพาะพารามิเตอร์ที่มีจริง (กัน undefined)
    const params = { };
    // ถ้าไม่ได้กำหนดช่วงเอง ค่อยส่ง range
    if (!(from != null && to != null)) {
        params.range = range;
    }
    if (monitorID != null) {
        params.monitorID = monitorID;
    }
    if (monitorID != null) {
        params.monitorID = monitorID;
    }

    const fromISO = toISO(from);
    const toISOVal = toISO(to);
    if (fromISO) {
        params.from = fromISO;
    }
    if (toISOVal) {
        params.to = toISOVal;
    }
    if (date) {
        params.date = date;
    }
    if (Number.isInteger(hstart)) {
        params.hstart = hstart;
    }
    if (Number.isInteger(hend)) {
        params.hend = hend;
    }

    try {
        const { data } = await api.get("/api/report", { params });

        // รูปแบบหลัก: { ok: true, data: [...] }
        if (data?.ok === true && Array.isArray(data.data)) {
            return /** @type {ReportRow[]} */ (data.data);
        }

        // กันกรณี API เก่าส่งเป็น array เลย
        if (Array.isArray(data)) {
            return /** @type {ReportRow[]} */ (data);
        }

        throw new Error(data?.msg || "Invalid response from /api/report");
    } catch (err) {
        const message =
        err?.response?.data?.msg ||
        err?.message ||
        "Request error";
        throw new Error(message);
    }
}
