import type { TaxType } from '@/types';
import { normalizeTaxType } from '@/types';
import { inputClass } from '@/components/ui/FormField';

type Props = {
  taxRate: number;
  taxType?: TaxType | string | null;
  onChange: (next: { tax_rate: number; tax_type: TaxType }) => void;
  className?: string;
};

export function TaxRateField({ taxRate, taxType, onChange, className = '' }: Props) {
  const type = normalizeTaxType(taxType);
  const buttonClass = (active: boolean) =>
    `flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
      active
        ? 'border-teal-500 bg-teal-50 text-teal-700'
        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
    }`;

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => onChange({ tax_rate: 10, tax_type: 'exclusive' })}
        className={buttonClass(type === 'exclusive' && taxRate === 10)}
      >
        10%
      </button>
      <button
        type="button"
        onClick={() => onChange({ tax_rate: 8, tax_type: 'exclusive' })}
        className={buttonClass(type === 'exclusive' && taxRate === 8)}
      >
        8%
      </button>
      <button
        type="button"
        onClick={() => onChange({ tax_rate: 0, tax_type: 'inclusive' })}
        className={buttonClass(type === 'inclusive')}
      >
        税込み
      </button>
      <input
        type="number"
        value={taxRate}
        onChange={(e) => onChange({ tax_rate: parseInt(e.target.value, 10) || 0, tax_type: type })}
        className={`${inputClass} w-20`}
        min={0}
        max={100}
      />
    </div>
  );
}
