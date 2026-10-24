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
const client = mqtt.connect(MQTT_URL, { reconnectPeriod: 3000 });
let mqttOk = false;

client.on("connect", () => {
  mqttOk = true;
  console.log("✅ Ligado ao broker MQTT:", MQTT_URL);
  client.subscribe([T.alerts, T.reminders]);
});
client.on("close", () => { mqttOk = false; });
client.on("error", (e) => console.log("⚠️  MQTT:", e.message));

// Mensagens que o Coreflux publica de volta
client.on("message", (topic, buf) => {
  let payload;
  try { payload = JSON.parse(buf.toString()); } catch { payload = { raw: buf.toString() }; }
  db.prepare("INSERT INTO events (topic, payload) VALUES (?, ?)").run(topic, JSON.stringify(payload));
  emitir({ topic, payload, origem: "coreflux", ts: new Date().toISOString() });
});

function publicar(topic, payload) {
  if (!mqttOk) {
    console.log("⚠️  Broker offline, não publiquei:", topic);
    return false;
  }
  client.publish(topic, JSON.stringify(payload));
  return true;
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
    ts: new Date().toISOString(),
  });

  // A resposta de segurança NÃO depende do broker
  res.status(201).json({ id: Number(info.lastInsertRowid), ...resultado, publicadoNoBroker: publicado });
});

app.post("/api/medications", (req, res) => {
  const { nome, dose, horario, indicadoPorProfissional } = req.body;
  if (!nome || !dose || !/^\d{2}:\d{2}$/.test(horario || ""))
    return res.status(400).json({ erro: "Preencha nome, dose e horário (HH:MM)." });
  if (indicadoPorProfissional !== true)
    return res.status(400).json({
      erro: "Só é possível registar planos já indicados por um profissional de saúde.",
    });

  const info = db
    .prepare("INSERT INTO medications (nome, dose, horario) VALUES (?,?,?)")
    .run(nome, dose, horario);

  const publicado = publicar(T.medReg, {
    id: Number(info.lastInsertRowid),
    nome, dose, horario,
    ts: new Date().toISOString(),
  });

  res.status(201).json({ id: Number(info.lastInsertRowid), publicadoNoBroker: publicado });
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
