'use client';

import React from 'react';

type ActiveOnlyToggleProps = {
  activeOnly: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
};

export function ActiveOnlyToggle({
  activeOnly,
  onChange,
  disabled = false,
}: ActiveOnlyToggleProps): React.ReactElement {
  const label = activeOnly ? 'Active only' : 'All owners';

  function handleToggle() {
    if (disabled) return;
    onChange(!activeOnly);
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={activeOnly}
      aria-label={label}
      disabled={disabled}
      onClick={handleToggle}
      className={`group inline-flex items-center gap-2 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`text-[11px] transition-colors ${
          activeOnly ? 'text-gray-700 dark:text-zinc-200' : 'text-gray-400 dark:text-zinc-500'
        }`}
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-[14px] w-[26px] flex-none rounded-full transition-colors ${
          activeOnly ? 'bg-gray-700 dark:bg-zinc-200' : 'bg-gray-200 dark:bg-zinc-700'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[10px] w-[10px] rounded-full transition-all ${
            activeOnly
              ? 'left-[14px] bg-white dark:bg-zinc-900'
              : 'left-[2px] bg-white dark:bg-zinc-400'
          }`}
        />
      </span>
    </button>
  );
}
