import React from 'react';

interface PageHeaderProps {
  /** Icon to display before the title. Usually a lucide-react icon node. */
  icon?: React.ReactNode;
  /** Page title (matches the sidebar label). */
  title: string;
  /** Short description shown beneath the title. */
  description?: string;
  /** Optional action area rendered on the right side (e.g. "New" button). */
  action?: React.ReactNode;
}

/**
 * Unified page header used across all top-level pages to keep the layout,
 * typography and spacing consistent.
 */
const PageHeader: React.FC<PageHeaderProps> = ({
  icon,
  title,
  description,
  action,
}) => {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
          {icon && <span className="flex-shrink-0">{icon}</span>}
          <span className="truncate">{title}</span>
        </h1>
        {description && (
          <p className="text-sm text-muted">{description}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
};

export default PageHeader;
