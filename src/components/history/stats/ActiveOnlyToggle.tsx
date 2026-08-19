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
      className={`group -mr-2 inline-flex min-h-11 touch-manipulation items-center gap-2.5 rounded-md px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500 lg:mr-0 lg:min-h-0 lg:gap-2 lg:px-0 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`text-xs font-medium transition-colors lg:text-[11px] lg:font-normal ${
          activeOnly ? 'text-gray-700 dark:text-zinc-200' : 'text-gray-400 dark:text-zinc-500'
        }`}
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 flex-none rounded-full transition-colors lg:h-[14px] lg:w-[26px] ${
          activeOnly ? 'bg-gray-700 dark:bg-zinc-200' : 'bg-gray-200 dark:bg-zinc-700'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full transition-transform lg:h-[10px] lg:w-[10px] ${
            activeOnly
              ? 'translate-x-4 bg-white lg:translate-x-3 dark:bg-zinc-900'
              : 'translate-x-0 bg-white dark:bg-zinc-400'
          }`}
        />
      </span>
    </button>
  );
}
