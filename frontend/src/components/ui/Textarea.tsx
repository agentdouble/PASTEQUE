import { TextareaHTMLAttributes, forwardRef } from 'react'
import clsx from 'clsx'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  fullWidth?: boolean
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, fullWidth = false, ...props }, ref) => {
    return (
      <div className={clsx('flex flex-col gap-1.5', { 'w-full': fullWidth })}>
        {label && (
          <label className="text-sm font-medium text-primary-700">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          className={clsx(
            'px-3 py-0 rounded-lg border-2',
            'bg-white text-primary-950 placeholder:text-primary-400',
            'border-primary-200 focus:border-primary-400',
            'focus:outline-none',
            'disabled:bg-primary-50 disabled:cursor-not-allowed',
            'resize-none',
            'transition-all duration-200',
            {
              'border-red-500 focus:border-red-600': error,
            },
            className
          )}
          {...props}
        />
        {error && (
          <span className="text-sm text-red-600">{error}</span>
        )}
      </div>
    )
  }
)

Textarea.displayName = 'Textarea'

export default Textarea
