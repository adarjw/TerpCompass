/**
 * Web time picker: the browser's native <input type="time">, styled to match
 * Field. react-native-web renders through react-dom, so a raw DOM element is
 * fine here (this file is only ever resolved on web).
 */

import React from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../state/AppContext';
import { FONT, useColors } from './ui';

export function TimeField({
  value,
  onChange,
  label,
}: {
  /** "HH:MM" 24-hour. */
  value: string;
  /** Called only with a valid "HH:MM". */
  onChange: (time: string) => void;
  label?: string;
}) {
  const c = useColors();
  const { scheme } = useApp();
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? (
        <Text style={{ fontSize: 13, fontFamily: FONT.bold, color: c.textSecondary, marginBottom: 5 }}>{label}</Text>
      ) : null}
      <input
        type="time"
        value={value}
        onChange={(e) => {
          if (/^\d{2}:\d{2}$/.test(e.target.value)) onChange(e.target.value);
        }}
        style={{
          backgroundColor: c.card,
          color: c.text,
          border: `1px solid ${c.inputBorder}`,
          borderRadius: 6,
          padding: '9px 12px',
          fontSize: 15,
          fontFamily: 'Lato_400Regular, Lato, sans-serif',
          colorScheme: scheme,
          maxWidth: 160,
        }}
      />
    </View>
  );
}
