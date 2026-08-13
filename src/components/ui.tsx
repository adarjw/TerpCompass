/**
 * Small shared UI kit: theme-aware cards, buttons, badges, empty states.
 * Everything respects light/dark and uses generous touch targets.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useApp } from '../state/AppContext';

export interface ThemeColors {
  text: string;
  textSecondary: string;
  background: string;
  card: string;
  border: string;
  accent: string;
  accentText: string;
  gold: string;
  success: string;
  warning: string;
  danger: string;
  subtle: string;
}

export const Palette: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    text: '#1a1a1a',
    textSecondary: '#5c6067',
    background: '#f7f7f8',
    card: '#ffffff',
    border: '#e3e4e8',
    accent: '#E21833', // UMD red
    accentText: '#ffffff',
    gold: '#FFD200',
    success: '#1a7f37',
    warning: '#9a6700',
    danger: '#c1121f',
    subtle: '#eceff3',
  },
  dark: {
    text: '#f2f2f3',
    textSecondary: '#a7abb3',
    background: '#0e0f11',
    card: '#1a1c1f',
    border: '#2a2d31',
    accent: '#ff4d5e',
    accentText: '#1a1a1a',
    gold: '#FFD200',
    success: '#4ade80',
    warning: '#fbbf24',
    danger: '#f87171',
    subtle: '#22252a',
  },
};

export function useColors(): ThemeColors {
  const { scheme } = useApp();
  return Palette[scheme];
}

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ flex: 1, backgroundColor: c.background }, style]}>{children}</View>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderRadius: 14,
          padding: 16,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          marginBottom: 12,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <Text style={{ fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 8 }}>{children}</Text>;
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <Text style={{ fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {children}
    </Text>
  );
}

export function Body({ children, secondary, style }: { children: React.ReactNode; secondary?: boolean; style?: object }) {
  const c = useColors();
  return (
    <Text style={[{ fontSize: 16, lineHeight: 22, color: secondary ? c.textSecondary : c.text }, style]}>
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  compact,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  compact?: boolean;
}) {
  const c = useColors();
  const bg =
    kind === 'primary' ? c.accent : kind === 'danger' ? c.danger : kind === 'secondary' ? c.subtle : 'transparent';
  const fg = kind === 'primary' ? c.accentText : kind === 'danger' ? '#fff' : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: bg,
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        paddingVertical: compact ? 8 : 14,
        paddingHorizontal: compact ? 12 : 18,
        borderRadius: 12,
        alignItems: 'center',
        marginVertical: 4,
        minHeight: compact ? 36 : 48,
        justifyContent: 'center',
      })}>
      <Text style={{ color: fg, fontWeight: '600', fontSize: compact ? 14 : 16 }}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' }) {
  const c = useColors();
  const colors: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: c.subtle, fg: c.textSecondary },
    success: { bg: c.success + '22', fg: c.success },
    warning: { bg: c.warning + '22', fg: c.warning },
    danger: { bg: c.danger + '22', fg: c.danger },
    accent: { bg: c.accent + '22', fg: c.accent },
  };
  const t = colors[tone];
  return (
    <View style={{ backgroundColor: t.bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: t.fg, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', padding: 32 }}>
      <Text style={{ fontSize: 17, fontWeight: '600', color: c.text, marginBottom: 8, textAlign: 'center' }}>
        {title}
      </Text>
      <Text style={{ fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20 }}>{hint}</Text>
    </View>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const c = useColors();
  return (
    <View style={{ marginBottom: 12 }}>
      {props.label ? (
        <Text style={{ fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 4 }}>{props.label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor={c.textSecondary}
        {...props}
        style={[
          {
            backgroundColor: c.card,
            color: c.text,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontSize: 16,
          },
          props.multiline ? { minHeight: 90, textAlignVertical: 'top' } : null,
          props.style,
        ]}
      />
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>{children}</View>;
}

export function Loading({ label }: { label?: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <ActivityIndicator color={c.accent} size="large" />
      {label ? <Text style={{ color: c.textSecondary }}>{label}</Text> : null}
    </View>
  );
}

export function ErrorBox({ message }: { message: string }) {
  const c = useColors();
  return (
    <View
      style={{
        backgroundColor: c.danger + '18',
        borderColor: c.danger,
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
        marginVertical: 8,
      }}>
      <Text style={{ color: c.danger, fontSize: 14 }}>{message}</Text>
    </View>
  );
}
