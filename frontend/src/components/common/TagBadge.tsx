import React from 'react';
import { Tag } from '../../types';

interface TagBadgeProps {
  tag: Tag;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}

const TagBadge: React.FC<TagBadgeProps> = ({ tag, onRemove, size = 'sm' }) => {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium transition-all ${
        size === 'sm'
          ? 'px-2 py-0.5 text-[11px]'
          : 'px-3 py-1 text-xs'
      }`}
      style={{
        backgroundColor: `${tag.color}20`,
        color: tag.color,
        border: `1px solid ${tag.color}40`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: tag.color }}
      />
      {tag.name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 hover:opacity-70 transition-opacity"
        >
          ×
        </button>
      )}
    </span>
  );
};

export default TagBadge;
