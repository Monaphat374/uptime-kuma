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
                    <button class="btn btn-primary" @click="onShowClick">Show</button>
                </div>
            </div>

            <!-- 2) เลือกช่วง (แสดงเมื่อกด Show) -->
            <div v-if="showDay" class="shadow-box p-3 mb-3">
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <div class="fw-semibold">Choose range</div>
                    <div class="d-flex gap-2 ms-auto">
                        <button class="btn" :class="btnClass('1d')" :disabled="loadingTable" @click="fetchDay">Today</button>
                        <button class="btn" :class="btnClass('lastday')" :disabled="loadingTable" @click="changeRange('lastday')">Last day</button>
                        <button class="btn" :class="btnClass('7d')" :disabled="loadingTable" @click="changeRange('7d')">7 days</button>

                        <div class="range-pills">
                            <div class="month-picker" ref="monthPicker">
                                <button
                                    class="pill month-trigger btn"
                                    :class="btnClass('month')"
                                    id="month-trigger"
                                    aria-haspopup="listbox"
                                    :aria-expanded="monthMenuOpen.toString()"
                                    @click.stop="onMonthClick"
                                    :disabled="loadingTable"
                                >
                                    <span class="label">{{ monthLabel }}</span>
                                    <svg class="chev" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M7 10l5 5 5-5" fill="currentColor" />
                                    </svg>
                                </button>
                                <ul
                                    class="month-menu"
                                    :class="{ 'drop-up': menuDropUp, 'align-right': menuAlignRight }"
                                    :style="monthMenuStyle"
                                    role="listbox"
                                    tabindex="-1"
                                    aria-labelledby="month-trigger"
                                    v-show="monthMenuOpen"
                                >
                                    <li
                                        v-for="(m, i) in monthNames"
                                        :key="i"
                                        class="month-option"
                                        role="option"
                                        :aria-selected="i === selectedMonthIndex ? 'true' : 'false'"
                                        @click="selectMonth(i)"
                                    >
                                        {{ m }}
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ▸ ปุ่ม Export: ใช้ hasData ให้สอดคล้องกับ empty-state -->
            <div v-if="showReport && !loadingTable && hasData" class="d-flex gap-2 ms-3">
                <button class="btn btn-outline-secondary" @click="exportXLSX">Export Excel</button>
                <button class="btn btn-outline-secondary" @click="exportPDF">Export PDF</button>
            </div>

            <!-- 3) รายงาน -->
            <div v-if="showReport" class="shadow-box p-3">
                <div v-if="loadingTable" class="d-flex align-items-center justify-content-center my-4">
                    <font-awesome-icon icon="spinner" size="2x" spin />
                </div>
                <div v-else-if="error" class="alert alert-danger my-2">{{ error }}</div>
                <div v-else-if="!hasData" class="text-center my-3">{{ $t("No Report data") }}</div>

                <div v-else class="table-responsive">
                    <!-- แถบเปลี่ยนหน้า -->
                    <div v-if="hasData" class="d-flex justify-content-end mb-2">
                        <div class="d-flex align-items-center gap-2">
                            <!-- ก่อนหน้า -->
                            <button
                                class="btn btn-sm btn-outline-secondary"
                                :disabled="page === 0 || loadingTable"
                                @click="goPrev"
                            >&lsaquo;</button>

                            <!-- เลขหน้า -->
                            <span class="page-chip">{{ page + 1 }}</span>

                            <!-- ถัดไป -->
                            <button
                                class="btn btn-sm btn-outline-secondary"
                                :disabled="page >= totalPages - 1 || loadingTable || totalPages === 0"
                                @click="goNext"
                            >&rsaquo;</button>
                        </div>
                    </div>

                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Monitor</th>
                                <th>Status</th>
                                <th>Availability (%)</th>
                                <th>Uptime (%)</th>
                                <th>Success Rate (%)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(r, idx) in pagedSummary" :key="r.id || r.monitor">
                                <td>{{ page * pageSize + idx + 1 }}</td>
                                <td>{{ r.monitor }}</td>
                                <td>
                                    <span :class="['badge', r.status === 'UP' ? 'bg-success' : (r.status === 'DOWN' ? 'bg-danger' : 'bg-secondary')]">
                                        {{ r.status }}
                                    </span>
                                </td>
                                <td>{{ fmtPct(r.availability) }}</td>
                                <td>{{ fmtPct(r.uptime) }}</td>
                                <td>{{ fmtPct(r.success) }}</td>
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

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
dayjs.extend(utc);
dayjs.extend(timezone);

