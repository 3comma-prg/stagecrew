import { type ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
  error?: string;
}

export function FormField({ label, children, required, className = '', error }: FormFieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export function FormErrorList({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  const missing = errors.every((item) => item.includes('してください'));
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <p className="font-medium">{missing ? '未記入の項目があるため保存できません。' : '保存できませんでした。'}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {errors.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

export function fieldErrorClass(error?: string) {
  return error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : '';
}

export const inputClass =
  'min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 transition-colors focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 placeholder:text-slate-400 md:min-h-0 md:py-2 md:text-sm';
