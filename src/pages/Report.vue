<template>
    <transition name="slide-fade" appear>
        <div>
            <!-- 1) CTA -->
            <div class="shadow-box shadow-cta p-3 mb-3">
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <div>
                        <div class="fw-semibold">See report now</div>
                        <small class="text-muted">Last 24 hours</small>
                    </div>
                    <button class="btn btn-primary" @click="onShowClick">
                        Show
                    </button>
                </div>
            </div>

            <!-- 2) เลือกช่วง (แสดงเมื่อกด Show) -->
            <div v-if="showDay" class="shadow-box p-3 mb-3">
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <div class="fw-semibold">Choose range</div>
                    <div class="d-flex gap-2 ms-auto">
                        <!-- Today -->
                        <button class="btn" :class="btnClass('1d')" :disabled="loadingTable" @click="fetchDay">
                            Today
                        </button>

                        <!-- Last day -->
                        <button class="btn" :class="btnClass('lastday')" :disabled="loadingTable" @click="changeRange('lastday')">
                            Last day
                        </button>

                        <!-- 7 day -->
                        <button class="btn" :class="btnClass('7d')" :disabled="loadingTable" @click="changeRange('7d')">
                            7 day
                        </button>
                    </div>
                </div>
            </div>

            <!-- ▸ ปุ่ม Export โชว์เมื่อเลือกช่วงแล้วและมีข้อมูล -->
            <div v-if="showReport && !loadingTable && rows.length" class="d-flex gap-2 ms-3">
                <!--button class="btn btn-outline-secondary" @click="exportCSV">
                    Export CSV
                </button-->
                <button class="btn btn-outline-secondary" @click="exportXLSX">
                    Export Excel
                </button>
                <button class="btn btn-outline-secondary" @click="exportPDF">
                    Export PDF
                </button>
            </div>

            <!-- <button class="btn btn-outline-secondary" @click="changeRange('lastday')" :disabled="loadingTable">
    <font-awesome-icon v-if="loadingTable && range==='lastday'" icon="spinner" spin class="me-2" />
    Last day
  </button>

  <button class="btn btn-outline-secondary" @click="changeRange('7d')" :disabled="loadingTable">
    <font-awesome-icon v-if="loadingTable && range==='7d'" icon="spinner" spin class="me-2" />
    7 day
  </button>-->

            <!-- 3) รายงาน (แสดงเมื่อเลือกช่วงแล้ว) -->
            <div v-if="showReport" class="shadow-box p-3">
                <div v-if="loading" class="d-flex align-items-center justify-content-center my-4">
                    <font-awesome-icon icon="spinner" size="2x" spin />
                </div>
                <div v-else-if="error" class="alert alert-danger my-2">{{ error }}</div>
                <div v-else-if="rows.length === 0" class="text-center my-3">{{ $t("No Report data") }}</div>

                <div v-else class="table-responsive">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>Monitor</th>
                                <th>Status</th>
                                <th>Ping</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="r in rows" :key="`${r.monitor_id}-${r.time}`">
                                <td>{{ r.monitor_name || r.monitor_id }}</td>
                                <td>
                                    <span :class="['badge', Number(r.status) ? 'bg-success' : 'bg-danger']">
                                        {{ Number(r.status) ? 'UP' : 'DOWN' }}
                                    </span>
                                </td>
                                <td>{{ r.ping ?? '-' }}</td>
                                <td>{{ formatTime(r.time) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <!-- ✅ จบลูกของ <transition> -->
        </div>
    </transition>
</template>
<script>
import { getReport } from "../services/report";

import * as XLSX from "xlsx";

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// ถ้าต้องการรองรับภาษาไทย ให้เตรียม base64 ฟอนต์ แล้ว import เข้ามา
// import sarabunRegularBase64 from "@/assets/fonts/Sarabun-Regular.base64.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
dayjs.extend(utc);
dayjs.extend(timezone);

export default {
    name: "ReportPage",
    data() {
        return {
            range: "1d",
            rows: [],
            loadingTable: false,
            error: "",
            showDay: false,     // ⬅️ กด Show แล้วค่อย true
            showReport: false,  // ⬅️ กด Day แล้วค่อย true
            // ⬅️ timezone ของผู้ใช้
            userTZ: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            from: null,
            to: null,
        };
    },

    async mounted() {
        await this.load();
    },

    methods: {

        // ปุ่มที่เลือก -> เขียว, ไม่เลือก -> เทาเส้นขอบ
        btnClass(target) {
            return this.range === target ? "btn-success" : "btn-outline-secondary";
        },
        // ✅ แปลงเป็น epoch ms โดย "ตีความสตริงจาก DB เป็น UTC เสมอ"
        toMs(val) {
            if (val == null || val === "") {
                return NaN;
            }
            const n = Number(val);
            if (Number.isFinite(n)) {
                // epoch sec/ms → ถือเป็น UTC
                return n > 1e12 ? n : n * 1000;
                // (ถ้า backend ส่งเป็นวินาที)
            }
            // สตริง 'YYYY-MM-DD HH:mm:ss' จาก MySQL (ไม่มีโซนเวลา) → บังคับเป็น UTC
            const d = dayjs.utc(val);
            return d.isValid() ? d.valueOf() : NaN;
        },

        async load() {
            this.loadingTable = true;
            this.error = "";
            try {
                /*let rows = await getReport({ range: this.range });

                // ✅ ถ้าเป็น lastday ให้กรองเฉพาะช่วงเมื่อวาน 00:00–24:00 (ตามเวลาท้องถิ่น)
                if (this.range === "lastday") {
                    const start = dayjs().subtract(1, "day").startOf("day").valueOf(); // local ผู้ใช้
                    const end = dayjs().startOf("day").valueOf();
                    rows = rows.filter(r => {
                        const t = this.toMs(r.time);       // r.time (UTC) → epoch ms
                        return Number.isFinite(t) && t >= start && t < end;
                    });
                }*/
                const rows = await getReport({
                    range: this.range,
                    from: this.from,
                    to: this.to,
                });

                this.rows = rows;
            } catch (e) {
                this.error = e?.message || "Request error";
                this.rows = [];
            } finally {
                this.loadingTable = false;
            }
        },
        onShowClick() {
            // คลิกครั้งที่ 1: true → แสดง
            // ครั้งที่ 2: false → ไม่แสดง
            // ครั้งที่ 3: true → แสดง ...สลับไปเรื่อยๆ
            this.showDay = !this.showDay;
            this.showReport = false; // กด Show เมื่อไหร่ ซ่อนตารางไว้ก่อน
        },

        async fetchDay() {
            // กด Day -> ตั้งช่วงเป็น 1d แล้วค่อยโหลด/แสดงตาราง
            this.range = "1d";
            this.showReport = true;

            const nowLocal = dayjs.tz ? dayjs().tz(this.userTZ) : dayjs();
            this.from = nowLocal.startOf("day").utc().toISOString();
            this.to = nowLocal.utc().toISOString();

            await this.load();
        },

        // ✅ ต้องเปิดตารางก่อน แล้วค่อยโหลด
        async changeRange(r) {
            this.range = r;          // 'lastday' หรือ '7d'
            this.showReport = true;  // สำคัญ!
            const nowLocal = dayjs.tz ? dayjs().tz(this.userTZ) : dayjs();

            if (r === "7d") {
                // ย้อนหลัง 7 วันเต็ม: [00:00 ของ 7 วันก่อน, 00:00 วันนี้)
                const startLocal = nowLocal.startOf("day").subtract(7, "day");
                const endLocal = nowLocal.startOf("day");
                this.from = startLocal.utc().toISOString();
                this.to = endLocal.utc().toISOString();

            } else if (r === "lastday") {
                // เมื่อวานเต็มวัน
                const startLocal = nowLocal.subtract(1, "day").startOf("day");
                const endLocal = nowLocal.startOf("day");
                this.from = startLocal.utc().toISOString();
                this.to = endLocal.utc().toISOString();

            } else { // "1d" = วันนี้ตั้งแต่ 00:00 จนถึงตอนนี้
                const startLocal = nowLocal.startOf("day");
                const endLocal = nowLocal; // ตอนนี้
                this.from = startLocal.utc().toISOString();
                this.to = endLocal.utc().toISOString();
            }

            await this.load();
        },

        // ถ้าอนาคตอยากแปลงเวลา ค่อยเรียกใช้ใน template แล้วค่อยเปิดใช้งาน
        /*
        formatTime(val) {
        if (val == null || val === "") return "-";
        const num = Number(val);
        if (Number.isFinite(num)) {
            const ms = num > 1e12 ? num : num * 1000;
            return dayjs(ms).format("YYYY-MM-DD HH:mm:ss");
        }
        const d = dayjs(val);
        return d.isValid() ? d.format("YYYY-MM-DD HH:mm:ss") : String(val);
        },
        */
        // ฟอร์แมตให้เป็น "YYYY-MM-DD HH:mm:ss"
        // รองรับทั้ง epoch และ DATETIME string
        formatTime(val) {
            if (val == null || val === "") {
                return "-";
            }
            const n = Number(val);
            if (Number.isFinite(n)) {
                // เป็นตัวเลข -> epoch (sec หรือ ms)
                const ms = n > 1e12 ? n : n * 1000;
                return dayjs(ms).format("YYYY-MM-DD HH:mm:ss");
            }

            // สตริง MySQL DATETIME (UTC) → แปลงเป็นโซนผู้ใช้
            const d = dayjs.utc(val);
            return d.isValid()
                ? d.tz(this.userTZ).format("YYYY-MM-DD HH:mm:ss")
                : String(val);
        },
        // ตั้งชื่อไฟล์ตามช่วง + วันที่ (ใช้ timezone ผู้ใช้)
        exportFilename(ext) {
            const now = dayjs.tz ? dayjs().tz(this.userTZ) : dayjs();
            let suffix;

            if (this.range === "lastday") {
                // เมื่อวานเต็มวัน
                suffix = now.subtract(1, "day").format("YYYY-MM-DD");
            } else if (this.range === "7d") {
                // 7 วันย้อนหลัง: ช่วงเริ่ม-จบ
                const start = now.subtract(7, "day").format("YYYY-MM-DD");
                const end = (dayjs.tz ? dayjs().tz(this.userTZ) : dayjs()).format("YYYY-MM-DD");
                suffix = `${start}_to_${end}`;
            } else {
                // Today (1d)
                suffix = now.format("YYYY-MM-DD");
            }

            return `Report_${suffix}.${ext}`;
        },
        exportRows() {
            return this.rows.map(r => ({
                Monitor: r.monitor_name || r.monitor_id,
                Status: Number(r.status) ? "UP" : "DOWN",
                Ping: r.ping ?? "-",
                Time: this.formatTime(r.time),
            }));
        },
        downloadBlob(filename, mime, data) {
            const blob = data instanceof Blob ? data : new Blob([ data ], { type: mime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        },
        exportCSV() {
            if (!this.rows?.length) {
                return;
            }
            const data = this.exportRows();
            const headers = Object.keys(data[0]);
            const esc = (v) => {
                if (v == null) {
                    return "";
                }
                const s = String(v);
                if (/[",\n]/.test(s)) {
                    const escaped = s.replace(/"/g, "\"\"");
                    return `"${escaped}"`;
                }
                return s;
            };
            const lines = [
                headers.join(","),
                ...data.map(row => headers.map(h => esc(row[h])).join(",")),
            ];
            const csv = "\uFEFF" + lines.join("\n"); // BOM สำหรับภาษาไทยใน Excel
            this.downloadBlob(this.exportFilename("csv"), "text/csv;charset=utf-8", csv);
        },
        exportXLSX() {
            if (!this.rows?.length) {
                return;
            }
            const data = this.exportRows();
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Report");
            const out = XLSX.write(wb, {
                bookType: "xlsx",
                type: "array"
            });
            this.downloadBlob(
                this.exportFilename("xlsx"),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                out
            );
        },

        // ===== NEW: Export PDF =====
        async exportPDF() {
            if (!this.rows?.length) {
                return;
            }
            try {
                const doc = new jsPDF({
                    orientation: "p",
                    unit: "pt",
                    format: "a4"
                });

                // --- ฟอนต์ไทย (ถ้าต้องการ) ---
                // doc.addFileToVFS("Sarabun-Regular.ttf", sarabunRegularBase64);
                // doc.addFont("Sarabun-Regular.ttf", "Sarabun", "normal");
                // doc.setFont("Sarabun", "normal");

                const titleSuffix = this.exportFilename("pdf").replace(/^Report_|\.pdf$/g, "");
                doc.setFontSize(14);
                doc.text(`Uptime Report (${titleSuffix})`, 40, 40);

                const head = [[ "Monitor", "Status", "Ping", "Time" ]];
                const body = this.exportRows().map(r => [ r.Monitor, r.Status, r.Ping, r.Time ]);

                autoTable(doc, {
                    head,
                    body,
                    startY: 60,
                    margin: {
                        left: 40,
                        right: 40
                    },
                    styles: { fontSize: 10 /* ถ้าใช้ฟอนต์ไทย: font: "Sarabun" */ },
                    headStyles: { fillColor: [ 240, 240, 240 ] },
                    didDrawPage: () => {
                        const ps = doc.internal.pageSize;
                        const w = typeof ps.getWidth === "function" ? ps.getWidth() : ps.width;
                        const h = typeof ps.getHeight === "function" ? ps.getHeight() : ps.height;
                        doc.setFontSize(9);
                        doc.text(`Page ${doc.getNumberOfPages()}`, w - 40, h - 20, { align: "right" });
                    },
                });

                const pdfBlob = doc.output("blob");
                this.downloadBlob(this.exportFilename("pdf"), "application/pdf", pdfBlob);
            } catch (err) {
                console.error(err);
                this.error = `Export PDF failed: ${err?.message || err}`;
            }
        }

    },
};
</script>
<style lang="scss" scoped>
@import "../assets/vars.scss";

.btn.active {
    filter: brightness(0.9);
    outline: 2px solid rgba(255, 255, 255, 0.35);
}

.btn .fa-spinner {
    width: 1em;
}

/* กันปุ่มกระดิกเวลาโชว์/ซ่อนไอคอน */

.shadow-box {
    border-radius: 10px;
    background: #fff;
}

.dark .shadow-box {
    background: $dark-bg2;
}
</style>
