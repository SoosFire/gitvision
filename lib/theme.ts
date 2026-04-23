// Design tokens for the Linear-lighter theme.
// Centralized so components don't duplicate hex values.
// Import as `import { TOK } from "@/lib/theme"`.

export const TOK = {
  // Surfaces
  bg: "#14141B",
  bgDeep: "#0E0E14",
  surface: "#1C1C26",
  surfaceElevated: "#23232E",

  // Borders
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",

  // Text
  textPrimary: "#E8E8EE",
  textSecondary: "#9898A8",
  textMuted: "#6E6E7E",

  // Accent (emerald family, kept consistent with brand)
  accent: "#10b981",
  accentOn: "#0a1f16", // text color on accent bg
  accentSoft: "rgba(16,185,129,0.12)",
  accentStrong: "#059669",

  // Status
  amber: "#f59e0b",
  amberSoft: "rgba(245,158,11,0.12)",
  rose: "#f87171",
  roseSoft: "rgba(244,63,94,0.15)",
} as const;

export type ThemeTokens = typeof TOK;
