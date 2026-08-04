"use client";

type Props = {
  className?: string;
};

export function GuangheSprite({ className = "" }: Props) {
  return (
    <div className={`guanghe ${className}`}>
      <span className="guanghe__halo" aria-hidden />
      <svg
        className="guanghe__body"
        viewBox="0 0 260 310"
        role="img"
        aria-label="Lumina Story 创作精灵"
      >
        <defs>
          <linearGradient id="mascot-shell" x1="45" y1="30" x2="215" y2="270" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fff1b0" />
            <stop offset="0.38" stopColor="#e6ad45" />
            <stop offset="1" stopColor="#9c5e1d" />
          </linearGradient>
          <linearGradient id="mascot-face" x1="70" y1="70" x2="190" y2="235" gradientUnits="userSpaceOnUse">
            <stop stopColor="#443126" />
            <stop offset="1" stopColor="#17131a" />
          </linearGradient>
          <linearGradient id="mascot-gold" x1="70" y1="50" x2="190" y2="220" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fff6c7" />
            <stop offset="0.45" stopColor="#f1c35d" />
            <stop offset="1" stopColor="#b56d20" />
          </linearGradient>
          <radialGradient id="mascot-star" cx="50%" cy="40%">
            <stop stopColor="#fffde7" />
            <stop offset="0.5" stopColor="#ffe26d" />
            <stop offset="1" stopColor="#f39a1c" />
          </radialGradient>
          <filter id="mascot-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <g className="guanghe__wand" filter="url(#mascot-glow)">
          <path d="M129 65V18" stroke="#4b2b18" strokeWidth="8" strokeLinecap="round" />
          <path d="M129 28L137 41L152 44L141 54L143 69L129 62L115 69L117 54L106 44L121 41Z" fill="url(#mascot-star)" stroke="#ffe9a0" strokeWidth="2" />
        </g>

        <path className="guanghe__leaf guanghe__leaf--left" d="M99 51C79 31 62 37 59 54C76 65 91 64 99 51Z" fill="#8bdc55" stroke="#e9ffb8" strokeWidth="2" />
        <path className="guanghe__leaf guanghe__leaf--right" d="M158 51C177 30 194 37 197 54C180 65 166 64 158 51Z" fill="#8bdc55" stroke="#e9ffb8" strokeWidth="2" />

        <path className="guanghe__arm guanghe__arm--left" d="M53 184C25 184 18 207 35 221C48 230 62 219 72 207" fill="none" stroke="#17131a" strokeWidth="22" strokeLinecap="round" />
        <path className="guanghe__hand guanghe__hand--left" d="M29 211C18 203 20 188 31 183C39 180 48 187 48 195C56 189 67 194 65 203C62 216 43 220 29 211Z" fill="#211922" stroke="#c47d28" strokeWidth="5" />

        <path className="guanghe__arm guanghe__arm--right" d="M199 178C211 204 201 241 174 270C166 279 159 282 151 282" fill="none" stroke="#17131a" strokeWidth="22" strokeLinecap="round" />
        <path className="guanghe__hand guanghe__hand--right" d="M164 280C155 270 159 257 170 255C179 253 185 260 182 268C190 264 199 270 196 279C192 291 174 294 164 280Z" fill="#211922" stroke="#c47d28" strokeWidth="5" />

        <path d="M130 52C184 52 218 91 218 151C218 216 184 256 130 256C76 256 42 216 42 151C42 91 76 52 130 52Z" fill="url(#mascot-face)" stroke="url(#mascot-shell)" strokeWidth="10" />
        <g className="guanghe__rays" fill="none" stroke="url(#mascot-gold)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round">
          <path d="M121 71V112C121 124 114 133 102 141L75 158" />
          <path d="M139 71V108C139 122 146 132 158 140L187 158" />
          <path d="M76 179H103C115 179 122 187 127 202V224" />
          <path d="M184 179H157C145 179 138 187 133 202V224" />
        </g>

        <g className="guanghe__eyes">
          <ellipse cx="101" cy="157" rx="20" ry="27" fill="#fffaf0" />
          <ellipse cx="159" cy="157" rx="20" ry="27" fill="#fffaf0" />
          <ellipse cx="104" cy="161" rx="10" ry="17" fill="#a96927" />
          <ellipse cx="156" cy="161" rx="10" ry="17" fill="#a96927" />
          <circle cx="107" cy="154" r="4" fill="#fff" />
          <circle cx="159" cy="154" r="4" fill="#fff" />
        </g>
        <path d="M117 190C125 198 135 198 143 190" fill="none" stroke="#ffb07a" strokeWidth="6" strokeLinecap="round" />
        <path d="M112 204C123 216 137 216 148 204C145 227 115 227 112 204Z" fill="#ff806d" stroke="#391c25" strokeWidth="4" />
        <path d="M82 185C72 181 67 188 73 194" fill="none" stroke="#f18e74" strokeWidth="8" strokeLinecap="round" opacity=".65" />
        <path d="M178 185C188 181 193 188 187 194" fill="none" stroke="#f18e74" strokeWidth="8" strokeLinecap="round" opacity=".65" />
        <path d="M120 268C128 274 136 274 144 268" fill="none" stroke="#c47d28" strokeWidth="8" strokeLinecap="round" />
      </svg>
      <span className="guanghe__spark guanghe__spark--one" aria-hidden />
      <span className="guanghe__spark guanghe__spark--two" aria-hidden />
      <span className="guanghe__spark guanghe__spark--three" aria-hidden />
    </div>
  );
}
