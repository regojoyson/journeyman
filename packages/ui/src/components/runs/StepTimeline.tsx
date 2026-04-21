// packages/ui/src/components/runs/StepTimeline.tsx
import { RunStep } from '@/types/api.types';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

interface StepTimelineProps { steps: RunStep[]; onStepClick?: (step: RunStep) => void; }

const STATUS_STYLES: Record<string, { circle: string; line: string; icon: string }> = {
  completed: { circle: 'fill-emerald-500 stroke-emerald-600', line: 'stroke-emerald-400', icon: '✓' },
  running: { circle: 'fill-blue-500 stroke-blue-600', line: 'stroke-blue-400', icon: '↻' },
  failed: { circle: 'fill-rose-500 stroke-rose-600', line: 'stroke-rose-400', icon: '✕' },
  blocked: { circle: 'fill-amber-500 stroke-amber-600', line: 'stroke-amber-400', icon: '⏸' },
  cancelled: { circle: 'fill-slate-200 stroke-slate-300', line: 'stroke-slate-300', icon: '—' },
};

export default function StepTimeline({ steps }: StepTimelineProps) {
  const [hoveredStep, setHoveredStep] = useState<RunStep | null>(null);
  const [expandedStep, setExpandedStep] = useState<RunStep | null>(null);

  const statusColors = STATUS_STYLES;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900">
          Pipeline: {steps[0]?.name || 'Unknown'} → ...
        </h2>
        <span className="ml-auto text-xs text-slate-400">
          {steps.filter(s => s.status === 'completed').length} / {steps.length} steps
        </span>
      </div>

      {/* Horizontal timeline */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-4">
        <svg className="min-w-[800px] h-24" viewBox="0 0 800 96">
          {/* Render steps left-to-right */}
          {steps.map((step, i) => {
            const x = 40 + i * (720 / Math.max(steps.length - 1, 1));
            const y = 48;
            const r = 20;
            const style = statusColors[step.status] || statusColors.completed;

            // Connection line to next step
            const lineColor = step.status === 'failed'
              ? 'stroke-rose-400'
              : step.status === 'running'
              ? 'stroke-blue-400'
              : i < steps.length - 1 && steps[i + 1].status === 'completed'
              ? 'stroke-emerald-400'
              : step.status === 'completed'
              ? 'stroke-emerald-400'
              : 'stroke-slate-300';

            return (
              <g key={step.stepId}>
                {/* Line to next */}
                {i < steps.length - 1 && (() => {
                  const nextX = 40 + (i + 1) * (720 / Math.max(steps.length - 1, 1));
                  return (
                    <line
                      x1={x + r} y1={y}
                      x2={nextX - r} y2={y}
                      className={lineColor}
                      strokeWidth={2}
                    />
                  );
                })()}

                {/* Circle */}
                <motion.circle
                  cx={x} cy={y} r={r}
                  className={style.circle}
                  strokeWidth={2}
                  whileHover={{ scale: 1.2 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setExpandedStep(expandedStep?.stepId === step.stepId ? null : step)}
                  onMouseEnter={() => setHoveredStep(step)}
                  onMouseLeave={() => setHoveredStep(null)}
                  style={{ cursor: 'pointer' }}
                />

                {/* Icon */}
                <text
                  x={x} y={y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="pointer-events-none fill-white text-[10px]"
                >
                  {style.icon}
                </text>

                {/* Label */}
                <text
                  x={x} y={y + r + 14}
                  textAnchor="middle"
                  className="pointer-events-none fill-slate-500 text-[9px] font-mono"
                >
                  {step.name}
                </text>

                {/* Duration */}
                {step.duration && (
                  <text
                    x={x} y={y + r + 26}
                    textAnchor="middle"
                    className="pointer-events-none fill-slate-400 text-[8px] font-mono"
                  >
                    {step.duration}s
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Expanded step panel */}
      {expandedStep && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          <div className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-mono font-semibold text-slate-900">{expandedStep.name}</h3>
              <button onClick={() => setExpandedStep(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
              <div>Status: <span className="font-medium text-slate-700">{expandedStep.status}</span></div>
              <div>Duration: <span className="font-medium text-slate-700">{expandedStep.duration ? `${expandedStep.duration}s` : '—'}</span></div>
              <div>Started: <span className="font-medium text-slate-700">{expandedStep.startedAt || '—'}</span></div>
              <div>Ended: <span className="font-medium text-slate-700">{expandedStep.endedAt || '—'}</span></div>
              <div>Log lines: <span className="font-medium text-slate-700">{expandedStep.logLines}</span></div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Tooltip */}
      {hoveredStep && !expandedStep && (
        <div className="rounded bg-slate-900 px-2 py-1 text-xs text-white">
          {hoveredStep.name} — {hoveredStep.status} ({hoveredStep.duration ? `${hoveredStep.duration}s` : '...'})
        </div>
      )}
    </div>
  );
}
