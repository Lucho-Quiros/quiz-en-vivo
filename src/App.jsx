import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════════════
//  QUIZ EN VIVO · versión multi-dispositivo con Supabase Realtime
// --------------------------------------------------------------------
//  Rutas:
//    /            → PRESENTADOR (pantalla grande con QR)
//    /join?pin=…  → PARTICIPANTE (móvil, a donde apunta el QR)
//
//  Configura tus claves en variables de entorno (Vercel → Settings → Env):
//    VITE_SUPABASE_URL       = https://xxxx.supabase.co
//    VITE_SUPABASE_ANON_KEY  = eyJ...
// ════════════════════════════════════════════════════════════════════

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const QUESTION_TIME = 20; // segundos por pregunta
const PALETTE = ["#e8453c", "#1368ce", "#d89e00", "#26890c"];
const SHAPES = ["▲", "◆", "●", "■"];

// La URL pública donde despliegas la app (para el QR). En producción
// usa la de Vercel; aquí la deducimos del propio navegador.
const APP_ORIGIN = typeof window !== "undefined" ? window.location.origin : "";

export default function App() {
  const isJoin = typeof window !== "undefined" && window.location.pathname.startsWith("/join");
  return (
    <>
      <style>{globalCss}</style>
      {isJoin ? <Participant /> : <Presenter />}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
//  Hook: suscripción en tiempo real a una sala
// ════════════════════════════════════════════════════════════════════
function useGame(gameId) {
  const [game, setGame] = useState(null);
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    if (!gameId) return;
    let active = true;

    // Carga inicial
    (async () => {
      const { data: g } = await supabase.from("games").select("*").eq("id", gameId).single();
      const { data: ps } = await supabase.from("players").select("*").eq("game_id", gameId);
      if (active) {
        setGame(g);
        setPlayers(ps || []);
      }
    })();

    // Suscripción a cambios en la sala y en los jugadores
    const channel = supabase
      .channel(`game_${gameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${gameId}` },
        (payload) => setGame(payload.new))
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `game_id=eq.${gameId}` },
        () => refreshPlayers(gameId, setPlayers))
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [gameId]);

  return { game, players, setGame };
}

async function refreshPlayers(gameId, setPlayers) {
  const { data } = await supabase.from("players").select("*").eq("game_id", gameId).order("score", { ascending: false });
  setPlayers(data || []);
}

// ════════════════════════════════════════════════════════════════════
//  PRESENTADOR
// ════════════════════════════════════════════════════════════════════
function Presenter() {
  const [gameId, setGameId] = useState(null);
  const { game, players } = useGame(gameId);

  // Crea la sala al cargar
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("create_game");
      if (!error && data) setGameId(data.id);
      console.error("Fallo en Supabase:", error);
    })();
  }, []);

  const setPhase = async (patch) => {
    await supabase.from("games").update(patch).eq("id", gameId);
  };
  const startQuestion = () => setPhase({ phase: "question", question_started_at: new Date().toISOString() });
  const reveal = () => setPhase({ phase: "reveal" });
  const next = () => {
    const isLast = game.q_index >= game.questions.length - 1;
    if (isLast) setPhase({ phase: "podium" });
    else setPhase({ phase: "question", q_index: game.q_index + 1, question_started_at: new Date().toISOString() });
  };
  const restart = async () => {
    await supabase.from("players").update({ score: 0, last_answer: null, answered_q: -1 }).eq("game_id", gameId);
    setPhase({ phase: "lobby", q_index: 0, question_started_at: null });
  };

  if (!game) return <Center>Creando sala…</Center>;

  return (
    <div style={styles.root}>
      <div style={styles.stage}>
        {game.phase === "lobby" && <LobbyPresenter game={game} players={players} onStart={startQuestion} />}
        {game.phase === "question" && <QuestionPresenter game={game} players={players} onReveal={reveal} />}
        {game.phase === "reveal" && <RevealPresenter game={game} players={players} onNext={next} />}
        {game.phase === "podium" && <Podium players={players} onRestart={restart} />}
      </div>
    </div>
  );
}

