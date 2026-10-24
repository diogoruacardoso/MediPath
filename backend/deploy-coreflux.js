// Carrega as Actions de ../coreflux/medipath.lot para o Coreflux via MQTT.
// Remove primeiro as versões antigas (se existirem) e depois adiciona.
import fs from "node:fs";
import mqtt from "mqtt";

const BROKER = process.env.MQTT_URL || "mqtt://localhost:1883";
const file = new URL("../coreflux/medipath.lot", import.meta.url);
const blocos = fs.readFileSync(file, "utf8")
  .split(/^(?=DEFINE ACTION)/m).map((b) => b.trim()).filter(Boolean);
const nomes = blocos.map((b) => b.match(/DEFINE ACTION (\w+)/)[1]);
// Nomes antigos a limpar
const antigos = ["MedicationReminderRouter"];

const c = mqtt.connect(BROKER, { username: process.env.MQTT_USER, password: process.env.MQTT_PASS });

c.on("connect", () => {
  c.subscribe("$SYS/Coreflux/Command/Output");
  [...nomes, ...antigos].forEach((n) => c.publish("$SYS/Coreflux/Command", `-removeAction ${n}`));
  setTimeout(() => {
    blocos.forEach((b) => {
      console.log("➡️  A enviar:", b.split("\n")[0]);
      c.publish("$SYS/Coreflux/Command", `-addAction ${b}`);
    });
  }, 2000);
  setTimeout(() => { console.log("(fim)"); c.end(); }, 7000);
});

c.on("message", (_t, buf) => console.log("⬅️  Coreflux:", buf.toString().slice(0, 160)));
c.on("error", (e) => { console.error("Erro MQTT:", e.message); c.end(); });
