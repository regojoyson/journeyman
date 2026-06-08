import themePreset from "@journeyman/theme/tailwind-preset";
import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [themePreset],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../flow-editor/src/**/*.{ts,tsx}",
    "../run-viewer/src/**/*.{ts,tsx}",
    "../runs-list/src/**/*.{ts,tsx}",
  ],
  theme: { extend: {} },
  plugins: [typography],
};
