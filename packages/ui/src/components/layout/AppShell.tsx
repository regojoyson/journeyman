// packages/ui/src/components/layout/AppShell.tsx
import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

interface AppShellProps { children: ReactNode; }

export default function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen w-full flex-col">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
