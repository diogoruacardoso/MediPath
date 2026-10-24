import { useEffect, useState } from "react";

const SINTOMAS = [
  "Dor no peito",
  "Dor que se estende ao braço",
  "Dificuldade em respirar",
  "Febre",
  "Tosse",
  "Dor de cabeça",
  "Dor de garganta",
  "Náuseas",
  "Tonturas",
  "Cansaço",
];

const NIVEIS = {
  urgente: { titulo: "Procure ajuda urgente", classe: "urgente" },
  atencao: { titulo: "Contacte um profissional de saúde", classe: "atencao" },
  geral: { titulo: "Informação geral", classe: "geral" },
};

async function api(url, body) {
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const dados = await r.json();
  if (!r.ok) throw new Error(dados.erro || "Erro inesperado.");
  return dados;
}

function descreverEvento(e) {
  const p = e.payload || {};
  if (e.topic.endsWith("triage/alerts"))
    return `Alerta de triagem (nível ${p.nivel}) — sintomas: ${(p.sintomas || []).join(", ")}`;
  if (e.topic.endsWith("medication/reminders"))
    return `⏰ É hora do seu medicamento: ${p.nome} — ${p.dose} (plano das ${p.horario})`;
  if (e.topic.endsWith("medication/confirmed"))
    return `Plano confirmado pelo Coreflux: ${p.nome} — lembrete agendado para as ${p.horario}`;
  return JSON.stringify(p);
}

