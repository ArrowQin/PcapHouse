import React from 'react';
import { Star } from 'lucide-react';

interface StarButtonProps {
  isFavorite: boolean;
  onClick: () => void;
  size?: number;
}

const StarButton: React.FC<StarButtonProps> = ({ isFavorite, onClick, size = 16 }) => {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`p-1 rounded transition-all duration-200 hover:scale-110 ${
        isFavorite
          ? 'text-warning hover:text-warning/80'
          : 'text-muted-dark hover:text-warning'
      }`}
    >
      <Star
        size={size}
        fill={isFavorite ? 'currentColor' : 'none'}
        strokeWidth={isFavorite ? 0 : 2}
      />
    </button>
  );
};

export default StarButton;
