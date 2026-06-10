/**
 * Icon set. 1.5px stroke, 14px viewBox — matches the design language.
 * Inline SVG instead of an icon library so they pick up `currentColor`
 * naturally and tree-shake to zero on unused icons.
 */

import type { ReactNode, SVGProps } from "react";

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  children?: ReactNode;
}

function Icon({ size = 14, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icons = {
  search:   (p?: IconProps) => <Icon {...p}><path d="M6 1.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM12.5 12.5l-3-3" /></Icon>,
  filter:   (p?: IconProps) => <Icon {...p}><path d="M1.5 2.5h11l-4 5v4l-3 1v-5z" /></Icon>,
  bell:     (p?: IconProps) => <Icon {...p}><path d="M7 1.5a3.5 3.5 0 0 0-3.5 3.5v2L2.5 9h9L10.5 7V5A3.5 3.5 0 0 0 7 1.5zM5.5 11A1.5 1.5 0 0 0 8.5 11" /></Icon>,
  chevR:    (p?: IconProps) => <Icon {...p}><path d="M5 2.5L9.5 7 5 11.5" /></Icon>,
  chevD:    (p?: IconProps) => <Icon {...p}><path d="M2.5 5L7 9.5 11.5 5" /></Icon>,
  plus:     (p?: IconProps) => <Icon {...p}><path d="M7 2.5v9M2.5 7h9" /></Icon>,
  edit:     (p?: IconProps) => <Icon {...p}><path d="M9.5 2.5l2 2-7 7H2.5v-2zM8.5 3.5l2 2" /></Icon>,
  lock:     (p?: IconProps) => <Icon {...p}><path d="M3.5 6.5h7v5h-7zM5 6.5V4.5a2 2 0 1 1 4 0v2" /></Icon>,
  warn:     (p?: IconProps) => <Icon {...p}><path d="M7 1.5l5.5 10h-11zM7 5.5v3M7 10v.5" /></Icon>,
  check:    (p?: IconProps) => <Icon {...p}><path d="M2.5 7.5l3 3 6-6" /></Icon>,
  x:        (p?: IconProps) => <Icon {...p}><path d="M3 3l8 8M11 3l-8 8" /></Icon>,
  download: (p?: IconProps) => <Icon {...p}><path d="M7 1.5v8M3.5 6.5L7 10l3.5-3.5M2.5 12.5h9" /></Icon>,
  share:    (p?: IconProps) => <Icon {...p}><path d="M10.5 4a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0zM5.5 8.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0zM10.5 12a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0zM4.7 7.7l3.6-2.4M4.7 9.3l3.6 2.4" /></Icon>,
  pin:      (p?: IconProps) => <Icon {...p}><path d="M5.5 1.5h3l-.5 3 1.5 1.5v1h-5v-1l1.5-1.5zM7 7v5" /></Icon>,
  map:      (p?: IconProps) => <Icon {...p}><path d="M1.5 3.5l3.5-1 4 1 3.5-1v9l-3.5 1-4-1-3.5 1zM5 2.5v9M9 3.5v9" /></Icon>,
  doc:      (p?: IconProps) => <Icon {...p}><path d="M3 1.5h6l2 2v9h-8zM9 1.5v2h2" /></Icon>,
  history:  (p?: IconProps) => <Icon {...p}><path d="M2.5 7a4.5 4.5 0 1 0 1.3-3.2L2.5 5M2.5 2v3h3M7 4.5V7l2 1.5" /></Icon>,
  layers:   (p?: IconProps) => <Icon {...p}><path d="M7 1.5L1.5 4 7 6.5 12.5 4zM1.5 7L7 9.5 12.5 7M1.5 10L7 12.5 12.5 10" /></Icon>,
  table:    (p?: IconProps) => <Icon {...p}><path d="M1.5 2.5h11v9h-11zM1.5 5.5h11M1.5 8.5h11M5 2.5v9" /></Icon>,
  bar:      (p?: IconProps) => <Icon {...p}><path d="M2.5 11.5v-4M5.5 11.5v-7M8.5 11.5v-2M11.5 11.5v-9" /></Icon>,
  trend:    (p?: IconProps) => <Icon {...p}><path d="M1.5 9.5L5 6l2.5 2L12.5 3M9.5 3h3v3" /></Icon>,
  diff:     (p?: IconProps) => <Icon {...p}><path d="M4.5 1.5v8M4.5 1.5L2 4M4.5 1.5L7 4M9.5 12.5v-8M9.5 12.5L7 10M9.5 12.5L12 10" /></Icon>,
};
