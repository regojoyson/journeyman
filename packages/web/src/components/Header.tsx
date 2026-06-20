import { Link } from "react-router-dom";
import { ThemeToggle } from "@journeyman/theme";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher.tsx";
import { ProfileMenu } from "./ProfileMenu.tsx";
import { Logo } from "./Logo.tsx";

export function Header() {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        height: 56,
        flexShrink: 0,
        padding: "0 14px",
        background: "rgb(var(--color-surface) / 1)",
        borderBottom: "1px solid rgb(var(--color-border) / 1)",
        zIndex: 30,
      }}
    >
      <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
        <Logo height={42} />
      </Link>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <WorkspaceSwitcher />
        <ThemeToggle />
        <ProfileMenu />
      </div>
    </header>
  );
}
