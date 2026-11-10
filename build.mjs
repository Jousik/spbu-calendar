// Генерирует spbu.ics из расписания СПбГУ для группы 25.Б05-э
import { writeFileSync, readFileSync } from "node:fs";

const GROUP = 475000; // 25.Б05-э
const EXCLUDE = [/Факультатив/i, /Русский язык как иностранный/i, /Траектория 2/i, /Траектория 4/i];
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
    // Предпринимательство, семинары по субботам: подгруппы чередуются по неделям.
    // 07.11 — 2-я подгруппа, 14.11 — 1-я (Артём в 1-й) → оставляем только недели 1-й подгруппы.
    if (/Предпринимательство, семинар/.test(e.Subject)) {
      const wk = Math.round((new Date(e.Start.slice(0, 10)) - new Date("2026-11-07")) / 864e5 / 7);
      if (wk % 2 === 0) continue;
    }
    events.push(e);
  }
}
if (!events.length) throw new Error("Пустое расписание — файл не перезаписываю");

const stamp = ics(new Date().toISOString().slice(0, 19)) + "Z";
const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//spbu-calendar//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  "X-WR-CALNAME:СПбГУ 25.Б05-э", "X-WR-TIMEZONE:Europe/Moscow", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  "BEGIN:VTIMEZONE","TZID:Europe/Moscow","BEGIN:STANDARD","DTSTART:19700101T000000","TZOFFSETFROM:+0300","TZOFFSETTO:+0300","TZNAME:MSK","END:STANDARD","END:VTIMEZONE"];
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
const studyCount = lines.length;
const header = lines.slice(0, 18);
// --- Зал: 4 тренировки по 2 часа; если накладывается на пару — пропускаем ---
const GYM = { 2: ["14:00", "Зал — верх"], 3: ["14:00", "Зал — низ"], 6: ["09:00", "Зал — верх"], 0: ["12:00", "Зал — низ"] };
const GYM_SKIP = ["2026-11-07"];
const GYM_EXTRA = [["2026-11-13", "15:45", ""], ["2026-12-01", "09:00", " (утром, до пар)"], ["2026-11-28", "08:30", " (раньше: пары с 11:30)"], ["2026-12-12", "08:30", " (раньше: пары с 11:30)"]];
const ROAD_BEFORE = 50, ROAD_AFTER = 40; // минут на дорогу до зала и от зала до учёбы
const busy = events.filter(e => !e.IsCancelled && !/пересдача|показ работ/i.test(e.Subject)).map(e => [new Date(e.Start), new Date(e.End)]);
const WORKOUTS = {
  "Верх А": [["Жим штанги лёжа", "6–8"], ["Тяга штанги в наклоне", "8–10"], ["Жим гантелей сидя", "8–10"], ["Подтягивания или тяга верхнего блока", "8–12"], ["Сведение рук в кроссовере", "12–15"], ["Сгибания со штангой на бицепс", "10–12"], ["Французский жим лёжа", "10–12"]],
  "Низ А": [["Приседания со штангой", "6–8"], ["Румынская тяга (лёгкий вес, спина прямая, гриф вдоль ног)", "8–10"], ["Жим ногами", "10–12"], ["Сгибания ног лёжа", "10–12"], ["Подъёмы на носки стоя", "12–15"], ["Планка", "40–60 с"]],
  "Верх Б": [["Жим гантелей на наклонной скамье", "8–10"], ["Тяга верхнего блока узким хватом", "10–12"], ["Жим штанги стоя", "6–8"], ["Тяга гантели одной рукой", "10–12"], ["Махи гантелями в стороны", "12–15"], ["Тяга каната к лицу (задняя дельта, осанка)", "15–20"], ["Молотки с гантелями", "10–12"], ["Разгибания рук на блоке", "12–15"]],
  "Низ Б": [["Гакк-приседания (или присед в Смите)", "8–10"], ["Болгарские выпады", "8–10 на ногу"], ["Сгибания ног сидя", "10–12"], ["Ягодичный мост со штангой", "10–12"], ["Гиперэкстензия (спина ровная, без рывков)", "12–15"], ["Подъёмы на носки сидя", "15"], ["Подъёмы ног в висе", "10–15"]],
  // С 10.11 — тяни-толкай: толкающий день + квадрицепс, тянущий день + задняя поверхность бедра. Каждая мышца 2 раза в неделю.
  "Толкай А": [["Жим штанги лёжа", "6–8"], ["Приседания со штангой", "6–8"], ["Жим гантелей на наклонной скамье", "8–10"], ["Разгибания ног в тренажёре", "12–15"], ["Махи гантелями в стороны", "12–15"], ["Разгибания рук с канатом из-за головы", "10–12"], ["Подъёмы на носки стоя", "12–15"]],
  "Тяни А": [["Румынская тяга (лёгкий вес, спина прямая, гриф вдоль ног)", "8–10"], ["Подтягивания или тяга верхнего блока широким хватом", "8–12"], ["Тяга штанги в наклоне", "8–10"], ["Сгибания ног сидя", "10–12"], ["Тяга каната к лицу (задняя дельта, осанка)", "15–20"], ["Сгибания со штангой на бицепс", "10–12"], ["Подъёмы ног в висе", "10–15"]],
  "Толкай Б": [["Жим штанги стоя", "6–8"], ["Гакк-приседания (или жим ногами)", "8–10"], ["Жим гантелей лёжа (или брусья)", "8–10"], ["Болгарские выпады", "8–10 на ногу"], ["Махи гантелями в стороны", "12–15"], ["Разгибания рук на блоке", "12–15"], ["Подъёмы на носки сидя", "15"]],
  "Тяни Б": [["Тяга верхнего блока узким хватом", "10–12"], ["Ягодичный мост со штангой", "8–10"], ["Тяга горизонтального блока", "10–12"], ["Сгибания ног лёжа", "10–12"], ["Гиперэкстензия (спина ровная, без рывков)", "12–15"], ["Разведение гантелей в наклоне", "12–15"], ["Молотки с гантелями", "10–12"], ["Планка", "40–60 с"]],
};
// Рабочие веса: жим лёжа до перерыва — 98,5 кг на 1 раз (рост 182, вес 83).
// Неделя 1 (10.11): жим 40×8, присед 40×8, наклонная гантели 14×10, разгибания ног 30×12, махи 9×12, носки гантели 12,5×15.
const kg = (n, week, deload, date) => {
  const first = date <= "2026-11-10";
  const step = (arr, after) => week <= arr.length ? ` — ${arr[week - 1]} кг` : after;
  if (deload) return /^(Жим штанги|Приседания)/.test(n) ? " — −30–40% от рабочего" : " — лёгкий вес, −30–40%";
  if (/^Жим штанги лёжа/.test(n)) return step([40, 45, 50, 55], " — с 57,5 кг; сделал все подходы по 8 — +2,5 кг");
  if (/^Приседания со штангой/.test(n)) return step([40, 45, 50, 55], " — с 57,5 кг; сделал все подходы по 8 — +2,5 кг");
  if (/^Жим гантелей на наклонной/.test(n)) return first ? " — 14 кг" : " — 16 кг (прошлый раз 14×10); сделал все по 10 — +2 кг";
  if (/^Разгибания ног/.test(n)) return first ? " — 30 кг" : " — 30 кг, добери до 15 повторов; сделал все по 15 — 35 кг";
  if (/^Махи гантелями/.test(n)) return first ? " — 9 кг" : " — 9 кг, добери до 15 повторов. Если раскачиваешь корпус — 7 кг";
  if (/^Разгибания рук с канатом/.test(n)) return " (нет каната — одна гантель из-за головы двумя руками, 12–14 кг)";
  if (/^Подъёмы на носки стоя/.test(n)) return first ? " — гантели 12,5 кг" : " — гантели по 15 кг (прошлый раз 12,5×15), пауза 1 с внизу и вверху";
  // Толкай Б — первые веса от результатов 10.11
  if (/^Жим штанги стоя/.test(n)) return " — начни с 25 кг, запиши вес";
  if (/^Жим гантелей лёжа/.test(n)) return " — 16 кг";
  if (/^Гакк-приседания/.test(n)) return " — начни с +20 кг к платформе, запиши вес";
  if (/^Болгарские выпады/.test(n)) return " — первый раз без веса или гантели по 6 кг";
  if (/^Подъёмы на носки сидя/.test(n)) return " — 20 кг, запиши вес";
  // Тяни А / Тяни Б — первые веса (ещё не делал), потом по дневнику
  if (/^Румынская тяга/.test(n)) return " — начни с 40 кг, запиши вес";
  if (/^Тяга штанги в наклоне/.test(n)) return " — начни с 30 кг, запиши вес";
  if (/^Сгибания со штангой/.test(n)) return " — начни с 15–20 кг";
  if (/^Сгибания ног/.test(n)) return " — начни с 20–25 кг, запиши вес";
  if (/^Тяга верхнего блока узким/.test(n)) return " — начни с 35–40 кг";
  if (/^Ягодичный мост/.test(n)) return " — начни с 40 кг";
  if (/^Тяга горизонтального блока/.test(n)) return " — начни с 35 кг";
  if (/^Разведение гантелей в наклоне/.test(n)) return " — 5–6 кг";
  if (/^Молотки/.test(n)) return " — 10 кг";
  return "";
};
// Дневник: что сделано на тренировке (дата → текст), показывается в описании события
const GYM_LOG = {
  "2026-11-10": "Сделано: жим лёжа 2×8 40 кг; присед 2×8 40 кг; наклонная гантели 2×10 14 кг; разгибания ног 2×12 30 кг; махи 2×12 9 кг; трицепс — другое упражнение (не было каната); носки 2×15 гантели 12,5 кг.",
};
const plan = (date, key) => {
  const d = new Date(`${date}T12:00:00`);
  const week = Math.max(1, Math.floor((d - new Date("2026-11-08T00:00:00")) / 864e5 / 7) + 1);
  const deload = week > 4 && week % 8 === 1;
  const [sets, phase] = deload ? [2, "Неделя " + week + ": РАЗГРУЗКА — 2 подхода, вес −30–40%, 4 повтора в запасе. Дальше продолжаешь с прежних весов"]
    : week <= 2 ? [2, "Неделя " + week + ": 2 подхода, вес 50–60% от прежнего, оставляй 3–4 повтора в запасе"]
    : week <= 4 ? [3, "Неделя " + week + ": 3 подхода, вес +5–10% к прошлой неделе, 2–3 повтора в запасе"]
    : ["3–4", "Неделя " + week + ": 3–4 подхода, 1–2 повтора в запасе. Сделал верх диапазона во всех подходах — в следующий раз +2,5 кг в базе, +1–2 кг в изоляции"];
  return [...(GYM_LOG[date] ? [GYM_LOG[date], ""] : []), `${key}. ${phase}`, "Разминка 10 минут + 2 разминочных подхода в первом упражнении", "",
    ...WORKOUTS[key].map(([n, r], i) => `${i + 1}. ${n} — ${sets}×${r}${kg(n, week, deload, date)}`), "",
    "Темп: опускание 2–3 с, внизу без отскока. Отдых: 2–3 мин в базовых, 1–1,5 мин в остальных. Не успеваешь — убирай последнее упражнение. Острая боль — сразу стоп.",
    "В конце: записать веса и повторы в дневник тренировок.", "После зала: протеин — 30 г порошка на 250–300 мл воды или молока."].join("\n");
};
// Тренировки чередуются строго: верх, низ, верх, низ… начиная с 08.11 (Верх Б, Низ Б, Верх А, Низ А по кругу)
const slots = new Map();
const addSlot = (date, time, note) => {
  const s = new Date(`${date}T${time}:00`), en = new Date(s.getTime() + 2 * 3600e3);
  if (busy.some(([a, b]) => a < new Date(en.getTime() + ROAD_AFTER * 60e3) && b > new Date(s.getTime() - ROAD_BEFORE * 60e3))) return;
  slots.set(date, [s, en, note]);
};
for (let d = new Date(Math.max(monday, new Date("2026-11-08"))); d < end; d.setDate(d.getDate() + 1)) {
  const g = GYM[d.getDay()]; if (g && !GYM_SKIP.includes(iso(d))) addSlot(iso(d), g[0], "");
}
for (const [date, time, note] of GYM_EXTRA) addSlot(date, time, note);
const CYCLE = ["Верх Б", "Низ Б", "Верх А", "Низ А"];
// С 10.11 тяни-толкай: Толкай А → Тяни А → Толкай Б → Тяни Б по кругу (до этого — старый верх/низ)
const PP_START = "2026-11-10", PP_CYCLE = ["Толкай А", "Тяни А", "Толкай Б", "Тяни Б"];
let oldI = 0, ppI = 0;
[...slots.entries()].sort((a, b) => a[1][0] - b[1][0]).forEach(([date, [s, en, note]]) => {
  const key = date < PP_START ? CYCLE[oldI++ % 4] : PP_CYCLE[ppI++ % 4], title = `Зал — ${key.split(" ")[0].toLowerCase()}${note}`;
  const f = x => `${iso(x).replace(/-/g, "")}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
  lines.push("BEGIN:VEVENT", `UID:gym-${date}@spbu-25b05`, `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Moscow:${f(s)}`, `DTEND;TZID=Europe/Moscow:${f(en)}`,
    fold(`SUMMARY:🏋️ ${esc(title)}`), fold(`DESCRIPTION:${esc(plan(date, key))}`), "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Зал через час", "TRIGGER:-PT1H", "END:VALARM", "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:🏋️ Запиши веса и повторы в дневник тренировок", "TRIGGER;RELATED=END:-PT5M", "END:VALARM", "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:🥤 Выпей протеин", "TRIGGER;RELATED=END:PT0M", "END:VALARM", "END:VEVENT");
});

const gymLines = lines.splice(studyCount);
lines.push("END:VCALENDAR");
writeFileSync("spbu.ics", lines.join("\r\n") + "\r\n");
const gymHeader = header.map(l => l.startsWith("X-WR-CALNAME") ? "X-WR-CALNAME:Зал" : l);
writeFileSync("gym.ics", [...gymHeader, ...gymLines, "END:VCALENDAR"].join("\r\n") + "\r\n");
console.log(`OK: ${seen.size} занятий`);

// --- Вечерняя прогулка 22:00–22:20 только в дни без снега и сильных осадков (прогноз Open-Meteo, СПб) ---
try {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=59.94&longitude=30.31&daily=precipitation_sum,snowfall_sum,temperature_2m_min&timezone=Europe%2FMoscow&forecast_days=16";
  const w = process.env.WEATHER_JSON ? JSON.parse(process.env.WEATHER_JSON) : await (await fetch(url)).json();
  const { time, precipitation_sum: pr, snowfall_sum: sn, temperature_2m_min: tmin } = w.daily;
  const walks = [];
  time.forEach((d, i) => {
    const ok = sn[i] === 0 && pr[i] < 2 && tmin[i] > -3; // без снега, без дождя/слякоти, без гололёда
    if (!ok) return;
    const ymd = d.replace(/-/g, "");
    walks.push("BEGIN:VEVENT", `UID:walk-${ymd}@spbu-25b05`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Moscow:${ymd}T220000`, `DTEND;TZID=Europe/Moscow:${ymd}T222000`,
      "SUMMARY:🚶 Вечерняя прогулка 20 минут", "TRANSP:TRANSPARENT",
      fold(`DESCRIPTION:По прогнозу сухо: осадки ${pr[i]} мм\\, минимум ${tmin[i]} °C.`),
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Прогулка 20 минут", "TRIGGER:PT0M", "END:VALARM", "END:VEVENT");
  });
  let r = readFileSync("routine.ics", "utf8");
  r = r.replace(/BEGIN:VEVENT\r\nUID:walk-[\s\S]*?END:VEVENT\r\n/g, "");
  r = r.replace("END:VCALENDAR\r\n", walks.join("\r\n") + (walks.length ? "\r\n" : "") + "END:VCALENDAR\r\n");
  writeFileSync("routine.ics", r);
  console.log(`Прогулки: ${walks.length / 14} дней`);
} catch (e) { console.log("Погода недоступна, прогулки не обновлены:", e.message); }
