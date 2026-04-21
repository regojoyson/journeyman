// packages/ui/src/App.tsx
import { Routes, Route } from 'react-router-dom';
import AppShell from '@/components/layout/AppShell';
import RunList from '@/components/runs/RunList';
import RunDetail from '@/components/runs/RunDetail';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<RunList />} />
        <Route path="/run/:sessionId" element={<RunDetail />} />
      </Routes>
    </AppShell>
  );
}
