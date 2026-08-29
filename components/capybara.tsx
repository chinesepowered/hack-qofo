/**
 * The CapyGuard mascot set.
 *
 * One base capybara drawn as inline SVG (no image assets, no external fetches),
 * parameterised by mood and by the accessory that identifies each inspector role.
 * Capybara heads are famously blunt and brick-shaped, so the silhouette is a wide
 * rounded rect rather than a circle — that is what makes it read as "capybara"
 * and not "generic rodent".
 */

export type CapyMood = "calm" | "curious" | "alert" | "alarmed" | "sleepy";
export type CapyAccessory = "none" | "headlamp" | "glasses" | "yuzu" | "pencil";

const MOOD_BROW: Record<CapyMood, string | null> = {
  calm: null,
  curious: "M38 33 Q44 29 50 32",
  alert: "M37 32 Q44 28 51 31",
  alarmed: "M37 29 Q44 34 51 30",
  sleepy: null,
};

export function Capybara({
  mood = "calm",
  accessory = "none",
  size = 96,
  bob = false,
  className = "",
  title,
}: {
  mood?: CapyMood;
  accessory?: CapyAccessory;
  size?: number;
  bob?: boolean;
  className?: string;
  title?: string;
}) {
  const brow = MOOD_BROW[mood];
  const sleeping = mood === "sleepy";
  const wide = mood === "alarmed";
  const eyeR = wide ? 5.4 : 4.2;

  return (
    <svg
      width={size}
      height={size * (100 / 120)}
      viewBox="0 0 120 100"
      fill="none"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={`${bob ? "animate-bob" : ""} ${className}`}
    >
      {/* ears */}
      <ellipse cx="30" cy="22" rx="10" ry="9" fill="var(--color-fur-dark)" />
      <ellipse cx="30" cy="23" rx="5" ry="4.5" fill="var(--color-snout)" opacity="0.55" />
      <ellipse cx="90" cy="22" rx="10" ry="9" fill="var(--color-fur-dark)" />
      <ellipse cx="90" cy="23" rx="5" ry="4.5" fill="var(--color-snout)" opacity="0.55" />

      {/* head */}
      <rect x="18" y="16" width="84" height="68" rx="30" fill="var(--color-fur)" />
      {/* top highlight so the fur reads as rounded */}
      <rect x="26" y="21" width="68" height="26" rx="16" fill="var(--color-fur-light)" opacity="0.42" />

      {/* eyes */}
      {sleeping ? (
        <>
          <path d="M38 45 Q44 50 50 45" stroke="var(--color-snout)" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M70 45 Q76 50 82 45" stroke="var(--color-snout)" strokeWidth="2.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx="44" cy="45" rx={eyeR} ry={eyeR} fill="#2b1c11" />
          <ellipse cx="76" cy="45" rx={eyeR} ry={eyeR} fill="#2b1c11" />
          {/* catchlights — the single biggest "cute" lever */}
          <circle cx={45.6} cy={43.4} r="1.5" fill="#fff" opacity="0.95" />
          <circle cx={77.6} cy={43.4} r="1.5" fill="#fff" opacity="0.95" />
        </>
      )}

      {brow && (
        <>
          <path d={brow} stroke="var(--color-fur-dark)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          {/* Same path, mirrored about the centre of the 120-wide viewBox. Rewriting
              the coordinates by hand would offset y as well as x and skew the face. */}
          <path
            d={brow}
            stroke="var(--color-fur-dark)"
            strokeWidth="2.4"
            strokeLinecap="round"
            fill="none"
            transform="scale(-1,1) translate(-120,0)"
          />
        </>
      )}

      {/* snout */}
      <ellipse cx="60" cy="68" rx="24" ry="16" fill="var(--color-fur-light)" />
      <ellipse cx="60" cy="65" rx="11" ry="7" fill="var(--color-snout)" />
      <ellipse cx="56" cy="63.5" rx="1.9" ry="2.5" fill="#1c1109" opacity="0.75" />
      <ellipse cx="64" cy="63.5" rx="1.9" ry="2.5" fill="#1c1109" opacity="0.75" />
      <path
        d={mood === "alarmed" ? "M54 76 Q60 71 66 76" : "M54 74 Q60 79 66 74"}
        stroke="var(--color-snout)"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />

      {/* blush */}
      <ellipse cx="31" cy="60" rx="7" ry="4.5" fill="var(--color-danger)" opacity="0.16" />
      <ellipse cx="89" cy="60" rx="7" ry="4.5" fill="var(--color-danger)" opacity="0.16" />

      <Accessory kind={accessory} />
    </svg>
  );
}

function Accessory({ kind }: { kind: CapyAccessory }) {
  switch (kind) {
    case "headlamp":
      return (
        <g>
          <rect x="42" y="10" width="36" height="7" rx="3.5" fill="var(--color-water-soft)" />
          <circle cx="60" cy="13" r="7.5" fill="var(--color-yuzu)" />
          <circle cx="60" cy="13" r="3.5" fill="#fffbe8" />
          <path d="M60 13 L36 -6 L84 -6 Z" fill="var(--color-yuzu)" opacity="0.22" />
        </g>
      );
    case "glasses":
      return (
        <g stroke="var(--color-water-soft)" strokeWidth="2.6" fill="none">
          <circle cx="44" cy="45" r="12" fill="var(--color-spring-mist)" fillOpacity="0.35" />
          <circle cx="76" cy="45" r="12" fill="var(--color-spring-mist)" fillOpacity="0.35" />
          <path d="M56 45 H64" strokeLinecap="round" />
          <path d="M32 43 L20 39" strokeLinecap="round" />
          <path d="M88 43 L100 39" strokeLinecap="round" />
        </g>
      );
    case "yuzu":
      return (
        <g className="animate-drift">
          <circle cx="86" cy="12" r="11" fill="var(--color-yuzu)" />
          <circle cx="86" cy="12" r="11" fill="var(--color-yuzu-deep)" opacity="0.22" />
          <ellipse cx="82.5" cy="8.5" rx="3.5" ry="2.6" fill="#fff" opacity="0.5" />
          <path d="M86 1 Q90 -4 95 -2 Q91 2 86 2 Z" fill="var(--color-safe)" />
        </g>
      );
    case "pencil":
      return (
        <g>
          <rect
            x="86"
            y="6"
            width="6"
            height="26"
            rx="2"
            fill="var(--color-yuzu)"
            transform="rotate(24 89 19)"
          />
          <path d="M97 32 L100 40 L92 37 Z" fill="var(--color-snout)" transform="rotate(24 89 19)" />
        </g>
      );
    default:
      return null;
  }
}

/** Rising steam wisps — used behind the mascot to sell the hot-spring setting. */
export function Steam({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-visible ${className}`} aria-hidden="true">
      {[
        { left: "22%", delay: "0s" },
        { left: "48%", delay: "1.1s" },
        { left: "72%", delay: "2.2s" },
      ].map((w) => (
        <span
          key={w.left}
          className="animate-steam absolute bottom-full block h-8 w-8 rounded-full blur-md"
          style={{
            left: w.left,
            animationDelay: w.delay,
            background: "color-mix(in srgb, var(--color-spring-mist) 70%, transparent)",
          }}
        />
      ))}
    </div>
  );
}
