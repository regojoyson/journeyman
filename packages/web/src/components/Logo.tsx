import { useTheme } from "@journeyman/theme";

export function Logo({ height = 32, className }: { height?: number; className?: string }) {
  const { theme } = useTheme();
  const src = theme === "light" ? "/logo-light.svg" : "/logo-dark.svg";
  return <img src={src} alt="Journeyman" className={className} style={{ height, display: "block" }} />;
}

export function LogoMark({ height = 24, className }: { height?: number; className?: string }) {
  return <img src="/logo-mark.svg" alt="Journeyman" className={className} style={{ height, display: "block" }} />;
}
