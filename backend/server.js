import express from "express";
import cors from "cors";
import mqtt from "mqtt";
import { db } from "./db.js";
import { triagem } from "./triage.js";

const PORT = process.env.PORT || 3001;
const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";

const T = {
  symptoms: "medipath/symptoms/submitted",
  alerts: "medipath/triage/alerts",
  medReg: "medipath/medication/registered",
  reminders: "medipath/medication/reminders",
  confirmed: "medipath/medication/confirmed",
  cmd: "$SYS/Coreflux/Command",
  cmdOut: "$SYS/Coreflux/Command/Output",
};

const app = express();
app.use(cors());
app.use(express.json());

// ---------- SSE: envia eventos ao browser em tempo real ----------
const clientes = new Set();
function emitir(evento) {
  const msg = `data: ${JSON.stringify(evento)}\n\n`;
  clientes.forEach((res) => res.write(msg));
}

app.get("/api/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ topic: "sistema", payload: { msg: "ligado" } })}\n\n`);
  clientes.add(res);
  req.on("close", () => clientes.delete(res));
});

// ---------- MQTT (Coreflux) ----------
const client = mqtt.connect(MQTT_URL, {
  reconnectPeriod: 3000,
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
});
let mqttOk = false;

client.on("connect", () => {
  mqttOk = true;
  console.log("✅ Ligado ao broker MQTT:", MQTT_URL);
  client.subscribe([T.alerts, T.reminders, T.confirmed, T.cmdOut]);
});
client.on("close", () => { mqttOk = false; });
client.on("error", (e) => console.log("⚠️  MQTT:", e.message));

// Mensagens que o Coreflux publica de volta
client.on("message", (topic, buf) => {
  if (topic === T.cmdOut) { console.log("Coreflux:", buf.toString().slice(0, 200)); return; }
  let payload;
  try { payload = JSON.parse(buf.toString()); } catch { payload = { raw: buf.toString() }; }
  db.prepare("INSERT INTO events (topic, payload) VALUES (?, ?)").run(topic, JSON.stringify(payload));
  emitir({ topic, payload, origem: "coreflux", ts: new Date().toISOString() });
});

function publicar(topic, payload, raw = false) {
  if (!mqttOk) {
    console.log("⚠️  Broker offline, não publiquei:", topic);
    return false;
  }
  client.publish(topic, raw ? payload : JSON.stringify(payload));
  return true;
}


// ---------- Agendamento do lembrete dentro do Coreflux ----------
const TZ = "Europe/Lisbon";

// Evita injeção de código LoT: só letras, números e pontuação simples.
const limpar = (t) =>
  String(t).replace(/[^\p{L}\p{N} .,%/-]/gu, "").trim().slice(0, 40);

function partesNoFuso(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(date).map((x) => [x.type, x.value])
  );
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

// Diferença (ms) entre a hora de Lisboa e UTC num dado instante
function offsetLisboa(date) {
  const q = partesNoFuso(date);
  return Date.UTC(q.y, q.mo - 1, q.d, q.h, q.mi, q.s) - Math.floor(date.getTime() / 1000) * 1000;
}

function proximaOcorrenciaUTC(horario) {
  const [h, mi] = horario.split(":").map(Number);
  const agora = new Date();
  const hoje = partesNoFuso(agora);
  for (let dia = 0; dia < 2; dia++) {
    const guess = Date.UTC(hoje.y, hoje.mo - 1, hoje.d + dia, h, mi, 0);
    let utc = guess - offsetLisboa(new Date(guess));
    utc = guess - offsetLisboa(new Date(utc)); // refina à volta da mudança de hora
    if (utc > agora.getTime() + 5000) return new Date(utc);
  }
}

const dois = (n) => String(n).padStart(2, "0");
const formatoLoT = (d) =>
  `${dois(d.getUTCDate())}-${dois(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ` +
  `${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}:${dois(d.getUTCSeconds())}`;

function agendarLembrete(id, med, quando) {
  const payload = JSON.stringify({ id, nome: med.nome, dose: med.dose, horario: med.horario, tipo: "lembrete" })
    .replace(/"/g, '\\"');
  const lot =
    `DEFINE ACTION Reminder_${id}\n` +
    `ON TIMESTAMP "${formatoLoT(quando)}" DO\n` +
    `    PUBLISH TOPIC "${T.reminders}" WITH "${payload}"`;
  return publicar(T.cmd, `-addAction ${lot}`, true);
}

// ---------- API ----------
app.post("/api/symptoms", (req, res) => {
  const { sintomas, inicio, intensidade, descricao } = req.body;
  if (!Array.isArray(sintomas) || sintomas.length === 0)
    return res.status(400).json({ erro: "Indique pelo menos um sintoma." });

  const resultado = triagem({ sintomas, descricao, intensidade });

  const info = db
    .prepare("INSERT INTO symptoms (sintomas, inicio, intensidade, descricao, nivel) VALUES (?,?,?,?,?)")
    .run(sintomas.join(", "), inicio || null, Number(intensidade) || null, descricao || null, resultado.nivel);

  const publicado = publicar(T.symptoms, {
    id: Number(info.lastInsertRowid),
    sintomas,
    intensidade: Number(intensidade) || 0,
    nivel: resultado.nivel,
    urgencia: { geral: 0, atencao: 1, urgente: 2 }[resultado.nivel], // número, para o LoT comparar
    ts: new Date().toISOString(),
  });

  // A resposta de segurança NÃO depende do broker
  res.status(201).json({ id: Number(info.lastInsertRowid), ...resultado, publicadoNoBroker: publicado });
});

app.post("/api/medications", (req, res) => {
  const { indicadoPorProfissional, demo } = req.body;
  const nome = limpar(req.body.nome || "");
  const dose = limpar(req.body.dose || "");
  const horario = req.body.horario || "";
  if (!nome || !dose || !/^([01]\d|2[0-3]):[0-5]\d$/.test(horario))
    return res.status(400).json({ erro: "Preencha nome, dose e horário (HH:MM). Use só letras e números." });
  if (indicadoPorProfissional !== true)
    return res.status(400).json({
      erro: "Só é possível registar planos já indicados por um profissional de saúde.",
    });

  const info = db
    .prepare("INSERT INTO medications (nome, dose, horario) VALUES (?,?,?)")
    .run(nome, dose, horario);
  const id = Number(info.lastInsertRowid);

  const publicado = publicar(T.medReg, { id, nome, dose, horario, ts: new Date().toISOString() });

  const quando = demo
    ? new Date(Math.floor(Date.now() / 1000) * 1000 + 20000)
    : proximaOcorrenciaUTC(horario);
  const agendado = agendarLembrete(id, { nome, dose, horario }, quando);

  res.status(201).json({
    id,
    publicadoNoBroker: publicado,
    lembrete: { agendado, quandoUTC: quando.toISOString(), demo: !!demo },
  });
});

app.get("/api/history", (_req, res) => {
  res.json({
    sintomas: db.prepare("SELECT * FROM symptoms ORDER BY id DESC").all(),
    medicacao: db.prepare("SELECT * FROM medications ORDER BY id DESC").all(),
  });
});

app.get("/api/events", (_req, res) => {
  res.json(db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 50").all());
});

app.get("/api/health", (_req, res) => res.json({ ok: true, mqtt: mqttOk }));

// Só para a demo: limpar dados
app.post("/api/reset", (_req, res) => {
  ["symptoms", "medications", "events"].forEach((t) => db.exec(`DELETE FROM ${t}`));
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`🚀 Backend em http://localhost:${PORT}`));
