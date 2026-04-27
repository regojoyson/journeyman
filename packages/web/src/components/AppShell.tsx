import { Link, NavLink, Outlet } from "react-router-dom";

const styles = {
  nav: {
    display: "flex", alignItems: "center", gap: 16,
    background: "#11111a", borderBottom: "1px solid #2a2a3a",
    padding: "10px 18px", fontSize: 13,
  } as React.CSSProperties,
  brand: { fontWeight: 700, color: "#4a9eff", marginRight: 12, textDecoration: "none" } as React.CSSProperties,
  link: { color: "#aaa", textDecoration: "none" } as React.CSSProperties,
  linkActive: { color: "#fff", fontWeight: 600 } as React.CSSProperties,
  body: { height: "calc(100vh - 41px)", overflow: "hidden" } as React.CSSProperties,
};

export default function AppShell() {
  return (
    <div>
      <nav style={styles.nav}>
        <Link to="/" style={styles.brand}>◆ Journeyman</Link>
        <NavLink to="/flows" style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.linkActive : {}) })}>Flows</NavLink>
        <NavLink to="/runs" style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.linkActive : {}) })}>Runs</NavLink>
      </nav>
      <main style={styles.body}>
        <Outlet />
      </main>
    </div>
  );
}
