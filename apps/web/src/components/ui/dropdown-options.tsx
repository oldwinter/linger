import type { ComponentProps, ReactNode } from "react";

/**
 * The floating option list every Select opens, after Figma 8713:10526, drawn
 * as the Town dropdown: a 6px popover card whose 33px rows highlight in accent.
 * Positioning, roles, and keyboard handling stay with the caller.
 */
export function DropdownOptions({
  children,
  className = "",
  header,
  listClassName = "",
  listProps,
  ref,
  ...props
}: ComponentProps<"div"> & {
  header?: ReactNode;
  listClassName?: string;
  listProps?: ComponentProps<"div">;
}) {
  return (
    <div {...props} className={`dropdown-options ${className}`} ref={ref}>
      {header}
      <div
        {...listProps}
        className={`dropdown-options-list workspace-scrollbar ${listClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

export function DropdownOption({
  children,
  className = "",
  labelClassName = "",
  leading,
  trailing,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  children: ReactNode;
  labelClassName?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <button type="button" {...props} className={`dropdown-option ${className}`}>
      {leading}
      <span className={`dropdown-option-label truncate ${labelClassName}`}>
        {children}
      </span>
      {trailing}
    </button>
  );
}
