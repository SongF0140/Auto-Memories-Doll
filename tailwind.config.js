/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* 背景：暖白系 */
        bg: "var(--color-bg)",
        "bg-secondary": "var(--color-bg-secondary)",
        "bg-tertiary": "var(--color-bg-tertiary)",
        /* 表面：卡片白 */
        surface: "var(--color-surface)",
        "surface-elevated": "var(--color-surface-elevated)",
        /* 文字：深棕系 */
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-tertiary": "var(--color-text-tertiary)",
        /* 边框：浅棕 */
        border: "var(--color-border-default)",
        "border-hover": "var(--color-border-hover)",
        "border-strong": "var(--color-border-strong)",
        /* 强调色：暗金 */
        accent: "var(--color-accent)",
        "accent-hover": "var(--color-accent-hover)",
        "accent-text": "var(--color-accent-text)",
        "accent-light": "#D4B84A",
        "accent-soft": "rgba(166, 124, 0, 0.10)",
        muted: "var(--color-muted)",
        /* 状态色（暖色调） */
        error: "var(--color-error)",
        "error-bg": "var(--color-error-bg)",
        success: "var(--color-success)",
        "success-bg": "var(--color-success-bg)",
        warning: "var(--color-warning)",
        "warning-bg": "var(--color-warning-bg)",
        gold: "var(--color-gold)",
        /* 品牌色：棕白金 */
        brown: {
          DEFAULT: "#3E3224",
          light: "#5D4E37",
          lighter: "#8B7355",
          dark: "#2C2416",
          darker: "#1E1910",
        },
        cream: {
          DEFAULT: "#FFFDF9",
          warm: "#F5F0E8",
          alt: "#FAF7F2",
        },
        amber: {
          DEFAULT: "#A67C00",
          light: "#C9A227",
          lighter: "#D4B84A",
          soft: "rgba(166, 124, 0, 0.10)",
        },
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "10px",
        md: "10px",
        lg: "16px",
        xl: "20px",
        full: "9999px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        focus: "var(--shadow-focus)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        glow: "var(--shadow-glow)",
        inner: "var(--shadow-inner)",
      },
      fontFamily: {
        sans: [
          '"Geist"',
          '"Inter"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
        mono: [
          '"Geist Mono"',
          '"SF Mono"',
          '"Consolas"',
          '"PingFang SC"',
          'monospace',
        ],
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1.125rem" }],
        sm: ["0.875rem", { lineHeight: "1.375rem" }],
        base: ["1rem", { lineHeight: "1.5rem" }],
        lg: ["1.125rem", { lineHeight: "1.625rem" }],
        xl: ["1.25rem", { lineHeight: "1.875rem" }],
        "2xl": ["1.5rem", { lineHeight: "2rem" }],
        "3xl": ["2rem", { lineHeight: "2.5rem" }],
      },
      spacing: {
        18: "4.5rem",
        22: "5.5rem",
      },
      transitionDuration: {
        DEFAULT: "200ms",
        150: "150ms",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      backgroundImage: {
        'pop-dots': `
          radial-gradient(rgba(166, 124, 0, 0.08) 1.5px, transparent 1.5px),
          radial-gradient(rgba(139, 115, 85, 0.06) 1px, transparent 1px)
        `,
      },
      backgroundSize: {
        'pop-dots': '48px 48px, 48px 48px',
      },
    },
  },
  plugins: [],
};