export default function App() {
  const [selecionados, setSelecionados] = useState([]);
  const [inicio, setInicio] = useState("");
  const [intensidade, setIntensidade] = useState(3);
  const [descricao, setDescricao] = useState("");
  const [resultado, setResultado] = useState(null);

  const [med, setMed] = useState({ nome: "", dose: "", horario: "09:00", indicado: false, demo: false });
  const [msgMed, setMsgMed] = useState(null);

  const [historico, setHistorico] = useState({ sintomas: [], medicacao: [] });
  const [eventos, setEventos] = useState([]);
  const [erro, setErro] = useState(null);

  const carregarHistorico = () => api("/api/history").then(setHistorico).catch(() => {});

  useEffect(() => {
    carregarHistorico();
    api("/api/events")
      .then((lista) =>
        setEventos(
          lista.map((e) => ({ topic: e.topic, payload: JSON.parse(e.payload), ts: e.created_at }))
        )
      )
      .catch(() => {});

    const es = new EventSource("/api/stream");
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.topic === "sistema") return;
      setEventos((antes) => [e, ...antes].slice(0, 30));
    };
    return () => es.close();
  }, []);

  const alternar = (s) =>
    setSelecionados((a) => (a.includes(s) ? a.filter((x) => x !== s) : [...a, s]));

  async function enviarSintomas(ev) {
    ev.preventDefault();
    setErro(null);
    try {
      const r = await api("/api/symptoms", {
        sintomas: selecionados.map((s) => s.toLowerCase()),
        inicio,
        intensidade,
        descricao,
      });
      setResultado(r);
      carregarHistorico();
    } catch (e) {
      setErro(e.message);
    }
  }

  async function enviarMedicacao(ev) {
    ev.preventDefault();
    setMsgMed(null);
    try {
      const r = await api("/api/medications", {
        nome: med.nome,
        dose: med.dose,
        horario: med.horario,
        indicadoPorProfissional: med.indicado,
        demo: med.demo,
      });
      setMsgMed({
        ok: true,
        texto: r.lembrete.agendado
          ? r.lembrete.demo
            ? "Plano registado. O Coreflux vai emitir o lembrete dentro de 20 segundos…"
            : `Plano registado. O Coreflux vai emitir o lembrete às ${med.horario} (hora de Lisboa).`
          : "Plano registado, mas o broker está offline e o lembrete não foi agendado.",
      });
      setMed({ nome: "", dose: "", horario: "09:00", indicado: false, demo: false });
      carregarHistorico();
    } catch (e) {
      setMsgMed({ ok: false, texto: e.message });
    }
  }

  async function limpar() {
    await api("/api/reset", {});
    setResultado(null);
    setEventos([]);
    carregarHistorico();
  }

  const nivel = resultado && NIVEIS[resultado.nivel];

  return (
    <div className="app">
      <header>
        <h1>MediPath</h1>
        <p>Organize sintomas e medicação. Demonstração com dados fictícios.</p>
      </header>

      <main>
        <section className="cartao">
          <h2>1. Registar sintomas</h2>
          <form onSubmit={enviarSintomas}>
            <div className="chips">
              {SINTOMAS.map((s) => (
                <label key={s} className={selecionados.includes(s) ? "chip ativo" : "chip"}>
                  <input
                    type="checkbox"
                    checked={selecionados.includes(s)}
                    onChange={() => alternar(s)}
                  />
                  {s}
                </label>
              ))}
            </div>
            <label>
              Quando começaram?
              <input value={inicio} onChange={(e) => setInicio(e.target.value)} placeholder="ex.: ontem à noite" />
            </label>
            <label>
              Intensidade: <strong>{intensidade}</strong>/10
              <input type="range" min="1" max="10" value={intensidade}
                onChange={(e) => setIntensidade(Number(e.target.value))} />
            </label>
            <label>
              Descrição (opcional)
              <textarea rows="2" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </label>
            <button disabled={selecionados.length === 0}>Obter orientação</button>
          </form>
          {erro && <p className="erro">{erro}</p>}

          {resultado && (
            <div className={`resultado ${nivel.classe}`} role="alert">
              <h3>{nivel.titulo}</h3>
              <p>{resultado.mensagem}</p>
              {resultado.nivel === "urgente" && <p className="grande">Emergência em Portugal: 112</p>}
            </div>
          )}
        </section>

        <section className="cartao">
          <h2>2. Plano de medicação</h2>
          <p className="nota">Registe apenas um plano já indicado por um profissional de saúde.</p>
          <form onSubmit={enviarMedicacao}>
            <label>
              Medicamento
              <input value={med.nome} onChange={(e) => setMed({ ...med, nome: e.target.value })} required />
            </label>
            <label>
              Dose
              <input value={med.dose} onChange={(e) => setMed({ ...med, dose: e.target.value })}
                placeholder="ex.: 1 comprimido" required />
            </label>
            <label>
              Hora
              <input type="time" value={med.horario}
                onChange={(e) => setMed({ ...med, horario: e.target.value })} required />
            </label>
            <label className="check">
              <input type="checkbox" checked={med.indicado}
                onChange={(e) => setMed({ ...med, indicado: e.target.checked })} />
              Confirmo que este plano foi indicado por um profissional de saúde.
            </label>
            <label className="check">
              <input type="checkbox" checked={med.demo}
                onChange={(e) => setMed({ ...med, demo: e.target.checked })} />
              Modo demonstração: emitir o lembrete daqui a 20 segundos.
            </label>
            <button disabled={!med.indicado}>Registar plano</button>
          </form>
          {msgMed && <p className={msgMed.ok ? "ok" : "erro"}>{msgMed.texto}</p>}
        </section>

        <section className="cartao largo">
          <h2>3. Eventos processados pelo Coreflux <span className="ao-vivo">● ao vivo</span></h2>
          {eventos.length === 0 ? (
            <p className="nota">Ainda sem eventos. Registe sintomas com sinais de alerta ou um plano de medicação.</p>
          ) : (
            <ul className="eventos">
              {eventos.map((e, i) => (
                <li key={i} className={e.topic.includes("alerts") ? "alerta" : e.topic.includes("reminders") ? "lembrete" : "info"}>
                  <code>{e.topic}</code>
                  <span>{descreverEvento(e)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cartao largo">
          <h2>Histórico</h2>
          <div className="duas">
            <div>
              <h3>Sintomas</h3>
              {historico.sintomas.length === 0 ? <p className="nota">Sem registos.</p> : (
                <ul>{historico.sintomas.map((s) => (
                  <li key={s.id}>{s.sintomas} — intensidade {s.intensidade} ({s.nivel})</li>
                ))}</ul>
              )}
            </div>
            <div>
              <h3>Medicação</h3>
              {historico.medicacao.length === 0 ? <p className="nota">Sem registos.</p> : (
                <ul>{historico.medicacao.map((m) => (
                  <li key={m.id}>{m.nome} — {m.dose} às {m.horario}</li>
                ))}</ul>
              )}
            </div>
          </div>
          <button className="secundario" onClick={limpar}>Limpar dados da demonstração</button>
        </section>
      </main>

      <footer>
        Esta aplicação é uma demonstração com dados fictícios. Não faz diagnósticos, não
        recomenda medicamentos e não substitui aconselhamento médico. Em emergência, ligue 112.
      </footer>
    </div>
  );
}
