import { useEffect, useState } from "react";

import { AgentAvatarPortrait } from "@/features/rooms/members/agent-avatar-portrait";

/** What Linger says first, one nudge at a time, across a working day. */
const NUDGES = [
  { time: "9:00 AM", text: "Demo is tomorrow. I drafted the brief." },
  { time: "1:30 PM", text: "I reviewed the code. Two notes." },
  { time: "5:00 PM", text: "Before you go: the deck is ready." },
] as const;

const LINGER_AVATAR = "figure:red_panda:79524A";
// The first nudge waits for the headline and the timeline to settle.
const FIRST_NUDGE_MS = 3_000;
const NUDGE_EVERY_MS = 4_000;
// Long enough to start one peek-and-smile; the figure then finishes it and
// rests on its last frame.
const AWAKE_MS = 1_000;

type MomentState = "later" | "now" | "past";

/**
 * The login page's picture: Linger's working day, a personal AI on your
 * own computer reaching out before it is asked, one nudge lighting up at a
 * time. It is decorative; the login shell hides it from assistive technology.
 */
export function AuthIllustration() {
  // Reduced motion keeps the first nudge lit and never starts the loop.
  const [landed, setLanded] = useState(() => (prefersReducedMotion() ? 1 : 0));
  const [awake, setAwake] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let loop: number | undefined;
    let sleep: number | undefined;
    const land = () => {
      setLanded((count) => count + 1);
      setAwake(true);
      window.clearTimeout(sleep);
      sleep = window.setTimeout(() => setAwake(false), AWAKE_MS);
    };
    const first = window.setTimeout(() => {
      land();
      loop = window.setInterval(land, NUDGE_EVERY_MS);
    }, FIRST_NUDGE_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(loop);
      window.clearTimeout(sleep);
    };
  }, []);

  const current = landed === 0 ? null : (landed - 1) % NUDGES.length;

  return (
    <div className="auth-art">
      <div className="auth-art-copy">
        <h2 className="auth-art-title">
          <span>Your personal AI.</span>
          <span>A step ahead.</span>
        </h2>
        <p className="auth-art-lede">
          Linger runs on your own computer, keeps track of your work, and
          reaches out before anything slips.
        </p>
      </div>

      <div className="auth-art-day">
        <div className="auth-art-day-head">
          <span className="auth-art-avatar">
            <AgentAvatarPortrait animate={awake} avatarKey={LINGER_AVATAR} />
            {/* Keyed by the landing so the badge pops again for each nudge. */}
            {current === null ? null : (
              <span className="auth-art-badge town-pill-pop" key={landed}>
                1
              </span>
            )}
          </span>
          <span className="auth-art-day-name">Linger</span>
        </div>
        <ol className="auth-art-timeline">
          {NUDGES.map((nudge, index) => (
            <li
              className="auth-art-moment"
              data-state={momentState(index, current)}
              key={nudge.time}
            >
              <span className="auth-art-moment-time">{nudge.time}</span>
              <span className="auth-art-moment-text">{nudge.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Earlier moments of the day stay lit; later ones wait. */
function momentState(index: number, current: number | null): MomentState {
  if (current === null || index > current) return "later";
  return index === current ? "now" : "past";
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
