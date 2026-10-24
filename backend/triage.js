// Triagem DETERMINISTA e conservadora. Corre no backend, sem depender do broker.
// Nunca faz diagnóstico nem recomenda medicamentos.

const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const SINAIS_URGENTES = [
  "dor no peito", "aperto no peito", "dor no braco", "dor que se estende ao braco",
  "dificuldade em respirar", "falta de ar", "desmaio", "perda de consciencia",
  "confusao subita", "fraqueza num lado", "boca ao lado", "dificuldade em falar",
  "hemorragia intensa", "convulsao", "reacao alergica grave", "inchaço na garganta",
  "pensamentos de me magoar",
];

const SINAIS_ATENCAO = [
  "febre", "vomitos", "diarreia persistente", "dor intensa", "tonturas",
  "dor de cabeca forte",
];

export function triagem({ sintomas = [], descricao = "", intensidade = 0 }) {
  const texto = norm([...sintomas, descricao].join(" | "));

  if (SINAIS_URGENTES.some((s) => texto.includes(norm(s)))) {
    return {
      nivel: "urgente",
      procurarAjuda: true,
      mensagem:
        "Os sintomas indicados podem ser sinais de alerta. Ligue já 112 (emergência em Portugal) ou dirija-se ao serviço de urgência mais próximo. Não espere por uma consulta de rotina.",
    };
  }

  if (Number(intensidade) >= 8 || SINAIS_ATENCAO.some((s) => texto.includes(norm(s)))) {
    return {
      nivel: "atencao",
      procurarAjuda: true,
      mensagem:
        "Recomenda-se contactar um profissional de saúde em breve (médico de família ou SNS 24: 808 24 24 24). Se piorar ou surgirem sinais de alerta, ligue 112.",
    };
  }

  return {
    nivel: "geral",
    procurarAjuda: false,
    mensagem:
      "Informação geral: descanse, mantenha-se hidratado e vigie a evolução. Se os sintomas persistirem, piorarem ou surgirem sinais de alerta (dor no peito, falta de ar, desmaio), procure ajuda. Esta aplicação não faz diagnósticos nem recomenda medicamentos.",
  };
}
