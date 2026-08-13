/**
 * Native fallback for the time picker: a plain HH:MM text field with
 * normalization on blur. The web build (TimeField.web.tsx) replaces this
 * with the browser's native time input.
 */

import React, { useState } from 'react';
import { Field } from './ui';

function normalize(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export function TimeField({
  value,
  onChange,
  label,
}: {
  /** "HH:MM" 24-hour. */
  value: string;
  /** Called only with a valid normalized "HH:MM". */
  onChange: (time: string) => void;
  label?: string;
}) {
  const [text, setText] = useState(value);
  return (
    <Field
      label={label}
      value={text}
      onChangeText={setText}
      onBlur={() => {
        const t = normalize(text);
        if (t) onChange(t);
        else setText(value);
      }}
      autoCapitalize="none"
      placeholder="08:00"
    />
  );
}
