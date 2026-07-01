import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, style, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-[rgb(11_42_99_/_0.64)] px-3 py-2 text-sm text-cyan-50 shadow-[inset_0_0_16px_rgba(28,106,214,0.2)] ring-offset-background placeholder:text-cyan-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      ref={ref}
      style={{ colorScheme: 'dark', ...style }}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
