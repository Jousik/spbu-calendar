// Генерирует spbu.ics из расписания СПбГУ для группы 25.Б05-э
import { writeFileSync } from "node:fs";

const GROUP = 475000; // 25.Б05-э
const EXCLUDE = [/Русский язык как иностранный/i, /Траектория 2/i, /Траектория 4/i];
const WEEKS_BACK = 2, WEEKS_AHEAD = 20;

const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ics = s => s.replace(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/, "$1$2$3T$4$5$6");
const esc = s => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const fold = line => { const out = []; let s = line; while (Buffer.byteLength(s) > 74) { let i = 74; while (Buffer.byteLength(s.slice(0, i)) > 74) i--; out.push(s.slice(0, i)); s = " " + s.slice(i); } out.push(s); return out.join("\r\n"); };

const now = new Date();
const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 7 * WEEKS_BACK);
const end = new Date(monday); end.setDate(monday.getDate() + 7 * (WEEKS_BACK + WEEKS_AHEAD));

const events = [];
for (let d = new Date(monday); d < end; d.setDate(d.getDate() + 28)) {
  const to = new Date(d); to.setDate(d.getDate() + 28);
  const r = await fetch(`https://timetable.spbu.ru/api/v1/groups/${GROUP}/events/${iso(d)}/${iso(to)}`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  for (const day of data.Days || []) for (const e of day.DayStudyEvents || []) {
    if (EXCLUDE.some(rx => rx.test(e.Subject))) continue;
    events.push(e);
  }
}
if (!events.length) throw new Error("Пустое расписание — файл не перезаписываю");

const stamp = ics(new Date().toISOString().slice(0, 19)) + "Z";
const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//spbu-calendar//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  "X-WR-CALNAME:СПбГУ 25.Б05-э", "X-WR-TIMEZONE:Europe/Moscow", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
const seen = new Set();
for (const e of events) {
  const uid = `${e.Start}-${e.Subject}`.replace(/[^\wа-яё]/gi, "").slice(0, 120) + "@spbu-25b05";
  if (seen.has(uid)) continue; seen.add(uid);
  const flags = [e.TimeWasChanged && "время изменено", e.LocationsWereChanged && "аудитория изменена", e.EducatorsWereReassigned && "замена преподавателя"].filter(Boolean);
  const title = (e.IsCancelled ? "❌ ОТМЕНА: " : flags.length ? "⚠️ " : "") + e.Subject;
  lines.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Moscow:${ics(e.Start)}`, `DTEND;TZID=Europe/Moscow:${ics(e.End)}`,
    fold(`SUMMARY:${esc(title)}`), fold(`LOCATION:${esc(e.LocationsDisplayText)}`),
    fold(`DESCRIPTION:${esc([e.EducatorsDisplayText, flags.join(", ")].filter(Boolean).join("\n"))}`),
    `TRANSP:${e.IsCancelled ? "TRANSPARENT" : "OPAQUE"}`, "END:VEVENT");
}
// --- Зал: 4 тренировки по 2 часа; если накладывается на пару — пропускаем ---
const GYM = { 2: ["14:00", "Зал — верх"], 3: ["14:00", "Зал — низ"], 6: ["09:00", "Зал — верх"], 0: ["12:00", "Зал — низ"] };
const GYM_EXTRA = [["2026-11-13", "15:45", "Зал — низ (перенос со среды)"], ["2026-12-01", "09:00", "Зал — верх (утром, до пар)"], ["2026-11-28", "08:30", "Зал — верх (раньше: пары с 11:30)"], ["2026-12-12", "08:30", "Зал — верх (раньше: пары с 11:30)"]];
const ROAD_BEFORE = 50, ROAD_AFTER = 40; // минут на дорогу до зала и от зала до учёбы
const busy = events.filter(e => !e.IsCancelled && !/пересдача|показ работ/i.test(e.Subject)).map(e => [new Date(e.Start), new Date(e.End)]);
const gymEvent = (date, time, title) => {
  const s = new Date(`${date}T${time}:00`), en = new Date(s.getTime() + 2 * 3600e3);
  if (busy.some(([a, b]) => a < new Date(en.getTime() + ROAD_AFTER * 60e3) && b > new Date(s.getTime() - ROAD_BEFORE * 60e3))) return;
  const f = x => `${iso(x).replace(/-/g, "")}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
  lines.push("BEGIN:VEVENT", `UID:gym-${date}@spbu-25b05`, `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Moscow:${f(s)}`, `DTEND;TZID=Europe/Moscow:${f(en)}`,
    fold(`SUMMARY:🏋️ ${esc(title)}`), "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Зал через час", "TRIGGER:-PT1H", "END:VALARM", "END:VEVENT");
};
for (let d = new Date(Math.max(monday, new Date("2026-11-06"))); d < end; d.setDate(d.getDate() + 1)) {
  const g = GYM[d.getDay()]; if (g) gymEvent(iso(d), g[0], g[1]);
}
for (const [date, time, title] of GYM_EXTRA) gymEvent(date, time, title);

lines.push("END:VCALENDAR");
writeFileSync("spbu.ics", lines.join("\r\n") + "\r\n");
console.log(`OK: ${seen.size} занятий`);
