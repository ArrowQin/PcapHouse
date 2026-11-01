import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { ProtocolNode } from '../../types';

interface ProtocolTreeProps {
  protocols: ProtocolNode[];
}

const TreeNode: React.FC<{ node: ProtocolNode; depth: number }> = ({ node, depth }) => {
  // Default every node to collapsed — mirrors Wireshark's native
  // behavior and keeps the initial view compact, especially for
  // packets with deep protocol stacks (e.g. tunneled or TLS traffic).
  // The user can expand exactly what they care about.
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <div
        onClick={() => hasChildren && setExpanded(!expanded)}
        className={`flex items-center gap-1.5 py-1 px-2 text-xs font-mono hover:bg-dark-600/50 transition-colors rounded ${
          hasChildren ? 'cursor-pointer' : 'cursor-default'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown size={12} className="text-primary flex-shrink-0" />
          ) : (
            <ChevronRight size={12} className="text-muted-dark flex-shrink-0" />
          )
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        <span className={`${hasChildren ? 'text-white font-semibold' : 'text-muted'}`}>
          {node.label}
        </span>

        {node.value && node.value !== node.label && (
          <span className="text-primary/70 ml-1 truncate">
            : {node.value}
          </span>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children!.map((child, i) => (
            <TreeNode key={`${child.field}-${i}`} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

const ProtocolTree: React.FC<ProtocolTreeProps> = ({ protocols }) => {
  if (protocols.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-dark text-sm">
        Select a packet to view protocol details
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto py-1">
      {protocols.map((proto, i) => (
        <TreeNode key={`${proto.field}-${i}`} node={proto} depth={0} />
      ))}
    </div>
  );
};

export default ProtocolTree;
