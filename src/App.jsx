import { useState, useEffect, useRef, useCallback } from "react";

// ─── PALETTE ──────────────────────────────────────────────────────────────────
const C = {
  bg:           "#FAFAF8",
  surface:      "#FFFFFF",
  surfaceAlt:   "#F4F3F0",
  border:       "#E5E3DE",
  borderMid:    "#D1CEC8",
  ink:          "#1C1917",
  inkMid:       "#57534E",
  inkFaint:     "#A8A29E",
  accent:       "#2C5282",
  accentMid:    "#4A72A8",
  accentFaint:  "#EBF0F8",
  accentBorder: "#C3D4EC",
  correct:      "#166534",
  correctBg:    "#F0FDF4",
  correctBorder:"#86EFAC",
  wrong:        "#991B1B",
  wrongBg:      "#FEF2F2",
  wrongBorder:  "#FCA5A5",
  amber:        "#92400E",
  amberBg:      "#FFFBEB",
  amberBorder:  "#FCD34D",
};

// ─── PROMPTS ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Tessera's Socratic tutor. You help medical students reason through clinical problems.

RULES:
1. Never answer clinical questions directly. Respond with a probe that forces reasoning.
2. When wrong: ask the question that exposes the gap. Don't correct.
3. When right: press deeper. "Good — now why does that matter clinically?"
4. Under 80 words. End every reply with exactly one italicized question.
5. Brilliant, direct. Praise only when genuinely earned.`;

const STEP_CONFIGS = {
  "1": {
    label: "Step 1", stepTag: "USMLE Step 1",
    focus: "mechanistic and basic science",
    sectionInst: "Foreground pathophysiology, molecular mechanism, receptor pharmacology, enzyme pathways, histopathology. Explain why the biology works — not just what happens.",
    questionInst: "Test mechanism, MOA, pathophysiology. Brief 2-sentence vignettes anchoring mechanism. Stems: 'what is the mechanism / which pathway / why does this occur'. Distractors exploit mechanistic misunderstandings.",
    pearlInst: "Mechanistic mnemonics and pathophysiology anchors. NBME-style basic science in clinical wrapper.",
  },
  "2": {
    label: "Step 2", stepTag: "USMLE Step 2 CK",
    focus: "clinical decision-making and management",
    sectionInst: "Prioritize clinical presentation, diagnostic workup, management algorithms, disposition. Pathophysiology only when it drives a management decision.",
    questionInst: "Test best next step, diagnosis, management, indication/contraindication. Rich 3-4 sentence vignettes with vitals/labs/timeline. Distractors exploit clinical missteps.",
    pearlInst: "Clinical decision rules, management algorithms, high-yield shelf associations.",
  },
  "both": {
    label: "Step 1 + 2", stepTag: "USMLE Step 1 + 2",
    focus: "integrated mechanistic and clinical",
    sectionInst: "Begin with mechanistic foundation, bridge explicitly to clinical consequence. Make basic science predict presentation, workup, and management.",
    questionInst: "Mix: ~half Step 1 mechanism-focused (brief vignette), ~half Step 2 clinical decision (rich vignette). Mix distractors accordingly.",
    pearlInst: "Alternate mechanistic anchors and clinical decision rules — show how each informs the other.",
  }
};

const LESSON_PROMPT = (topic, weaknesses, stepMode) => {
  const cfg = STEP_CONFIGS[stepMode];
  return `You are a master medical educator creating a high-yield clinical lesson for ${cfg.stepTag}.

Topic: ${topic}
Exam focus: ${cfg.focus}
${weaknesses.length > 0 ? `Emphasize these weak areas: ${weaknesses.join(", ")}` : ""}

SECTION GUIDANCE: ${cfg.sectionInst}
CASE GUIDANCE: ${cfg.questionInst}
PEARL GUIDANCE: ${cfg.pearlInst}

CONTENT STANDARDS:
- Section content: 3-4 tight sentences. **bold** key terms. No padding.
- Bullets: complete testable facts with mechanism. 5 bullets max per section.
- Pearls: one sentence each. High-yield, specific, shelf-worthy.
- Cases: genuine NBME style. Hard distractors. Teaching point explains why each wrong answer fails.

LABS RULE: If a case has labs, put them in a separate "labs" array — do NOT embed lab values in the vignette prose. The vignette prose should say "labs are notable for the following findings" or similar.

TWO-PART CASES: Cases c2 and c4 must be two-part (diagnosis then management). They require a "followUp" field. The follow-up is ALWAYS a management decision that depends on knowing the diagnosis. It is revealed only after the student answers the first question.

Generate a JSON lesson:
{
  "title": "concise clinical title",
  "category": "system / subspecialty",
  "difficulty": "${cfg.label}",
  "overview": "2 sentences. Clinical hook with pathophysiologic consequence.",
  "sections": [
    {
      "title": "section title",
      "content": "3-4 dense sentences. **bold** key terms.",
      "highYieldBullets": ["5 bullets max. Each a complete testable fact with mechanism."]
    }
  ],
  "pearls": ["8 one-sentence pearls. Specific. Memorable."],
  "cases": [
    {
      "id": "c1",
      "vignette": "2-3 sentences. Age, sex, chief complaint, key exam findings. No lab values in prose.",
      "labs": [
        {"name": "Sodium", "value": "128", "unit": "mEq/L", "refRange": "136-145", "flag": "L"},
        {"name": "Creatinine", "value": "2.4", "unit": "mg/dL", "refRange": "0.6-1.2", "flag": "H"}
      ],
      "question": "Most likely diagnosis / best next step / underlying mechanism",
      "options": {"A": "...", "B": "...", "C": "...", "D": "...", "E": "..."},
      "correct": "A",
      "teaching": "3 sentences. Why correct. Why each wrong answer fails.",
      "concept": "core concept tested",
      "difficulty": 2
    },
    {
      "id": "c2",
      "vignette": "2-3 sentences. No lab values in prose.",
      "labs": [],
      "question": "Most likely diagnosis",
      "options": {"A": "...", "B": "...", "C": "...", "D": "...", "E": "..."},
      "correct": "B",
      "teaching": "3 sentences.",
      "concept": "core concept",
      "difficulty": 3,
      "followUp": {
        "question": "You confirm the diagnosis. What is the most appropriate next step in management?",
        "options": {"A": "...", "B": "...", "C": "...", "D": "...", "E": "..."},
        "correct": "C",
        "teaching": "3 sentences explaining the management decision and why the distractors are wrong."
      }
    }
  ],
  "conceptMap": []
}

