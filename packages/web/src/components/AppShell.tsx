import { Outlet } from "react-router-dom";
import { Header } from "./Header.tsx";
import Sidebar from "./Sidebar.tsx";

export default function AppShell() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar />
        <main style={{ flex: 1, overflow: "hidden" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
