import type { Appearance } from "@clerk/shared/types";

// Mirrors the CSS custom properties in index.css (:root). Kept as literal hex
// rather than var(--x) because Clerk's appearance engine renders these into
// its own injected stylesheet, and some fields validate strict CSS color
// syntax — a plain string is the least surprising option to depend on.
const color = {
  bg: "#0d1117",
  bgPanel: "#161b22",
  bgElevated: "#1c232c",
  border: "#2a3441",
  text: "#e6edf3",
  textDim: "#8b949e",
  accent: "#58a6ff",
  accentDim: "#1f6feb",
  red: "#f85149",
};

const fontFamily = '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';

/**
 * Passed to <ClerkProvider appearance={...}> so every Clerk component (the
 * sign-in card, the UserButton popover, etc.) inherits Codescape's dark
 * theme instead of Clerk's default light one.
 */
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: color.accent,
    colorBackground: color.bgPanel,
    colorText: color.text,
    colorTextSecondary: color.textDim,
    colorInputBackground: color.bgElevated,
    colorInputText: color.text,
    colorDanger: color.red,
    colorNeutral: color.border,
    borderRadius: "10px",
    fontFamily,
  },
  elements: {
    card: {
      background: color.bgPanel,
      border: `1px solid ${color.border}`,
      borderRadius: "16px",
      boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    },
    headerTitle: { color: color.text },
    headerSubtitle: { color: color.textDim },
    socialButtonsBlockButton: {
      background: color.bgElevated,
      border: `1px solid ${color.border}`,
      color: color.text,
      "&:hover": { borderColor: color.accent, background: color.bgElevated },
    },
    socialButtonsBlockButtonText: { color: color.text, fontWeight: 600 },
    dividerLine: { background: color.border },
    dividerText: { color: color.textDim },
    formFieldLabel: { color: color.textDim },
    formFieldInput: {
      background: color.bgElevated,
      border: `1px solid ${color.border}`,
      color: color.text,
      "&:focus": { borderColor: color.accent, boxShadow: `0 0 0 1px ${color.accent}` },
    },
    formFieldInputShowPasswordButton: { color: color.textDim },
    formButtonPrimary: {
      background: color.accentDim,
      border: `1px solid ${color.accent}`,
      fontSize: "13px",
      "&:hover, &:focus, &:active": { background: color.accentDim, filter: "brightness(1.12)" },
    },
    footer: { background: "transparent" },
    footerActionText: { color: color.textDim },
    footerActionLink: { color: color.accent, "&:hover": { color: color.accent } },
    identityPreview: { background: color.bgElevated, border: `1px solid ${color.border}` },
    identityPreviewText: { color: color.text },
    identityPreviewEditButton: { color: color.accent },
    otpCodeFieldInput: { color: color.text, borderColor: color.border },
    formResendCodeLink: { color: color.accent },
    // UserButton's account popover (top-right menu once signed in).
    userButtonPopoverCard: {
      background: color.bgPanel,
      border: `1px solid ${color.border}`,
      boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    },
    userButtonPopoverMain: { background: color.bgPanel },
    userButtonPopoverActionButton: {
      color: color.text,
      "&:hover": { background: color.bgElevated },
    },
    userButtonPopoverActionButtonText: { color: color.text },
    userButtonPopoverActionButtonIcon: { color: color.textDim },
    userButtonPopoverFooter: { background: "transparent" },
    userPreviewTextContainer: { color: color.text },
    userPreviewSecondaryIdentifier: { color: color.textDim },
  },
};