4 cases total: c1 and c3 are single-part, c2 and c4 are two-part with followUp.
Labs array may be empty [] if no relevant labs. Only include labs that are clinically meaningful to the case.
3 sections, 8 pearls, 4 cases. Return ONLY valid JSON. No markdown fencing.`;
};

const PRETEST_PROMPT = (topic) =>
  `Student is about to study: "${topic}"\nAsk ONE sharp, clinically concrete question to probe baseline knowledge. Under 40 words. No preamble.`;

// ─── STORAGE ──────────────────────────────────────────────────────────────────

const S = {
  get: (k, fb = null) => {
    try { const v = localStorage.getItem(`t_${k}`); return v ? JSON.parse(v) : fb; } catch { return fb; }
  },
  set: (k, v) => { try { localStorage.setItem(`t_${k}`, JSON.stringify(v)); } catch {} }
};

// ─── API ──────────────────────────────────────────────────────────────────────

async function callClaude(messages, system, maxTokens = 4096) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

async function generateLesson(topic, weaknesses, stepMode) {
  const text = await callClaude(
    [{ role: "user", content: LESSON_PROMPT(topic, weaknesses, stepMode) }],
    "You are a medical education JSON generator. Return only valid JSON, no markdown.",
    16000
  );
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error(`Parse error: ${e.message}. Response started: ${clean.slice(0, 300)}`);
  }
}

// ─── PERFORMANCE ──────────────────────────────────────────────────────────────

function usePerf() {
  const [perf, setPerf] = useState(() => S.get("perf", {
    sessions: 0, answered: 0, correct: 0, weak: {}, topics: []
  }));

  const recordAnswer = useCallback((concept, isCorrect) => {
    setPerf(prev => {
      const weak = { ...prev.weak };
      if (!weak[concept]) weak[concept] = { w: 0, t: 0 };
      weak[concept].t++;
      if (!isCorrect) weak[concept].w++;
      const next = { ...prev, answered: prev.answered + 1, correct: prev.correct + (isCorrect ? 1 : 0), weak };
      S.set("perf", next);
      return next;
    });
  }, []);

  const recordSession = useCallback((topic) => {
    setPerf(prev => {
      const next = { ...prev, sessions: prev.sessions + 1, topics: [topic, ...prev.topics].slice(0, 10) };
      S.set("perf", next);
      return next;
    });
  }, []);

  const weaknesses = Object.entries(perf.weak)
    .filter(([, v]) => v.t >= 2 && v.w / v.t > 0.5)
    .sort((a, b) => (b[1].w / b[1].t) - (a[1].w / a[1].t))
    .slice(0, 5).map(([k]) => k);

  const accuracy = perf.answered > 0 ? Math.round((perf.correct / perf.answered) * 100) : null;

  return { perf, accuracy, weaknesses, recordAnswer, recordSession };
}

// ─── LOGO: T from mosaic tiles ────────────────────────────────────────────────

const TesseraLogo = ({ size = 28 }) => {
  const s = size / 28;
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      {/* Top bar of T — three mosaic tiles with slight irregularity */}
      <polygon points="1,1 9.5,1 9,7.5 1.5,7" fill={C.accent}/>
      <polygon points="9.5,1 18.5,1 18.5,7 9,7.5" fill={C.accentMid} opacity="0.8"/>
      <polygon points="18.5,1 27,1 26.5,7 18.5,7" fill={C.accent} opacity="0.7"/>
      {/* Grout lines top bar */}
      <line x1="9" y1="1" x2="9.5" y2="7.5" stroke={C.bg} strokeWidth="0.7"/>
      <line x1="18.5" y1="1" x2="18.5" y2="7" stroke={C.bg} strokeWidth="0.7"/>
      {/* Stem of T — three stacked tiles */}
      <polygon points="10,7.5 18,7 18.5,15.5 9.5,16" fill={C.accentMid} opacity="0.85"/>
      <polygon points="9.5,16 18.5,15.5 18,23 10,23" fill={C.accent} opacity="0.9"/>
      <polygon points="10,23 18,23 17.5,27 10.5,27" fill={C.accentMid} opacity="0.7"/>
      {/* Grout lines stem */}
      <line x1="9.5" y1="16" x2="18.5" y2="15.5" stroke={C.bg} strokeWidth="0.7"/>
      <line x1="10" y1="23" x2="18" y2="23" stroke={C.bg} strokeWidth="0.7"/>
    </svg>
  );
};

// ─── ICONS ────────────────────────────────────────────────────────────────────

const Icons = {
  Arrow:    () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 7.5h11M9 3.5l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Check:    () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 6.5L5 9.5L11 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  X:        () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 2.5l8 8M10.5 2.5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  Chat:     () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M1.5 1.5h12v9.5H7.5l-3 2.5v-2.5H1.5V1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Send:     () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M13 2L2 6.5l4.5 2 2 4.5L13 2z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Close:    () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  Refresh:  () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 7a5.5 5.5 0 1 0 1-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M1.5 3v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

// ─── MARKDOWN ─────────────────────────────────────────────────────────────────

function MD({ text }) {
  if (!text) return null;
  const parts = text.split(/(\*\*.*?\*\*|_.*?_)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**"))
          return <strong key={i} style={{ color: C.accent, fontWeight: 600 }}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("_") && p.endsWith("_"))
          return <em key={i}>{p.slice(1, -1)}</em>;
        return p;
      })}
    </>
  );
}

// ─── CONCEPT MAP ──────────────────────────────────────────────────────────────

function ConceptMap({ nodes }) {
  if (!nodes?.length) return null;
  const concepts = [...new Set(nodes.flatMap(n => [n.from, n.to]))];
  const pos = concepts.reduce((acc, c, i) => {
    const angle = (i / concepts.length) * 2 * Math.PI - Math.PI / 2;
    const r = concepts.length > 5 ? 125 : 100;
    acc[c] = { x: 185 + r * Math.cos(angle), y: 145 + r * Math.sin(angle) };
    return acc;
  }, {});

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "1.25rem", background: C.surface }}>
      <p style={{ fontFamily: "monospace", fontSize: "0.6rem", letterSpacing: "0.2em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.5rem" }}>Concept Architecture</p>
      <svg width="100%" viewBox="0 0 370 290" style={{ maxHeight: 290 }}>
        <defs>
          <marker id="arr" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill={C.borderMid}/>
          </marker>
        </defs>
        {nodes.map((n, i) => {
          const f = pos[n.from], t = pos[n.to];
          if (!f || !t) return null;
          const angle = Math.atan2(t.y - f.y, t.x - f.x);
          const off = 32;
          return (
            <g key={i}>
              <line
                x1={f.x + off * Math.cos(angle)} y1={f.y + off * Math.sin(angle)}
                x2={t.x - off * Math.cos(angle)} y2={t.y - off * Math.sin(angle)}
                stroke={C.borderMid} strokeWidth="1.2" markerEnd="url(#arr)" strokeDasharray="4,3"
              />
              <text x={(f.x + t.x) / 2} y={(f.y + t.y) / 2 - 5}
                textAnchor="middle" fill={C.inkFaint} fontSize="8" fontFamily="monospace">{n.label}</text>
            </g>
          );
        })}
        {concepts.map((c, i) => {
          const p = pos[c];
          if (!p) return null;
          return (
            <g key={i}>
              <ellipse cx={p.x} cy={p.y} rx="33" ry="19" fill={C.accentFaint} stroke={C.accentBorder} strokeWidth="1"/>
              <text x={p.x} y={p.y + 1} textAnchor="middle" dominantBaseline="middle"
                fill={C.accent} fontSize="8.5" fontFamily="system-ui,sans-serif" fontWeight="500">
                {c.length > 15 ? c.slice(0, 13) + "…" : c}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── PRETEST GATE ─────────────────────────────────────────────────────────────

function PretestGate({ question, onSubmit }) {
  const [ans, setAns] = useState("");
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", animation: "fadeUp 0.5s ease both" }}>
      <p style={{ fontFamily: "monospace", fontSize: "0.62rem", letterSpacing: "0.2em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "1.25rem" }}>Before we begin</p>
      <p style={{ fontFamily: "Georgia, serif", fontSize: "1.2rem", color: C.ink, lineHeight: 1.6, marginBottom: "1.75rem", fontStyle: "italic" }}>{question}</p>
      <textarea
        ref={ref}
        value={ans}
        onChange={e => setAns(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && e.metaKey && ans.trim()) onSubmit(ans); }}
        placeholder="Think aloud. Partial knowledge is useful."
        style={{
          width: "100%", minHeight: 110, background: C.surface,
          border: `1px solid ${C.border}`, borderRadius: 8,
          padding: "0.9rem 1rem", color: C.ink,
          fontFamily: "Georgia, serif", fontSize: "1rem", lineHeight: 1.65,
          resize: "vertical", outline: "none", transition: "border-color 0.2s", boxSizing: "border-box"
        }}
        onFocus={e => e.target.style.borderColor = C.accent}
        onBlur={e => e.target.style.borderColor = C.border}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem", gap: "1rem", alignItems: "center" }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.65rem", color: C.inkFaint }}>⌘ + Enter</span>
        <button
          onClick={() => ans.trim() && onSubmit(ans)}
          style={{
            background: ans.trim() ? C.accent : C.accentFaint,
            color: ans.trim() ? "#fff" : C.inkFaint,
            border: "none", borderRadius: 6, padding: "0.6rem 1.4rem",
            fontFamily: "system-ui,sans-serif", fontSize: "0.82rem", fontWeight: 500,
            cursor: ans.trim() ? "pointer" : "default", transition: "all 0.2s"
          }}
        >Continue</button>
      </div>
    </div>
  );
}

// ─── LABS TABLE ───────────────────────────────────────────────────────────────

function LabsTable({ labs }) {
  if (!labs?.length) return null;
  return (
    <div style={{ marginBottom: "1.25rem", border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "0.4rem 0.9rem", background: C.surfaceAlt, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.inkFaint, letterSpacing: "0.15em", textTransform: "uppercase" }}>Laboratory Results</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", background: C.surface }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            {["Test", "Value", "Reference Range"].map(h => (
              <th key={h} style={{
                padding: "0.45rem 0.9rem", textAlign: "left",
                fontFamily: "monospace", fontSize: "0.58rem", letterSpacing: "0.1em",
                textTransform: "uppercase", color: C.inkFaint, fontWeight: 500
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labs.map((lab, i) => {
            const flagColor = lab.flag === "H" ? C.wrong : lab.flag === "L" ? C.accent : C.inkMid;
            const flagBg = lab.flag === "H" ? C.wrongBg : lab.flag === "L" ? C.accentFaint : "transparent";
            return (
              <tr key={i} style={{ borderBottom: i < labs.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <td style={{ padding: "0.55rem 0.9rem", fontFamily: "Georgia, serif", fontSize: "0.88rem", color: C.inkMid }}>{lab.name}</td>
                <td style={{ padding: "0.55rem 0.9rem" }}>
                  <span style={{
                    fontFamily: "monospace", fontSize: "0.85rem", fontWeight: 600,
                    color: lab.flag ? flagColor : C.ink,
                    background: lab.flag ? flagBg : "transparent",
                    padding: lab.flag ? "0.1rem 0.4rem" : "0",
                    borderRadius: 4
                  }}>
                    {lab.value} {lab.unit}
                    {lab.flag && <span style={{ fontSize: "0.65rem", marginLeft: "0.3rem", opacity: 0.8 }}>{lab.flag}</span>}
                  </span>
                </td>
                <td style={{ padding: "0.55rem 0.9rem", fontFamily: "monospace", fontSize: "0.78rem", color: C.inkFaint }}>{lab.refRange}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── QUESTION BLOCK (reusable for part 1 and follow-up) ──────────────────────

function QuestionBlock({ question, options, correct, teaching, concept, onAnswer, partLabel }) {
  const [phase, setPhase] = useState("unanswered");
  const [selected, setSelected] = useState(null);

  const choose = (key) => {
    if (phase === "revealed") return;
    setSelected(key);
    setPhase("revealed");
    onAnswer(concept, key === correct);
  };

  const optStyle = (key) => {
    const base = {
      width: "100%", textAlign: "left", background: C.surface,
      border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "0.75rem 1rem", color: C.ink,
      fontFamily: "Georgia, serif", fontSize: "0.92rem", lineHeight: 1.55,
      cursor: phase === "revealed" ? "default" : "pointer",
      transition: "all 0.2s", display: "flex", gap: "0.75rem", alignItems: "flex-start"
    };
    if (phase !== "revealed") return base;
    if (key === correct) return { ...base, background: C.correctBg, borderColor: C.correctBorder, color: C.correct };
    if (key === selected) return { ...base, background: C.wrongBg, borderColor: C.wrongBorder, color: C.wrong };
    return { ...base, opacity: 0.38 };
  };

  return (
    <div style={{ animation: "fadeUp 0.35s ease both" }}>
      {partLabel && (
        <div style={{ marginBottom: "0.75rem" }}>
          <span style={{
            fontFamily: "monospace", fontSize: "0.58rem", letterSpacing: "0.15em",
            textTransform: "uppercase", color: C.accentMid, fontWeight: 600,
            background: C.accentFaint, border: `1px solid ${C.accentBorder}`,
            borderRadius: 4, padding: "0.15rem 0.5rem"
          }}>{partLabel}</span>
        </div>
      )}
      <p style={{ fontFamily: "Georgia, serif", fontWeight: 600, fontSize: "0.97rem", color: C.ink, marginBottom: "0.9rem", lineHeight: 1.5 }}>
        {question}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.9rem" }}>
        {Object.entries(options).map(([key, val]) => (
          <button key={key} style={optStyle(key)} onClick={() => choose(key)}
            onMouseOver={e => { if (phase !== "revealed") e.currentTarget.style.borderColor = C.accentBorder; }}
            onMouseOut={e => { if (phase !== "revealed") e.currentTarget.style.borderColor = C.border; }}
          >
            <span style={{
              fontFamily: "monospace", fontSize: "0.72rem", minWidth: 16, flexShrink: 0,
              color: phase === "revealed" && key === correct ? C.correct
                   : phase === "revealed" && key === selected ? C.wrong
                   : C.accentMid,
              marginTop: 2, fontWeight: 700
            }}>{key}</span>
            <MD text={val}/>
            {phase === "revealed" && key === correct && <span style={{ marginLeft: "auto", color: C.correct, flexShrink: 0 }}><Icons.Check/></span>}
            {phase === "revealed" && key === selected && key !== correct && <span style={{ marginLeft: "auto", color: C.wrong, flexShrink: 0 }}><Icons.X/></span>}
          </button>
        ))}
      </div>
      {phase === "revealed" && (
        <div style={{
          background: C.accentFaint, border: `1px solid ${C.accentBorder}`,
          borderRadius: 8, padding: "1rem 1.1rem", animation: "fadeUp 0.3s ease both"
        }}>
          <p style={{ fontFamily: "monospace", fontSize: "0.56rem", color: C.accent, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.45rem", fontWeight: 600 }}>Teaching Point</p>
          <p style={{ fontFamily: "Georgia, serif", fontSize: "0.9rem", color: C.inkMid, lineHeight: 1.75 }}>
            <MD text={teaching}/>
          </p>
        </div>
      )}
    </div>
  );
}

// ─── CASE CARD ────────────────────────────────────────────────────────────────

function CaseCard({ cas, index, onAnswer }) {
  const [gateOpen, setGateOpen] = useState(false);
  const [part1Done, setPart1Done] = useState(false);
  const hasFollowUp = !!cas.followUp;
  const diffLabel = ["", "Foundational", "Developing", "Intermediate", "Advanced", "Mastery"][cas.difficulty] || "";

  const handlePart1Answer = (concept, correct) => {
    onAnswer(concept, correct);
    setPart1Done(true);
  };

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 14,
      background: C.surface, overflow: "hidden",
      animation: "fadeUp 0.5s ease both", animationDelay: `${index * 0.07}s`,
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)"
    }}>
      {/* Header */}
      <div style={{
        padding: "0.75rem 1.4rem", background: C.surfaceAlt, borderBottom: `1px solid ${C.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "center"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span style={{ fontFamily: "monospace", fontSize: "0.63rem", color: C.accent, letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 600 }}>
            Case {index + 1}
          </span>
          {hasFollowUp && (
            <span style={{
              fontFamily: "monospace", fontSize: "0.55rem", letterSpacing: "0.1em",
              textTransform: "uppercase", color: C.accentMid,
              background: C.accentFaint, border: `1px solid ${C.accentBorder}`,
              borderRadius: 4, padding: "0.1rem 0.4rem"
            }}>2-part</span>
          )}
        </div>
        <span style={{ fontFamily: "monospace", fontSize: "0.58rem", color: C.inkFaint, letterSpacing: "0.08em" }}>
          {diffLabel} · {cas.concept}
        </span>
      </div>

      <div style={{ padding: "1.4rem" }}>
        {/* Vignette */}
        <div style={{
          background: C.surfaceAlt, borderLeft: `3px solid ${C.accentBorder}`,
          borderRadius: "0 8px 8px 0", padding: "1rem 1.15rem", marginBottom: "1rem"
        }}>
          <p style={{ fontFamily: "Georgia, serif", fontSize: "0.95rem", color: C.inkMid, lineHeight: 1.8 }}>
            {cas.vignette}
          </p>
        </div>

        {/* Labs table */}
        <LabsTable labs={cas.labs}/>

        {/* Gate */}
        {!gateOpen ? (
          <button
            onClick={() => setGateOpen(true)}
            style={{
              width: "100%", padding: "0.7rem",
              background: C.accentFaint, border: `1px solid ${C.accentBorder}`,
              borderRadius: 8, color: C.accent,
              fontFamily: "system-ui,sans-serif", fontSize: "0.83rem", fontWeight: 500,
              cursor: "pointer", transition: "all 0.2s", textAlign: "center"
            }}
            onMouseOver={e => e.currentTarget.style.background = C.accentBorder}
            onMouseOut={e => e.currentTarget.style.background = C.accentFaint}
          >
            Answer this case →
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {/* Part 1 */}
            <QuestionBlock
              question={cas.question}
              options={cas.options}
              correct={cas.correct}
              teaching={cas.teaching}
              concept={cas.concept}
              onAnswer={handlePart1Answer}
              partLabel={hasFollowUp ? "Part 1 — Diagnosis" : null}
            />

            {/* Part 2 — only after part 1 answered */}
            {hasFollowUp && part1Done && (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "1.25rem", animation: "fadeUp 0.4s ease both" }}>
                <QuestionBlock
                  question={cas.followUp.question}
                  options={cas.followUp.options}
                  correct={cas.followUp.correct}
                  teaching={cas.followUp.teaching}
                  concept={cas.concept}
                  onAnswer={onAnswer}
                  partLabel="Part 2 — Management"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


// ─── CHATBOT ──────────────────────────────────────────────────────────────────

function Chatbot({ lesson, onClose }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  useEffect(() => {
    if (lesson && !msgs.length) {
      setMsgs([{ role: "assistant", content: `We're in ${lesson.title}. Don't ask me to explain — ask me to challenge you.` }]);
    }
  }, [lesson]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const msg = { role: "user", content: input.trim() };
    const next = [...msgs, msg];
    setMsgs(next);
    setInput("");
    setLoading(true);
    const ctx = lesson ? `Current lesson: ${lesson.title}. Concepts: ${lesson.sections?.map(s => s.title).join(", ")}.` : "";
    try {
      const reply = await callClaude(
        next.map(m => ({ role: m.role, content: m.content })),
        SYSTEM_PROMPT + (ctx ? `\n\nContext: ${ctx}` : ""), 300
      );
      setMsgs(p => [...p, { role: "assistant", content: reply }]);
    } catch {
      setMsgs(p => [...p, { role: "assistant", content: "Connection error." }]);
    }
    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, width: 355, maxHeight: "66vh",
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 14, display: "flex", flexDirection: "column",
      boxShadow: "0 16px 48px rgba(0,0,0,0.11)", zIndex: 100,
      animation: "fadeUp 0.3s ease both", overflow: "hidden"
    }}>
      <div style={{
        padding: "0.85rem 1.1rem", borderBottom: `1px solid ${C.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: C.surfaceAlt
      }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.62rem", letterSpacing: "0.15em", textTransform: "uppercase", color: C.accent, fontWeight: 600 }}>Socratic Tutor</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.inkFaint, cursor: "pointer", padding: 2 }}>
          <Icons.Close/>
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0.85rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ maxWidth: "88%", alignSelf: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              background: m.role === "user" ? C.accentFaint : C.surfaceAlt,
              border: `1px solid ${m.role === "user" ? C.accentBorder : C.border}`,
              borderRadius: m.role === "user" ? "11px 11px 3px 11px" : "11px 11px 11px 3px",
              padding: "0.6rem 0.85rem"
            }}>
              <p style={{ fontFamily: "Georgia, serif", fontSize: "0.87rem", color: C.ink, lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>
                <MD text={m.content}/>
              </p>
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: "flex-start" }}>
            <div style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: "11px 11px 11px 3px", padding: "0.6rem 1rem", display: "flex", gap: 4, alignItems: "center" }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent, animation: "pulse 1.2s ease-in-out infinite", animationDelay: `${i * 0.2}s` }}/>
              ))}
            </div>
          </div>
        )}
        <div ref={endRef}/>
      </div>
      <div style={{ padding: "0.6rem", borderTop: `1px solid ${C.border}`, display: "flex", gap: "0.4rem" }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
          placeholder="Ask or be challenged..."
          style={{
            flex: 1, background: C.surfaceAlt, border: `1px solid ${C.border}`,
            borderRadius: 7, padding: "0.5rem 0.8rem", color: C.ink,
            fontFamily: "Georgia, serif", fontSize: "0.87rem", outline: "none"
          }}
        />
        <button onClick={send} disabled={!input.trim() || loading} style={{
          background: input.trim() ? C.accent : C.accentFaint,
          border: "none", borderRadius: 7, padding: "0.5rem 0.8rem",
          color: input.trim() ? "#fff" : C.inkFaint,
          cursor: input.trim() ? "pointer" : "default", transition: "all 0.2s", display: "flex", alignItems: "center"
        }}><Icons.Send/></button>
      </div>
    </div>
  );
}

// ─── PHASE STEPPER ────────────────────────────────────────────────────────────

function Stepper({ current }) {
  const steps = [
    { id: "LEARN", label: "Learn" },
    { id: "SYNTHESIZE", label: "Pearls" },
    { id: "APPLY", label: "Cases" },
  ];
  const currentIdx = steps.findIndex(s => s.id === current);

  return (
    <div style={{
      display: "flex", alignItems: "center",
      padding: "1rem 1.25rem", background: C.surface,
      border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: "2.5rem"
    }}>
      {steps.map((step, i) => (
        <>
          <div key={step.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", opacity: i > currentIdx ? 0.35 : 1, transition: "opacity 0.3s" }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
              background: i < currentIdx ? C.accentFaint : i === currentIdx ? C.accent : C.surfaceAlt,
              border: `1.5px solid ${i <= currentIdx ? C.accent : C.border}`,
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>
              {i < currentIdx
                ? <Icons.Check/>
                : <span style={{ fontFamily: "monospace", fontSize: "0.62rem", color: i === currentIdx ? "#fff" : C.inkFaint, fontWeight: 700 }}>{i + 1}</span>}
            </div>
            <span style={{ fontFamily: "system-ui,sans-serif", fontSize: "0.78rem", fontWeight: i === currentIdx ? 600 : 400, color: i === currentIdx ? C.ink : C.inkMid }}>{step.label}</span>
          </div>
          {i < steps.length - 1 && <div key={`line-${i}`} style={{ flex: 1, height: 1, background: C.border, margin: "0 0.75rem" }}/>}
        </>
      ))}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

const PHASES = { IDLE: "IDLE", GENERATING: "GENERATING", LESSON: "LESSON" };
const LESSON_PHASES = { LEARN: "LEARN", SYNTHESIZE: "SYNTHESIZE", APPLY: "APPLY" };
const LOADING = ["Mapping pathophysiology...", "Building cases...", "Constructing distractors...", "Stress-testing vignettes...", "Finalizing pearls..."];

export default function App() {
  const [phase, setPhase] = useState(PHASES.IDLE);
  const [lessonPhase, setLessonPhase] = useState(LESSON_PHASES.LEARN);
  const [topic, setTopic] = useState("");
  const [stepMode, setStepMode] = useState("both");
  const [lesson, setLesson] = useState(null);
  const [error, setError] = useState(null);
  const [loadingIdx, setLoadingIdx] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [casesAnswered, setCasesAnswered] = useState(0);
  const { perf, accuracy, weaknesses, recordAnswer, recordSession } = usePerf();

  useEffect(() => {
    if (phase !== PHASES.GENERATING) return;
    const iv = setInterval(() => setLoadingIdx(p => (p + 1) % LOADING.length), 2000);
    return () => clearInterval(iv);
  }, [phase]);

  const handleTopicSubmit = async () => {
    if (!topic.trim()) return;
    setError(null);
    setPhase(PHASES.GENERATING);
    try {
      const l = await generateLesson(topic, weaknesses, stepMode);
      setLesson(l);
      recordSession(topic);
      setCasesAnswered(0);
      setLessonPhase(LESSON_PHASES.LEARN);
      setPhase(PHASES.LESSON);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e.message || "Generation failed.");
      setPhase(PHASES.IDLE);
    }
  };

  const handleAnswer = useCallback((concept, correct) => {
    recordAnswer(concept, correct);
    setCasesAnswered(p => p + 1);
  }, [recordAnswer]);

  const reset = () => { setPhase(PHASES.IDLE); setLesson(null); setTopic(""); setChatOpen(false); };

  const navToPhase = (p) => { setLessonPhase(p); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 10px; }
    body { background: ${C.bg}; color: ${C.ink}; font-family: 'DM Sans', system-ui, sans-serif; min-height: 100vh; }
    textarea::placeholder, input::placeholder { color: ${C.inkFaint}; }
    @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
    @keyframes spin { to { transform:rotate(360deg); } }
    @keyframes pulse { 0%,100%{opacity:.3;transform:scale(.85)} 50%{opacity:1;transform:scale(1.1)} }
    @keyframes shimmer { 0%,100%{opacity:.5} 50%{opacity:1} }
  `;

  const mono = { fontFamily: "'DM Mono', monospace" };
  const serif = { fontFamily: "'DM Serif Display', Georgia, serif" };

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight: "100vh", background: C.bg }}>

        {/* HEADER */}
        <header style={{
          position: "sticky", top: 0, zIndex: 50,
          background: "rgba(250,250,248,0.94)", backdropFilter: "blur(14px)",
          borderBottom: `1px solid ${C.border}`, padding: "0.85rem 2rem",
          display: "flex", alignItems: "center", justifyContent: "space-between"
        }}>
          <button onClick={reset} style={{ display: "flex", alignItems: "center", gap: "0.6rem", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            <TesseraLogo size={26}/>
            <span style={{ ...serif, fontSize: "1.15rem", fontStyle: "italic", color: C.ink, letterSpacing: "0.01em" }}>Tessera</span>
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            {perf.sessions > 0 && (
              <span style={{ ...mono, fontSize: "0.65rem", color: C.inkFaint, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 100, padding: "0.28rem 0.75rem" }}>
                {perf.sessions} sessions{accuracy !== null && ` · ${accuracy}%`}
              </span>
            )}

            {/* In-lesson phase nav */}
            {phase === PHASES.LESSON && (
              <div style={{ display: "flex", gap: "0.35rem" }}>
                {[
                  { id: LESSON_PHASES.LEARN, label: "Learn" },
                  { id: LESSON_PHASES.SYNTHESIZE, label: "Pearls" },
                  { id: LESSON_PHASES.APPLY, label: "Cases" },
                ].map(p => (
                  <button key={p.id} onClick={() => navToPhase(p.id)} style={{
                    ...mono, fontSize: "0.62rem", letterSpacing: "0.08em", textTransform: "uppercase",
                    background: lessonPhase === p.id ? C.accent : "none",
                    color: lessonPhase === p.id ? "#fff" : C.inkFaint,
                    border: `1px solid ${lessonPhase === p.id ? C.accent : C.border}`,
                    borderRadius: 100, padding: "0.28rem 0.75rem", cursor: "pointer", transition: "all 0.2s"
                  }}>{p.label}</button>
                ))}
              </div>
            )}

            {lesson && (
              <button onClick={() => setChatOpen(p => !p)} style={{
                display: "flex", alignItems: "center", gap: "0.35rem",
                background: chatOpen ? C.accentFaint : C.surfaceAlt,
                border: `1px solid ${chatOpen ? C.accentBorder : C.border}`,
                borderRadius: 100, padding: "0.28rem 0.75rem",
                color: chatOpen ? C.accent : C.inkFaint,
                ...mono, fontSize: "0.62rem", letterSpacing: "0.08em", textTransform: "uppercase",
                cursor: "pointer", transition: "all 0.2s"
              }}>
                <Icons.Chat/> Tutor
              </button>
            )}

            {phase !== PHASES.IDLE && (
              <button onClick={reset} style={{
                display: "flex", alignItems: "center", gap: "0.3rem",
                background: "none", border: `1px solid ${C.border}`,
                borderRadius: 100, padding: "0.28rem 0.75rem",
                color: C.inkFaint, ...mono, fontSize: "0.62rem",
                letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer"
              }}>
                <Icons.Refresh/> New
              </button>
            )}
          </div>
        </header>

        <main style={{ maxWidth: 740, margin: "0 auto", padding: "3.5rem 1.5rem 8rem" }}>

          {/* ── IDLE ── */}
          {phase === PHASES.IDLE && (
            <div style={{ animation: "fadeUp 0.6s ease both" }}>
              <div style={{ textAlign: "center", marginBottom: "3rem", paddingTop: "1rem" }}>
                <h1 style={{ ...serif, fontSize: "clamp(2.8rem, 8vw, 5rem)", fontStyle: "italic", color: C.ink, lineHeight: 1, letterSpacing: "-0.01em" }}>Tessera</h1>
              </div>

              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "2rem", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <label style={{ ...mono, fontSize: "0.6rem", letterSpacing: "0.2em", textTransform: "uppercase", color: C.inkFaint, display: "block", marginBottom: "0.6rem" }}>
                  Topic or source material
                </label>
                <textarea
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && e.metaKey) handleTopicSubmit(); }}
                  placeholder="HPA axis, hepatorenal syndrome, beta-blocker toxicity, or paste a lecture excerpt..."
                  style={{
                    width: "100%", minHeight: 110, background: "transparent",
                    border: "none", borderBottom: `1px solid ${C.border}`,
                    padding: "0.4rem 0", color: C.ink,
                    fontFamily: "Georgia, serif", fontSize: "1rem", lineHeight: 1.65,
                    resize: "none", outline: "none"
                  }}
                />

                {/* Step selector */}
                <div style={{ marginTop: "1.75rem" }}>
                  <p style={{ ...mono, fontSize: "0.6rem", letterSpacing: "0.2em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.6rem" }}>Exam focus</p>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    {[
                      { key: "1", label: "Step 1", sub: "Mechanism" },
                      { key: "both", label: "Step 1 + 2", sub: "Integrated" },
                      { key: "2", label: "Step 2", sub: "Clinical" },
                    ].map(({ key, label, sub }) => {
                      const active = stepMode === key;
                      return (
                        <button key={key} onClick={() => setStepMode(key)} style={{
                          flex: 1, padding: "0.7rem 0.5rem", textAlign: "center",
                          background: active ? C.accentFaint : C.surfaceAlt,
                          border: `1px solid ${active ? C.accentBorder : C.border}`,
                          borderRadius: 8, cursor: "pointer", transition: "all 0.2s"
                        }}>
                          <div style={{ ...mono, fontSize: "0.67rem", fontWeight: 500, color: active ? C.accent : C.inkMid, letterSpacing: "0.04em", marginBottom: "0.15rem" }}>{label}</div>
                          <div style={{ fontFamily: "system-ui", fontSize: "0.71rem", color: active ? C.accentMid : C.inkFaint }}>{sub}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {weaknesses.length > 0 && (
                  <div style={{
                    marginTop: "1.25rem", padding: "0.7rem 1rem",
                    background: C.amberBg, border: `1px solid ${C.amberBorder}`,
                    borderRadius: 8, display: "flex", flexWrap: "wrap", gap: "0.3rem", alignItems: "center"
                  }}>
                    <span style={{ ...mono, fontSize: "0.6rem", color: C.amber, letterSpacing: "0.12em", textTransform: "uppercase", marginRight: "0.2rem" }}>Targeting gaps:</span>
                    {weaknesses.map((w, i) => (
                      <span key={i} style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: "0.8rem", color: C.amber }}>{w}{i < weaknesses.length - 1 ? ", " : ""}</span>
                    ))}
                  </div>
                )}

                {error && <p style={{ ...mono, fontSize: "0.78rem", color: C.wrong, marginTop: "0.75rem" }}>{error}</p>}

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.5rem", alignItems: "center", gap: "0.75rem" }}>
                  <span style={{ ...mono, fontSize: "0.62rem", color: C.inkFaint }}>⌘ + Enter</span>
                  <button onClick={handleTopicSubmit} disabled={!topic.trim()} style={{
                    display: "flex", alignItems: "center", gap: "0.4rem",
                    background: topic.trim() ? C.accent : C.accentFaint,
                    color: topic.trim() ? "#fff" : C.inkFaint,
                    border: "none", borderRadius: 8, padding: "0.65rem 1.4rem",
                    fontFamily: "system-ui,sans-serif", fontSize: "0.85rem", fontWeight: 500,
                    cursor: topic.trim() ? "pointer" : "default", transition: "all 0.2s"
                  }}>Generate <Icons.Arrow/></button>
                </div>
              </div>

              {perf.topics.length > 0 && (
                <div style={{ marginTop: "1.75rem" }}>
                  <p style={{ ...mono, fontSize: "0.6rem", letterSpacing: "0.2em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.6rem" }}>Recent</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {perf.topics.map((t, i) => (
                      <button key={i} onClick={() => setTopic(t)}
                        style={{
                          background: C.surface, border: `1px solid ${C.border}`,
                          borderRadius: 100, padding: "0.28rem 0.8rem",
                          color: C.inkMid, fontFamily: "Georgia, serif",
                          fontSize: "0.82rem", fontStyle: "italic", cursor: "pointer", transition: "all 0.15s"
                        }}
                        onMouseOver={e => { e.currentTarget.style.color = C.accent; e.currentTarget.style.borderColor = C.accentBorder; }}
                        onMouseOut={e => { e.currentTarget.style.color = C.inkMid; e.currentTarget.style.borderColor = C.border; }}
                      >{t}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── GENERATING ── */}
          {phase === PHASES.GENERATING && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "9rem", gap: "2rem", animation: "fadeUp 0.4s ease both" }}>
              <div style={{ position: "relative", width: 56, height: 56 }}>
                <div style={{ position: "absolute", inset: 0, border: `1px solid ${C.border}`, borderRadius: "50%" }}/>
                <div style={{ position: "absolute", inset: 0, border: "2px solid transparent", borderTopColor: C.accent, borderRadius: "50%", animation: "spin 0.9s linear infinite" }}/>
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}>
                  <TesseraLogo size={20}/>
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ ...mono, fontSize: "0.63rem", letterSpacing: "0.22em", textTransform: "uppercase", color: C.accent, marginBottom: "0.35rem", animation: "shimmer 2s ease infinite" }}>{LOADING[loadingIdx]}</p>
                <p style={{ fontFamily: "Georgia, serif", fontStyle: "italic", color: C.inkFaint, fontSize: "0.93rem" }}>{topic} · {STEP_CONFIGS[stepMode].label}</p>
              </div>
            </div>
          )}

          {/* ── LESSON ── */}
          {phase === PHASES.LESSON && lesson && (
            <div style={{ animation: "fadeUp 0.6s ease both" }}>

              {/* Lesson header */}
              <div style={{ marginBottom: "2rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", marginBottom: "0.85rem" }}>
                  <span style={{
                    ...mono, fontSize: "0.62rem", fontWeight: 600,
                    background: C.accent, color: "#fff",
                    padding: "0.18rem 0.55rem", borderRadius: 4, letterSpacing: "0.05em"
                  }}>{lesson.difficulty}</span>
                  <span style={{ ...mono, fontSize: "0.62rem", color: C.inkFaint, letterSpacing: "0.1em" }}>{lesson.category}</span>
                </div>
                <h1 style={{ ...serif, fontSize: "clamp(1.9rem, 5vw, 3rem)", fontStyle: "italic", color: C.ink, lineHeight: 1.1, marginBottom: "0.85rem" }}>{lesson.title}</h1>
                <p style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: "1rem", color: C.inkMid, lineHeight: 1.75, maxWidth: 580 }}>
                  <MD text={lesson.overview}/>
                </p>
              </div>

              {/* Phase stepper */}
              <Stepper current={lessonPhase}/>

              {/* ── LEARN ── */}
              {lessonPhase === LESSON_PHASES.LEARN && (
                <div style={{ animation: "fadeUp 0.45s ease both" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "3rem", marginBottom: "3rem" }}>
                    {lesson.sections?.map((s, i) => (
                      <section key={i} style={{ animation: "fadeUp 0.45s ease both", animationDelay: `${i * 0.1}s` }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: "0.7rem", marginBottom: "1.1rem", paddingBottom: "0.85rem", borderBottom: `1px solid ${C.border}` }}>
                          <span style={{ ...mono, fontSize: "0.56rem", color: C.inkFaint, letterSpacing: "0.08em" }}>{String(i + 1).padStart(2, "0")}</span>
                          <h2 style={{ ...serif, fontStyle: "italic", fontSize: "1.55rem", color: C.ink, fontWeight: 400 }}>{s.title}</h2>
                        </div>
                        <p style={{ fontFamily: "Georgia, serif", fontSize: "0.99rem", color: C.inkMid, lineHeight: 1.9, marginBottom: "1.5rem", whiteSpace: "pre-wrap" }}>
                          <MD text={s.content}/>
                        </p>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                          {s.highYieldBullets?.map((b, bi) => (
                            <div key={bi} style={{
                              display: "flex", gap: "0.8rem",
                              padding: "0.65rem 0.9rem",
                              borderLeft: `2.5px solid ${C.accentBorder}`,
                              background: C.accentFaint, borderRadius: "0 6px 6px 0",
                              animation: "fadeUp 0.3s ease both", animationDelay: `${bi * 0.04}s`
                            }}>
                              <span style={{ color: C.accentMid, fontSize: "0.62rem", marginTop: 4, flexShrink: 0 }}>▸</span>
                              <p style={{ fontFamily: "Georgia, serif", fontSize: "0.91rem", color: C.inkMid, lineHeight: 1.65 }}>
                                <MD text={b}/>
                              </p>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>

                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <button onClick={() => navToPhase(LESSON_PHASES.SYNTHESIZE)} style={{
                      display: "flex", alignItems: "center", gap: "0.45rem",
                      background: C.accent, color: "#fff", border: "none", borderRadius: 8,
                      padding: "0.75rem 1.9rem", fontFamily: "system-ui,sans-serif",
                      fontSize: "0.85rem", fontWeight: 500, cursor: "pointer", transition: "all 0.2s"
                    }}>Review Pearls <Icons.Arrow/></button>
                  </div>
                </div>
              )}

              {/* ── PEARLS ── */}
              {lessonPhase === LESSON_PHASES.SYNTHESIZE && (
                <div style={{ animation: "fadeUp 0.45s ease both" }}>
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "2.25rem", marginBottom: "2.5rem", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "1.75rem", paddingBottom: "1rem", borderBottom: `1px solid ${C.border}` }}>
                      <h2 style={{ ...serif, fontStyle: "italic", fontSize: "1.65rem", color: C.ink, fontWeight: 400 }}>Clinical Pearls</h2>
                      <span style={{ ...mono, fontSize: "0.6rem", color: C.inkFaint }}>{lesson.pearls?.length} items</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.55rem" }}>
                      {lesson.pearls?.map((pearl, i) => (
                        <div key={i} style={{
                          padding: "0.85rem 0.95rem",
                          background: C.surfaceAlt,
                          border: `1px solid ${C.border}`,
                          borderRadius: 8, animation: "fadeUp 0.35s ease both", animationDelay: `${i * 0.05}s`
                        }}>
                          <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
                            <span style={{ ...mono, fontSize: "0.56rem", color: C.accentMid, flexShrink: 0, marginTop: 3, fontWeight: 500 }}>{String(i + 1).padStart(2, "0")}</span>
                            <p style={{ fontFamily: "Georgia, serif", fontSize: "0.87rem", color: C.inkMid, lineHeight: 1.65 }}>
                              <MD text={pearl}/>
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <button onClick={() => navToPhase(LESSON_PHASES.APPLY)} style={{
                      display: "flex", alignItems: "center", gap: "0.45rem",
                      background: C.accent, color: "#fff", border: "none", borderRadius: 8,
                      padding: "0.75rem 1.9rem", fontFamily: "system-ui,sans-serif",
                      fontSize: "0.85rem", fontWeight: 500, cursor: "pointer", transition: "all 0.2s"
                    }}>Apply — Cases <Icons.Arrow/></button>
                  </div>
                </div>
              )}

              {/* ── CASES ── */}
              {lessonPhase === LESSON_PHASES.APPLY && (
                <div style={{ animation: "fadeUp 0.45s ease both" }}>
                  <div style={{ marginBottom: "2rem" }}>
                    <h2 style={{ ...serif, fontStyle: "italic", fontSize: "1.65rem", color: C.ink, fontWeight: 400, marginBottom: "0.4rem" }}>Clinical Cases</h2>
                    <p style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: "0.88rem", color: C.inkFaint }}>
                      Read the vignette fully, then commit before seeing the explanation.
                    </p>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", marginBottom: "3rem" }}>
                    {lesson.cases?.map((c, i) => (
                      <CaseCard key={c.id} cas={c} index={i} onAnswer={handleAnswer}/>
                    ))}
                  </div>

                  {casesAnswered > 0 && (
                    <div style={{ textAlign: "center", padding: "1.25rem", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: "1.5rem" }}>
                      <p style={{ ...mono, fontSize: "0.68rem", color: C.inkFaint, letterSpacing: "0.08em" }}>
                        {casesAnswered} of {lesson.cases?.length} answered · {accuracy !== null ? `${accuracy}% cumulative accuracy` : "—"}
                      </p>
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <button onClick={reset}
                      style={{
                        display: "flex", alignItems: "center", gap: "0.35rem",
                        background: "none", border: `1px solid ${C.border}`,
                        borderRadius: 100, padding: "0.6rem 1.5rem",
                        color: C.inkMid, fontFamily: "system-ui", fontSize: "0.82rem",
                        cursor: "pointer", transition: "all 0.2s"
                      }}
                      onMouseOver={e => { e.currentTarget.style.color = C.accent; e.currentTarget.style.borderColor = C.accentBorder; }}
                      onMouseOut={e => { e.currentTarget.style.color = C.inkMid; e.currentTarget.style.borderColor = C.border; }}
                    ><Icons.Refresh/> New Topic</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        {chatOpen && lesson && <Chatbot lesson={lesson} onClose={() => setChatOpen(false)}/>}
      </div>
    </>
  );
}
