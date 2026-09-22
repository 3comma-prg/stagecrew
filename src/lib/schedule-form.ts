import type { TimeType } from '@/types';

export type ScheduleFormValues = {
  project_id?: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  time_type: TimeType;
};

export type FieldError = {
  field: string;
  message: string;
};

export function validateScheduleForm(
  form: ScheduleFormValues,
  options?: { requireProject?: boolean }
): FieldError[] {
  const errors: FieldError[] = [];
  if (options?.requireProject && !form.project_id?.trim()) {
    errors.push({ field: 'project_id', message: 'プロジェクトを選択してください。' });
  }
  if (!form.start_date) {
    errors.push({ field: 'start_date', message: '開始日を入力してください。' });
  }
  if (form.time_type === 'time_limited') {
    if (!form.start_time) {
      errors.push({ field: 'start_time', message: '開始時刻を入力してください。' });
    }
    if (!form.end_time) {
      errors.push({ field: 'end_time', message: '終了時刻を入力してください。' });
    }
  }
  if (form.time_type === 'multi_day' && !form.end_date) {
    errors.push({ field: 'end_date', message: '終了日を入力してください。' });
  }
  if (form.start_date && form.end_date && form.end_date < form.start_date) {
    errors.push({ field: 'end_date', message: '終了日は開始日以降にしてください。' });
  }
  if (
    form.time_type === 'time_limited' &&
    form.start_date &&
    form.end_date &&
    form.start_date === form.end_date &&
    form.start_time &&
    form.end_time &&
    form.end_time <= form.start_time
  ) {
    errors.push({ field: 'end_time', message: '終了時刻は開始時刻より後にしてください。' });
  }
  return errors;
}

export function errorFor(errors: FieldError[], field: string) {
  return errors.find((item) => item.field === field)?.message || '';
}

export function inputErrorClass(errors: FieldError[], field: string) {
  return errorFor(errors, field) ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : '';
}
