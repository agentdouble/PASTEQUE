import { InputHTMLAttributes, forwardRef } from 'react'
import clsx from 'clsx'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  fullWidth?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, fullWidth = false, ...props }, ref) => {
    return (
      <div className={clsx('flex flex-col gap-1.5', { 'w-full': fullWidth })}>
        {label && (
          <label className="text-sm font-medium text-primary-700">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={clsx(
            'px-3 py-2 rounded-lg border-2',
            'bg-white text-primary-950 placeholder:text-primary-400',
            'border-primary-200 focus:border-primary-400',
            'focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-1',
            'disabled:bg-primary-50 disabled:cursor-not-allowed',
            'transition-all duration-200',
            {
              'border-red-500 focus:border-red-600 focus:ring-red-500': error,
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

Input.displayName = 'Input'

export default Input
