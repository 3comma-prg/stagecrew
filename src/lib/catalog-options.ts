import { useEffect, useState } from 'react';
import { loadSettings, saveSettings, subscribeSettings } from '@/lib/local-store';
import { POSITIONS, TASK_TYPES, mergeOptions, parseOptionList, resolveCatalogOptions, serializeOptionList } from '@/types';

export function useCatalogOptions() {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => subscribeSettings(() => setSettings(loadSettings())), []);

  const taskTypes = resolveCatalogOptions(TASK_TYPES, settings.custom_task_types);
  const positions = mergeOptions(POSITIONS, parseOptionList(settings.custom_positions));

  const addTaskType = async (name: string) => {
    const next = mergeOptions(resolveCatalogOptions(TASK_TYPES, settings.custom_task_types), [name]);
    await saveSettings({ custom_task_types: serializeOptionList(next) });
  };

  const reorderTaskTypes = async (ordered: string[]) => {
    const next = resolveCatalogOptions(TASK_TYPES, serializeOptionList(ordered));
    await saveSettings({ custom_task_types: serializeOptionList(next) });
  };

  const addPosition = async (name: string) => {
    const next = mergeOptions(parseOptionList(settings.custom_positions), [name]);
    await saveSettings({ custom_positions: serializeOptionList(next) });
  };

  return { taskTypes, positions, addTaskType, reorderTaskTypes, addPosition };
}