function LobbyPresenter({ game, players, onStart }) {
  const joinUrl = `${APP_ORIGIN}/join?pin=${game.pin}`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=${encodeURIComponent(joinUrl)}`;
  return (
    <div className="fade-in" style={styles.lobby}>
      <div>
        <p style={styles.kicker}>CURSO PROFESIONAL · SESIÓN EN VIVO</p>
        <h1 style={styles.lobbyTitle}>Únete a la sala</h1>
        <p style={styles.lobbySub}>Escanea el QR con tu móvil</p>
        <div style={styles.codeBox}>
          <span style={styles.codeLabel}>PIN del juego</span>
          <span style={styles.codeNum}>{game.pin.replace(/(\d{3})(\d{3})/, "$1 $2")}</span>
        </div>
      </div>
      <div style={styles.lobbyRight}>
        <div style={styles.qrCard}><img src={qr} alt="QR" width={240} height={240} style={{ display: "block" }} /></div>
        <div style={styles.playerCount}><strong>{players.length}</strong> {players.length === 1 ? "participante" : "participantes"}</div>
        <div style={styles.playerChips}>
          {players.map((p) => <span key={p.id} className="pop-in" style={styles.chip}>{p.name}</span>)}
        </div>
        <button onClick={onStart} disabled={players.length === 0} style={{ ...styles.bigBtn, opacity: players.length ? 1 : 0.4 }}>Empezar →</button>
      </div>
    </div>
  );
}

function QuestionPresenter({ game, players, onReveal }) {
  const q = game.questions[game.q_index];
  const [left, setLeft] = useState(QUESTION_TIME);
  useEffect(() => {
    const t = setInterval(() => {
      const elapsed = (Date.now() - new Date(game.question_started_at).getTime()) / 1000;
      setLeft(Math.max(0, Math.ceil(QUESTION_TIME - elapsed)));
    }, 250);
    return () => clearInterval(t);
  }, [game.question_started_at]);
  const answered = players.filter((p) => p.answered_q === game.q_index).length;
  return (
    <div className="fade-in" style={styles.question}>
      <div style={styles.qHeader}>
        <span style={styles.qNum}>Pregunta {game.q_index + 1} / {game.questions.length}</span>
        <div style={styles.timer}>{left}</div>
        <span style={styles.qNum}>{answered} respuesta{answered !== 1 ? "s" : ""}</span>
      </div>
      <h1 style={styles.qText}>{q.q}</h1>
      <div style={styles.optGrid}>
        {q.options.map((o, i) => (
          <div key={i} style={{ ...styles.optCard, background: PALETTE[i] }}>
            <span style={styles.optShape}>{SHAPES[i]}</span><span>{o}</span>
          </div>
        ))}
      </div>
      <button onClick={onReveal} style={styles.ghostBtn}>Mostrar respuesta →</button>
    </div>
  );
}

function RevealPresenter({ game, players, onNext }) {
  const q = game.questions[game.q_index];
  const counts = [0, 0, 0, 0];
  players.forEach((p) => { if (p.answered_q === game.q_index && p.last_answer != null) counts[p.last_answer]++; });
  const max = Math.max(1, ...counts);
  const isLast = game.q_index >= game.questions.length - 1;
  return (
    <div className="fade-in" style={styles.question}>
      <h1 style={styles.qText}>{q.q}</h1>
      <div style={styles.barRow}>
        {q.options.map((o, i) => (
          <div key={i} style={styles.barCol}>
            <div style={{ ...styles.bar, height: `${40 + (counts[i] / max) * 200}px`, background: PALETTE[i], opacity: i === q.correct ? 1 : 0.35 }}>
              <span style={styles.barCount}>{counts[i]}</span>
            </div>
            <div style={{ ...styles.barLabel, fontWeight: i === q.correct ? 800 : 500 }}>{SHAPES[i]} {i === q.correct ? "✓ " : ""}{o}</div>
          </div>
        ))}
      </div>
      <button onClick={onNext} style={styles.bigBtn}>{isLast ? "Ver podio 🏆" : "Siguiente pregunta →"}</button>
    </div>
  );
}

function Podium({ players, onRestart }) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 3);
  const order = [1, 0, 2];
  const heights = { 0: 220, 1: 160, 2: 120 };
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div className="fade-in" style={styles.podiumWrap}>
      <h1 style={styles.podiumTitle}>🏆 Resultados finales</h1>
      <div style={styles.podiumRow}>
        {order.map((rank) => top[rank] ? (
          <div key={rank} className="rise" style={styles.podiumCol}>
            <span style={styles.podiumMedal}>{medals[rank]}</span>
            <span style={styles.podiumName}>{top[rank].name}</span>
            <span style={styles.podiumScore}>{top[rank].score} pts</span>
            <div style={{ ...styles.podiumBlock, height: heights[rank] }}>{rank + 1}</div>
          </div>
        ) : <div key={rank} style={{ width: 140 }} />)}
      </div>
      {ranked.length > 3 && (
        <div style={styles.restList}>
          {ranked.slice(3).map((p, i) => (
            <div key={p.id} style={styles.restRow}><span>{i + 4}. {p.name}</span><span>{p.score} pts</span></div>
          ))}
        </div>
      )}
      <button onClick={onRestart} style={styles.ghostBtn}>Reiniciar juego</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  PARTICIPANTE (móvil)
// ════════════════════════════════════════════════════════════════════
function Participant() {
  const pin = new URLSearchParams(window.location.search).get("pin") || "";
  const [gameId, setGameId] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [playerId, setPlayerId] = useState(() => localStorage.getItem(`pid_${pin}`) || null);
  const [nameInput, setNameInput] = useState("");
  const { game, players } = useGame(gameId);
  const me = players.find((p) => p.id === playerId);

  // Resuelve el PIN → game_id
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("games").select("id").eq("pin", pin).single();
      if (data) setGameId(data.id);
      else setNotFound(true);
    })();
  }, [pin]);

  const join = async () => {
    const name = nameInput.trim();
    if (!name || !gameId) return;
    const { data } = await supabase.from("players").insert({ game_id: gameId, name }).select().single();
    if (data) {
      setPlayerId(data.id);
      localStorage.setItem(`pid_${pin}`, data.id);
    }
  };

  const answer = async (optIndex) => {
    if (!me || me.answered_q === game.q_index) return;
    const q = game.questions[game.q_index];
    const elapsedMs = Date.now() - new Date(game.question_started_at).getTime();
    const correct = optIndex === q.correct;
    const speedBonus = Math.max(0, 1000 - Math.floor((elapsedMs / (QUESTION_TIME * 1000)) * 1000));
    const gained = correct ? 500 + speedBonus : 0;
    await supabase.from("players")
      .update({ last_answer: optIndex, answered_q: game.q_index, score: me.score + gained })
      .eq("id", me.id);
  };

  if (notFound) return <Center>No se encontró una sala con ese PIN.</Center>;
  if (!game) return <Center>Conectando…</Center>;

  if (!me) {
    return (
      <div style={styles.participantBg}>
        <div className="fade-in" style={styles.phone}>
          <p style={styles.kicker}>UNIRSE AL JUEGO</p>
          <h2 style={styles.joinH}>Tu nombre</h2>
          <p style={styles.joinHint}>PIN {pin.replace(/(\d{3})(\d{3})/, "$1 $2")}</p>
          <input value={nameInput} onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && join()} placeholder="Escribe tu nombre…" maxLength={16} style={styles.input} />
          <button onClick={join} disabled={!nameInput.trim()} style={{ ...styles.joinBtn, opacity: nameInput.trim() ? 1 : 0.4 }}>Entrar</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.participantBg}>
      <div style={styles.phone}>
        <div style={styles.phoneHeader}>
          <span style={styles.phoneName}>👤 {me.name}</span>
          <span style={styles.phoneScore}>{me.score} pts</span>
        </div>
        {game.phase === "lobby" && (
          <div style={styles.phoneCenter}><div className="pulse" style={styles.bigEmoji}>✅</div>
            <p style={styles.phoneMsg}>¡Estás dentro!</p><p style={styles.phoneSub}>Mira la pantalla principal.</p></div>
        )}
        {game.phase === "question" && (
          me.answered_q === game.q_index ? (
            <div style={styles.phoneCenter}><div className="pulse" style={styles.bigEmoji}>⏳</div>
              <p style={styles.phoneMsg}>Respuesta enviada</p><p style={styles.phoneSub}>Espera a los demás…</p></div>
          ) : (
            <div style={styles.answerGrid}>
              {game.questions[game.q_index].options.map((_, i) => (
                <button key={i} onClick={() => answer(i)} style={{ ...styles.answerBtn, background: PALETTE[i] }}>
                  <span style={styles.answerShape}>{SHAPES[i]}</span>
                </button>
              ))}
            </div>
          )
        )}
        {game.phase === "reveal" && (
          <div style={styles.phoneCenter}>
            {me.last_answer === game.questions[game.q_index].correct ? (
              <><div className="pop-in" style={styles.bigEmoji}>🎉</div><p style={{ ...styles.phoneMsg, color: "#26890c" }}>¡Correcto!</p></>
            ) : (
              <><div className="pop-in" style={styles.bigEmoji}>😕</div><p style={{ ...styles.phoneMsg, color: "#e8453c" }}>Incorrecto</p></>
            )}
            <p style={styles.phoneSub}>{me.score} puntos en total</p>
          </div>
        )}
        {game.phase === "podium" && (
          <div style={styles.phoneCenter}><div className="pop-in" style={styles.bigEmoji}>🏁</div>
            <p style={styles.phoneMsg}>¡Juego terminado!</p><p style={styles.phoneSub}>Tu puntuación: {me.score} pts</p></div>
        )}
      </div>
    </div>
  );
}

function Center({ children }) {
  return <div style={styles.root}><div style={{ ...styles.stage, fontSize: 22, opacity: .8 }}>{children}</div></div>;
}

// ════════════════════════════════════════════════════════════════════
//  ESTILOS  (idénticos al prototipo, reutilizables)
// ════════════════════════════════════════════════════════════════════
const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,900&family=Outfit:wght@400;500;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background:#0d0420; }
  .fade-in { animation: fadeIn .5s ease both; }
  .pop-in { animation: popIn .4s cubic-bezier(.2,1.4,.4,1) both; }
  .rise { animation: rise .6s cubic-bezier(.2,1,.4,1) both; }
  .pulse { animation: pulse 1.6s ease-in-out infinite; }
  @keyframes fadeIn { from {opacity:0;transform:translateY(12px);} to {opacity:1;transform:none;} }
  @keyframes popIn { from {opacity:0;transform:scale(.6);} to {opacity:1;transform:scale(1);} }
  @keyframes rise { from {opacity:0;transform:translateY(40px);} to {opacity:1;transform:none;} }
  @keyframes pulse { 0%,100%{transform:scale(1);} 50%{transform:scale(1.12);} }
  button { cursor:pointer; font-family:'Outfit',sans-serif; border:none; transition:transform .12s,filter .12s; }
  button:hover:not(:disabled){filter:brightness(1.07);} button:active:not(:disabled){transform:scale(.97);}
`;

const styles = {
  root: { fontFamily: "'Outfit',sans-serif", minHeight: "100vh", background: "radial-gradient(circle at 20% 10%,#3a1078,#1a0938 55%,#0d0420)", color: "#fff" },
  stage: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 },
  lobby: { display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 60, maxWidth: 1100, width: "100%", alignItems: "center" },
  kicker: { fontSize: 13, letterSpacing: 3, color: "#c9a8ff", fontWeight: 700, marginBottom: 14 },
  lobbyTitle: { fontFamily: "'Fraunces',serif", fontSize: 64, fontWeight: 900, lineHeight: 1, marginBottom: 14 },
  lobbySub: { fontSize: 18, opacity: .75, marginBottom: 28 },
  codeBox: { display: "inline-flex", flexDirection: "column", gap: 4, padding: "18px 32px", borderRadius: 18, background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)" },
  codeLabel: { fontSize: 12, letterSpacing: 2, opacity: .6 },
  codeNum: { fontSize: 44, fontWeight: 800, letterSpacing: 4, fontFamily: "'Fraunces',serif" },
  lobbyRight: { display: "flex", flexDirection: "column", alignItems: "center", gap: 18 },
  qrCard: { padding: 16, background: "#fff", borderRadius: 20, boxShadow: "0 20px 60px rgba(0,0,0,.4)" },
  playerCount: { fontSize: 18, opacity: .85 },
  playerChips: { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 360, minHeight: 34 },
  chip: { padding: "6px 14px", borderRadius: 999, background: "rgba(201,168,255,.18)", border: "1px solid rgba(201,168,255,.35)", fontSize: 14, fontWeight: 600 },
  bigBtn: { padding: "16px 40px", borderRadius: 16, background: "linear-gradient(135deg,#ffcb2d,#ff8a00)", color: "#3a1078", fontSize: 20, fontWeight: 800, boxShadow: "0 10px 30px rgba(255,138,0,.35)" },
  ghostBtn: { padding: "13px 30px", borderRadius: 14, background: "rgba(255,255,255,.1)", color: "#fff", fontSize: 16, fontWeight: 700, border: "1px solid rgba(255,255,255,.2)", marginTop: 10 },
  question: { width: "100%", maxWidth: 980, display: "flex", flexDirection: "column", alignItems: "center", gap: 26 },
  qHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" },
  qNum: { fontSize: 15, opacity: .7, fontWeight: 600, minWidth: 130 },
  timer: { width: 78, height: 78, borderRadius: "50%", background: "linear-gradient(135deg,#ffcb2d,#ff8a00)", color: "#3a1078", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 900, boxShadow: "0 8px 24px rgba(255,138,0,.4)" },
  qText: { fontFamily: "'Fraunces',serif", fontSize: 40, fontWeight: 900, textAlign: "center", lineHeight: 1.15 },
  optGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, width: "100%" },
  optCard: { display: "flex", alignItems: "center", gap: 16, padding: "26px 28px", borderRadius: 16, fontSize: 22, fontWeight: 700, boxShadow: "0 10px 30px rgba(0,0,0,.25)" },
  optShape: { fontSize: 28 },
  barRow: { display: "flex", alignItems: "flex-end", gap: 22, width: "100%", justifyContent: "center", minHeight: 280 },
  barCol: { display: "flex", flexDirection: "column", alignItems: "center", gap: 12, width: 200 },
  bar: { width: "100%", borderRadius: "12px 12px 0 0", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 10, transition: "height .6s cubic-bezier(.2,1,.4,1)" },
  barCount: { fontSize: 30, fontWeight: 900 },
  barLabel: { fontSize: 16, textAlign: "center" },
  podiumWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 26, width: "100%", maxWidth: 800 },
  podiumTitle: { fontFamily: "'Fraunces',serif", fontSize: 48, fontWeight: 900 },
  podiumRow: { display: "flex", alignItems: "flex-end", gap: 20, justifyContent: "center" },
  podiumCol: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 140 },
  podiumMedal: { fontSize: 40 },
  podiumName: { fontSize: 18, fontWeight: 700 },
  podiumScore: { fontSize: 14, opacity: .7 },
  podiumBlock: { width: "100%", borderRadius: "12px 12px 0 0", background: "linear-gradient(180deg,#c9a8ff,#7b2ff7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, fontWeight: 900, color: "rgba(255,255,255,.5)" },
  restList: { width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 6 },
  restRow: { display: "flex", justifyContent: "space-between", padding: "10px 18px", borderRadius: 10, background: "rgba(255,255,255,.06)", fontSize: 15 },
  participantBg: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, gap: 16, background: "radial-gradient(circle at 20% 10%,#3a1078,#1a0938 55%,#0d0420)", color: "#fff", fontFamily: "'Outfit',sans-serif" },
  phone: { width: "100%", maxWidth: 420, minHeight: 520, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 28, padding: 24, display: "flex", flexDirection: "column", boxShadow: "0 24px 70px rgba(0,0,0,.45)" },
  joinH: { fontFamily: "'Fraunces',serif", fontSize: 34, fontWeight: 900, marginBottom: 6 },
  joinHint: { fontSize: 13, opacity: .6, marginBottom: 24 },
  input: { padding: "16px 18px", borderRadius: 14, border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.08)", color: "#fff", fontSize: 18, fontFamily: "'Outfit',sans-serif", outline: "none", marginBottom: 16 },
  joinBtn: { padding: "16px", borderRadius: 14, background: "linear-gradient(135deg,#ffcb2d,#ff8a00)", color: "#3a1078", fontSize: 18, fontWeight: 800 },
  phoneHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 16, borderBottom: "1px solid rgba(255,255,255,.1)", marginBottom: 8 },
  phoneName: { fontSize: 15, fontWeight: 700 },
  phoneScore: { fontSize: 15, fontWeight: 800, color: "#ffcb2d" },
  phoneCenter: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center" },
  bigEmoji: { fontSize: 64 },
  phoneMsg: { fontSize: 26, fontWeight: 800, fontFamily: "'Fraunces',serif" },
  phoneSub: { fontSize: 15, opacity: .7, maxWidth: 240 },
  answerGrid: { flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, paddingTop: 14 },
  answerBtn: { borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 110, boxShadow: "0 8px 24px rgba(0,0,0,.3)" },
  answerShape: { fontSize: 46, color: "#fff" },
};