// === SLO latency (ms) สำหรับ Success Rate ===
const SLA_MS = 1000; // 1 วินาที

// === Lookback presets per range (ms) เพื่อให้ uptime แม่นขอบช่วง ===
const LOOKBACK_PRESETS = {
    "1d":   60 * 60 * 1000,   // 1 ชั่วโมง
    "lastday": 60 * 60 * 1000, // 1 ชั่วโมง
    "7d":   2 * 60 * 60 * 1000, // 2 ชั่วโมง
    "30d":  6 * 60 * 60 * 1000, // 6 ชั่วโมง
    "month":6 * 60 * 60 * 1000, // 6 ชั่วโมง
    "default": 60 * 60 * 1000,  // fallback
};

export default {
    name: "ReportPage",
    data() {
        return {
            range: "1d",
            rows: [],
            loadingTable: false,
            error: "",
            showDay: false,
            showReport: false,
            userTZ: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            from: null,
            to: null,
            page: 0,
            pageSize: 70,
            pageDraft: 1,
            isEditingPage: false,

            monthMenuOpen: false,
            monthNames: [
                "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"
            ],
            selectedMonthIndex: null,
            monthLabel: "Month",
            menuDropUp: false,
            menuAlignRight: false,
            monthMenuStyle: {},
        };
    },

    computed: {
    // ✅ ใช้ตัวเดียวกันทุกที่
        hasData() {
            return Array.isArray(this.monitorSummary) && this.monitorSummary.length > 0;
        },
        totalPages() {
            const n = Array.isArray(this.monitorSummary) ? this.monitorSummary.length : 0;
            const size = Number.isFinite(this.pageSize) && this.pageSize > 0 ? this.pageSize : 1;
            return n > 0 ? Math.ceil(n / size) : 0;
        },
        pagedSummary() {
            const list = Array.isArray(this.monitorSummary) ? this.monitorSummary : [];
            if (!list.length) {
                return [];
            }
            const size = Number.isFinite(this.pageSize) && this.pageSize > 0 ? this.pageSize : 1;
            const maxPage = Math.max(this.totalPages - 1, 0);
            const safePage = Math.min(Math.max(Number(this.page) || 0, 0), maxPage);
            const start = safePage * size;
            const end = start + size;
            return list.slice(start, end);
        },
        dailyMetrics() {
            const rows = Array.isArray(this.rows) ? this.rows : [];
            if (!rows.length || !this.from || !this.to) {
                return {};
            }
            const tz = this.userTZ || "UTC";
            const start = dayjs(this.from).tz(tz).startOf("day");
            const end = dayjs(this.to).tz(tz);

            const out = {};
            let cur = start.clone();
            while (cur.isBefore(end)) {
                const dayStartMs = cur.startOf("day").valueOf();
                const dayEndMs = cur.endOf("day").add(1, "ms").valueOf();
                const key = cur.format("YYYY-MM-DD");
                out[key] = this.computeMetricsForWindow(dayStartMs, Math.min(dayEndMs, end.valueOf()), rows);
                cur = cur.add(1, "day");
            }
            return out;
        },
        monitorSummary() {
            return this.computeMetricsPerMonitor();
        },
        metrics() {
            const rows = Array.isArray(this.rows) ? this.rows : [];
            if (!rows.length || !this.from || !this.to) {
                return {
                    availabilitySamplePct: 0,
                    uptimePct: Number.NaN,
                    successRatePct: 0,
                    totalSamples: 0,
                    upCount: 0,
                    successCount: 0,
                };
            }
            const startMs = dayjs(this.from).valueOf();
            const endMs = dayjs(this.to).valueOf();
            return this.computeMetricsForWindow(startMs, endMs, rows);
        },
    },

    watch: {
        page(newVal) {
            if (!this.isEditingPage) {
                this.pageDraft = (Number(newVal) || 0) + 1;
            }
        },
        totalPages(newTotal) {
            if (newTotal === 0) {
                this.page = 0;
                if (!this.isEditingPage) {
                    this.pageDraft = 0;
                }
                return;
            }
            const maxPage = newTotal - 1;
            if (this.page > maxPage) {
                this.page = maxPage;
            }
            if (this.page < 0) {
                this.page = 0;
            }
            if (!this.isEditingPage) {
                this.pageDraft = this.page + 1;
            }
        }
    },

    async mounted() {
        document.addEventListener("click", this.onDocClick);
        await this.fetchDay();
    },
    beforeUnmount() {
        document.removeEventListener("click", this.onDocClick);
    },

    methods: {
        // ---------- UI helpers ----------
        btnClass(target) {
            return this.range === target ? "btn-success" : "btn-outline-secondary";
        },
        fmtPct(v) {
            if (v === "-" || v == null) {
                return "-";
            }
            const n = Number(v);
            return Number.isFinite(n) ? `${n.toFixed(2)}%` : "-";
        },

        // ---------- time helpers ----------
        toMs(val) {
            if (val == null || val === "") {
                return NaN;
            }
            const n = Number(val);
            if (Number.isFinite(n)) {
                return n > 1e12 ? n : n * 1000;
            }
            const d = dayjs.utc(val);
            return d.isValid() ? d.valueOf() : NaN;
        },

        // ---------- pagination ----------
        resetPage() {
            this.page = 0;
        },
        goPrev() {
            if (this.page > 0) {
                this.page -= 1;
            }
        },
        goNext() {
            if (this.page < this.totalPages - 1) {
                this.page += 1;
            }
        },
        beginEditPage() {
            this.isEditingPage = true;
            this.pageDraft = (Number(this.page) || 0) + 1;
        },
        commitPageDraft() {
            this.isEditingPage = false;
            if (this.totalPages === 0) {
                this.pageDraft = 0; {
                    return;
                }
            }
            let p = Number(this.pageDraft);
            if (!Number.isFinite(p)) {
                this.pageDraft = this.page + 1; {
                    return;
                }
            }
            p = Math.min(Math.max(Math.trunc(p), 1), this.totalPages);
            const target = p - 1;
            if (target !== this.page) {
                this.page = target;
            }
            this.pageDraft = p;
        },
        getLookbackMs() {
        // คืนค่า lookback ตามช่วงปัจจุบัน
            return LOOKBACK_PRESETS[this.range] ?? LOOKBACK_PRESETS.default;
        },

        // ---------- data loading ----------
        async fetchAllReports(params) {
            const out = [];
            let offset = 0;
            const chunk = params.limit ?? 2000;
            const MAX_LOOPS = 50;
            let loops = 0;

            for (;;) {
                loops++;
                if (loops > MAX_LOOPS) {
                    throw new Error("Pagination protection: exceeded MAX_LOOPS");
                }
                const res = await getReport({ ...params,
                    limit: chunk,
                    offset
                });
                const data = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
                const hasMore = (typeof res?.has_more === "boolean") ? res.has_more : (data.length === chunk);
                if (!data.length && !hasMore) {
                    break;
                }
                out.push(...data);
                const next = (res?.next_offset ?? (offset + data.length));
                if (next === offset) {
                    break;
                }
                offset = next;
                if (!hasMore) {
                    break;
                }
            }
            return out;
        },

        async loadAllRange(order = "desc") {
            this.loadingTable = true;
            this.error = "";
            try {
                console.time("loadAllRange");

                // ===== CHANGED: คำนวณ fromForFetch = from - lookback =====
                const lookbackMs = this.getLookbackMs();
                const fromMs = dayjs(this.from).valueOf();
                const fromForFetch = Number.isFinite(fromMs)
                    ? dayjs(fromMs - lookbackMs).toISOString()
                    : this.from;

                const rows = await this.fetchAllReports({
                    from: fromForFetch,       // ใช้ from ที่เผื่อย้อนหลัง
                    to: this.to,
                    order,
                    limit: 1000,
                });

                this.rows = (this.range === "7d" && order === "asc")
                    ? rows.sort((a, b) => this.toMs(a.time) - this.toMs(b.time))
                    : rows;

                this.resetPage();
            } catch (e) {
                console.error("[loadAllRange] error:", e);
                this.error = e?.message || "Request error";
                this.rows = [];
                this.resetPage();
            } finally {
                console.timeEnd("loadAllRange");
                this.loadingTable = false;
            }
        },
        async load() {
            this.loadingTable = true;
            this.error = "";
            try {
                const rows = await getReport({ range: this.range,
                    from: this.from,
                    to: this.to
                });
                this.rows = rows;
                this.resetPage();
            } catch (e) {
                this.error = e?.message || "Request error";
                this.rows = [];
                this.resetPage();
            } finally {
                this.loadingTable = false;
            }
        },

        onShowClick() {
            this.showDay = !this.showDay;
            this.showReport = false;
        },

        async fetchDay() {
            this.range = "1d";
            this.showReport = true;
            const nowLocal = dayjs.tz ? dayjs().tz(this.userTZ) : dayjs();
            this.from = nowLocal.startOf("day").utc().toISOString();
            this.to = nowLocal.utc().toISOString();
            await this.loadAllRange("desc");
        },

        async changeRange(r) {
            this.range = r;
            this.showReport = true;
            const nowLocal = dayjs.tz ? dayjs().tz(this.userTZ) : dayjs();

            if (r === "7d") {
                const startLocal = nowLocal.startOf("day").subtract(6, "day");
                const endLocal = nowLocal;
                this.from = startLocal.utc().toISOString();
                this.to = endLocal.utc().toISOString();
                await this.loadAllRange("asc");
                return;
            }

            if (r === "30d") {
                const prevMonthStartLocal = nowLocal.startOf("month").subtract(1, "month");
                const thisMonthStartLocal = nowLocal.startOf("month");
                this.from = prevMonthStartLocal.utc().toISOString();
                this.to = thisMonthStartLocal.utc().toISOString();
                await this.loadAllRange("asc");
                return;
            }

            if (r === "lastday") {
                const startLocal = nowLocal.subtract(1, "day").startOf("day");
                const endLocal = nowLocal.startOf("day");
                this.from = startLocal.utc().toISOString();
                this.to = endLocal.utc().toISOString();
                await this.loadAllRange("desc");
                return;
            }

            if (r === "month") {
                if (this.selectedMonthIndex === null) {
                // ยังไม่เลือกเดือน: ไม่โหลด และรีเซ็ต label
                    this.monthLabel = "Month";
                    return;
                }
                const year = nowLocal.year();
                const m = this.selectedMonthIndex;
                const startLocal = nowLocal.year(year).month(m).startOf("month");
                const nextStartLocal = startLocal.add(1, "month");
                this.from = startLocal.utc().toISOString();
                this.to = nextStartLocal.utc().toISOString();
                await this.loadAllRange("asc");
                return;
            }

            // r === "1d"
            const startLocal = nowLocal.startOf("day");
            const endLocal = nowLocal;
            this.from = startLocal.utc().toISOString();
            this.to = endLocal.utc().toISOString();
            await this.loadAllRange("desc");
        },

        // ===== Month menu =====
        onMonthClick() {
            this.range = "month";
            this.monthMenuOpen = !this.monthMenuOpen;

            this.$nextTick(() => {
                if (!this.monthMenuOpen) {
                    return;
                }
                const btn = this.$refs.monthPicker?.querySelector("#month-trigger");
                const menu = this.$refs.monthPicker?.querySelector(".month-menu");
                if (!btn || !menu) {
                    return;
                }

                this.menuDropUp = false;
                this.menuAlignRight = false;
                this.monthMenuStyle = {};

                const br = btn.getBoundingClientRect();
                const mr = menu.getBoundingClientRect();
                const vw = document.documentElement.clientWidth;
                const vh = document.documentElement.clientHeight;
                const margin = 8;

                const spaceBelow = vh - br.bottom - margin;
                const spaceAbove = br.top - margin;
                this.menuDropUp = spaceBelow < mr.height && spaceAbove > spaceBelow;

                const spaceRight = vw - br.left - mr.width;
                this.menuAlignRight = spaceRight < 0 && br.right >= mr.width;

                const maxH = this.menuDropUp ? (br.top - margin) : (vh - br.bottom - margin);
                this.monthMenuStyle = { maxHeight: Math.max(160, Math.floor(maxH)) + "px",
                    overflowY: "auto"
                };
            });

            if (!this.monthMenuOpen && this.selectedMonthIndex === null) {
                this.monthLabel = "Month";
            }
        },
        onDocClick(e) {
            const picker = this.$refs.monthPicker;
            if (picker && !picker.contains(e.target)) {
                this.monthMenuOpen = false;
                if (this.selectedMonthIndex === null) {
                    this.monthLabel = "Month";
                }
            }
        },
        async selectMonth(index) {
            this.selectedMonthIndex = index;
            this.monthLabel = this.monthNames[index];
            this.monthMenuOpen = false;
            await this.changeRange("month");
        },

        // ===== Formatting & Exports =====
        formatTime(val) {
            if (val == null || val === "") {
                return "-";
            }
            const n = Number(val);
            if (Number.isFinite(n)) {
                const ms = n > 1e12 ? n : n * 1000;
                return dayjs(ms).format("YYYY-MM-DD HH:mm:ss");
                // ถ้าต้องการ TZ ผู้ใช้ ให้ใช้: return dayjs(ms).tz(this.userTZ).format(...)
            }
            const d = dayjs.utc(val);
            return d.isValid() ? d.tz(this.userTZ).format("YYYY-MM-DD HH:mm:ss") : String(val);
        },

        exportFilename(ext) {
            const now = this.userTZ ? dayjs().tz(this.userTZ) : dayjs();
            let suffix = "";
            if (this.range === "lastday") {
                suffix = now.subtract(1, "day").format("YYYY-MM-DD");
            } else if (this.range === "7d") {
                const start = now.subtract(6, "day").format("YYYY-MM-DD");
                const end = (dayjs.tz ? dayjs().tz(this.userTZ) : dayjs()).format("YYYY-MM-DD");
                suffix = `${start}_to_${end}`;
            } else if (this.range === "30d") {
                const prevStart = now.startOf("month").subtract(1, "month");
                const prevEnd = prevStart.endOf("month");
                suffix = `${prevStart.format("YYYY-MM-DD")}_to_${prevEnd.format("YYYY-MM-DD")}`;
            } else if (this.range === "month") {
                if (this.selectedMonthIndex == null) {
                // fallback ปลอดภัย
                    suffix = "month_not_selected";
                } else {
                    const year = now.year();
                    const m = this.selectedMonthIndex;
                    const start = now.year(year).month(m).startOf("month");
                    const end = start.endOf("month");
                    suffix = `${start.format("YYYY-MM-DD")}_to_${end.format("YYYY-MM-DD")}`;
                }
            } else {
                suffix = now.format("YYYY-MM-DD");
            }
            return `Report_${suffix}.${ext}`;
        },

        downloadBlob(filename, mime, data) {
            const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        },

        exportXLSX() {
            const sum = this.monitorSummary || [];
            if (!sum.length) {
                return;
            }

            const header = ["#", "Monitor", "Status", "Availability (%)", "Uptime (%)", "Success Rate (%)"];
            const body = sum.map((r, i) => ([
                i + 1,
                r.monitor,
                r.status,
                this.fmtPct(r.availability),
                this.fmtPct(r.uptime),
                this.fmtPct(r.success),
            ]));

            const aoa = [header, ...body];

            const ws = XLSX.utils.aoa_to_sheet(aoa);

            ws["!cols"] = [
                { wch: 6 },  // #
                { wch: 28 }, // Monitor
                { wch: 10 }, // Status
                { wch: 16 }, // Availability
                { wch: 14 }, // Uptime
                { wch: 18 }, // Success
            ];
            try {
                ws["!freeze"] = { xSplit: 0,
                    ySplit: 1,
                    topLeftCell: "A2" };
            } catch (e) { /* noop */ }

            try {
                const lastDataRow = body.length + 1; // +1 เพราะมี header
                if (lastDataRow > 1) {
                // ✅ แก้เป็น A1:F (มี 6 คอลัมน์)
                    ws["!autofilter"] = { ref: `A1:F${lastDataRow}` };
                }
            } catch (e) { /* noop */ }

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Report");
            const out = XLSX.write(wb, { bookType: "xlsx",
                type: "array" });
            this.downloadBlob(
                this.exportFilename("xlsx"),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                out
            );
        },

        async exportPDF() {
            const sum = this.monitorSummary || [];
            if (!sum.length) {
                return;
            }

            try {
                const doc = new jsPDF({ orientation: "p",
                    unit: "pt",
                    format: "a4" });
                const titleSuffix = this.exportFilename("pdf").replace(/^Report_|\.pdf$/g, "");
                doc.setFontSize(14);
                doc.text(`Uptime Report (${titleSuffix})`, 40, 40);

                const head = [["#", "Monitor", "Status", "Availability (%)", "Uptime (%)", "Success Rate (%)"]];
                const body = sum.map((r, i) => ([
                    i + 1,
                    r.monitor,
                    r.status,
                    this.fmtPct(r.availability),
                    this.fmtPct(r.uptime),
                    this.fmtPct(r.success),
                ]));

                autoTable(doc, {
                    head,
                    body,
                    startY: 60,
                    margin: { left: 40,
                        right: 40 },
                    styles: { fontSize: 10,
                        textColor: [20, 20, 20],
                        lineColor: [200, 200, 200],
                        lineWidth: 0.25 },
                    headStyles: { fillColor: [230, 230, 230],
                        textColor: [0, 0, 0],
                        fontStyle: "bold" },
                    alternateRowStyles: { fillColor: [250, 250, 250] },
                    theme: "grid",
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
        },

        // ===== คำนวณเปอร์เซ็นต์ต่อมอนิเตอร์ =====
        computeMetricsPerMonitor() {
            const rows = Array.isArray(this.rows) ? this.rows : [];
            if (!rows.length) {
                return [];
            }

            const groups = {};
            for (const r of rows) {
                const name = r.monitor_name || r.monitor_id || "-";
                if (!groups[name]) {
                    groups[name] = [];
                }
                groups[name].push(r);
            }

            const result = [];
            for (const [ monitor, list ] of Object.entries(groups)) {
                const ts = list.map(x => this.toMs(x.time)).filter(Number.isFinite);
                if (!ts.length) {
                    result.push({ monitor,
                        status: "-",
                        availability: "0.00",
                        uptime: "-",
                        success: "0.00"
                    });
                    continue;
                }

                const startFromRange = this.toMs(this.from);
                const endFromRange = this.toMs(this.to);
                const start = Number.isFinite(startFromRange) ? startFromRange : Math.min(...ts);
                const end = Number.isFinite(endFromRange) ? endFromRange : Math.max(...ts) + 1;

                const m = this.computeMetricsForWindow(start, end, list);

                result.push({
                    monitor,
                    status: Number(list[list.length - 1]?.status) ? "UP" : "DOWN",
                    availability: (m.availabilitySamplePct ?? 0),
                    uptime: Number.isFinite(m.uptimePct) ? m.uptimePct : "-",
                    success: (m.successRatePct ?? 0),
                });
            }

            return result.sort((a, b) => a.monitor.localeCompare(b.monitor));
        },

        // ===== แก่นคำนวณเมตริกต่อช่วงเวลา =====
        computeMetricsForWindow(startMs, endMs, rows) {
            if (!Array.isArray(rows) || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
                return {
                    availabilitySamplePct: 0,
                    uptimePct: Number.NaN,
                    successRatePct: 0,
                    totalSamples: 0,
                    upCount: 0,
                    successCount: 0,
                };
            }

            const all = rows
                .map(r => ({ t: this.toMs(r.time),
                    status: Number(r.status) ? 1 : 0,
                    ping: Number(r.ping) }))
                .filter(x => Number.isFinite(x.t))
                .sort((a, b) => a.t - b.t);

            const inWin = all.filter(x => x.t >= startMs && x.t < endMs);

            const totalSamples = inWin.length;
            let upCount = 0;
            let successCount = 0;
            for (const x of inWin) {
                if (x.status === 1) {
                    upCount++;
                }
                if (x.status === 1 && Number.isFinite(x.ping) && x.ping <= SLA_MS) {
                    successCount++;
                }
            }
            const availabilitySamplePct = totalSamples > 0 ? (upCount / totalSamples) * 100 : 0;
            const successRatePct = totalSamples > 0 ? (successCount / totalSamples) * 100 : 0;

            let uptimePct = Number.NaN;
            let lastBefore = null;
            for (let i = all.length - 1; i >= 0; i--) {
                if (all[i].t < startMs) {
                    lastBefore = all[i];
                    break;
                }
            }

            if (inWin.length === 0) {
                if (lastBefore) {
                    uptimePct = lastBefore.status === 1 ? 100 : 0;
                }
            } else {
                const points = [];
                const initialStatus = lastBefore ? lastBefore.status : inWin[0].status;
                points.push({ t: startMs,
                    status: initialStatus
                });
                for (const x of inWin) {
                    points.push({ t: x.t,
                        status: x.status });
                }
                points.push({ t: endMs,
                    status: inWin[inWin.length - 1].status });

                let upMs = 0;
                for (let i = 0; i < points.length - 1; i++) {
                    const a = points[i];
                    const b = points[i + 1];
                    const segStart = Math.max(a.t, startMs);
                    const segEnd = Math.min(b.t, endMs);
                    if (segEnd > segStart && a.status === 1) {
                        upMs += (segEnd - segStart);
                    }
                }
                uptimePct = (upMs / (endMs - startMs)) * 100;
            }

            return {
                availabilitySamplePct,
                uptimePct,
                successRatePct,
                totalSamples,
                upCount,
                successCount,
            };
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.btn.active { filter: brightness(0.9); outline: 2px solid rgba(255, 255, 255, 0.35); }
.btn .fa-spinner { width: 1em; }

.shadow-box { border-radius: 10px; background: #fff; }
.dark .shadow-box { background: $dark-bg2; }

.btn-icon { width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(160,0,0,0.2); background: transparent; line-height: 28px; }
.dark .btn-icon { border-color: rgba(255,255,255,.25); color:#fff; }
.btn-icon:disabled { opacity: .4; cursor: not-allowed; }
.page-chip {
  display: inline-block;
  min-width: 32px;
  padding: 2px 10px;
  text-align: center;
  border-radius: 999px;
  font-weight: 600;
  border: 1px solid rgba(255,255,255,.2);
  background: rgba(255,255,255,.1);
}

/* ===== Month menu ===== */
.range-pills, .month-picker { position: relative; overflow: visible !important; }
.month-trigger.pill:not(.btn-success) {
  display:flex; align-items:center; gap:.4rem; border-radius:999px; border:1px solid #ced4da;
  background:#fff; color:#212529; padding:.40rem .9rem;
}
.dark .month-trigger.pill:not(.btn-success) { background:#222; color:#eaeaea; border-color:#3a3a3a; }
.month-trigger.pill.btn-success { background:#20c55e; color:#08150b; border-color:#20c55e; }
.dark .month-trigger.pill.btn-success { background:#20c55e; color:#000; border-color:#20c55e; }
.month-trigger.pill.btn-success:hover, .month-trigger.pill.btn-success:focus { filter: brightness(.95); }
.month-trigger .chev { transition: transform .15s ease; }
.month-trigger[aria-expanded="true"] .chev { transform: rotate(180deg); }

.month-menu {
  position:absolute; top:100%; left:0; margin-top:.4rem; z-index:30; background:#fff; color:#212529;
  border:1px solid #ced4da; border-radius:10px; min-width:180px; padding:.25rem 0; display:block;
  box-shadow:0 10px 30px rgba(0,0,0,.12);
}
.dark .month-menu { background:#141414; color:#eaeaea; border-color:#333; box-shadow:0 10px 30px rgba(0,0,0,.5); }
.month-option { list-style:none; cursor:pointer; padding:.5rem .75rem; margin:0; border:0; border-radius:0; text-align:left; }
.month-menu.drop-up { top:auto; bottom:100%; margin-top:0; margin-bottom:.4rem; }
.month-menu.align-right { left:auto; right:0; }
.month-option:hover { background:#f1f3f5; }
.dark .month-option:hover { background:#222; }
.month-option[aria-selected="true"] { background:#20c55e; color:#08150b; }
</style>
