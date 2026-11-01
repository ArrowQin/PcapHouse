import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, Clock, ExternalLink } from 'lucide-react';
import { GenerateTask } from '../../types';

interface TaskStatusCardProps {
  task: GenerateTask;
}

const STAGES = ['parsing', 'capturing', 'processing', 'saving'] as const;
const STAGE_LABELS: Record<string, string> = {
  parsing: 'Parsing',
  capturing: 'Capturing',
  processing: 'Processing',
  saving: 'Saving',
};

function stageIndex(status: string): number {
  const idx = STAGES.indexOf(status as any);
  if (status === 'success') return STAGES.length;
  if (status === 'failed') return -1;
  return idx;
}

const TaskStatusCard: React.FC<TaskStatusCardProps> = ({ task }) => {
  const navigate = useNavigate();
  const isRunning = !['success', 'failed', 'pending'].includes(task.status);
  const isSuccess = task.status === 'success';
  const isFailed = task.status === 'failed';
  const currentStage = stageIndex(task.status);

  return (
    <div className="p-3 bg-dark-700 border border-dark-600 rounded-xl space-y-2 transition-all hover:border-dark-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-white font-medium truncate max-w-[180px]">
          {task.filename || `task-${task.uuid.slice(0, 8)}`}
        </span>
        <span
          className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
            isSuccess
              ? 'bg-green-500/15 text-green-400'
              : isFailed
              ? 'bg-red-500/15 text-red-400'
              : isRunning
              ? 'bg-yellow-500/15 text-yellow-400'
              : 'bg-dark-500 text-muted'
          }`}
        >
          {isSuccess && <CheckCircle size={12} />}
          {isFailed && <XCircle size={12} />}
          {isRunning && <Loader2 size={12} className="animate-spin" />}
          {task.status === 'pending' && <Clock size={12} />}
          {task.status}
        </span>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 text-[11px] text-muted-dark">
        <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded font-semibold uppercase">
          {task.protocol}
        </span>
        <span className="font-mono">
          {task.src_ip}
          {task.src_port != null && <>:{task.src_port}</>}
          {' → '}
          {task.dst_ip}:{task.dst_port ?? task.port}
        </span>
      </div>

      {/* Progress bar (only when running) */}
      {isRunning && (
        <div className="flex items-center gap-1 pt-1">
          {STAGES.map((s, i) => (
            <div key={s} className="flex-1 flex flex-col items-center gap-0.5">
              <div
                className={`w-full h-1 rounded-full transition-colors ${
                  i < currentStage
                    ? 'bg-primary'
                    : i === currentStage
                    ? 'bg-yellow-400 animate-pulse'
                    : 'bg-dark-500'
                }`}
              />
              <span className={`text-[9px] ${i <= currentStage ? 'text-muted' : 'text-muted-dark'}`}>
                {STAGE_LABELS[s]}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Error message */}
      {isFailed && task.error_message && (
        <p className="text-[11px] text-red-400/80 line-clamp-2 mt-1">
          {task.error_message}
        </p>
      )}

      {/* Success link */}
      {isSuccess && task.file_id && (
        <button
          onClick={() => navigate(`/pcap/${task.file_id}`)}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary-hover transition-colors mt-1 cursor-pointer"
        >
          <ExternalLink size={12} />
          View in Pcap Viewer
        </button>
      )}

      {/* Timestamp */}
      <div className="text-[10px] text-muted-dark">
        {new Date(task.created_at).toLocaleString()}
      </div>
    </div>
  );
};

export default TaskStatusCard;
